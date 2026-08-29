import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDbClient } from "../client.js";
import { PumpRepository, applySchema } from "../pumps/repository.js";
import { TelegramSubscriberRepository } from "./repository.js";

describe("TelegramSubscriberRepository", () => {
  let repo: TelegramSubscriberRepository;
  let client: ReturnType<typeof createMemoryDbClient>;

  beforeEach(async () => {
    client = createMemoryDbClient();
    await new PumpRepository(client).applySchema();
    repo = new TelegramSubscriberRepository(client);
  });

  it("subscribes each chat once and lists active subscribers", async () => {
    expect(
      await repo.subscribe("12345", "2026-06-11T10:00:00.000Z"),
    ).toBe(true);
    expect(
      await repo.subscribe("12345", "2026-06-11T10:01:00.000Z"),
    ).toBe(false);
    expect(
      await repo.subscribe("-10098765", "2026-06-11T10:02:00.000Z"),
    ).toBe(true);

    expect(await repo.listChatIds()).toEqual(["12345", "-10098765"]);
    expect(await repo.countActive()).toBe(2);
    expect(await repo.isSubscribed("12345")).toBe(true);
    expect(await repo.isSubscribed("missing")).toBe(false);
  });

  it("stores Telegram subscriber data when provided", async () => {
    const subscriberData = JSON.stringify({
      source: "telegram.getChat",
      description: "Momentum scanner alerts",
      chat: { id: 12345, type: "private", username: "alex" },
    });

    expect(
      await repo.subscribe(
        "12345",
        "2026-06-11T10:00:00.000Z",
        subscriberData,
      ),
    ).toBe(true);

    const result = await client.execute({
      sql: "SELECT subscriber_data FROM telegram_subscribers WHERE chat_id = ?",
      args: ["12345"],
    });
    expect(result.rows[0]?.subscriber_data).toBe(subscriberData);
  });

  it("keeps a read-only delivery recipient out of the voting subscriber list", async () => {
    expect(
      await repo.subscribe(
        "-10098765",
        "2026-06-11T10:00:00.000Z",
        null,
        false,
      ),
    ).toBe(true);

    expect(await repo.listChatIds()).toEqual([]);
    expect(await repo.countActive()).toBe(0);
    expect(await repo.isSubscribed("-10098765")).toBe(false);
    expect(await repo.listHistory()).toEqual([]);

    await applySchema(client);
    expect(await repo.listHistory()).toEqual([]);

    const result = await client.execute({
      sql: `
        SELECT subscribed, voting_enabled
        FROM telegram_subscribers
        WHERE chat_id = ?
      `,
      args: ["-10098765"],
    });
    expect(result.rows[0]).toMatchObject({
      subscribed: 1,
      voting_enabled: 0,
    });
  });

  it("tracks voting capability changes without counting a read-only feed", async () => {
    await repo.subscribe("-10098765", "2026-06-11T10:00:00.000Z");
    await repo.subscribe(
      "-10098765",
      "2026-06-11T11:00:00.000Z",
      null,
      false,
    );
    expect(
      await repo.subscribe(
        "-10098765",
        "2026-06-11T12:00:00.000Z",
        null,
        false,
      ),
    ).toBe(false);
    await repo.subscribe("-10098765", "2026-06-11T13:00:00.000Z");

    expect(await repo.listHistory()).toEqual([
      { occurredAt: "2026-06-11T10:00:00.000Z", count: 1 },
      { occurredAt: "2026-06-11T11:00:00.000Z", count: 0 },
      { occurredAt: "2026-06-11T13:00:00.000Z", count: 1 },
    ]);
  });

  it("marks an existing chat unsubscribed without deleting its row", async () => {
    await repo.subscribe("12345", "2026-06-11T10:00:00.000Z");
    expect(
      await repo.unsubscribe("12345", "2026-06-11T11:00:00.000Z"),
    ).toBe(true);
    expect(
      await repo.unsubscribe("12345", "2026-06-11T11:05:00.000Z"),
    ).toBe(false);
    expect(await repo.listChatIds()).toEqual([]);
    expect(await repo.countActive()).toBe(0);
    expect(await repo.isSubscribed("12345")).toBe(false);

    const result = await client.execute({
      sql: `
        SELECT chat_id, subscribed_at, subscribed, unsubscribed_at
        FROM telegram_subscribers
        WHERE chat_id = ?
      `,
      args: ["12345"],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      chat_id: "12345",
      subscribed_at: "2026-06-11T10:00:00.000Z",
      subscribed: 0,
      unsubscribed_at: "2026-06-11T11:00:00.000Z",
    });
  });

  it("reactivates an unsubscribed chat on subscribe", async () => {
    await repo.subscribe("12345", "2026-06-11T10:00:00.000Z");
    await repo.unsubscribe("12345", "2026-06-11T11:00:00.000Z");
    const subscriberData = JSON.stringify({
      source: "telegram.getChat",
      description: "Rejoined",
      chat: { id: 12345, type: "private", username: "alex" },
    });

    expect(
      await repo.subscribe(
        "12345",
        "2026-06-11T12:00:00.000Z",
        subscriberData,
      ),
    ).toBe(true);
    expect(await repo.listChatIds()).toEqual(["12345"]);
    expect(await repo.countActive()).toBe(1);

    const result = await client.execute({
      sql: `
        SELECT subscribed_at, subscribed, unsubscribed_at, subscriber_data
        FROM telegram_subscribers
        WHERE chat_id = ?
      `,
      args: ["12345"],
    });
    expect(result.rows[0]).toMatchObject({
      subscribed_at: "2026-06-11T12:00:00.000Z",
      subscribed: 1,
      unsubscribed_at: null,
      subscriber_data: subscriberData,
    });
  });

  it("builds an aggregate history across subscription lifecycle changes", async () => {
    await repo.subscribe("111", "2026-06-11T10:00:00.000Z");
    await repo.subscribe("222", "2026-06-11T10:00:00.000Z");
    await repo.unsubscribe("111", "2026-06-11T11:00:00.000Z");
    await repo.subscribe("111", "2026-06-11T12:00:00.000Z");

    expect(await repo.listHistory()).toEqual([
      { occurredAt: "2026-06-11T10:00:00.000Z", count: 2 },
      { occurredAt: "2026-06-11T11:00:00.000Z", count: 1 },
      { occurredAt: "2026-06-11T12:00:00.000Z", count: 2 },
    ]);
  });

  it("refreshes subscriber data without resetting an active subscription time", async () => {
    await repo.subscribe(
      "12345",
      "2026-06-11T10:00:00.000Z",
      JSON.stringify({ description: "old" }),
    );
    const subscriberData = JSON.stringify({ description: "new" });

    expect(
      await repo.subscribe(
        "12345",
        "2026-06-11T12:00:00.000Z",
        subscriberData,
      ),
    ).toBe(true);

    const result = await client.execute({
      sql: `
        SELECT subscribed_at, subscriber_data
        FROM telegram_subscribers
        WHERE chat_id = ?
      `,
      args: ["12345"],
    });
    expect(result.rows[0]).toMatchObject({
      subscribed_at: "2026-06-11T10:00:00.000Z",
      subscriber_data: subscriberData,
    });
    expect(await repo.listHistory()).toEqual([
      { occurredAt: "2026-06-11T10:00:00.000Z", count: 1 },
    ]);
  });

  it("migrates legacy subscriber rows as active", async () => {
    const client = createMemoryDbClient();
    await client.execute(`
      CREATE TABLE telegram_subscribers (
        chat_id       TEXT PRIMARY KEY NOT NULL,
        subscribed_at TEXT NOT NULL
      )
    `);
    await client.execute({
      sql: `
        INSERT INTO telegram_subscribers (chat_id, subscribed_at)
        VALUES (?, ?)
      `,
      args: ["12345", "2026-06-11T10:00:00.000Z"],
    });

    await applySchema(client);
    const legacyRepo = new TelegramSubscriberRepository(client);

    expect(await legacyRepo.listChatIds()).toEqual(["12345"]);
    expect(await legacyRepo.listHistory()).toEqual([
      { occurredAt: "2026-06-11T10:00:00.000Z", count: 1 },
    ]);
    expect(
      await legacyRepo.unsubscribe("12345", "2026-06-11T11:00:00.000Z"),
    ).toBe(true);
    await applySchema(client);

    const result = await client.execute({
      sql: `
        SELECT subscribed, voting_enabled, unsubscribed_at, subscriber_data
        FROM telegram_subscribers
        WHERE chat_id = ?
      `,
      args: ["12345"],
    });
    expect(result.rows[0]).toMatchObject({
      subscribed: 0,
      voting_enabled: 1,
      unsubscribed_at: "2026-06-11T11:00:00.000Z",
      subscriber_data: null,
    });
    expect(await legacyRepo.listHistory()).toEqual([
      { occurredAt: "2026-06-11T10:00:00.000Z", count: 1 },
      { occurredAt: "2026-06-11T11:00:00.000Z", count: 0 },
    ]);
  });

  it("backfills current subscriber state into history idempotently", async () => {
    const client = createMemoryDbClient();
    await client.execute(`
      CREATE TABLE telegram_subscribers (
        chat_id         TEXT PRIMARY KEY NOT NULL,
        subscribed_at   TEXT NOT NULL,
        subscribed      INTEGER NOT NULL DEFAULT 1,
        unsubscribed_at TEXT,
        subscriber_data TEXT
      )
    `);
    await client.batch(
      [
        {
          sql: `
            INSERT INTO telegram_subscribers (
              chat_id, subscribed_at, subscribed, unsubscribed_at
            )
            VALUES (?, ?, 1, NULL)
          `,
          args: ["active", "2026-06-11T10:00:00.000Z"],
        },
        {
          sql: `
            INSERT INTO telegram_subscribers (
              chat_id, subscribed_at, subscribed, unsubscribed_at
            )
            VALUES (?, ?, 0, ?)
          `,
          args: [
            "inactive",
            "2026-06-11T10:30:00.000Z",
            "2026-06-11T11:00:00.000Z",
          ],
        },
      ],
      "write",
    );

    await applySchema(client);
    await applySchema(client);

    const migratedRepo = new TelegramSubscriberRepository(client);
    expect(await migratedRepo.listHistory()).toEqual([
      { occurredAt: "2026-06-11T10:00:00.000Z", count: 1 },
      { occurredAt: "2026-06-11T10:30:00.000Z", count: 2 },
      { occurredAt: "2026-06-11T11:00:00.000Z", count: 1 },
    ]);
  });
});
