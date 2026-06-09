import { MIN_PUMP_DURATION_BARS } from "../features/evaluate.js";
import type { PumpCandidate, PumpPhase } from "../types.js";

const PUMP_RUN_PHASES = new Set<PumpPhase>([
  "activation",
  "active_pump",
  "late_pump",
  "spike",
]);

const DUMP_RUN_PHASES = new Set<PumpPhase>(["distribution_or_fade"]);

export interface IndexedPumpHit {
  barIndex: number;
  candidate: PumpCandidate;
}

function filterConsecutiveRuns(
  hits: IndexedPumpHit[],
  minBars: number,
): PumpCandidate[] {
  if (hits.length === 0) return [];

  const sorted = [...hits].sort((a, b) => a.barIndex - b.barIndex);
  const kept: PumpCandidate[] = [];
  let runStart = 0;

  for (let i = 1; i <= sorted.length; i++) {
    const runBreaks =
      i === sorted.length || sorted[i]!.barIndex !== sorted[i - 1]!.barIndex + 1;

    if (!runBreaks) continue;

    const runEnd = i;
    if (runEnd - runStart >= minBars) {
      for (let j = runStart; j < runEnd; j++) {
        kept.push(sorted[j]!.candidate);
      }
    }
    runStart = i;
  }

  return kept;
}

/**
 * Keep pump- and dump-phase hits only when each belongs to a run of at least
 * `minBars` consecutive 5m bar indices (default 3 = 15 minutes).
 */
export function filterPumpCandidatesByMinConsecutiveBars(
  hits: IndexedPumpHit[],
  minBars: number = MIN_PUMP_DURATION_BARS,
): PumpCandidate[] {
  const pumpHits = hits.filter((h) => PUMP_RUN_PHASES.has(h.candidate.phase));
  const dumpHits = hits.filter((h) => DUMP_RUN_PHASES.has(h.candidate.phase));

  return [
    ...filterConsecutiveRuns(pumpHits, minBars),
    ...filterConsecutiveRuns(dumpHits, minBars),
  ];
}
