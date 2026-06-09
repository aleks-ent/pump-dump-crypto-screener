import { describe, expect, it } from "vitest";
import type { HttpClient } from "@screener/core";
import { BinanceAdapter } from "./binance.js";

describe("BinanceAdapter discoverInstruments", () => {
  it("keeps only TRADING symbols", async () => {
    const adapter = new BinanceAdapter();
    const client = {
      getJson: async (url: string) => {
        if (url.includes("/api/v3/exchangeInfo")) {
          return {
            symbols: [
              {
                symbol: "BTCUSDT",
                baseAsset: "BTC",
                quoteAsset: "USDT",
                status: "TRADING",
              },
              {
                symbol: "1INCHDOWNUSDT",
                baseAsset: "1INCHDOWN",
                quoteAsset: "USDT",
                status: "BREAK",
              },
            ],
          };
        }
        return { symbols: [] };
      },
    } as HttpClient;

    const instruments = await adapter.discoverInstruments(client, new Set(["spot"]));

    expect(instruments).toHaveLength(1);
    expect(instruments[0]!.symbolNative).toBe("BTCUSDT");
  });
});
