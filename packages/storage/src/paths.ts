import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Instrument } from "@screener/core";
import { INTERVAL_TO_MS } from "./market-storage.js";

/** UTC calendar days overlapping [startMs, endMs) (end exclusive at instants). */
export function utcDaysInWindow(startMs: number, endMs: number): string[] {
  if (endMs <= startMs) return [];

  const days: string[] = [];
  let dayStart = Date.UTC(
    new Date(startMs).getUTCFullYear(),
    new Date(startMs).getUTCMonth(),
    new Date(startMs).getUTCDate(),
  );
  while (dayStart < endMs) {
    const dayEnd = dayStart + 86_400_000;
    if (startMs < dayEnd && endMs > dayStart) {
      days.push(new Date(dayStart).toISOString().slice(0, 10));
    }
    dayStart += 86_400_000;
  }
  return days;
}

export function rawNdjsonPath(
  baseDir: string,
  inst: Pick<Instrument, "exchange" | "instrumentType" | "symbolNative">,
  interval: string,
  day: string,
): string {
  return join(
    baseDir,
    "raw",
    `exchange=${inst.exchange}`,
    `instrument_type=${inst.instrumentType}`,
    `interval=${interval}`,
    `date=${day}`,
    "data.ndjson",
  );
}

export function isNonEmptyFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).size > 0;
  } catch {
    return false;
  }
}

function ndjsonRowMatchesInstrument(
  row: Record<string, unknown>,
  inst: Pick<Instrument, "exchange" | "instrumentType" | "symbolNative">,
): boolean {
  if (
    row.exchange != null &&
    String(row.exchange).toLowerCase() !== inst.exchange.toLowerCase()
  ) {
    return false;
  }
  if (row.instrument_type != null && String(row.instrument_type) !== inst.instrumentType) {
    return false;
  }
  if (row.symbol_native != null && String(row.symbol_native) !== inst.symbolNative) {
    return false;
  }
  return true;
}

function readLatestOpenTimeMsFromFile(
  path: string,
  inst?: Pick<Instrument, "exchange" | "instrumentType" | "symbolNative">,
): number | null {
  if (!isNonEmptyFile(path)) return null;
  try {
    const content = readFileSync(path, "utf-8");
    const lines = content.trimEnd().split("\n").filter(Boolean);
    if (lines.length === 0) return null;
    let latest: number | null = null;
    for (const line of lines) {
      const row = JSON.parse(line) as Record<string, unknown>;
      if (inst != null && !ndjsonRowMatchesInstrument(row, inst)) continue;
      const openTimeMs = row.open_time_ms;
      if (typeof openTimeMs !== "number") continue;
      if (latest == null || openTimeMs > latest) latest = openTimeMs;
    }
    return latest;
  } catch {
    return null;
  }
}

/** Latest candle open time in an NDJSON file (max `open_time_ms`), or null when missing. */
export function readLatestOpenTimeMs(path: string): number | null {
  return readLatestOpenTimeMsFromFile(path);
}

/** Latest open time for a specific instrument in a multi-symbol day NDJSON file. */
export function readLatestOpenTimeMsForInstrument(
  path: string,
  inst: Pick<Instrument, "exchange" | "instrumentType" | "symbolNative">,
): number | null {
  return readLatestOpenTimeMsFromFile(path, inst);
}

/** @deprecated Use {@link readLatestOpenTimeMs}. */
export const readLastOpenTimeMs = readLatestOpenTimeMs;

/** Start fetching REST fallback after the latest on-disk candle in an unsatisfied range. */
export function resumeFallbackStartMs(
  fallbackDir: string,
  inst: Instrument,
  interval: string,
  rangeStartMs: number,
  rangeEndMs: number,
): number {
  const intervalMs = INTERVAL_TO_MS[interval];
  if (!intervalMs) return rangeStartMs;

  for (const day of utcDaysInWindow(rangeStartMs, rangeEndMs)) {
    const dayStart = Date.parse(`${day}T00:00:00Z`);
    const dayEnd = dayStart + 86_400_000;
    const sliceStart = Math.max(rangeStartMs, dayStart);
    const sliceEnd = Math.min(rangeEndMs, dayEnd);
    if (sliceStart >= sliceEnd) continue;

    const path = rawNdjsonPath(fallbackDir, inst, interval, day);
    const latest = readLatestOpenTimeMsForInstrument(path, inst);
    const required = requiredLastOpenMsForSlice(sliceEnd, intervalMs);

    if (latest == null || latest < required) {
      if (latest == null) return sliceStart;
      return Math.max(sliceStart, latest + intervalMs);
    }
  }
  return rangeEndMs;
}

/** Open time of the last fully elapsed candle before `sliceEndMs` (exclusive). */
export function requiredLastOpenMsForSlice(sliceEndMs: number, intervalMs: number): number {
  return Math.floor((sliceEndMs - intervalMs) / intervalMs) * intervalMs;
}

export function isFallbackSeriesOnDisk(
  fallbackDir: string,
  inst: Instrument,
  interval: string,
  startMs: number,
  endMs: number,
): boolean {
  const days = utcDaysInWindow(startMs, endMs);
  if (days.length === 0) return false;

  const intervalMs = INTERVAL_TO_MS[interval];
  const checkCoverage = intervalMs != null;

  for (const day of days) {
    const path = rawNdjsonPath(fallbackDir, inst, interval, day);
    if (!checkCoverage) {
      const latest = readLatestOpenTimeMsForInstrument(path, inst);
      if (latest == null) return false;
      continue;
    }

    const dayStart = Date.parse(`${day}T00:00:00Z`);
    const dayEnd = dayStart + 86_400_000;
    const sliceStart = Math.max(startMs, dayStart);
    const sliceEnd = Math.min(endMs, dayEnd);
    if (sliceStart >= sliceEnd) continue;

    const requiredLast = requiredLastOpenMsForSlice(sliceEnd, intervalMs);
    const latestOpen = readLatestOpenTimeMsForInstrument(path, inst);
    if (latestOpen == null || latestOpen < requiredLast) return false;
  }
  return true;
}
