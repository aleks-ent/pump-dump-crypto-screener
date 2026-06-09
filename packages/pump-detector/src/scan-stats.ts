import type { SeriesDataSource } from "./load/series.js";

export interface ScanLoadStats {
  seriesTotal: number;
  bySource: Record<SeriesDataSource, number>;
  archiveFilesRead: number;
  groupsScanned: number;
  groupsWithCandidates: number;
  candidates: number;
}

export function createScanLoadStats(): ScanLoadStats {
  return {
    seriesTotal: 0,
    bySource: { ndjson: 0, archive: 0, merged: 0, none: 0 },
    archiveFilesRead: 0,
    groupsScanned: 0,
    groupsWithCandidates: 0,
    candidates: 0,
  };
}

export function formatScanLoadStats(stats: ScanLoadStats): string {
  const lines = [
    "Pump scan data sources:",
    `  series loaded: ${stats.seriesTotal}`,
    `  ndjson only: ${stats.bySource.ndjson}`,
    `  archive only (unzipped on the fly): ${stats.bySource.archive}`,
    `  merged (ndjson + archive): ${stats.bySource.merged}`,
    `  missing data: ${stats.bySource.none}`,
    `  archive files read: ${stats.archiveFilesRead}`,
    `  groups scanned: ${stats.groupsScanned}`,
    `  groups with candidates: ${stats.groupsWithCandidates}`,
    `  candidates emitted: ${stats.candidates}`,
  ];
  return lines.join("\n");
}
