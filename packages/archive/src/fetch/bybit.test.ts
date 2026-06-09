import { describe, expect, it } from "vitest";
import {
  planArchives,
  setBybitSkipPublicArchives,
  supportsArchives,
} from "./bybit.js";

describe("bybit archives", () => {
  it("builds monthly url", () => {
    const inst = {
      exchange: "bybit",
      instrumentType: "linear_perp",
      symbolNative: "BTCUSDT",
      symbolCanonical: "BTC/USDT",
      base: "BTC",
      quote: "USDT",
      metadata: {},
    };
    const files = planArchives(inst, "5m", Date.parse("2026-04-01T00:00:00Z"), Date.parse("2026-05-01T00:00:00Z"));
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]!.url).toContain("BTCUSDT_5_");
  });

  it("spot not supported", () => {
    const inst = {
      exchange: "bybit",
      instrumentType: "spot",
      symbolNative: "BTCUSDT",
      symbolCanonical: "BTC/USDT",
      base: "BTC",
      quote: "USDT",
      metadata: {},
    };
    expect(supportsArchives(inst)).toBe(false);
  });

  it("skips public archives when configured", () => {
    setBybitSkipPublicArchives(true);
    const inst = {
      exchange: "bybit",
      instrumentType: "linear_perp",
      symbolNative: "BTCUSDT",
      symbolCanonical: "BTC/USDT",
      base: "BTC",
      quote: "USDT",
      metadata: {},
    };
    expect(supportsArchives(inst)).toBe(false);
    setBybitSkipPublicArchives(false);
  });
});
