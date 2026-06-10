import type { Instrument } from "@screener/core";
import { readNdjsonDayText, utcDaysInWindow } from "@screener/storage";
import type { Candle, SeriesQualityFlags, Timeframe } from "../types.js";
import { type NdjsonRow, rowMatchesInstrument, rowToCandle } from "./ndjson-row.js";

export interface CandleSeriesStats {
  barCount: number;
  firstBarMs: number | null;
  lastBarMs: number | null;
}

/** Count bars and time bounds without building full Candle objects (cache fingerprint). */
export function loadCandleSeriesStats(
  dataRoot: string,
  inst: Instrument,
  interval: Timeframe,
  startMs: number,
  endMs: number,
): CandleSeriesStats {
  const days = utcDaysInWindow(startMs, endMs);
  const times = new Set<number>();

  for (const day of days) {
    const text = readNdjsonDayText(dataRoot, inst, interval, day);
    if (text == null) continue;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row: NdjsonRow;
      try {
        row = JSON.parse(trimmed) as NdjsonRow;
      } catch {
        continue;
      }
      if (!rowMatchesInstrument(row, inst)) continue;
      const openTimeMs = Number(row.open_time_ms);
      if (!Number.isFinite(openTimeMs)) continue;
      if (openTimeMs < startMs || openTimeMs >= endMs) continue;
      times.add(openTimeMs);
    }
  }

  if (times.size === 0) {
    return { barCount: 0, firstBarMs: null, lastBarMs: null };
  }

  let firstBarMs: number | null = null;
  let lastBarMs: number | null = null;
  for (const t of times) {
    if (firstBarMs == null || t < firstBarMs) firstBarMs = t;
    if (lastBarMs == null || t > lastBarMs) lastBarMs = t;
  }

  return { barCount: times.size, firstBarMs, lastBarMs };
}

export function loadCandleSeries(
  dataRoot: string,
  inst: Instrument,
  interval: Timeframe,
  startMs: number,
  endMs: number,
): { candles: Candle[]; quality: SeriesQualityFlags } {
  const days = utcDaysInWindow(startMs, endMs);
  const byTime = new Map<number, Candle>();
  let duplicateBars = 0;

  for (const day of days) {
    const text = readNdjsonDayText(dataRoot, inst, interval, day);
    if (text == null) continue;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row: NdjsonRow;
      try {
        row = JSON.parse(trimmed) as NdjsonRow;
      } catch {
        continue;
      }
      if (!rowMatchesInstrument(row, inst)) continue;
      const candle = rowToCandle(row, inst);
      if (!candle) continue;
      if (candle.openTimeMs < startMs || candle.openTimeMs >= endMs) continue;
      if (byTime.has(candle.openTimeMs)) {
        duplicateBars += 1;
        continue;
      }
      byTime.set(candle.openTimeMs, candle);
    }
  }

  const candles = [...byTime.values()].sort((a, b) => a.openTimeMs - b.openTimeMs);
  const intervalMs = interval === "1m" ? 60_000 : 300_000;
  let gaps = 0;
  for (let i = 1; i < candles.length; i++) {
    const delta = candles[i]!.openTimeMs - candles[i - 1]!.openTimeMs;
    if (delta > intervalMs * 1.5) gaps += 1;
  }

  const reasons: string[] = [];
  if (candles.length === 0) reasons.push("No candles in window");
  if (duplicateBars > 0) reasons.push(`${duplicateBars} duplicate bars dropped`);
  if (gaps > 0) reasons.push(`${gaps} timestamp gaps`);

  const badData = candles.length === 0 || gaps > candles.length * 0.1;

  return {
    candles,
    quality: { badData, duplicateBars, gaps, reasons },
  };
}
