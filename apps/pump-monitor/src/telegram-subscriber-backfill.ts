import { setTimeout as sleep } from "node:timers/promises";
import type { createDbClient } from "@screener/db";
import {
  fetchTelegramSubscriberData,
  type TelegramApiConfig,
} from "./telegram.js";

type DbClient = ReturnType<typeof createDbClient>;

export interface TelegramSubscriberBackfillOptions {
  refreshExistingData?: boolean;
  dryRun?: boolean;
  limit?: number;
  delayMs?: number;
  now?: () => string;
  log?: (message: string) => void;
}

export interface TelegramSubscriberBackfillResult {
  normalizedSubscribed: number;
  clearedActiveUnsubscribedAt: number;
  candidates: number;
  updated: number;
  failed: number;
}

interface SubscriberBackfillRow {
  chat_id: unknown;
}

function rowsAffected(value: number | bigint | undefined): number {
  return Number(value ?? 0);
}

async function normalizeSubscriberState(
  client: DbClient,
): Promise<Pick<TelegramSubscriberBackfillResult, "normalizedSubscribed" | "clearedActiveUnsubscribedAt">> {
  const normalizedSubscribed = await client.execute(`
    UPDATE telegram_subscribers
    SET subscribed = 1
    WHERE subscribed IS NULL
  `);
  const clearedActiveUnsubscribedAt = await client.execute(`
    UPDATE telegram_subscribers
    SET unsubscribed_at = NULL
    WHERE subscribed = 1
      AND unsubscribed_at IS NOT NULL
  `);

  return {
    normalizedSubscribed: rowsAffected(normalizedSubscribed.rowsAffected),
    clearedActiveUnsubscribedAt: rowsAffected(
      clearedActiveUnsubscribedAt.rowsAffected,
    ),
  };
}

async function listBackfillCandidates(
  client: DbClient,
  opts: Pick<TelegramSubscriberBackfillOptions, "refreshExistingData" | "limit">,
): Promise<string[]> {
  const clauses = opts.refreshExistingData
    ? ["1 = 1"]
    : ["(subscriber_data IS NULL OR TRIM(subscriber_data) = '')"];
  const args: number[] = [];
  let sql = `
    SELECT chat_id
    FROM telegram_subscribers
    WHERE ${clauses.join(" AND ")}
    ORDER BY subscribed DESC, subscribed_at ASC, chat_id ASC
  `;

  if (opts.limit != null) {
    sql += " LIMIT ?";
    args.push(opts.limit);
  }

  const result = await client.execute({ sql, args });
  return (result.rows as SubscriberBackfillRow[]).map((row) =>
    String(row.chat_id),
  );
}

export async function backfillTelegramSubscribers(
  client: DbClient,
  telegram: TelegramApiConfig,
  opts: TelegramSubscriberBackfillOptions = {},
): Promise<TelegramSubscriberBackfillResult> {
  const log = opts.log ?? (() => undefined);
  const state = opts.dryRun
    ? { normalizedSubscribed: 0, clearedActiveUnsubscribedAt: 0 }
    : await normalizeSubscriberState(client);
  const candidates = await listBackfillCandidates(client, opts);

  if (opts.dryRun) {
    log(
      `Dry run: ${candidates.length} Telegram subscriber row(s) would be backfilled`,
    );
    return { ...state, candidates: candidates.length, updated: 0, failed: 0 };
  }

  let updated = 0;
  let failed = 0;
  const delayMs = opts.delayMs ?? 0;

  for (const [index, chatId] of candidates.entries()) {
    try {
      const subscriberData = await fetchTelegramSubscriberData(
        telegram,
        chatId,
        opts.now?.() ?? new Date().toISOString(),
      );
      await client.execute({
        sql: `
          UPDATE telegram_subscribers
          SET subscriber_data = ?
          WHERE chat_id = ?
        `,
        args: [subscriberData, chatId],
      });
      updated += 1;
      log(`Backfilled Telegram subscriber data for ${chatId}`);
    } catch (error) {
      failed += 1;
      log(
        `Failed to backfill Telegram subscriber data for ${chatId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (delayMs > 0 && index < candidates.length - 1) {
      await sleep(delayMs);
    }
  }

  return {
    ...state,
    candidates: candidates.length,
    updated,
    failed,
  };
}
