import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HttpClient, Instrument } from "@screener/core";
import type { ExchangeAdapter } from "@screener/exchanges";
import { SPOT_OR_FUTURES_TYPES, filterUniverseByQuote } from "./symbol-universe.js";

export { filterUniverseByQuote };

export interface UniverseEntry {
  marketCategory: string;
  instrumentType: string;
  symbolCanonical: string;
  base: string | null;
  quote: string | null;
  listedOn: string[];
}

export interface SeriesTask {
  instrument: Instrument;
  interval: string;
}

/** Normalize symbol for filter matching (BTC/USDT, BTC-USDT, btcusdt → BTCUSDT). */
export function normalizeSymbolQuery(value: string): string {
  return value.trim().toUpperCase().replace(/[-/]/g, "");
}

export function instrumentMatchesSymbolQuery(
  inst: Pick<Instrument, "symbolNative" | "symbolCanonical">,
  queries: Set<string>,
): boolean {
  const native = normalizeSymbolQuery(inst.symbolNative);
  const canonical = normalizeSymbolQuery(inst.symbolCanonical);
  for (const q of queries) {
    if (native === q || canonical === q) return true;
  }
  return false;
}

export function filterTasksBySymbols(tasks: SeriesTask[], symbols: string[]): SeriesTask[] {
  if (symbols.length === 0) return tasks;
  const queries = new Set(symbols.map(normalizeSymbolQuery));
  return tasks.filter((task) => instrumentMatchesSymbolQuery(task.instrument, queries));
}

export function loadUniverse(path: string): UniverseEntry[] {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Array<Record<string, unknown>>;
  return raw.map((item) => ({
    marketCategory: String(item.market_category),
    instrumentType: String(item.instrument_type),
    symbolCanonical: String(item.symbol_canonical),
    base: (item.base as string) ?? null,
    quote: (item.quote as string) ?? null,
    listedOn: (item.listed_on as string[]).map(String),
  }));
}

export function buildInstrumentIndex(
  instruments: Instrument[],
): Map<string, Instrument> {
  const index = new Map<string, Instrument>();
  for (const inst of instruments) {
    const key = `${inst.exchange}|${inst.instrumentType}|${inst.symbolCanonical}`;
    if (!index.has(key)) index.set(key, inst);
  }
  return index;
}

export function loadInstrumentIndexFile(path: string): Instrument[] {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Array<Record<string, unknown>>;
  return raw.map((row) => ({
    exchange: String(row.exchange),
    instrumentType: String(row.instrument_type),
    symbolCanonical: String(row.symbol_canonical),
    symbolNative: String(row.symbol_native),
    base: (row.base as string) ?? null,
    quote: (row.quote as string) ?? null,
    metadata: {},
  }));
}

export function writeInstrumentIndex(
  baseDir: string,
  index: Map<string, Instrument>,
  opts?: { merge?: boolean },
): string {
  const path = join(baseDir, "reports", "instrument_index.json");
  mkdirSync(dirname(path), { recursive: true });
  let merged = index;
  if (opts?.merge && existsSync(path)) {
    const existing = buildInstrumentIndex(loadInstrumentIndexFile(path));
    for (const [key, inst] of index) existing.set(key, inst);
    merged = existing;
  }
  const rows = [...merged.values()]
    .sort(
      (a, b) =>
        a.exchange.localeCompare(b.exchange) ||
        a.instrumentType.localeCompare(b.instrumentType) ||
        a.symbolCanonical.localeCompare(b.symbolCanonical),
    )
    .map((inst) => ({
      exchange: inst.exchange,
      instrument_type: inst.instrumentType,
      symbol_canonical: inst.symbolCanonical,
      symbol_native: inst.symbolNative,
      base: inst.base,
      quote: inst.quote,
    }));
  writeFileSync(path, JSON.stringify(rows, null, 2), "utf-8");
  return path;
}

export async function discoverForExchanges(
  adapters: Record<string, ExchangeAdapter>,
  client: HttpClient,
  exchanges: Set<string>,
): Promise<Instrument[]> {
  const all: Instrument[] = [];
  for (const [name, adapter] of Object.entries(adapters)) {
    if (!exchanges.has(name)) continue;
    const instruments = await adapter.discoverInstruments(
      client,
      new Set(SPOT_OR_FUTURES_TYPES),
    );
    all.push(...instruments);
  }
  return all;
}

export function resolveSeriesTasks(
  universe: UniverseEntry[],
  index: Map<string, Instrument>,
  opts: {
    exchanges: Set<string>;
    intervals: string[];
    adapters: Record<string, ExchangeAdapter>;
  },
): { tasks: SeriesTask[]; warnings: Record<string, unknown>[] } {
  const tasks: SeriesTask[] = [];
  const warnings: Record<string, unknown>[] = [];

  for (const entry of universe) {
    for (const exchange of entry.listedOn) {
      if (!opts.exchanges.has(exchange)) continue;
      const adapter = opts.adapters[exchange];
      if (!adapter) continue;
      const key = `${exchange}|${entry.instrumentType}|${entry.symbolCanonical}`;
      const inst = index.get(key);
      if (!inst) {
        warnings.push({
          reason: "no_native_match",
          exchange,
          instrument_type: entry.instrumentType,
          symbol_canonical: entry.symbolCanonical,
        });
        continue;
      }
      for (const interval of opts.intervals) {
        if (!adapter.intervals.has(interval)) continue;
        tasks.push({ instrument: inst, interval });
      }
    }
  }
  return { tasks, warnings };
}
