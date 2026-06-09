#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { resolveRepoPath } from "@screener/core";
import { seriesKey, writeArchiveIncompleteReport } from "@screener/storage";
import { prepareArchiveRun, symbolCliArgs } from "./run-context.js";
import {
  buildReasonMap,
  enrichCoinsWithReasons,
  groupIncompleteByCoin,
  loadExchangeIncompleteRows,
  printIncompleteReport,
} from "./report-incomplete.js";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const EXCHANGE_SCRIPT = join(APP_DIR, "run-exchange.ts");

const ALL_EXCHANGES = ["binance", "bybit"] as const;

const DEFAULT_PROCESSES: Record<(typeof ALL_EXCHANGES)[number], number> = {
  binance: 16,
  bybit: 8,
};

function log(msg: string): void {
  console.log(msg);
}

function runExchangeProcess(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "tsx", EXCHANGE_SCRIPT, ...args], {
      cwd: join(APP_DIR, ".."),
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function parseDaysArg(raw: string | undefined): number {
  if (raw == null || raw === "") {
    throw new Error("Days is required (positional argument or --days N)");
  }
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 1) {
    throw new Error("Days must be a positive number");
  }
  return days;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .description(
      "Fetch 1m/5m data for Binance and Bybit: N−1 archive UTC days + today via REST; skips series already on disk",
    )
    .argument("<days>", "Lookback window in days (only required parameter)")
    .option("--days <n>", "Same as the positional days argument")
    .option("--universe <path>", "Symbol universe JSON")
    .option(
      "--start <iso>",
      "ISO UTC start (default: today − (N−1) days at 00:00 UTC when using positional days)",
    )
    .option("--end <iso>", "ISO UTC end (default: now)")
    .option("--quote-currencies <items...>", "Quote currencies (default: USDT)")
    .option("--output <dir>", "Output directory (default: data/market_stats)")
    .option("--config <path>", "YAML config (default: config/archives.yaml)")
    .option("--processes <n>", "Worker count per exchange (default: binance 16, bybit 8)")
    .option("--series-workers <n>", "Parallel series per worker process (default: 8)")
    .option("--file-workers <n>", "Parallel archive files per series (default: 8)")
    .option("--max-downloads <n>", "Per-worker download cap (default: 24)")
    .option("--no-fallback", "Skip REST fallback (default: fallback on)")
    .option(
      "--rebuild-coverage-index",
      "Ignore coverage_index.json and re-scan all series on disk",
    )
    .option(
      "--symbol <name>",
      "Fetch only this coin (native or canonical, e.g. BTCUSDT or BTC/USDT); repeatable",
      (v, prev: string[]) => [...prev, v],
      [],
    );

  const argv = process.argv.slice(2).filter((a) => a !== "--");
  program.parse(argv, { from: "user" });
  const opts = program.opts<{
    days?: string;
    universe?: string;
    start?: string;
    end?: string;
    quoteCurrencies?: string[];
    output?: string;
    config?: string;
    processes?: string;
    seriesWorkers?: string;
    fileWorkers?: string;
    maxDownloads?: string;
    noFallback?: boolean;
    rebuildCoverageIndex?: boolean;
    symbol?: string[];
  }>();

  const days = parseDaysArg(program.args[0] ?? opts.days);

  const symbols = opts.symbol ?? [];
  const universe = opts.universe ?? "data/market_stats/reports/symbol_universe.json";
  const output = opts.output ?? "data/market_stats";
  const quoteCurrencies = opts.quoteCurrencies?.length ? opts.quoteCurrencies : ["USDT"];
  const seriesWorkers = opts.seriesWorkers ?? "8";
  const fileWorkers = opts.fileWorkers ?? "8";
  const maxDownloads = opts.maxDownloads ?? "24";

  const exchanges = [...ALL_EXCHANGES];

  const ctx = await prepareArchiveRun({
    universe,
    start: opts.start,
    end: opts.end,
    exchanges: [...exchanges],
    quoteCurrencies,
    output,
    config: opts.config,
    defaultDays: days,
    skipExisting: true,
    updateCoverageIndex: true,
    rebuildCoverageIndex: opts.rebuildCoverageIndex,
    symbols,
  });

  if (symbols.length > 0 && ctx.tasks.length === 0) {
    throw new Error(`No series matched --symbol: ${symbols.join(", ")}`);
  }

  const startIso = opts.start ?? new Date(ctx.startMs).toISOString();
  const endIso = opts.end ?? new Date(ctx.endMs).toISOString();

  log(
    `All exchanges: ${exchanges.join(", ")} | ${days} day(s) | window ${startIso} → ${endIso}`,
  );
  if (symbols.length > 0) {
    log(`Symbol filter: ${symbols.join(", ")} (debug mode, default 1 worker per exchange)`);
  }
  log(
    `Universe: ${ctx.tasks.length} series total, ${ctx.pending.length} pending (${ctx.skippedExisting} already satisfied — ${ctx.coverageIndexHits} index hits, ${ctx.coverageDiskChecks} disk checks)`,
  );

  const exchangesToRun = exchanges.filter((ex) =>
    ctx.pending.some((t) => t.instrument.exchange === ex),
  );

  if (exchangesToRun.length === 0) {
    log("Nothing to fetch — all filtered series already on disk.");
  }

  // Each exchange hits a different set of hosts, so run them concurrently
  // instead of one-after-another. (Output from the child processes interleaves,
  // but each line is already prefixed with the exchange + shard.)
  const runs = exchangesToRun.map((exchange) => {
    const processes =
      opts.processes != null
        ? String(Math.max(1, Number(opts.processes)))
        : symbols.length > 0
          ? "1"
          : String(DEFAULT_PROCESSES[exchange as (typeof ALL_EXCHANGES)[number]]);

    log(`=== ${exchange} (${processes} workers) ===`);

    const args = [
      "--exchange",
      exchange,
      "--days",
      String(days),
      "--start",
      startIso,
      "--end",
      endIso,
      "--processes",
      processes,
      "--universe",
      universe,
      "--output",
      output,
      "--series-workers",
      seriesWorkers,
      "--file-workers",
      fileWorkers,
      "--max-downloads",
      maxDownloads,
      ...quoteCurrencies.flatMap((q) => ["--quote-currencies", q]),
    ];
    // run-all already discovered + wrote the full instrument index above, so
    // each exchange process must not re-discover and race the index file.
    args.push("--skip-discovery");
    if (opts.config) args.push("--config", opts.config);
    if (opts.noFallback) args.push("--no-fallback");
    args.push(...symbolCliArgs(symbols));

    return runExchangeProcess(args).then((code) => ({ exchange, code }));
  });

  const attemptedKeys = new Set(
    ctx.pending.map((t) => seriesKey(t.instrument, t.interval)),
  );

  const results = await Promise.all(runs);
  const failures = results.filter((r) => r.code !== 0);
  if (failures.length > 0) {
    throw new Error(
      `Exchange(s) failed: ${failures.map((f) => `${f.exchange} (exit ${f.code})`).join(", ")}`,
    );
  }

  const after = await prepareArchiveRun({
    universe,
    start: startIso,
    end: endIso,
    exchanges: [...exchanges],
    quoteCurrencies,
    output,
    config: opts.config,
    defaultDays: days,
    skipDiscovery: true,
    skipExisting: true,
    updateCoverageIndex: true,
    rebuildCoverageIndex: opts.rebuildCoverageIndex,
    symbols,
  });

  const stillPending = after.pending.filter((t) =>
    attemptedKeys.has(seriesKey(t.instrument, t.interval)),
  );
  const baseDir = resolveRepoPath(output);
  const reasonRows = loadExchangeIncompleteRows(baseDir, exchanges);
  const reasonMap = buildReasonMap(reasonRows);
  const incompleteCoins = enrichCoinsWithReasons(
    groupIncompleteByCoin(stillPending),
    reasonMap,
  );

  printIncompleteReport(incompleteCoins, log);

  const reportPath = writeArchiveIncompleteReport(baseDir, {
    generated_at_utc: new Date().toISOString(),
    window: { start: startIso, end: endIso },
    incomplete_coins: incompleteCoins.length,
    incomplete_series: stillPending.length,
    coins: incompleteCoins,
  });

  console.log(
    JSON.stringify(
      {
        status: incompleteCoins.length === 0 ? "ok" : "incomplete",
        exchanges,
        days,
        window: { start: startIso, end: endIso },
        pending_at_start: ctx.pending.length,
        skipped_existing: ctx.skippedExisting,
        coverage_index_hits: ctx.coverageIndexHits,
        coverage_disk_checks: ctx.coverageDiskChecks,
        still_incomplete_coins: incompleteCoins.length,
        still_incomplete_series: stillPending.length,
        incomplete_report: reportPath,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
