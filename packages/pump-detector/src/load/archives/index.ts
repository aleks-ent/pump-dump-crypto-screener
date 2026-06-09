import type { Instrument } from "@screener/core";
import type { Candle, Timeframe } from "../../types.js";
import { loadBinanceArchives } from "./binance.js";
import { loadBybitArchives } from "./bybit.js";

export function loadExchangeArchives(
  archivesDir: string,
  inst: Instrument,
  interval: Timeframe,
  startMs: number,
  endMs: number,
): { candles: Candle[]; paths: string[] } {
  switch (inst.exchange) {
    case "binance":
      return loadBinanceArchives(archivesDir, inst, interval, startMs, endMs);
    case "bybit":
      return loadBybitArchives(archivesDir, inst, interval, startMs, endMs);
    default:
      return { candles: [], paths: [] };
  }
}
