import type { Client } from "@libsql/client";

export class TelegramSubscriberRepository {
  constructor(private readonly client: Client) {}

  async subscribe(chatId: string, subscribedAt: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: `
        INSERT OR IGNORE INTO telegram_subscribers (chat_id, subscribed_at)
        VALUES (?, ?)
      `.trim(),
      args: [chatId, subscribedAt],
    });
    return result.rowsAffected > 0;
  }

  async unsubscribe(chatId: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: "DELETE FROM telegram_subscribers WHERE chat_id = ?",
      args: [chatId],
    });
    return result.rowsAffected > 0;
  }

  async listChatIds(): Promise<string[]> {
    const result = await this.client.execute(`
      SELECT chat_id
      FROM telegram_subscribers
      ORDER BY subscribed_at ASC, chat_id ASC
    `);
    return result.rows.map((row) => String(row.chat_id));
  }
}
