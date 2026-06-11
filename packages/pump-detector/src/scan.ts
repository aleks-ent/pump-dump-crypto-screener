import type { Instrument } from "@screener/core";
import { loadSeries } from "./load/series.js";
import { evaluateFeatures } from "./features/evaluate.js";
import { computeScore, confidenceFromScore } from "./detect/score.js";
import { classifyPhase } from "./detect/phases.js";
import { phaseMeetsMinScore, pumpPhaseMeetsQualityGates } from "./detect/threshold.js";
import { filterPumpCandidatesByMinConsecutiveBars } from "./detect/run-length.js";
import { buildReasons } from "./detect/reasons.js";
import {
  listConfirmedExchangeNames,
} from "./detect/multi-exchange.js";
import { computeSeries } from "./metrics/series-state.js";
import type { InstrumentGroup } from "./instrument/group.js";
import {
  createScanLoadStats,
  formatScanLoadStats,
  type ScanLoadStats,
} from "./scan-stats.js";
import type {
  ExchangeId,
  PumpCandidate,
  PumpPhase,
  ScanOptions,
} from "./types.js";

const REPORTABLE_PHASES = new Set<PumpPhase>([
  "activation",
  "active_pump",
  "late_pump",
  "distribution_or_fade",
  "spike",
]);

function toCandidate(
  inst: Instrument,
  openTimeMs: number,
  phase: PumpPhase,
  score: number,
  f: ReturnType<typeof evaluateFeatures>,
  confirmedExchanges: number,
  confirmedExchangeNames: string[],
  peersAvailable: number,
): PumpCandidate {
  const confidence = confidenceFromScore(score);
  return {
    timestamp: openTimeMs,
    baseAsset: inst.base ?? "",
    quoteAsset: inst.quote ?? "",
    symbol: inst.symbolNative,
    exchange: inst.exchange as ExchangeId,
    timeframe: "5m",
    phase,
    score,
    confidence,
    leadingExchange: inst.exchange,
    confirmed: confirmedExchanges > 1,
    confirmedExchanges: confirmedExchangeNames,
    peersAvailable,
    coverage: [],
    metrics: {
      volumeRatio: f.volumeRatio,
      rangeRatio: f.rangeRatio,
      bodyRatio: f.bodyRatio,
      priceChangeLast3Candles: f.priceChangeLast3,
      priceChangeLast6Candles: f.priceChangeLast6,
      priceChangeLast12Candles: f.priceChangeLast12,
      greenCountLast4: f.greenCountLast4,
      greenCountLast6: f.greenCountLast6,
      strongGreenCountLast5: f.strongGreenCountLast5,
      currentPullback: f.currentPullback,
      confirmedExchanges,
      medianQuoteVolume24h: f.medianQuoteVolume24h,
      closePosition: f.closePosition,
      ema20: f.ema20,
      ema50: f.ema50,
      ema20Slope: f.ema20Slope,
    },
    reasons: buildReasons(f, confirmedExchanges),
  };
}

export function scanInstrumentGroup(
  group: InstrumentGroup,
  opts: ScanOptions,
  stats?: ScanLoadStats,
): PumpCandidate[] {
  const liquidityThreshold = opts.liquidityThreshold ?? 100_000;
  const minScore = opts.minScore ?? 40;
  const minDumpScore = opts.minDumpScore ?? minScore;
  const hits: Array<{ barIndex: number; candidate: PumpCandidate }> = [];
  const useArchives = Boolean(opts.archivesDir);

  const candles5mByExchange = new Map<
    string,
    ReturnType<typeof loadSeries>
  >();

  for (const [exchange, inst] of group.instrumentsByExchange) {
    const loaded = loadSeries(inst, "5m", {
      ndjsonRoots: opts.dataRoots,
      archivesDir: opts.archivesDir,
      useArchives,
      startMs: opts.startMs,
      endMs: opts.endMs,
      onLog: opts.onLog,
    });
    candles5mByExchange.set(exchange, loaded);
    if (stats) {
      stats.seriesTotal += 1;
      stats.bySource[loaded.meta.source] += 1;
      stats.archiveFilesRead += loaded.meta.archiveFiles.length;
    }
  }

  const computedByExchange = new Map<string, ReturnType<typeof computeSeries>>();
  for (const [exchange, loaded] of candles5mByExchange) {
    if (loaded.candles.length > 0) {
      computedByExchange.set(exchange, computeSeries(loaded.candles, "5m"));
    }
  }

  const peerMap = computedByExchange;

  const peersAvailable = group.instrumentsByExchange.size - 1;

  for (const [exchange, inst] of group.instrumentsByExchange) {
    const loaded = candles5mByExchange.get(exchange);
    const series = computedByExchange.get(exchange);
    if (!loaded || !series) continue;

    for (let i = 0; i < series.candles.length; i++) {
      if (!series.eligible[i]) continue;

      const f = evaluateFeatures(series, i);
      if (!f.eligible) continue;

      const lowLiquidity = f.medianQuoteVolume24h < liquidityThreshold;
      const confirmedExchangeNames = listConfirmedExchangeNames(
        series,
        i,
        peerMap,
        exchange,
      );
      const confirmedExchanges = confirmedExchangeNames.length;
      const score = computeScore(f, confirmedExchanges, lowLiquidity);
      const phase = classifyPhase(f, score, loaded.quality.badData, lowLiquidity);

      if (!REPORTABLE_PHASES.has(phase)) continue;
      if (phase === "ignore" || !phaseMeetsMinScore(phase, score, minScore, minDumpScore)) continue;
      if (!pumpPhaseMeetsQualityGates(phase, f.priceChangeLast6, minScore)) continue;

      hits.push({
        barIndex: i,
        candidate: toCandidate(
          inst,
          series.candles[i]!.openTimeMs,
          phase,
          score,
          f,
          confirmedExchanges,
          confirmedExchangeNames,
          peersAvailable,
        ),
      });
    }
  }

  const candidates = filterPumpCandidatesByMinConsecutiveBars(hits);

  if (stats && candidates.length > 0) {
    stats.groupsWithCandidates += 1;
  }

  return candidates;
}

export function scanDataDir(
  groups: InstrumentGroup[],
  opts: ScanOptions,
): { candidates: PumpCandidate[]; stats: ScanLoadStats } {
  const stats = createScanLoadStats();
  const all: PumpCandidate[] = [];

  opts.onLog?.(
    `Pump scan window ${new Date(opts.startMs).toISOString()} .. ${new Date(opts.endMs).toISOString()}`,
  );
  if (opts.archivesDir) {
    opts.onLog?.(`Archive dir (on-the-fly unzip): ${opts.archivesDir}`);
  }

  for (const group of groups) {
    stats.groupsScanned += 1;
    all.push(...scanInstrumentGroup(group, opts, stats));
  }

  stats.candidates = all.length;
  all.sort((a, b) => a.timestamp - b.timestamp || a.exchange.localeCompare(b.exchange));

  opts.onLog?.(formatScanLoadStats(stats));

  return { candidates: all, stats };
}
