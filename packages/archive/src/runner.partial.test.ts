import { describe, expect, it } from "vitest";
import { isArchiveSeriesOnDisk } from "./exists.js";
import type { ArchiveFile } from "@screener/core";

describe("series completion rules", () => {
  it("requires every planned day on disk, not just one overlap", () => {
    const planned: ArchiveFile[] = [
      {
        url: "https://example.com/a.zip",
        relPath: "exchange=binance/instrument_type=linear_perp/interval=5m/symbol=0GUSDT/date=2026-05-29/a.zip",
        label: "2026-05-29",
      },
      {
        url: "https://example.com/b.zip",
        relPath: "exchange=binance/instrument_type=linear_perp/interval=5m/symbol=0GUSDT/date=2026-06-02/b.zip",
        label: "2026-06-02",
      },
    ];
    expect(planned).toHaveLength(2);
    expect(isArchiveSeriesOnDisk([planned[0]!], "/tmp")).toBe(false);
  });
});
