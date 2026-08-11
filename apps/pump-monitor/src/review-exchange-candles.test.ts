import type { CandleRecord, HttpClient, Instrument, PageResult } from "@screener/core";
import type { ExchangeAdapter } from "@screener/exchanges";
import { describe, expect, it, vi } from "vitest";
import { fetchReviewExchangeCandles } from "./review-exchange-candles.js";

const instrument: Instrument = {
  exchange: "bybit",
  instrumentType: "linear_perp",
  symbolNative: "BTCUSDT",
  symbolCanonical: "BTC/USDT",
  base: "BTC",
  quote: "USDT",
  metadata: {},
};

function record(openTimeMs: number, overrides: Partial<CandleRecord> = {}): CandleRecord {
  return {
    exchange: "bybit",
    instrumentType: "linear_perp",
    symbolNative: "BTCUSDT",
    interval: "5m",
    openTimeMs,
    closeTimeMs: openTimeMs + 299_999,
    openPrice: "100",
    highPrice: "110",
    lowPrice: "95",
    closePrice: "105",
    volume: "12.5",
    quoteVolume: "1300",
    tradeCount: null,
    rawPayload: null,
    ...overrides,
  };
}

function adapter(pages: PageResult[]): ExchangeAdapter {
  let page = 0;
  return {
    name: "bybit",
    intervals: new Set(["1m", "5m"]),
    pageLimit: 1000,
    discoverInstruments: vi.fn(async () => []),
    initialCursor: vi.fn(() => ({ page: 0 })),
    fetchCandlesPage: vi.fn(async () => pages[page++]!),
  };
}

describe("fetchReviewExchangeCandles", () => {
  it("normalizes, bounds, deduplicates, and orders exchange candles", async () => {
    const fromMs = 1_000_000;
    const toMs = fromMs + 900_000;
    const exchange = adapter([
      {
        records: [
          record(fromMs + 300_000, { closePrice: "106" }),
          record(fromMs - 300_000),
          record(fromMs, { quoteVolume: null }),
        ],
        nextCursor: { page: 1 },
        requestMeta: {},
      },
      {
        records: [
          record(fromMs + 300_000, { closePrice: "107" }),
          record(fromMs + 600_000, { highPrice: null }),
        ],
        nextCursor: null,
        requestMeta: {},
      },
    ]);

    const result = await fetchReviewExchangeCandles(
      { instrument, interval: "5m", fromMs, toMs },
      {
        client: {} as HttpClient,
        adapters: { bybit: exchange },
      },
    );

    expect(exchange.initialCursor).toHaveBeenCalledWith(fromMs, toMs - 1);
    expect(result).toEqual([
      {
        time: Math.floor(fromMs / 1_000),
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 12.5,
        quoteVolume: 0,
      },
      expect.objectContaining({
        time: Math.floor((fromMs + 300_000) / 1_000),
        close: 107,
      }),
    ]);
    expect(exchange.fetchCandlesPage).toHaveBeenCalledTimes(2);
  });

  it("rejects unsupported exchanges and runaway pagination", async () => {
    await expect(
      fetchReviewExchangeCandles(
        { instrument: { ...instrument, exchange: "kraken" }, interval: "5m", fromMs: 1, toMs: 2 },
        { adapters: {} },
      ),
    ).rejects.toThrow("No exchange adapter");

    const exchange = adapter([
      { records: [], nextCursor: { page: 1 }, requestMeta: {} },
    ]);
    await expect(
      fetchReviewExchangeCandles(
        { instrument, interval: "5m", fromMs: 1, toMs: 2 },
        { client: {} as HttpClient, adapters: { bybit: exchange }, maxPages: 1 },
      ),
    ).rejects.toThrow("pagination exceeded");
  });
});
