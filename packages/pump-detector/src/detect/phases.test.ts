import { describe, expect, it } from "vitest";
import type { FeatureSnapshot } from "../types.js";
import { classifyPhase } from "./phases.js";

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

describe("classifyPhase", () => {
  it("ignores activation when pump duration is under 15 minutes", () => {
    const phase = classifyPhase(
      baseFeatures({
        activationConditionsMet: true,
        sustainedActivationBars: 2,
        minPumpDurationMet: false,
      }),
      60,
      false,
      false,
    );
    expect(phase).toBe("ignore");
  });

  it("classifies activation when sustained for at least 15 minutes", () => {
    const phase = classifyPhase(
      baseFeatures({
        activationConditionsMet: true,
        sustainedActivationBars: 3,
        minPumpDurationMet: true,
      }),
      60,
      false,
      false,
    );
    expect(phase).toBe("activation");
  });

  it("ignores active_pump when duration threshold is not met", () => {
    const phase = classifyPhase(
      baseFeatures({
        activePumpConditionsMet: true,
        minPumpDurationMet: false,
      }),
      70,
      false,
      false,
    );
    expect(phase).toBe("ignore");
  });

  it("still classifies spike without duration requirement", () => {
    const phase = classifyPhase(
      baseFeatures({
        spikeDetected: true,
        minPumpDurationMet: false,
      }),
      80,
      false,
      false,
    );
    expect(phase).toBe("spike");
  });

  it("ignores distribution when sustained regime is under 15 minutes", () => {
    const phase = classifyPhase(
      baseFeatures({
        distributionDetected: true,
        minPumpDurationMet: false,
      }),
      50,
      false,
      false,
    );
    expect(phase).toBe("ignore");
  });

  it("classifies distribution when sustained for at least 15 minutes", () => {
    const phase = classifyPhase(
      baseFeatures({
        distributionDetected: true,
        minPumpDurationMet: true,
      }),
      50,
      false,
      false,
    );
    expect(phase).toBe("distribution_or_fade");
  });
});
