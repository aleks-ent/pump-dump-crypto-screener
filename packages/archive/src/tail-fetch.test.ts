import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { isTailFreshOnDisk, tailWindowMs } from "./tail-fetch.js";
import { rawNdjsonPath } from "@screener/storage";

describe("tail-fetch", () => {
  it("tailWindowMs is partial UTC day through endMs", () => {
    const endMs = Date.parse("2026-06-10T11:22:14.703Z");
    const w = tailWindowMs(endMs)!;
    expect(w[0]).toBe(Date.parse("2026-06-10T00:00:00.000Z"));
    expect(w[1]).toBe(endMs);
  });

  it("isTailFreshOnDisk requires matching symbol rows", () => {
    const base = mkdtempSync(join(tmpdir(), "tail-"));
    try {
      const inst = {
        exchange: "binance",
        instrumentType: "linear_perp",
        symbolNative: "ETHUSDT",
        symbolCanonical: "ETH/USDT",
      };
      const endMs = Date.parse("2026-06-10T09:55:33.844Z");
      const btcInst = {
        exchange: "binance",
        instrumentType: "linear_perp",
        symbolNative: "BTCUSDT",
      };
      const path = rawNdjsonPath(base, btcInst, "5m", "2026-06-10");
      mkdirSync(dirname(path), { recursive: true });
      const required = Math.floor((endMs - 300_000) / 300_000) * 300_000;
      writeFileSync(
        path,
        `${JSON.stringify({
          exchange: "binance",
          instrument_type: "linear_perp",
          symbol_native: "BTCUSDT",
          open_time_ms: required,
        })}\n`,
        "utf-8",
      );
      expect(isTailFreshOnDisk(base, inst, "5m", endMs)).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
