#!/usr/bin/env node
import { join } from "node:path";
import { Command } from "commander";
import pLimit from "p-limit";
import { runArchiveSeries, runTasksParallel, UrlCache } from "@screener/archive";
import { resolveRepoPath } from "@screener/core";
import { writeArchiveGaps, writeArchiveManifest } from "@screener/storage";
import { loadUniverse } from "@screener/universe";
import { makeHttpClient, prepareArchiveRun } from "./run-context.js";

function log(msg: string): void {
  console.log(msg);
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .description("Download 1m/5m kline archives for symbol universe")
    .option(
      "--universe <path>",
      "Symbol universe JSON",
      "data/market_stats/reports/symbol_universe.json",
    )
    .option("--start <iso>", "ISO UTC start")
    .option("--end <iso>", "ISO UTC end")
    .option("--exchanges <items...>", "Exchanges", (v, prev: string[]) => [...prev, v], [
      "binance",
      "bybit",
    ])
    .option("--quote-currencies <items...>", "Quote currencies", (v, prev: string[]) => [...prev, v], [
      "USDT",
    ])
    .option("--output <dir>", "Output directory", "data/market_stats")
    .option("--config <path>", "YAML config")
    .option("--workers <n>", "Parallel series workers", "8")
    .option("--file-workers <n>", "Parallel file downloads per series", "4")
    .option("--max-downloads <n>", "Global download cap", "32")
    .option("--no-skip-existing", "Re-fetch even when archive/fallback files exist")
    .option(
      "--rebuild-coverage-index",
      "Ignore coverage_index.json and re-scan all series on disk",
    )
    .option("--no-fallback", "Skip REST fallback");

  const argv = process.argv.slice(2).filter((a) => a !== "--");
  program.parse(argv, { from: "user" });
  const opts = program.opts<{
    universe: string;
    start?: string;
    end?: string;
    exchanges: string[];
    quoteCurrencies: string[];
    output: string;
    config?: string;
    workers: string;
    fileWorkers: string;
    maxDownloads: string;
    noSkipExisting?: boolean;
    rebuildCoverageIndex?: boolean;
    noFallback?: boolean;
  }>();

  const selectedExchanges = new Set(opts.exchanges);
  const ctx = await prepareArchiveRun({
    universe: opts.universe,
    start: opts.start,
    end: opts.end,
    exchanges: opts.exchanges,
    quoteCurrencies: opts.quoteCurrencies,
    output: opts.output,
    config: opts.config,
    skipExisting: !opts.noSkipExisting,
    updateCoverageIndex: !opts.noSkipExisting,
    rebuildCoverageIndex: opts.rebuildCoverageIndex,
  });

  const {
    cfg,
    startMs,
    endMs,
    baseDir,
    archivesDir,
    fallbackDir,
    adapters,
    tasks,
    pending,
  } = ctx;
  const universe = loadUniverse(resolveRepoPath(opts.universe));
  const allowFallback = !opts.noFallback;
  const urlCache = new UrlCache();
  const downloadLimit = pLimit(Number(opts.maxDownloads));
  const workers = Math.max(1, Number(opts.workers));
  const indexPath = join(baseDir, "reports", "instrument_index.json");

  log(
    `Universe: ${universe.length} entries, ${tasks.length} series, ${pending.length} pending (${ctx.skippedExisting} already on disk)`,
  );

  log(
    `Downloading ${pending.length} series (workers=${workers}, file_workers=${opts.fileWorkers}, max_downloads=${opts.maxDownloads})...`,
  );

  const fileWorkers = Math.max(1, Number(opts.fileWorkers));
  // One shared client so the rate limiter and 418/429 cooldowns apply across
  // all concurrent series instead of resetting per task.
  const client = makeHttpClient(cfg, { cooldownDir: ctx.cooldownDir, log });
  const runState = await runTasksParallel(
    pending,
    async (task) => {
      const adapter = adapters[task.instrument.exchange]!;
      const result = await runArchiveSeries(
        task.instrument,
        task.interval,
        startMs,
        endMs,
        archivesDir,
        client,
        {
          allowFallback,
          fallbackDir,
          adapter,
          fileWorkers,
          downloadLimit,
          urlCache,
        },
      );

      return {
        key: result.key,
        status: result.status,
        archives_present: result.archivesPresent,
        archives_downloaded: result.archivesDownloaded,
        gaps: result.gaps,
        fallback_rows: result.fallbackRows,
        gap_records: result.gapRecords,
        exchange: task.instrument.exchange,
      };
    },
    {
      workers,
      onProgress: (done, total, task) => {
        if (done === 1 || done === total || done % 50 === 0) {
          log(
            `Progress ${done}/${total} ${task.instrument.exchange} ${task.instrument.symbolNative} ${task.interval}`,
          );
        }
      },
    },
  );

  writeArchiveGaps(baseDir, runState.gapRecords);

  const manifestPath = writeArchiveManifest(baseDir, {
    generated_at_utc: new Date().toISOString(),
    window: { start_ms: startMs, end_ms: endMs },
    universe: opts.universe,
    intervals: ctx.intervals,
    exchanges: [...selectedExchanges].sort(),
    workers,
    file_workers: fileWorkers,
    max_downloads: Number(opts.maxDownloads),
    task_count: tasks.length,
    pending_count: pending.length,
    warnings_count: 0,
    stats: runState.stats,
    per_exchange: runState.perExchange,
    paths: {
      archives: archivesDir,
      api_fallback: fallbackDir,
      instrument_index: indexPath,
    },
  });

  console.log(
    JSON.stringify({ status: "ok", manifest: manifestPath, stats: runState.stats }, null, 2),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
