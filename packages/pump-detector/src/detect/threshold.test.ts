import { describe, expect, it } from "vitest";
import {
  candidateMeetsMinScore,
  minScoreForPhase,
  phaseMeetsMinScore,
} from "./threshold.js";

describe("dump score thresholds", () => {
  it("uses minDumpScore for distribution_or_fade", () => {
    expect(minScoreForPhase("distribution_or_fade", 80, 55)).toBe(55);
    expect(minScoreForPhase("active_pump", 80, 55)).toBe(80);
  });

  it("allows dump hits below pump minScore", () => {
    expect(
      candidateMeetsMinScore(
        { phase: "distribution_or_fade", score: 60 },
        80,
        55,
      ),
    ).toBe(true);
    expect(
      candidateMeetsMinScore({ phase: "active_pump", score: 60 }, 80, 55),
    ).toBe(false);
  });

  it("phaseMeetsMinScore mirrors candidate helper", () => {
    expect(phaseMeetsMinScore("distribution_or_fade", 54, 80, 55)).toBe(false);
    expect(phaseMeetsMinScore("distribution_or_fade", 55, 80, 55)).toBe(true);
  });
});
