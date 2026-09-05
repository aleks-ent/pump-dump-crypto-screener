import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendShardArchiveGaps,
  mergeShardArchiveGaps,
  resetArchiveGapReports,
  writeArchiveGaps,
} from "./archive-storage.js";

function readRows(path: string): Record<string, unknown>[] {
  const content = readFileSync(path, "utf-8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("archive gap reports", () => {
  it("replaces the previous single-process report, including with an empty run", () => {
    const base = mkdtempSync(join(tmpdir(), "archive-gaps-"));
    const path = join(base, "reports", "archive_gaps.ndjson");
    try {
      writeArchiveGaps(base, [{ run: 1 }, { run: 1 }]);
      writeArchiveGaps(base, [{ run: 2 }]);
      expect(readRows(path)).toEqual([{ run: 2 }]);

      writeArchiveGaps(base, []);
      expect(readFileSync(path, "utf-8")).toBe("");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("isolates equal-count exchange shards and removes them after merging", () => {
    const base = mkdtempSync(join(tmpdir(), "archive-gaps-"));
    const reportPath = join(base, "reports", "archive_gaps.ndjson");
    const binanceShard = join(
      base,
      "reports",
      "archive_gaps.binance.shard-0-of-1.ndjson",
    );
    const bybitShard = join(base, "reports", "archive_gaps.bybit.shard-0-of-1.ndjson");
    try {
      resetArchiveGapReports(base);
      appendShardArchiveGaps(base, "binance", 0, 1, [{ exchange: "binance" }]);
      appendShardArchiveGaps(base, "bybit", 0, 1, [{ exchange: "bybit" }]);

      mergeShardArchiveGaps(base, "binance", 1);
      expect(readRows(reportPath)).toEqual([{ exchange: "binance" }]);
      expect(existsSync(binanceShard)).toBe(false);
      expect(existsSync(bybitShard)).toBe(true);

      mergeShardArchiveGaps(base, "bybit", 1);
      expect(readRows(reportPath)).toEqual([
        { exchange: "binance" },
        { exchange: "bybit" },
      ]);
      expect(existsSync(bybitShard)).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("does not carry gap rows into the next multi-process run", () => {
    const base = mkdtempSync(join(tmpdir(), "archive-gaps-"));
    const reportPath = join(base, "reports", "archive_gaps.ndjson");
    try {
      resetArchiveGapReports(base);
      appendShardArchiveGaps(base, "binance", 0, 1, [{ run: 1 }]);
      mergeShardArchiveGaps(base, "binance", 1);

      resetArchiveGapReports(base);
      appendShardArchiveGaps(base, "binance", 0, 1, [{ run: 2 }]);
      mergeShardArchiveGaps(base, "binance", 1);

      expect(readRows(reportPath)).toEqual([{ run: 2 }]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("clears the main report and stale legacy or exchange shard files", () => {
    const base = mkdtempSync(join(tmpdir(), "archive-gaps-"));
    const reportsDir = join(base, "reports");
    const main = join(reportsDir, "archive_gaps.ndjson");
    const legacyShard = join(reportsDir, "archive_gaps.shard-0-of-8.ndjson");
    const exchangeShard = join(reportsDir, "archive_gaps.binance.shard-0-of-16.ndjson");
    const unrelated = join(reportsDir, "archive_run_manifest.json");
    try {
      mkdirSync(reportsDir, { recursive: true });
      for (const path of [main, legacyShard, exchangeShard, unrelated]) {
        writeFileSync(path, "stale\n", "utf-8");
      }

      resetArchiveGapReports(base);

      expect(readFileSync(main, "utf-8")).toBe("");
      expect(existsSync(legacyShard)).toBe(false);
      expect(existsSync(exchangeShard)).toBe(false);
      expect(readFileSync(unrelated, "utf-8")).toBe("stale\n");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
