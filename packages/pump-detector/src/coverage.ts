import type { Instrument } from "@screener/core";
import { isSeriesSatisfiedOnDisk } from "@screener/archive";
import { loadSeries } from "./load/series.js";
import type { Timeframe } from "./types.js";

const INTERVAL_MS_5M = 300_000;

export interface ExchangeCoverage {
  exchange: string;
  fromMs: number | null;
  toMs: number | null;
  barsPresent: number;
  barsExpected: number;
  coveragePct: number;
  fullySatisfied: boolean;
}

export interface CoverageOptions {
  dataRoots: string[];
  archivesDir: string;
  fallbackDir: string;
  startMs: number;
  endMs: number;
  useArchives?: boolean;
  onLog?: (message: string) => void;
}

export function computeExchangeCoverage(
  inst: Instrument,
  interval: Timeframe,
  opts: CoverageOptions,
): ExchangeCoverage {
  const intervalMs = interval === "5m" ? INTERVAL_MS_5M : 60_000;
  const barsExpected = Math.max(0, Math.floor((opts.endMs - opts.startMs) / intervalMs));

  const useArchives = opts.useArchives ?? true;
  const loaded = loadSeries(inst, interval, {
    ndjsonRoots: opts.dataRoots,
    archivesDir: opts.archivesDir,
    useArchives,
    startMs: opts.startMs,
    endMs: opts.endMs,
    onLog: opts.onLog,
  });

  const candles = loaded.candles.filter(
    (c) => c.openTimeMs >= opts.startMs && c.openTimeMs < opts.endMs,
  );
  const barsPresent = candles.length;

  let fromMs: number | null = null;
  let toMs: number | null = null;
  if (candles.length > 0) {
    fromMs = candles[0]!.openTimeMs;
    toMs = candles[candles.length - 1]!.openTimeMs;
  }

  const coveragePct =
    barsExpected > 0 ? Math.round((barsPresent / barsExpected) * 10000) / 100 : 0;

  const fullySatisfied = isSeriesSatisfiedOnDisk(
    inst,
    interval,
    opts.startMs,
    opts.endMs,
    opts.archivesDir,
    opts.fallbackDir,
    true,
  );

  opts.onLog?.(
    `[coverage] ${inst.exchange} ${inst.symbolNative} ${interval}: ${coveragePct.toFixed(1)}% (${barsPresent}/${barsExpected} bars)` +
      (fromMs != null && toMs != null
        ? ` from ${new Date(fromMs).toISOString()} to ${new Date(toMs).toISOString()}`
        : "") +
      ` fullySatisfied=${fullySatisfied}`,
  );

  return {
    exchange: inst.exchange,
    fromMs,
    toMs,
    barsPresent,
    barsExpected,
    coveragePct,
    fullySatisfied,
  };
}

export const DEFAULT_EXCHANGE_PRIORITY = ["binance", "bybit"] as const;

export interface LeadingExchangeResult {
  leader: string | null;
  ranked: ExchangeCoverage[];
}

export function pickLeadingExchange(
  coverages: ExchangeCoverage[],
  priority: readonly string[] = DEFAULT_EXCHANGE_PRIORITY,
): LeadingExchangeResult {
  if (coverages.length === 0) return { leader: null, ranked: [] };

  const priorityIndex = (ex: string): number => {
    const idx = priority.indexOf(ex);
    return idx >= 0 ? idx : priority.length;
  };

  const ranked = [...coverages].sort((a, b) => {
    if (b.coveragePct !== a.coveragePct) return b.coveragePct - a.coveragePct;
    return priorityIndex(a.exchange) - priorityIndex(b.exchange);
  });

  const leader = ranked[0]!.coveragePct > 0 ? ranked[0]!.exchange : null;
  return { leader, ranked };
}
