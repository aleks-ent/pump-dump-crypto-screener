import type { IncomingMessage, ServerResponse } from "node:http";
import {
  isAnnotationConfidence,
  isPumpCategory,
  type AnnotationConfidence,
  type PumpReviewSort,
  type PumpAnnotation,
  type PumpCategory,
  type PumpEventFilters,
  type PumpReviewEvent,
  type PumpReviewStats,
  type ReviewStatus,
} from "@screener/db";

const MAX_ANNOTATION_BODY_BYTES = 16 * 1024;
const MAX_COMMENT_LENGTH = 4_000;
const REVIEW_STATUSES = new Set<ReviewStatus | "all">([
  "all",
  "unreviewed",
  "reviewed",
  "unclear",
]);
const EVENT_SORTS = new Set<PumpReviewSort>([
  "detectedAtDesc",
  "detectedAtAsc",
  "unreviewedFirst",
  "symbolAsc",
]);

export interface ReviewRepositoryLike {
  listReviewEvents(filters?: PumpEventFilters): Promise<{
    items: PumpReviewEvent[];
    page: number;
    pageSize: number;
    total: number;
  }>;
  getReviewEvent(eventId: string): Promise<PumpReviewEvent | null>;
  upsertAnnotation(input: {
    eventId: string;
    source: "human";
    category: PumpCategory;
    confidence?: AnnotationConfidence | null;
    comment?: string | null;
  }): Promise<PumpAnnotation>;
  getReviewStats(): Promise<PumpReviewStats>;
}

export interface SerializedReviewEvent {
  id: string;
  exchange: string;
  marketType: string;
  symbol: string;
  detectedAt: string;
  detectorVersion: null;
  detectorScore: number;
  triggerData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  reviewStatus: ReviewStatus;
  annotation: PumpAnnotation | null;
  metadata: PumpReviewEvent["pump"];
}

class ReviewHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function requiredPositiveInt(
  params: URLSearchParams,
  name: string,
  fallback: number,
  max: number,
): number {
  const raw = params.get(name);
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new ReviewHttpError(400, "invalid_query", `${name} must be between 1 and ${max}`);
  }
  return value;
}

function parseDate(value: string, field: string, endExclusive: boolean): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new ReviewHttpError(400, "invalid_query", `${field} must be an ISO date or timestamp`);
  }
  return endExclusive && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? parsed + 86_400_000
    : parsed;
}

export function parsePumpEventFilters(params: URLSearchParams): PumpEventFilters {
  const statusRaw = params.get("status") ?? "unreviewed";
  if (!REVIEW_STATUSES.has(statusRaw as ReviewStatus | "all")) {
    throw new ReviewHttpError(400, "invalid_query", "Unsupported review status");
  }

  const categoryRaw = params.get("category");
  if (categoryRaw != null && categoryRaw !== "" && !isPumpCategory(categoryRaw)) {
    throw new ReviewHttpError(400, "invalid_query", "Unsupported pump category");
  }

  const sortRaw = params.get("sort") ?? "detectedAtAsc";
  if (!EVENT_SORTS.has(sortRaw as PumpReviewSort)) {
    throw new ReviewHttpError(400, "invalid_query", "Unsupported event sort");
  }

  const filters: PumpEventFilters = {
    status: statusRaw as ReviewStatus | "all",
    sort: sortRaw as PumpReviewSort,
    page: requiredPositiveInt(params, "page", 1, 1_000_000),
    pageSize: requiredPositiveInt(params, "pageSize", 50, 200),
  };
  if (categoryRaw) filters.category = categoryRaw as PumpCategory;
  const exchange = params.get("exchange")?.trim();
  if (exchange) filters.exchange = exchange.slice(0, 64);
  const symbol = params.get("symbol")?.trim();
  if (symbol) filters.symbol = symbol.slice(0, 64);
  const dateFrom = params.get("dateFrom");
  if (dateFrom) filters.dateFromMs = parseDate(dateFrom, "dateFrom", false);
  const dateTo = params.get("dateTo");
  if (dateTo) filters.dateToMs = parseDate(dateTo, "dateTo", true);
  if (
    filters.dateFromMs != null &&
    filters.dateToMs != null &&
    filters.dateFromMs >= filters.dateToMs
  ) {
    throw new ReviewHttpError(400, "invalid_query", "dateFrom must be before dateTo");
  }
  return filters;
}

export function serializeReviewEvent(reviewEvent: PumpReviewEvent): SerializedReviewEvent {
  const { pump, annotation, status } = reviewEvent;
  return {
    id: pump.index,
    exchange: pump.leadingExchange,
    marketType: pump.instrumentType,
    symbol: pump.symbolNative,
    detectedAt: pump.startUtc,
    detectorVersion: null,
    detectorScore: pump.peakScore,
    triggerData: {
      episodeType: pump.episodeType,
      durationMinutes: pump.durationMinutes,
      dominantPhase: pump.dominantPhase,
      confirmed: pump.confirmed,
      confirmedExchanges: pump.confirmedExchanges,
      eventCount: pump.eventCount,
      endAt: pump.endUtc,
      tradingViewUrl: pump.tradingViewUrl,
      legacyClassification: pump.classification,
    },
    createdAt: pump.firstSeenAt,
    updatedAt: pump.lastSeenAt,
    reviewStatus: status,
    annotation,
    metadata: pump,
  };
}

export function parseAnnotationInput(value: unknown): {
  category: PumpCategory;
  confidence: AnnotationConfidence | null;
  comment: string | null;
} {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new ReviewHttpError(400, "invalid_body", "Expected a JSON object");
  }
  const body = value as Record<string, unknown>;
  if (!isPumpCategory(body.category)) {
    throw new ReviewHttpError(400, "invalid_category", "Select one of the six pump categories");
  }
  if (
    body.confidence != null &&
    body.confidence !== "" &&
    !isAnnotationConfidence(body.confidence)
  ) {
    throw new ReviewHttpError(400, "invalid_confidence", "Unsupported confidence value");
  }
  if (body.comment != null && typeof body.comment !== "string") {
    throw new ReviewHttpError(400, "invalid_comment", "Comment must be text");
  }
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (comment.length > MAX_COMMENT_LENGTH) {
    throw new ReviewHttpError(
      400,
      "comment_too_long",
      `Comment cannot exceed ${MAX_COMMENT_LENGTH} characters`,
    );
  }
  return {
    category: body.category,
    confidence:
      body.confidence == null || body.confidence === ""
        ? null
        : (body.confidence as AnnotationConfidence),
    comment: comment || null,
  };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_ANNOTATION_BODY_BYTES) {
      throw new ReviewHttpError(413, "body_too_large", "Annotation request is too large");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ReviewHttpError(400, "invalid_json", "Request body must be valid JSON");
  }
}

function sendJson(res: ServerResponse, status: number, value: unknown, headOnly = false): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(headOnly ? undefined : body);
}

function errorResponse(res: ServerResponse, error: unknown): void {
  if (error instanceof ReviewHttpError) {
    sendJson(res, error.status, { error: { code: error.code, message: error.message } });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/not found/i.test(message)) {
    sendJson(res, 404, { error: { code: "event_not_found", message } });
    return;
  }
  throw error;
}

/** Returns true when the request matched a pump-review API route. */
export async function handleReviewApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  repository: ReviewRepositoryLike,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const headOnly = req.method === "HEAD";
  const method = headOnly ? "GET" : req.method;

  try {
    if (url.pathname === "/api/pump-events" && method === "GET") {
      const result = await repository.listReviewEvents(parsePumpEventFilters(url.searchParams));
      sendJson(res, 200, { ...result, items: result.items.map(serializeReviewEvent) }, headOnly);
      return true;
    }
    if (url.pathname === "/api/pump-events/stats" && method === "GET") {
      sendJson(res, 200, await repository.getReviewStats(), headOnly);
      return true;
    }

    const match = url.pathname.match(/^\/api\/pump-events\/([^/]+)(\/annotation)?$/);
    if (match) {
      const eventId = decodeURIComponent(match[1]!);
      if (!match[2] && method === "GET") {
        const event = await repository.getReviewEvent(eventId);
        if (event == null) {
          throw new ReviewHttpError(404, "event_not_found", "Pump event not found");
        }
        sendJson(res, 200, serializeReviewEvent(event), headOnly);
        return true;
      }
      if (match[2] && method === "PUT") {
        const input = parseAnnotationInput(await readJson(req));
        const annotation = await repository.upsertAnnotation({
          eventId,
          source: "human",
          ...input,
        });
        sendJson(res, 200, annotation);
        return true;
      }
      sendJson(res, 405, {
        error: { code: "method_not_allowed", message: "Method not allowed" },
      });
      return true;
    }
    return false;
  } catch (error) {
    errorResponse(res, error);
    return true;
  }
}
