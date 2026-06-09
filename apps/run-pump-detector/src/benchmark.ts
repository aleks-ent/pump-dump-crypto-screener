#!/usr/bin/env node
/**
 * Profile pump scan CPU breakdown for one coin and orchestrator-scale costs.
 *
 * Usage:
 *   pnpm scan:pumps:benchmark -- --days 5
 *   pnpm scan:pumps:benchmark -- --days 5 --coin-key "linear_perp|BTC|USDT"
 *   pnpm scan:pumps:benchmark -- --days 5 --sample-coins 100
 */
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Command } from "commander";
import { isSeriesSatisfiedOnDisk } from "@screener/archive";
import { resolveArchiveWindow, resolveRepoPath } from "@screener/core";
import {
  buildInstrumentGroups,
  classifyPhase,
  computeCoinDataFingerprint,
  computeExchangeCoverage,
  computeScore,
  computeSeries,
  evaluateFeatures,
  listConfirmedExchangeNames,
  coinScanCachePath,
  loadCoinScanCache,
  loadSeries,
  pickLeadingExchange,
  scanCoin,
  shouldSkipScan,
  shouldTailRescan,
  TAIL_WARMUP_BARS,
  type InstrumentGroup,
  type PumpPhase,
  type ScanParams,
} from "@screener/pump-detector";

const REPORTABLE_PHASES = new Set<PumpPhase>([
  "activation",
  "active_pump",
  "late_pump",
  "distribution_or_fade",
  "spike",
]);

interface TimedRow {
  label: string;
  ms: number;
  detail?: string;
}

function ms(start: number): number {
  return performance.now() - start;
}

function printSection(title: string, rows: TimedRow[]): void {
  console.error(`\n${title}`);
  console.error("-".repeat(title.length));
  const total = rows.reduce((s, r) => s + r.ms, 0);
  for (const row of rows) {
    const pct = total > 0 ? ((row.ms / total) * 100).toFixed(1) : "0.0";
    const detail = row.detail ? `  (${row.detail})` : "";
    console.error(
      `  ${row.label.padEnd(32)} ${row.ms.toFixed(1).padStart(9)} ms  ${pct.padStart(5)}%${detail}`,
    );
  }
  console.error(`  ${"TOTAL".padEnd(32)} ${total.toFixed(1).padStart(9)} ms`);
}

function allDataPaths(dataDir: string): {
  dataRoots: string[];
  archivesDir: string;
  fallbackDir: string;
} {
  return {
    dataRoots: [dataDir, join(dataDir, "api_fallback"), join(dataDir, "extracted")],
    archivesDir: join(dataDir, "archives"),
    fallbackDir: join(dataDir, "api_fallback"),
  };
}

function benchmarkDetectLoop(
  group: InstrumentGroup,
  leaderExchange: string,
  opts: {
    startMs: number;
    endMs: number;
    dataRoots: string[];
    archivesDir: string;
    useArchives: boolean;
    minScore: number;
    liquidityThreshold: number;
    scanFromBarIndex: number;
  },
): TimedRow[] {
  const rows: TimedRow[] = [];
  const loadStart = performance.now();
  const candles5mByExchange = new Map<string, ReturnType<typeof loadSeries>>();
  for (const [exchange, inst] of group.instrumentsByExchange) {
    candles5mByExchange.set(
      exchange,
      loadSeries(inst, "5m", {
        ndjsonRoots: opts.dataRoots,
        archivesDir: opts.archivesDir,
        useArchives: opts.useArchives,
        startMs: opts.startMs,
        endMs: opts.endMs,
      }),
    );
  }
  rows.push({ label: "loadSeries (all exchanges)", ms: ms(loadStart) });

  const computeStart = performance.now();
  const computedByExchange = new Map<string, ReturnType<typeof computeSeries>>();
  for (const [exchange, loaded] of candles5mByExchange) {
    if (loaded.candles.length > 0) {
      computedByExchange.set(exchange, computeSeries(loaded.candles, "5m"));
    }
  }
  rows.push({ label: "computeSeries (all exchanges)", ms: ms(computeStart) });

  const peerMap = computedByExchange;

  const series = computedByExchange.get(leaderExchange);
  const loaded = candles5mByExchange.get(leaderExchange);
  if (!series || !loaded) {
    rows.push({ label: "detect loop", ms: 0, detail: "no leader series" });
    return rows;
  }

  const barCount = series.candles.length;
  const eligibleCount = series.eligible.filter(Boolean).length;
  const evalStart = performance.now();
  let featureCalls = 0;
  let hits = 0;

  for (let i = opts.scanFromBarIndex; i < series.candles.length; i++) {
    if (!series.eligible[i]) continue;
    featureCalls += 1;
    const f = evaluateFeatures(series, i);
    if (!f.eligible) continue;

    const lowLiquidity = f.medianQuoteVolume24h < opts.liquidityThreshold;
    const confirmedExchangeNames = listConfirmedExchangeNames(
      series,
      i,
      peerMap,
      leaderExchange,
    );
    const confirmedCount = confirmedExchangeNames.length;
    const score = computeScore(f, confirmedCount, lowLiquidity);
    const phase = classifyPhase(f, score, loaded.quality.badData, lowLiquidity);

    if (!REPORTABLE_PHASES.has(phase)) continue;
    if (phase === "ignore" || score < opts.minScore) continue;
    hits += 1;
  }
  rows.push({
    label: "evaluateFeatures loop",
    ms: ms(evalStart),
    detail: `bars ${opts.scanFromBarIndex}-${barCount - 1}, ${featureCalls} eligible evals, ${hits} raw hits`,
  });

  rows.push({
    label: "(context)",
    ms: 0,
    detail: `${barCount} bars, ${eligibleCount} eligible indices, leader=${leaderExchange}`,
  });

  return rows;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("benchmark-pump-scan")
    .description("Profile pump scan timing: load, computeSeries, detect loop")
    .option("--days <n>", "Lookback calendar days", "5")
    .option("--data-dir <path>", "Market stats base directory", "data/market_stats")
    .option("--coin-key <key>", "Instrument group key", "linear_perp|BTC|USDT")
    .option("--sample-coins <n>", "Orchestrator fingerprint sweep for first N coins", "0")
    .option("--min-score <n>", "Minimum score", "40")
    .option("--liquidity-threshold <n>", "Liquidity floor", "100000");

  program.parse(process.argv.slice(2).filter((a) => a !== "--"), { from: "user" });
  const opts = program.opts<{
    days: string;
    dataDir: string;
    coinKey: string;
    sampleCoins: string;
    minScore: string;
    liquidityThreshold: string;
  }>();

  const days = Number(opts.days);
  const dataDir = resolveRepoPath(opts.dataDir);
  const [startMs, endMs] = resolveArchiveWindow(undefined, undefined, {}, days);
  const { dataRoots, archivesDir, fallbackDir } = allDataPaths(dataDir);
  const cacheDir = join(dataDir, "reports", "scan_cache");
  const minScore = Number(opts.minScore);
  const liquidityThreshold = Number(opts.liquidityThreshold);
  const scanParams: ScanParams = {
    minScore,
    liquidityThreshold,
    exchanges: null,
  };

  const universePath = join(dataDir, "reports", "symbol_universe.json");
  const indexPath = join(dataDir, "reports", "instrument_index.json");
  const groups = buildInstrumentGroups({ universePath, instrumentIndexPath: indexPath });

  const group = groups.find((g) => g.key === opts.coinKey);
  if (!group) {
    throw new Error(`Coin not found: ${opts.coinKey}`);
  }

  console.error("Pump scan benchmark");
  console.error(`  Data dir: ${dataDir}`);
  console.error(
    `  Window: ${new Date(startMs).toISOString()} .. ${new Date(endMs).toISOString()} (${days} days)`,
  );
  console.error(`  Coin: ${group.key} (${group.entry.symbolCanonical})`);

  const skipArchives = [...group.instrumentsByExchange.keys()].every((exchange) => {
    const inst = group.instrumentsByExchange.get(exchange)!;
    return isSeriesSatisfiedOnDisk(inst, "5m", startMs, endMs, archivesDir, fallbackDir, true);
  });
  const useArchives = !skipArchives;
  console.error(`  skipArchives=${skipArchives}`);

  const coverages = [...group.instrumentsByExchange.keys()].map((exchange) => {
    const inst = group.instrumentsByExchange.get(exchange)!;
    return computeExchangeCoverage(inst, "5m", {
      dataRoots,
      archivesDir,
      fallbackDir,
      startMs,
      endMs,
      useArchives,
    });
  });
  const { leader } = pickLeadingExchange(coverages);
  if (!leader) {
    throw new Error("No leader exchange with coverage for benchmark coin");
  }

  const detectOpts = {
    startMs,
    endMs,
    dataRoots,
    archivesDir,
    useArchives,
    minScore,
    liquidityThreshold,
  };

  printSection(
    `Single coin: full detect path (${opts.coinKey})`,
    benchmarkDetectLoop(group, leader, { ...detectOpts, scanFromBarIndex: 0 }),
  );

  printSection(
    `Single coin: incremental tail (last ${TAIL_WARMUP_BARS} bars)`,
    (() => {
      const leaderInst = group.instrumentsByExchange.get(leader)!;
      const loaded = loadSeries(leaderInst, "5m", {
        ndjsonRoots: detectOpts.dataRoots,
        archivesDir: detectOpts.archivesDir,
        useArchives: detectOpts.useArchives,
        startMs,
        endMs,
      });
      const n = loaded.candles.length;
      return benchmarkDetectLoop(group, leader, {
        ...detectOpts,
        scanFromBarIndex: Math.max(0, n - TAIL_WARMUP_BARS),
      });
    })(),
  );

  const scanCoinStart = performance.now();
  const fullScan = scanCoin(group, leader, coverages, {
    ...detectOpts,
    onLog: () => undefined,
  });
  printSection(`Single coin: scanCoin() end-to-end`, [
    {
      label: "scanCoin (full)",
      ms: ms(scanCoinStart),
      detail: `${fullScan.candidates.length} candidates`,
    },
  ]);

  const priorCache = loadCoinScanCache(coinScanCachePath(cacheDir, group.key));
  if (priorCache) {
    const fp = computeCoinDataFingerprint(group, "5m", dataRoots, startMs, endMs, archivesDir);
    const tail = shouldTailRescan(priorCache, {
      detectorVersion: priorCache.detectorVersion,
      windowStartMs: startMs,
      scanParams,
      dataFingerprint: fp,
    });
    const skip = shouldSkipScan(priorCache, {
      detectorVersion: priorCache.detectorVersion,
      windowStartMs: startMs,
      scanParams,
      dataFingerprint: fp,
    });
    if (tail) {
      const incStart = performance.now();
      const inc = scanCoin(group, leader, coverages, {
        ...detectOpts,
        onLog: () => undefined,
        incremental: {
          cachedCandidates: priorCache.candidates,
          warmupBars: TAIL_WARMUP_BARS,
        },
      });
      printSection(`Single coin: scanCoin() incremental (cache on disk)`, [
        {
          label: "scanCoin (incremental)",
          ms: ms(incStart),
          detail: `${inc.candidates.length} candidates, ${priorCache.candidates.length} cached inputs`,
        },
      ]);
    }
    console.error(`\nCache state: skip=${skip}, tailRescan=${tail}, cached candidates=${priorCache.candidates.length}`);
  } else {
    console.error("\nNo scan cache file for this coin — incremental scanCoin benchmark skipped.");
  }

  const sampleN = Number(opts.sampleCoins);
  if (sampleN > 0) {
    const sample = groups.slice(0, sampleN);
    const fpStart = performance.now();
    let wouldSkip = 0;
    let wouldTail = 0;
    for (const g of sample) {
      const fp = computeCoinDataFingerprint(g, "5m", dataRoots, startMs, endMs, archivesDir);
      const cache = loadCoinScanCache(coinScanCachePath(cacheDir, g.key));
      if (
        cache &&
        shouldSkipScan(cache, {
          detectorVersion: cache.detectorVersion,
          windowStartMs: startMs,
          scanParams,
          dataFingerprint: fp,
        })
      ) {
        wouldSkip += 1;
      } else if (
        cache &&
        shouldTailRescan(cache, {
          detectorVersion: cache.detectorVersion,
          windowStartMs: startMs,
          scanParams,
          dataFingerprint: fp,
        })
      ) {
        wouldTail += 1;
      }
    }
    const fpMs = ms(fpStart);
    const extrapolated = groups.length > 0 ? (fpMs / sample.length) * groups.length : 0;
    printSection(`Orchestrator cache checks (first ${sample.length} coins)`, [
      {
        label: "fingerprint + cache lookup",
        ms: fpMs,
        detail: `${(fpMs / sample.length).toFixed(2)} ms/coin`,
      },
      {
        label: "(would skip)",
        ms: 0,
        detail: `${wouldSkip}/${sample.length} in sample`,
      },
      {
        label: "(would tail rescan)",
        ms: 0,
        detail: `${wouldTail}/${sample.length} in sample`,
      },
      {
        label: "(extrapolated full universe)",
        ms: extrapolated,
        detail: `${groups.length} coins × ${(fpMs / sample.length).toFixed(2)} ms`,
      },
    ]);
  }

  console.error("\nNotes:");
  console.error("  - Production scan uses worker threads (pool size = auto-detected CPU cores; runs compiled dist/cli.js).");
  console.error("  - loadSeries + computeSeries run on the full window even in incremental tail mode.");
  console.error("  - Use --sample-coins 1297 to estimate full-universe cache-check cost (slow).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
