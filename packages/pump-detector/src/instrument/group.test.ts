import { describe, expect, it } from "vitest";
import type { Instrument } from "@screener/core";
import {
  filterInstrumentGroupsBySymbols,
  instrumentGroupKey,
  type InstrumentGroup,
} from "./group.js";
import type { UniverseEntry } from "@screener/universe";

describe("instrumentGroupKey", () => {
  it("keys by instrument type and base quote", () => {
    const entry: UniverseEntry = {
      marketCategory: "spot",
      instrumentType: "spot",
      symbolCanonical: "BTC/USDT",
      base: "BTC",
      quote: "USDT",
      listedOn: ["binance", "bybit"],
    };
    expect(instrumentGroupKey(entry)).toBe("spot|BTC|USDT");
  });
});

describe("filterInstrumentGroupsBySymbols", () => {
  const btcInst: Instrument = {
    exchange: "binance",
    instrumentType: "linear_perp",
    symbolNative: "BTCUSDT",
    symbolCanonical: "BTC/USDT",
    base: "BTC",
    quote: "USDT",
    metadata: {},
  };

  const btcGroup: InstrumentGroup = {
    key: "linear_perp|BTC|USDT",
    entry: {
      marketCategory: "futures",
      instrumentType: "linear_perp",
      symbolCanonical: "BTC/USDT",
      base: "BTC",
      quote: "USDT",
      listedOn: ["binance", "bybit"],
    },
    instrumentsByExchange: new Map([["binance", btcInst]]),
  };

  const ethGroup: InstrumentGroup = {
    key: "linear_perp|ETH|USDT",
    entry: {
      marketCategory: "futures",
      instrumentType: "linear_perp",
      symbolCanonical: "ETH/USDT",
      base: "ETH",
      quote: "USDT",
      listedOn: ["binance"],
    },
    instrumentsByExchange: new Map([
      [
        "binance",
        {
          ...btcInst,
          symbolNative: "ETHUSDT",
          symbolCanonical: "ETH/USDT",
          base: "ETH",
        },
      ],
    ]),
  };

  it("returns all groups when no symbol filter is given", () => {
    expect(filterInstrumentGroupsBySymbols([btcGroup, ethGroup], [])).toHaveLength(2);
  });

  it("matches native and canonical symbol forms", () => {
    expect(filterInstrumentGroupsBySymbols([btcGroup, ethGroup], ["BTCUSDT"])).toEqual([
      btcGroup,
    ]);
    expect(filterInstrumentGroupsBySymbols([btcGroup, ethGroup], ["BTC/USDT"])).toEqual([
      btcGroup,
    ]);
    expect(filterInstrumentGroupsBySymbols([btcGroup, ethGroup], ["BTC"])).toEqual([btcGroup]);
  });
});
