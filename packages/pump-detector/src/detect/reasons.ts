import type { FeatureSnapshot } from "../types.js";

export function buildReasons(f: FeatureSnapshot, confirmedExchanges: number): string[] {
  const reasons: string[] = [];

  if (f.volumeRatio >= 3) {
    reasons.push(`Volume is ${f.volumeRatio.toFixed(1)}x above the recent baseline`);
  }
  if (f.rangeRatio >= 2) {
    reasons.push(`Volatility is ${f.rangeRatio.toFixed(1)}x above the recent baseline`);
  }
  if (f.priceChangeLast6 >= 0.02) {
    reasons.push(
      `Price increased by ${(f.priceChangeLast6 * 100).toFixed(1)}% over the last 6 five-minute candles`,
    );
  }
  if (f.greenCountLast6 >= 4) {
    reasons.push(`${f.greenCountLast6} of the last 6 candles are green`);
  }
  if (f.currentPullback != null && f.currentPullback <= 0.3) {
    reasons.push(
      `Current pullback is only ${(f.currentPullback * 100).toFixed(0)}% of the impulse move`,
    );
  }
  if (f.trendBasic) {
    reasons.push("Price is above EMA20 with positive EMA20 slope");
  }
  if (f.breakoutFromLocalRange) {
    reasons.push("Price broke above the local 2-hour range");
  }
  if (confirmedExchanges >= 2) {
    reasons.push(`Move is confirmed on ${confirmedExchanges} exchanges`);
  } else if (confirmedExchanges === 1) {
    reasons.push("Move visible on a single exchange only");
  }
  if (f.accumulationBeforePump) {
    reasons.push("Quiet accumulation detected before the impulse");
  }
  if (f.calmBeforePump) {
    reasons.push("Calm, low-oscillation market detected for 2 hours before the impulse");
  }
  if (f.pullbacksAreBought) {
    reasons.push("Shallow pullbacks with price holding above EMA20");
  }
  if (f.latePumpDetected) {
    reasons.push("Move appears extended (late-stage pump)");
  }
  if (f.distributionDetected) {
    reasons.push("Distribution or fade pattern detected");
  }
  if (f.spikeDetected) {
    reasons.push("Single-candle spike with fast retrace");
  }

  return reasons;
}
