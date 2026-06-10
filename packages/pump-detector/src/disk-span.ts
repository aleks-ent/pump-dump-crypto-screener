import {
  archiveCoverageEndMs,
  archiveCoverageStartMs,
  archiveFilePath,
  isSeriesSatisfiedOnDisk,
  planArchives,
  supportsArchives,
} from "@screener/archive";
import type { Instrument } from "@screener/core";
import { isNonEmptyFile, readNdjsonDayText, utcDaysInWindow } from "@screener/storage";
import type { Timeframe } from "./types.js";

const INTERVAL_MS: Record<Timeframe, number> = { "1m": 60_000, "5m": 300_000 };

export type TimeRange = [number, number];

export interface DiskDataSpan {
  exchange: string;
  instrumentType: string;
  symbolNative: string;
  symbolCanonical: string;
  base: string | null;
  interval: Timeframe;
  windowStartMs: number;
  windowEndMs: number;
  windowMs: number;
  windowDays: number;
  barsExpected: number;
  barsPresent: number;
  coveragePct: number;
  firstBarMs: number | null;
  lastBarMs: number | null;
  /** Span from first to last bar inside the window (0 when empty). */
  presentMs: number;
  presentDays: number;
  fullySatisfied: boolean;
  /** Merged UTC ranges with data on disk (start inclusive, end exclusive). */
  filledRanges: TimeRange[];
  /** Gaps inside the window where data is missing. */
  gapRanges: TimeRange[];
}

export interface DiskDataSpanOptions {
  ndjsonRoots: string[];
  archivesDir: string;
  fallbackDir: string;
  startMs: number;
  endMs: number;
}

export interface CoverageBarOptions {
  width?: number;
  filledChar?: string;
  partialChar?: string;
  gapChar?: string;
}

function clampRange(rangeStartMs: number, rangeEndMs: number, startMs: number, endMs: number): TimeRange | null {
  const rs = Math.max(rangeStartMs, startMs);
  const re = Math.min(rangeEndMs, endMs);
  return rs < re ? [rs, re] : null;
}

export function mergeTimeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter(([a, b]) => a < b)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length === 0) return [];

  const merged: TimeRange[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const [start, end] = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

export function gapTimeRanges(windowStartMs: number, windowEndMs: number, filled: TimeRange[]): TimeRange[] {
  if (windowEndMs <= windowStartMs) return [];
  const merged = mergeTimeRanges(filled);
  const gaps: TimeRange[] = [];
  let cursor = windowStartMs;

  for (const [start, end] of merged) {
    if (start > cursor) gaps.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < windowEndMs) gaps.push([cursor, windowEndMs]);
  return gaps;
}

export function rangeOverlapMs(range: TimeRange, startMs: number, endMs: number): number {
  const rs = Math.max(range[0], startMs);
  const re = Math.min(range[1], endMs);
  return Math.max(0, re - rs);
}

export function renderCoverageBar(
  windowStartMs: number,
  windowEndMs: number,
  filledRanges: TimeRange[],
  opts: CoverageBarOptions = {},
): string {
  const width = opts.width ?? 40;
  const filledChar = opts.filledChar ?? "█";
  const partialChar = opts.partialChar ?? "▓";
  const gapChar = opts.gapChar ?? "░";
  const windowMs = windowEndMs - windowStartMs;
  if (width <= 0 || windowMs <= 0) return gapChar.repeat(Math.max(width, 0));

  const merged = mergeTimeRanges(filledRanges);
  let out = "";
  for (let i = 0; i < width; i++) {
    const bucketStart = windowStartMs + (windowMs * i) / width;
    const bucketEnd = windowStartMs + (windowMs * (i + 1)) / width;
    const bucketMs = bucketEnd - bucketStart;
    let coveredMs = 0;
    for (const range of merged) {
      coveredMs += rangeOverlapMs(range, bucketStart, bucketEnd);
    }
    const ratio = bucketMs > 0 ? coveredMs / bucketMs : 0;
    if (ratio >= 0.95) out += filledChar;
    else if (ratio > 0) out += partialChar;
    else out += gapChar;
  }
  return out;
}

function ndjsonStatsForSlice(
  roots: string[],
  inst: Instrument,
  interval: Timeframe,
  sliceStartMs: number,
  sliceEndMs: number,
): { barCount: number; firstBarMs: number | null; lastBarMs: number | null } {
  const times = new Set<number>();
  for (const root of roots) {
    const days = utcDaysInWindow(sliceStartMs, sliceEndMs);
    for (const day of days) {
      const text = readNdjsonDayText(root, inst, interval, day);
      if (text == null) continue;
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let openTimeMs: number;
        try {
          openTimeMs = Number((JSON.parse(trimmed) as { open_time_ms?: unknown }).open_time_ms);
        } catch {
          continue;
        }
        if (!Number.isFinite(openTimeMs)) continue;
        if (openTimeMs < sliceStartMs || openTimeMs >= sliceEndMs) continue;
        times.add(openTimeMs);
      }
    }
  }

  if (times.size === 0) {
    return { barCount: 0, firstBarMs: null, lastBarMs: null };
  }

  let firstBarMs: number | null = null;
  let lastBarMs: number | null = null;
  for (const t of times) {
    if (firstBarMs == null || t < firstBarMs) firstBarMs = t;
    if (lastBarMs == null || t > lastBarMs) lastBarMs = t;
  }
  return { barCount: times.size, firstBarMs, lastBarMs };
}

function archiveFullyCoversRange(
  planned: ReturnType<typeof planArchives>,
  archivesDir: string,
  rangeStartMs: number,
  rangeEndMs: number,
): boolean {
  for (const archive of planned) {
    if (!isNonEmptyFile(archiveFilePath(archivesDir, archive))) continue;
    const covStart = archiveCoverageStartMs(archive);
    const covEnd = archiveCoverageEndMs(archive);
    if (covStart == null || covEnd == null) continue;
    if (covStart <= rangeStartMs && covEnd >= rangeEndMs) return true;
  }
  return false;
}

function statsFromRanges(
  startMs: number,
  endMs: number,
  intervalMs: number,
  filledRanges: TimeRange[],
): {
  barsPresent: number;
  firstBarMs: number | null;
  lastBarMs: number | null;
  presentMs: number;
} {
  const merged = mergeTimeRanges(filledRanges);
  let barsPresent = 0;
  for (const [rs, re] of merged) {
    barsPresent += Math.floor((re - rs) / intervalMs);
  }

  const barsExpected = Math.max(0, Math.floor((endMs - startMs) / intervalMs));
  barsPresent = Math.min(barsPresent, barsExpected);

  let firstBarMs: number | null = null;
  let lastBarMs: number | null = null;
  for (const [rs, re] of merged) {
    const last = re - intervalMs;
    if (last < rs) continue;
    firstBarMs = firstBarMs == null ? rs : Math.min(firstBarMs, rs);
    lastBarMs = lastBarMs == null ? last : Math.max(lastBarMs, last);
  }

  let presentMs = 0;
  if (firstBarMs != null && lastBarMs != null) {
    presentMs = Math.max(0, lastBarMs - firstBarMs + intervalMs);
    presentMs = Math.min(presentMs, endMs - startMs);
  }

  return { barsPresent, firstBarMs, lastBarMs, presentMs };
}

export function computeDiskDataSpan(
  inst: Instrument,
  interval: Timeframe,
  opts: DiskDataSpanOptions,
): DiskDataSpan {
  const intervalMs = INTERVAL_MS[interval];
  const { startMs, endMs } = opts;
  const windowMs = Math.max(0, endMs - startMs);
  const barsExpected = Math.max(0, Math.floor(windowMs / intervalMs));
  const windowDays = Math.round((windowMs / 86_400_000) * 10) / 10;

  const fullySatisfied = isSeriesSatisfiedOnDisk(
    inst,
    interval,
    startMs,
    endMs,
    opts.archivesDir,
    opts.fallbackDir,
    true,
  );

  const filledRanges: TimeRange[] = fullySatisfied ? [[startMs, endMs]] : [];

  if (!fullySatisfied) {
    const planned = supportsArchives(inst) ? planArchives(inst, interval, startMs, endMs) : [];

    for (const day of utcDaysInWindow(startMs, endMs)) {
      const dayStart = Date.parse(`${day}T00:00:00Z`);
      const dayEnd = dayStart + 86_400_000;
      const sliceStart = Math.max(startMs, dayStart);
      const sliceEnd = Math.min(endMs, dayEnd);
      if (sliceStart >= sliceEnd) continue;

      const ndjson = ndjsonStatsForSlice(opts.ndjsonRoots, inst, interval, sliceStart, sliceEnd);
      const archiveCovers =
        planned.length > 0 &&
        archiveFullyCoversRange(planned, opts.archivesDir, sliceStart, sliceEnd);

      if (archiveCovers) {
        filledRanges.push([sliceStart, sliceEnd]);
        continue;
      }

      if (ndjson.barCount > 0 && ndjson.firstBarMs != null && ndjson.lastBarMs != null) {
        const range = clampRange(
          ndjson.firstBarMs,
          ndjson.lastBarMs + intervalMs,
          sliceStart,
          sliceEnd,
        );
        if (range) filledRanges.push(range);
      }
    }
  }

  const mergedFilled = mergeTimeRanges(filledRanges);
  const gapRanges = gapTimeRanges(startMs, endMs, mergedFilled);
  const { barsPresent, firstBarMs, lastBarMs, presentMs } = statsFromRanges(
    startMs,
    endMs,
    intervalMs,
    mergedFilled,
  );
  const coveragePct =
    barsExpected > 0 ? Math.round((barsPresent / barsExpected) * 10000) / 100 : 0;

  return {
    exchange: inst.exchange,
    instrumentType: inst.instrumentType,
    symbolNative: inst.symbolNative,
    symbolCanonical: inst.symbolCanonical,
    base: inst.base,
    interval,
    windowStartMs: startMs,
    windowEndMs: endMs,
    windowMs,
    windowDays,
    barsExpected,
    barsPresent,
    coveragePct,
    firstBarMs,
    lastBarMs,
    presentMs,
    presentDays: Math.round((presentMs / 86_400_000) * 100) / 100,
    fullySatisfied,
    filledRanges: mergedFilled,
    gapRanges,
  };
}
