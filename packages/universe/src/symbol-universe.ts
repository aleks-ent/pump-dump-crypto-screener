import type { Instrument } from "@screener/core";

export const SPOT_OR_FUTURES_TYPES = new Set([
  "spot",
  "linear_perp",
  "inverse_futures",
  "swap",
  "futures",
]);

const FUTURES_TYPES = new Set(["linear_perp", "inverse_futures", "swap", "futures"]);

export function quoteCurrency(inst: Instrument): string | null {
  if (inst.quote) return inst.quote.toUpperCase();
  const native = inst.symbolNative.toUpperCase();
  const canonical = inst.symbolCanonical.toUpperCase();
  if (canonical.includes("/")) {
    const quote = canonical.split("/", 2)[1];
    return quote ? quote.toUpperCase() : null;
  }
  const parts = native.split("-");
  if (parts.length >= 2 && parts[1]) return parts[1]!.toUpperCase();
  if (native.endsWith("USDT") && !native.startsWith("USDT")) return "USDT";
  return null;
}

export function isUsdtQuoted(inst: Instrument): boolean {
  return quoteCurrency(inst) === "USDT";
}

export function filterByQuoteCurrencies(
  instruments: Instrument[],
  quoteCurrencies: Set<string>,
): Instrument[] {
  const wanted = new Set([...quoteCurrencies].map((q) => q.toUpperCase()));
  return instruments.filter((inst) => {
    const q = quoteCurrency(inst);
    return q != null && wanted.has(q);
  });
}

export function marketCategory(instrumentType: string): string | null {
  if (instrumentType === "spot") return "spot";
  if (FUTURES_TYPES.has(instrumentType)) return "futures";
  return null;
}

export function filterSpotOrFutures(instruments: Instrument[]): Instrument[] {
  return instruments.filter((inst) => SPOT_OR_FUTURES_TYPES.has(inst.instrumentType));
}

export function applyUniverseFilters(
  instruments: Instrument[],
  quoteCurrencies?: Set<string> | null,
): Instrument[] {
  let filtered = filterSpotOrFutures(instruments);
  if (quoteCurrencies) {
    filtered = filterByQuoteCurrencies(filtered, quoteCurrencies);
  }
  return filtered;
}

export function filterUniverseByQuote<T extends { quote: string | null }>(
  entries: T[],
  quoteCurrencies: Set<string>,
): T[] {
  const wanted = new Set([...quoteCurrencies].map((q) => q.toUpperCase()));
  return entries.filter((e) => e.quote != null && wanted.has(e.quote.toUpperCase()));
}

export function buildSymbolUniverse(
  instruments: Instrument[],
): Record<string, unknown>[] {
  const grouped = new Map<string, Record<string, unknown>>();
  const exchangeMap = new Map<string, Set<string>>();

  for (const inst of instruments) {
    const category = marketCategory(inst.instrumentType);
    if (!category) continue;
    const key = `${inst.instrumentType}::${inst.symbolCanonical}`;
    if (!exchangeMap.has(key)) exchangeMap.set(key, new Set());
    exchangeMap.get(key)!.add(inst.exchange);
    if (!grouped.has(key)) {
      grouped.set(key, {
        market_category: category,
        instrument_type: inst.instrumentType,
        symbol_canonical: inst.symbolCanonical,
        base: inst.base,
        quote: inst.quote,
      });
    }
  }

  const out: Record<string, unknown>[] = [];
  for (const [key, item] of grouped) {
    out.push({
      ...item,
      listed_on: [...(exchangeMap.get(key) ?? [])].sort(),
    });
  }
  out.sort((a, b) => {
    const ak = `${a.market_category}|${a.instrument_type}|${a.symbol_canonical}`;
    const bk = `${b.market_category}|${b.instrument_type}|${b.symbol_canonical}`;
    return ak.localeCompare(bk);
  });
  return out;
}
