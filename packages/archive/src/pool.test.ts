import { describe, expect, it } from "vitest";
import { runTasksParallel } from "./pool.js";

describe("pool", () => {
  it("runs tasks in parallel", async () => {
    const state = await runTasksParallel(
      [1, 2, 3, 4, 5],
      async (n) => ({
        key: `k${n}`,
        status: "complete",
        archives_present: 1,
        archives_downloaded: 1,
        gaps: 0,
        fallback_rows: 0,
        gap_records: [],
        exchange: "binance",
      }),
      { workers: 3 },
    );
    expect(state.stats.complete).toBe(5);
    expect(state.gapRecords).toHaveLength(0);
  });
});
