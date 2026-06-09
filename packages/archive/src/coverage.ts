import type { ArchiveFile, Instrument } from "@screener/core";
import { utcDayStartMs } from "@screener/core";
import { isFallbackSeriesOnDisk, isNonEmptyFile } from "@screener/storage";
import { archiveFilePath, isArchiveSeriesOnDisk } from "./exists.js";
import { planArchives, supportsArchives } from "./fetch/index.js";

/** UTC instant at start of archive coverage for one planned file (inclusive). */
export function archiveCoverageStartMs(archive: ArchiveFile): number | null {
  const range = archive.label.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
  if (range) return Date.parse(`${range[1]}T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(archive.label)) {
    return Date.parse(`${archive.label}T00:00:00Z`);
  }
  const fromPath = archive.relPath.match(/date=(\d{4}-\d{2}-\d{2})/);
  if (fromPath) return Date.parse(`${fromPath[1]}T00:00:00Z`);
  return null;
}

/** UTC instant at end of archive coverage for one planned file (exclusive). */
export function archiveCoverageEndMs(archive: ArchiveFile): number | null {
  const range = archive.label.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
  if (range) {
    return Date.parse(`${range[2]}T00:00:00Z`) + 86_400_000;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(archive.label)) {
    return Date.parse(`${archive.label}T00:00:00Z`) + 86_400_000;
  }
  const fromPath = archive.relPath.match(/date=(\d{4}-\d{2}-\d{2})/);
  if (fromPath) {
    return Date.parse(`${fromPath[1]}T00:00:00Z`) + 86_400_000;
  }
  return null;
}

/** Start of REST tail after the last on-disk archive file (Binance daily, Bybit monthly). */
export function computeTailStartMs(
  planned: ArchiveFile[],
  archivesDir: string,
  startMs: number,
): number {
  let tailStart = startMs;
  for (const archive of planned) {
    if (!isNonEmptyFile(archiveFilePath(archivesDir, archive))) continue;
    const end = archiveCoverageEndMs(archive);
    if (end != null) tailStart = Math.max(tailStart, end);
  }
  return tailStart;
}

/** REST ranges for missing archive files plus the partial current UTC day. */
export function planFallbackRanges(
  planned: ArchiveFile[],
  archivesDir: string,
  startMs: number,
  endMs: number,
): [number, number][] {
  const ranges: [number, number][] = [];
  const tailDayStart = utcDayStartMs(endMs);

  for (const archive of planned) {
    if (isNonEmptyFile(archiveFilePath(archivesDir, archive))) continue;
    const covStart = archiveCoverageStartMs(archive);
    const covEnd = archiveCoverageEndMs(archive);
    if (covStart == null || covEnd == null) continue;
    const rs = Math.max(startMs, covStart);
    const re = Math.min(endMs, covEnd, tailDayStart);
    if (rs < re) ranges.push([rs, re]);
  }

  if (tailDayStart < endMs) {
    ranges.push([tailDayStart, endMs]);
  }

  return ranges;
}

export function isSeriesSatisfiedOnDisk(
  inst: Instrument,
  interval: string,
  startMs: number,
  endMs: number,
  archivesDir: string,
  fallbackDir: string,
  allowFallback: boolean,
): boolean {
  if (!supportsArchives(inst)) {
    return allowFallback && isFallbackSeriesOnDisk(fallbackDir, inst, interval, startMs, endMs);
  }

  const planned = planArchives(inst, interval, startMs, endMs);
  if (planned.length === 0) {
    if (!allowFallback) return true;
    const tailDayStart = utcDayStartMs(endMs);
    if (tailDayStart >= endMs) return true;
    return isFallbackSeriesOnDisk(fallbackDir, inst, interval, tailDayStart, endMs);
  }

  const tailDayStart = utcDayStartMs(endMs);

  for (const archive of planned) {
    if (isNonEmptyFile(archiveFilePath(archivesDir, archive))) continue;
    if (!allowFallback) return false;
    const covStart = archiveCoverageStartMs(archive);
    const covEnd = archiveCoverageEndMs(archive);
    if (covStart == null || covEnd == null) return false;
    const rs = Math.max(startMs, covStart);
    const re = Math.min(endMs, covEnd, tailDayStart);
    if (rs < re && !isFallbackSeriesOnDisk(fallbackDir, inst, interval, rs, re)) {
      return false;
    }
  }

  if (!allowFallback) return isArchiveSeriesOnDisk(planned, archivesDir);

  if (tailDayStart < endMs) {
    if (!isFallbackSeriesOnDisk(fallbackDir, inst, interval, tailDayStart, endMs)) {
      return false;
    }
  }
  return true;
}
