import { describe, expect, it, beforeEach } from "vitest";
import { createMemoryDbClient } from "../client.js";
import { PumpRepository } from "../pumps/repository.js";
import { MonitorRunRepository } from "./repository.js";

describe("MonitorRunRepository", () => {
  let repo: MonitorRunRepository;

  beforeEach(async () => {
    const client = createMemoryDbClient();
    repo = new MonitorRunRepository(client);
    await new PumpRepository(client).applySchema();
  });

  it("records start and finish with new pump count", async () => {
    const startedAt = "2026-06-08T10:00:00.000Z";
    const endedAt = "2026-06-08T10:45:00.000Z";
    const runId = await repo.startRun(startedAt);

    let record = await repo.getRun(runId);
    expect(record).toEqual({
      id: runId,
      startedAt,
      endedAt: null,
      newPumpsCount: null,
    });

    await repo.finishRun(runId, endedAt, 3);

    record = await repo.getRun(runId);
    expect(record).toEqual({
      id: runId,
      startedAt,
      endedAt,
      newPumpsCount: 3,
    });
  });

  it("records null new pump count when run fails before upsert", async () => {
    const runId = await repo.startRun("2026-06-08T11:00:00.000Z");
    await repo.finishRun(runId, "2026-06-08T11:05:00.000Z", null);

    const record = await repo.getRun(runId);
    expect(record?.newPumpsCount).toBeNull();
    expect(record?.endedAt).toBe("2026-06-08T11:05:00.000Z");
  });

  it("lists recent runs newest first", async () => {
    const first = await repo.startRun("2026-06-08T10:00:00.000Z");
    await repo.finishRun(first, "2026-06-08T10:30:00.000Z", 1);
    const second = await repo.startRun("2026-06-08T11:00:00.000Z");
    await repo.finishRun(second, "2026-06-08T11:45:00.000Z", 0);

    const runs = await repo.listRecentRuns(5);
    expect(runs.map((run) => run.id)).toEqual([second, first]);
  });
});
