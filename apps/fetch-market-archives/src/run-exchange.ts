#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import {
  mergeShardArchiveGaps,
  mergeShardArchiveIncomplete,
  writeArchiveManifest,
} from "@screener/storage";
import {
  loadInstrumentIndexFile,
  uniqueSymbolsForExchange,
  writeInstrumentIndex,
} from "@screener/universe";
import {
  configureBybitArchiveMode,
  prepareArchiveRun,
  symbolCliArgs,
} from "./run-context.js";

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT = join(APP_DIR, "worker.ts");

function log(msg: string): void {
  console.log(msg);
}

function runWorker(
  args: string[],
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "tsx", WORKER_SCRIPT, ...args], {
      cwd: join(APP_DIR, ".."),
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .description("Spawn N Node workers to fetch archives per exchange (symbol-sharded)")
    .requiredOption("--exchange <name>", "Exchange: binance or bybit")
    .option("--processes <n>", "Parallel Node worker processes", "8")
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
    .option("--series-workers <n>", "Parallel series per worker process", "8")
    .option("--file-workers <n>", "Parallel file downloads per series (per worker)", "8")
    .option("--max-downloads <n>", "Per-worker global download cap", "24")
    .option("--skip-discovery", "Reuse reports/instrument_index.json (set by run-all)")
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
    processes: string;
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
  const symbolFilter = opts.symbol ?? [];
  const processes = Math.max(1, Number(opts.processes));

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
    symbols: symbolFilter,
  });

  const exchangePending = ctx.pending.filter((t) => t.instrument.exchange === exchange);
  const symbols = uniqueSymbolsForExchange(exchangePending, exchange);

  if (exchangePending.length === 0) {
    log(`Exchange ${exchange}: nothing to fetch`);
    console.log(JSON.stringify({ status: "ok", exchange, skipped: true }, null, 2));
    return;
  }

  log(
    `Exchange ${exchange}: ${symbols.length} symbols, ${exchangePending.length} series pending (${ctx.skippedExisting} already on disk)`,
  );
  log(`Window: ${new Date(ctx.startMs).toISOString()} → ${new Date(ctx.endMs).toISOString()}`);
  if (exchange === "bybit") {
    configureBybitArchiveMode(ctx.cfg, log);
  }
  log(`Spawning ${processes} worker process(es)`);

  // When run-all drives us it has already written the full instrument index in
  // the parent process; rewriting it here would race the other exchanges'
  // processes (concurrent read-modify-write would clobber each other's rows).
  if (!opts.skipDiscovery) {
    const indexPath = join(ctx.baseDir, "reports", "instrument_index.json");
    const onDiskForExchange = loadInstrumentIndexFile(indexPath).filter(
      (i) => i.exchange === exchange,
    ).length;
    if (onDiskForExchange < symbols.length) {
      const written = writeInstrumentIndex(ctx.baseDir, ctx.instrumentIndex, { merge: true });
      log(
        `Synced instrument_index.json for ${exchange} (${onDiskForExchange} → ${symbols.length} on disk) → ${written}`,
      );
    }
  }

  log(`Starting ${processes} worker process(es)...`);

  const sharedArgs = [
    "--exchange",
    exchange,
    "--shards",
    String(processes),
    "--universe",
    opts.universe,
    "--output",
    opts.output,
    "--days",
    opts.days,
    "--series-workers",
    opts.seriesWorkers,
    "--file-workers",
    opts.fileWorkers,
    "--max-downloads",
    opts.maxDownloads,
    ...opts.quoteCurrencies.flatMap((q) => ["--quote-currencies", q]),
  ];
  if (opts.start) sharedArgs.push("--start", opts.start);
  else sharedArgs.push("--start", new Date(ctx.startMs).toISOString());
  if (opts.end) sharedArgs.push("--end", opts.end);
  else sharedArgs.push("--end", new Date(ctx.endMs).toISOString());
  if (opts.config) sharedArgs.push("--config", opts.config);
  sharedArgs.push("--skip-discovery");
  if (opts.noFallback) sharedArgs.push("--no-fallback");
  sharedArgs.push(...symbolCliArgs(symbolFilter));

  const results = await Promise.all(
    Array.from({ length: processes }, (_, shard) =>
      runWorker([...sharedArgs, "--shard", String(shard)]),
    ),
  );

  const failed = results.filter((r) => r.code !== 0);
  if (failed.length > 0) {
    throw new Error(`${failed.length}/${processes} worker process(es) exited with error`);
  }

  mergeShardArchiveGaps(ctx.baseDir, processes);
  mergeShardArchiveIncomplete(ctx.baseDir, exchange, processes);

  const manifestPath = writeArchiveManifest(ctx.baseDir, {
    generated_at_utc: new Date().toISOString(),
    mode: "multi_process",
    exchange,
    processes,
    window: { start_ms: ctx.startMs, end_ms: ctx.endMs },
    symbol_count: symbols.length,
    series_count: exchangePending.length,
    stats: { workers_completed: processes },
  });

  console.log(
    JSON.stringify(
      { status: "ok", exchange, processes, manifest: manifestPath },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
