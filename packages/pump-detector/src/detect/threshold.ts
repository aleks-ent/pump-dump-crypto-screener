import type { PumpCandidate, PumpPhase } from "../types.js";

const DUMP_PHASE: PumpPhase = "distribution_or_fade";

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
