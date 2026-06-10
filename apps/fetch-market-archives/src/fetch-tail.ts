#!/usr/bin/env node
import { Command } from "commander";
import pLimit from "p-limit";
import { refreshSeriesTail, type TailRefreshStatus } from "@screener/archive";
import { migrateLegacySharedNdjson } from "@screener/storage";
import { makeHttpClient, prepareArchiveRun } from "./run-context.js";

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
      "Refresh today's REST kline tail for every universe series (monitor step — one process, no archive downloads)",
    )
    .argument("<days>", "Lookback window in days (sets end=now and archive calendar span)")
    .option("--days <n>", "Same as the positional days argument")
    .option("--universe <path>", "Symbol universe JSON")
    .option("--output <dir>", "Output directory (default: data/market_stats)")
    .option("--config <path>", "YAML config (default: config/archives.yaml)")
    .option("--workers <n>", "Parallel tail fetches per exchange (default: 12)")
    .option(
      "--exchange <name>",
      "Only refresh this exchange (repeatable)",
      (v, prev: string[]) => [...prev, v],
      [],
    );

  program.parse(process.argv.slice(2).filter((a) => a !== "--"), { from: "user" });
  const opts = program.opts<{
    days?: string;
    universe?: string;
    output?: string;
    config?: string;
    workers?: string;
    exchange?: string[];
  }>();

  const days = parseDaysArg(program.args[0] ?? opts.days);
  const universe = opts.universe ?? "data/market_stats/reports/symbol_universe.json";
  const output = opts.output ?? "data/market_stats";
  const workers = Math.max(1, Number(opts.workers ?? 12));
  const exchanges =
    opts.exchange?.length && opts.exchange.length > 0
      ? opts.exchange
      : (["binance", "bybit"] as const);

  const ctx = await prepareArchiveRun({
    universe,
    end: new Date().toISOString(),
    exchanges: [...exchanges],
    quoteCurrencies: ["USDT"],
    output,
    config: opts.config,
    defaultDays: days,
    skipDiscovery: false,
    skipExisting: false,
  });

  const migrated = await migrateLegacySharedNdjson(ctx.fallbackDir);
  if (migrated.filesSplit > 0) {
    console.error(
      `[fetch:tail] migrated ${migrated.filesSplit} legacy shared day file(s) → per-symbol layout` +
        ` (${migrated.rowsWritten} rows)`,
    );
  }

  // Single process per exchange — raise REST caps vs sharded fetch:all (1 rps × N processes).
  const tailCfg = {
    ...ctx.cfg,
    host_rps: {
      ...(typeof ctx.cfg.host_rps === "object" ? (ctx.cfg.host_rps as Record<string, number>) : {}),
      "api.binance.com": 10,
      "fapi.binance.com": 10,
      "dapi.binance.com": 10,
      "api.bybit.com": 10,
    },
  };

  const endIso = new Date(ctx.endMs).toISOString();
  console.error(
    `[fetch:tail] ${ctx.tasks.length} series | window ends ${endIso} | ${workers} worker(s)/exchange | exchanges: ${exchanges.join(", ")}`,
  );

  const stats: Record<TailRefreshStatus, number> = {
    fresh: 0,
    refreshed: 0,
    stale: 0,
    skipped: 0,
  };

  const log = (msg: string): void => {
    // stderr — same stream as pump-monitor steps; avoids lost/interleaved stdout
    console.error(`[fetch:tail] ${msg}`);
  };

  async function refreshExchange(exchange: string): Promise<void> {
    const tasks = ctx.tasks.filter((t) => t.instrument.exchange === exchange);
    if (tasks.length === 0) {
      log(`${exchange}: no series in universe — skipped`);
      return;
    }

    log(`=== ${exchange} (${tasks.length} series) ===`);
    const adapter = ctx.adapters[exchange];
    if (!adapter) {
      throw new Error(`No adapter for exchange ${exchange}`);
    }

    const client = makeHttpClient(tailCfg, {
      cooldownDir: ctx.cooldownDir,
      log: (msg) => log(`${exchange} ${msg}`),
    });

    let done = 0;
    const exchangeStats: Record<TailRefreshStatus, number> = {
      fresh: 0,
      refreshed: 0,
      stale: 0,
      skipped: 0,
    };
    const limit = pLimit(workers);
    await Promise.all(
      tasks.map((task) =>
        limit(async () => {
          const result = await refreshSeriesTail(
            task.instrument,
            task.interval,
            ctx.endMs,
            {
              fallbackDir: ctx.fallbackDir,
              adapter,
              client,
              allowFallback: ctx.allowFallback,
              onFallbackFailed: ({ instrument, interval, reason }) => {
                log(`${exchange} tail failed ${instrument.symbolNative} ${interval}: ${reason}`);
              },
            },
          );
          stats[result.status] += 1;
          exchangeStats[result.status] += 1;
          done += 1;
          if (done === 1 || done === tasks.length || done % 100 === 0) {
            log(`${exchange} tail ${done}/${tasks.length} (last: ${result.status})`);
          }
        }),
      ),
    );
    log(
      `${exchange} done — fresh ${exchangeStats.fresh}, refreshed ${exchangeStats.refreshed}, stale ${exchangeStats.stale}`,
    );
  }

  // Binance + Bybit hit different API hosts — safe to run concurrently in one process.
  await Promise.all(exchanges.map((exchange) => refreshExchange(exchange)));

  log(
    JSON.stringify(
      {
        status: stats.stale === 0 ? "ok" : "partial",
        end: endIso,
        series: ctx.tasks.length,
        fresh: stats.fresh,
        refreshed: stats.refreshed,
        stale: stats.stale,
        skipped: stats.skipped,
      },
      null,
      2,
    ),
  );

  if (stats.stale > 0) {
    process.exitCode = 1;
  }

  // Repopulate coverage_index.json now that tails are fresh — speeds up the fetch:all pass next.
  const indexed = await prepareArchiveRun({
    universe,
    end: endIso,
    exchanges: [...exchanges],
    quoteCurrencies: ["USDT"],
    output,
    config: opts.config,
    defaultDays: days,
    skipDiscovery: true,
    skipExisting: true,
    updateCoverageIndex: true,
    logCoverageProgress: false,
    coverageProgressLabel: "after tail refresh",
  });
  console.error(
    `[fetch:tail] coverage index: ${indexed.skippedExisting}/${indexed.tasks.length} satisfied` +
      ` (${indexed.coverageIndexHits} index hits, ${indexed.coverageDiskChecks} disk checks)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
