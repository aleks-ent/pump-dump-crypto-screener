import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  PumpAnnotation,
  PumpEventFilters,
  PumpReviewEvent,
  ReviewStatus,
} from "@screener/db";
import { parsePumpEventFilters } from "./review-api.js";

export const REVIEW_EXPORT_PAGE_SIZE = 250;
export const MAX_REVIEW_EXPORT_EVENTS = 100_000;

export type ReviewExportFormat = "json" | "csv";
export type ReviewExportScope = "filtered" | "all-reviewed";

export interface ReviewExportRepositoryLike {
  listReviewEvents(filters?: PumpEventFilters): Promise<{
    items: PumpReviewEvent[];
    page: number;
    pageSize: number;
    total: number;
  }>;
}

export interface ReviewExportRequest {
  format: ReviewExportFormat;
  scope: ReviewExportScope;
  filters?: PumpEventFilters;
}

export interface PumpReviewExportEvent {
  eventId: string;
  exchange: string;
  marketType: string;
  symbol: string;
  detectedAt: string;
  detectorVersion: null;
  detectorScore: number;
  triggerData: Record<string, unknown>;
  reviewStatus: ReviewStatus;
  eventMetadata: PumpReviewEvent["pump"];
  humanAnnotation: PumpAnnotation | null;
}

export interface ReviewExportFile {
  body: string;
  contentType: string;
  filename: string;
  eventCount: number;
}

export class ReviewExportLimitError extends Error {
  constructor(readonly limit: number = MAX_REVIEW_EXPORT_EVENTS) {
    super(`Pump review export exceeds the ${limit} event limit`);
  }
}

const CSV_COLUMNS = [
  "event_id",
  "exchange",
  "market_type",
  "symbol",
  "detected_at",
  "detector_version",
  "detector_score",
  "category",
  "confidence",
  "comment",
  "annotation_updated_at",
  "review_status",
  "annotation_id",
  "annotation_source",
  "annotation_created_at",
  "trigger_data",
  "event_metadata",
] as const;

function triggerData(event: PumpReviewEvent): Record<string, unknown> {
  const { pump } = event;
  return {
    episodeType: pump.episodeType,
    durationMinutes: pump.durationMinutes,
    dominantPhase: pump.dominantPhase,
    confirmed: pump.confirmed,
    confirmedExchanges: pump.confirmedExchanges,
    eventCount: pump.eventCount,
    endAt: pump.endUtc,
    tradingViewUrl: pump.tradingViewUrl,
    legacyClassification: pump.classification,
  };
}

export function serializeReviewExportEvent(
  event: PumpReviewEvent,
): PumpReviewExportEvent {
  return {
    eventId: event.pump.index,
    exchange: event.pump.leadingExchange,
    marketType: event.pump.instrumentType,
    symbol: event.pump.symbolNative,
    detectedAt: event.pump.startUtc,
    detectorVersion: null,
    detectorScore: event.pump.peakScore,
    triggerData: triggerData(event),
    reviewStatus: event.status,
    eventMetadata: event.pump,
    humanAnnotation: event.annotation,
  };
}

function withoutPagination(filters: PumpEventFilters): PumpEventFilters {
  const { page: _page, pageSize: _pageSize, ...datasetFilters } = filters;
  return datasetFilters;
}

async function collectPages(
  repository: ReviewExportRepositoryLike,
  filters: PumpEventFilters,
  limit: number,
): Promise<PumpReviewEvent[]> {
  const items: PumpReviewEvent[] = [];
  const datasetFilters = withoutPagination(filters);
  // Even at zero remaining capacity, fetch one page so an empty final status
  // can complete while any additional row is rejected.
  const maxPages = Math.max(1, Math.ceil(limit / REVIEW_EXPORT_PAGE_SIZE));

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await repository.listReviewEvents({
      ...datasetFilters,
      page,
      pageSize: REVIEW_EXPORT_PAGE_SIZE,
    });

    if (!Number.isSafeInteger(result.total) || result.total < 0) {
      throw new Error("Pump review repository returned an invalid export total");
    }
    if (result.total > limit) throw new ReviewExportLimitError(limit);
    if (result.items.length > REVIEW_EXPORT_PAGE_SIZE) {
      throw new Error("Pump review repository exceeded the requested export page size");
    }

    items.push(...result.items);
    if (items.length >= result.total) return items.slice(0, result.total);
    if (result.items.length === 0) {
      throw new Error("Pump review export pagination ended before the reported total");
    }
  }

  throw new ReviewExportLimitError(limit);
}

function compareEvents(left: PumpReviewEvent, right: PumpReviewEvent): number {
  if (left.pump.startMs !== right.pump.startMs) {
    return left.pump.startMs - right.pump.startMs;
  }
  if (left.pump.index < right.pump.index) return -1;
  if (left.pump.index > right.pump.index) return 1;
  return 0;
}

export async function listReviewEventsForExport(
  repository: ReviewExportRepositoryLike,
  scope: ReviewExportScope,
  filters: PumpEventFilters = {},
): Promise<PumpReviewEvent[]> {
  if (scope === "filtered") {
    return (await collectPages(repository, filters, MAX_REVIEW_EXPORT_EVENTS)).filter(
      (event) => event.annotation?.source === "human",
    );
  }

  // `reviewed` deliberately excludes the `unclear` category in the repository.
  // Both statuses contain human labels and therefore belong in the full dataset.
  const reviewed = await collectPages(
    repository,
    { status: "reviewed", sort: "detectedAtAsc" },
    MAX_REVIEW_EXPORT_EVENTS,
  );
  const unclear = await collectPages(
    repository,
    { status: "unclear", sort: "detectedAtAsc" },
    MAX_REVIEW_EXPORT_EVENTS - reviewed.length,
  );
  return [...reviewed, ...unclear]
    .filter((event) => event.annotation?.source === "human")
    .sort(compareEvents);
}

export function escapeCsvField(value: unknown): string {
  if (value == null) return "";
  const text = typeof value === "string" ? value : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(event: PumpReviewExportEvent): unknown[] {
  const annotation = event.humanAnnotation;
  return [
    event.eventId,
    event.exchange,
    event.marketType,
    event.symbol,
    event.detectedAt,
    event.detectorVersion,
    event.detectorScore,
    annotation?.category,
    annotation?.confidence,
    annotation?.comment,
    annotation?.updatedAt,
    event.reviewStatus,
    annotation?.id,
    annotation?.source,
    annotation?.createdAt,
    JSON.stringify(event.triggerData),
    JSON.stringify(event.eventMetadata),
  ];
}

export function createReviewCsv(events: PumpReviewExportEvent[]): string {
  const rows = [
    CSV_COLUMNS.join(","),
    ...events.map((event) => csvRow(event).map(escapeCsvField).join(",")),
  ];
  return `${rows.join("\r\n")}\r\n`;
}

export function reviewExportFilename(
  scope: ReviewExportScope,
  format: ReviewExportFormat,
): string {
  return `pump-event-reviews-${scope}.${format}`;
}

export async function createReviewExport(
  repository: ReviewExportRepositoryLike,
  request: ReviewExportRequest,
): Promise<ReviewExportFile> {
  const events = (await listReviewEventsForExport(
    repository,
    request.scope,
    request.filters,
  )).map(serializeReviewExportEvent);
  return {
    body:
      request.format === "json"
        ? `${JSON.stringify(events, null, 2)}\n`
        : createReviewCsv(events),
    contentType:
      request.format === "json"
        ? "application/json; charset=utf-8"
        : "text/csv; charset=utf-8",
    filename: reviewExportFilename(request.scope, request.format),
    eventCount: events.length,
  };
}

function parseFormat(value: string | null): ReviewExportFormat {
  if (value == null || value === "json") return "json";
  if (value === "csv") return "csv";
  throw new Error("Export format must be json or csv");
}

function parseScope(value: string | null): ReviewExportScope {
  if (value == null || value === "filtered" || value === "current") return "filtered";
  if (value === "all-reviewed" || value === "reviewed" || value === "complete") {
    return "all-reviewed";
  }
  throw new Error("Export scope must be filtered or all-reviewed");
}

/** Returns true when the request matched the pump-review export route. */
export async function handleReviewExportRequest(
  req: IncomingMessage,
  res: ServerResponse,
  repository: ReviewExportRepositoryLike,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/pump-events/export") return false;

  const headOnly = req.method === "HEAD";
  if (req.method !== "GET" && !headOnly) {
    const body = JSON.stringify({
      error: { code: "method_not_allowed", message: "Method not allowed" },
    });
    res.writeHead(405, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      allow: "GET, HEAD",
      "cache-control": "no-store",
    });
    res.end(body);
    return true;
  }

  let format: ReviewExportFormat;
  let scope: ReviewExportScope;
  let filters: PumpEventFilters | undefined;
  try {
    format = parseFormat(url.searchParams.get("format"));
    scope = parseScope(url.searchParams.get("scope"));
    filters = scope === "filtered" ? parsePumpEventFilters(url.searchParams) : undefined;
  } catch (error) {
    const body = JSON.stringify({
      error: {
        code: "invalid_export",
        message: error instanceof Error ? error.message : String(error),
      },
    });
    res.writeHead(400, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
    });
    res.end(headOnly ? undefined : body);
    return true;
  }

  try {
    const file = await createReviewExport(repository, {
      format,
      scope,
      filters,
    });
    res.writeHead(200, {
      "content-type": file.contentType,
      "content-length": Buffer.byteLength(file.body),
      "content-disposition": `attachment; filename="${file.filename}"`,
      "cache-control": "no-store",
      "x-export-event-count": String(file.eventCount),
    });
    res.end(headOnly ? undefined : file.body);
  } catch (error) {
    if (!(error instanceof ReviewExportLimitError)) throw error;
    const body = JSON.stringify({
      error: {
        code: "export_too_large",
        message: error.message,
      },
    });
    res.writeHead(413, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
    });
    res.end(headOnly ? undefined : body);
  }
  return true;
}
