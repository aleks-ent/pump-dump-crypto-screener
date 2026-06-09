import { describe, expect, it, beforeEach } from "vitest";
import type { PumpEpisode } from "@screener/pump-detector";
import { createMemoryDbClient } from "../client.js";
import { pumpIndexKey } from "./pump-id.js";
import { PumpRepository } from "./repository.js";

function samplePump(coin: string, startMs: number, peakScore = 72): PumpEpisode {
  return {
    coin,
    type: "pump",
    startMs,
    endMs: startMs + 300_000,
    durationMinutes: 5,
    peakScore,
    dominantPhase: "active_pump",
    leadingExchange: "binance",
    symbolNative: "BTCUSDT",
    instrumentType: "linear_perp",
    tradingViewUrl: "https://example.com/chart",
    confirmed: true,
    confirmedExchanges: ["binance"],
    eventCount: 3,
  };
}

describe("pumpIndexKey", () => {
  it("uses coin and pump start ISO time", () => {
    const startMs = Date.parse("2026-06-05T12:00:00.000Z");
    expect(pumpIndexKey("BTC/USDT", startMs)).toBe(
      "BTC/USDT|2026-06-05T12:00:00.000Z",
    );
  });
});

describe("PumpRepository", () => {
  let repo: PumpRepository;

  beforeEach(async () => {
    const client = createMemoryDbClient();
    repo = new PumpRepository(client);
    await repo.applySchema();
  });

  it("stores pumps and returns only new entries", async () => {
    const startMs = Date.parse("2026-06-05T12:00:00.000Z");
    const first = await repo.upsertPumpEpisodes([samplePump("BTC/USDT", startMs)]);
    expect(first.newPumps).toHaveLength(1);
    expect(await repo.countPumps()).toBe(1);

    const second = await repo.upsertPumpEpisodes([samplePump("BTC/USDT", startMs)]);
    expect(second.newPumps).toHaveLength(0);
    expect(await repo.countPumps()).toBe(1);
  });

  it("ignores dump episodes", async () => {
    const { newPumps } = await repo.upsertPumpEpisodes([
      {
        ...samplePump("ETH/USDT", Date.parse("2026-06-05T13:00:00.000Z")),
        type: "dump",
      },
    ]);
    expect(newPumps).toHaveLength(0);
    expect(await repo.countPumps()).toBe(0);
  });

  it("sorts newest first and filters by score", async () => {
    await repo.upsertPumpEpisodes([
      samplePump("OLD/USDT", Date.parse("2026-06-05T10:00:00.000Z"), 90),
      samplePump("NEW/USDT", Date.parse("2026-06-06T10:00:00.000Z"), 85),
      samplePump("LOW/USDT", Date.parse("2026-06-06T11:00:00.000Z"), 80),
    ]);

    const pumps = await repo.listStoredPumps({ minScore: 80 });
    expect(pumps.map((p) => p.coin)).toEqual(["NEW/USDT", "OLD/USDT"]);
    expect(pumps.every((p) => p.peakScore > 80)).toBe(true);
  });

  it("updates classification", async () => {
    const startMs = Date.parse("2026-06-05T12:00:00.000Z");
    const { newPumps } = await repo.upsertPumpEpisodes([samplePump("BTC/USDT", startMs)]);
    const id = newPumps[0]!.index;

    await repo.setClassification(id, "pump");
    expect(await repo.getClassification(id)).toBe("pump");

    await repo.setClassification(id, "none");
    expect(await repo.getClassification(id)).toBe("none");
  });

  it("preserves classification on re-upsert from scan", async () => {
    const startMs = Date.parse("2026-06-05T12:00:00.000Z");
    const { newPumps } = await repo.upsertPumpEpisodes([samplePump("BTC/USDT", startMs, 70)]);
    const id = newPumps[0]!.index;
    await repo.setClassification(id, "dump");

    await repo.upsertPumpEpisodes([samplePump("BTC/USDT", startMs, 95)]);
    expect(await repo.getClassification(id)).toBe("dump");

    const pumps = await repo.listStoredPumps();
    expect(pumps[0]!.peakScore).toBe(95);
  });

  it("preserves firstSeenAt on re-upsert", async () => {
    const startMs = Date.parse("2026-06-05T12:00:00.000Z");
    const first = await repo.upsertPumpEpisodes([samplePump("BTC/USDT", startMs)]);
    const firstSeenAt = first.newPumps[0]!.firstSeenAt;

    await repo.upsertPumpEpisodes([samplePump("BTC/USDT", startMs)]);
    const pumps = await repo.listStoredPumps();
    expect(pumps[0]!.firstSeenAt).toBe(firstSeenAt);
    expect(pumps[0]!.lastSeenAt).toBeDefined();
  });

  it("throws when setting classification for missing pump", async () => {
    await expect(repo.setClassification("missing", "pump")).rejects.toThrow(
      "Pump not found",
    );
  });
});
