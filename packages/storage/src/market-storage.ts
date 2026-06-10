import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CandleRecord, Instrument } from "@screener/core";
import { INTERVAL_TO_MS } from "./intervals.js";
import { rawNdjsonPath } from "./paths.js";

export { INTERVAL_TO_MS } from "./intervals.js";

function isoUtcNow(): string {
  return new Date().toISOString();
}

function utcDayFromMs(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 10);
}

function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function appendJsonl(path: string, rows: Record<string, unknown>[]): void {
  ensureParent(path);
  for (const row of rows) {
    appendFileSync(path, `${JSON.stringify(row)}\n`, "utf-8");
  }
}

/** Keys `${exchange}|${instrument_type}|${symbol_native}|${open_time_ms}` already on disk. */
export function readExistingSeriesKeys(path: string): Set<string> {
  const existing = new Set<string>();
  if (!existsSync(path)) return existing;
  try {
    const content = readFileSync(path, "utf-8");
    for (const line of content.trimEnd().split("\n")) {
      if (!line) continue;
      const row = JSON.parse(line) as Record<string, unknown>;
      const key = seriesOpenTimeKey(row);
      if (key) existing.add(key);
    }
  } catch {
    /* treat unreadable file as empty */
  }
  return existing;
}

/** @deprecated Prefer {@link readExistingSeriesKeys}. Per-symbol files may omit exchange fields. */
export function readExistingOpenTimes(path: string): Set<number> {
  const existing = new Set<number>();
  if (!existsSync(path)) return existing;
  try {
    const content = readFileSync(path, "utf-8");
    for (const line of content.trimEnd().split("\n")) {
      if (!line) continue;
      const row = JSON.parse(line) as { open_time_ms?: unknown };
      if (typeof row.open_time_ms === "number") existing.add(row.open_time_ms);
    }
  } catch {
    /* treat unreadable file as empty */
  }
  return existing;
}

function seriesOpenTimeKey(row: Record<string, unknown>): string | null {
  const openTime = row.open_time_ms;
  if (typeof openTime !== "number") return null;
  const sym = row.symbol_native != null ? String(row.symbol_native) : "";
  const ex = row.exchange != null ? String(row.exchange).toLowerCase() : "";
  const it = row.instrument_type != null ? String(row.instrument_type) : "";
  return `${ex}|${it}|${sym}|${openTime}`;
}

/** Append rows, skipping duplicates for the same open time. Returns rows written. */
function appendJsonlDeduped(path: string, rows: Record<string, unknown>[]): number {
  const existing = readExistingSeriesKeys(path);
  let written = 0;
  for (const row of rows) {
    const key = seriesOpenTimeKey(row);
    if (key == null || existing.has(key)) continue;
    existing.add(key);
    ensureParent(path);
    appendFileSync(path, `${JSON.stringify(row)}\n`, "utf-8");
    written += 1;
  }
  return written;
}

export function writeRawRecords(
  baseDir: string,
  records: CandleRecord[],
  requestMeta: Record<string, unknown>,
): number {
  if (records.length === 0) return 0;
  const now = isoUtcNow();
  const buckets = new Map<string, Record<string, unknown>[]>();
  for (const rec of records) {
    const day = utcDayFromMs(rec.openTimeMs);
    const path = rawNdjsonPath(
      baseDir,
      {
        exchange: rec.exchange,
        instrumentType: rec.instrumentType,
        symbolNative: rec.symbolNative,
      },
      rec.interval,
      day,
    );
    const row = {
      exchange: rec.exchange,
      instrument_type: rec.instrumentType,
      symbol_native: rec.symbolNative,
      interval: rec.interval,
      open_time_ms: rec.openTimeMs,
      close_time_ms: rec.closeTimeMs,
      open: rec.openPrice,
      high: rec.highPrice,
      low: rec.lowPrice,
      close: rec.closePrice,
      volume: rec.volume,
      quote_volume: rec.quoteVolume,
      trade_count: rec.tradeCount,
      raw_payload: rec.rawPayload,
      ingestion: { fetched_at_utc: now, request_meta: requestMeta },
    };
    if (!buckets.has(path)) buckets.set(path, []);
    buckets.get(path)!.push(row);
  }
  let written = 0;
  for (const [path, rows] of buckets) written += appendJsonlDeduped(path, rows);
  return written;
}

export function writeNormalizedRecords(
  baseDir: string,
  records: CandleRecord[],
): number {
  if (records.length === 0) return 0;
  const buckets = new Map<string, Record<string, unknown>[]>();
  for (const rec of records) {
    const day = utcDayFromMs(rec.openTimeMs);
    const path = join(
      baseDir,
      "normalized",
      `exchange=${rec.exchange}`,
      `instrument_type=${rec.instrumentType}`,
      `interval=${rec.interval}`,
      `date=${day}`,
      `symbol=${rec.symbolNative}`,
      "data.ndjson",
    );
    const row = {
      exchange: rec.exchange,
      instrument_type: rec.instrumentType,
      symbol_native: rec.symbolNative,
      interval: rec.interval,
      open_time_ms: rec.openTimeMs,
      close_time_ms: rec.closeTimeMs,
      open: rec.openPrice,
      high: rec.highPrice,
      low: rec.lowPrice,
      close: rec.closePrice,
      volume: rec.volume,
      quote_volume: rec.quoteVolume,
      trade_count: rec.tradeCount,
      extra_fields: { raw_payload: rec.rawPayload },
    };
    if (!buckets.has(path)) buckets.set(path, []);
    buckets.get(path)!.push(row);
  }
  for (const [path, rows] of buckets) appendJsonl(path, rows);
  return records.length;
}

export class SeriesQuality {
  expectedBars = 0;
  actualBars = 0;
  duplicateBars = 0;
  gaps = 0;
  firstOpenTimeMs: number | null = null;
  lastOpenTimeMs: number | null = null;
  private readonly seen = new Set<number>();

  constructor(
    readonly exchange: string,
    readonly instrumentType: string,
    readonly symbolNative: string,
    readonly interval: string,
  ) {}

  observe(records: CandleRecord[], startMs: number, endMs: number): void {
    const intervalMs = INTERVAL_TO_MS[this.interval] ?? 60_000;
    this.expectedBars = Math.max(0, Math.floor((endMs - startMs) / intervalMs));
    const sorted = [...records].sort((a, b) => a.openTimeMs - b.openTimeMs);
    for (const rec of sorted) {
      if (this.seen.has(rec.openTimeMs)) {
        this.duplicateBars += 1;
        continue;
      }
      if (this.lastOpenTimeMs !== null) {
        const delta = rec.openTimeMs - this.lastOpenTimeMs;
        if (delta > intervalMs) {
          this.gaps += Math.floor(delta / intervalMs) - 1;
        }
      }
      this.seen.add(rec.openTimeMs);
      this.actualBars += 1;
      if (this.firstOpenTimeMs === null) this.firstOpenTimeMs = rec.openTimeMs;
      this.lastOpenTimeMs = rec.openTimeMs;
    }
  }

  toReport(): Record<string, unknown> {
    const coverage =
      this.expectedBars > 0 ? (this.actualBars / this.expectedBars) * 100 : 0;
    return {
      exchange: this.exchange,
      instrument_type: this.instrumentType,
      symbol_native: this.symbolNative,
      interval: this.interval,
      expected_bars: this.expectedBars,
      actual_bars: this.actualBars,
      duplicate_bars: this.duplicateBars,
      gaps: this.gaps,
      coverage_pct: Math.round(coverage * 10000) / 10000,
      first_open_time_ms: this.firstOpenTimeMs,
      last_open_time_ms: this.lastOpenTimeMs,
    };
  }
}

export function writeQualityReport(
  baseDir: string,
  reports: Record<string, unknown>[],
): string {
  const path = join(baseDir, "reports", "quality_report.ndjson");
  appendJsonl(path, reports);
  return path;
}

export function writeManifest(
  baseDir: string,
  manifest: Record<string, unknown>,
): string {
  const path = join(baseDir, "reports", "run_manifest.json");
  ensureParent(path);
  writeFileSync(path, JSON.stringify(manifest, null, 2), "utf-8");
  return path;
}

export function writeSymbolUniverse(
  baseDir: string,
  symbols: Record<string, unknown>[],
): string {
  const path = join(baseDir, "reports", "symbol_universe.json");
  ensureParent(path);
  writeFileSync(path, JSON.stringify(symbols, null, 2), "utf-8");
  return path;
}

export function checkpointPath(baseDir: string): string {
  return join(baseDir, "reports", "checkpoint.json");
}

export function loadCheckpoint(baseDir: string): Record<string, unknown> {
  const path = checkpointPath(baseDir);
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function saveCheckpoint(
  baseDir: string,
  checkpoint: Record<string, unknown>,
): string {
  const path = checkpointPath(baseDir);
  ensureParent(path);
  writeFileSync(path, JSON.stringify(checkpoint, null, 2), "utf-8");
  return path;
}

export function seriesKey(inst: Instrument, interval: string): string {
  return `${inst.exchange}|${inst.instrumentType}|${inst.symbolNative}|${interval}`;
}
