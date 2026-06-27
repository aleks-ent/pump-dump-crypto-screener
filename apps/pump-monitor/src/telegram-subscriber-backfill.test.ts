import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryDbClient,
  PumpRepository,
  TelegramSubscriberRepository,
} from "@screener/db";
import { backfillTelegramSubscribers } from "./telegram-subscriber-backfill.js";

describe("Telegram subscriber backfill", () => {
  let client: ReturnType<typeof createMemoryDbClient>;
  let repo: TelegramSubscriberRepository;

  beforeEach(async () => {
    client = createMemoryDbClient();
    await new PumpRepository(client).applySchema();
    repo = new TelegramSubscriberRepository(client);
  });

  it("backfills missing subscriber data and leaves existing snapshots alone", async () => {
    await repo.subscribe("12345", "2026-06-11T10:00:00.000Z");
    await repo.subscribe(
      "67890",
      "2026-06-11T10:05:00.000Z",
      JSON.stringify({ description: "already captured" }),
    );
    await client.execute({
      sql: `
        UPDATE telegram_subscribers
        SET unsubscribed_at = ?
        WHERE chat_id = ?
      `,
      args: ["2026-06-11T10:30:00.000Z", "12345"],
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: {
          id: 12345,
          type: "private",
          username: "alex",
          bio: "Crypto alerts",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await backfillTelegramSubscribers(
        client,
        { botToken: "token" },
        {
          now: () => "2026-06-11T11:00:00.000Z",
          log: () => undefined,
        },
      );

      expect(result).toEqual({
        normalizedSubscribed: 0,
        clearedActiveUnsubscribedAt: 1,
        candidates: 1,
        updated: 1,
        failed: 0,
      });
      expect(fetchMock).toHaveBeenCalledOnce();

      const rows = await client.execute(`
        SELECT chat_id, unsubscribed_at, subscriber_data
        FROM telegram_subscribers
        ORDER BY chat_id ASC
      `);
      expect(rows.rows[0]).toMatchObject({
        chat_id: "12345",
        unsubscribed_at: null,
      });
      expect(JSON.parse(String(rows.rows[0]!.subscriber_data))).toEqual({
        source: "telegram.getChat",
        captured_at: "2026-06-11T11:00:00.000Z",
        description: "Crypto alerts",
        chat: {
          id: 12345,
          type: "private",
          username: "alex",
          bio: "Crypto alerts",
        },
      });
      expect(JSON.parse(String(rows.rows[1]!.subscriber_data))).toEqual({
        description: "already captured",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not write or call Telegram in dry-run mode", async () => {
    await repo.subscribe("12345", "2026-06-11T10:00:00.000Z");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      const result = await backfillTelegramSubscribers(
        client,
        { botToken: "token" },
        { dryRun: true, log: () => undefined },
      );

      expect(result).toEqual({
        normalizedSubscribed: 0,
        clearedActiveUnsubscribedAt: 0,
        candidates: 1,
        updated: 0,
        failed: 0,
      });
      expect(fetchMock).not.toHaveBeenCalled();

      const rows = await client.execute(`
        SELECT subscriber_data
        FROM telegram_subscribers
        WHERE chat_id = '12345'
      `);
      expect(rows.rows[0]?.subscriber_data).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
