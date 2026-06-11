import { describe, expect, it } from "vitest";
import type { PumpCandidate } from "../types.js";
import {
  candidateIsReportable,
  candidateMeetsMinScore,
  candidateMeetsPumpQualityGates,
  minScoreForPhase,
  phaseMeetsMinScore,
  pumpPhaseMeetsQualityGates,
} from "./threshold.js";

function pumpCandidate(
  overrides: Partial<PumpCandidate> & Pick<PumpCandidate, "phase" | "score">,
): PumpCandidate {
  return {
    timestamp: 0,
    baseAsset: "BTC",
    quoteAsset: "USDT",
    symbol: "BTCUSDT",
    exchange: "binance",
    timeframe: "5m",
    confidence: "high",
    leadingExchange: "binance",
    confirmed: true,
    confirmedExchanges: ["binance"],
    peersAvailable: 0,
    coverage: [],
    metrics: {
      volumeRatio: 5,
      rangeRatio: 3,
      bodyRatio: 1,
      priceChangeLast3Candles: 0.05,
      priceChangeLast6Candles: 0.05,
      priceChangeLast12Candles: 0.05,
      greenCountLast4: 4,
      greenCountLast6: 5,
      strongGreenCountLast5: 3,
      currentPullback: 0.1,
      confirmedExchanges: 1,
      medianQuoteVolume24h: 100_000,
      closePosition: 0.9,
      ema20: 1,
      ema50: 1,
      ema20Slope: 0.01,
    },
    reasons: [],
    ...overrides,
  };
}

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

describe("pump quality gates", () => {
  it("suppresses activation when minPumpScore is at alert threshold", () => {
    expect(
      pumpPhaseMeetsQualityGates("activation", 0.05, 80),
    ).toBe(false);
    expect(
      pumpPhaseMeetsQualityGates("activation", 0.05, 79),
    ).toBe(true);
    expect(
      pumpPhaseMeetsQualityGates("active_pump", 0.05, 80),
    ).toBe(true);
  });

  it("requires at least 3% move over 6 candles for pump phases", () => {
    expect(pumpPhaseMeetsQualityGates("active_pump", 0.028, 80)).toBe(false);
    expect(pumpPhaseMeetsQualityGates("active_pump", 0.03, 80)).toBe(true);
    expect(pumpPhaseMeetsQualityGates("distribution_or_fade", 0.01, 80)).toBe(
      true,
    );
  });

  it("candidateIsReportable combines score and quality gates", () => {
    const weakGrind = pumpCandidate({
      phase: "active_pump",
      score: 100,
      metrics: {
        ...pumpCandidate({ phase: "active_pump", score: 100 }).metrics,
        priceChangeLast6Candles: 0.028,
      },
    });
    expect(candidateIsReportable(weakGrind, 80, 55)).toBe(false);

    const activationAlert = pumpCandidate({ phase: "activation", score: 90 });
    expect(candidateIsReportable(activationAlert, 80, 55)).toBe(false);

    const dump = pumpCandidate({
      phase: "distribution_or_fade",
      score: 55,
      metrics: {
        ...pumpCandidate({ phase: "distribution_or_fade", score: 55 }).metrics,
        priceChangeLast6Candles: -0.05,
      },
    });
    expect(candidateIsReportable(dump, 80, 55)).toBe(true);
    expect(candidateMeetsPumpQualityGates(dump, 80)).toBe(true);
  });
});
