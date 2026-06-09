import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export const RETRY_STATUSES = new Set([
  403, 408, 409, 418, 425, 429, 500, 502, 503, 504,
]);

/**
 * Pluggable backing store for per-host cooldowns, used to share a 418/429
 * cooldown across processes (e.g. all sharded workers) so a ban on one process
 * pauses the rest instead of every process hammering the host independently.
 */
export interface CooldownStore {
  /** Epoch ms until which the host is in cooldown (0 if none). */
  read(host: string): number;
  /** Persist a cooldown deadline (epoch ms) for the host. */
  write(host: string, untilMs: number): void;
}

/** File-backed {@link CooldownStore}; one small JSON file per host in a dir. */
export class FileCooldownStore implements CooldownStore {
  private readonly dir: string;
  private readonly ttlMs: number;
  private readonly cache = new Map<string, { value: number; ts: number }>();

  constructor(dir: string, ttlMs = 1000) {
    this.dir = dir;
    this.ttlMs = ttlMs;
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  private fileFor(host: string): string {
    return join(this.dir, `${host.replace(/[^a-zA-Z0-9.-]/g, "_")}.json`);
  }

  read(host: string): number {
    const now = Date.now();
    const cached = this.cache.get(host);
    if (cached && now - cached.ts < this.ttlMs) return cached.value;
    let value = 0;
    try {
      const parsed = JSON.parse(readFileSync(this.fileFor(host), "utf-8")) as {
        until_ms?: number;
      };
      if (parsed && Number.isFinite(parsed.until_ms)) value = Number(parsed.until_ms);
    } catch {
      /* missing or unreadable → no cooldown */
    }
    this.cache.set(host, { value, ts: now });
    return value;
  }

  write(host: string, untilMs: number): void {
    this.cache.set(host, { value: untilMs, ts: Date.now() });
    try {
      writeFileSync(this.fileFor(host), JSON.stringify({ until_ms: untilMs }), "utf-8");
    } catch {
      /* ignore */
    }
  }
}

export interface RetryPolicy {
  retries: number;
  baseDelayS: number;
  maxDelayS: number;
  jitterRatio: number;
}

const DEFAULT_RETRY: RetryPolicy = {
  retries: 5,
  baseDelayS: 0.4,
  maxDelayS: 8.0,
  jitterRatio: 0.25,
};

export class TokenBucketLimiter {
  private readonly defaultRps: number;
  private readonly hostRps: Record<string, number>;
  private readonly state = new Map<string, { tokens: number; ts: number }>();
  /** Epoch ms until which a host is in cooldown (e.g. after 418/429). */
  private readonly cooldownUntil = new Map<string, number>();
  /**
   * Epoch ms when a host was first 418/429-limited and has not yet recovered.
   * Cleared (and logged) by {@link noteSuccess} on the next successful request.
   */
  private readonly limitedSince = new Map<string, number>();
  private readonly store?: CooldownStore;
  private readonly log?: (msg: string) => void;
  /** Throttles repeated "still waiting" logs, per host. */
  private readonly lastWaitLog = new Map<string, number>();
  /**
   * Per-host serialization chains. Each host gets its own chain so token-bucket
   * accounting (and, crucially, the cooldown sleep) for one host never blocks
   * requests to other hosts. A single global chain would let a 600s 418
   * cooldown on one host stall every other host behind it.
   */
  private readonly chains = new Map<string, Promise<void>>();

  constructor(
    defaultRps = 8.0,
    hostRps: Record<string, number> = {},
    opts?: { store?: CooldownStore; log?: (msg: string) => void },
  ) {
    this.defaultRps = defaultRps;
    this.hostRps = hostRps;
    this.store = opts?.store;
    this.log = opts?.log;
  }

  private rateFor(host: string, rps?: number): number {
    return rps ?? this.hostRps[host] ?? this.defaultRps;
  }

  /** Largest known cooldown deadline (local + shared store) for a host. */
  private cooldownFor(host: string): number {
    const local = this.cooldownUntil.get(host) ?? 0;
    const shared = this.store?.read(host) ?? 0;
    return Math.max(local, shared);
  }

  /**
   * Register a cooldown for a host (after a 418/429). Subsequent requests to
   * that host wait until the cooldown clears, so a temporary ban is not made
   * worse by hammering it. Always keeps the longest pending cooldown, and
   * mirrors it to the shared store so sibling processes pause too.
   *
   * @returns true if this newly started a cooldown (host was not already paused).
   */
  noteCooldown(host: string, untilMs: number): boolean {
    const wasActive = this.cooldownFor(host) > Date.now();
    if (untilMs > (this.cooldownUntil.get(host) ?? 0)) {
      this.cooldownUntil.set(host, untilMs);
    }
    if (this.store && untilMs > this.store.read(host)) {
      this.store.write(host, untilMs);
    }
    if (!this.limitedSince.has(host)) {
      this.limitedSince.set(host, Date.now());
    }
    return !wasActive;
  }

  /**
   * Record a successful request to a host. If the host had previously been
   * 418/429-limited, log that it has recovered and clear the marker so the
   * recovery is reported only once per ban episode.
   */
  noteSuccess(host: string): void {
    const since = this.limitedSince.get(host);
    if (since === undefined) return;
    this.limitedSince.delete(host);
    this.lastWaitLog.delete(host);
    if (this.log) {
      const downS = ((Date.now() - since) / 1000).toFixed(1);
      this.log(`recovered: request to ${host} succeeded ${downS}s after first 418/429`);
    }
  }

  async consume(host: string, rps?: number): Promise<void> {
    const prev = this.chains.get(host) ?? Promise.resolve();
    const run = prev.then(() => this.consumeInner(host, rps));
    this.chains.set(host, run.catch(() => {}));
    await run;
  }

  private async consumeInner(host: string, rps?: number): Promise<void> {
    const cooldown = this.cooldownFor(host);
    const cooldownWaitMs = cooldown - Date.now();
    if (cooldownWaitMs > 0) {
      const now = Date.now();
      const lastLog = this.lastWaitLog.get(host) ?? 0;
      if (this.log && now - lastLog > 5000) {
        this.lastWaitLog.set(host, now);
        this.log(`cooldown active for ${host}: waiting ${(cooldownWaitMs / 1000).toFixed(1)}s`);
      }
      await sleep(cooldownWaitMs);
    }
    const rate = this.rateFor(host, rps);
    const now = performance.now() / 1000;
    let bucket = this.state.get(host);
    if (!bucket) {
      bucket = { tokens: rate, ts: now };
      this.state.set(host, bucket);
    }
    const elapsed = now - bucket.ts;
    bucket.tokens = Math.min(rate, bucket.tokens + elapsed * rate);
    bucket.ts = now;
    if (bucket.tokens >= 1.0) {
      bucket.tokens -= 1.0;
      return;
    }
    const waitS = (1.0 - bucket.tokens) / rate;
    await sleep(waitS * 1000);
    bucket.tokens = 0;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function hostFromUrl(url: string): string {
  return new URL(url).host;
}

function buildUrl(url: string, params?: Record<string, string | number>): string {
  if (!params || Object.keys(params).length === 0) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export class HttpClient {
  readonly timeoutMs: number;
  readonly retryPolicy: RetryPolicy;
  readonly limiter: TokenBucketLimiter;
  private readonly userAgent: string;
  private readonly log?: (msg: string) => void;

  constructor(opts?: {
    timeoutS?: number;
    userAgent?: string;
    retryPolicy?: Partial<RetryPolicy>;
    limiter?: TokenBucketLimiter;
    log?: (msg: string) => void;
  }) {
    this.timeoutMs = (opts?.timeoutS ?? 20) * 1000;
    this.userAgent = opts?.userAgent ?? "market-stats-ingestor/1.0";
    this.retryPolicy = { ...DEFAULT_RETRY, ...opts?.retryPolicy };
    this.limiter = opts?.limiter ?? new TokenBucketLimiter();
    this.log = opts?.log;
  }

  /**
   * On a 418 (IP auto-ban) or 429 (rate limited), pause further requests to
   * that host for the Retry-After window (or a sensible default). Retrying into
   * a 418 only lengthens the ban, so this lets the limiter wait it out instead.
   */
  private applyCooldown(host: string, response: Response): void {
    const status = response.status;
    if (status !== 418 && status !== 429) return;
    const retryAfter = response.headers.get("retry-after");
    let seconds = retryAfter != null ? Number(retryAfter)  * 1. : Number.NaN;
    const fromHeader = Number.isFinite(seconds) && seconds > 0;
    if (!fromHeader) {
      seconds = status === 418 ? 60 : 5;
    }
    seconds = Math.min(seconds, 600);
    const started = this.limiter.noteCooldown(host, Date.now() + seconds * 1000);
    if (started && this.log) {
      this.log(
        `HTTP ${status} from ${host}${status === 418 ? " (IP banned)" : " (rate limited)"}; ` +
          `pausing requests to it for ${seconds}s (${fromHeader ? "retry-after" : "default"})`,
      );
    }
  }

  async getJson<T = Record<string, unknown>>(
    url: string,
    params?: Record<string, string | number>,
    hostRps?: number,
  ): Promise<T> {
    const fullUrl = buildUrl(url, params);
    const host = hostFromUrl(fullUrl);
    let lastError: unknown;
    let lastStatus = "n/a";

    for (let attempt = 0; attempt <= this.retryPolicy.retries; attempt++) {
      await this.limiter.consume(host, hostRps);
      try {
        const response = await fetch(fullUrl, {
          method: "GET",
          headers: { "User-Agent": this.userAgent },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        lastStatus = String(response.status);
        this.applyCooldown(host, response);
        if (RETRY_STATUSES.has(response.status)) {
          throw new Error(`Retryable status ${response.status}`);
        }
        if (!response.ok) {
          throw new HttpStatusError(response.status, fullUrl);
        }
        this.limiter.noteSuccess(host);
        return (await response.json()) as T;
      } catch (err) {
        lastError = err;
        if (err instanceof HttpStatusError && !RETRY_STATUSES.has(err.status)) {
          break;
        }
        if (attempt >= this.retryPolicy.retries) break;
        const delay = Math.min(
          this.retryPolicy.maxDelayS,
          this.retryPolicy.baseDelayS * 2 ** attempt,
        );
        const jitter = delay * this.retryPolicy.jitterRatio * Math.random();
        await sleep((delay + jitter) * 1000);
      }
    }
    throw new Error(`GET ${fullUrl} failed after retries; status=${lastStatus}`, {
      cause: lastError,
    });
  }

  async headOk(url: string, hostRps?: number): Promise<boolean> {
    const host = hostFromUrl(url);
    let lastError: unknown;
    let lastStatus = "n/a";

    for (let attempt = 0; attempt <= this.retryPolicy.retries; attempt++) {
      await this.limiter.consume(host, hostRps);
      try {
        const response = await fetch(url, {
          method: "HEAD",
          headers: { "User-Agent": this.userAgent },
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: "follow",
        });
        lastStatus = String(response.status);
        this.applyCooldown(host, response);
        if (response.status === 404) {
          this.limiter.noteSuccess(host);
          return false;
        }
        if (RETRY_STATUSES.has(response.status)) {
          throw new Error(`Retryable status ${response.status}`);
        }
        if (!response.ok) {
          throw new HttpStatusError(response.status, url);
        }
        this.limiter.noteSuccess(host);
        return true;
      } catch (err) {
        if (err instanceof HttpStatusError && err.status === 404) return false;
        lastError = err;
        if (err instanceof HttpStatusError && !RETRY_STATUSES.has(err.status)) {
          break;
        }
        if (attempt >= this.retryPolicy.retries) break;
        const delay = Math.min(
          this.retryPolicy.maxDelayS,
          this.retryPolicy.baseDelayS * 2 ** attempt,
        );
        const jitter = delay * this.retryPolicy.jitterRatio * Math.random();
        await sleep((delay + jitter) * 1000);
      }
    }
    throw new Error(`HEAD ${url} failed after retries; status=${lastStatus}`, {
      cause: finalHttpCause(url, lastStatus, lastError),
    });
  }

  async downloadFile(url: string, destPath: string, hostRps?: number): Promise<void> {
    if (existsSync(destPath) && statSync(destPath).size > 0) {
      return;
    }
    const host = hostFromUrl(url);
    await mkdir(dirname(destPath), { recursive: true });
    const tmpPath = `${destPath}.part`;
    let lastError: unknown;
    let lastStatus = "n/a";

    for (let attempt = 0; attempt <= this.retryPolicy.retries; attempt++) {
      await this.limiter.consume(host, hostRps);
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: { "User-Agent": this.userAgent },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        lastStatus = String(response.status);
        this.applyCooldown(host, response);
        if (response.status === 404) {
          throw new FileNotFoundError(url);
        }
        if (RETRY_STATUSES.has(response.status)) {
          throw new Error(`Retryable status ${response.status}`);
        }
        if (!response.ok || !response.body) {
          throw new HttpStatusError(response.status, url);
        }
        const nodeStream = Readable.fromWeb(
          response.body as import("node:stream/web").ReadableStream,
        );
        await pipeline(nodeStream, createWriteStream(tmpPath));
        await rename(tmpPath, destPath);
        this.limiter.noteSuccess(host);
        return;
      } catch (err) {
        if (err instanceof FileNotFoundError) throw err;
        lastError = err;
        try {
          await unlink(tmpPath);
        } catch {
          /* ignore */
        }
        if (attempt >= this.retryPolicy.retries) break;
        const delay = Math.min(
          this.retryPolicy.maxDelayS,
          this.retryPolicy.baseDelayS * 2 ** attempt,
        );
        const jitter = delay * this.retryPolicy.jitterRatio * Math.random();
        await sleep((delay + jitter) * 1000);
      }
    }
    throw new Error(`GET ${url} failed after retries; status=${lastStatus}`, {
      cause: finalHttpCause(url, lastStatus, lastError),
    });
  }
}

function finalHttpCause(url: string, lastStatus: string, lastError: unknown): unknown {
  if (lastError instanceof HttpStatusError) return lastError;
  const code = Number(lastStatus);
  if (Number.isFinite(code) && code >= 400) {
    return new HttpStatusError(code, url);
  }
  return lastError;
}

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpStatusError";
  }
}

export function httpStatusFromError(err: unknown): number | undefined {
  let cur: unknown = err;
  while (cur) {
    if (cur instanceof HttpStatusError) return cur.status;
    if (cur instanceof Error) {
      const fromMsg = cur.message.match(/(?:status=|Retryable status )(\d{3})\b/);
      if (fromMsg) return Number(fromMsg[1]);
      cur = cur.cause;
    } else {
      break;
    }
  }
  return undefined;
}

export class FileNotFoundError extends Error {
  constructor(readonly url: string) {
    super(url);
    this.name = "FileNotFoundError";
  }
}
