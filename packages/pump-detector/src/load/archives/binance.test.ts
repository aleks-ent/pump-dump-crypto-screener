import { describe, expect, it } from "vitest";
import type { Instrument } from "@screener/core";
import { parseBinanceKlineCsv } from "./binance.js";

const inst: Instrument = {
  exchange: "binance",
  instrumentType: "spot",
  symbolNative: "BTCUSDT",
  symbolCanonical: "BTC/USDT",
  base: "BTC",
  quote: "USDT",
  metadata: {},
};

describe("parseBinanceKlineCsv", () => {
  it("parses kline rows", () => {
    const csv = [
      "1735689600000,100,110,99,105,1000,1735693199999,105000,10,0,0,0",
      "1735693200000,105,115,104,112,2000,1735696799999,224000,20,0,0,0",
    ].join("\n");
    const candles = parseBinanceKlineCsv(csv, inst, "5m");
    expect(candles).toHaveLength(2);
    expect(candles[0]!.close).toBe(105);
    expect(candles[0]!.quoteVolume).toBe(105000);
  });
});
