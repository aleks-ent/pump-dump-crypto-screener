#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import pLimit from "p-limit";
import {
  HttpClient,
  TokenBucketLimiter,
  loadFetchIntervals,
  loadYaml,
  resolveRepoPath,
  resolveWindow,
  type Instrument,
} from "@screener/core";
import { getAdapters, type ExchangeAdapter } from "@screener/exchanges";
import {
  SeriesQuality,
  loadCheckpoint,
  saveCheckpoint,
  seriesKey,
  writeManifest,
  writeNormalizedRecords,
  writeQualityReport,
  writeRawRecords,
  writeSymbolUniverse,
} from "@screener/storage";
import {
  SPOT_OR_FUTURES_TYPES,
  applyUniverseFilters,
  buildSymbolUniverse,
} from "@screener/universe";

async function discoverInstruments(
  adapters: Record<string, ExchangeAdapter>,
  client: HttpClient,
  selectedExchanges: Set<string>,
  selectedTypes: Set<string> | null,
): Promise<Instrument[]> {
  const all: Instrument[] = [];
  for (const [name, adapter] of Object.entries(adapters)) {
    if (!selectedExchanges.has(name)) continue;
    const instruments = await adapter.discoverInstruments(client, selectedTypes);
    all.push(...instruments);
  }
  return all;
}

async function runSeries(
  adapter: ExchangeAdapter,
  client: HttpClient,
  inst: Instrument,
  interval: string,
  startMs: number,
  endMs: number,
  baseDir: string,
  checkpoint: Record<string, unknown>,
  checkpointEnabled: boolean,
): Promise<{ report: Record<string, unknown>; rawRows: number; normRows: number }> {
  const key = seriesKey(inst, interval);
  let cursor = checkpoint[key] as Record<string, unknown> | null | undefined;
  if (cursor == null) cursor = adapter.initialCursor(startMs, endMs);

  const quality = new SeriesQuality(
    inst.exchange,
    inst.instrumentType,
    inst.symbolNative,
    interval,
  );
  let rawRows = 0;
  let normRows = 0;

  while (cursor) {
    const page = await adapter.fetchCandlesPage(client, inst, interval, cursor);
    if (page.records.length > 0) {
      rawRows += writeRawRecords(baseDir, page.records, page.requestMeta);
      normRows += writeNormalizedRecords(baseDir, page.records);
      quality.observe(page.records, startMs, endMs);
    }
    cursor = page.nextCursor;
    if (checkpointEnabled) checkpoint[key] = cursor;
  }
  if (key in checkpoint && checkpoint[key] == null) delete checkpoint[key];

  return { report: quality.toReport(), rawRows, normRows };
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .description("Fetch 1m/5m market stats from Binance, ByBit")
    .option("--start <iso>", "ISO UTC start")
    .option("--end <iso>", "ISO UTC end")
    .option("--exchanges <items...>", "Exchanges", (v, prev: string[]) => [...prev, v], [
      "binance",
      "bybit",
    ])
    .option("--instrument-types <items...>", "Instrument types")
    .option("--quote-currencies <items...>", "Quote currencies", (v, prev: string[]) => [...prev, v], [
      "USDT",
    ])
    .option("--resume", "Resume from checkpoint")
    .option("--output <dir>", "Output directory", "data/market_stats")
    .option("--workers <n>", "Parallel workers", "1")
    .option("--config <path>", "YAML config");

  const argv = process.argv.slice(2).filter((a) => a !== "--");
  program.parse(argv, { from: "user" });
  const opts = program.opts<{
    start?: string;
    end?: string;
    exchanges: string[];
    instrumentTypes?: string[];
    quoteCurrencies: string[];
    resume?: boolean;
    output: string;
    workers: string;
    config?: string;
  }>();

  const intervals = await loadFetchIntervals();
  const configPath = opts.config ? resolveRepoPath(opts.config) : resolveRepoPath("config/pull.yaml");
  const cfg = loadYaml(configPath);
  const [startMs, endMs] = resolveWindow(opts.start, opts.end, cfg);
  const baseDir = resolveRepoPath(opts.output);
  mkdirSync(baseDir, { recursive: true });

  const limiter = new TokenBucketLimiter(Number(cfg.default_rps ?? 8));
  const client = new HttpClient({
    timeoutS: Number(cfg.timeout_s ?? 20),
    limiter,
  });

  const adapters = getAdapters();
  const selectedExchanges = new Set(opts.exchanges);
  const selectedTypes = opts.instrumentTypes
    ? new Set(opts.instrumentTypes)
    : new Set(SPOT_OR_FUTURES_TYPES);

  const instruments = await discoverInstruments(
    adapters,
    client,
    selectedExchanges,
    selectedTypes,
  );
  const quoteCurrencies = new Set(opts.quoteCurrencies.map((q) => q.toUpperCase()));
  const filtered = applyUniverseFilters(instruments, quoteCurrencies);
  const symbolUniverse = buildSymbolUniverse(filtered);
  const symbolUniversePath = writeSymbolUniverse(baseDir, symbolUniverse);

  const workers = Number(opts.workers);
  if (opts.resume && workers > 1) {
    throw new Error("Use --workers 1 when --resume is enabled to avoid checkpoint races.");
  }

  const checkpoint = opts.resume ? loadCheckpoint(baseDir) : {};
  const tasks: { adapter: ExchangeAdapter; inst: Instrument; interval: string }[] = [];
  for (const inst of filtered) {
    const adapter = adapters[inst.exchange];
    if (!adapter) continue;
    for (const interval of intervals) {
      if (!adapter.intervals.has(interval)) continue;
      tasks.push({ adapter, inst, interval });
    }
  }

  const reports: Record<string, unknown>[] = [];
  let totalRaw = 0;
  let totalNorm = 0;

  if (workers <= 1) {
    for (const { adapter, inst, interval } of tasks) {
      const { report, rawRows, normRows } = await runSeries(
        adapter,
        client,
        inst,
        interval,
        startMs,
        endMs,
        baseDir,
        checkpoint,
        Boolean(opts.resume),
      );
      reports.push(report);
      totalRaw += rawRows;
      totalNorm += normRows;
      if (opts.resume) saveCheckpoint(baseDir, checkpoint);
    }
  } else {
    const limit = pLimit(workers);
    const results = await Promise.all(
      tasks.map((t) =>
        limit(() =>
          runSeries(t.adapter, client, t.inst, t.interval, startMs, endMs, baseDir, {}, false),
        ),
      ),
    );
    for (const r of results) {
      reports.push(r.report);
      totalRaw += r.rawRows;
      totalNorm += r.normRows;
    }
  }

  const qualityPath = writeQualityReport(baseDir, reports);
  const manifestPath = writeManifest(baseDir, {
    generated_at_utc: new Date().toISOString(),
    window: { start_ms: startMs, end_ms: endMs },
    exchanges: [...selectedExchanges].sort(),
    intervals,
    instrument_count: filtered.length,
    series_count: tasks.length,
    total_raw_rows: totalRaw,
    total_normalized_rows: totalNorm,
    paths: {
      raw_root: join(baseDir, "raw"),
      normalized_root: join(baseDir, "normalized"),
      symbol_universe: symbolUniversePath,
      quality_report: qualityPath,
    },
  });

  console.log(JSON.stringify({ status: "ok", manifest: manifestPath }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
