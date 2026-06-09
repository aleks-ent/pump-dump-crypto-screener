import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Instrument } from "@screener/core";
import {
  computeDiskDataSpan,
  gapTimeRanges,
  mergeTimeRanges,
  renderCoverageBar,
} from "./disk-span.js";

const inst = (overrides: Partial<Instrument> = {}): Instrument => ({
  exchange: "binance",
  instrumentType: "linear_perp",
  symbolNative: "BTCUSDT",
  symbolCanonical: "BTC/USDT",
  base: "BTC",
  quote: "USDT",
  metadata: {},
  ...overrides,
});

function writeNdjson(
  root: string,
  inst: Instrument,
  interval: string,
  day: string,
  openTimesMs: number[],
): void {
  const path = join(
    root,
    "raw",
    `exchange=${inst.exchange}`,
    `instrument_type=${inst.instrumentType}`,
    `interval=${interval}`,
    `date=${day}`,
    "data.ndjson",
  );
  mkdirSync(join(path, ".."), { recursive: true });
  const rows = openTimesMs.map((open_time_ms) =>
    JSON.stringify({
      exchange: inst.exchange,
      instrument_type: inst.instrumentType,
      symbol_native: inst.symbolNative,
      interval,
      open_time_ms,
      open: "1",
      high: "1",
      low: "1",
      close: "1",
      volume: "1",
    }),
  );
  writeFileSync(path, `${rows.join("\n")}\n`, "utf-8");
}

describe("computeDiskDataSpan", () => {
  it("reports zero coverage when no data exists", () => {
    const root = join(tmpdir(), `disk-span-empty-${Date.now()}`);
    const startMs = Date.parse("2026-06-01T00:00:00Z");
    const endMs = Date.parse("2026-06-02T00:00:00Z");
    const span = computeDiskDataSpan(inst(), "5m", {
      ndjsonRoots: [root],
      archivesDir: join(root, "archives"),
      fallbackDir: join(root, "api_fallback"),
      startMs,
      endMs,
    });
    expect(span.coveragePct).toBe(0);
    expect(span.presentDays).toBe(0);
    expect(span.barsPresent).toBe(0);
  });

  it("counts NDJSON bars in the window", () => {
    const root = join(tmpdir(), `disk-span-ndjson-${Date.now()}`);
    const startMs = Date.parse("2026-06-01T00:00:00Z");
    const endMs = Date.parse("2026-06-02T00:00:00Z");
    const bars = [startMs, startMs + 300_000, startMs + 600_000];
    writeNdjson(root, inst(), "5m", "2026-06-01", bars);

    const span = computeDiskDataSpan(inst(), "5m", {
      ndjsonRoots: [root],
      archivesDir: join(root, "archives"),
      fallbackDir: join(root, "api_fallback"),
      startMs,
      endMs,
    });

    expect(span.barsPresent).toBe(3);
    expect(span.coveragePct).toBeGreaterThan(0);
    expect(span.firstBarMs).not.toBeNull();
    expect(span.presentMs).toBeGreaterThan(0);
    expect(span.filledRanges.length).toBeGreaterThan(0);
    expect(span.gapRanges.length).toBeGreaterThan(0);
  });
});

describe("renderCoverageBar", () => {
  it("shows filled and gap segments", () => {
    const start = 0;
    const end = 100;
    const bar = renderCoverageBar(start, end, [[0, 50]], { width: 10 });
    expect(bar).toBe("█████░░░░░");
  });

  it("merges overlapping ranges before rendering gaps", () => {
    const gaps = gapTimeRanges(0, 100, mergeTimeRanges([[0, 40], [30, 70]]));
    expect(gaps).toEqual([[70, 100]]);
  });
});
