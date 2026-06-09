import { describe, expect, it, beforeEach } from "vitest";
import type { PumpEpisode } from "@screener/pump-detector";
import { createMemoryDbClient, PumpRepository } from "@screener/db";
import { formatMonitorRunsMessage, formatPumpAlertMessage, formatPumpStatsMessages } from "./telegram.js";
import { buildClassificationKeyboard } from "./telegram-callback.js";

function samplePump(coin: string, startMs: number, peakScore: number): PumpEpisode {
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

describe("PumpRepository list + telegram formatting", () => {
  let repo: PumpRepository;

  beforeEach(async () => {
    const client = createMemoryDbClient();
    repo = new PumpRepository(client);
    await repo.applySchema();
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

  it("formats one alert message per pump with classification keyboard", async () => {
    const { newPumps } = await repo.upsertPumpEpisodes([
      samplePump("WLD/USDT", Date.parse("2026-06-07T00:50:00.000Z"), 100),
    ]);
    const pump = newPumps[0]!;
    const message = formatPumpAlertMessage(pump);
    expect(message).toContain("New pump detected");
    expect(message).toContain("WLD/USDT");
    const keyboard = buildClassificationKeyboard(pump.index);
    expect(keyboard.inline_keyboard[0]).toHaveLength(3);
  });
});

describe("formatMonitorRunsMessage", () => {
  it("returns empty-state message", () => {
    expect(formatMonitorRunsMessage([])).toBe(
      "<b>Monitor runs</b>\nNo runs recorded yet.",
    );
  });

  it("formats completed, failed, and running runs", () => {
    const message = formatMonitorRunsMessage([
      {
        id: 3,
        startedAt: "2026-06-08T14:00:00.000Z",
        endedAt: null,
        newPumpsCount: null,
      },
      {
        id: 2,
        startedAt: "2026-06-08T13:00:00.000Z",
        endedAt: "2026-06-08T13:42:00.000Z",
        newPumpsCount: 2,
      },
      {
        id: 1,
        startedAt: "2026-06-08T12:00:00.000Z",
        endedAt: "2026-06-08T12:05:00.000Z",
        newPumpsCount: null,
      },
    ]);

    expect(message).toContain("<b>Monitor runs</b> · last 5");
    expect(message.indexOf("#3")).toBeLessThan(message.indexOf("#2"));
    expect(message).toContain("#3</b> · running");
    expect(message).toContain("#2</b> · 2 new pumps");
    expect(message).toContain("#1</b> · failed");
    expect(message).toContain("Finished: 2026-06-08 13:42 UTC (42m)");
  });
});

describe("formatPumpStatsMessages", () => {
  it("returns empty-state message", () => {
    expect(formatPumpStatsMessages([], 80)).toEqual(["No pumps with score &gt; 80 in index."]);
  });

  it("orders recent first in output", async () => {
    const client = createMemoryDbClient();
    const repo = new PumpRepository(client);
    await repo.applySchema();
    await repo.upsertPumpEpisodes([
      samplePump("OLD/USDT", Date.parse("2026-06-05T10:00:00.000Z"), 90),
      samplePump("NEW/USDT", Date.parse("2026-06-06T10:00:00.000Z"), 85),
    ]);
    const pumps = await repo.listStoredPumps({ minScore: 80 });
    const message = formatPumpStatsMessages(pumps, 80)[0] ?? "";
    expect(message.indexOf("NEW/USDT")).toBeLessThan(message.indexOf("OLD/USDT"));
  });
});
