import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const COVERAGE_INDEX_VERSION = 1;

export interface SeriesCoverageEntry {
  /** Verified satisfied window start (inclusive), UTC ms. */
  start_ms: number;
  /** Verified satisfied window end (exclusive), UTC ms. */
  end_ms: number;
  verified_at_utc: string;
}

export interface CoverageIndex {
  version: typeof COVERAGE_INDEX_VERSION;
  series: Record<string, SeriesCoverageEntry>;
}

export function emptyCoverageIndex(): CoverageIndex {
  return { version: COVERAGE_INDEX_VERSION, series: {} };
}

export function coverageIndexPath(baseDir: string): string {
  return join(baseDir, "reports", "coverage_index.json");
}

export function loadCoverageIndex(baseDir: string): CoverageIndex {
  try {
    const raw = JSON.parse(readFileSync(coverageIndexPath(baseDir), "utf-8")) as CoverageIndex;
    if (raw.version !== COVERAGE_INDEX_VERSION || typeof raw.series !== "object") {
      return emptyCoverageIndex();
    }
    return raw;
  } catch {
    return emptyCoverageIndex();
  }
}

export function saveCoverageIndex(baseDir: string, index: CoverageIndex): string {
  const path = coverageIndexPath(baseDir);
  writeFileSync(path, JSON.stringify(index, null, 2), "utf-8");
  return path;
}

/** True when the index entry fully covers [startMs, endMs). */
export function isFullyIndexed(
  entry: SeriesCoverageEntry | undefined,
  startMs: number,
  endMs: number,
): boolean {
  return entry != null && entry.start_ms <= startMs && entry.end_ms >= endMs;
}

/** Sub-ranges of [startMs, endMs) not yet recorded in the index entry. */
export function uncoveredRanges(
  entry: SeriesCoverageEntry | undefined,
  startMs: number,
  endMs: number,
): [number, number][] {
  if (endMs <= startMs) return [];
  if (entry == null) return [[startMs, endMs]];

  const gaps: [number, number][] = [];
  if (startMs < entry.start_ms) {
    gaps.push([startMs, Math.min(entry.start_ms, endMs)]);
  }
  if (endMs > entry.end_ms) {
    gaps.push([Math.max(entry.end_ms, startMs), endMs]);
  }
  return gaps.filter(([a, b]) => a < b);
}

export function mergeCoverageEntry(
  entry: SeriesCoverageEntry | undefined,
  startMs: number,
  endMs: number,
): SeriesCoverageEntry {
  const now = new Date().toISOString();
  if (entry == null) {
    return { start_ms: startMs, end_ms: endMs, verified_at_utc: now };
  }
  return {
    start_ms: Math.min(entry.start_ms, startMs),
    end_ms: Math.max(entry.end_ms, endMs),
    verified_at_utc: now,
  };
}
