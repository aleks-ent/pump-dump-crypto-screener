import { randomUUID } from "node:crypto";
import type { Client, InValue } from "@libsql/client";
import type { StoredPump } from "../pumps/types.js";
import {
  PUMP_CATEGORIES,
  type AnnotationSource,
  type PaginatedPumpReviewEvents,
  type PumpAnnotation,
  type PumpEventFilters,
  type PumpReviewEvent,
  type PumpReviewStats,
  type ReviewStatus,
  type UpsertPumpAnnotationInput,
  isAnnotationConfidence,
  isPumpCategory,
} from "./types.js";

const PUMP_COLUMNS = `
  p.id, p.coin, p.start_ms, p.start_utc, p.end_ms, p.end_utc,
  p.duration_minutes, p.peak_score, p.dominant_phase, p.leading_exchange,
  p.symbol_native, p.instrument_type, p.trading_view_url, p.confirmed,
  p.confirmed_exchanges, p.event_count, p.first_seen_at, p.last_seen_at,
  p.classification, p.episode_type
`.trim();

const ANNOTATION_COLUMNS = `
  a.id AS annotation_id,
  a.event_id AS annotation_event_id,
  a.source AS annotation_source,
  a.category AS annotation_category,
  a.confidence AS annotation_confidence,
  a.comment AS annotation_comment,
  a.created_at AS annotation_created_at,
  a.updated_at AS annotation_updated_at
`.trim();

const HUMAN_ANNOTATION_JOIN = `
  LEFT JOIN pump_annotations a
    ON a.event_id = p.id AND a.source = 'human'
`.trim();

function rowToStoredPump(row: Record<string, unknown>): StoredPump {
  const classification = row.classification;
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
    confirmedExchanges: JSON.parse(String(row.confirmed_exchanges)) as string[],
    eventCount: Number(row.event_count),
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    classification:
      classification === "pump" || classification === "dump" || classification === "none"
        ? classification
        : null,
  };
}

function rowToAnnotation(row: Record<string, unknown>): PumpAnnotation | null {
  if (row.annotation_id == null) return null;

  const category = row.annotation_category;
  const confidence = row.annotation_confidence;
  if (!isPumpCategory(category)) {
    throw new Error(`Invalid stored pump annotation category: ${String(category)}`);
  }
  if (confidence != null && !isAnnotationConfidence(confidence)) {
    throw new Error(`Invalid stored pump annotation confidence: ${String(confidence)}`);
  }

  return {
    id: String(row.annotation_id),
    eventId: String(row.annotation_event_id),
    source: row.annotation_source === "ai" ? "ai" : "human",
    category,
    confidence: confidence ?? null,
    comment: row.annotation_comment == null ? null : String(row.annotation_comment),
    createdAt: String(row.annotation_created_at),
    updatedAt: String(row.annotation_updated_at),
  };
}

function annotationRowToAnnotation(row: Record<string, unknown>): PumpAnnotation {
  return rowToAnnotation({
    annotation_id: row.id,
    annotation_event_id: row.event_id,
    annotation_source: row.source,
    annotation_category: row.category,
    annotation_confidence: row.confidence,
    annotation_comment: row.comment,
    annotation_created_at: row.created_at,
    annotation_updated_at: row.updated_at,
  })!;
}

function reviewStatus(annotation: PumpAnnotation | null): ReviewStatus {
  if (annotation == null) return "unreviewed";
  return annotation.category === "unclear" ? "unclear" : "reviewed";
}

function rowToReviewEvent(row: Record<string, unknown>): PumpReviewEvent {
  const annotation = rowToAnnotation(row);
  return {
    pump: rowToStoredPump(row),
    annotation,
    status: reviewStatus(annotation),
  };
}

function validateSource(source: unknown): asserts source is AnnotationSource {
  if (source !== "human" && source !== "ai") {
    throw new Error(`Invalid pump annotation source: ${String(source)}`);
  }
}

function buildEventWhere(filters: PumpEventFilters): {
  clauses: string[];
  args: InValue[];
} {
  const clauses = ["p.episode_type = 'pump'"];
  const args: InValue[] = [];

  if (filters.status != null && filters.status !== "all") {
    if (filters.status === "unreviewed") clauses.push("a.event_id IS NULL");
    if (filters.status === "reviewed") {
      clauses.push("a.event_id IS NOT NULL AND a.category <> 'unclear'");
    }
    if (filters.status === "unclear") clauses.push("a.category = 'unclear'");
  }
  if (filters.category != null) {
    if (!isPumpCategory(filters.category)) {
      throw new Error(`Invalid pump category: ${String(filters.category)}`);
    }
    clauses.push("a.category = ?");
    args.push(filters.category);
  }
  if (filters.exchange != null && filters.exchange !== "") {
    clauses.push("p.leading_exchange = ? COLLATE NOCASE");
    args.push(filters.exchange);
  }
  if (filters.symbol != null && filters.symbol.trim() !== "") {
    clauses.push("(p.symbol_native LIKE ? COLLATE NOCASE OR p.coin LIKE ? COLLATE NOCASE)");
    const pattern = `%${filters.symbol.trim()}%`;
    args.push(pattern, pattern);
  }
  if (filters.dateFromMs != null) {
    clauses.push("p.start_ms >= ?");
    args.push(filters.dateFromMs);
  }
  if (filters.dateToMs != null) {
    clauses.push("p.start_ms < ?");
    args.push(filters.dateToMs);
  }

  return { clauses, args };
}

function orderBy(sort: PumpEventFilters["sort"]): string {
  switch (sort) {
    case "detectedAtAsc":
      return "p.start_ms ASC, p.id ASC";
    case "unreviewedFirst":
      return "CASE WHEN a.event_id IS NULL THEN 0 ELSE 1 END ASC, p.start_ms ASC, p.id ASC";
    case "symbolAsc":
      return "p.symbol_native COLLATE NOCASE ASC, p.start_ms ASC, p.id ASC";
    case "detectedAtDesc":
    default:
      return "p.start_ms DESC, p.id ASC";
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value != null && Number.isInteger(value) && value > 0 ? value : fallback;
}

export class PumpReviewRepository {
  constructor(private readonly client: Client) {}

  async getAnnotation(
    eventId: string,
    source: AnnotationSource = "human",
  ): Promise<PumpAnnotation | null> {
    validateSource(source);
    const result = await this.client.execute({
      sql: `
        SELECT id, event_id, source, category, confidence, comment, created_at, updated_at
        FROM pump_annotations
        WHERE event_id = ? AND source = ?
      `.trim(),
      args: [eventId, source],
    });
    const row = result.rows[0];
    return row ? annotationRowToAnnotation(row as Record<string, unknown>) : null;
  }

  async upsertAnnotation(
    input: UpsertPumpAnnotationInput,
    updatedAt: string = new Date().toISOString(),
  ): Promise<PumpAnnotation> {
    const source = input.source ?? "human";
    validateSource(source);
    if (!isPumpCategory(input.category)) {
      throw new Error(`Invalid pump category: ${String(input.category)}`);
    }
    if (input.confidence != null && !isAnnotationConfidence(input.confidence)) {
      throw new Error(`Invalid annotation confidence: ${String(input.confidence)}`);
    }

    const event = await this.client.execute({
      sql: "SELECT id FROM pumps WHERE id = ? AND episode_type = 'pump'",
      args: [input.eventId],
    });
    if (event.rows.length === 0) {
      throw new Error(`Pump event not found: ${input.eventId}`);
    }

    await this.client.execute({
      sql: `
        INSERT INTO pump_annotations (
          id, event_id, source, category, confidence, comment, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id, source) DO UPDATE SET
          category = excluded.category,
          confidence = excluded.confidence,
          comment = excluded.comment,
          updated_at = excluded.updated_at
      `.trim(),
      args: [
        randomUUID(),
        input.eventId,
        source,
        input.category,
        input.confidence ?? null,
        input.comment ?? null,
        updatedAt,
        updatedAt,
      ],
    });

    return (await this.getAnnotation(input.eventId, source))!;
  }

  async getReviewEvent(eventId: string): Promise<PumpReviewEvent | null> {
    const result = await this.client.execute({
      sql: `
        SELECT ${PUMP_COLUMNS}, ${ANNOTATION_COLUMNS}
        FROM pumps p
        ${HUMAN_ANNOTATION_JOIN}
        WHERE p.id = ? AND p.episode_type = 'pump'
      `.trim(),
      args: [eventId],
    });
    const row = result.rows[0];
    return row ? rowToReviewEvent(row as Record<string, unknown>) : null;
  }

  async listReviewEvents(
    filters: PumpEventFilters = {},
  ): Promise<PaginatedPumpReviewEvents> {
    const page = positiveInteger(filters.page, 1);
    const pageSize = Math.min(positiveInteger(filters.pageSize, 50), 250);
    const { clauses, args } = buildEventWhere(filters);
    const where = clauses.join(" AND ");

    const countResult = await this.client.execute({
      sql: `
        SELECT COUNT(*) AS n
        FROM pumps p
        ${HUMAN_ANNOTATION_JOIN}
        WHERE ${where}
      `.trim(),
      args,
    });
    const total = Number(countResult.rows[0]?.n ?? 0);

    const result = await this.client.execute({
      sql: `
        SELECT ${PUMP_COLUMNS}, ${ANNOTATION_COLUMNS}
        FROM pumps p
        ${HUMAN_ANNOTATION_JOIN}
        WHERE ${where}
        ORDER BY ${orderBy(filters.sort)}
        LIMIT ? OFFSET ?
      `.trim(),
      args: [...args, pageSize, (page - 1) * pageSize],
    });

    return {
      items: result.rows.map((row) =>
        rowToReviewEvent(row as Record<string, unknown>),
      ),
      page,
      pageSize,
      total,
    };
  }

  async getReviewStats(): Promise<PumpReviewStats> {
    const result = await this.client.execute(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN a.event_id IS NULL THEN 1 ELSE 0 END) AS unreviewed,
        SUM(CASE WHEN a.category = 'unclear' THEN 1 ELSE 0 END) AS unclear,
        SUM(CASE WHEN a.event_id IS NOT NULL AND a.category <> 'unclear' THEN 1 ELSE 0 END) AS reviewed,
        ${PUMP_CATEGORIES.map(
          (category) =>
            `SUM(CASE WHEN a.category = '${category}' THEN 1 ELSE 0 END) AS category_${category}`,
        ).join(",\n        ")}
      FROM pumps p
      ${HUMAN_ANNOTATION_JOIN}
      WHERE p.episode_type = 'pump'
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    const total = Number(row?.total ?? 0);
    const reviewed = Number(row?.reviewed ?? 0);
    const unclear = Number(row?.unclear ?? 0);

    return {
      total,
      reviewed,
      unreviewed: Number(row?.unreviewed ?? 0),
      unclear,
      reviewedPercentage:
        total === 0 ? 0 : Math.round(((reviewed + unclear) / total) * 1_000) / 10,
      categories: {
        sustained_move: Number(row?.category_sustained_move ?? 0),
        wick_spike: Number(row?.category_wick_spike ?? 0),
        volume_only: Number(row?.category_volume_only ?? 0),
        market_move: Number(row?.category_market_move ?? 0),
        illiquid_noise: Number(row?.category_illiquid_noise ?? 0),
        unclear: Number(row?.category_unclear ?? 0),
      },
    };
  }
}
