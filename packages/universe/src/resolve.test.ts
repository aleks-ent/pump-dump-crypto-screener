import { describe, expect, it } from "vitest";
import type { Instrument } from "@screener/core";
import type { ExchangeAdapter } from "@screener/exchanges";
import {
  buildInstrumentIndex,
  filterTasksBySymbols,
  resolveSeriesTasks,
} from "./resolve.js";
import type { UniverseEntry } from "./resolve.js";

const mockAdapter = (): ExchangeAdapter => ({
  name: "binance",
  intervals: new Set(["1m", "5m"]),
  pageLimit: 1000,
  discoverInstruments: async () => [],
  initialCursor: () => ({}),
  fetchCandlesPage: async () => ({
    records: [],
    nextCursor: null,
    requestMeta: {},
  }),
});

describe("resolve", () => {
  it("matches canonical to native", () => {
    const instruments: Instrument[] = [
      {
        exchange: "binance",
        instrumentType: "linear_perp",
        symbolNative: "BTCUSDT",
        symbolCanonical: "BTC/USDT",
        base: "BTC",
        quote: "USDT",
        metadata: {},
      },
    ];
    const index = buildInstrumentIndex(instruments);
    const universe: UniverseEntry[] = [
      {
        marketCategory: "futures",
        instrumentType: "linear_perp",
        symbolCanonical: "BTC/USDT",
        base: "BTC",
        quote: "USDT",
        listedOn: ["binance"],
      },
    ];
    const { tasks, warnings } = resolveSeriesTasks(universe, index, {
      exchanges: new Set(["binance"]),
      intervals: ["1m", "5m"],
      adapters: { binance: mockAdapter() },
    });
    expect(tasks).toHaveLength(2);
    expect(warnings).toHaveLength(0);
    expect(filterTasksBySymbols(tasks, ["BTC/USDT"])).toHaveLength(2);
    expect(filterTasksBySymbols(tasks, ["ETHUSDT"])).toHaveLength(0);
  });

  it("only builds tasks for configured intervals", () => {
    const instruments: Instrument[] = [
      {
        exchange: "binance",
        instrumentType: "linear_perp",
        symbolNative: "BTCUSDT",
        symbolCanonical: "BTC/USDT",
        base: "BTC",
        quote: "USDT",
        metadata: {},
      },
    ];
    const index = buildInstrumentIndex(instruments);
    const universe: UniverseEntry[] = [
      {
        marketCategory: "futures",
        instrumentType: "linear_perp",
        symbolCanonical: "BTC/USDT",
        base: "BTC",
        quote: "USDT",
        listedOn: ["binance"],
      },
    ];
    const { tasks } = resolveSeriesTasks(universe, index, {
      exchanges: new Set(["binance"]),
      intervals: ["5m"],
      adapters: { binance: mockAdapter() },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.interval).toBe("5m");
  });
});
