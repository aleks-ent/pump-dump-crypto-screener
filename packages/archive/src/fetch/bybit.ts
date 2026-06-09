import type { ArchiveFile, Instrument } from "@screener/core";

const BASE_URL = "https://public.bybit.com/kline_for_metatrader4";
const INTERVAL_CODE: Record<string, string> = { "1m": "1", "5m": "5" };
const ARCHIVE_TYPES = new Set(["linear_perp", "inverse_futures"]);

let skipPublicArchives = false;

/** When true, linear/inverse use REST only (public CDN blocked or disabled in config). */
export function setBybitSkipPublicArchives(skip: boolean): void {
  skipPublicArchives = skip;
}

export function bybitSkipsPublicArchives(): boolean {
  return skipPublicArchives;
}

export function supportsArchives(inst: Instrument): boolean {
  if (skipPublicArchives) return false;
  return ARCHIVE_TYPES.has(inst.instrumentType);
}

function monthRanges(startDay: Date, endDay: Date): [Date, Date][] {
  const ranges: [Date, Date][] = [];
  let cursorMs = startDay.getTime();
  const endMs = endDay.getTime();
  while (cursorMs < endMs) {
    const cursor = new Date(cursorMs);
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const lastDom = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const monthEndMs = Date.UTC(y, m, lastDom) + 86400000;
    const segmentEndMs = Math.min(monthEndMs, endMs);
    const lastInclusiveMs = segmentEndMs - 86400000;
    ranges.push([new Date(cursorMs), new Date(lastInclusiveMs)]);
    cursorMs = segmentEndMs;
  }
  return ranges;
}

export function planArchives(
  inst: Instrument,
  interval: string,
  startMs: number,
  endMs: number,
): ArchiveFile[] {
  if (!supportsArchives(inst)) return [];
  const intervalCode = INTERVAL_CODE[interval];
  if (!intervalCode) return [];

  const startDay = new Date(startMs);
  const endDay = new Date(endMs);
  const startDate = new Date(
    Date.UTC(startDay.getUTCFullYear(), startDay.getUTCMonth(), startDay.getUTCDate()),
  );
  const endDate = new Date(
    Date.UTC(endDay.getUTCFullYear(), endDay.getUTCMonth(), endDay.getUTCDate()),
  );
  if (startDate >= endDate) return [];

  const out: ArchiveFile[] = [];
  for (const [rangeStart, rangeEnd] of monthRanges(startDate, endDate)) {
    const startLabel = rangeStart.toISOString().slice(0, 10);
    const endLabel = rangeEnd.toISOString().slice(0, 10);
    const filename = `${inst.symbolNative}_${intervalCode}_${startLabel}_${endLabel}.csv.gz`;
    const url = `${BASE_URL}/${inst.symbolNative}/${rangeStart.getUTCFullYear()}/${filename}`;
    const relPath = `exchange=${inst.exchange}/instrument_type=${inst.instrumentType}/interval=${interval}/symbol=${inst.symbolNative}/range=${startLabel}_${endLabel}/${filename}`;
    out.push({ url, relPath, label: `${startLabel}_${endLabel}` });
  }
  return out;
}
