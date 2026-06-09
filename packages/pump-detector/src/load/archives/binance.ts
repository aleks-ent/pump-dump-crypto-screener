import type { ArchiveFile, Instrument } from "@screener/core";
import { archiveFilePath } from "@screener/archive";

function planBinanceArchives(
  inst: Instrument,
  interval: string,
  startMs: number,
  endMs: number,
): ArchiveFile[] {
  const prefixByType: Record<string, string> = {
    spot: "data/spot/daily/klines",
    linear_perp: "data/futures/um/daily/klines",
    inverse_futures: "data/futures/cm/daily/klines",
  };
  const prefix = prefixByType[inst.instrumentType];
  if (!prefix) return [];

  const startDt = new Date(startMs);
  const endDt = new Date(endMs);
  let day = new Date(
    Date.UTC(startDt.getUTCFullYear(), startDt.getUTCMonth(), startDt.getUTCDate()),
  );
  const endDay = new Date(
    Date.UTC(endDt.getUTCFullYear(), endDt.getUTCMonth(), endDt.getUTCDate()),
  );
  const out: ArchiveFile[] = [];
  while (day < endDay) {
    const dayStr = day.toISOString().slice(0, 10);
    const filename = `${inst.symbolNative}-${interval}-${dayStr}.zip`;
    const relPath = `exchange=${inst.exchange}/instrument_type=${inst.instrumentType}/interval=${interval}/symbol=${inst.symbolNative}/date=${dayStr}/${filename}`;
    out.push({ url: "", relPath, label: dayStr });
    day = new Date(day.getTime() + 86400000);
  }
  return out;
}
import { existsSync } from "node:fs";
import type { Candle, Timeframe } from "../../types.js";
import { readZipFirstCsv } from "./compress.js";
import { normalizeOpenTimeMs, splitCsvLine } from "./parse-csv.js";

export function listBinanceArchivePaths(
  archivesDir: string,
  inst: Instrument,
  interval: Timeframe,
  startMs: number,
  endMs: number,
): string[] {
  const planned = planBinanceArchives(inst, interval, startMs, endMs);
  const paths: string[] = [];
  for (const archive of planned) {
    const path = archiveFilePath(archivesDir, archive);
    if (existsSync(path)) paths.push(path);
  }
  return paths;
}

export function parseBinanceKlineCsv(text: string, inst: Instrument, interval: Timeframe): Candle[] {
  const candles: Candle[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = splitCsvLine(trimmed);
    if (cols.length < 6) continue;
    const openTimeMs = normalizeOpenTimeMs(Number(cols[0]));
    const open = Number(cols[1]);
    const high = Number(cols[2]);
    const low = Number(cols[3]);
    const close = Number(cols[4]);
    const volume = Number(cols[5]);
    const quoteVol = cols.length > 7 ? Number(cols[7]) : NaN;
    if (!Number.isFinite(openTimeMs) || open <= 0 || volume <= 0) continue;
    candles.push({
      openTimeMs,
      exchange: inst.exchange,
      instrumentType: inst.instrumentType,
      symbolNative: inst.symbolNative,
      symbolCanonical: inst.symbolCanonical,
      base: inst.base ?? "",
      quote: inst.quote ?? "",
      interval,
      open,
      high,
      low,
      close,
      volume,
      quoteVolume: Number.isFinite(quoteVol) && quoteVol > 0 ? quoteVol : volume * close,
    });
  }
  return candles;
}

export function loadBinanceArchives(
  archivesDir: string,
  inst: Instrument,
  interval: Timeframe,
  startMs: number,
  endMs: number,
): { candles: Candle[]; paths: string[] } {
  const paths = listBinanceArchivePaths(archivesDir, inst, interval, startMs, endMs);
  const all: Candle[] = [];
  for (const path of paths) {
    const text = readZipFirstCsv(path);
    if (!text) continue;
    all.push(...parseBinanceKlineCsv(text, inst, interval));
  }
  const filtered = all.filter((c) => c.openTimeMs >= startMs && c.openTimeMs < endMs);
  filtered.sort((a, b) => a.openTimeMs - b.openTimeMs);
  return { candles: filtered, paths };
}
