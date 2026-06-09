import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { ArchiveFile } from "@screener/core";
import {
  archiveCoverageEndMs,
  archiveCoverageStartMs,
  computeTailStartMs,
  planFallbackRanges,
} from "./coverage.js";
import { archiveFilePath } from "./exists.js";

describe("archiveCoverageEndMs", () => {
  it("Binance daily label ends at next UTC midnight", () => {
    const end = archiveCoverageEndMs({
      url: "u",
      relPath: "x",
      label: "2026-05-25",
    });
    expect(end).toBe(Date.parse("2026-05-26T00:00:00Z"));
  });

  it("Bybit monthly range ends at end date + 1 day UTC", () => {
    const end = archiveCoverageEndMs({
      url: "u",
      relPath: "x",
      label: "2026-04-01_2026-04-30",
    });
    expect(end).toBe(Date.parse("2026-05-01T00:00:00Z"));
  });

  it("date= path label ends at next UTC midnight", () => {
    const end = archiveCoverageEndMs({
      url: "u",
      relPath: "exchange=binance/interval=1m/symbol=BTCUSDT/date=2026-05-20/file.zip",
      label: "2026-05-20",
    });
    expect(end).toBe(Date.parse("2026-05-21T00:00:00Z"));
  });
});

describe("archiveCoverageStartMs", () => {
  it("reads daily label", () => {
    expect(
      archiveCoverageStartMs({ url: "u", relPath: "x", label: "2026-05-25" }),
    ).toBe(Date.parse("2026-05-25T00:00:00Z"));
  });

  it("reads monthly range label", () => {
    expect(
      archiveCoverageStartMs({
        url: "u",
        relPath: "x",
        label: "2026-04-01_2026-04-30",
      }),
    ).toBe(Date.parse("2026-04-01T00:00:00Z"));
  });
});

describe("computeTailStartMs", () => {
  it("starts REST tail after last on-disk archive", () => {
    const dir = mkdtempSync(join(tmpdir(), "tail-"));
    try {
      const a: ArchiveFile = {
        url: "u1",
        relPath:
          "exchange=binance/instrument_type=spot/interval=1m/symbol=BTCUSDT/date=2026-05-25/a.zip",
        label: "2026-05-25",
      };
      const b: ArchiveFile = {
        url: "u2",
        relPath:
          "exchange=binance/instrument_type=spot/interval=1m/symbol=BTCUSDT/date=2026-05-26/a.zip",
        label: "2026-05-26",
      };
      const path = archiveFilePath(dir, b);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "zip", "utf-8");

      const startMs = Date.parse("2026-05-25T00:00:00Z");
      expect(computeTailStartMs([a, b], dir, startMs)).toBe(
        Date.parse("2026-05-27T00:00:00Z"),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("planFallbackRanges", () => {
  it("fills missing archive days and today tail without overlap", () => {
    const dir = mkdtempSync(join(tmpdir(), "fallback-"));
    try {
      const day3: ArchiveFile = {
        url: "u3",
        relPath:
          "exchange=binance/instrument_type=spot/interval=1m/symbol=BTCUSDT/date=2026-06-03/a.zip",
        label: "2026-06-03",
      };
      const day4: ArchiveFile = {
        url: "u4",
        relPath:
          "exchange=binance/instrument_type=spot/interval=1m/symbol=BTCUSDT/date=2026-06-04/a.zip",
        label: "2026-06-04",
      };
      const day5: ArchiveFile = {
        url: "u5",
        relPath:
          "exchange=binance/instrument_type=spot/interval=1m/symbol=BTCUSDT/date=2026-06-05/a.zip",
        label: "2026-06-05",
      };
      const path4 = archiveFilePath(dir, day4);
      mkdirSync(dirname(path4), { recursive: true });
      writeFileSync(path4, "zip", "utf-8");

      const startMs = Date.parse("2026-06-02T00:00:00Z");
      const endMs = Date.parse("2026-06-06T15:00:00Z");
      const ranges = planFallbackRanges([day3, day4, day5], dir, startMs, endMs);

      expect(ranges).toEqual([
        [Date.parse("2026-06-03T00:00:00Z"), Date.parse("2026-06-04T00:00:00Z")],
        [Date.parse("2026-06-05T00:00:00Z"), Date.parse("2026-06-06T00:00:00Z")],
        [Date.parse("2026-06-06T00:00:00Z"), Date.parse("2026-06-06T15:00:00Z")],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns only tail when all archives are present", () => {
    const dir = mkdtempSync(join(tmpdir(), "fallback-"));
    try {
      const day5: ArchiveFile = {
        url: "u5",
        relPath:
          "exchange=binance/instrument_type=spot/interval=1m/symbol=BTCUSDT/date=2026-06-05/a.zip",
        label: "2026-06-05",
      };
      const path5 = archiveFilePath(dir, day5);
      mkdirSync(dirname(path5), { recursive: true });
      writeFileSync(path5, "zip", "utf-8");

      const startMs = Date.parse("2026-06-02T00:00:00Z");
      const endMs = Date.parse("2026-06-06T15:00:00Z");
      const ranges = planFallbackRanges([day5], dir, startMs, endMs);

      expect(ranges).toEqual([
        [Date.parse("2026-06-06T00:00:00Z"), Date.parse("2026-06-06T15:00:00Z")],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
