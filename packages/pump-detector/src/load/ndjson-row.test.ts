import { describe, expect, it } from "vitest";
import type { Instrument } from "@screener/core";
import { isValidOhlcv, rowToCandle } from "./ndjson-row.js";

const inst: Instrument = {
  exchange: "binance",
  instrumentType: "spot",
  symbolNative: "BTCUSDT",
  symbolCanonical: "BTC/USDT",
  base: "BTC",
  quote: "USDT",
  metadata: {},
};

describe("rowToCandle", () => {
  it("parses valid NDJSON row", () => {
    const c = rowToCandle(
      {
        exchange: "binance",
        instrument_type: "spot",
        symbol_native: "BTCUSDT",
        interval: "5m",
        open_time_ms: 1_700_000_000_000,
        open: "100",
        high: "110",
        low: "99",
        close: "105",
        volume: "1000",
        quote_volume: "105000",
      },
      inst,
    );
    expect(c).not.toBeNull();
    expect(c!.close).toBe(105);
    expect(c!.quoteVolume).toBe(105000);
  });

  it("rejects invalid OHLCV", () => {
    expect(isValidOhlcv(0, 1, 1, 1, 1)).toBe(false);
    expect(
      rowToCandle(
        {
          interval: "5m",
          open_time_ms: 1,
          open: "0",
          high: "1",
          low: "1",
          close: "1",
          volume: "1",
        },
        inst,
      ),
    ).toBeNull();
  });
});
