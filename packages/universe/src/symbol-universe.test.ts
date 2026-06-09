import { describe, expect, it } from "vitest";
import type { Instrument } from "@screener/core";
import {
  applyUniverseFilters,
  filterUniverseByQuote,
  buildSymbolUniverse,
  filterByQuoteCurrencies,
} from "./symbol-universe.js";

const inst = (overrides: Partial<Instrument>): Instrument => ({
  exchange: "binance",
  instrumentType: "spot",
  symbolNative: "BTCUSDT",
  symbolCanonical: "BTC/USDT",
  base: "BTC",
  quote: "USDT",
  metadata: {},
  ...overrides,
});

describe("symbol-universe", () => {
  it("unions exchanges", () => {
    const instruments = [
      inst({ exchange: "binance" }),
      inst({ exchange: "bybit" }),
    ];
    const universe = buildSymbolUniverse(instruments);
    expect(universe).toHaveLength(1);
    expect(universe[0]!.listed_on).toEqual(["binance", "bybit"]);
  });

  it("filters USDT only", () => {
    const instruments = [
      inst({}),
      inst({ symbolNative: "USDTKZT", symbolCanonical: "USDT/KZT", quote: "KZT" }),
      inst({
        exchange: "bybit",
        instrumentType: "linear_perp",
        symbolNative: "BTCUSDT",
      }),
    ];
    const filtered = filterByQuoteCurrencies(instruments, new Set(["USDT"]));
    expect(filtered).toHaveLength(2);
    expect(applyUniverseFilters(instruments, new Set(["USDT"]))).toHaveLength(2);
  });

  it("filters universe entries by quote", () => {
    const entries = [
      { quote: "USDT" as const, symbolCanonical: "BTC/USDT" },
      { quote: "EUR" as const, symbolCanonical: "BTC/EUR" },
    ];
    expect(filterUniverseByQuote(entries, new Set(["USDT"]))).toHaveLength(1);
  });
});
