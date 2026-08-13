import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { archiveFilePath, planArchives } from "@screener/archive";
import type { Instrument } from "@screener/core";
import { rawNdjsonPath, utcDaysInWindow } from "@screener/storage";
import type { InstrumentGroup } from "./instrument/group.js";
import { loadCandleSeriesStats } from "./load/ndjson-series.js";
import type { PumpCandidate, Timeframe } from "./types.js";

const PKG_DIR = dirname(fileURLToPath(import.meta.url));
export const PUMP_DETECTOR_VERSION = (
  JSON.parse(readFileSync(join(PKG_DIR, "../package.json"), "utf-8")) as { version: string }
).version;

export interface NdjsonDayFileStat {
  rootIndex: number;
  day: string;
  size: number;
  mtimeMs: number;
}

/** On-disk archive zip identity for cache invalidation (scan merges archives with NDJSON). */
export interface ArchiveFileStat {
  day: string;
  size: number;
}

export interface ExchangeDataFingerprint {
  exchange: string;
  barCount: number;
  firstBarMs: number | null;
  lastBarMs: number | null;
  dayFiles: NdjsonDayFileStat[];
  archiveFiles: ArchiveFileStat[];
}

export interface ScanParams {
  minScore: number;
  minDumpScore: number;
  liquidityThreshold: number;
  exchanges: string[] | null;
  requireCalmPrePump: boolean;
}

export interface CoinScanCacheCoverage {
  exchange: string;
  coveragePct: number;
  fromMs: number | null;
  toMs: number | null;
  fullySatisfied: boolean;
}

export interface CoinScanCache {
  detectorVersion: string;
  coinKey: string;
  windowStartMs: number;
  windowEndMs: number;
  scanParams: ScanParams;
  dataFingerprint: ExchangeDataFingerprint[];
  candidates: PumpCandidate[];
  leaderExchange: string | null;
  coverages: CoinScanCacheCoverage[];
  cachedAtUtc: string;
}

export function coinCacheSlug(coinKey: string): string {
  return coinKey.replace(/\|/g, "_").replace(/[^\w.-]+/g, "_");
}

export function coinScanCachePath(cacheDir: string, coinKey: string): string {
  return join(cacheDir, `${coinCacheSlug(coinKey)}.json`);
}

function listArchiveFileStats(
  inst: Instrument,
  interval: Timeframe,
  archivesDir: string | undefined,
  startMs: number,
  endMs: number,
): ArchiveFileStat[] {
  if (!archivesDir) return [];

  const stats: ArchiveFileStat[] = [];
  for (const archive of planArchives(inst, interval, startMs, endMs)) {
    const path = archiveFilePath(archivesDir, archive);
    if (!existsSync(path)) continue;
    const st = statSync(path);
    if (st.size <= 0) continue;
    stats.push({ day: archive.label, size: st.size });
  }
  return stats.sort((a, b) => a.day.localeCompare(b.day));
}

export function computeExchangeDataFingerprint(
  inst: Instrument,
  interval: Timeframe,
  dataRoots: string[],
  startMs: number,
  endMs: number,
  archivesDir?: string,
): ExchangeDataFingerprint {
  let barCount = 0;
  let firstBarMs: number | null = null;
  let lastBarMs: number | null = null;
  let winningRootIndex: number | null = null;

  for (let rootIndex = 0; rootIndex < dataRoots.length; rootIndex++) {
    const root = dataRoots[rootIndex]!;
    const stats = loadCandleSeriesStats(root, inst, interval, startMs, endMs);
    if (stats.barCount > 0) {
      winningRootIndex = rootIndex;
      barCount = stats.barCount;
      firstBarMs = stats.firstBarMs;
      lastBarMs = stats.lastBarMs;
      break;
    }
  }

  // Day-file stats are diagnostic only. Cache invalidation uses NDJSON barCount/firstBarMs/lastBarMs
  // plus archiveFiles (on-disk zip day + size) so archive backfill invalidates without NDJSON changes.
  const dayFiles: NdjsonDayFileStat[] = [];
  if (winningRootIndex != null) {
    const root = dataRoots[winningRootIndex]!;
    for (const day of utcDaysInWindow(startMs, endMs)) {
      const path = rawNdjsonPath(root, inst, interval, day);
      if (!existsSync(path)) continue;
      const st = statSync(path);
      dayFiles.push({
        rootIndex: winningRootIndex,
        day,
        size: st.size,
        mtimeMs: st.mtimeMs,
      });
    }
  }

  return {
    exchange: inst.exchange,
    barCount,
    firstBarMs,
    lastBarMs,
    dayFiles,
    archiveFiles: listArchiveFileStats(inst, interval, archivesDir, startMs, endMs),
  };
}

export function computeCoinDataFingerprint(
  group: InstrumentGroup,
  interval: Timeframe,
  dataRoots: string[],
  startMs: number,
  endMs: number,
  archivesDir?: string,
): ExchangeDataFingerprint[] {
  return [...group.instrumentsByExchange.values()]
    .map((inst) =>
      computeExchangeDataFingerprint(inst, interval, dataRoots, startMs, endMs, archivesDir),
    )
    .sort((a, b) => a.exchange.localeCompare(b.exchange));
}

function scanParamsEqual(a: ScanParams, b: ScanParams): boolean {
  if (
    a.minScore !== b.minScore ||
    a.minDumpScore !== b.minDumpScore ||
    a.liquidityThreshold !== b.liquidityThreshold ||
    a.requireCalmPrePump !== b.requireCalmPrePump
  ) {
    return false;
  }
  const aEx = a.exchanges?.slice().sort() ?? null;
  const bEx = b.exchanges?.slice().sort() ?? null;
  if (aEx === null && bEx === null) return true;
  if (aEx === null || bEx === null) return false;
  if (aEx.length !== bEx.length) return false;
  return aEx.every((v, i) => v === bEx[i]);
}

function normalizeArchiveFiles(files: ArchiveFileStat[] | undefined): ArchiveFileStat[] {
  return (files ?? []).slice().sort((a, b) => a.day.localeCompare(b.day));
}

function archiveFilesEqual(
  a: ArchiveFileStat[] | undefined,
  b: ArchiveFileStat[] | undefined,
): boolean {
  // Legacy cache JSON without archiveFiles must rescan once after upgrade.
  if (a === undefined || b === undefined) {
    return a === undefined && b === undefined;
  }
  const ax = normalizeArchiveFiles(a);
  const bx = normalizeArchiveFiles(b);
  if (ax.length !== bx.length) return false;
  for (let i = 0; i < ax.length; i++) {
    if (ax[i]!.day !== bx[i]!.day || ax[i]!.size !== bx[i]!.size) return false;
  }
  return true;
}

/** Compare loaded candle identity only — ignore file mtimes/sizes that fetch may touch. */
export function fingerprintsEqual(
  a: ExchangeDataFingerprint[],
  b: ExchangeDataFingerprint[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.exchange !== y.exchange ||
      x.barCount !== y.barCount ||
      x.firstBarMs !== y.firstBarMs ||
      x.lastBarMs !== y.lastBarMs ||
      !archiveFilesEqual(x.archiveFiles, y.archiveFiles)
    ) {
      return false;
    }
  }
  return true;
}

/** 288-bar baseline + feature lookbacks + 2-bar spike lookahead (see evaluate.ts). */
export const TAIL_WARMUP_BARS = 400;

/** Max new 5m bars since cache; larger deltas imply backfill → full rescan. */
export const MAX_TAIL_BAR_DELTA = 24;

export function shouldSkipScan(
  cache: CoinScanCache | null,
  opts: {
    detectorVersion: string;
    windowStartMs: number;
    /** Current scan window end (typically Date.now()). Cache must cover this instant. */
    endMs: number;
    scanParams: ScanParams;
    dataFingerprint: ExchangeDataFingerprint[];
  },
): boolean {
  if (!cache) return false;
  if (cache.detectorVersion !== opts.detectorVersion) return false;
  if (cache.windowStartMs !== opts.windowStartMs) return false;
  // Wall clock moved forward since cache — tail may hold new pumps even if fingerprint unchanged.
  if (opts.endMs > cache.windowEndMs) return false;
  if (!scanParamsEqual(cache.scanParams, opts.scanParams)) return false;
  if (!fingerprintsEqual(cache.dataFingerprint, opts.dataFingerprint)) return false;
  return true;
}

function exchangeTailAppendOnly(
  cached: ExchangeDataFingerprint,
  current: ExchangeDataFingerprint,
): "unchanged" | "tail" | "full" {
  if (cached.exchange !== current.exchange) return "full";
  if (cached.barCount === 0 && current.barCount > 0) return "full";
  if (cached.firstBarMs !== current.firstBarMs) return "full";
  if (current.barCount < cached.barCount) return "full";

  if (
    cached.barCount === current.barCount &&
    cached.lastBarMs === current.lastBarMs
  ) {
    return "unchanged";
  }

  if (current.barCount > cached.barCount) {
    const delta = current.barCount - cached.barCount;
    if (delta > MAX_TAIL_BAR_DELTA) return "full";
    if (
      cached.lastBarMs != null &&
      current.lastBarMs != null &&
      current.lastBarMs < cached.lastBarMs
    ) {
      return "full";
    }
    return "tail";
  }

  return "full";
}

/**
 * True when every exchange is unchanged or only grew at the tail (new bars appended).
 * Requires at least one exchange with new bars (otherwise use shouldSkipScan).
 */
export function shouldTailRescan(
  cache: CoinScanCache | null,
  opts: {
    detectorVersion: string;
    windowStartMs: number;
    scanParams: ScanParams;
    dataFingerprint: ExchangeDataFingerprint[];
  },
): boolean {
  if (!cache) return false;
  if (cache.detectorVersion !== opts.detectorVersion) return false;
  if (cache.windowStartMs !== opts.windowStartMs) return false;
  if (!scanParamsEqual(cache.scanParams, opts.scanParams)) return false;
  if (fingerprintsEqual(cache.dataFingerprint, opts.dataFingerprint)) return false;

  // New or changed archive zips are historical backfill — never incremental tail only.
  for (let i = 0; i < cache.dataFingerprint.length; i++) {
    const cached = cache.dataFingerprint[i]!;
    const current = opts.dataFingerprint[i];
    if (!current) return false;
    if (!archiveFilesEqual(cached.archiveFiles, current.archiveFiles)) return false;
  }

  const cached = cache.dataFingerprint;
  const current = opts.dataFingerprint;
  if (cached.length !== current.length) return false;

  let hasNewBars = false;
  for (let i = 0; i < cached.length; i++) {
    const mode = exchangeTailAppendOnly(cached[i]!, current[i]!);
    if (mode === "full") return false;
    if (mode === "tail") hasNewBars = true;
  }
  return hasNewBars;
}

export function loadCoinScanCache(cachePath: string): CoinScanCache | null {
  if (!existsSync(cachePath)) return null;
  try {
    return JSON.parse(readFileSync(cachePath, "utf-8")) as CoinScanCache;
  } catch {
    return null;
  }
}

export function saveCoinScanCache(cachePath: string, cache: CoinScanCache): void {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, `${JSON.stringify(cache)}\n`, "utf-8");
}

export function buildCoinScanCache(opts: {
  coinKey: string;
  windowStartMs: number;
  windowEndMs: number;
  scanParams: ScanParams;
  dataFingerprint: ExchangeDataFingerprint[];
  candidates: PumpCandidate[];
  leaderExchange: string | null;
  coverages: CoinScanCacheCoverage[];
}): CoinScanCache {
  return {
    detectorVersion: PUMP_DETECTOR_VERSION,
    coinKey: opts.coinKey,
    windowStartMs: opts.windowStartMs,
    windowEndMs: opts.windowEndMs,
    scanParams: opts.scanParams,
    dataFingerprint: opts.dataFingerprint,
    candidates: opts.candidates,
    leaderExchange: opts.leaderExchange,
    coverages: opts.coverages,
    cachedAtUtc: new Date().toISOString(),
  };
}
