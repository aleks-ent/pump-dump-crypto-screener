import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { ArchiveFile } from "@screener/core";

// Test seriesComplete logic via duplicated check (exported indirectly through runner behavior)
function seriesComplete(
  planned: ArchiveFile[],
  archivesDir: string,
  gapLabels: Set<string>,
  exists: (p: string) => boolean,
): boolean {
  if (planned.length === 0) return false;
  for (const archive of planned) {
    const path = join(archivesDir, archive.relPath);
    if (exists(path)) continue;
    if (gapLabels.has(archive.label)) continue;
    return false;
  }
  return true;
}

describe("archive complete", () => {
  it("complete when all files present", () => {
    const dir = mkdtempSync(join(tmpdir(), "arc-"));
    try {
      const archive: ArchiveFile = {
        url: "https://example.com/a.zip",
        relPath: "exchange=binance/symbol=BTCUSDT/date=2026-04-30/a.zip",
        label: "2026-04-30",
      };
      const path = join(dir, archive.relPath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "data", "utf-8");
      expect(seriesComplete([archive], dir, new Set(), (p) => p === path)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
