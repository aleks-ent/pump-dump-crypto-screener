import { describe, expect, it } from "vitest";
import { groupEventsIntoEpisodes } from "./episodes.js";
import type { PumpCandidate } from "./types.js";

function event(
  base: string,
  ts: number,
  phase: PumpCandidate["phase"],
  score = 50,
): PumpCandidate {
  return {
    timestamp: ts,
    baseAsset: base,
    quoteAsset: "USDT",
    symbol: `${base}USDT`,
    exchange: "binance",
    timeframe: "5m",
    phase,
    score,
    confidence: "medium",
    leadingExchange: "binance",
    confirmed: false,
    confirmedExchanges: ["binance"],
    peersAvailable: 0,
    coverage: [],
    metrics: {
      volumeRatio: 1,
      rangeRatio: 1,
      bodyRatio: 1,
      priceChangeLast3Candles: 0,
      priceChangeLast6Candles: 0,
      priceChangeLast12Candles: 0,
      greenCountLast4: 0,
      greenCountLast6: 0,
      strongGreenCountLast5: 0,
      currentPullback: null,
      confirmedExchanges: 1,
      medianQuoteVolume24h: 0,
      closePosition: 0,
      ema20: null,
      ema50: null,
      ema20Slope: null,
    },
    reasons: [],
  };
}

describe("groupEventsIntoEpisodes", () => {
  it("merges consecutive pump bars into one episode", () => {
    const t0 = 1_000_000;
    const episodes = groupEventsIntoEpisodes([
      event("BTC", t0, "activation", 40),
      event("BTC", t0 + 300_000, "activation", 45),
      event("BTC", t0 + 600_000, "active_pump", 70),
    ]);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]!.type).toBe("pump");
    expect(episodes[0]!.peakScore).toBe(70);
    expect(episodes[0]!.eventCount).toBe(3);
    expect(episodes[0]!.tradingViewUrl).toContain("BINANCE%3ABTCUSDT.P");
    expect(episodes[0]!.tradingViewUrl).toContain("interval=5");
  });

  it("splits on large time gap", () => {
    const t0 = 1_000_000;
    const episodes = groupEventsIntoEpisodes([
      event("BTC", t0, "activation", 40),
      event("BTC", t0 + 3_600_000, "activation", 55),
    ]);
    expect(episodes).toHaveLength(2);
  });

  it("splits pump and dump phases", () => {
    const t0 = 1_000_000;
    const episodes = groupEventsIntoEpisodes([
      event("BTC", t0, "active_pump", 60),
      event("BTC", t0 + 300_000, "distribution_or_fade", 50),
    ]);
    expect(episodes).toHaveLength(2);
    expect(episodes.map((e) => e.type).sort()).toEqual(["dump", "pump"]);
  });
});
