import { describe, expect, it, beforeEach } from "vitest";
import type { PumpEpisode } from "@screener/pump-detector";
import { createMemoryDbClient } from "../client.js";
import { pumpIndexKey } from "./pump-id.js";
import { PumpRepository, applySchema } from "./repository.js";

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

describe("applySchema", () => {
  it("uses the leading exchange index for review filters", async () => {
    const client = createMemoryDbClient();
    await applySchema(client);

    const plan = await client.execute({
      sql: `
        EXPLAIN QUERY PLAN
        SELECT COUNT(*)
        FROM pumps p
        LEFT JOIN pump_annotations a
          ON a.event_id = p.id AND a.source = 'human'
        WHERE p.episode_type = 'pump'
          AND p.leading_exchange = ? COLLATE NOCASE
      `,
      args: ["BINANCE"],
    });
    const details = plan.rows.map((row) => String(row.detail)).join("\n");

    expect(details).toContain("idx_pumps_leading_exchange");
  });

  it("migrates legacy pumps table missing episode_type", async () => {
    const client = createMemoryDbClient();
    await client.execute(`
      CREATE TABLE pumps (
        id                  TEXT PRIMARY KEY NOT NULL,
        coin                TEXT NOT NULL,
        start_ms            INTEGER NOT NULL,
        start_utc           TEXT NOT NULL,
        end_ms              INTEGER NOT NULL,
        end_utc             TEXT NOT NULL,
        duration_minutes    INTEGER NOT NULL,
        peak_score          REAL NOT NULL,
        dominant_phase      TEXT NOT NULL,
        leading_exchange    TEXT NOT NULL,
        symbol_native       TEXT NOT NULL,
        instrument_type     TEXT NOT NULL,
        trading_view_url    TEXT NOT NULL,
        confirmed           INTEGER NOT NULL DEFAULT 0,
        confirmed_exchanges TEXT NOT NULL,
        event_count         INTEGER NOT NULL,
        first_seen_at       TEXT NOT NULL,
        last_seen_at        TEXT NOT NULL,
        classification      TEXT
      )
    `);

    await applySchema(client);

    const repo = new PumpRepository(client);
    const { newPumps } = await repo.upsertPumpEpisodes([
      samplePump("LEGACY/USDT", Date.parse("2026-06-05T12:00:00.000Z")),
    ]);
    expect(newPumps).toHaveLength(1);
    expect(newPumps[0]!.episodeType).toBe("pump");
  });

  it("marks legacy Telegram alert references as text messages", async () => {
    const client = createMemoryDbClient();
    await client.execute(`
      CREATE TABLE telegram_episode_messages (
        episode_id TEXT NOT NULL,
        chat_id    TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        sent_at    TEXT NOT NULL,
        PRIMARY KEY (episode_id, chat_id)
      )
    `);

    await applySchema(client);

    const columns = await client.execute(
      "PRAGMA table_info(telegram_episode_messages)",
    );
    const messageKind = columns.rows.find((row) => row.name === "message_kind");
    expect(messageKind).toMatchObject({ notnull: 1, dflt_value: "'text'" });
  });

  it("updates the annotation category constraint without rewriting stored labels", async () => {
    const client = createMemoryDbClient();
    await applySchema(client);
    const repo = new PumpRepository(client);
    const { newPumps } = await repo.upsertPumpEpisodes([
      samplePump("SMALL/USDT", Date.parse("2026-07-05T12:00:00.000Z")),
    ]);
    const eventId = newPumps[0]!.index;

    await client.execute("DROP TABLE pump_annotations");
    await client.execute(`
      CREATE TABLE pump_annotations (
        id         TEXT PRIMARY KEY NOT NULL,
        event_id   TEXT NOT NULL,
        source     TEXT NOT NULL DEFAULT 'human'
                   CHECK (source IN ('human', 'ai')),
        category   TEXT NOT NULL
                   CHECK (category IN (
                     'sustained_move',
                     'wick_spike',
                     'volume_only',
                     'market_move',
                     'illiquid_noise',
                     'unclear'
                   )),
        confidence TEXT,
        comment    TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (event_id, source),
        FOREIGN KEY (event_id) REFERENCES pumps(id) ON DELETE CASCADE
      )
    `);
    await client.execute({
      sql: `
        INSERT INTO pump_annotations (
          id, event_id, source, category, confidence, comment, created_at, updated_at
        ) VALUES (?, ?, 'human', 'wick_spike', 'medium', ?, ?, ?)
      `,
      args: [
        "legacy-annotation",
        eventId,
        "Small move.",
        "2026-08-01T10:00:00.000Z",
        "2026-08-01T10:00:00.000Z",
      ],
    });

    await applySchema(client);

    const migrated = await client.execute(
      "SELECT id, category, comment FROM pump_annotations",
    );
    expect(migrated.rows).toEqual([
      {
        id: "legacy-annotation",
        category: "wick_spike",
        comment: "Small move.",
      },
    ]);
    await client.execute(
      "UPDATE pump_annotations SET category = 'weak_pump'",
    );
    const updated = await client.execute(
      "SELECT category FROM pump_annotations",
    );
    expect(updated.rows[0]?.category).toBe("weak_pump");
    await expect(
      client.execute("UPDATE pump_annotations SET category = 'market_move'"),
    ).rejects.toThrow();
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

  it("stores dump episodes separately from pumps", async () => {
    const startMs = Date.parse("2026-06-05T13:00:00.000Z");
    const { newPumps, newDumps } = await repo.upsertPumpEpisodes([
      {
        ...samplePump("ETH/USDT", startMs),
        type: "dump",
        dominantPhase: "distribution_or_fade",
      },
    ]);
    expect(newPumps).toHaveLength(0);
    expect(newDumps).toHaveLength(1);
    expect(await repo.countPumps()).toBe(1);

    const dumps = await repo.listStoredPumps({ episodeType: "dump" });
    expect(dumps).toHaveLength(1);
    expect(dumps[0]!.episodeType).toBe("dump");
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

  it("limits results to newest pumps", async () => {
    await repo.upsertPumpEpisodes([
      samplePump("P1/USDT", Date.parse("2026-06-01T10:00:00.000Z"), 90),
      samplePump("P2/USDT", Date.parse("2026-06-02T10:00:00.000Z"), 90),
      samplePump("P3/USDT", Date.parse("2026-06-03T10:00:00.000Z"), 90),
      samplePump("P4/USDT", Date.parse("2026-06-04T10:00:00.000Z"), 90),
      samplePump("P5/USDT", Date.parse("2026-06-05T10:00:00.000Z"), 90),
      samplePump("P6/USDT", Date.parse("2026-06-06T10:00:00.000Z"), 90),
    ]);

    const pumps = await repo.listStoredPumps({ limit: 5 });
    expect(pumps.map((p) => p.coin)).toEqual([
      "P6/USDT",
      "P5/USDT",
      "P4/USDT",
      "P3/USDT",
      "P2/USDT",
    ]);
  });

  it("gets one stored episode by id", async () => {
    const startMs = Date.parse("2026-06-05T12:00:00.000Z");
    const { newPumps } = await repo.upsertPumpEpisodes([
      samplePump("BTC/USDT", startMs),
    ]);

    const stored = await repo.getStoredPump(newPumps[0]!.index);
    expect(stored?.coin).toBe("BTC/USDT");
    expect(await repo.getStoredPump("missing")).toBeNull();
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

  it("listRecentPumpStartsByCoin returns latest start per coin before a cutoff", async () => {
    const early = Date.parse("2026-06-10T01:00:00.000Z");
    const later = Date.parse("2026-06-10T05:00:00.000Z");
    await repo.upsertPumpEpisodes([
      samplePump("AIO/USDT", early),
      samplePump("AIO/USDT", later),
      samplePump("ZKP/USDT", early),
    ]);

    const recent = await repo.listRecentPumpStartsByCoin(later + 1);
    expect(recent.get("AIO/USDT")).toBe(later);
    expect(recent.get("ZKP/USDT")).toBe(early);
    expect(recent.has("MISSING/USDT")).toBe(false);
  });
});
