import { describe, expect, it } from "vitest";
import { planArchives } from "./binance.js";

describe("binance archives", () => {
  it("builds daily url", () => {
    const inst = {
      exchange: "binance",
      instrumentType: "linear_perp",
      symbolNative: "BTCUSDT",
      symbolCanonical: "BTC/USDT",
      base: "BTC",
      quote: "USDT",
      metadata: {},
    };
    const files = planArchives(inst, "1m", Date.parse("2026-04-30T00:00:00Z"), Date.parse("2026-05-02T00:00:00Z"));
    expect(files).toHaveLength(2);
    expect(files[0]!.url).toContain("BTCUSDT-1m-2026-04-30.zip");
  });
});
