import { existsSync } from "node:fs";
import { statfs } from "node:fs/promises";

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export interface DiskSpace {
  freeBytes: number;
  totalBytes: number;
  usedPercent: number;
}

interface StatfsLike {
  bsize: number;
  blocks: number;
  bfree: number;
  bavail: number;
}

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const rendered = value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${rendered} ${UNITS[unit]}`;
}

export function summarizeStatfs(stats: StatfsLike): DiskSpace {
  const { bsize, blocks, bfree, bavail } = stats;
  // df excludes root-reserved blocks from capacity, so a full-for-users disk
  // reads as 100% rather than stalling in the nineties.
  const usedBlocks = blocks - bfree;
  const chargeable = usedBlocks + bavail;
  return {
    freeBytes: bavail * bsize,
    totalBytes: blocks * bsize,
    usedPercent: chargeable > 0 ? Math.round((usedBlocks / chargeable) * 100) : 0,
  };
}

export function pickProbePath(
  candidates: string[],
  exists: (path: string) => boolean = existsSync,
): string {
  return candidates.find(exists) ?? candidates[candidates.length - 1];
}

export async function readDiskSpace(path: string): Promise<DiskSpace | null> {
  try {
    return summarizeStatfs(await statfs(path));
  } catch {
    return null;
  }
}
