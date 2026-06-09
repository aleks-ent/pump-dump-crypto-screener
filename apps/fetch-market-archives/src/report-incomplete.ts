import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { seriesKey } from "@screener/storage";
import type { SeriesTask } from "@screener/universe";

export interface IncompleteSeriesRow {
  exchange: string;
  instrument_type: string;
  symbol_native: string;
  interval: string;
  status: string;
  reason?: string;
}

export interface IncompleteCoinRow {
  exchange: string;
  instrument_type: string;
  symbol_native: string;
  intervals: Array<{ interval: string; status: string; reason?: string }>;
}

function seriesReasonKey(
  exchange: string,
  instrumentType: string,
  symbolNative: string,
  interval: string,
): string {
  return `${exchange}|${instrumentType}|${symbolNative}|${interval}`;
}

export function loadExchangeIncompleteRows(
  baseDir: string,
  exchanges: string[],
): IncompleteSeriesRow[] {
  const rows: IncompleteSeriesRow[] = [];
  for (const exchange of exchanges) {
    const path = join(baseDir, "reports", `archive_incomplete.${exchange}.ndjson`);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      if (line.trim().length === 0) continue;
      const raw = JSON.parse(line) as Record<string, unknown>;
      rows.push({
        exchange: String(raw.exchange),
        instrument_type: String(raw.instrument_type),
        symbol_native: String(raw.symbol_native),
        interval: String(raw.interval),
        status: String(raw.status),
        reason: raw.reason != null ? String(raw.reason) : undefined,
      });
    }
  }
  return rows;
}

export function buildReasonMap(rows: IncompleteSeriesRow[]): Map<string, IncompleteSeriesRow> {
  const map = new Map<string, IncompleteSeriesRow>();
  for (const row of rows) {
    map.set(
      seriesReasonKey(row.exchange, row.instrument_type, row.symbol_native, row.interval),
      row,
    );
  }
  return map;
}

export function groupIncompleteByCoin(tasks: SeriesTask[]): IncompleteCoinRow[] {
  const grouped = new Map<string, IncompleteCoinRow>();
  for (const task of tasks) {
    const inst = task.instrument;
    const coinKey = `${inst.exchange}|${inst.instrumentType}|${inst.symbolNative}`;
    if (!grouped.has(coinKey)) {
      grouped.set(coinKey, {
        exchange: inst.exchange,
        instrument_type: inst.instrumentType,
        symbol_native: inst.symbolNative,
        intervals: [],
      });
    }
    grouped.get(coinKey)!.intervals.push({ interval: task.interval, status: "incomplete" });
  }
  const out = [...grouped.values()];
  out.sort(
    (a, b) =>
      a.exchange.localeCompare(b.exchange) ||
      a.symbol_native.localeCompare(b.symbol_native) ||
      a.instrument_type.localeCompare(b.instrument_type),
  );
  for (const coin of out) {
    coin.intervals.sort((a, b) => a.interval.localeCompare(b.interval));
  }
  return out;
}

export function enrichCoinsWithReasons(
  coins: IncompleteCoinRow[],
  reasonMap: Map<string, IncompleteSeriesRow>,
): IncompleteCoinRow[] {
  return coins.map((coin) => ({
    ...coin,
    intervals: coin.intervals.map((iv) => {
      const row = reasonMap.get(
        seriesReasonKey(coin.exchange, coin.instrument_type, coin.symbol_native, iv.interval),
      );
      return {
        interval: iv.interval,
        status: row?.status ?? iv.status,
        reason: row?.reason,
      };
    }),
  }));
}

export function printIncompleteReport(
  coins: IncompleteCoinRow[],
  log: (msg: string) => void,
): void {
  if (coins.length === 0) {
    log("All attempted coins fully fetched for the window.");
    return;
  }

  const byExchange = new Map<string, IncompleteCoinRow[]>();
  for (const coin of coins) {
    if (!byExchange.has(coin.exchange)) byExchange.set(coin.exchange, []);
    byExchange.get(coin.exchange)!.push(coin);
  }

  log(`=== Incomplete fetch report: ${coins.length} coin(s) not fully fetched ===`);
  for (const [exchange, exchangeCoins] of [...byExchange.entries()].sort()) {
    log(`${exchange}: ${exchangeCoins.length} coin(s)`);
    for (const coin of exchangeCoins) {
      const parts = coin.intervals.map((iv) => {
        const detail = iv.reason ? `${iv.status} (${iv.reason})` : iv.status;
        return `${iv.interval} [${detail}]`;
      });
      log(`  ${coin.symbol_native} (${coin.instrument_type}): ${parts.join(", ")}`);
    }
  }
}
