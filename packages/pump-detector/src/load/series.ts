import type { Instrument } from "@screener/core";
import { loadCandleSeries } from "./ndjson-series.js";
import { loadExchangeArchives } from "./archives/index.js";
import { mergeCandleSets } from "./merge-candles.js";
import type { Candle, SeriesQualityFlags, Timeframe } from "../types.js";

export type SeriesDataSource = "ndjson" | "archive" | "merged" | "none";

export interface SeriesLoadMeta {
  source: SeriesDataSource;
  ndjsonBars: number;
  archiveBars: number;
  archiveFiles: string[];
  usedArchives: boolean;
}

export interface SeriesLoadResult {
  candles: Candle[];
  quality: SeriesQualityFlags;
  meta: SeriesLoadMeta;
}

export interface LoadSeriesOptions {
  ndjsonRoots: string[];
  archivesDir?: string | null;
  useArchives: boolean;
  startMs: number;
  endMs: number;
  onLog?: (message: string) => void;
}

const INTERVAL_MS: Record<Timeframe, number> = { "1m": 60_000, "5m": 300_000 };

export function loadSeries(
  inst: Instrument,
  interval: Timeframe,
  opts: LoadSeriesOptions,
): SeriesLoadResult {
  const log = opts.onLog ?? (() => undefined);
  const intervalMs = INTERVAL_MS[interval];

  let ndjsonCandles: Candle[] = [];
  let ndjsonQuality: SeriesQualityFlags = {
    badData: true,
    duplicateBars: 0,
    gaps: 0,
    reasons: ["No NDJSON"],
  };

  for (const root of opts.ndjsonRoots) {
    const result = loadCandleSeries(root, inst, interval, opts.startMs, opts.endMs);
    if (result.candles.length > 0) {
      ndjsonCandles = result.candles;
      ndjsonQuality = result.quality;
      break;
    }
  }

  let archiveCandles: Candle[] = [];
  let archivePaths: string[] = [];
  if (opts.useArchives && opts.archivesDir) {
    const arch = loadExchangeArchives(
      opts.archivesDir,
      inst,
      interval,
      opts.startMs,
      opts.endMs,
    );
    archiveCandles = arch.candles;
    archivePaths = arch.paths;
    if (archivePaths.length > 0) {
      log(
        `[archive] ${inst.exchange} ${inst.symbolNative} ${interval}: unpacked ${archiveCandles.length} bars from ${archivePaths.length} file(s)`,
      );
    }
  }

  const key = `${inst.exchange}|${inst.instrumentType}|${inst.symbolNative}|${interval}`;

  if (ndjsonCandles.length > 0 && archiveCandles.length > 0) {
    const merged = mergeCandleSets(
      [
        { candles: archiveCandles, label: "archive" },
        { candles: ndjsonCandles, label: "ndjson" },
      ],
      intervalMs,
    );
    log(
      `[merged] ${key}: ndjson=${ndjsonCandles.length} + archive=${archiveCandles.length} → ${merged.candles.length} bars (NDJSON wins overlaps)`,
    );
    return {
      candles: merged.candles,
      quality: merged.quality,
      meta: {
        source: "merged",
        ndjsonBars: ndjsonCandles.length,
        archiveBars: archiveCandles.length,
        archiveFiles: archivePaths,
        usedArchives: true,
      },
    };
  }

  if (ndjsonCandles.length > 0) {
    log(`[ndjson] ${key}: ${ndjsonCandles.length} bars`);
    return {
      candles: ndjsonCandles,
      quality: ndjsonQuality,
      meta: {
        source: "ndjson",
        ndjsonBars: ndjsonCandles.length,
        archiveBars: 0,
        archiveFiles: [],
        usedArchives: false,
      },
    };
  }

  if (archiveCandles.length > 0) {
    const merged = mergeCandleSets([{ candles: archiveCandles, label: "archive" }], intervalMs);
    log(`[archive-only] ${key}: ${archiveCandles.length} bars (no NDJSON in window)`);
    return {
      candles: merged.candles,
      quality: merged.quality,
      meta: {
        source: "archive",
        ndjsonBars: 0,
        archiveBars: archiveCandles.length,
        archiveFiles: archivePaths,
        usedArchives: true,
      },
    };
  }

  log(`[missing] ${key}: no NDJSON or archive data in window`);
  return {
    candles: [],
    quality: { badData: true, duplicateBars: 0, gaps: 0, reasons: ["No data"] },
    meta: {
      source: "none",
      ndjsonBars: 0,
      archiveBars: 0,
      archiveFiles: [],
      usedArchives: false,
    },
  };
}
