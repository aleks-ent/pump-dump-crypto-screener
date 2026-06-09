import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import type { ScanParams } from "@screener/pump-detector";
import type { CoinWorkerResult } from "./logger.js";
import type { WorkerScanJob } from "./scan-worker-thread.js";

/** Must match scan-worker-thread.ts ping handler. */
export const WORKER_PING_COIN_KEY = "__worker_ping__";

function runningFromSource(): boolean {
  return fileURLToPath(import.meta.url).includes("/src/");
}

function resolveWorkerUrl(): URL {
  if (runningFromSource()) {
    // tsx dev: bootstrap loader in worker before local .js → .ts imports
    return new URL("./scan-worker-entry.ts", import.meta.url);
  }
  // Production: compiled scan-worker-thread.js (sibling of bundled cli.js in dist/)
  return new URL("./scan-worker-thread.js", import.meta.url);
}

function workerExecArgv(): string[] {
  if (!runningFromSource()) return [];
  if (process.execArgv.length > 0) return [...process.execArgv];
  return ["--import", "tsx"];
}

interface PendingTask {
  job: WorkerScanJob;
  resolve: (result: CoinWorkerResult) => void;
  reject: (err: Error) => void;
}

interface IdleWorker {
  worker: Worker;
  busy: boolean;
}

/**
 * Persistent worker_threads pool — parallel CPU on multiple cores.
 * Production runs compiled dist/*.js workers; dev uses tsx bootstrap entry.
 */
export class ScanWorkerPool {
  private readonly workers: IdleWorker[] = [];
  private readonly queue: PendingTask[] = [];
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (r: CoinWorkerResult) => void; reject: (e: Error) => void }
  >();
  private readonly workerJobId = new Map<Worker, number>();
  private closed = false;

  constructor(size: number) {
    const workerUrl = resolveWorkerUrl();
    const execArgv = workerExecArgv();
    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerUrl, {
        type: "module",
        ...(execArgv.length > 0 ? { execArgv } : {}),
      } as ConstructorParameters<typeof Worker>[1]);
      worker.on("message", (msg: { id: number; result: CoinWorkerResult }) => {
        this.workerJobId.delete(worker);
        const task = this.pending.get(msg.id);
        if (!task) return;
        this.pending.delete(msg.id);
        task.resolve(msg.result);
        this.releaseWorker(worker);
      });
      worker.on("error", (err) => {
        this.failWorkerJob(worker, err instanceof Error ? err : new Error(String(err)));
      });
      worker.on("exit", (code) => {
        if (code === 0) return;
        const id = this.workerJobId.get(worker);
        if (id == null) return;
        this.failWorkerJob(worker, new Error(`scan worker exited with code ${code}`));
      });
      this.workers.push({ worker, busy: false });
    }
  }

  private failWorkerJob(worker: Worker, err: Error): void {
    const id = this.workerJobId.get(worker);
    this.workerJobId.delete(worker);
    if (id != null) {
      const task = this.pending.get(id);
      if (task) {
        this.pending.delete(id);
        task.reject(err);
      }
    }
    this.releaseWorker(worker);
  }

  runScan(job: WorkerScanJob): Promise<CoinWorkerResult> {
    if (this.closed) {
      return Promise.reject(new Error("ScanWorkerPool is closed"));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      this.dispatch();
    });
  }

  /** Fail fast when worker threads cannot load (misconfigured dev/prod layout). */
  async probe(timeoutMs = 20_000): Promise<void> {
    const probeJob: WorkerScanJob = {
      coinKey: WORKER_PING_COIN_KEY,
      startMs: 0,
      endMs: 1,
      windowStartMs: 0,
      dataDir: ".",
      universePath: ".",
      indexPath: ".",
      minScore: 40,
      liquidityThreshold: 100_000,
      exchanges: null,
      scanParams: { minScore: 40, liquidityThreshold: 100_000, exchanges: null },
      outputPath: ".",
      logPath: ".",
    };
    const result = await Promise.race([
      this.runScan(probeJob),
      new Promise<CoinWorkerResult>((_, reject) => {
        setTimeout(() => reject(new Error(`worker probe timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    if (result.coinKey !== WORKER_PING_COIN_KEY || result.status !== "ok") {
      throw new Error("worker probe returned unexpected result");
    }
  }

  private dispatch(): void {
    while (this.queue.length > 0) {
      const slot = this.workers.find((w) => !w.busy);
      if (!slot) return;

      const task = this.queue.shift()!;
      const id = this.nextId++;
      slot.busy = true;
      this.pending.set(id, { resolve: task.resolve, reject: task.reject });
      this.workerJobId.set(slot.worker, id);
      slot.worker.postMessage({ id, job: task.job });
    }
  }

  private releaseWorker(worker: Worker): void {
    const slot = this.workers.find((w) => w.worker === worker);
    if (slot) slot.busy = false;
    this.dispatch();
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.workers.map(({ worker }) => worker.terminate()));
    this.workers.length = 0;
    for (const [, task] of this.pending) {
      task.reject(new Error("ScanWorkerPool closed"));
    }
    this.pending.clear();
    for (const task of this.queue) {
      task.reject(new Error("ScanWorkerPool closed"));
    }
    this.queue.length = 0;
  }
}

export function buildWorkerScanJob(opts: {
  coinKey: string;
  startMs: number;
  endMs: number;
  windowStartMs: number;
  dataDir: string;
  universePath: string;
  indexPath: string;
  minScore: number;
  liquidityThreshold: number;
  exchanges: Set<string> | undefined;
  scanParams: ScanParams;
  cacheDir?: string;
  outputPath: string;
  logPath: string;
}): WorkerScanJob {
  return {
    coinKey: opts.coinKey,
    startMs: opts.startMs,
    endMs: opts.endMs,
    windowStartMs: opts.windowStartMs,
    dataDir: opts.dataDir,
    universePath: opts.universePath,
    indexPath: opts.indexPath,
    minScore: opts.minScore,
    liquidityThreshold: opts.liquidityThreshold,
    exchanges: opts.exchanges ? [...opts.exchanges] : null,
    scanParams: opts.scanParams,
    cacheDir: opts.cacheDir,
    outputPath: opts.outputPath,
    logPath: opts.logPath,
  };
}
