import type { Instrument } from "@screener/core";
import {
  buildInstrumentIndex,
  instrumentMatchesSymbolQuery,
  loadInstrumentIndexFile,
  loadUniverse,
  marketCategory,
  normalizeSymbolQuery,
  type UniverseEntry,
} from "@screener/universe";

export function instrumentGroupKey(entry: UniverseEntry): string {
  return `${entry.instrumentType}|${entry.base ?? ""}|${entry.quote ?? ""}`;
}

export interface InstrumentGroup {
  key: string;
  entry: UniverseEntry;
  instrumentsByExchange: Map<string, Instrument>;
}

export function normalizeMarketType(instrumentType: string): string {
  if (instrumentType === "spot") return "spot";
  if (["linear_perp", "swap", "futures"].includes(instrumentType)) return "futures";
  return "unknown";
}

export function buildInstrumentGroups(opts: {
  universePath: string;
  instrumentIndexPath: string;
  exchanges?: Set<string>;
  marketCategory?: "spot" | "futures" | null;
}): InstrumentGroup[] {
  const universe = loadUniverse(opts.universePath);
  const instruments = loadInstrumentIndexFile(opts.instrumentIndexPath);
  const index = buildInstrumentIndex(instruments);
  const groups: InstrumentGroup[] = [];

  for (const entry of universe) {
    if (opts.marketCategory) {
      const cat = marketCategory(entry.instrumentType);
      if (cat !== opts.marketCategory) continue;
    }

    const instrumentsByExchange = new Map<string, Instrument>();
    for (const exchange of entry.listedOn) {
      if (opts.exchanges && !opts.exchanges.has(exchange)) continue;
      const key = `${exchange}|${entry.instrumentType}|${entry.symbolCanonical}`;
      const inst = index.get(key);
      if (inst) instrumentsByExchange.set(exchange, inst);
    }
    if (instrumentsByExchange.size === 0) continue;

    groups.push({
      key: instrumentGroupKey(entry),
      entry,
      instrumentsByExchange,
    });
  }

  return groups;
}

export function instrumentGroupMatchesSymbolQuery(
  group: InstrumentGroup,
  queries: Set<string>,
): boolean {
  const canonical = normalizeSymbolQuery(group.entry.symbolCanonical);
  const baseQuote =
    group.entry.base && group.entry.quote
      ? normalizeSymbolQuery(`${group.entry.base}${group.entry.quote}`)
      : "";
  const base = group.entry.base ? normalizeSymbolQuery(group.entry.base) : "";
  for (const q of queries) {
    if (canonical === q || baseQuote === q || (base !== "" && base === q)) return true;
  }
  for (const inst of group.instrumentsByExchange.values()) {
    if (instrumentMatchesSymbolQuery(inst, queries)) return true;
  }
  return false;
}

export function filterInstrumentGroupsBySymbols(
  groups: InstrumentGroup[],
  symbols: string[],
): InstrumentGroup[] {
  if (symbols.length === 0) return groups;
  const queries = new Set(symbols.map(normalizeSymbolQuery));
  return groups.filter((g) => instrumentGroupMatchesSymbolQuery(g, queries));
}
