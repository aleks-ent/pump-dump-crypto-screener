import { describe, expect, it } from "vitest";
import { computeSeries } from "../metrics/series-state.js";
import type { Candle } from "../types.js";
import {
  evaluatePrePumpCalm,
  MAX_PRE_PUMP_PATH_PCT,
  PRE_PUMP_CALM_WINDOW_BARS,
} from "./pre-pump-calm.js";

function candle(
  index: number,
  open: number,
  close: number,
  wickPct: number,
  volume: number,
): Candle {
  const wick = wickPct / 100;
  return {
    openTimeMs: index * 300_000,
    exchange: "binance",
    instrumentType: "linear_perp",
    symbolNative: "TESTUSDT",
    symbolCanonical: "TEST/USDT",
    base: "TEST",
    quote: "USDT",
    interval: "5m",
    open,
    high: Math.max(open, close) * (1 + wick),
    low: Math.min(open, close) * (1 - wick),
    close,
    volume,
    quoteVolume: volume * close,
  };
}

function seriesWithPrePumpWindow(mode: "calm" | "oscillating" | "wide" | "high-volume") {
  const candles: Candle[] = [];
  let previousClose = 100;

  for (let i = 0; i < 288; i++) {
    const close = i % 2 === 0 ? 100.02 : 100;
    candles.push(candle(i, previousClose, close, 0.2, 1_000));
    previousClose = close;
  }

  for (let i = 0; i < PRE_PUMP_CALM_WINDOW_BARS; i++) {
    const close =
      mode === "oscillating"
        ? i % 2 === 0
          ? 100.2
          : 99.8
        : previousClose * 1.00005;
    const wickPct = mode === "wide" ? 1.6 : 0.03;
    const volume = mode === "high-volume" ? 2_000 : 500;
    candles.push(candle(candles.length, previousClose, close, wickPct, volume));
    previousClose = close;
  }

  const impulseStartIndex = candles.length;
  candles.push(candle(impulseStartIndex, previousClose, previousClose * 1.05, 0.2, 10_000));
  return { series: computeSeries(candles, "5m"), impulseStartIndex };
}

describe("evaluatePrePumpCalm", () => {
  it("accepts a compressed, low-volume two-hour string before the impulse", () => {
    const { series, impulseStartIndex } = seriesWithPrePumpWindow("calm");
    const result = evaluatePrePumpCalm(series, impulseStartIndex);

    expect(result.calm).toBe(true);
    expect(result.rangePct).toBeLessThan(1);
    expect(result.pathPct).toBeLessThan(1);
    expect(result.medianRangeRatio).toBeLessThan(1);
    expect(result.medianVolumeRatio).toBeLessThan(1);
  });

  it("rejects a narrow-looking window whose closes repeatedly oscillate", () => {
    const { series, impulseStartIndex } = seriesWithPrePumpWindow("oscillating");
    const result = evaluatePrePumpCalm(series, impulseStartIndex);

    expect(result.rangePct).toBeLessThan(1);
    expect(result.pathPct).toBeGreaterThan(MAX_PRE_PUMP_PATH_PCT);
    expect(result.calm).toBe(false);
  });

  it("rejects a wide or already-active pre-pump window", () => {
    const wide = seriesWithPrePumpWindow("wide");
    const highVolume = seriesWithPrePumpWindow("high-volume");

    expect(evaluatePrePumpCalm(wide.series, wide.impulseStartIndex).calm).toBe(false);
    expect(
      evaluatePrePumpCalm(highVolume.series, highVolume.impulseStartIndex).calm,
    ).toBe(false);
  });

  it("fails closed when there is not enough pre-impulse history", () => {
    const { series } = seriesWithPrePumpWindow("calm");
    expect(evaluatePrePumpCalm(series, PRE_PUMP_CALM_WINDOW_BARS - 1)).toEqual({
      calm: false,
      rangePct: null,
      pathPct: null,
      medianRangeRatio: null,
      maxRangeRatio: null,
      medianVolumeRatio: null,
    });
  });
});
