import type { Client } from "@libsql/client";

export interface MonitorRunRecord {
  id: number;
  startedAt: string;
  endedAt: string | null;
  newPumpsCount: number | null;
}

export class MonitorRunRepository {
  constructor(private readonly client: Client) {}

  async startRun(startedAt: string): Promise<number> {
    const result = await this.client.execute({
      sql: "INSERT INTO monitor_runs (started_at) VALUES (?)",
      args: [startedAt],
    });
    return Number(result.lastInsertRowid);
  }

  async finishRun(
    id: number,
    endedAt: string,
    newPumpsCount: number | null,
  ): Promise<void> {
    await this.client.execute({
      sql: `
        UPDATE monitor_runs
        SET ended_at = ?, new_pumps_count = ?
        WHERE id = ?
      `.trim(),
      args: [endedAt, newPumpsCount, id],
    });
  }

  async listRecentRuns(limit: number): Promise<MonitorRunRecord[]> {
    const result = await this.client.execute({
      sql: `
        SELECT id, started_at, ended_at, new_pumps_count
        FROM monitor_runs
        ORDER BY started_at DESC
        LIMIT ?
      `.trim(),
      args: [limit],
    });
    return result.rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: Number(record.id),
        startedAt: String(record.started_at),
        endedAt: record.ended_at == null ? null : String(record.ended_at),
        newPumpsCount:
          record.new_pumps_count == null ? null : Number(record.new_pumps_count),
      };
    });
  }

  async getLatestSuccessfulRun(): Promise<MonitorRunRecord | null> {
    const result = await this.client.execute(`
      SELECT id, started_at, ended_at, new_pumps_count
      FROM monitor_runs
      WHERE ended_at IS NOT NULL AND new_pumps_count IS NOT NULL
      ORDER BY started_at DESC
      LIMIT 1
    `.trim());
    const row = result.rows[0];
    if (!row) return null;
    const record = row as Record<string, unknown>;
    return {
      id: Number(record.id),
      startedAt: String(record.started_at),
      endedAt: String(record.ended_at),
      newPumpsCount: Number(record.new_pumps_count),
    };
  }

  async getRun(id: number): Promise<MonitorRunRecord | null> {
    const result = await this.client.execute({
      sql: `
        SELECT id, started_at, ended_at, new_pumps_count
        FROM monitor_runs
        WHERE id = ?
      `.trim(),
      args: [id],
    });
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows[0] as Record<string, unknown>;
    return {
      id: Number(row.id),
      startedAt: String(row.started_at),
      endedAt: row.ended_at == null ? null : String(row.ended_at),
      newPumpsCount:
        row.new_pumps_count == null ? null : Number(row.new_pumps_count),
    };
  }
}
