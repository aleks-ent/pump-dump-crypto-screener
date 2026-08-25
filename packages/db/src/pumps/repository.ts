import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Client, InValue } from "@libsql/client";
import type { PumpEpisode } from "@screener/pump-detector";
import { episodeIndexKey } from "./pump-id.js";
import type { PumpClassification, EpisodeType, StoredPump } from "./types.js";

const PUMP_COLUMNS = `
  id, coin, start_ms, start_utc, end_ms, end_utc, duration_minutes, peak_score,
  dominant_phase, leading_exchange, symbol_native, instrument_type, trading_view_url,
  confirmed, confirmed_exchanges, event_count, first_seen_at, last_seen_at, classification,
  episode_type
`.trim();

const UPSERT_SQL = `
  INSERT INTO pumps (${PUMP_COLUMNS})
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    coin = excluded.coin,
    start_ms = excluded.start_ms,
    start_utc = excluded.start_utc,
    end_ms = excluded.end_ms,
    end_utc = excluded.end_utc,
    duration_minutes = excluded.duration_minutes,
    peak_score = excluded.peak_score,
    dominant_phase = excluded.dominant_phase,
    leading_exchange = excluded.leading_exchange,
    symbol_native = excluded.symbol_native,
    instrument_type = excluded.instrument_type,
    trading_view_url = excluded.trading_view_url,
    confirmed = excluded.confirmed,
    confirmed_exchanges = excluded.confirmed_exchanges,
    event_count = excluded.event_count,
    last_seen_at = excluded.last_seen_at,
    episode_type = excluded.episode_type
`.trim();

function episodeToRow(episode: PumpEpisode, now: string): StoredPump {
  const index = episodeIndexKey(episode.type, episode.coin, episode.startMs);
  return {
    index,
    episodeType: episode.type,
    coin: episode.coin,
    startMs: episode.startMs,
    startUtc: new Date(episode.startMs).toISOString(),
    endMs: episode.endMs,
    endUtc: new Date(episode.endMs).toISOString(),
    durationMinutes: episode.durationMinutes,
    peakScore: episode.peakScore,
    dominantPhase: episode.dominantPhase,
    leadingExchange: episode.leadingExchange,
    symbolNative: episode.symbolNative,
    instrumentType: episode.instrumentType,
    tradingViewUrl: episode.tradingViewUrl,
    confirmed: episode.confirmed,
    confirmedExchanges: episode.confirmedExchanges,
    eventCount: episode.eventCount,
    firstSeenAt: now,
    lastSeenAt: now,
    classification: null,
  };
}

function rowToStoredPump(row: Record<string, unknown>): StoredPump {
  const confirmedExchanges = JSON.parse(String(row.confirmed_exchanges)) as string[];
  const classificationRaw = row.classification;
  const classification =
    classificationRaw === "pump" || classificationRaw === "dump" || classificationRaw === "none"
      ? classificationRaw
      : null;

  return {
    index: String(row.id),
    episodeType: row.episode_type === "dump" ? "dump" : "pump",
    coin: String(row.coin),
    startMs: Number(row.start_ms),
    startUtc: String(row.start_utc),
    endMs: Number(row.end_ms),
    endUtc: String(row.end_utc),
    durationMinutes: Number(row.duration_minutes),
    peakScore: Number(row.peak_score),
    dominantPhase: String(row.dominant_phase),
    leadingExchange: String(row.leading_exchange),
    symbolNative: String(row.symbol_native),
    instrumentType: String(row.instrument_type),
    tradingViewUrl: String(row.trading_view_url),
    confirmed: Number(row.confirmed) === 1,
    confirmedExchanges,
    eventCount: Number(row.event_count),
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    classification,
  };
}

function pumpToArgs(pump: StoredPump): InValue[] {
  return [
    pump.index,
    pump.coin,
    pump.startMs,
    pump.startUtc,
    pump.endMs,
    pump.endUtc,
    pump.durationMinutes,
    pump.peakScore,
    pump.dominantPhase,
    pump.leadingExchange,
    pump.symbolNative,
    pump.instrumentType,
    pump.tradingViewUrl,
    pump.confirmed ? 1 : 0,
    JSON.stringify(pump.confirmedExchanges),
    pump.eventCount,
    pump.firstSeenAt,
    pump.lastSeenAt,
    pump.classification,
    pump.episodeType,
  ];
}

export class PumpRepository {
  constructor(private readonly client: Client) {}

  async applySchema(schemaPath?: string): Promise<void> {
    await applySchema(this.client, schemaPath);
  }

  async countPumps(): Promise<number> {
    const result = await this.client.execute("SELECT COUNT(*) AS n FROM pumps");
    return Number(result.rows[0]?.n ?? 0);
  }

  async upsertPumpEpisodes(
    episodes: PumpEpisode[],
  ): Promise<{ newPumps: StoredPump[]; newDumps: StoredPump[] }> {
    const now = new Date().toISOString();
    const newPumps: StoredPump[] = [];
    const newDumps: StoredPump[] = [];

    for (const episode of episodes) {
      if (episode.type !== "pump" && episode.type !== "dump") continue;

      const id = episodeIndexKey(episode.type, episode.coin, episode.startMs);
      const existing = await this.client.execute({
        sql: "SELECT id, first_seen_at FROM pumps WHERE id = ?",
        args: [id],
      });
      const isNew = existing.rows.length === 0;

      const stored = episodeToRow(episode, now);
      if (!isNew) {
        stored.firstSeenAt = String(existing.rows[0]!.first_seen_at);
      }

      await this.client.execute({
        sql: UPSERT_SQL,
        args: pumpToArgs(stored),
      });

      if (isNew) {
        if (episode.type === "dump") newDumps.push(stored);
        else newPumps.push(stored);
      }
    }

    return { newPumps, newDumps };
  }

  async upsertStoredPump(pump: StoredPump): Promise<void> {
    await this.client.execute({
      sql: UPSERT_SQL,
      args: pumpToArgs(pump),
    });
  }

  async listStoredPumps(opts?: {
    minScore?: number;
    limit?: number;
    episodeType?: EpisodeType;
  }): Promise<StoredPump[]> {
    const args: InValue[] = [];
    const clauses: string[] = [];
    if (opts?.episodeType != null) {
      clauses.push("episode_type = ?");
      args.push(opts.episodeType);
    }
    if (opts?.minScore != null) {
      clauses.push("peak_score > ?");
      args.push(opts.minScore);
    }
    let sql = `SELECT ${PUMP_COLUMNS} FROM pumps`;
    if (clauses.length > 0) {
      sql += ` WHERE ${clauses.join(" AND ")}`;
    }
    sql += " ORDER BY start_utc DESC";
    if (opts?.limit != null) {
      sql += " LIMIT ?";
      args.push(opts.limit);
    }

    const result = await this.client.execute({ sql, args });
    return result.rows.map((row) => rowToStoredPump(row as Record<string, unknown>));
  }

  async getStoredPump(id: string): Promise<StoredPump | null> {
    const result = await this.client.execute({
      sql: `SELECT ${PUMP_COLUMNS} FROM pumps WHERE id = ?`,
      args: [id],
    });
    const row = result.rows[0];
    return row ? rowToStoredPump(row as Record<string, unknown>) : null;
  }

  async setClassification(id: string, classification: PumpClassification): Promise<void> {
    const result = await this.client.execute({
      sql: "UPDATE pumps SET classification = ? WHERE id = ?",
      args: [classification, id],
    });
    if (result.rowsAffected === 0) {
      throw new Error(`Pump not found: ${id}`);
    }
  }

  async getClassification(id: string): Promise<PumpClassification | null> {
    const result = await this.client.execute({
      sql: "SELECT classification FROM pumps WHERE id = ?",
      args: [id],
    });
    if (result.rows.length === 0) {
      throw new Error(`Pump not found: ${id}`);
    }
    const value = result.rows[0]!.classification;
    if (value === "pump" || value === "dump" || value === "none") {
      return value;
    }
    return null;
  }

  /**
   * Latest pump episode start per coin (for alert cooldown). Excludes episodes
   * whose start_ms is at or after `beforeStartMs` so upserts in the same run
   * are not counted as prior alerts.
   */
  async listRecentPumpStartsByCoin(beforeStartMs: number): Promise<Map<string, number>> {
    const result = await this.client.execute({
      sql: `
        SELECT coin, MAX(start_ms) AS start_ms
        FROM pumps
        WHERE episode_type = 'pump' AND start_ms < ?
        GROUP BY coin
      `,
      args: [beforeStartMs],
    });

    const out = new Map<string, number>();
    for (const row of result.rows) {
      out.set(String(row.coin), Number(row.start_ms));
    }
    return out;
  }
}

export function defaultSchemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "schema.sql"),
    join(here, "..", "schema.sql"),
    join(here, "..", "..", "schema.sql"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error(`schema.sql not found (searched from ${here})`);
}

export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

export async function applySchema(client: Client, schemaPath?: string): Promise<void> {
  const path = schemaPath ?? defaultSchemaPath();
  const statements = splitSqlStatements(readFileSync(path, "utf-8"));
  const createPumpAnnotations = statements.find((statement) =>
    /^CREATE TABLE IF NOT EXISTS pump_annotations\b/i.test(statement),
  );

  for (const statement of statements) {
    if (/^CREATE TABLE/i.test(statement)) {
      await client.execute(statement);
    }
  }

  // Legacy DBs have pumps without episode_type; indexes must run after this.
  await migratePumpsEpisodeType(client);
  await migrateTelegramSubscribersState(client);
  await backfillTelegramSubscriberEvents(client);
  await migrateTelegramEpisodeMessageKind(client);
  if (createPumpAnnotations != null) {
    await updatePumpAnnotationCategoryConstraint(client, createPumpAnnotations);
  }

  for (const statement of statements) {
    if (!/^CREATE TABLE/i.test(statement)) {
      await client.execute(statement);
    }
  }
}

async function updatePumpAnnotationCategoryConstraint(
  client: Client,
  createPumpAnnotations: string,
): Promise<void> {
  const table = await client.execute(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pump_annotations'",
  );
  const tableSql = String(table.rows[0]?.sql ?? "");
  if (!tableSql.includes("market_move")) return;

  const createReplacement = createPumpAnnotations.replace(
    /^CREATE TABLE IF NOT EXISTS/i,
    "CREATE TABLE",
  );
  await client.batch(
    [
      "ALTER TABLE pump_annotations RENAME TO pump_annotations_market_move_legacy",
      createReplacement,
      `
        INSERT INTO pump_annotations (
          id, event_id, source, category, confidence, comment, created_at, updated_at
        )
        SELECT
          id,
          event_id,
          source,
          category,
          confidence,
          comment,
          created_at,
          updated_at
        FROM pump_annotations_market_move_legacy
      `.trim(),
      "DROP TABLE pump_annotations_market_move_legacy",
    ],
    "write",
  );
}

async function migratePumpsEpisodeType(client: Client): Promise<void> {
  try {
    await client.execute("SELECT episode_type FROM pumps LIMIT 1");
  } catch {
    await client.execute(
      "ALTER TABLE pumps ADD COLUMN episode_type TEXT NOT NULL DEFAULT 'pump'",
    );
  }
}

async function migrateTelegramSubscribersState(client: Client): Promise<void> {
  try {
    await client.execute("SELECT subscribed FROM telegram_subscribers LIMIT 1");
  } catch {
    await client.execute(
      "ALTER TABLE telegram_subscribers ADD COLUMN subscribed INTEGER NOT NULL DEFAULT 1",
    );
  }

  try {
    await client.execute("SELECT unsubscribed_at FROM telegram_subscribers LIMIT 1");
  } catch {
    await client.execute(
      "ALTER TABLE telegram_subscribers ADD COLUMN unsubscribed_at TEXT",
    );
  }

  try {
    await client.execute("SELECT subscriber_data FROM telegram_subscribers LIMIT 1");
  } catch {
    await client.execute(
      "ALTER TABLE telegram_subscribers ADD COLUMN subscriber_data TEXT",
    );
  }
}

async function backfillTelegramSubscriberEvents(client: Client): Promise<void> {
  await client.batch(
    [
      `
        INSERT OR IGNORE INTO telegram_subscriber_events (
          chat_id,
          event_type,
          occurred_at
        )
        SELECT chat_id, 'subscribe', subscribed_at
        FROM telegram_subscribers
      `.trim(),
      `
        INSERT OR IGNORE INTO telegram_subscriber_events (
          chat_id,
          event_type,
          occurred_at
        )
        SELECT chat_id, 'unsubscribe', unsubscribed_at
        FROM telegram_subscribers
        WHERE subscribed = 0
          AND unsubscribed_at IS NOT NULL
      `.trim(),
    ],
    "write",
  );
}

async function migrateTelegramEpisodeMessageKind(client: Client): Promise<void> {
  try {
    await client.execute("SELECT message_kind FROM telegram_episode_messages LIMIT 1");
  } catch {
    await client.execute(
      `ALTER TABLE telegram_episode_messages
       ADD COLUMN message_kind TEXT NOT NULL DEFAULT 'text'
       CHECK (message_kind IN ('text', 'photo'))`,
    );
  }
}
