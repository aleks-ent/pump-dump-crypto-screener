import type { Client } from "@libsql/client";

export class TelegramSubscriberRepository {
  constructor(private readonly client: Client) {}

  async subscribe(
    chatId: string,
    subscribedAt: string,
    subscriberData: string | null = null,
  ): Promise<boolean> {
    const result = await this.client.execute({
      sql: `
        INSERT INTO telegram_subscribers (
          chat_id,
          subscribed_at,
          subscribed,
          unsubscribed_at,
          subscriber_data
        )
        VALUES (?, ?, 1, NULL, ?)
        ON CONFLICT(chat_id) DO UPDATE SET
          subscribed_at = CASE
            WHEN telegram_subscribers.subscribed = 0 THEN excluded.subscribed_at
            ELSE telegram_subscribers.subscribed_at
          END,
          subscribed = 1,
          unsubscribed_at = NULL,
          subscriber_data = COALESCE(
            excluded.subscriber_data,
            telegram_subscribers.subscriber_data
          )
        WHERE telegram_subscribers.subscribed = 0
          OR (
            excluded.subscriber_data IS NOT NULL
            AND telegram_subscribers.subscriber_data IS NOT excluded.subscriber_data
          )
      `.trim(),
      args: [chatId, subscribedAt, subscriberData],
    });
    return result.rowsAffected > 0;
  }

  async unsubscribe(
    chatId: string,
    unsubscribedAt: string = new Date().toISOString(),
  ): Promise<boolean> {
    const result = await this.client.execute({
      sql: `
        UPDATE telegram_subscribers
        SET subscribed = 0,
            unsubscribed_at = ?
        WHERE chat_id = ?
          AND subscribed = 1
      `.trim(),
      args: [unsubscribedAt, chatId],
    });
    return result.rowsAffected > 0;
  }

  async listChatIds(): Promise<string[]> {
    const result = await this.client.execute(`
      SELECT chat_id
      FROM telegram_subscribers
      WHERE subscribed = 1
      ORDER BY subscribed_at ASC, chat_id ASC
    `);
    return result.rows.map((row) => String(row.chat_id));
  }
}
