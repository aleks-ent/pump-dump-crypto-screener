import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Instrument } from "@screener/core";
import { rawNdjsonPath } from "@screener/storage";
import { loadExchangeArchives } from "./load/archives/index.js";
import type { Candle, Timeframe } from "./types.js";

function candleToRow(c: Candle): Record<string, unknown> {
  return {
    exchange: c.exchange,
    instrument_type: c.instrumentType,
    symbol_native: c.symbolNative,
    interval: c.interval,
    open_time_ms: c.openTimeMs,
    open: String(c.open),
    high: String(c.high),
    low: String(c.low),
    close: String(c.close),
    volume: String(c.volume),
    quote_volume: String(c.quoteVolume),
  };
}

export interface ExtractResult {
  writtenPaths: string[];
  barsWritten: number;
  barsSkipped: number;
}

export function extractArchivesToNdjson(
  inst: Instrument,
  interval: Timeframe,
  opts: {
    archivesDir: string;
    outRoot: string;
    startMs: number;
    endMs: number;
    onLog?: (msg: string) => void;
  },
): ExtractResult {
  const { candles, paths } = loadExchangeArchives(
    opts.archivesDir,
    inst,
    interval,
    opts.startMs,
    opts.endMs,
  );

  if (paths.length === 0) {
    opts.onLog?.(
      `[extract] no archive zips for ${inst.exchange} ${inst.symbolNative} ${interval}`,
    );
    return { writtenPaths: [], barsWritten: 0, barsSkipped: 0 };
  }

  opts.onLog?.(
    `[extract] unpacking ${paths.length} archive file(s) for ${inst.exchange} ${inst.symbolNative} ${interval}`,
  );

  const byDay = new Map<string, Candle[]>();
  for (const c of candles) {
    if (c.openTimeMs < opts.startMs || c.openTimeMs >= opts.endMs) continue;
    const day = new Date(c.openTimeMs).toISOString().slice(0, 10);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(c);
    else byDay.set(day, [c]);
  }

  const writtenPaths: string[] = [];
  let barsWritten = 0;
  let barsSkipped = 0;

  for (const [day, dayCandles] of byDay) {
    const path = rawNdjsonPath(opts.outRoot, inst, interval, day);
    mkdirSync(dirname(path), { recursive: true });

    const existing = new Set<number>();
    if (existsSync(path)) {
      for (const line of readFileSync(path, "utf-8").trimEnd().split("\n").filter(Boolean)) {
        const row = JSON.parse(line) as { open_time_ms?: number };
        if (typeof row.open_time_ms === "number") existing.add(row.open_time_ms);
      }
    }

    for (const c of dayCandles) {
      if (existing.has(c.openTimeMs)) {
        barsSkipped += 1;
        continue;
      }
      appendFileSync(path, `${JSON.stringify(candleToRow(c))}\n`, "utf-8");
      barsWritten += 1;
      if (!writtenPaths.includes(path)) writtenPaths.push(path);
    }
  }

  opts.onLog?.(
    `[extract] wrote ${barsWritten} bars (${barsSkipped} skipped dupes) to ${writtenPaths.length} file(s) for ${inst.exchange} ${inst.symbolNative}`,
  );

  return { writtenPaths, barsWritten, barsSkipped };
}
