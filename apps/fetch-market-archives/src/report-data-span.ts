#!/usr/bin/env node
import { join } from "node:path";
import { Command } from "commander";
import pLimit from "p-limit";
import { loadFetchIntervals, resolveArchiveWindow, resolveRepoPath } from "@screener/core";
import {
  computeDiskDataSpan,
  renderCoverageBar,
  type DiskDataSpan,
  type TimeRange,
} from "@screener/pump-detector";
import { applyUniverseFilters, loadInstrumentIndexFile } from "@screener/universe";

const WORKERS = 32;
const DEFAULT_BAR_WIDTH = 40;

function replacingDefault(): (v: string, prev: string[]) => string[] {
  let cleared = false;
  return (v, prev) => {
    if (!cleared) {
      cleared = true;
      return [v];
    }
    return [...prev, v];
  };
}

function parseDays(raw: string): number {
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 1) {
    throw new Error("--days must be a positive number");
  }
  return days;
}

function formatIsoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function formatShortUtc(ms: number): string {
  const d = new Date(ms);
  const mon = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate().toString().padStart(2, "0");
  const hh = d.getUTCHours().toString().padStart(2, "0");
  const mm = d.getUTCMinutes().toString().padStart(2, "0");
  return `${mon}-${day} ${hh}:${mm}`;
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.round((ms % 3_600_000) / 60_000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const days = Math.round((ms / 86_400_000) * 10) / 10;
  return `${days}d`;
}

function compareSpans(a: DiskDataSpan, b: DiskDataSpan): number {
  if (a.coveragePct !== b.coveragePct) return a.coveragePct - b.coveragePct;
  if (a.presentDays !== b.presentDays) return a.presentDays - b.presentDays;
  if (a.barsPresent !== b.barsPresent) return a.barsPresent - b.barsPresent;
  return (
    a.exchange.localeCompare(b.exchange) ||
    a.instrumentType.localeCompare(b.instrumentType) ||
    a.symbolNative.localeCompare(b.symbolNative)
  );
}

function allDataPaths(dataDir: string): {
  ndjsonRoots: string[];
  archivesDir: string;
  fallbackDir: string;
} {
  return {
    ndjsonRoots: [dataDir, join(dataDir, "api_fallback"), join(dataDir, "extracted")],
    archivesDir: join(dataDir, "archives"),
    fallbackDir: join(dataDir, "api_fallback"),
  };
}

function formatGapLine(gap: TimeRange, endMs: number): string {
  const [gapStart, gapEnd] = gap;
  const endLabel = gapEnd >= endMs - 60_000 ? "now" : formatShortUtc(gapEnd);
  return `${formatShortUtc(gapStart)} → ${endLabel} (${formatDuration(gapEnd - gapStart)})`;
}

function formatPairLabel(row: DiskDataSpan): string {
  const symbol =
    row.symbolCanonical !== row.symbolNative
      ? `${row.symbolNative} (${row.symbolCanonical})`
      : row.symbolNative;
  return `${row.exchange} ${row.instrumentType} ${symbol}`;
}

function printVisualRow(row: DiskDataSpan, barWidth: number, windowEndMs: number): void {
  const bar = renderCoverageBar(row.windowStartMs, row.windowEndMs, row.filledRanges, {
    width: barWidth,
  });
  const cov = `${row.coveragePct.toFixed(1)}%`.padStart(6);
  const label = formatPairLabel(row);

  console.log(`${cov}  ${label}`);
  console.log(
    `       ${formatIsoDay(row.windowStartMs)} ├${bar}┤ ${formatShortUtc(windowEndMs)}`,
  );

  if (row.gapRanges.length === 0) {
    console.log("       complete");
  } else {
    const gaps = [...row.gapRanges].sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
    const shown = gaps.slice(0, 3);
    for (const gap of shown) {
      console.log(`       missing: ${formatGapLine(gap, row.windowEndMs)}`);
    }
    if (gaps.length > shown.length) {
      console.log(`       … ${gaps.length - shown.length} more gap(s)`);
    }
  }
  console.log("");
}

function rangesToJson(ranges: TimeRange[]): Array<{ start: string; end: string; duration_ms: number }> {
  return ranges.map(([start, end]) => ({
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    duration_ms: end - start,
  }));
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .description(
      "Report how much of the pump-scan lookback window is present on disk for every coin on every exchange (least populated first).",
    )
    .option("--data-dir <path>", "Market stats base directory", "data/market_stats")
    .option(
      "--instrument-index <path>",
      "instrument_index.json path (default: <data-dir>/reports/instrument_index.json)",
    )
    .option("--start <iso>", "ISO UTC start (with --end; otherwise use --days)")
    .option("--end <iso>", "ISO UTC end")
    .option(
      "--days <n>",
      "Calendar lookback days when start/end omitted (same window as pump:monitor / fetch:all)",
      "5",
    )
    .option("--exchanges <items...>", "Exchanges", replacingDefault(), ["binance", "bybit"])
    .option("--quote-currencies <items...>", "Quote currencies", replacingDefault(), ["USDT"])
    .option("--limit <n>", "Show only the N least-populated pairs")
    .option("--bar-width <n>", "Timeline bar width in characters", String(DEFAULT_BAR_WIDTH))
    .option("--json", "Emit machine-readable JSON only");

  const argv = process.argv.slice(2).filter((a) => a !== "--");
  program.parse(argv, { from: "user" });
  const opts = program.opts<{
    dataDir: string;
    instrumentIndex?: string;
    start?: string;
    end?: string;
    days: string;
    exchanges: string[];
    quoteCurrencies: string[];
    limit?: string;
    barWidth: string;
    json?: boolean;
  }>();

  const dataDir = resolveRepoPath(opts.dataDir);
  const indexPath = resolveRepoPath(
    opts.instrumentIndex ?? join(dataDir, "reports", "instrument_index.json"),
  );
  const selectedExchanges = new Set(opts.exchanges.map((e) => e.toLowerCase()));
  const quoteCurrencies = new Set(opts.quoteCurrencies.map((q) => q.toUpperCase()));
  const days = parseDays(opts.days);
  const [startMs, endMs] = resolveArchiveWindow(opts.start, opts.end, {}, days);
  const intervals = await loadFetchIntervals();
  const paths = allDataPaths(dataDir);
  const barWidth = Math.max(10, Number(opts.barWidth) || DEFAULT_BAR_WIDTH);

  const instruments = applyUniverseFilters(loadInstrumentIndexFile(indexPath), quoteCurrencies).filter(
    (inst) => selectedExchanges.has(inst.exchange.toLowerCase()),
  );

  const limit = pLimit(WORKERS);
  const rows: DiskDataSpan[] = [];
  await Promise.all(
    instruments.flatMap((inst) =>
      intervals.map((interval) =>
        limit(async () => {
          rows.push(
            computeDiskDataSpan(inst, interval, {
              ...paths,
              startMs,
              endMs,
            }),
          );
        }),
      ),
    ),
  );

  rows.sort(compareSpans);

  const limitN = opts.limit != null ? Number(opts.limit) : undefined;
  const display =
    limitN != null && Number.isFinite(limitN) && limitN > 0 ? rows.slice(0, limitN) : rows;

  const windowStart = new Date(startMs).toISOString();
  const windowEnd = new Date(endMs).toISOString();
  const windowDays = Math.round(((endMs - startMs) / 86_400_000) * 10) / 10;

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          window: { start: windowStart, end: windowEnd, days: windowDays },
          intervals,
          bar_width: barWidth,
          total_pairs: rows.length,
          pairs: display.map((row) => ({
            ...row,
            timeline: renderCoverageBar(row.windowStartMs, row.windowEndMs, row.filledRanges, {
              width: barWidth,
            }),
            filled_ranges: rangesToJson(row.filledRanges),
            gap_ranges: rangesToJson(row.gapRanges),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `Window: ${formatIsoDay(startMs)} → ${formatShortUtc(endMs)} (${windowDays} days), intervals ${intervals.join(",")}`,
  );
  console.log(`${rows.length} exchange/coin pairs (least populated first)`);
  console.log(`Legend: █ present  ▓ partial  ░ missing`);
  console.log("");

  for (const row of display) {
    printVisualRow(row, barWidth, endMs);
  }

  if (limitN != null && rows.length > display.length) {
    console.log(`… ${rows.length - display.length} more pairs omitted (--limit ${limitN})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
