import { describe, expect, it } from "vitest";
import { buildTradingViewChartUrl, tradingViewSymbol } from "./tradingview.js";

describe("tradingViewSymbol", () => {
  it("maps binance linear perp", () => {
    expect(
      tradingViewSymbol({
        exchange: "binance",
        symbolNative: "SUSHIUSDT",
        instrumentType: "linear_perp",
      }),
    ).toBe("BINANCE:SUSHIUSDT.P");
  });

  it("maps binance spot without .P suffix", () => {
    expect(
      tradingViewSymbol({
        exchange: "binance",
        symbolNative: "SUSHIUSDT",
        instrumentType: "spot",
      }),
    ).toBe("BINANCE:SUSHIUSDT");
  });

  it("maps bybit linear perp", () => {
    expect(
      tradingViewSymbol({
        exchange: "bybit",
        symbolNative: "BTCUSDT",
        instrumentType: "linear_perp",
      }),
    ).toBe("BYBIT:BTCUSDT.P");
  });
});

describe("buildTradingViewChartUrl", () => {
  it("includes symbol and 5m interval", () => {
    expect(
      buildTradingViewChartUrl({
        exchange: "binance",
        symbolNative: "SUSHIUSDT",
        instrumentType: "linear_perp",
        timeframe: "5m",
      }),
    ).toBe("https://www.tradingview.com/chart/?symbol=BINANCE%3ASUSHIUSDT.P&interval=5");
  });
});
