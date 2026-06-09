import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseIsoUtc,
  resolveArchiveWindow,
  resolveWindow,
  resolveWindowFromArgs,
} from "./pull-window.js";

describe("pull-window", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses Z suffix", () => {
    const dt = parseIsoUtc("2026-05-01T00:00:00Z");
    expect(dt.getUTCFullYear()).toBe(2026);
  });

  it("resolves explicit window", () => {
    const [startMs, endMs] = resolveWindow(
      "2026-05-01T00:00:00Z",
      "2026-05-02T00:00:00Z",
    );
    expect(endMs - startMs).toBe(24 * 60 * 60 * 1000);
  });

  it("resolves from args", () => {
    const [startMs, endMs] = resolveWindowFromArgs(
      { start: "2026-05-01T00:00:00Z", end: "2026-05-02T00:00:00Z" },
      {},
    );
    expect(endMs).toBeGreaterThan(startMs);
  });

  it("resolveArchiveWindow uses calendar days ending at now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-06-06T15:00:00Z"));
    const [startMs, endMs] = resolveArchiveWindow(null, null, {}, 5);
    expect(endMs).toBe(Date.parse("2026-06-06T15:00:00Z"));
    expect(startMs).toBe(Date.parse("2026-06-02T00:00:00Z"));
  });

  it("resolveArchiveWindow with days=1 is today only", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-06-06T15:00:00Z"));
    const [startMs, endMs] = resolveArchiveWindow(null, null, {}, 1);
    expect(startMs).toBe(Date.parse("2026-06-06T00:00:00Z"));
    expect(endMs).toBe(Date.parse("2026-06-06T15:00:00Z"));
  });

  it("resolveArchiveWindow defers to resolveWindow when start/end set", () => {
    const [startMs, endMs] = resolveArchiveWindow(
      "2026-05-01T00:00:00Z",
      "2026-05-02T00:00:00Z",
      {},
      5,
    );
    expect(endMs - startMs).toBe(24 * 60 * 60 * 1000);
  });
});
