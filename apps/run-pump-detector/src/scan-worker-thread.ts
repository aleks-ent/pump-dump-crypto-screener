import { parentPort } from "node:worker_threads";
import { buildInstrumentGroups, type InstrumentGroup, type ScanParams } from "@screener/pump-detector";
import { createFileLogger, type CoinWorkerResult } from "./logger.js";
import { allDataPaths, scanOneCoin } from "./scan-one-coin.js";

export const WORKER_PING_COIN_KEY = "__worker_ping__";

export interface WorkerScanJob {
  coinKey: string;
  startMs: number;
  endMs: number;
  windowStartMs: number;
  dataDir: string;
  universePath: string;
  indexPath: string;
  minScore: number;
  liquidityThreshold: number;
  exchanges: string[] | null;
  scanParams: ScanParams;
  cacheDir?: string;
  outputPath: string;
  logPath: string;
}

interface WorkerRequest {
  id: number;
  job: WorkerScanJob;
}

let groupsCacheKey: string | null = null;
let groupsCache: InstrumentGroup[] | null = null;

function groupsCacheKeyFor(job: WorkerScanJob): string {
  return `${job.universePath}\0${job.indexPath}\0${job.exchanges?.join(",") ?? ""}`;
}

function findGroup(job: WorkerScanJob): InstrumentGroup | undefined {
  const key = groupsCacheKeyFor(job);
  if (groupsCacheKey !== key || !groupsCache) {
    const exchanges = job.exchanges ? new Set(job.exchanges) : undefined;
    groupsCache = buildInstrumentGroups({
      universePath: job.universePath,
      instrumentIndexPath: job.indexPath,
      exchanges,
    });
    groupsCacheKey = key;
  }
  return groupsCache.find((g) => g.key === job.coinKey);
}

function runJob(job: WorkerScanJob): CoinWorkerResult {
  const exchanges = job.exchanges ? new Set(job.exchanges) : undefined;
  const group = findGroup(job);
  if (!group) {
    return {
      coinKey: job.coinKey,
      status: "skipped",
      leaderExchange: null,
      exchanges: [],
      candidateCount: 0,
      coverages: [],
      error: "coin not found in universe/index",
    };
  }

  const { dataRoots, archivesDir, fallbackDir, extractedRoot } = allDataPaths(job.dataDir);
  const log = createFileLogger(job.logPath);
  log(`=== coin worker thread start coinKey=${job.coinKey} ===`);

  try {
    const result = scanOneCoin({
      group,
      startMs: job.startMs,
      endMs: job.endMs,
      windowStartMs: job.windowStartMs,
      dataDir: job.dataDir,
      dataRoots,
      archivesDir,
      fallbackDir,
      extractedRoot,
      minScore: job.minScore,
      liquidityThreshold: job.liquidityThreshold,
      exchanges,
      scanParams: job.scanParams,
      cacheDir: job.cacheDir,
      outputPath: job.outputPath,
      onLog: log,
    });
    log(`=== coin worker thread done coinKey=${job.coinKey} candidates=${result.candidateCount} ===`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`ERROR: ${message}`);
    return {
      coinKey: job.coinKey,
      status: "error",
      leaderExchange: null,
      exchanges: [...group.instrumentsByExchange.keys()],
      candidateCount: 0,
      coverages: [],
      error: message,
    };
  }
}

if (parentPort) {
  parentPort.on("message", (msg: WorkerRequest) => {
    if (msg.job.coinKey === WORKER_PING_COIN_KEY) {
      parentPort!.postMessage({
        id: msg.id,
        result: {
          coinKey: WORKER_PING_COIN_KEY,
          status: "ok",
          leaderExchange: null,
          exchanges: [],
          candidateCount: 0,
          coverages: [],
        },
      });
      return;
    }

    const result = runJob(msg.job);
    parentPort!.postMessage({ id: msg.id, result });
  });
}
