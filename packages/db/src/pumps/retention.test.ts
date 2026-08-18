import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@libsql/client";
import type { PumpEpisode } from "@screener/pump-detector";
import { createMemoryDbClient } from "../client.js";
import { PumpRepository } from "./repository.js";
import {
  DEFAULT_PUMP_RETENTION_DAYS,
  inspectPumpRetention,
  parsePumpRetentionDays,
  prunePumpsBefore,
  pumpRetentionCutoffMs,
} from "./retention.js";

function samplePump(coin: string, startMs: number): PumpEpisode {
  return {
    coin,
    type: "pump",
    startMs,
    endMs: startMs + 300_000,
    durationMinutes: 5,
    peakScore: 72,
    dominantPhase: "active_pump",
    leadingExchange: "binance",
    symbolNative: coin.replace("/", ""),
    instrumentType: "linear_perp",
    tradingViewUrl: "https://example.com/chart",
    confirmed: true,
    confirmedExchanges: ["binance"],
    eventCount: 3,
  };
}

describe("pump retention settings", () => {
  it("defaults to one year and accepts a positive integer override", () => {
    expect(parsePumpRetentionDays(undefined)).toBe(DEFAULT_PUMP_RETENTION_DAYS);
    expect(parsePumpRetentionDays(" 90 ")).toBe(90);
  });

  it.each(["0", "-1", "1.5", "1e2", "not-a-number"])(
    "rejects invalid retention days: %s",
    (value) => {
      expect(() => parsePumpRetentionDays(value)).toThrow(
        "PUMP_RETAIN_DAYS must be a positive integer",
      );
    },
  );

  it("computes the cutoff from the supplied reference time", () => {
    const nowMs = Date.parse("2026-08-18T12:00:00.000Z");
    expect(new Date(pumpRetentionCutoffMs(30, nowMs)).toISOString()).toBe(
      "2026-07-19T12:00:00.000Z",
    );
  });
});

describe("pump database retention", () => {
  let client: Client;
  let repo: PumpRepository;

  beforeEach(async () => {
    client = createMemoryDbClient();
    repo = new PumpRepository(client);
    await repo.applySchema();
  });

  it("previews and atomically removes old pumps and their dependent rows", async () => {
    const cutoffMs = Date.parse("2026-01-01T00:00:00.000Z");
    const { newPumps } = await repo.upsertPumpEpisodes([
      samplePump("OLD/USDT", cutoffMs - 1),
      samplePump("BOUNDARY/USDT", cutoffMs),
      samplePump("NEW/USDT", cutoffMs + 1),
    ]);
    const oldId = newPumps[0]!.index;
    const newId = newPumps[2]!.index;

    await client.execute({
      sql: `
        INSERT INTO telegram_subscribers (chat_id, subscribed_at)
        VALUES ('retention-test', '2026-01-01T00:00:00.000Z')
      `,
      args: [],
    });
    for (const [prefix, eventId] of [
      ["old", oldId],
      ["new", newId],
    ] as const) {
      await client.execute({
        sql: `
          INSERT INTO pump_annotations (
            id, event_id, source, category, created_at, updated_at
          ) VALUES (?, ?, 'human', 'wick_spike', ?, ?)
        `,
        args: [
          `${prefix}-annotation`,
          eventId,
          "2026-01-01T00:00:00.000Z",
          "2026-01-01T00:00:00.000Z",
        ],
      });
      await client.execute({
        sql: `
          INSERT INTO telegram_episode_votes (
            episode_id, chat_id, classification, voted_at
          ) VALUES (?, 'retention-test', 'pump', '2026-01-01T00:00:00.000Z')
        `,
        args: [eventId],
      });
      await client.execute({
        sql: `
          INSERT INTO telegram_episode_messages (
            episode_id, chat_id, message_id, sent_at
          ) VALUES (?, 'retention-test', ?, '2026-01-01T00:00:00.000Z')
        `,
        args: [eventId, prefix === "old" ? 1 : 2],
      });
    }

    const preview = await inspectPumpRetention(client, cutoffMs);
    expect(preview).toMatchObject({
      cutoffMs,
      pumps: 1,
      annotations: 1,
      telegramVotes: 1,
      telegramMessages: 1,
    });
    expect(await repo.countPumps()).toBe(3);

    const deleted = await prunePumpsBefore(client, cutoffMs);
    expect(deleted).toMatchObject({
      cutoffMs,
      pumps: 1,
      annotations: 1,
      telegramVotes: 1,
      telegramMessages: 1,
    });
    expect(await repo.countPumps()).toBe(2);
    expect(await repo.getStoredPump(oldId)).toBeNull();
    expect(await repo.getStoredPump(newId)).not.toBeNull();

    const remainingChildren = await Promise.all([
      client.execute("SELECT event_id FROM pump_annotations"),
      client.execute("SELECT episode_id FROM telegram_episode_votes"),
      client.execute("SELECT episode_id FROM telegram_episode_messages"),
    ]);
    expect(remainingChildren.map((result) => result.rows.length)).toEqual([1, 1, 1]);
  });
});
