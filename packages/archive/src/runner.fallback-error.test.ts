import { HttpStatusError } from "@screener/core";
import { describe, expect, it } from "vitest";
import { summarizeFallbackError } from "./runner.js";

describe("summarizeFallbackError", () => {
  it("extracts HTTP status and endpoint from retry errors", () => {
    const err = new Error(
      "GET https://fapi.binance.com/fapi/v1/klines?symbol=GAIBUSDT&interval=1m&startTime=1&endTime=2&limit=1000 failed after retries; status=400",
    );
    expect(summarizeFallbackError(err)).toBe("HTTP 400 (klines)");
  });

  it("summarizes HttpStatusError", () => {
    const err = new HttpStatusError(
      400,
      "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT",
    );
    expect(summarizeFallbackError(err)).toBe("HTTP 400 (klines)");
  });

  it("falls back to status only", () => {
    expect(summarizeFallbackError(new Error("failed after retries; status=429"))).toBe(
      "HTTP 429",
    );
  });
});
