import { existsSync } from "node:fs";
import type { ArchiveFile, Instrument } from "@screener/core";
import { archiveFilePath } from "@screener/archive";
import type { Candle, Timeframe } from "../../types.js";
import { readGzipText } from "./compress.js";
import { normalizeOpenTimeMs, parseMt4DateTime, splitCsvLine } from "./parse-csv.js";

const INTERVAL_CODE: Record<string, string> = { "1m": "1", "5m": "5" };

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

function planBybitArchives(
  inst: Instrument,
  interval: string,
  startMs: number,
  endMs: number,
): ArchiveFile[] {
  const intervalCode = INTERVAL_CODE[interval];
  if (!intervalCode) return [];
  if (!["linear_perp", "inverse_futures"].includes(inst.instrumentType)) return [];

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
    const relPath = `exchange=${inst.exchange}/instrument_type=${inst.instrumentType}/interval=${interval}/symbol=${inst.symbolNative}/range=${startLabel}_${endLabel}/${filename}`;
    out.push({ url: "", relPath, label: `${startLabel}_${endLabel}` });
  }
  return out;
}

function parseBybitMt4Csv(text: string, inst: Instrument, interval: Timeframe): Candle[] {
  const candles: Candle[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const cols = splitCsvLine(trimmed);
    if (cols.length < 6) continue;

    let openTimeMs = NaN;
    let o = 0;
    if (cols.length >= 8 && cols[0]!.includes(".")) {
      openTimeMs = parseMt4DateTime(cols[0]!, cols[1]!);
      o = 2;
    } else {
      openTimeMs = normalizeOpenTimeMs(Number(cols[0]));
      o = 1;
    }

    const open = Number(cols[o]);
    const high = Number(cols[o + 1]);
    const low = Number(cols[o + 2]);
    const close = Number(cols[o + 3]);
    const volume = Number(cols[o + 4]);
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
      quoteVolume: volume * close,
    });
  }
  return candles;
}

export function loadBybitArchives(
  archivesDir: string,
  inst: Instrument,
  interval: Timeframe,
  startMs: number,
  endMs: number,
): { candles: Candle[]; paths: string[] } {
  const planned = planBybitArchives(inst, interval, startMs, endMs);
  const paths: string[] = [];
  const all: Candle[] = [];
  for (const archive of planned) {
    const path = archiveFilePath(archivesDir, archive);
    if (!existsSync(path)) continue;
    paths.push(path);
    const text = readGzipText(path);
    all.push(...parseBybitMt4Csv(text, inst, interval));
  }
  const filtered = all.filter((c) => c.openTimeMs >= startMs && c.openTimeMs < endMs);
  filtered.sort((a, b) => a.openTimeMs - b.openTimeMs);
  return { candles: filtered, paths };
}
