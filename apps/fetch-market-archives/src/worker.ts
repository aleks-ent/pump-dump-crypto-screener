#!/usr/bin/env node
import { Command } from "commander";
import pLimit from "p-limit";
import {
  isSeriesFetchComplete,
  runArchiveSeries,
  runTasksParallel,
  UrlCache,
} from "@screener/archive";
import { appendShardArchiveGaps, appendShardArchiveIncomplete } from "@screener/storage";
import {
  symbolShardSet,
  tasksForSymbolShard,
  uniqueSymbolsForExchange,
} from "@screener/universe";
import { makeHttpClient, prepareArchiveRun } from "./run-context.js";

async function main(): Promise<void> {
  const program = new Command();
  program
    .description("Archive worker: one shard of symbols for a single exchange")
    .requiredOption("--exchange <name>", "Exchange (binance, bybit)")
    .requiredOption("--shard <n>", "Shard index (0-based)")
    .requiredOption("--shards <n>", "Total shard count")
    .option("--universe <path>", "Symbol universe JSON", "data/market_stats/reports/symbol_universe.json")
    .option("--start <iso>", "ISO UTC start")
    .option("--end <iso>", "ISO UTC end")
    .option(
      "--days <n>",
      "Calendar lookback days when start/end omitted (N−1 archive days + today REST)",
      "5",
    )
    .option("--quote-currencies <items...>", "Quote currencies", (v, prev: string[]) => [...prev, v], [
      "USDT",
    ])
    .option("--output <dir>", "Output directory", "data/market_stats")
    .option("--config <path>", "YAML config")
    .option("--series-workers <n>", "Parallel series fetched at once within this process", "8")
    .option("--file-workers <n>", "Parallel file downloads per series", "8")
    .option("--max-downloads <n>", "Per-process download cap", "24")
    .option("--skip-discovery", "Use reports/instrument_index.json (set by orchestrator)")
    .option("--no-fallback", "Skip REST fallback")
    .option(
      "--symbol <name>",
      "Fetch only this coin (native or canonical); repeatable",
      (v, prev: string[]) => [...prev, v],
      [],
    );

  const argv = process.argv.slice(2).filter((a) => a !== "--");
  program.parse(argv, { from: "user" });
  const opts = program.opts<{
    exchange: string;
    shard: string;
    shards: string;
    universe: string;
    start?: string;
    end?: string;
    days: string;
    quoteCurrencies: string[];
    output: string;
    config?: string;
    seriesWorkers: string;
    fileWorkers: string;
    maxDownloads: string;
    skipDiscovery?: boolean;
    noFallback?: boolean;
    symbol?: string[];
  }>();

  const exchange = opts.exchange.toLowerCase();
  const shardIndex = Number(opts.shard);
  const shardCount = Number(opts.shards);
  if (!Number.isInteger(shardIndex) || !Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error("Invalid --shard / --shards");
  }

  const ctx = await prepareArchiveRun({
    universe: opts.universe,
    start: opts.start,
    end: opts.end,
    exchanges: [exchange],
    quoteCurrencies: opts.quoteCurrencies,
    output: opts.output,
    config: opts.config,
    defaultDays: Number(opts.days),
    skipDiscovery: opts.skipDiscovery,
    skipExisting: true,
    symbols: opts.symbol ?? [],
  });

  const exchangePending = ctx.pending.filter((t) => t.instrument.exchange === exchange);
  const symbols = uniqueSymbolsForExchange(exchangePending, exchange);
  const shardSymbols = symbolShardSet(symbols, shardIndex, shardCount);
  const shardTasks = tasksForSymbolShard(exchangePending, exchange, shardSymbols);

  const log = (msg: string): void => {
    console.log(`[${exchange} shard=${shardIndex}/${shardCount}] ${msg}`);
  };

  // One HTTP client (and therefore one rate-limit bucket), one URL cache, and
  // one download-concurrency cap shared across every series in the shard. This
  // lets distinct series download in parallel up to --max-downloads instead of
  // one series (and effectively one file) at a time.
  const client = makeHttpClient(ctx.cfg, { cooldownDir: ctx.cooldownDir, log });
  const urlCache = new UrlCache();
  const downloadLimit = pLimit(Math.max(1, Number(opts.maxDownloads)));
  const fileWorkers = Math.max(1, Number(opts.fileWorkers));
  const seriesWorkers = Math.max(1, Number(opts.seriesWorkers));
  const allowFallback = !opts.noFallback;

  log(
    `exchange=${exchange} shard=${shardIndex}/${shardCount} symbols=${shardSymbols.size} series=${shardTasks.length} (series_workers=${seriesWorkers}, file_workers=${fileWorkers}, max_downloads=${opts.maxDownloads})`,
  );

  const runState = await runTasksParallel(
    shardTasks,
    async (task) => {
      const adapter = ctx.adapters[task.instrument.exchange]!;
      try {
        const result = await runArchiveSeries(
          task.instrument,
          task.interval,
          ctx.startMs,
          ctx.endMs,
          ctx.archivesDir,
          client,
          {
            allowFallback,
            fallbackDir: ctx.fallbackDir,
            adapter,
            fileWorkers,
            downloadLimit,
            urlCache,
            onFallbackFailed: ({ instrument, interval, reason }) => {
              log(`REST fallback failed ${instrument.symbolNative} ${interval}: ${reason}`);
            },
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
          instrument_type: task.instrument.instrumentType,
          symbol_native: task.instrument.symbolNative,
          interval: task.interval,
          error_reason: result.fallbackError,
        };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log(`series error ${task.instrument.symbolNative} ${task.interval}: ${reason}`);
        return {
          key: `${task.instrument.exchange}|${task.instrument.instrumentType}|${task.instrument.symbolNative}|${task.interval}`,
          status: "error",
          archives_present: 0,
          archives_downloaded: 0,
          gaps: 0,
          fallback_rows: 0,
          gap_records: [],
          exchange: task.instrument.exchange,
          instrument_type: task.instrument.instrumentType,
          symbol_native: task.instrument.symbolNative,
          interval: task.interval,
          error_reason: reason,
        };
      }
    },
    {
      workers: seriesWorkers,
      onProgress: (done, total, task, row) => {
        if (row.gap_records.length > 0) {
          appendShardArchiveGaps(ctx.baseDir, shardIndex, shardCount, row.gap_records);
        }
        if (done === 1 || done === total || done % 25 === 0) {
          log(
            `series ${done}/${total}: ${task.instrument.symbolNative} ${task.interval} [${row.status}]`,
          );
        }
      },
    },
  );

  const incompleteRows = runState.rows
    .filter((row) => !isSeriesFetchComplete(row.status))
    .map((row) => ({
      exchange: row.exchange,
      instrument_type: row.instrument_type ?? "",
      symbol_native: row.symbol_native ?? "",
      interval: row.interval ?? "",
      status: row.status,
      ...(row.error_reason ? { reason: row.error_reason } : {}),
    }));
  appendShardArchiveIncomplete(
    ctx.baseDir,
    exchange,
    shardIndex,
    shardCount,
    incompleteRows,
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        exchange,
        shard: shardIndex,
        shards: shardCount,
        symbols: shardSymbols.size,
        stats: runState.stats,
        incomplete_series: incompleteRows.length,
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
