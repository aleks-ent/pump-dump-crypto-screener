import type { Client } from "@libsql/client";
import type { PumpClassification } from "../pumps/types.js";

export interface TelegramEpisodeVoteCounts {
  pump: number;
  dump: number;
  none: number;
}

export interface TelegramEpisodeMessage {
  episodeId: string;
  chatId: string;
  messageId: number;
  sentAt: string;
}

export class TelegramEpisodeVotingRepository {
  constructor(private readonly client: Client) {}

  async upsertVote(
    episodeId: string,
    chatId: string,
    classification: PumpClassification,
    votedAt: string = new Date().toISOString(),
  ): Promise<void> {
    await this.client.execute({
      sql: `
        INSERT INTO telegram_episode_votes (
          episode_id,
          chat_id,
          classification,
          voted_at
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(episode_id, chat_id) DO UPDATE SET
          classification = excluded.classification,
          voted_at = excluded.voted_at
      `.trim(),
      args: [episodeId, chatId, classification, votedAt],
    });
  }

  async countVotes(episodeId: string): Promise<TelegramEpisodeVoteCounts> {
    const result = await this.client.execute({
      sql: `
        SELECT classification, COUNT(*) AS n
        FROM telegram_episode_votes
        WHERE episode_id = ?
        GROUP BY classification
      `.trim(),
      args: [episodeId],
    });

    const counts: TelegramEpisodeVoteCounts = { pump: 0, dump: 0, none: 0 };
    for (const row of result.rows) {
      const classification = row.classification;
      const count = Number(row.n ?? 0);
      if (
        classification === "pump" ||
        classification === "dump" ||
        classification === "none"
      ) {
        counts[classification] = count;
      }
    }
    return counts;
  }

  async recordMessage(
    episodeId: string,
    chatId: string,
    messageId: number,
    sentAt: string = new Date().toISOString(),
  ): Promise<void> {
    await this.client.execute({
      sql: `
        INSERT INTO telegram_episode_messages (
          episode_id,
          chat_id,
          message_id,
          sent_at
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(episode_id, chat_id) DO UPDATE SET
          message_id = excluded.message_id,
          sent_at = excluded.sent_at
      `.trim(),
      args: [episodeId, chatId, messageId, sentAt],
    });
  }

  async listMessages(episodeId: string): Promise<TelegramEpisodeMessage[]> {
    const result = await this.client.execute({
      sql: `
        SELECT episode_id, chat_id, message_id, sent_at
        FROM telegram_episode_messages
        WHERE episode_id = ?
        ORDER BY sent_at ASC, chat_id ASC
      `.trim(),
      args: [episodeId],
    });

    return result.rows.map((row) => ({
      episodeId: String(row.episode_id),
      chatId: String(row.chat_id),
      messageId: Number(row.message_id),
      sentAt: String(row.sent_at),
    }));
  }
}
