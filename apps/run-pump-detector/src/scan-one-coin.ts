import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isSeriesSatisfiedOnDisk } from "@screener/archive";
import type { InstrumentGroup } from "@screener/pump-detector";
import {
  buildCoinScanCache,
  coinScanCachePath,
  computeCoinDataFingerprint,
  computeExchangeCoverage,
  extractArchivesToNdjson,
  loadCoinScanCache,
  PUMP_DETECTOR_VERSION,
  pickLeadingExchange,
  saveCoinScanCache,
  scanCoin,
  shouldTailRescan,
  TAIL_WARMUP_BARS,
  type ScanParams,
} from "@screener/pump-detector";
import type { CoinWorkerResult } from "./logger.js";

function writeCoinScanOutput(outputPath: string, candidates: unknown[]): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, "", "utf-8");
  for (const c of candidates) {
    appendFileSync(outputPath, `${JSON.stringify(c)}\n`, "utf-8");
  }
}

export interface ScanOneCoinOptions {
  group: InstrumentGroup;
  startMs: number;
  endMs: number;
  windowStartMs: number;
  dataDir: string;
  dataRoots: string[];
  archivesDir: string;
  fallbackDir: string;
  extractedRoot: string;
  minScore: number;
  liquidityThreshold: number;
  exchanges?: Set<string>;
  scanParams: ScanParams;
  cacheDir?: string;
  outputPath: string;
  onLog: (msg: string) => void;
}

export function scanOneCoin(opts: ScanOneCoinOptions): CoinWorkerResult {
  const {
    group,
    startMs,
    endMs,
    windowStartMs,
    dataRoots,
    archivesDir,
    fallbackDir,
    extractedRoot,
    minScore,
    liquidityThreshold,
    exchanges,
    scanParams,
    cacheDir,
    outputPath,
    onLog,
  } = opts;

  const exchangeList = [...group.instrumentsByExchange.keys()];
  onLog(
    `Coin ${group.entry.symbolCanonical} (${group.entry.instrumentType}) on [${exchangeList.join(", ")}]`,
  );

  const skipArchives = exchangeList.every((exchange) => {
    const inst = group.instrumentsByExchange.get(exchange)!;
    return isSeriesSatisfiedOnDisk(inst, "5m", startMs, endMs, archivesDir, fallbackDir, true);
  });
  const useArchives = !skipArchives;
  onLog(`skipArchives=${skipArchives} (all exchanges fully satisfied on disk)`);

  onLog("--- phase 1: initial coverage ---");
  let coverages = exchangeList.map((exchange) => {
    const inst = group.instrumentsByExchange.get(exchange)!;
    return computeExchangeCoverage(inst, "5m", {
      dataRoots,
      archivesDir,
      fallbackDir,
      startMs,
      endMs,
      useArchives,
      onLog,
    });
  });

  if (!skipArchives) {
    onLog("--- phase 2: extract archives to NDJSON ---");
    mkdirSync(extractedRoot, { recursive: true });
    for (const inst of group.instrumentsByExchange.values()) {
      extractArchivesToNdjson(inst, "5m", {
        archivesDir,
        outRoot: extractedRoot,
        startMs,
        endMs,
        onLog,
      });
    }

    onLog("--- phase 3: coverage after extraction ---");
    coverages = exchangeList.map((exchange) => {
      const inst = group.instrumentsByExchange.get(exchange)!;
      return computeExchangeCoverage(inst, "5m", {
        dataRoots,
        archivesDir,
        fallbackDir,
        startMs,
        endMs,
        useArchives,
        onLog,
      });
    });
  } else {
    onLog("--- phases 2-3 skipped: NDJSON already complete on disk ---");
  }

  const { leader, ranked } = pickLeadingExchange(coverages);
  onLog("--- phase 4: pick leading exchange ---");
  for (const c of ranked) {
    onLog(
      `  ${c.exchange}: ${c.coveragePct.toFixed(1)}% fullySatisfied=${c.fullySatisfied}` +
        (c.fromMs != null && c.toMs != null
          ? ` [${new Date(c.fromMs).toISOString()} .. ${new Date(c.toMs).toISOString()}]`
          : ""),
    );
  }

  if (!leader) {
    onLog("SKIP: no exchange with data coverage > 0%");
    writeCoinScanOutput(outputPath, []);
    onLog(`Wrote 0 candidate(s) to ${outputPath}`);
    return {
      coinKey: group.key,
      status: "skipped",
      leaderExchange: null,
      exchanges: exchangeList,
      candidateCount: 0,
      coverages: coverages.map((c) => ({
        exchange: c.exchange,
        coveragePct: c.coveragePct,
        fromMs: c.fromMs,
        toMs: c.toMs,
        fullySatisfied: c.fullySatisfied,
      })),
    };
  }

  onLog(`Leading exchange: ${leader}`);
  onLog("--- phase 5: detect on leader + verify peers ---");

  const dataFingerprint = computeCoinDataFingerprint(
    group,
    "5m",
    dataRoots,
    startMs,
    endMs,
    archivesDir,
  );

  const cachePath = cacheDir ? coinScanCachePath(cacheDir, group.key) : null;
  const priorCache = cachePath ? loadCoinScanCache(cachePath) : null;

  const tailRescan =
    priorCache != null &&
    shouldTailRescan(priorCache, {
      detectorVersion: PUMP_DETECTOR_VERSION,
      windowStartMs,
      scanParams,
      dataFingerprint,
    });

  if (tailRescan) {
    onLog(
      `incremental tail rescan: ${priorCache!.candidates.length} cached candidate(s), warmup=${TAIL_WARMUP_BARS} bars`,
    );
  }

  const { candidates } = scanCoin(group, leader, coverages, {
    startMs,
    endMs,
    dataRoots,
    archivesDir,
    useArchives,
    onLog,
    minScore,
    liquidityThreshold,
    exchanges,
    incremental: tailRescan
      ? {
          cachedCandidates: priorCache!.candidates,
          warmupBars: TAIL_WARMUP_BARS,
        }
      : undefined,
  });

  writeCoinScanOutput(outputPath, candidates);
  onLog(`Wrote ${candidates.length} candidate(s) to ${outputPath}`);

  const coverageSnapshots = coverages.map((c) => ({
    exchange: c.exchange,
    coveragePct: c.coveragePct,
    fromMs: c.fromMs,
    toMs: c.toMs,
    fullySatisfied: c.fullySatisfied,
  }));

  if (cachePath) {
    saveCoinScanCache(
      cachePath,
      buildCoinScanCache({
        coinKey: group.key,
        windowStartMs,
        windowEndMs: endMs,
        scanParams,
        dataFingerprint,
        candidates,
        leaderExchange: leader,
        coverages: coverageSnapshots,
      }),
    );
    onLog(`Wrote scan cache to ${cachePath}`);
  }

  return {
    coinKey: group.key,
    status: tailRescan ? "incremental" : "ok",
    leaderExchange: leader,
    exchanges: exchangeList,
    candidateCount: candidates.length,
    coverages: coverageSnapshots,
  };
}

export function allDataPaths(dataDir: string): {
  dataRoots: string[];
  archivesDir: string;
  fallbackDir: string;
  extractedRoot: string;
} {
  return {
    dataRoots: [join(dataDir, "api_fallback"), join(dataDir, "extracted")],
    archivesDir: join(dataDir, "archives"),
    fallbackDir: join(dataDir, "api_fallback"),
    extractedRoot: join(dataDir, "extracted"),
  };
}
