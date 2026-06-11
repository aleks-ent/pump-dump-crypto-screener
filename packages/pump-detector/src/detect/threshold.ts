import type { PumpCandidate, PumpPhase } from "../types.js";

const DUMP_PHASE: PumpPhase = "distribution_or_fade";

/** Minimum 6×5m price rise for pump-phase hits (filters weak grinds). */
export const MIN_PUMP_PRICE_CHANGE_LAST_6 = 0.03;

/** At or above this pump minScore, activation-phase hits are not reported. */
export const ACTIVATION_SUPPRESSED_MIN_PUMP_SCORE = 80;

const PUMP_QUALITY_PHASES = new Set<PumpPhase>([
  "activation",
  "active_pump",
  "late_pump",
  "spike",
]);

export function minScoreForPhase(
  phase: PumpPhase,
  minPumpScore: number,
  minDumpScore: number,
): number {
  return phase === DUMP_PHASE ? minDumpScore : minPumpScore;
}

export function candidateMeetsMinScore(
  candidate: Pick<PumpCandidate, "phase" | "score">,
  minPumpScore: number,
  minDumpScore: number,
): boolean {
  return candidate.score >= minScoreForPhase(candidate.phase, minPumpScore, minDumpScore);
}

export function phaseMeetsMinScore(
  phase: PumpPhase,
  score: number,
  minPumpScore: number,
  minDumpScore: number,
): boolean {
  return score >= minScoreForPhase(phase, minPumpScore, minDumpScore);
}

export function pumpPhaseMeetsQualityGates(
  phase: PumpPhase,
  priceChangeLast6: number,
  minPumpScore: number,
): boolean {
  if (!PUMP_QUALITY_PHASES.has(phase)) return true;
  if (phase === "activation" && minPumpScore >= ACTIVATION_SUPPRESSED_MIN_PUMP_SCORE) {
    return false;
  }
  return priceChangeLast6 >= MIN_PUMP_PRICE_CHANGE_LAST_6;
}

export function candidateMeetsPumpQualityGates(
  candidate: Pick<PumpCandidate, "phase" | "metrics">,
  minPumpScore: number,
): boolean {
  return pumpPhaseMeetsQualityGates(
    candidate.phase,
    candidate.metrics.priceChangeLast6Candles,
    minPumpScore,
  );
}

export function candidateIsReportable(
  candidate: PumpCandidate,
  minPumpScore: number,
  minDumpScore: number,
): boolean {
  if (!candidateMeetsMinScore(candidate, minPumpScore, minDumpScore)) return false;
  if (candidate.phase === DUMP_PHASE) return true;
  return candidateMeetsPumpQualityGates(candidate, minPumpScore);
}
