import type { Client } from "@libsql/client";

export interface TelegramSubscriberHistoryPoint {
  occurredAt: string;
  count: number;
}

export class TelegramSubscriberRepository {
  constructor(private readonly client: Client) {}

  async subscribe(
    chatId: string,
    subscribedAt: string,
    subscriberData: string | null = null,
    votingEnabled = true,
  ): Promise<boolean> {
    const results = await this.client.batch(
      [
        {
          sql: `
            INSERT INTO telegram_subscribers (
              chat_id,
              subscribed_at,
              subscribed,
              voting_enabled,
              unsubscribed_at,
              subscriber_data
            )
            VALUES (?, ?, 1, ?, NULL, ?)
            ON CONFLICT(chat_id) DO UPDATE SET
              subscribed_at = CASE
                WHEN excluded.voting_enabled = 1
                  AND (
                    telegram_subscribers.subscribed = 0
                    OR telegram_subscribers.voting_enabled = 0
                  )
                  THEN excluded.subscribed_at
                ELSE telegram_subscribers.subscribed_at
              END,
              subscribed = 1,
              voting_enabled = excluded.voting_enabled,
              unsubscribed_at = CASE
                WHEN telegram_subscribers.subscribed = 1
                  AND telegram_subscribers.voting_enabled = 1
                  AND excluded.voting_enabled = 0
                  THEN excluded.subscribed_at
                WHEN excluded.voting_enabled = 1 THEN NULL
                ELSE telegram_subscribers.unsubscribed_at
              END,
              subscriber_data = COALESCE(
                excluded.subscriber_data,
                telegram_subscribers.subscriber_data
              )
            WHERE telegram_subscribers.subscribed = 0
              OR telegram_subscribers.voting_enabled IS NOT excluded.voting_enabled
              OR (
                excluded.subscriber_data IS NOT NULL
                AND telegram_subscribers.subscriber_data IS NOT excluded.subscriber_data
              )
          `.trim(),
          args: [chatId, subscribedAt, votingEnabled ? 1 : 0, subscriberData],
        },
        {
          sql: `
            INSERT OR IGNORE INTO telegram_subscriber_events (
              chat_id,
              event_type,
              occurred_at
            )
            SELECT chat_id, 'subscribe', ?
            FROM telegram_subscribers
            WHERE chat_id = ?
              AND subscribed = 1
              AND voting_enabled = 1
              AND subscribed_at = ?
          `.trim(),
          args: [subscribedAt, chatId, subscribedAt],
        },
        {
          sql: `
            INSERT OR IGNORE INTO telegram_subscriber_events (
              chat_id,
              event_type,
              occurred_at
            )
            SELECT chat_id, 'unsubscribe', ?
            FROM telegram_subscribers
            WHERE chat_id = ?
              AND subscribed = 1
              AND voting_enabled = 0
              AND unsubscribed_at = ?
          `.trim(),
          args: [subscribedAt, chatId, subscribedAt],
        },
      ],
      "write",
    );
    return results[0]!.rowsAffected > 0;
  }

  async unsubscribe(
    chatId: string,
    unsubscribedAt: string = new Date().toISOString(),
  ): Promise<boolean> {
    const results = await this.client.batch(
      [
        {
          sql: `
            UPDATE telegram_subscribers
            SET subscribed = 0,
                unsubscribed_at = ?
            WHERE chat_id = ?
              AND subscribed = 1
          `.trim(),
          args: [unsubscribedAt, chatId],
        },
        {
          sql: `
            INSERT OR IGNORE INTO telegram_subscriber_events (
              chat_id,
              event_type,
              occurred_at
            )
            SELECT chat_id, 'unsubscribe', ?
            FROM telegram_subscribers
            WHERE chat_id = ?
              AND subscribed = 0
              AND voting_enabled = 1
              AND unsubscribed_at = ?
          `.trim(),
          args: [unsubscribedAt, chatId, unsubscribedAt],
        },
      ],
      "write",
    );
    return results[0]!.rowsAffected > 0;
  }

  async listChatIds(): Promise<string[]> {
    const result = await this.client.execute(`
      SELECT chat_id
      FROM telegram_subscribers
      WHERE subscribed = 1
        AND voting_enabled = 1
      ORDER BY subscribed_at ASC, chat_id ASC
    `);
    return result.rows.map((row) => String(row.chat_id));
  }

  async countActive(): Promise<number> {
    const result = await this.client.execute(`
      SELECT COUNT(*) AS count
      FROM telegram_subscribers
      WHERE subscribed = 1
        AND voting_enabled = 1
    `);
    return Number(result.rows[0]?.count ?? 0);
  }

  async listHistory(): Promise<TelegramSubscriberHistoryPoint[]> {
    const result = await this.client.execute(`
      SELECT
        occurred_at,
        SUM(CASE event_type WHEN 'subscribe' THEN 1 ELSE -1 END) AS delta
      FROM telegram_subscriber_events
      GROUP BY occurred_at
      ORDER BY occurred_at ASC
    `);

    let count = 0;
    return result.rows.map((row) => {
      count = Math.max(0, count + Number(row.delta));
      return {
        occurredAt: String(row.occurred_at),
        count,
      };
    });
  }

  async isSubscribed(chatId: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: `
        SELECT 1
        FROM telegram_subscribers
        WHERE chat_id = ?
          AND subscribed = 1
          AND voting_enabled = 1
        LIMIT 1
      `.trim(),
      args: [chatId],
    });
    return result.rows.length > 0;
  }
}
