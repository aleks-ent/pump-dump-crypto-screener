#!/usr/bin/env node
import { Command } from "commander";
import { seriesKey } from "@screener/storage";
import { prepareArchiveRun } from "./run-context.js";

function log(msg: string): void {
  console.log(msg);
}

/**
 * Commander seeds the accumulator with the option default, so a naive
 * `(v, prev) => [...prev, v]` reducer *appends* user values to the defaults
 * (e.g. `--exchanges binance` yields `[binance, bybit, binance]`). This
 * reducer instead replaces the defaults the first time the user supplies a
 * value, so `--exchanges binance` means only Binance.
 */
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

interface ExchangeCoverage {
  exchange: string;
  totalCoins: number;
  cachedCoins: number;
  pct: number;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .description(
      "Report local cache completeness per exchange: for all coins present on an exchange, what percentage have complete 1m/5m data on disk for the window.",
    )
    .option(
      "--universe <path>",
      "Symbol universe JSON",
      "data/market_stats/reports/symbol_universe.json",
    )
    .option("--start <iso>", "ISO UTC start")
    .option("--end <iso>", "ISO UTC end")
    .option(
      "--days <n>",
      "Calendar lookback days when start/end omitted (same window as fetch:all)",
      "5",
    )
    .option("--exchanges <items...>", "Exchanges", replacingDefault(), ["binance", "bybit"])
    .option("--quote-currencies <items...>", "Quote currencies", replacingDefault(), ["USDT"])
    .option("--output <dir>", "Data directory", "data/market_stats")
    .option("--config <path>", "YAML config")
    .option("--discover", "Force fresh instrument discovery instead of reusing instrument_index.json")
    .option("--json", "Emit machine-readable JSON only");

  const argv = process.argv.slice(2).filter((a) => a !== "--");
  program.parse(argv, { from: "user" });
  const opts = program.opts<{
    universe: string;
    start?: string;
    end?: string;
    days: string;
    exchanges: string[];
    quoteCurrencies: string[];
    output: string;
    config?: string;
    discover?: boolean;
    json?: boolean;
  }>();

  const selectedExchanges = [...new Set(opts.exchanges)];

  const ctx = await prepareArchiveRun({
    universe: opts.universe,
    start: opts.start,
    end: opts.end,
    exchanges: selectedExchanges,
    quoteCurrencies: opts.quoteCurrencies,
    output: opts.output,
    config: opts.config,
    defaultDays: Number(opts.days),
    skipDiscovery: !opts.discover,
    skipExisting: true,
  });

  const pendingKeys = new Set(
    ctx.pending.map((t) => seriesKey(t.instrument, t.interval)),
  );

  // exchange -> coin (instrumentType|symbolNative) -> all-series-satisfied
  const byExchange = new Map<string, Map<string, boolean>>();
  for (const task of ctx.tasks) {
    const { exchange, instrumentType, symbolNative } = task.instrument;
    const coin = `${instrumentType}|${symbolNative}`;
    if (!byExchange.has(exchange)) byExchange.set(exchange, new Map());
    const coins = byExchange.get(exchange)!;
    const satisfied = !pendingKeys.has(seriesKey(task.instrument, task.interval));
    coins.set(coin, (coins.get(coin) ?? true) && satisfied);
  }

  const coverage: ExchangeCoverage[] = selectedExchanges
    .filter((ex) => byExchange.has(ex))
    .map((exchange) => {
      const coins = byExchange.get(exchange)!;
      const totalCoins = coins.size;
      let cachedCoins = 0;
      for (const allSatisfied of coins.values()) if (allSatisfied) cachedCoins += 1;
      return { exchange, totalCoins, cachedCoins, pct: pct(cachedCoins, totalCoins) };
    });

  const windowStart = new Date(ctx.startMs).toISOString();
  const windowEnd = new Date(ctx.endMs).toISOString();
  const days = Math.round((ctx.endMs - ctx.startMs) / 86_400_000);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          window: { start: windowStart, end: windowEnd, days },
          intervals: ctx.intervals,
          coin_rule: "all intervals complete on disk",
          exchanges: coverage,
        },
        null,
        2,
      ),
    );
    return;
  }

  const label = (ex: string) => ex.charAt(0).toUpperCase() + ex.slice(1);
  log(
    `Window: ${windowStart.slice(0, 10)} → ${windowEnd.slice(0, 10)} (${days} days), intervals ${ctx.intervals.join(",")}`,
  );
  log(
    `For all coins present on exchange: ${coverage
      .map((c) => `${label(c.exchange)} ${c.pct.toFixed(1)}% cached (${c.cachedCoins}/${c.totalCoins})`)
      .join(", ")}`,
  );
  log("");
  for (const c of coverage) {
    log(
      `  ${label(c.exchange).padEnd(8)} ${c.pct.toFixed(1).padStart(5)}%  ${c.cachedCoins}/${c.totalCoins} coins`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
