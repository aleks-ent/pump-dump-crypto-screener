import type { FeatureSnapshot, PumpPhase } from "../types.js";

export function classifyPhase(
  f: FeatureSnapshot,
  score: number,
  badData: boolean,
  lowLiquidity: boolean,
): PumpPhase {
  if (badData) return "ignore";

  if (f.spikeDetected) return "spike";
  if (f.distributionDetected && f.minPumpDurationMet) return "distribution_or_fade";
  if (f.latePumpDetected && f.minPumpDurationMet) return "late_pump";

  if (f.activePumpConditionsMet && f.minPumpDurationMet && score >= 55) return "active_pump";
  if (f.activationConditionsMet && f.minPumpDurationMet && score >= 40) return "activation";

  if (lowLiquidity && score < 40) return "ignore";
  if (score < 40) return "ignore";

  return "ignore";
}
