import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  isFallbackSeriesOnDisk,
  readLatestOpenTimeMs,
  requiredLastOpenMsForSlice,
  resumeFallbackStartMs,
  utcDaysInWindow,
} from "./paths.js";

describe("paths", () => {
  it("lists utc days in window", () => {
    const start = Date.parse("2026-05-25T00:00:00Z");
    const end = Date.parse("2026-05-28T00:00:00Z");
    expect(utcDaysInWindow(start, end)).toEqual(["2026-05-25", "2026-05-26", "2026-05-27"]);
  });

  it("includes same-day tail (REST fallback through today)", () => {
    const start = Date.parse("2026-06-06T00:00:00Z");
    const end = Date.parse("2026-06-06T09:55:33.844Z");
    expect(utcDaysInWindow(start, end)).toEqual(["2026-06-06"]);
  });

  it("includes last day when window ends mid-day", () => {
    const start = Date.parse("2026-06-05T12:00:00Z");
    const end = Date.parse("2026-06-06T09:55:33.844Z");
    expect(utcDaysInWindow(start, end)).toEqual(["2026-06-05", "2026-06-06"]);
  });

  it("detects fallback ndjson present", () => {
    const base = mkdtempSync(join(tmpdir(), "fb-"));
    try {
      const inst = {
        exchange: "bybit",
        instrumentType: "spot",
        symbolNative: "BTCUSDT",
        symbolCanonical: "BTC/USDT",
        base: "BTC",
        quote: "USDT",
        metadata: {},
      };
      const start = Date.parse("2026-05-25T00:00:00Z");
      const end = Date.parse("2026-05-27T00:00:00Z");
      for (const day of ["2026-05-25", "2026-05-26"]) {
        const path = join(
          base,
          "raw",
          "exchange=bybit",
          "instrument_type=spot",
          "interval=1m",
          `date=${day}`,
          "data.ndjson",
        );
        mkdirSync(dirname(path), { recursive: true });
        const dayEnd = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
        const lastOpen = requiredLastOpenMsForSlice(dayEnd, 60_000);
        writeFileSync(path, `${JSON.stringify({ open_time_ms: lastOpen })}\n`, "utf-8");
      }
      expect(isFallbackSeriesOnDisk(base, inst, "1m", start, end)).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("rejects stale same-day tail when last candle is too old", () => {
    const base = mkdtempSync(join(tmpdir(), "fb-"));
    try {
      const inst = {
        exchange: "binance",
        instrumentType: "linear_perp",
        symbolNative: "BTCUSDT",
        symbolCanonical: "BTC/USDT",
        base: "BTC",
        quote: "USDT",
        metadata: {},
      };
      const start = Date.parse("2026-06-06T00:00:00Z");
      const end = Date.parse("2026-06-06T09:55:33.844Z");
      const path = join(
        base,
        "raw",
        "exchange=binance",
        "instrument_type=linear_perp",
        "interval=1m",
        "date=2026-06-06",
        "data.ndjson",
      );
      mkdirSync(dirname(path), { recursive: true });
      const staleOpen = Date.parse("2026-06-06T08:00:00Z");
      writeFileSync(path, `${JSON.stringify({ open_time_ms: staleOpen })}\n`, "utf-8");
      expect(isFallbackSeriesOnDisk(base, inst, "1m", start, end)).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("accepts same-day tail when last candle reaches slice end", () => {
    const base = mkdtempSync(join(tmpdir(), "fb-"));
    try {
      const inst = {
        exchange: "bybit",
        instrumentType: "linear_perp",
        symbolNative: "BTCUSDT",
        symbolCanonical: "BTC/USDT",
        base: "BTC",
        quote: "USDT",
        metadata: {},
      };
      const start = Date.parse("2026-06-06T00:00:00Z");
      const end = Date.parse("2026-06-06T09:55:33.844Z");
      const path = join(
        base,
        "raw",
        "exchange=bybit",
        "instrument_type=linear_perp",
        "interval=1m",
        "date=2026-06-06",
        "data.ndjson",
      );
      mkdirSync(dirname(path), { recursive: true });
      const freshOpen = requiredLastOpenMsForSlice(end, 60_000);
      writeFileSync(path, `${JSON.stringify({ open_time_ms: freshOpen })}\n`, "utf-8");
      expect(isFallbackSeriesOnDisk(base, inst, "1m", start, end)).toBe(true);
      expect(readLatestOpenTimeMs(path)).toBe(freshOpen);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("uses max open_time_ms when file rows are not chronological", () => {
    const base = mkdtempSync(join(tmpdir(), "fb-"));
    try {
      const inst = {
        exchange: "bybit",
        instrumentType: "linear_perp",
        symbolNative: "BTCUSDT",
        symbolCanonical: "BTC/USDT",
        base: "BTC",
        quote: "USDT",
        metadata: {},
      };
      const dayEnd = Date.parse("2026-06-06T00:00:00Z");
      const required = requiredLastOpenMsForSlice(dayEnd, 60_000);
      const path = join(
        base,
        "raw",
        "exchange=bybit",
        "instrument_type=linear_perp",
        "interval=1m",
        "date=2026-06-05",
        "data.ndjson",
      );
      mkdirSync(dirname(path), { recursive: true });
      const newest = required;
      const oldest = Date.parse("2026-06-05T01:03:00Z");
      writeFileSync(
        path,
        `${JSON.stringify({ open_time_ms: newest })}\n${JSON.stringify({ open_time_ms: oldest })}\n`,
        "utf-8",
      );
      const start = Date.parse("2026-06-05T00:00:00Z");
      expect(readLatestOpenTimeMs(path)).toBe(newest);
      expect(isFallbackSeriesOnDisk(base, inst, "1m", start, dayEnd)).toBe(true);
      expect(resumeFallbackStartMs(base, inst, "1m", start, dayEnd)).toBe(dayEnd);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
