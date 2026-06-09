import { describe, expect, it } from "vitest";
import { shardByIndex, uniqueSymbolsForExchange } from "./shard.js";
import type { SeriesTask } from "./resolve.js";

describe("shard", () => {
  it("shards symbols evenly", () => {
    const items = ["a", "b", "c", "d", "e"];
    expect(shardByIndex(items, 0, 2)).toEqual(["a", "c", "e"]);
    expect(shardByIndex(items, 1, 2)).toEqual(["b", "d"]);
  });

  it("collects unique symbols per exchange", () => {
    const tasks: SeriesTask[] = [
      {
        instrument: {
          exchange: "binance",
          instrumentType: "spot",
          symbolNative: "BTCUSDT",
          symbolCanonical: "BTC/USDT",
          base: "BTC",
          quote: "USDT",
          metadata: {},
        },
        interval: "1m",
      },
      {
        instrument: {
          exchange: "binance",
          instrumentType: "spot",
          symbolNative: "BTCUSDT",
          symbolCanonical: "BTC/USDT",
          base: "BTC",
          quote: "USDT",
          metadata: {},
        },
        interval: "5m",
      },
    ];
    expect(uniqueSymbolsForExchange(tasks, "binance")).toEqual(["BTCUSDT"]);
  });
});
