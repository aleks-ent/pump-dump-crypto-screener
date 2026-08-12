import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HttpClient, Instrument } from "@screener/core";
import type { ExchangeAdapter } from "@screener/exchanges";
import {
  ensureSymbolUniverse,
  symbolUniverseNeedsRefresh,
} from "./run-context.js";

const tempDirs: string[] = [];

function tempUniversePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "symbol-universe-"));
  tempDirs.push(dir);
  return join(dir, "symbol_universe.json");
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("symbolUniverseNeedsRefresh", () => {
  it("refreshes a missing universe", () => {
    expect(symbolUniverseNeedsRefresh(tempUniversePath(), 4, Date.UTC(2026, 7, 12))).toBe(true);
  });

  it("refreshes at the configured age but not before it", () => {
    const path = tempUniversePath();
    writeFileSync(path, "[]", "utf-8");
    const modifiedMs = Date.UTC(2026, 7, 8, 12);
    utimesSync(path, modifiedMs / 1000, modifiedMs / 1000);

    expect(symbolUniverseNeedsRefresh(path, 4, modifiedMs + 4 * 86_400_000 - 1)).toBe(false);
    expect(symbolUniverseNeedsRefresh(path, 4, modifiedMs + 4 * 86_400_000)).toBe(true);
  });

  it("keeps an existing universe indefinitely when no interval is provided", () => {
    const path = tempUniversePath();
    writeFileSync(path, "[]", "utf-8");
    expect(symbolUniverseNeedsRefresh(path, undefined, Date.UTC(2030, 0, 1))).toBe(false);
  });
});

describe("ensureSymbolUniverse", () => {
  it("atomically replaces a stale universe with current listings", async () => {
    const path = tempUniversePath();
    writeFileSync(path, "[]", "utf-8");
    const nowMs = Date.UTC(2026, 7, 12, 12);
    const modifiedMs = nowMs - 4 * 86_400_000;
    utimesSync(path, modifiedMs / 1000, modifiedMs / 1000);

    const instruments: Instrument[] = [
      {
        exchange: "binance",
        instrumentType: "spot",
        symbolNative: "NEWUSDT",
        symbolCanonical: "NEW/USDT",
        base: "NEW",
        quote: "USDT",
        metadata: {},
      },
    ];
    const discoverInstruments = vi.fn().mockResolvedValue(instruments);
    const adapter = { discoverInstruments } as unknown as ExchangeAdapter;

    const refreshed = await ensureSymbolUniverse(path, {
      exchanges: new Set(["binance"]),
      quoteCurrencies: new Set(["USDT"]),
      adapters: { binance: adapter },
      client: {} as HttpClient,
      refreshAfterDays: 4,
      nowMs,
    });

    expect(refreshed).toBe(true);
    expect(discoverInstruments).toHaveBeenCalledOnce();
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual([
      expect.objectContaining({
        symbol_canonical: "NEW/USDT",
        listed_on: ["binance"],
      }),
    ]);
  });
});
