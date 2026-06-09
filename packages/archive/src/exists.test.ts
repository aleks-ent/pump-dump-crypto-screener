import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { ArchiveFile } from "@screener/core";
import { isArchiveSeriesOnDisk } from "./exists.js";

describe("isArchiveSeriesOnDisk", () => {
  it("true when all planned archives exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "arc-"));
    try {
      const archive: ArchiveFile = {
        url: "https://example.com/a.zip",
        relPath: "exchange=binance/instrument_type=spot/interval=1m/symbol=BTCUSDT/date=2026-05-25/a.zip",
        label: "2026-05-25",
      };
      const path = join(dir, archive.relPath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "zip", "utf-8");
      expect(isArchiveSeriesOnDisk([archive], dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
