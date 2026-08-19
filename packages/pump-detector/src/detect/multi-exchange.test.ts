import { describe, expect, it } from "vitest";
import { computeSeries, type ComputedSeries } from "../metrics/series-state.js";
import type { Candle } from "../types.js";
import {
  findCandleIndexNear,
  listConfirmedExchangeNames,
} from "./multi-exchange.js";

const FIVE_MIN_MS = 300_000;
const PEER_TOLERANCE_MS = 3 * FIVE_MIN_MS;
const LEADER_INDEX = 6;
const LEADER_TIME_MS = LEADER_INDEX * FIVE_MIN_MS;

function candle(openTimeMs: number, exchange = "binance", close = 100): Candle {
  return {
    openTimeMs,
    exchange,
    instrumentType: "linear_perp",
    symbolNative: "TESTUSDT",
    symbolCanonical: "TEST/USDT",
    base: "TEST",
    quote: "USDT",
    interval: "5m",
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
    quoteVolume: close * 1_000,
  };
}

function seriesWithMove(
  exchange: string,
  move: number,
  volumeRatio: number | null = 2,
  finalTimeMs = LEADER_TIME_MS,
  eligible = true,
): ComputedSeries {
  const candles = Array.from({ length: LEADER_INDEX + 1 }, (_, index) =>
    candle(finalTimeMs - (LEADER_INDEX - index) * FIVE_MIN_MS, exchange),
  );
  candles[LEADER_INDEX] = candle(finalTimeMs, exchange, 100 * (1 + move));

  const series = computeSeries(candles, "5m");
  series.eligible[LEADER_INDEX] = eligible;
  series.volumeRatio[LEADER_INDEX] = volumeRatio;
  return series;
}

function seriesWithIsolatedFinalCandle(
  exchange: string,
  move: number,
  finalTimeMs: number,
): ComputedSeries {
  const series = seriesWithMove(exchange, move, 2, finalTimeMs);
  for (let index = 0; index < LEADER_INDEX; index++) {
    series.candles[index]!.openTimeMs =
      LEADER_TIME_MS - PEER_TOLERANCE_MS - (LEADER_INDEX - index) * FIVE_MIN_MS;
  }
  return series;
}

describe("findCandleIndexNear", () => {
  const targetMs = 10 * FIVE_MIN_MS;

  it("returns the nearest candle within the tolerance", () => {
    const candles = [
      candle(targetMs - 2 * FIVE_MIN_MS),
      candle(targetMs + FIVE_MIN_MS),
      candle(targetMs),
    ];

    expect(findCandleIndexNear(candles, targetMs, PEER_TOLERANCE_MS)).toBe(2);
  });

  it("includes candles exactly at either tolerance boundary", () => {
    const candles = [
      candle(targetMs - PEER_TOLERANCE_MS),
      candle(targetMs + PEER_TOLERANCE_MS),
    ];

    expect(findCandleIndexNear(candles, targetMs, PEER_TOLERANCE_MS)).toBe(0);
  });

  it("excludes candles beyond the tolerance and handles an empty series", () => {
    const candles = [candle(targetMs + PEER_TOLERANCE_MS + 1)];

    expect(findCandleIndexNear(candles, targetMs, PEER_TOLERANCE_MS)).toBeNull();
    expect(findCandleIndexNear([], targetMs, PEER_TOLERANCE_MS)).toBeNull();
  });
});

describe("listConfirmedExchangeNames", () => {
  const leader = seriesWithMove("binance", 0.1);

  it("confirms an eligible peer that clears the move and volume thresholds", () => {
    const peers = new Map([
      ["bybit", seriesWithMove("bybit", 0.061, 2)],
    ]);

    expect(listConfirmedExchangeNames(leader, LEADER_INDEX, peers, "binance")).toEqual([
      "binance",
      "bybit",
    ]);
  });

  it("treats the move and volume thresholds as inclusive", () => {
    const doublingLeader = seriesWithMove("binance", 1);
    const peers = new Map([
      ["bybit", seriesWithMove("bybit", 0.6, 2)],
    ]);

    expect(
      listConfirmedExchangeNames(
        doublingLeader,
        LEADER_INDEX,
        peers,
        "binance",
      ),
    ).toEqual(["binance", "bybit"]);
  });

  it("rejects peers below the 60% leader-move threshold", () => {
    const peers = new Map([
      ["bybit", seriesWithMove("bybit", 0.059, 2)],
    ]);

    expect(listConfirmedExchangeNames(leader, LEADER_INDEX, peers, "binance")).toEqual([
      "binance",
    ]);
  });

  it("rejects peers below the 2x volume-ratio threshold", () => {
    const peers = new Map([
      ["bybit", seriesWithMove("bybit", 0.061, 1.99)],
    ]);

    expect(listConfirmedExchangeNames(leader, LEADER_INDEX, peers, "binance")).toEqual([
      "binance",
    ]);
  });

  it("rejects peers without a positive move", () => {
    const peers = new Map([
      ["bybit", seriesWithMove("bybit", -0.01, 3)],
    ]);

    expect(listConfirmedExchangeNames(leader, LEADER_INDEX, peers, "binance")).toEqual([
      "binance",
    ]);
  });

  it("accepts a peer exactly at the time tolerance and rejects one just beyond it", () => {
    const peers = new Map([
      [
        "bybit",
        seriesWithIsolatedFinalCandle(
          "bybit",
          0.061,
          LEADER_TIME_MS + PEER_TOLERANCE_MS,
        ),
      ],
      [
        "kraken",
        seriesWithIsolatedFinalCandle(
          "kraken",
          0.061,
          LEADER_TIME_MS + PEER_TOLERANCE_MS + 1,
        ),
      ],
    ]);

    expect(listConfirmedExchangeNames(leader, LEADER_INDEX, peers, "binance")).toEqual([
      "binance",
      "bybit",
    ]);
  });

  it("skips the leader entry, ineligible peers, and peers with no volume ratio", () => {
    const peers = new Map([
      ["binance", seriesWithMove("binance", 0.2, 10)],
      ["bybit", seriesWithMove("bybit", 0.061, 2, LEADER_TIME_MS, false)],
      ["kraken", seriesWithMove("kraken", 0.061, null)],
    ]);

    expect(listConfirmedExchangeNames(leader, LEADER_INDEX, peers, "binance")).toEqual([
      "binance",
    ]);
  });

  it.each([0, -0.01])(
    "short-circuits when the leader move is %s",
    (leaderMove) => {
      const nonRisingLeader = seriesWithMove("binance", leaderMove);
      const peers = new Map([
        ["bybit", seriesWithMove("bybit", 0.2, 10)],
      ]);

      expect(
        listConfirmedExchangeNames(
          nonRisingLeader,
          LEADER_INDEX,
          peers,
          "binance",
        ),
      ).toEqual(["binance"]);
    },
  );
});
