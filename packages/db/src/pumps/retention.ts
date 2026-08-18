import type { Client, InStatement } from "@libsql/client";

export const DEFAULT_PUMP_RETENTION_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface PumpRetentionCounts {
  pumps: number;
  annotations: number;
  telegramVotes: number;
  telegramMessages: number;
}

export interface PumpRetentionResult extends PumpRetentionCounts {
  cutoffMs: number;
  cutoffUtc: string;
}

function count(value: unknown): number {
  return Number(value ?? 0);
}

function cutoffUtc(cutoffMs: number): string {
  if (!Number.isSafeInteger(cutoffMs)) {
    throw new Error("Pump retention cutoff must be a safe integer timestamp");
  }
  const cutoff = new Date(cutoffMs);
  if (Number.isNaN(cutoff.getTime())) {
    throw new Error("Pump retention cutoff is outside the supported date range");
  }
  return cutoff.toISOString();
}

export function parsePumpRetentionDays(raw: string | undefined): number {
  const value = raw?.trim();
  if (value == null || value === "") return DEFAULT_PUMP_RETENTION_DAYS;
  if (!/^\d+$/.test(value)) {
    throw new Error("PUMP_RETAIN_DAYS must be a positive integer");
  }
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1) {
    throw new Error("PUMP_RETAIN_DAYS must be a positive integer");
  }
  return days;
}

export function pumpRetentionCutoffMs(
  retentionDays: number,
  nowMs: number = Date.now(),
): number {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) {
    throw new Error("Pump retention days must be a positive integer");
  }
  if (!Number.isSafeInteger(nowMs)) {
    throw new Error("Pump retention reference time must be a safe integer timestamp");
  }
  const cutoffMs = nowMs - retentionDays * DAY_MS;
  cutoffUtc(cutoffMs);
  return cutoffMs;
}

export async function inspectPumpRetention(
  client: Client,
  cutoffMs: number,
): Promise<PumpRetentionResult> {
  const cutoffUtcValue = cutoffUtc(cutoffMs);
  const result = await client.execute({
    sql: `
      SELECT
        (SELECT COUNT(*) FROM pumps WHERE start_ms < ?) AS pumps,
        (
          SELECT COUNT(*)
          FROM pump_annotations a
          INNER JOIN pumps p ON p.id = a.event_id
          WHERE p.start_ms < ?
        ) AS annotations,
        (
          SELECT COUNT(*)
          FROM telegram_episode_votes v
          INNER JOIN pumps p ON p.id = v.episode_id
          WHERE p.start_ms < ?
        ) AS telegram_votes,
        (
          SELECT COUNT(*)
          FROM telegram_episode_messages m
          INNER JOIN pumps p ON p.id = m.episode_id
          WHERE p.start_ms < ?
        ) AS telegram_messages
    `.trim(),
    args: [cutoffMs, cutoffMs, cutoffMs, cutoffMs],
  });
  const row = result.rows[0];
  return {
    cutoffMs,
    cutoffUtc: cutoffUtcValue,
    pumps: count(row?.pumps),
    annotations: count(row?.annotations),
    telegramVotes: count(row?.telegram_votes),
    telegramMessages: count(row?.telegram_messages),
  };
}

export async function prunePumpsBefore(
  client: Client,
  cutoffMs: number,
): Promise<PumpRetentionResult> {
  const cutoffUtcValue = cutoffUtc(cutoffMs);
  const statements: InStatement[] = [
    {
      sql: `
        DELETE FROM pump_annotations
        WHERE event_id IN (SELECT id FROM pumps WHERE start_ms < ?)
      `.trim(),
      args: [cutoffMs],
    },
    {
      sql: `
        DELETE FROM telegram_episode_votes
        WHERE episode_id IN (SELECT id FROM pumps WHERE start_ms < ?)
      `.trim(),
      args: [cutoffMs],
    },
    {
      sql: `
        DELETE FROM telegram_episode_messages
        WHERE episode_id IN (SELECT id FROM pumps WHERE start_ms < ?)
      `.trim(),
      args: [cutoffMs],
    },
    {
      sql: "DELETE FROM pumps WHERE start_ms < ?",
      args: [cutoffMs],
    },
  ];
  const [annotations, telegramVotes, telegramMessages, pumps] = await client.batch(
    statements,
    "write",
  );

  return {
    cutoffMs,
    cutoffUtc: cutoffUtcValue,
    pumps: pumps?.rowsAffected ?? 0,
    annotations: annotations?.rowsAffected ?? 0,
    telegramVotes: telegramVotes?.rowsAffected ?? 0,
    telegramMessages: telegramMessages?.rowsAffected ?? 0,
  };
}
