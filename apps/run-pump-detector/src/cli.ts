#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command } from "commander";
import pLimit from "p-limit";
import {
  defaultWorkerConcurrency,
  loadPumpMinScore,
  loadPumpScanCacheEnabled,
  resolveArchiveWindow,
  resolveRepoPath,
  resolveWindow,
} from "@screener/core";
import {
  buildInstrumentGroups,
  coinScanCachePath,
  computeCoinDataFingerprint,
  filterInstrumentGroupsBySymbols,
  groupEventsIntoEpisodes,
  loadCoinScanCache,
  PUMP_DETECTOR_VERSION,
  shouldSkipScan,
  summarizeEpisodes,
  type PumpCandidate,
  type ScanParams,
} from "@screener/pump-detector";
import {
  createFileLogger,
  type CoinWorkerResult,
} from "./logger.js";
import { printEpisodeSummary } from "./print-summary.js";
import { buildWorkerScanJob, ScanWorkerPool } from "./scan-worker-pool.js";

export const PUMP_SCAN_COMPLETE_PREFIX = "PUMP_SCAN_COMPLETE:";

export interface PumpScanCompletePayload {
  coins_scanned: number;
  coin_outputs: number;
  cache_hits: number;
  computed: number;
  incremental: number;
  failures: number;
  total_candidates: number;
  total_episodes: number;
  run_dir: string;
  output: string;
}

let activeDataDir: string | null = null;

function writeScanFailure(dataDir: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const path = join(dataDir, "reports", "last_pump_scan_failed.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ failed_at_utc: new Date().toISOString(), error: message }, null, 2)}\n`,
    "utf-8",
  );
}

function parseExchanges(raw: string | undefined): Set<string> | undefined {
  if (!raw) return undefined;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function parseDays(raw: string): number {
  const days = Number(raw);
  if (!Number.isFinite(days) || days < 1) {
    throw new Error("--days must be a positive number");
  }
  return days;
}

function coinSlug(coinKey: string): string {
  return coinKey.replace(/\|/g, "_").replace(/[^\w.-]+/g, "_");
}

/** TTY: in-place `\r` updates. Logs/pipes: one completion line from `finish()`. */
function createScanProgress(total: number): {
  start: () => void;
  increment: () => void;
  finish: () => void;
} {
  let completed = 0;
  const tty = Boolean(process.stderr.isTTY);

  const format = (): string => {
    const pct = total > 0 ? Math.round((completed / total) * 100) : 100;
    return `Scanning coins: ${completed}/${total} (${pct}%)`;
  };

  return {
    start: () => {},
    increment: () => {
      completed += 1;
      if (tty) process.stderr.write(`\r${format()}`);
    },
    finish: () => {
      process.stderr.write(`${format()}\n`);
    },
  };
}

async function main(): Promise<void> {
  const minScoreDefault = await loadPumpMinScore();
  const scanCacheFromConfig = await loadPumpScanCacheEnabled();
  const program = new Command();
  program
    .name("run-pump-detector")
    .description("Per-coin pump/dump scan with parallel worker threads")
    .requiredOption("--days <n>", "Lookback calendar days (matches fetch:all window)")
    .option("--data-dir <path>", "Market stats base directory", "data/market_stats")
    .option("--universe <path>", "symbol_universe.json path")
    .option("--instrument-index <path>", "instrument_index.json path")
    .option("--start <iso>", "Window start (ISO UTC); overrides calendar --days")
    .option("--end <iso>", "Window end (ISO UTC)")
    .option("--output <path>", "Aggregated output NDJSON path")
    .option("--min-score <n>", "Minimum score to emit", String(minScoreDefault))
    .option("--liquidity-threshold <n>", "Median 24h quote volume floor", "100000")
    .option("--exchanges <list>", "Comma-separated exchanges filter")
    .option("--market-category <cat>", "spot or futures")
    .option("--max-groups <n>", "Limit coins scanned (debug)", "0")
    .option(
      "--symbol <name>",
      "Scan only this coin (native or canonical, e.g. BTCUSDT or BTC/USDT); repeatable",
      (v, prev: string[]) => [...prev, v],
      [],
    )
    .option("--summary-limit <n>", "Max episodes to print in console summary (0 = all)", "50")
    .option("--cache-dir <path>", "Per-coin scan result cache directory");

  program.parse(process.argv.slice(2).filter((a) => a !== "--"), { from: "user" });
  const opts = program.opts<{
    days: string;
    dataDir: string;
    universe?: string;
    instrumentIndex?: string;
    start?: string;
    end?: string;
    output?: string;
    minScore: string;
    liquidityThreshold: string;
    exchanges?: string;
    marketCategory?: string;
    maxGroups: string;
    symbol?: string[];
    summaryLimit: string;
    cacheDir?: string;
  }>();

  const days = parseDays(opts.days);
  const concurrency = defaultWorkerConcurrency();
  const dataDir = resolveRepoPath(opts.dataDir);
  activeDataDir = dataDir;
  mkdirSync(join(dataDir, "reports"), { recursive: true });
  const failedScanPath = join(dataDir, "reports", "last_pump_scan_failed.json");
  if (existsSync(failedScanPath)) {
    writeFileSync(failedScanPath, "", "utf-8");
  }
  const universePath = resolveRepoPath(
    opts.universe ?? join(dataDir, "reports", "symbol_universe.json"),
  );
  const indexPath = resolveRepoPath(
    opts.instrumentIndex ?? join(dataDir, "reports", "instrument_index.json"),
  );

  const [startMs, endMs] =
    opts.start != null || opts.end != null
      ? resolveWindow(opts.start, opts.end, {}, days)
      : resolveArchiveWindow(undefined, undefined, {}, days);

  const cacheDir = resolveRepoPath(
    opts.cacheDir ?? join(dataDir, "reports", "scan_cache"),
  );
  const useCache = scanCacheFromConfig;
  mkdirSync(cacheDir, { recursive: true });

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(dataDir, "reports", "pump_detector", runId);
  const coinsDir = join(runDir, "coins");
  mkdirSync(coinsDir, { recursive: true });

  const log = createFileLogger(join(runDir, "orchestrator.log"));

  log("=== pump detector orchestrator start ===");
  log(`Run ID: ${runId}`);
  log(`Days: ${days}, worker threads: ${concurrency} (auto-detected CPU cores)`);
  log(`Window: ${new Date(startMs).toISOString()} .. ${new Date(endMs).toISOString()}`);
  log(`Scan cache: ${useCache ? cacheDir : "disabled"}`);

  console.error(`Worker threads: ${concurrency} (auto-detected CPU cores)`);

  const incompleteReport = join(dataDir, "reports", "archive_incomplete_report.json");
  if (existsSync(incompleteReport)) {
    try {
      const report = JSON.parse(readFileSync(incompleteReport, "utf-8")) as {
        incomplete_coins?: number;
        incomplete_series?: number;
      };
      log(
        `NOTE: archive_incomplete_report.json exists (${report.incomplete_coins ?? "?"} incomplete coins, ${report.incomplete_series ?? "?"} series)`,
      );
    } catch {
      log("NOTE: archive_incomplete_report.json exists but could not be parsed");
    }
  }

  const marketCategory =
    opts.marketCategory === "spot" || opts.marketCategory === "futures"
      ? opts.marketCategory
      : null;

  let groups = buildInstrumentGroups({
    universePath,
    instrumentIndexPath: indexPath,
    exchanges: parseExchanges(opts.exchanges),
    marketCategory,
  });

  const symbols = opts.symbol ?? [];
  if (symbols.length > 0) {
    groups = filterInstrumentGroupsBySymbols(groups, symbols);
    if (groups.length === 0) {
      throw new Error(`No coins matched --symbol: ${symbols.join(", ")}`);
    }
    log(`Symbol filter: ${symbols.join(", ")} → ${groups.length} coin(s)`);
  }

  const maxGroups = Number(opts.maxGroups);
  if (maxGroups > 0) groups = groups.slice(0, maxGroups);

  log(`Coins to scan: ${groups.length}`);
  for (const g of groups) {
    log(
      `  ${g.key} (${g.entry.symbolCanonical}) exchanges=[${[...g.instrumentsByExchange.keys()].join(", ")}]`,
    );
  }

  const dataRoots = [dataDir, join(dataDir, "api_fallback"), join(dataDir, "extracted")];
  const archivesDir = join(dataDir, "archives");
  const scanParams: ScanParams = {
    minScore: Number(opts.minScore),
    liquidityThreshold: Number(opts.liquidityThreshold),
    exchanges: opts.exchanges
      ? opts.exchanges
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
          .sort()
      : null,
  };

  const limit = pLimit(concurrency);
  const scanPool = new ScanWorkerPool(concurrency);
  await scanPool.probe();
  console.error("Worker thread pool: OK");
  log("Worker thread pool probe: OK");

  const workerResults: CoinWorkerResult[] = [];
  const failures: Array<{ coinKey: string; code: number | null; error?: string }> = [];
  const progress = createScanProgress(groups.length);
  let cacheHits = 0;
  let computedCount = 0;
  let incrementalCount = 0;

  progress.start();

  try {
  await Promise.all(
    groups.map((group, idx) =>
      limit(async () => {
        const slug = coinSlug(group.key);
        const coinLogPath = join(coinsDir, `${slug}.log`);
        const coinOutputPath = join(coinsDir, `${slug}.ndjson`);

        try {
          if (useCache) {
            const dataFingerprint = computeCoinDataFingerprint(
              group,
              "5m",
              dataRoots,
              startMs,
              endMs,
              archivesDir,
            );
            const cached = loadCoinScanCache(coinScanCachePath(cacheDir, group.key));
            if (
              shouldSkipScan(cached, {
                detectorVersion: PUMP_DETECTOR_VERSION,
                windowStartMs: startMs,
                scanParams,
                dataFingerprint,
              })
            ) {
              writeFileSync(
                coinOutputPath,
                cached!.candidates.map((c) => JSON.stringify(c)).join("\n") +
                  (cached!.candidates.length > 0 ? "\n" : ""),
                "utf-8",
              );
              const result: CoinWorkerResult = {
                coinKey: group.key,
                status: "cached",
                leaderExchange: cached!.leaderExchange,
                exchanges: [...group.instrumentsByExchange.keys()],
                candidateCount: cached!.candidates.length,
                coverages: cached!.coverages,
              };
              workerResults.push(result);
              cacheHits += 1;
              log(
                `[${idx + 1}/${groups.length}] cache hit ${group.key} leader=${result.leaderExchange} candidates=${result.candidateCount}`,
              );
              return;
            }
          }

          log(`[${idx + 1}/${groups.length}] starting scan for ${group.key}`);

          let result: CoinWorkerResult;
          try {
            result = await scanPool.runScan(
              buildWorkerScanJob({
                coinKey: group.key,
                startMs,
                endMs,
                windowStartMs: startMs,
                dataDir,
                universePath,
                indexPath,
                minScore: Number(opts.minScore),
                liquidityThreshold: Number(opts.liquidityThreshold),
                exchanges: parseExchanges(opts.exchanges),
                scanParams,
                cacheDir: useCache ? cacheDir : undefined,
                outputPath: coinOutputPath,
                logPath: coinLogPath,
              }),
            );
          } catch (err) {
            result = {
              coinKey: group.key,
              status: "error",
              leaderExchange: null,
              exchanges: [...group.instrumentsByExchange.keys()],
              candidateCount: 0,
              coverages: [],
              error: err instanceof Error ? err.message : String(err),
            };
          }

          workerResults.push(result);
          if (result.status === "incremental") {
            incrementalCount += 1;
          }
          if (result.status !== "cached") {
            computedCount += 1;
          }
          log(
            `[${idx + 1}/${groups.length}] done ${group.key} status=${result.status} leader=${result.leaderExchange} candidates=${result.candidateCount}`,
          );

          if (result.status === "error" || result.error) {
            failures.push({
              coinKey: group.key,
              code: 1,
              error: result.error ?? "worker error",
            });
            log(`[${idx + 1}/${groups.length}] FAILED ${group.key}: ${result.error ?? "worker error"}`);
          }
        } finally {
          progress.increment();
        }
      }),
    ),
  );
  } finally {
    await scanPool.close();
  }

  progress.finish();

  const coinOutputCount = groups.filter((group) =>
    existsSync(join(coinsDir, `${coinSlug(group.key)}.ndjson`)),
  ).length;

  if (workerResults.length !== groups.length) {
    throw new Error(
      `Scan incomplete: ${workerResults.length}/${groups.length} coin result(s) recorded`,
    );
  }
  if (coinOutputCount !== groups.length) {
    throw new Error(
      `Scan incomplete: ${coinOutputCount}/${groups.length} per-coin output file(s) on disk`,
    );
  }

  const outputPath = resolveRepoPath(
    opts.output ?? join(dataDir, "reports", "pump_events.ndjson"),
  );
  mkdirSync(dirname(outputPath), { recursive: true });
  const tempOutputPath = `${outputPath}.tmp.${process.pid}`;
  writeFileSync(tempOutputPath, "", "utf-8");

  let totalCandidates = 0;
  const allEvents: PumpCandidate[] = [];
  for (const group of groups) {
    const slug = coinSlug(group.key);
    const coinOutputPath = join(coinsDir, `${slug}.ndjson`);
    if (!existsSync(coinOutputPath)) continue;
    const content = readFileSync(coinOutputPath, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      appendFileSync(tempOutputPath, `${line}\n`, "utf-8");
      allEvents.push(JSON.parse(line) as PumpCandidate);
      totalCandidates += 1;
    }
  }

  const episodes = groupEventsIntoEpisodes(allEvents);
  const episodeStats = summarizeEpisodes(episodes, totalCandidates);
  const summaryLimit = Number(opts.summaryLimit);

  renameSync(tempOutputPath, outputPath);

  printEpisodeSummary(episodes, episodeStats, {
    limit: Number.isFinite(summaryLimit) ? summaryLimit : 50,
    rawOutputPath: outputPath,
    write: (line) => process.stderr.write(`${line}\n`),
  });

  const episodesPath = join(runDir, "pump_episodes.ndjson");
  writeFileSync(
    episodesPath,
    episodes.map((ep) => JSON.stringify({
      ...ep,
      start: new Date(ep.startMs).toISOString(),
      end: new Date(ep.endMs).toISOString(),
    })).join("\n") + (episodes.length > 0 ? "\n" : ""),
    "utf-8",
  );

  const manifest = {
    run_id: runId,
    generated_at_utc: new Date().toISOString(),
    window: { start_ms: startMs, end_ms: endMs, days },
    concurrency,
    coins_scanned: groups.length,
    coin_outputs: coinOutputCount,
    worker_results: workerResults.length,
    cache: {
      enabled: useCache,
      dir: useCache ? cacheDir : null,
      hits: cacheHits,
      computed: computedCount,
      incremental: incrementalCount,
    },
    total_candidates: totalCandidates,
    total_episodes: episodes.length,
    episode_stats: episodeStats,
    episodes_output: episodesPath,
    workers: workerResults,
    failures,
    output: outputPath,
    run_dir: runDir,
  };

  const manifestPath = join(runDir, "run_manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");

  const lastScanPath = join(dataDir, "reports", "last_pump_scan.json");
  writeFileSync(lastScanPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  if (existsSync(failedScanPath)) {
    writeFileSync(failedScanPath, "", "utf-8");
  }

  const completePayload: PumpScanCompletePayload = {
    coins_scanned: groups.length,
    coin_outputs: coinOutputCount,
    cache_hits: cacheHits,
    computed: computedCount,
    incremental: incrementalCount,
    failures: failures.length,
    total_candidates: totalCandidates,
    total_episodes: episodes.length,
    run_dir: runDir,
    output: outputPath,
  };

  log(
    `=== orchestrator done: ${totalCandidates} candidates, ${episodes.length} episodes, ${cacheHits} cache hit(s), ${computedCount} computed (${incrementalCount} incremental), ${failures.length} failure(s) ===`,
  );
  log(`Wrote ${outputPath}`);
  log(`Episodes: ${episodesPath}`);
  log(`Manifest: ${manifestPath}`);

  console.error(
    `Scanned ${groups.length} coins → ${episodes.length} episodes (${totalCandidates} raw events, ${cacheHits} cached, ${computedCount} computed, ${incrementalCount} incremental)`,
  );
  console.error(`Output: ${outputPath}`);
  console.error(`Episodes: ${episodesPath}`);
  console.error(`Run dir: ${runDir}`);
  console.error(`${PUMP_SCAN_COMPLETE_PREFIX}${JSON.stringify(completePayload)}`);

  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  if (activeDataDir) {
    writeScanFailure(activeDataDir, err);
  }
  console.error(err);
  process.exit(1);
});
