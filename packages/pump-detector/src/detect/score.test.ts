import { describe, expect, it } from "vitest";
import type { FeatureSnapshot } from "../types.js";
import { computeScore, confidenceFromScore } from "./score.js";

function baseFeatures(overrides: Partial<FeatureSnapshot> = {}): FeatureSnapshot {
  return {
    volumeRatio: 1,
    rangeRatio: 1,
    bodyRatio: 1,
    priceChangeLast3: 0,
    priceChangeLast6: 0,
    priceChangeLast12: 0,
    priceChangeOneCandle: 0,
    greenCountLast4: 0,
    greenCountLast6: 0,
    strongGreenCountLast5: 0,
    volumeActivationCluster: 0,
    volatilityExpansionCluster: 0,
    currentPullback: null,
    impulseStartIndex: null,
    breakoutFromLocalRange: false,
    strongBreakout: false,
    accumulationBeforePump: false,
    calmBeforePump: false,
    prePumpRangePct: null,
    prePumpPathPct: null,
    prePumpMedianRangeRatio: null,
    prePumpMaxRangeRatio: null,
    prePumpMedianVolumeRatio: null,
    maxConsecutiveRedLast6: 0,
    pullbacksAreBought: false,
    directionalImpulse: false,
    greenCluster: false,
    strongGreenCluster: false,
    noPullback: false,
    strongNoPullback: false,
    trendBasic: false,
    trendStrong: false,
    latePumpDetected: false,
    distributionDetected: false,
    spikeDetected: false,
    activationConditionsMet: false,
    activePumpConditionsMet: false,
    sustainedActivationBars: 0,
    minPumpDurationMet: false,
    medianQuoteVolume24h: 1_000_000,
    closePosition: 0.5,
    ema20: null,
    ema50: null,
    ema20Slope: null,
    eligible: true,
    ...overrides,
  };
}

describe("computeScore", () => {
  it("adds volume and direction points", () => {
    const score = computeScore(
      baseFeatures({
        volumeRatio: 6,
        rangeRatio: 2.5,
        priceChangeLast3: 0.03,
        priceChangeLast6: 0.05,
        greenCountLast4: 3,
        currentPullback: 0.15,
        trendBasic: true,
        breakoutFromLocalRange: true,
      }),
      2,
      false,
    );
    expect(score).toBeGreaterThanOrEqual(55);
  });

  it("applies spike penalty", () => {
    const rich = baseFeatures({
      volumeRatio: 6,
      rangeRatio: 2.5,
      priceChangeLast3: 0.03,
      greenCountLast4: 3,
      trendBasic: true,
    });
    const withSpike = computeScore({ ...rich, spikeDetected: true }, 1, false);
    const without = computeScore(rich, 1, false);
    expect(withSpike).toBeLessThan(without);
  });
});

describe("confidenceFromScore", () => {
  it("maps bands", () => {
    expect(confidenceFromScore(80)).toBe("high");
    expect(confidenceFromScore(60)).toBe("medium");
    expect(confidenceFromScore(45)).toBe("low");
  });
});
