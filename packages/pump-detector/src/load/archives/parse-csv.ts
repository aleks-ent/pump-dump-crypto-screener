/** Normalize exchange timestamps to Unix ms (Binance us, Binance/Bybit ms). */
export function normalizeOpenTimeMs(raw: number): number {
  if (!Number.isFinite(raw)) return NaN;
  if (raw > 1e15) return Math.floor(raw / 1000);
  if (raw > 1e12) return Math.floor(raw);
  if (raw > 1e9) return Math.floor(raw * 1000);
  return NaN;
}

export function parseMt4DateTime(datePart: string, timePart: string): number {
  const d = datePart.trim().replace(/\./g, "-");
  const t = timePart.trim();
  const iso = t.includes(":") ? `${d}T${t}Z` : `${d}T${t}:00Z`;
  const ms = Date.parse(iso.replace(/-/g, (m, off) => (off <= 4 ? m : "-")));
  return ms;
}

export function splitCsvLine(line: string): string[] {
  return line.split(",").map((s) => s.trim());
}
