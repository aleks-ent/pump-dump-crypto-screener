import { describe, expect, it } from "vitest";
import type { PumpCandidate } from "../types.js";
import { filterPumpCandidatesByMinConsecutiveBars } from "./run-length.js";

function candidate(phase: PumpCandidate["phase"], ts: number): PumpCandidate {
  return {
    timestamp: ts,
    baseAsset: "BTC",
    quoteAsset: "USDT",
    symbol: "BTCUSDT",
    exchange: "binance",
    timeframe: "5m",
    phase,
    score: 80,
    confidence: "high",
    leadingExchange: "binance",
    confirmed: false,
    confirmedExchanges: ["binance"],
    peersAvailable: 0,
    coverage: [],
    metrics: {
      volumeRatio: 5,
      rangeRatio: 3,
      bodyRatio: 2,
      priceChangeLast3Candles: 0.03,
      priceChangeLast6Candles: 0.05,
      priceChangeLast12Candles: 0.08,
      greenCountLast4: 4,
      greenCountLast6: 5,
      strongGreenCountLast5: 2,
      currentPullback: 0.1,
      confirmedExchanges: 1,
      medianQuoteVolume24h: 1_000_000,
      closePosition: 0.9,
      ema20: 100,
      ema50: 99,
      ema20Slope: 0.5,
    },
    reasons: [],
  };
}

describe("filterPumpCandidatesByMinConsecutiveBars", () => {
  it("drops pump hits when fewer than 3 consecutive bars qualify", () => {
    const hits = [0, 1].map((barIndex) => ({
      barIndex,
      candidate: candidate("activation", barIndex * 300_000),
    }));

    expect(filterPumpCandidatesByMinConsecutiveBars(hits, 3)).toEqual([]);
  });

  it("keeps pump hits in runs of at least 3 consecutive bars", () => {
    const hits = [10, 11, 12, 13, 14].map((barIndex) => ({
      barIndex,
      candidate: candidate("active_pump", barIndex * 300_000),
    }));

    const out = filterPumpCandidatesByMinConsecutiveBars(hits, 3);
    expect(out).toHaveLength(5);
  });

  it("splits runs on non-consecutive bar indices", () => {
    const short = [0, 1].map((barIndex) => ({
      barIndex,
      candidate: candidate("activation", barIndex * 300_000),
    }));
    const long = [10, 11, 12, 13].map((barIndex) => ({
      barIndex,
      candidate: candidate("activation", barIndex * 300_000),
    }));

    const out = filterPumpCandidatesByMinConsecutiveBars([...short, ...long], 3);
    expect(out).toHaveLength(4);
    expect(out.every((c) => c.timestamp >= 10 * 300_000)).toBe(true);
  });

  it("drops dump hits when fewer than 3 consecutive bars qualify", () => {
    const hits = [0, 1].map((barIndex) => ({
      barIndex,
      candidate: candidate("distribution_or_fade", barIndex * 300_000),
    }));

    expect(filterPumpCandidatesByMinConsecutiveBars(hits, 3)).toEqual([]);
  });

  it("keeps dump hits in runs of at least 3 consecutive bars", () => {
    const hits = [5, 6, 7, 8].map((barIndex) => ({
      barIndex,
      candidate: candidate("distribution_or_fade", barIndex * 300_000),
    }));

    expect(filterPumpCandidatesByMinConsecutiveBars(hits, 3)).toHaveLength(4);
  });
});
