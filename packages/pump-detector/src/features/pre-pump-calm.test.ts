import { describe, expect, it } from "vitest";
import { computeSeries } from "../metrics/series-state.js";
import type { Candle } from "../types.js";
import {
  evaluatePrePumpCalm,
  MAX_PRE_PUMP_CANDLE_RANGE_RATIO,
  MAX_PRE_PUMP_MEDIAN_RANGE_RATIO,
  MAX_PRE_PUMP_MEDIAN_VOLUME_RATIO,
  MAX_PRE_PUMP_PATH_PCT,
  MAX_PRE_PUMP_RANGE_PCT,
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

type PrePumpMode =
  | "calm"
  | "trend"
  | "moderately-oscillating"
  | "oscillating"
  | "moderate-range"
  | "single-range-spike"
  | "wide"
  | "moderate-volume"
  | "high-volume";

function seriesWithPrePumpWindow(mode: PrePumpMode) {
  const candles: Candle[] = [];
  let previousClose = 100;

  for (let i = 0; i < 288; i++) {
    const close = i % 2 === 0 ? 100.02 : 100;
    candles.push(candle(i, previousClose, close, 0.2, 1_000));
    previousClose = close;
  }

  for (let i = 0; i < PRE_PUMP_CALM_WINDOW_BARS; i++) {
    let close = previousClose * 1.00005;
    if (mode === "moderately-oscillating") close = i % 2 === 0 ? 100.2 : 99.8;
    if (mode === "oscillating") close = i % 2 === 0 ? 100.45 : 99.55;
    if (mode === "trend") close = previousClose * 1.0015;

    let wickPct = 0.03;
    if (mode === "wide") wickPct = 1.6;
    if (mode === "moderate-range") wickPct = 0.27;
    if (mode === "single-range-spike" && i === 12) wickPct = 0.5;

    let volume = 500;
    if (mode === "moderate-volume") volume = 1_400;
    if (mode === "high-volume") volume = 2_000;

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

  it("accepts a two-hour envelope between the previous and relaxed limits", () => {
    const { series, impulseStartIndex } = seriesWithPrePumpWindow("trend");
    const result = evaluatePrePumpCalm(series, impulseStartIndex);

    expect(result.rangePct).toBeGreaterThan(3);
    expect(result.rangePct).toBeLessThanOrEqual(MAX_PRE_PUMP_RANGE_PCT);
    expect(result.calm).toBe(true);
  });

  it("accepts moderate oscillation between the previous and relaxed path limits", () => {
    const { series, impulseStartIndex } = seriesWithPrePumpWindow("moderately-oscillating");
    const result = evaluatePrePumpCalm(series, impulseStartIndex);

    expect(result.pathPct).toBeGreaterThan(6);
    expect(result.pathPct).toBeLessThanOrEqual(MAX_PRE_PUMP_PATH_PCT);
    expect(result.calm).toBe(true);
  });

  it("accepts a typical range between the previous and relaxed relative limits", () => {
    const { series, impulseStartIndex } = seriesWithPrePumpWindow("moderate-range");
    const result = evaluatePrePumpCalm(series, impulseStartIndex);

    expect(result.medianRangeRatio).toBeGreaterThan(1.25);
    expect(result.medianRangeRatio).toBeLessThanOrEqual(MAX_PRE_PUMP_MEDIAN_RANGE_RATIO);
    expect(result.calm).toBe(true);
  });

  it("accepts one candle between the previous and relaxed maximum range limits", () => {
    const { series, impulseStartIndex } = seriesWithPrePumpWindow("single-range-spike");
    const result = evaluatePrePumpCalm(series, impulseStartIndex);

    expect(result.maxRangeRatio).toBeGreaterThanOrEqual(2);
    expect(result.maxRangeRatio).toBeLessThan(MAX_PRE_PUMP_CANDLE_RANGE_RATIO);
    expect(result.calm).toBe(true);
  });

  it("accepts median volume between the previous and relaxed relative limits", () => {
    const { series, impulseStartIndex } = seriesWithPrePumpWindow("moderate-volume");
    const result = evaluatePrePumpCalm(series, impulseStartIndex);

    expect(result.medianVolumeRatio).toBeGreaterThan(1.2);
    expect(result.medianVolumeRatio).toBeLessThanOrEqual(MAX_PRE_PUMP_MEDIAN_VOLUME_RATIO);
    expect(result.calm).toBe(true);
  });

  it("rejects a narrow-looking window whose closes oscillate beyond the relaxed limit", () => {
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
