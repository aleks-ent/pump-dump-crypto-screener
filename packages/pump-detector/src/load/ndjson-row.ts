import type { Instrument } from "@screener/core";
import type { Candle } from "../types.js";

export interface NdjsonRow {
  exchange?: string;
  instrument_type?: string;
  symbol_native?: string;
  interval?: string;
  open_time_ms?: number;
  open?: string | number | null;
  high?: string | number | null;
  low?: string | number | null;
  close?: string | number | null;
  volume?: string | number | null;
  quote_volume?: string | number | null;
}

function parseNum(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function isValidOhlcv(
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): boolean {
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume <= 0) return false;
  if (high < low) return false;
  return true;
}

export function rowToCandle(row: NdjsonRow, inst: Instrument): Candle | null {
  const open = parseNum(row.open);
  const high = parseNum(row.high);
  const low = parseNum(row.low);
  const close = parseNum(row.close);
  const volume = parseNum(row.volume);
  if (open == null || high == null || low == null || close == null || volume == null) {
    return null;
  }
  if (!isValidOhlcv(open, high, low, close, volume)) return null;

  const openTimeMs = Number(row.open_time_ms);
  if (!Number.isFinite(openTimeMs)) return null;

  const interval = row.interval === "1m" || row.interval === "5m" ? row.interval : null;
  if (!interval) return null;

  const quoteRaw = parseNum(row.quote_volume);
  const quoteVolume = quoteRaw != null && quoteRaw > 0 ? quoteRaw : volume * close;

  const base = inst.base ?? "";
  const quote = inst.quote ?? "";

  return {
    openTimeMs,
    exchange: String(row.exchange ?? inst.exchange),
    instrumentType: String(row.instrument_type ?? inst.instrumentType),
    symbolNative: String(row.symbol_native ?? inst.symbolNative),
    symbolCanonical: inst.symbolCanonical,
    base,
    quote,
    interval,
    open,
    high,
    low,
    close,
    volume,
    quoteVolume,
  };
}
