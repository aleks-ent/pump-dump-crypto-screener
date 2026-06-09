import type { Candle, Timeframe } from "../types.js";
import { SlidingWindowMedian, safeDiv } from "./math.js";

const BASELINE_WINDOW: Record<Timeframe, number> = {
  "5m": 288,
  "1m": 1440,
};

export interface ComputedSeries {
  candles: Candle[];
  bodyPct: number[];
  rangePct: number[];
  changePct: number[];
  isGreen: boolean[];
  closePosition: number[];
  quoteVolume: number[];
  volumeBaseline: (number | null)[];
  rangeBaseline: (number | null)[];
  bodyBaseline: (number | null)[];
  volumeRatio: (number | null)[];
  rangeRatio: (number | null)[];
  bodyRatio: (number | null)[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  atr: (number | null)[];
  medianQuoteVolume24h: number[];
  eligible: boolean[];
}

function computeEma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i]! * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function computeAtr(candles: Candle[], period: number): (number | null)[] {
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = i > 0 ? candles[i - 1]!.close : c.open;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (tr.length < period) return out;
  let sum = tr.slice(0, period).reduce((a, b) => a + b, 0);
  out[period - 1] = sum / period;
  for (let i = period; i < tr.length; i++) {
    sum = sum - tr[i - period]! + tr[i]!;
    out[i] = sum / period;
  }
  return out;
}

export function computeSeries(candles: Candle[], interval: Timeframe): ComputedSeries {
  const n = candles.length;
  const bodyPct: number[] = [];
  const rangePct: number[] = [];
  const changePct: number[] = [];
  const isGreen: boolean[] = [];
  const closePosition: number[] = [];
  const quoteVolume: number[] = [];

  for (const c of candles) {
    bodyPct.push((Math.abs(c.close - c.open) / c.open) * 100);
    rangePct.push(((c.high - c.low) / c.open) * 100);
    changePct.push(((c.close - c.open) / c.open) * 100);
    isGreen.push(c.close > c.open);
    const range = c.high - c.low;
    closePosition.push(range === 0 ? 0.5 : (c.close - c.low) / range);
    quoteVolume.push(c.quoteVolume);
  }

  const window = BASELINE_WINDOW[interval];
  const volumeBaseline: (number | null)[] = new Array(n).fill(null);
  const rangeBaseline: (number | null)[] = new Array(n).fill(null);
  const bodyBaseline: (number | null)[] = new Array(n).fill(null);
  const volumeRatio: (number | null)[] = new Array(n).fill(null);
  const rangeRatio: (number | null)[] = new Array(n).fill(null);
  const bodyRatio: (number | null)[] = new Array(n).fill(null);
  const eligible: boolean[] = new Array(n).fill(false);
  const medianQuoteVolume24h: number[] = new Array(n).fill(0);

  const volWin = new SlidingWindowMedian(window);
  const rangeWin = new SlidingWindowMedian(window);
  const bodyWin = new SlidingWindowMedian(window);
  const qvWin = new SlidingWindowMedian(window);

  for (let i = 0; i < n; i++) {
    if (i >= window) {
      const vb = volWin.median();
      const rb = rangeWin.median();
      const bb = bodyWin.median();
      const mqv = qvWin.median();

      volumeBaseline[i] = vb;
      rangeBaseline[i] = rb;
      bodyBaseline[i] = bb;
      medianQuoteVolume24h[i] = mqv ?? 0;

      if (vb != null && vb > 0) volumeRatio[i] = candles[i]!.volume / vb;
      if (rb != null && rb > 0) rangeRatio[i] = rangePct[i]! / rb;
      if (bb != null && bb > 0) bodyRatio[i] = bodyPct[i]! / bb;

      eligible[i] =
        volumeRatio[i] != null && rangeRatio[i] != null && bodyRatio[i] != null;
    }

    volWin.push(candles[i]!.volume);
    rangeWin.push(rangePct[i]!);
    bodyWin.push(bodyPct[i]!);
    qvWin.push(quoteVolume[i]!);
  }

  const closes = candles.map((c) => c.close);
  const ema20 = computeEma(closes, 20);
  const ema50 = computeEma(closes, 50);
  const atr = computeAtr(candles, interval === "5m" ? 288 : 1440);

  return {
    candles,
    bodyPct,
    rangePct,
    changePct,
    isGreen,
    closePosition,
    quoteVolume,
    volumeBaseline,
    rangeBaseline,
    bodyBaseline,
    volumeRatio,
    rangeRatio,
    bodyRatio,
    ema20,
    ema50,
    atr,
    medianQuoteVolume24h,
    eligible,
  };
}

export function priceChange(series: ComputedSeries, i: number, lookback: number): number {
  const j = i - lookback;
  if (j < 0) return 0;
  const prev = series.candles[j]!.close;
  const now = series.candles[i]!.close;
  return safeDiv(now - prev, prev) ?? 0;
}

export function ema20Slope(series: ComputedSeries, i: number, lookback: number): number | null {
  const now = series.ema20[i];
  const prev = series.ema20[i - lookback];
  if (now == null || prev == null) return null;
  return now - prev;
}

export function countInWindow<T>(
  arr: T[],
  i: number,
  window: number,
  pred: (v: T, idx: number) => boolean,
): number {
  let count = 0;
  for (let j = Math.max(0, i - window + 1); j <= i; j++) {
    if (pred(arr[j]!, j)) count += 1;
  }
  return count;
}
