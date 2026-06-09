import type { FeatureSnapshot } from "../types.js";
import {
  countInWindow,
  ema20Slope,
  priceChange,
  type ComputedSeries,
} from "../metrics/series-state.js";
import { median } from "../metrics/math.js";

/** 3 × 5m bars = 15 minutes of sustained activation before a pump phase is allowed. */
export const MIN_PUMP_DURATION_BARS = 3;

function countSustainedActivationBars(series: ComputedSeries, i: number): number {
  let count = 0;
  for (let j = i; j >= 0; j--) {
    const vr = series.volumeRatio[j] ?? 0;
    const rr = series.rangeRatio[j] ?? 0;
    if (vr >= 3 && rr >= 1.5) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

function findImpulseStart(series: ComputedSeries, i: number): number | null {
  const start = Math.max(0, i - 11);
  for (let j = start; j <= i; j++) {
    const vr = series.volumeRatio[j];
    const rr = series.rangeRatio[j];
    if (vr != null && vr >= 3 && rr != null && rr >= 2 && series.isGreen[j]) {
      return j;
    }
  }
  return null;
}

function computePullback(series: ComputedSeries, i: number, impulseStart: number): number | null {
  const impulseStartPrice = series.candles[impulseStart]!.low;
  let impulseHigh = -Infinity;
  for (let j = impulseStart; j <= i; j++) {
    impulseHigh = Math.max(impulseHigh, series.candles[j]!.high);
  }
  const denom = impulseHigh - impulseStartPrice;
  if (denom <= 0) return null;
  const currentClose = series.candles[i]!.close;
  return (impulseHigh - currentClose) / denom;
}

function maxConsecutiveRed(series: ComputedSeries, i: number, window: number): number {
  let max = 0;
  let cur = 0;
  for (let j = Math.max(0, i - window + 1); j <= i; j++) {
    if (!series.isGreen[j]) {
      cur += 1;
      max = Math.max(max, cur);
    } else {
      cur = 0;
    }
  }
  return max;
}

function checkAccumulation(series: ComputedSeries, impulseStart: number): boolean {
  const preStart = impulseStart - 72;
  const preEnd = impulseStart - 24;
  if (preStart < 0 || preEnd <= preStart) return false;

  const preHigh = Math.max(...series.candles.slice(preStart, preEnd).map((c) => c.high));
  const preLow = Math.min(...series.candles.slice(preStart, preEnd).map((c) => c.low));
  if (preLow <= 0) return false;
  const preWindowRangePct = ((preHigh - preLow) / preLow) * 100;

  const preVolumes = series.candles.slice(preStart, preEnd).map((c) => c.volume);
  const preWindowVolumeMedian = median(preVolumes);
  const vb = series.volumeBaseline[impulseStart];
  if (preWindowVolumeMedian == null || vb == null) return false;

  const rollingRanges: number[] = [];
  for (let k = 24; k < series.candles.length; k++) {
    const slice = series.rangePct.slice(k - 24, k);
    const m = median(slice);
    if (m != null) rollingRanges.push(m);
  }
  const comparableMedian = median(rollingRanges);
  if (comparableMedian == null) return false;

  return (
    preWindowRangePct <= comparableMedian &&
    preWindowVolumeMedian <= 1.2 * vb
  );
}

function detectSpike(series: ComputedSeries, i: number): boolean {
  if (i < 2) return false;
  const one = priceChange(series, i, 1);
  if (one < 0.05) return false;
  const spikeLow = Math.min(series.candles[i - 1]!.open, series.candles[i]!.close);
  const spikeHigh = series.candles[i]!.high;
  const spikeSize = spikeHigh - spikeLow;
  if (spikeSize <= 0) return false;
  for (let j = 1; j <= 2 && i + j < series.candles.length; j++) {
    const retrace = spikeHigh - series.candles[i + j]!.close;
    if (retrace / spikeSize >= 0.7) return true;
  }
  return false;
}

export function evaluateFeatures(series: ComputedSeries, i: number): FeatureSnapshot {
  const vr = series.volumeRatio[i] ?? 0;
  const rr = series.rangeRatio[i] ?? 0;
  const br = series.bodyRatio[i] ?? 0;
  const eligible = series.eligible[i] ?? false;

  const priceChangeLast3 = priceChange(series, i, 3);
  const priceChangeLast6 = priceChange(series, i, 6);
  const priceChangeLast12 = priceChange(series, i, 12);
  const priceChangeOneCandle = priceChange(series, i, 1);

  const greenCountLast4 = countInWindow(series.isGreen, i, 4, (g) => g);
  const greenCountLast6 = countInWindow(series.isGreen, i, 6, (g) => g);

  let strongGreenCountLast5 = 0;
  for (let j = Math.max(0, i - 4); j <= i; j++) {
    const v = series.volumeRatio[j];
    if (series.isGreen[j] && series.closePosition[j]! >= 0.65 && v != null && v >= 2) {
      strongGreenCountLast5 += 1;
    }
  }

  let volumeActivationCluster = 0;
  let volatilityExpansionCluster = 0;
  for (let j = Math.max(0, i - 3); j <= i; j++) {
    const v = series.volumeRatio[j];
    const r = series.rangeRatio[j];
    if (v != null && v >= 3) volumeActivationCluster += 1;
    if (r != null && r >= 2) volatilityExpansionCluster += 1;
  }

  const impulseStartIndex = findImpulseStart(series, i);
  const currentPullback =
    impulseStartIndex != null ? computePullback(series, i, impulseStartIndex) : null;

  let localHigh = -Infinity;
  if (i >= 24) {
    for (let j = i - 24; j < i; j++) {
      localHigh = Math.max(localHigh, series.candles[j]!.high);
    }
  }
  const close = series.candles[i]!.close;
  const breakoutFromLocalRange = localHigh > 0 && close > localHigh * 1.003;
  const strongBreakout =
    breakoutFromLocalRange && vr >= 3 && rr >= 2;

  const accumulationBeforePump =
    impulseStartIndex != null ? checkAccumulation(series, impulseStartIndex) : false;

  const maxConsecutiveRedLast6 = maxConsecutiveRed(series, i, 6);
  const ema20 = series.ema20[i];
  const ema50 = series.ema50[i];
  const slope = ema20Slope(series, i, 6);

  const pullbacksAreBought =
    maxConsecutiveRedLast6 <= 2 && ema20 != null && close > ema20;

  const atr = series.atr[i];
  const directionalImpulse =
    priceChangeLast3 >= 0.02 ||
    priceChangeLast6 >= 0.04 ||
    (atr != null && atr > 0 && priceChangeLast6 >= (3 * atr) / close);

  const greenCluster = greenCountLast4 >= 3;
  const strongGreenCluster = greenCountLast6 >= 5 && strongGreenCountLast5 >= 3;
  const noPullback = currentPullback != null && currentPullback <= 0.3;
  const strongNoPullback = currentPullback != null && currentPullback <= 0.2;

  const trendBasic = ema20 != null && close > ema20 && slope != null && slope > 0;
  const trendStrong =
    trendBasic && ema50 != null && ema20 > ema50;

  const distanceFromEma =
    ema20 != null && atr != null && atr > 0 ? (close - ema20) / atr : 0;

  const latePumpDetected =
    priceChangeLast12 >= 0.12 && vr >= 10 && rr >= 4 &&
    (atr == null || atr <= 0 || distanceFromEma >= 2.5);

  let distributionDetected = false;
  if (!series.isGreen[i] && vr >= 5 && (close - series.candles[i]!.open) / series.candles[i]!.open < -0.01) {
    distributionDetected = true;
  }
  if (currentPullback != null && currentPullback >= 0.5) {
    distributionDetected = true;
  }
  if (vr >= 5 && priceChangeLast3 <= 0.01) {
    let recentHigh = -Infinity;
    for (let j = Math.max(0, i - 6); j <= i; j++) {
      recentHigh = Math.max(recentHigh, series.candles[j]!.high);
    }
    if (close < recentHigh) distributionDetected = true;
  }

  const spikeDetected = detectSpike(series, i);

  const activationConditionsMet =
    vr >= 3 && rr >= 1.5 && priceChangeLast3 > 0;

  const sustainedActivationBars = countSustainedActivationBars(series, i);
  const minPumpDurationMet = sustainedActivationBars >= MIN_PUMP_DURATION_BARS;

  const activePumpConditionsMet =
    volumeActivationCluster >= 2 &&
    volatilityExpansionCluster >= 2 &&
    directionalImpulse &&
    greenCluster &&
    noPullback &&
    trendBasic;

  return {
    volumeRatio: vr,
    rangeRatio: rr,
    bodyRatio: br,
    priceChangeLast3,
    priceChangeLast6,
    priceChangeLast12,
    priceChangeOneCandle,
    greenCountLast4,
    greenCountLast6,
    strongGreenCountLast5,
    volumeActivationCluster,
    volatilityExpansionCluster,
    currentPullback,
    impulseStartIndex,
    breakoutFromLocalRange,
    strongBreakout,
    accumulationBeforePump,
    maxConsecutiveRedLast6,
    pullbacksAreBought,
    directionalImpulse,
    greenCluster,
    strongGreenCluster,
    noPullback,
    strongNoPullback,
    trendBasic,
    trendStrong,
    latePumpDetected,
    distributionDetected,
    spikeDetected,
    activationConditionsMet,
    activePumpConditionsMet,
    sustainedActivationBars,
    minPumpDurationMet,
    medianQuoteVolume24h: series.medianQuoteVolume24h[i] ?? 0,
    closePosition: series.closePosition[i] ?? 0.5,
    ema20: ema20 ?? null,
    ema50: ema50 ?? null,
    ema20Slope: slope,
    eligible,
  };
}
