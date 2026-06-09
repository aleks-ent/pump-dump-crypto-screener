import { describe, expect, it } from "vitest";
import { defaultWorkerConcurrency } from "./concurrency.js";

describe("defaultWorkerConcurrency", () => {
  it("returns at least 1", () => {
    expect(defaultWorkerConcurrency()).toBeGreaterThanOrEqual(1);
  });
});
