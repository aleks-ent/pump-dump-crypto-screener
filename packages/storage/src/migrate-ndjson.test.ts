import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { migrateLegacySharedNdjson, rawNdjsonPath } from "./index.js";

describe("migrateLegacySharedNdjson", () => {
  it("splits shared day file into per-symbol paths", async () => {
    const base = mkdtempSync(join(tmpdir(), "migrate-"));
    const fallbackDir = join(base, "api_fallback");
    try {
      const legacyDir = join(
        fallbackDir,
        "raw/exchange=binance/instrument_type=linear_perp/interval=5m/date=2026-06-10",
      );
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(
        join(legacyDir, "data.ndjson"),
        [
          JSON.stringify({
            exchange: "binance",
            instrument_type: "linear_perp",
            symbol_native: "BTCUSDT",
            open_time_ms: 1,
          }),
          JSON.stringify({
            exchange: "binance",
            instrument_type: "linear_perp",
            symbol_native: "ETHUSDT",
            open_time_ms: 2,
          }),
        ].join("\n") + "\n",
        "utf-8",
      );

      const result = await migrateLegacySharedNdjson(fallbackDir);
      expect(result.filesSplit).toBe(1);
      expect(result.rowsWritten).toBe(2);
      expect(result.filesArchived).toBe(1);

      const btcPath = rawNdjsonPath(
        fallbackDir,
        { exchange: "binance", instrumentType: "linear_perp", symbolNative: "BTCUSDT" },
        "5m",
        "2026-06-10",
      );
      expect(readFileSync(btcPath, "utf-8").trimEnd().split("\n")).toHaveLength(1);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
