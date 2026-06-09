import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import pLimit from "p-limit";
import {
  isSeriesSatisfiedOnDisk,
  setBybitSkipPublicArchives,
} from "@screener/archive";
import {
  FileCooldownStore,
  HttpClient,
  TokenBucketLimiter,
  loadFetchIntervals,
  loadYaml,
  resolveRepoPath,
  resolveArchiveWindow,
  type FetchInterval,
} from "@screener/core";
import { getAdapters, type ExchangeAdapter } from "@screener/exchanges";
import {
  emptyCoverageIndex,
  isFullyIndexed,
  loadCoverageIndex,
  mergeCoverageEntry,
  saveCoverageIndex,
  seriesKey,
  uncoveredRanges,
  type CoverageIndex,
} from "@screener/storage";
import {
  applyUniverseFilters,
  buildInstrumentIndex,
  buildSymbolUniverse,
  discoverForExchanges,
  filterUniverseByQuote,
  loadInstrumentIndexFile,
  loadUniverse,
  filterTasksBySymbols,
  resolveSeriesTasks,
  writeInstrumentIndex,
  type Instrument,
  type SeriesTask,
} from "@screener/universe";

/** Concurrency for the on-disk coverage pre-check (cheap disk stat() calls). */
const COVERAGE_CHECK_WORKERS = 32;

export function symbolCliArgs(symbols: string[]): string[] {
  return symbols.flatMap((s) => ["--symbol", s]);
}

export interface ArchiveRunOptions {
  universe: string;
  start?: string;
  end?: string;
  exchanges: string[];
  quoteCurrencies: string[];
  output: string;
  config?: string;
  defaultDays?: number;
  skipDiscovery?: boolean;
  skipExisting?: boolean;
  /** Persist coverage_index.json after classifying tasks (orchestrator only). */
  updateCoverageIndex?: boolean;
  /** Ignore coverage_index.json and rebuild from disk checks. */
  rebuildCoverageIndex?: boolean;
  /** Native or canonical symbols (e.g. BTCUSDT, BTC/USDT). Empty = all coins. */
  symbols?: string[];
}

export interface ArchiveRunContext {
  cfg: Record<string, unknown>;
  intervals: FetchInterval[];
  startMs: number;
  endMs: number;
  baseDir: string;
  cooldownDir: string;
  archivesDir: string;
  fallbackDir: string;
  adapters: Record<string, ExchangeAdapter>;
  instruments: Instrument[];
  instrumentIndex: Map<string, Instrument>;
  tasks: SeriesTask[];
  pending: SeriesTask[];
  allowFallback: boolean;
  skippedExisting: number;
  coverageIndexHits: number;
  coverageDiskChecks: number;
}

export function configureBybitArchiveMode(
  cfg: Record<string, unknown>,
  log?: (msg: string) => void,
): void {
  const skip = cfg.bybit_skip_public_archives === true;
  setBybitSkipPublicArchives(skip);
  if (skip && log) {
    log("Bybit: skipping public.bybit.com archives (REST klines only)");
  }
}

export function makeHttpClient(
  cfg: Record<string, unknown>,
  opts?: { cooldownDir?: string; log?: (msg: string) => void },
): HttpClient {
  const hostRps =
    cfg.host_rps && typeof cfg.host_rps === "object"
      ? (cfg.host_rps as Record<string, number>)
      : {};
  const store = opts?.cooldownDir ? new FileCooldownStore(opts.cooldownDir) : undefined;
  return new HttpClient({
    timeoutS: Number(cfg.timeout_s ?? 60),
    limiter: new TokenBucketLimiter(Number(cfg.default_rps ?? 8), hostRps, {
      store,
      log: opts?.log,
    }),
    retryPolicy: { retries: Number(cfg.retries ?? 5) },
  });
}

/** Shared directory where 418/429 cooldowns are mirrored across processes. */
export function cooldownDirFor(baseDir: string): string {
  return join(baseDir, "reports", ".cooldowns");
}

/** Discover currently listed instruments and write `symbol_universe.json` when absent. */
export async function ensureSymbolUniverse(
  universePath: string,
  opts: {
    exchanges: Set<string>;
    quoteCurrencies: Set<string>;
    adapters: Record<string, ExchangeAdapter>;
    client: HttpClient;
    log?: (msg: string) => void;
  },
): Promise<boolean> {
  if (existsSync(universePath)) return false;
  const log = opts.log ?? (() => undefined);
  log(`Symbol universe missing at ${universePath}; discovering listed instruments...`);
  const discovered = await discoverForExchanges(opts.adapters, opts.client, opts.exchanges);
  const filtered = applyUniverseFilters(discovered, opts.quoteCurrencies);
  const rows = buildSymbolUniverse(filtered);
  mkdirSync(dirname(universePath), { recursive: true });
  writeFileSync(universePath, JSON.stringify(rows, null, 2), "utf-8");
  log(`Wrote symbol universe (${rows.length} entries) → ${universePath}`);
  return true;
}

export async function prepareArchiveRun(opts: ArchiveRunOptions): Promise<ArchiveRunContext> {
  const intervals = await loadFetchIntervals();
  const configPath = opts.config
    ? resolveRepoPath(opts.config)
    : resolveRepoPath("config/archives.yaml");
  const cfg = loadYaml(configPath);
  configureBybitArchiveMode(cfg);
  const [startMs, endMs] = resolveArchiveWindow(
    opts.start,
    opts.end,
    cfg,
    opts.defaultDays ?? 30,
  );
  const baseDir = resolveRepoPath(opts.output);
  mkdirSync(baseDir, { recursive: true });
  const cooldownDir = cooldownDirFor(baseDir);
  const archivesDir = join(baseDir, "archives");
  const fallbackDir = join(baseDir, "api_fallback");
  const allowFallback = true;
  const skipExisting = opts.skipExisting !== false;

  const mainClient = makeHttpClient(cfg, { cooldownDir });
  const selectedExchanges = new Set(opts.exchanges);
  const quoteCurrencies = new Set(opts.quoteCurrencies.map((q) => q.toUpperCase()));
  const adapters = getAdapters();
  const universePath = resolveRepoPath(opts.universe);
  await ensureSymbolUniverse(universePath, {
    exchanges: selectedExchanges,
    quoteCurrencies,
    adapters,
    client: mainClient,
    log: (msg) => console.log(msg),
  });
  const universe = filterUniverseByQuote(loadUniverse(universePath), quoteCurrencies);
  const indexPath = join(baseDir, "reports", "instrument_index.json");
  let instruments: Awaited<ReturnType<typeof discoverForExchanges>>;
  if (opts.skipDiscovery && existsSync(indexPath)) {
    instruments = applyUniverseFilters(loadInstrumentIndexFile(indexPath), quoteCurrencies);
  } else {
    const discovered = await discoverForExchanges(adapters, mainClient, selectedExchanges);
    instruments = applyUniverseFilters(discovered, quoteCurrencies);
    writeInstrumentIndex(baseDir, buildInstrumentIndex(instruments), { merge: true });
  }
  const index = buildInstrumentIndex(instruments);
  let { tasks } = resolveSeriesTasks(universe, index, {
    exchanges: selectedExchanges,
    intervals,
    adapters,
  });
  if (opts.symbols?.length) {
    tasks = filterTasksBySymbols(tasks, opts.symbols);
  }

  let skippedExisting = 0;
  let coverageIndexHits = 0;
  let coverageDiskChecks = 0;
  const pending: SeriesTask[] = [];

  if (!skipExisting) {
    pending.push(...tasks);
  } else {
    const coverageIndex: CoverageIndex = opts.rebuildCoverageIndex
      ? emptyCoverageIndex()
      : loadCoverageIndex(baseDir);

    const logEnabled = tasks.length > 100;
    let skipCheckDone = 0;
    const total = tasks.length;
    const checkLimit = pLimit(COVERAGE_CHECK_WORKERS);

    const classifyTask = (task: SeriesTask): boolean => {
      const inst = task.instrument;
      const key = seriesKey(inst, task.interval);
      const entry = coverageIndex.series[key];

      if (isFullyIndexed(entry, startMs, endMs)) {
        coverageIndexHits += 1;
        return true;
      }

      coverageDiskChecks += 1;
      const gaps = uncoveredRanges(entry, startMs, endMs);
      for (const [gapStart, gapEnd] of gaps) {
        if (
          !isSeriesSatisfiedOnDisk(
            inst,
            task.interval,
            gapStart,
            gapEnd,
            archivesDir,
            fallbackDir,
            allowFallback,
          )
        ) {
          delete coverageIndex.series[key];
          return false;
        }
      }

      coverageIndex.series[key] = mergeCoverageEntry(entry, startMs, endMs);
      return true;
    };

    await Promise.all(
      tasks.map((task) =>
        checkLimit(async () => {
          const inst = task.instrument;
          const satisfied = classifyTask(task);
          skipCheckDone += 1;
          if (
            logEnabled &&
            (skipCheckDone === 1 || skipCheckDone === total || skipCheckDone % 100 === 0)
          ) {
            console.log(
              `Checking coverage ${skipCheckDone}/${total} (${inst.symbolNative}) — ${coverageIndexHits} index hits, ${coverageDiskChecks} disk checks`,
            );
          }
          if (satisfied) skippedExisting += 1;
          else pending.push(task);
        }),
      ),
    );

    if (opts.updateCoverageIndex) {
      saveCoverageIndex(baseDir, coverageIndex);
    }
  }

  return {
    cfg,
    intervals,
    startMs,
    endMs,
    baseDir,
    cooldownDir,
    archivesDir,
    fallbackDir,
    adapters,
    instruments,
    instrumentIndex: index,
    tasks,
    pending,
    allowFallback,
    skippedExisting,
    coverageIndexHits,
    coverageDiskChecks,
  };
}
