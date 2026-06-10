import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Instrument } from "@screener/core";
import { rawNdjsonPath } from "@screener/storage";
import { loadCandleSeries, loadCandleSeriesStats } from "./ndjson-series.js";

const inst: Instrument = {
  exchange: "binance",
  instrumentType: "spot",
  symbolNative: "BTCUSDT",
  symbolCanonical: "BTC/USDT",
  base: "BTC",
  quote: "USDT",
  metadata: {},
};

function writeDay(root: string, day: string, rows: object[]): void {
  const path = rawNdjsonPath(root, inst, "5m", day);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
}

describe("loadCandleSeriesStats", () => {
  it("matches loadCandleSeries bar count and bounds", () => {
    const root = mkdtempSync(join(tmpdir(), "pump-stats-"));
    writeDay(root, "2026-06-01", [
      {
        exchange: "binance",
        instrument_type: "spot",
        symbol_native: "BTCUSDT",
        interval: "5m",
        open_time_ms: 1_700_000_000_000,
        open: "100",
        high: "110",
        low: "99",
        close: "105",
        volume: "1000",
        quote_volume: "105000",
      },
      {
        exchange: "binance",
        instrument_type: "spot",
        symbol_native: "BTCUSDT",
        interval: "5m",
        open_time_ms: 1_700_000_300_000,
        open: "105",
        high: "115",
        low: "104",
        close: "110",
        volume: "1200",
        quote_volume: "132000",
      },
    ]);

    const startMs = 1_700_000_000_000;
    const endMs = 1_700_086_400_000;
    const stats = loadCandleSeriesStats(root, inst, "5m", startMs, endMs);
    const full = loadCandleSeries(root, inst, "5m", startMs, endMs);

    expect(stats.barCount).toBe(full.candles.length);
    expect(stats.firstBarMs).toBe(full.candles[0]?.openTimeMs ?? null);
    expect(stats.lastBarMs).toBe(full.candles[full.candles.length - 1]?.openTimeMs ?? null);
  });

  it("ignores other symbols in multi-symbol day files", () => {
    const root = mkdtempSync(join(tmpdir(), "pump-stats-mix-"));
    const day = "2026-06-01";
    const openTimeMs = Date.parse(`${day}T12:00:00.000Z`);
    writeDay(root, day, [
      {
        exchange: "binance",
        instrument_type: "spot",
        symbol_native: "ETHUSDT",
        interval: "5m",
        open_time_ms: openTimeMs,
        open: "3000",
        high: "3100",
        low: "2900",
        close: "3050",
        volume: "1000",
        quote_volume: "3050000",
      },
      {
        exchange: "binance",
        instrument_type: "spot",
        symbol_native: "BTCUSDT",
        interval: "5m",
        open_time_ms: openTimeMs,
        open: "100",
        high: "110",
        low: "99",
        close: "105",
        volume: "1000",
        quote_volume: "105000",
      },
    ]);

    const startMs = Date.parse(`${day}T00:00:00.000Z`);
    const endMs = Date.parse(`${day}T23:59:59.999Z`) + 1;
    const stats = loadCandleSeriesStats(root, inst, "5m", startMs, endMs);
    const full = loadCandleSeries(root, inst, "5m", startMs, endMs);

    expect(stats.barCount).toBe(1);
    expect(full.candles.length).toBe(1);
    expect(full.candles[0]!.symbolNative).toBe("BTCUSDT");
  });
});
