import type { Confidence, FeatureSnapshot } from "../types.js";
import { clamp } from "../metrics/math.js";

export function computeScore(
  f: FeatureSnapshot,
  confirmedExchanges: number,
  lowLiquidity: boolean,
): number {
  let score = 0;

  if (f.volumeRatio >= 3) score += 15;
  if (f.volumeRatio >= 5) score += 10;
  if (f.volumeRatio >= 10) score += 5;

  if (f.rangeRatio >= 2) score += 15;
  if (f.rangeRatio >= 3) score += 5;

  if (f.priceChangeLast3 >= 0.02) score += 10;
  if (f.priceChangeLast6 >= 0.04) score += 10;

  if (f.greenCountLast4 >= 3) score += 10;
  if (f.greenCountLast6 >= 5) score += 5;

  if (f.currentPullback != null && f.currentPullback <= 0.3) score += 10;
  if (f.currentPullback != null && f.currentPullback <= 0.2) score += 5;

  if (f.trendBasic) score += 10;
  if (f.breakoutFromLocalRange) score += 10;

  if (confirmedExchanges >= 2) score += 10;
  if (confirmedExchanges === 3) score += 5;

  if (f.latePumpDetected) score -= 20;
  if (f.distributionDetected) score -= 30;
  if (f.spikeDetected) score -= 30;
  if (lowLiquidity) score -= 20;

  return clamp(score, 0, 100);
}

export function confidenceFromScore(score: number): Confidence {
  if (score >= 75) return "high";
  if (score >= 55) return "medium";
  if (score >= 40) return "low";
  return "low";
}
