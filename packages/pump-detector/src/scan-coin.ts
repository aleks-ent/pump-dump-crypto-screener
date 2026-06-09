import type { Instrument } from "@screener/core";
import { loadSeries } from "./load/series.js";
import { evaluateFeatures, MIN_PUMP_DURATION_BARS } from "./features/evaluate.js";
import { computeScore, confidenceFromScore } from "./detect/score.js";
import { classifyPhase } from "./detect/phases.js";
import { filterPumpCandidatesByMinConsecutiveBars } from "./detect/run-length.js";
import { buildReasons } from "./detect/reasons.js";
import {
  listConfirmedExchangeNames,
} from "./detect/multi-exchange.js";
import { computeSeries, type ComputedSeries } from "./metrics/series-state.js";
import { TAIL_WARMUP_BARS } from "./scan-cache.js";
import type { InstrumentGroup } from "./instrument/group.js";
import type { ExchangeCoverage } from "./coverage.js";
import type {
  CoverageSnapshot,
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

function toCoverageSnapshots(coverages: ExchangeCoverage[]): CoverageSnapshot[] {
  return coverages.map((c) => ({
    exchange: c.exchange,
    coveragePct: c.coveragePct,
    fromMs: c.fromMs,
    toMs: c.toMs,
  }));
}

function toCandidate(
  inst: Instrument,
  openTimeMs: number,
  phase: PumpPhase,
  score: number,
  f: ReturnType<typeof evaluateFeatures>,
  leaderExchange: string,
  confirmedExchangeNames: string[],
  confirmedCount: number,
  coverages: CoverageSnapshot[],
  peersAvailable: number,
): PumpCandidate {
  const confidence = confidenceFromScore(score);
  return {
    timestamp: openTimeMs,
    baseAsset: inst.base ?? "",
    quoteAsset: inst.quote ?? "",
    symbol: inst.symbolNative,
    exchange: inst.exchange as ExchangeId,
    instrumentType: inst.instrumentType,
    timeframe: "5m",
    phase,
    score,
    confidence,
    leadingExchange: leaderExchange,
    confirmed: confirmedExchangeNames.length > 1,
    confirmedExchanges: confirmedExchangeNames,
    peersAvailable,
    coverage: coverages,
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
      confirmedExchanges: confirmedCount,
      medianQuoteVolume24h: f.medianQuoteVolume24h,
      closePosition: f.closePosition,
      ema20: f.ema20,
      ema50: f.ema50,
      ema20Slope: f.ema20Slope,
    },
    reasons: buildReasons(f, confirmedCount),
  };
}

function findBarIndexByOpenTime(series: ComputedSeries, openTimeMs: number): number | null {
  for (let i = 0; i < series.candles.length; i++) {
    if (series.candles[i]!.openTimeMs === openTimeMs) return i;
  }
  return null;
}

export interface ScanCoinResult {
  candidates: PumpCandidate[];
  leaderExchange: string;
  coverages: ExchangeCoverage[];
}

export function scanCoin(
  group: InstrumentGroup,
  leaderExchange: string,
  coverages: ExchangeCoverage[],
  opts: ScanOptions,
): ScanCoinResult {
  const liquidityThreshold = opts.liquidityThreshold ?? 100_000;
  const minScore = opts.minScore ?? 40;
  const useArchives = Boolean(opts.archivesDir);
  const coverageSnapshots = toCoverageSnapshots(coverages);
  const peersAvailable = group.instrumentsByExchange.size - 1;

  const leaderInst = group.instrumentsByExchange.get(leaderExchange);
  if (!leaderInst) {
    opts.onLog?.(`[scan] leader exchange ${leaderExchange} not in group ${group.key}`);
    return { candidates: [], leaderExchange, coverages };
  }

  const candles5mByExchange = new Map<string, ReturnType<typeof loadSeries>>();
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
    opts.onLog?.(
      `[scan] loaded ${exchange} ${inst.symbolNative}: ${loaded.candles.length} bars (source=${loaded.meta.source})`,
    );
  }

  const computedByExchange = new Map<string, ReturnType<typeof computeSeries>>();
  for (const [exchange, loaded] of candles5mByExchange) {
    if (loaded.candles.length > 0) {
      computedByExchange.set(exchange, computeSeries(loaded.candles, "5m"));
    }
  }

  const peerMap = computedByExchange;

  const loaded = candles5mByExchange.get(leaderExchange);
  const series = computedByExchange.get(leaderExchange);
  if (!loaded || !series) {
    opts.onLog?.(`[scan] no series data for leader ${leaderExchange}`);
    return { candidates: [], leaderExchange, coverages };
  }

  opts.onLog?.(
    `[scan] detecting on leader ${leaderExchange} (${leaderInst.symbolNative}), peers=${peersAvailable}`,
  );

  const hits: Array<{ barIndex: number; candidate: PumpCandidate }> = [];
  const incremental = opts.incremental;
  const warmupBars = incremental?.warmupBars ?? TAIL_WARMUP_BARS;
  const scanFromBarIndex =
    incremental != null ? Math.max(0, series.candles.length - warmupBars) : 0;

  if (incremental != null) {
    opts.onLog?.(
      `[scan] incremental tail: reusing ${incremental.cachedCandidates.length} cached candidate(s), rescanning from bar ${scanFromBarIndex}/${series.candles.length}`,
    );
    for (const cached of incremental.cachedCandidates) {
      if (cached.score < minScore) continue;
      const barIndex = findBarIndexByOpenTime(series, cached.timestamp);
      if (barIndex == null) continue;
      if (barIndex < scanFromBarIndex) {
        hits.push({ barIndex, candidate: cached });
      }
    }
  }

  for (let i = scanFromBarIndex; i < series.candles.length; i++) {
    if (!series.eligible[i]) continue;

    const f = evaluateFeatures(series, i);
    if (!f.eligible) continue;

    const lowLiquidity = f.medianQuoteVolume24h < liquidityThreshold;
    const confirmedExchangeNames = listConfirmedExchangeNames(
      series,
      i,
      peerMap,
      leaderExchange,
    );
    const confirmedCount = confirmedExchangeNames.length;
    const score = computeScore(f, confirmedCount, lowLiquidity);
    const phase = classifyPhase(f, score, loaded.quality.badData, lowLiquidity);

    if (!REPORTABLE_PHASES.has(phase)) continue;
    if (phase === "ignore" || score < minScore) continue;

    const candidate = toCandidate(
      leaderInst,
      series.candles[i]!.openTimeMs,
      phase,
      score,
      f,
      leaderExchange,
      confirmedExchangeNames,
      confirmedCount,
      coverageSnapshots,
      peersAvailable,
    );
    hits.push({ barIndex: i, candidate });

    opts.onLog?.(
      `[scan] hit @ ${new Date(series.candles[i]!.openTimeMs).toISOString()} phase=${phase} score=${score} confirmed=[${confirmedExchangeNames.join(",")}]`,
    );
  }

  const candidates = filterPumpCandidatesByMinConsecutiveBars(hits);
  const dropped = hits.length - candidates.length;
  if (dropped > 0) {
    opts.onLog?.(
      `[scan] ${group.key}: dropped ${dropped} hit(s) in pump/dump runs shorter than ${MIN_PUMP_DURATION_BARS * 5} minutes`,
    );
  }
  opts.onLog?.(`[scan] ${group.key}: ${candidates.length} candidate(s) on ${leaderExchange}`);

  return { candidates, leaderExchange, coverages };
}
