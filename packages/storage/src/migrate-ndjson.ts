import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, type Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { readdir } from "node:fs/promises";
import type { Instrument } from "@screener/core";
import { rawNdjsonPath } from "./paths.js";

export interface MigrateLegacyNdjsonResult {
  filesSplit: number;
  rowsWritten: number;
  filesArchived: number;
  skipped: number;
}

interface PartitionCtx {
  exchange?: string;
  instrumentType?: string;
  interval?: string;
  day?: string;
  symbol?: string;
}

function rowKey(row: Record<string, unknown>): string | null {
  const openTime = row.open_time_ms;
  if (typeof openTime !== "number") return null;
  const sym = row.symbol_native != null ? String(row.symbol_native) : "";
  const ex = row.exchange != null ? String(row.exchange).toLowerCase() : "";
  const it = row.instrument_type != null ? String(row.instrument_type) : "";
  return `${ex}|${it}|${sym}|${openTime}`;
}

function existingKeysAt(path: string): Set<string> {
  const keys = new Set<string>();
  if (!existsSync(path)) return keys;
  try {
    for (const line of readFileSync(path, "utf-8").trimEnd().split("\n")) {
      if (!line) continue;
      const key = rowKey(JSON.parse(line) as Record<string, unknown>);
      if (key) keys.add(key);
    }
  } catch {
    /* empty */
  }
  return keys;
}

async function walkPartition(
  fallbackDir: string,
  dir: string,
  ctx: PartitionCtx,
  result: MigrateLegacyNdjsonResult,
  dryRun: boolean,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    const name = ent.name;
    const full = join(dir, name);
    if (ent.isDirectory()) {
      const next: PartitionCtx = { ...ctx };
      if (name.startsWith("exchange=")) next.exchange = name.slice("exchange=".length);
      else if (name.startsWith("instrument_type=")) next.instrumentType = name.slice("instrument_type=".length);
      else if (name.startsWith("interval=")) next.interval = name.slice("interval=".length);
      else if (name.startsWith("date=")) next.day = name.slice("date=".length);
      else if (name.startsWith("symbol=")) next.symbol = name.slice("symbol=".length);
      await walkPartition(fallbackDir, full, next, result, dryRun);
      continue;
    }

    if (name !== "data.ndjson") continue;
    if (ctx.symbol != null) {
      result.skipped += 1;
      continue;
    }
    if (!ctx.exchange || !ctx.instrumentType || !ctx.interval || !ctx.day) continue;

    const buckets = new Map<string, Record<string, unknown>[]>();
    for (const line of readFileSync(full, "utf-8").trimEnd().split("\n")) {
      if (!line) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const sym = row.symbol_native != null ? String(row.symbol_native) : "";
      if (!sym) continue;
      const list = buckets.get(sym);
      if (list) list.push(row);
      else buckets.set(sym, [row]);
    }

    if (buckets.size === 0) continue;
    result.filesSplit += 1;
    if (dryRun) continue;

    for (const [symbolNative, rows] of buckets) {
      const inst: Pick<Instrument, "exchange" | "instrumentType" | "symbolNative"> = {
        exchange: ctx.exchange,
        instrumentType: ctx.instrumentType,
        symbolNative,
      };
      const dest = rawNdjsonPath(fallbackDir, inst, ctx.interval, ctx.day);
      mkdirSync(dirname(dest), { recursive: true });
      const existing = existingKeysAt(dest);
      for (const row of rows) {
        const key = rowKey(row);
        if (key == null || existing.has(key)) continue;
        existing.add(key);
        appendFileSync(dest, `${JSON.stringify(row)}\n`, "utf-8");
        result.rowsWritten += 1;
      }
    }

    renameSync(full, `${full}.legacy.bak`);
    result.filesArchived += 1;
  }
}

/** Split legacy shared `date=…/data.ndjson` files into per-symbol day files. */
export async function migrateLegacySharedNdjson(
  fallbackDir: string,
  opts?: { dryRun?: boolean },
): Promise<MigrateLegacyNdjsonResult> {
  const rawRoot = join(fallbackDir, "raw");
  const result: MigrateLegacyNdjsonResult = {
    filesSplit: 0,
    rowsWritten: 0,
    filesArchived: 0,
    skipped: 0,
  };
  if (!existsSync(rawRoot)) return result;
  await walkPartition(fallbackDir, rawRoot, {}, result, opts?.dryRun === true);
  return result;
}
