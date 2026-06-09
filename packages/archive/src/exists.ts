import { join } from "node:path";
import type { ArchiveFile, Instrument } from "@screener/core";
import { isNonEmptyFile } from "@screener/storage";
import { planArchives, supportsArchives } from "./fetch/index.js";

export function archiveFilePath(archivesDir: string, archive: ArchiveFile): string {
  return join(archivesDir, archive.relPath);
}

/** True only when every planned archive zip exists on disk (404 gaps do not count). */
export function isArchiveSeriesOnDisk(
  planned: ArchiveFile[],
  archivesDir: string,
): boolean {
  if (planned.length === 0) return false;
  for (const archive of planned) {
    if (!isNonEmptyFile(archiveFilePath(archivesDir, archive))) return false;
  }
  return true;
}

export function isArchiveSeriesComplete(
  inst: Instrument,
  interval: string,
  startMs: number,
  endMs: number,
  archivesDir: string,
): boolean {
  if (!supportsArchives(inst)) return false;
  const planned = planArchives(inst, interval, startMs, endMs);
  return isArchiveSeriesOnDisk(planned, archivesDir);
}

