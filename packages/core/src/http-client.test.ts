import { describe, expect, it } from "vitest";
import { HttpStatusError, httpStatusFromError } from "./http-client.js";

describe("httpStatusFromError", () => {
  it("unwraps status from wrapped errors", () => {
    const inner = new HttpStatusError(403, "https://public.bybit.com/x.csv.gz");
    const outer = new Error("HEAD failed", { cause: inner });
    expect(httpStatusFromError(outer)).toBe(403);
  });

  it("parses status from retry exhaustion message", () => {
    const err = new Error(
      "GET https://public.bybit.com/x.csv.gz failed after retries; status=403",
      { cause: new Error("Retryable status 403") },
    );
    expect(httpStatusFromError(err)).toBe(403);
  });
});
