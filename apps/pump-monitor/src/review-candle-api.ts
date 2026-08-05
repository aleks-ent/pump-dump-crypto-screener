import type { IncomingMessage, ServerResponse } from "node:http";
import type { PumpReviewEvent } from "@screener/db";
import {
  loadReviewCandleWindow,
  ReviewCandleError,
  type ReviewCandleWindow,
} from "./review-candles.js";

const MAX_CONTEXT_MS = 24 * 60 * 60 * 1_000;

export interface CandleEventRepositoryLike {
  getReviewEvent(eventId: string): Promise<PumpReviewEvent | null>;
}

export type ReviewCandleWindowLoader = typeof loadReviewCandleWindow;

function sendJson(res: ServerResponse, status: number, value: unknown, headOnly = false): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(headOnly ? undefined : body);
}

function parseTimestamp(raw: string | null, name: string): number | undefined {
  if (raw == null || raw === "") return undefined;
  const numeric = Number(raw);
  const value = Number.isFinite(numeric) ? numeric : Date.parse(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ReviewCandleError("INVALID_WINDOW", `${name} must be a Unix millisecond or ISO timestamp`);
  }
  return value;
}

function statusFor(error: ReviewCandleError): number {
  if (error.code === "UNSUPPORTED_EXCHANGE" || error.code === "UNSUPPORTED_SYMBOL") return 422;
  if (error.code === "CANDLE_LOAD_FAILED") return 502;
  return 400;
}

/** Returns true when the request matched the review candle endpoint. */
export async function handleReviewCandleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  repository: CandleEventRepositoryLike,
  loadWindow: ReviewCandleWindowLoader = loadReviewCandleWindow,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/market-data/candles") return false;

  const headOnly = req.method === "HEAD";
  if (req.method !== "GET" && !headOnly) {
    sendJson(res, 405, { error: { code: "method_not_allowed", message: "Method not allowed" } });
    return true;
  }

  try {
    const eventId = url.searchParams.get("eventId")?.trim();
    if (!eventId) {
      throw new ReviewCandleError("INVALID_EVENT", "eventId is required");
    }
    const event = await repository.getReviewEvent(eventId);
    if (event == null) {
      sendJson(res, 404, {
        error: { code: "event_not_found", message: "Pump event not found" },
      });
      return true;
    }

    const fromMs = parseTimestamp(url.searchParams.get("from"), "from");
    const toMs = parseTimestamp(url.searchParams.get("to"), "to");
    if ((fromMs == null) !== (toMs == null)) {
      throw new ReviewCandleError("INVALID_WINDOW", "from and to must be supplied together");
    }
    if (fromMs != null && toMs != null && fromMs >= toMs) {
      throw new ReviewCandleError("INVALID_WINDOW", "from must be before to");
    }

    let beforeMs: number | undefined;
    let afterMs: number | undefined;
    if (fromMs != null && toMs != null) {
      beforeMs = event.pump.startMs - fromMs;
      afterMs = toMs - event.pump.startMs;
      if (beforeMs < 0 || afterMs < 0 || beforeMs > MAX_CONTEXT_MS || afterMs > MAX_CONTEXT_MS) {
        throw new ReviewCandleError(
          "INVALID_WINDOW",
          "Requested window must contain detection and stay within 24 hours per side",
        );
      }
    }

    const result: ReviewCandleWindow = loadWindow({
      event: event.pump,
      interval: url.searchParams.get("interval") ?? undefined,
      beforeMs,
      afterMs,
    });
    sendJson(res, 200, result, headOnly);
    return true;
  } catch (error) {
    if (error instanceof ReviewCandleError) {
      sendJson(res, statusFor(error), {
        error: { code: error.code.toLowerCase(), message: error.message },
      });
      return true;
    }
    throw error;
  }
}
