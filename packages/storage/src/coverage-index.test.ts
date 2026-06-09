import { describe, expect, it } from "vitest";
import {
  isFullyIndexed,
  mergeCoverageEntry,
  uncoveredRanges,
} from "./coverage-index.js";

describe("coverage index", () => {
  const entry = {
    start_ms: Date.parse("2026-06-02T00:00:00Z"),
    end_ms: Date.parse("2026-06-06T09:00:00Z"),
    verified_at_utc: "2026-06-06T09:01:00.000Z",
  };

  it("detects full coverage", () => {
    expect(
      isFullyIndexed(
        entry,
        Date.parse("2026-06-03T00:00:00Z"),
        Date.parse("2026-06-06T08:00:00Z"),
      ),
    ).toBe(true);
  });

  it("returns no gaps when fully indexed", () => {
    expect(
      uncoveredRanges(
        entry,
        Date.parse("2026-06-03T00:00:00Z"),
        Date.parse("2026-06-06T08:00:00Z"),
      ),
    ).toEqual([]);
  });

  it("returns tail gap when window extends", () => {
    const end = Date.parse("2026-06-06T10:00:00Z");
    expect(uncoveredRanges(entry, entry.start_ms, end)).toEqual([
      [entry.end_ms, end],
    ]);
  });

  it("returns head gap when window starts earlier", () => {
    const start = Date.parse("2026-06-01T00:00:00Z");
    expect(uncoveredRanges(entry, start, entry.end_ms)).toEqual([
      [start, entry.start_ms],
    ]);
  });

  it("returns full window when entry is missing", () => {
    const start = Date.parse("2026-06-01T00:00:00Z");
    const end = Date.parse("2026-06-06T10:00:00Z");
    expect(uncoveredRanges(undefined, start, end)).toEqual([[start, end]]);
  });

  it("merges entries outward", () => {
    const merged = mergeCoverageEntry(
      entry,
      Date.parse("2026-06-01T00:00:00Z"),
      Date.parse("2026-06-06T12:00:00Z"),
    );
    expect(merged.start_ms).toBe(Date.parse("2026-06-01T00:00:00Z"));
    expect(merged.end_ms).toBe(Date.parse("2026-06-06T12:00:00Z"));
  });
});
