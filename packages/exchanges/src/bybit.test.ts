import { describe, expect, it } from "vitest";
import type { HttpClient, Instrument } from "@screener/core";
import { BybitAdapter } from "./bybit.js";

const BTC_SPOT: Instrument = {
  exchange: "bybit",
  instrumentType: "spot",
  symbolNative: "BTCUSDT",
  symbolCanonical: "BTC/USDT",
  base: "BTC",
  quote: "USDT",
  metadata: {},
};

function lastBarOpenInRange(start: number, end: number, intervalMs: number): number {
  return Math.floor((end - 1) / intervalMs) * intervalMs;
}

/** Mimics Bybit: newest-first klines for bar open times in [start, end). */
function mockBybitKlineClient(intervalMs: number): HttpClient {
  return {
    getJson: async (_url, params) => {
      const start = Number(params.start);
      const end = Number(params.end);
      const limit = Number(params.limit ?? 1000);
      const list: Array<Array<number>> = [];
      for (
        let t = lastBarOpenInRange(start, end, intervalMs);
        t >= start && list.length < limit;
        t -= intervalMs
      ) {
        list.push([t, 1, 1, 1, 1, 1]);
      }
      return { result: { list } };
    },
  } as HttpClient;
}

async function fetchAllOpenTimes(
  adapter: BybitAdapter,
  client: HttpClient,
  inst: Instrument,
  interval: string,
  startMs: number,
  endMs: number,
): Promise<number[]> {
  const times: number[] = [];
  let cursor: Record<string, unknown> | null = adapter.initialCursor(startMs, endMs);
  while (cursor) {
    const page = await adapter.fetchCandlesPage(client, inst, interval, cursor);
    for (const rec of page.records) times.push(rec.openTimeMs);
    cursor = page.nextCursor;
  }
  return times.sort((a, b) => a - b);
}

describe("BybitAdapter discoverInstruments", () => {
  it("keeps only Trading symbols", async () => {
    const adapter = new BybitAdapter();
    const client = {
      getJson: async () => ({
        result: {
          list: [
            {
              symbol: "BTCUSDT",
              baseCoin: "BTC",
              quoteCoin: "USDT",
              status: "Trading",
            },
            {
              symbol: "DEADUSDT",
              baseCoin: "DEAD",
              quoteCoin: "USDT",
              status: "Closed",
            },
          ],
        },
      }),
    } as HttpClient;

    const instruments = await adapter.discoverInstruments(client, new Set(["spot"]));

    expect(instruments).toHaveLength(1);
    expect(instruments[0]!.symbolNative).toBe("BTCUSDT");
  });
});

describe("BybitAdapter kline pagination", () => {
  it("pages backward when window exceeds one API page", async () => {
    const adapter = new BybitAdapter();
    const intervalMs = 60_000;
    const startMs = Date.parse("2026-06-04T00:00:00Z");
    const endMs = startMs + 1500 * intervalMs;
    const client = mockBybitKlineClient(intervalMs);

    const requests: Array<{ start: number; end: number }> = [];
    const trackingClient = {
      getJson: async (_url: string, params: Record<string, unknown>) => {
        const start = Number(params.start);
        const end = Number(params.end);
        const limit = Number(params.limit ?? 1000);
        requests.push({ start, end });
        const list: Array<Array<number>> = [];
        for (
          let t = lastBarOpenInRange(start, end, intervalMs);
          t >= start && list.length < limit;
          t -= intervalMs
        ) {
          list.push([t, 1, 1, 1, 1, 1]);
        }
        return { result: { list } };
      },
    } as HttpClient;

    const times = await fetchAllOpenTimes(
      adapter,
      trackingClient,
      BTC_SPOT,
      "1m",
      startMs,
      endMs,
    );

    expect(times).toHaveLength(1500);
    expect(times[0]).toBe(startMs);
    expect(times[times.length - 1]).toBe(endMs - intervalMs);
    expect(requests.length).toBeGreaterThan(1);
    expect(requests[1]!.end).toBeLessThan(requests[0]!.end);
  });

  it("covers full window in a single page when it fits", async () => {
    const adapter = new BybitAdapter();
    const intervalMs = 60_000;
    const startMs = Date.parse("2026-06-04T10:00:00Z");
    const endMs = startMs + 120 * intervalMs;
    const times = await fetchAllOpenTimes(
      adapter,
      mockBybitKlineClient(intervalMs),
      BTC_SPOT,
      "1m",
      startMs,
      endMs,
    );

    expect(times).toHaveLength(120);
    expect(times[0]).toBe(startMs);
    expect(times[119]).toBe(endMs - intervalMs);
  });
});
