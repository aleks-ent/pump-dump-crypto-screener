import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { CandleRecord } from "@screener/core";
import { SeriesQuality, writeNormalizedRecords, writeRawRecords } from "./market-storage.js";

function sampleRecord(openTimeMs: number): CandleRecord {
  return {
    exchange: "binance",
    instrumentType: "linear_perp",
    symbolNative: "BTCUSDT",
    interval: "1m",
    openTimeMs,
    closeTimeMs: openTimeMs + 59_999,
    openPrice: "1",
    highPrice: "2",
    lowPrice: "0.5",
    closePrice: "1.5",
    volume: "10",
    quoteVolume: "15",
    tradeCount: 3,
    rawPayload: [openTimeMs, "1", "2", "0.5", "1.5", "10"],
  };
}

describe("market-storage", () => {
  it("writes raw and normalized records", () => {
    const base = mkdtempSync(join(tmpdir(), "screener-"));
    try {
      const records = [sampleRecord(1_700_000_000_000), sampleRecord(1_700_000_060_000)];
      const raw = writeRawRecords(base, records, { endpoint: "/klines" });
      const norm = writeNormalizedRecords(base, records);
      expect(raw).toBe(2);
      expect(norm).toBe(2);
      const rawPath = join(
        base,
        "raw/exchange=binance/instrument_type=linear_perp/interval=1m/date=2023-11-14/symbol=BTCUSDT/data.ndjson",
      );
      const content = readFileSync(rawPath, "utf-8");
      expect(content.split("\n").filter(Boolean).length).toBe(2);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("dedupes raw rows by instrument + open_time_ms on append", () => {
    const base = mkdtempSync(join(tmpdir(), "screener-"));
    try {
      const t1 = Date.parse("2026-06-06T10:00:00Z");
      const t2 = Date.parse("2026-06-06T10:01:00Z");
      const t3 = Date.parse("2026-06-06T10:02:00Z");
      expect(writeRawRecords(base, [sampleRecord(t1), sampleRecord(t2)], { endpoint: "/k" })).toBe(2);
      expect(
        writeRawRecords(base, [sampleRecord(t2), sampleRecord(t3)], { endpoint: "/k" }),
      ).toBe(1);
      const rawPath = join(
        base,
        "raw/exchange=binance/instrument_type=linear_perp/interval=1m/date=2026-06-06/symbol=BTCUSDT/data.ndjson",
      );
      const lines = readFileSync(rawPath, "utf-8").trimEnd().split("\n");
      expect(lines).toHaveLength(3);
      const times = lines.map((l) => (JSON.parse(l) as { open_time_ms: number }).open_time_ms);
      expect(times).toEqual([t1, t2, t3]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("writes separate files per symbol", () => {
    const base = mkdtempSync(join(tmpdir(), "screener-"));
    try {
      const t = Date.parse("2026-06-10T10:00:00Z");
      const btc = sampleRecord(t);
      const eth: CandleRecord = { ...sampleRecord(t), symbolNative: "ETHUSDT" };
      expect(writeRawRecords(base, [btc], { endpoint: "/k" })).toBe(1);
      expect(writeRawRecords(base, [eth], { endpoint: "/k" })).toBe(1);
      const btcPath = join(
        base,
        "raw/exchange=binance/instrument_type=linear_perp/interval=1m/date=2026-06-10/symbol=BTCUSDT/data.ndjson",
      );
      const ethPath = join(
        base,
        "raw/exchange=binance/instrument_type=linear_perp/interval=1m/date=2026-06-10/symbol=ETHUSDT/data.ndjson",
      );
      expect(readFileSync(btcPath, "utf-8").trimEnd().split("\n")).toHaveLength(1);
      expect(readFileSync(ethPath, "utf-8").trimEnd().split("\n")).toHaveLength(1);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("detects gap and duplicate", () => {
    const q = new SeriesQuality("binance", "linear_perp", "BTCUSDT", "1m");
    const start = 0;
    const end = 300_000;
    q.observe([sampleRecord(0), sampleRecord(60_000), sampleRecord(60_000), sampleRecord(180_000)], start, end);
    const report = q.toReport();
    expect(report.duplicate_bars).toBe(1);
    expect(report.gaps).toBeGreaterThan(0);
  });
});
