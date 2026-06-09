import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import pLimit from "p-limit";
import type { ArchiveFile, HttpClient, Instrument } from "@screener/core";
import { FileNotFoundError, HttpStatusError, httpStatusFromError } from "@screener/core";
import type { ExchangeAdapter } from "@screener/exchanges";
import {
  isFallbackSeriesOnDisk,
  isNonEmptyFile,
  resumeFallbackStartMs,
} from "@screener/storage";
import { isSeriesSatisfiedOnDisk, planFallbackRanges } from "./coverage.js";
import { archiveFilePath } from "./exists.js";
import { planArchives, supportsArchives } from "./fetch/index.js";
import { runSeriesRaw } from "./series-fetch.js";

export interface SeriesResult {
  key: string;
  status: string;
  archivesPresent: number;
  archivesDownloaded: number;
  gaps: number;
  fallbackRows: number;
  gapRecords: Record<string, unknown>[];
  /** Set when status is fallback_failed */
  fallbackError?: string;
}

/** One-line summary for REST fallback failure logs */
export function summarizeFallbackError(err: unknown): string {
  const httpStatus = httpStatusFromError(err);
  if (err instanceof HttpStatusError) {
    try {
      const endpoint = new URL(err.url).pathname.split("/").filter(Boolean).pop();
      if (endpoint) return `HTTP ${httpStatus ?? err.status} (${endpoint})`;
    } catch {
      /* ignore bad url */
    }
    return `HTTP ${httpStatus ?? err.status}`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const pathMatch = msg.match(/GET\s+https?:\/\/[^/]+(\/[^\s?]+)/);
  const endpoint = pathMatch?.[1]?.split("/").filter(Boolean).pop();
  if (httpStatus != null && endpoint) return `HTTP ${httpStatus} (${endpoint})`;
  if (httpStatus != null) return `HTTP ${httpStatus}`;
  return msg.length > 120 ? `${msg.slice(0, 117)}...` : msg;
}

export type FallbackFailedInfo = {
  instrument: Instrument;
  interval: string;
  reason: string;
};

function fallbackFailed(
  inst: Instrument,
  interval: string,
  base: Omit<SeriesResult, "status" | "fallbackRows" | "fallbackError">,
  err: unknown,
  onFallbackFailed?: (info: FallbackFailedInfo) => void,
): SeriesResult {
  const reason = summarizeFallbackError(err);
  onFallbackFailed?.({ instrument: inst, interval, reason });
  return {
    ...base,
    status: "fallback_failed",
    fallbackRows: 0,
    fallbackError: reason,
  };
}

function completeResult(
  key: string,
  archivesPresent: number,
  archivesDownloaded: number,
  gaps: number,
  gapRecords: Record<string, unknown>[],
): SeriesResult {
  return {
    key,
    status: "complete",
    archivesPresent,
    archivesDownloaded,
    gaps,
    fallbackRows: 0,
    gapRecords,
  };
}

class UrlCache {
  private readonly urls = new Set<string>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  /**
   * Single-flight per URL: concurrent requests for the *same* URL run one at a
   * time (so we never download the same file twice or write the same `.part`
   * file concurrently), while requests for *different* URLs run fully in
   * parallel. The previous implementation chained every call onto a single
   * promise, which serialized all downloads regardless of URL.
   */
  async run<T>(url: string, fn: () => Promise<T>): Promise<T> {
    let pending = this.inflight.get(url);
    while (pending) {
      await pending.catch(() => undefined);
      pending = this.inflight.get(url);
    }
    const task = fn();
    this.inflight.set(
      url,
      task.then(
        () => undefined,
        () => undefined,
      ),
    );
    try {
      return await task;
    } finally {
      this.inflight.delete(url);
    }
  }

  has(url: string): boolean {
    return this.urls.has(url);
  }

  add(url: string): void {
    this.urls.add(url);
  }
}

export async function runArchiveSeries(
  inst: Instrument,
  interval: string,
  startMs: number,
  endMs: number,
  archivesDir: string,
  client: HttpClient,
  opts: {
    allowFallback?: boolean;
    fallbackDir?: string;
    adapter?: ExchangeAdapter;
    fileWorkers?: number;
    downloadLimit?: ReturnType<typeof pLimit>;
    urlCache?: UrlCache;
    onFallbackFailed?: (info: FallbackFailedInfo) => void;
  } = {},
): Promise<SeriesResult> {
  const key = `${inst.exchange}|${inst.instrumentType}|${inst.symbolNative}|${interval}`;
  const failFallback = (
    base: Omit<SeriesResult, "status" | "fallbackRows" | "fallbackError">,
    err: unknown,
  ): SeriesResult => fallbackFailed(inst, interval, base, err, opts.onFallbackFailed);
  const gapRecords: Record<string, unknown>[] = [];
  const gapLabels = new Set<string>();
  const allowFallback = opts.allowFallback ?? true;
  const fallbackDir = opts.fallbackDir ?? "";
  const urlCache = opts.urlCache ?? new UrlCache();

  if (!supportsArchives(inst)) {
    if (
      await isSeriesSatisfiedOnDisk(
        inst,
        interval,
        startMs,
        endMs,
        archivesDir,
        fallbackDir,
        allowFallback,
      )
    ) {
      return completeResult(key, 0, 0, 0, gapRecords);
    }
    if (allowFallback && fallbackDir && opts.adapter) {
      try {
        const fallbackRows = await runFallbackRange(
          opts.adapter,
          client,
          inst,
          interval,
          startMs,
          endMs,
          fallbackDir,
          {},
          false,
        );
        if (
          await isSeriesSatisfiedOnDisk(
            inst,
            interval,
            startMs,
            endMs,
            archivesDir,
            fallbackDir,
            allowFallback,
          )
        ) {
          return { ...completeResult(key, 0, 0, 0, gapRecords), fallbackRows };
        }
        return {
          key,
          status: "fallback",
          archivesPresent: 0,
          archivesDownloaded: 0,
          gaps: 0,
          fallbackRows,
          gapRecords: [],
        };
      } catch (err) {
        return failFallback(
          { key, archivesPresent: 0, archivesDownloaded: 0, gaps: 0, gapRecords: [] },
          err,
        );
      }
    }
    return {
      key,
      status: allowFallback ? "fallback" : "skipped",
      archivesPresent: 0,
      archivesDownloaded: 0,
      gaps: 0,
      fallbackRows: 0,
      gapRecords: [],
    };
  }

  const planned = planArchives(inst, interval, startMs, endMs);
  if (planned.length === 0) {
    if (
      await isSeriesSatisfiedOnDisk(
        inst,
        interval,
        startMs,
        endMs,
        archivesDir,
        fallbackDir,
        allowFallback,
      )
    ) {
      return completeResult(key, 0, 0, 0, gapRecords);
    }
    if (allowFallback && fallbackDir && opts.adapter) {
      try {
        const fallbackRows = await runFallbackRange(
          opts.adapter,
          client,
          inst,
          interval,
          startMs,
          endMs,
          fallbackDir,
          {},
          false,
        );
        if (
          await isSeriesSatisfiedOnDisk(
            inst,
            interval,
            startMs,
            endMs,
            archivesDir,
            fallbackDir,
            allowFallback,
          )
        ) {
          return { ...completeResult(key, 0, 0, 0, gapRecords), fallbackRows };
        }
        return {
          key,
          status: "fallback",
          archivesPresent: 0,
          archivesDownloaded: 0,
          gaps: 0,
          fallbackRows,
          gapRecords: [],
        };
      } catch (err) {
        return failFallback(
          { key, archivesPresent: 0, archivesDownloaded: 0, gaps: 0, gapRecords: [] },
          err,
        );
      }
    }
    return {
      key,
      status: allowFallback ? "fallback" : "skipped",
      archivesPresent: 0,
      archivesDownloaded: 0,
      gaps: 0,
      fallbackRows: 0,
      gapRecords: [],
    };
  }

  if (
    await isSeriesSatisfiedOnDisk(
      inst,
      interval,
      startMs,
      endMs,
      archivesDir,
      fallbackDir,
      allowFallback,
    )
  ) {
    let present = 0;
    for (const a of planned) {
      if (isNonEmptyFile(archiveFilePath(archivesDir, a))) present += 1;
    }
    return completeResult(key, present, 0, gapLabels.size, gapRecords);
  }

  let present = 0;
  let downloaded = 0;

  const processArchive = async (archive: ArchiveFile) => {
    const dest = archiveFilePath(archivesDir, archive);
    if (isNonEmptyFile(dest)) {
      urlCache.add(archive.url);
      return { label: archive.label, present: true, downloaded: false, gap: null };
    }

    if (urlCache.has(archive.url)) {
      if (!isNonEmptyFile(dest)) {
        for (const other of planned) {
          if (other.url !== archive.url) continue;
          const otherDest = archiveFilePath(archivesDir, other);
          if (isNonEmptyFile(otherDest)) {
            mkdirSync(join(dest, ".."), { recursive: true });
            copyFileSync(otherDest, dest);
            return { label: archive.label, present: true, downloaded: false, gap: null };
          }
        }
      } else {
        return { label: archive.label, present: true, downloaded: false, gap: null };
      }
    }

    const run = async () => {
      // Go straight to GET: downloadFile already turns a 404 into
      // FileNotFoundError, so a separate HEAD just doubles rate-limited
      // requests (and Bybit's CloudFront often blocks HEAD anyway).
      await client.downloadFile(archive.url, dest);
      urlCache.add(archive.url);
      return { label: archive.label, present: true, downloaded: true, gap: null };
    };

    try {
      if (opts.downloadLimit) {
        return await opts.downloadLimit(() => urlCache.run(archive.url, run));
      }
      return await urlCache.run(archive.url, run);
    } catch (err) {
      if (err instanceof FileNotFoundError) {
        return {
          label: archive.label,
          present: false,
          downloaded: false,
          gap: {
            exchange: inst.exchange,
            instrument_type: inst.instrumentType,
            symbol_native: inst.symbolNative,
            interval,
            label: archive.label,
            url: archive.url,
            reason: "not_found",
          },
        };
      }
      const httpStatus = httpStatusFromError(err);
      if (httpStatus === 403 || httpStatus === 429) {
        return {
          label: archive.label,
          present: false,
          downloaded: false,
          gap: {
            exchange: inst.exchange,
            instrument_type: inst.instrumentType,
            symbol_native: inst.symbolNative,
            interval,
            label: archive.label,
            url: archive.url,
            reason: "access_denied",
            http_status: httpStatus,
          },
        };
      }
      throw err;
    }
  };

  const fileWorkers = Math.max(1, Math.min(opts.fileWorkers ?? 1, planned.length));
  const fileLimit = pLimit(fileWorkers);
  const outcomes = await Promise.all(
    planned.map((a) => fileLimit(() => processArchive(a))),
  );

  for (const o of outcomes) {
    if (o.gap) {
      gapLabels.add(o.label);
      gapRecords.push(o.gap);
    } else if (o.present) {
      present += 1;
      if (o.downloaded) downloaded += 1;
    }
  }

  let fallbackRows = 0;

  if (allowFallback && fallbackDir && opts.adapter) {
    try {
      const ranges = planFallbackRanges(planned, archivesDir, startMs, endMs);
      for (const [rangeStart, rangeEnd] of ranges) {
        fallbackRows += await runFallbackRange(
          opts.adapter,
          client,
          inst,
          interval,
          rangeStart,
          rangeEnd,
          fallbackDir,
          {},
          false,
        );
      }
    } catch (err) {
      return failFallback(
        {
          key,
          archivesPresent: present,
          archivesDownloaded: downloaded,
          gaps: gapLabels.size,
          gapRecords,
        },
        err,
      );
    }
  }

  const satisfied = await isSeriesSatisfiedOnDisk(
    inst,
    interval,
    startMs,
    endMs,
    archivesDir,
    fallbackDir,
    allowFallback,
  );

  if (satisfied) {
    return {
      key,
      status: "complete",
      archivesPresent: present,
      archivesDownloaded: downloaded,
      gaps: gapLabels.size,
      fallbackRows,
      gapRecords,
    };
  }

  return {
    key,
    status: allowFallback ? "fallback" : "incomplete",
    archivesPresent: present,
    archivesDownloaded: downloaded,
    gaps: gapLabels.size,
    fallbackRows,
    gapRecords,
  };
}

/** REST klines for [rangeStartMs, endMs) — used for gaps, spot-only, and tail-to-now on all exchanges. */
export async function runFallbackRange(
  adapter: ExchangeAdapter,
  client: HttpClient,
  inst: Instrument,
  interval: string,
  rangeStartMs: number,
  endMs: number,
  fallbackDir: string,
  checkpoint: Record<string, unknown>,
  checkpointEnabled: boolean,
): Promise<number> {
  if (rangeStartMs >= endMs) return 0;
  if (isFallbackSeriesOnDisk(fallbackDir, inst, interval, rangeStartMs, endMs)) {
    return 0;
  }
  const fetchStartMs = resumeFallbackStartMs(
    fallbackDir,
    inst,
    interval,
    rangeStartMs,
    endMs,
  );
  if (fetchStartMs >= endMs) return 0;
  const { rawRows } = await runSeriesRaw(
    adapter,
    client,
    inst,
    interval,
    fetchStartMs,
    endMs,
    fallbackDir,
    checkpoint,
    checkpointEnabled,
  );
  return rawRows;
}

export async function runApiFallback(
  adapter: ExchangeAdapter,
  client: HttpClient,
  inst: Instrument,
  interval: string,
  startMs: number,
  endMs: number,
  fallbackDir: string,
  checkpoint: Record<string, unknown>,
  checkpointEnabled: boolean,
): Promise<number> {
  return runFallbackRange(
    adapter,
    client,
    inst,
    interval,
    startMs,
    endMs,
    fallbackDir,
    checkpoint,
    checkpointEnabled,
  );
}

export { UrlCache };
