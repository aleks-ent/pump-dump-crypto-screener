import type { ArchiveFile, Instrument } from "@screener/core";

const BASE_URL = "https://data.binance.vision";

const TYPE_TO_PREFIX: Record<string, string> = {
  spot: "data/spot/daily/klines",
  linear_perp: "data/futures/um/daily/klines",
  inverse_futures: "data/futures/cm/daily/klines",
};

export function supportsArchives(inst: Instrument): boolean {
  return inst.instrumentType in TYPE_TO_PREFIX;
}

export function planArchives(
  inst: Instrument,
  interval: string,
  startMs: number,
  endMs: number,
): ArchiveFile[] {
  const prefix = TYPE_TO_PREFIX[inst.instrumentType];
  if (!prefix) return [];

  const startDt = new Date(startMs);
  const endDt = new Date(endMs);
  let day = new Date(Date.UTC(startDt.getUTCFullYear(), startDt.getUTCMonth(), startDt.getUTCDate()));
  const endDay = new Date(Date.UTC(endDt.getUTCFullYear(), endDt.getUTCMonth(), endDt.getUTCDate()));

  const out: ArchiveFile[] = [];
  while (day < endDay) {
    const dayStr = day.toISOString().slice(0, 10);
    const filename = `${inst.symbolNative}-${interval}-${dayStr}.zip`;
    const url = `${BASE_URL}/${prefix}/${inst.symbolNative}/${interval}/${filename}`;
    const relPath = `exchange=${inst.exchange}/instrument_type=${inst.instrumentType}/interval=${interval}/symbol=${inst.symbolNative}/date=${dayStr}/${filename}`;
    out.push({ url, relPath, label: dayStr });
    day = new Date(day.getTime() + 86400000);
  }
  return out;
}
