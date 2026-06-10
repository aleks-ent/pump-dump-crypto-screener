import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { InstrumentGroup } from "./instrument/group.js";
import {
  buildCoinScanCache,
  coinScanCachePath,
  loadCoinScanCache,
  PUMP_DETECTOR_VERSION,
  saveCoinScanCache,
  shouldSkipScan,
  shouldTailRescan,
  type CoinScanCache,
  type ExchangeDataFingerprint,
  type ScanParams,
} from "./scan-cache.js";

const scanParams: ScanParams = {
  minScore: 40,
  minDumpScore: 55,
  liquidityThreshold: 100_000,
  exchanges: ["binance"],
};

const fingerprint: ExchangeDataFingerprint[] = [
  {
    exchange: "binance",
    barCount: 100,
    firstBarMs: 1_700_000_000_000,
    lastBarMs: 1_700_000_300_000,
    dayFiles: [{ rootIndex: 0, day: "2026-06-01", size: 1024, mtimeMs: 1_700_000_000_000 }],
    archiveFiles: [],
  },
];

function makeCache(overrides: Partial<CoinScanCache> = {}): CoinScanCache {
  return {
    ...buildCoinScanCache({
      coinKey: "spot|BTC|USDT",
      windowStartMs: 1_700_000_000_000,
      windowEndMs: 1_700_086_400_000,
      scanParams,
      dataFingerprint: fingerprint,
      candidates: [],
      leaderExchange: "binance",
      coverages: [
        {
          exchange: "binance",
          coveragePct: 100,
          fromMs: 1_700_000_000_000,
          toMs: 1_700_000_300_000,
          fullySatisfied: true,
        },
      ],
    }),
    ...overrides,
  };
}

describe("shouldSkipScan", () => {
  const endMs = 1_700_086_400_000;
  const baseOpts = {
    detectorVersion: PUMP_DETECTOR_VERSION,
    windowStartMs: 1_700_000_000_000,
    endMs,
    scanParams,
    dataFingerprint: fingerprint,
  };

  it("returns false when cache is null", () => {
    expect(shouldSkipScan(null, baseOpts)).toBe(false);
  });

  it("returns true when all cache keys match", () => {
    const cache = makeCache();
    expect(shouldSkipScan(cache, baseOpts)).toBe(true);
  });

  it("invalidates when endMs moved past cached windowEndMs", () => {
    const cache = makeCache({ windowEndMs: endMs - 600_000 });
    expect(shouldSkipScan(cache, { ...baseOpts, endMs })).toBe(false);
  });

  it("returns true when endMs matches cached windowEndMs", () => {
    const cache = makeCache({ windowEndMs: endMs });
    expect(shouldSkipScan(cache, { ...baseOpts, endMs })).toBe(true);
  });

  it("invalidates on detector version mismatch", () => {
    const cache = makeCache({ detectorVersion: "0.0.9" });
    expect(shouldSkipScan(cache, baseOpts)).toBe(false);
  });

  it("invalidates on windowStartMs mismatch", () => {
    const cache = makeCache({ windowStartMs: 1_699_000_000_000 });
    expect(shouldSkipScan(cache, baseOpts)).toBe(false);
  });

  it("invalidates on scanParams mismatch", () => {
    const cache = makeCache({
      scanParams: { ...scanParams, minScore: 50 },
    });
    expect(shouldSkipScan(cache, baseOpts)).toBe(false);
  });

  it("invalidates on exchanges filter mismatch", () => {
    const cache = makeCache({
      scanParams: { ...scanParams, exchanges: ["bybit"] },
    });
    expect(shouldSkipScan(cache, baseOpts)).toBe(false);
  });

  it("invalidates on data fingerprint mismatch", () => {
    const cache = makeCache({
      dataFingerprint: [
        {
          ...fingerprint[0]!,
          barCount: 99,
        },
      ],
    });
    expect(shouldSkipScan(cache, baseOpts)).toBe(false);
  });

  it("does not invalidate when only day file mtime/size metadata changes", () => {
    const cache = makeCache();
    const changedMetadata: ExchangeDataFingerprint[] = [
      {
        ...fingerprint[0]!,
        dayFiles: [{ rootIndex: 0, day: "2026-06-01", size: 2048, mtimeMs: 9_999_999_999_999 }],
      },
    ];
    expect(
      shouldSkipScan(cache, { ...baseOpts, dataFingerprint: changedMetadata }),
    ).toBe(true);
  });

  it("invalidates when lastBarMs changes", () => {
    const cache = makeCache();
    const changedBars: ExchangeDataFingerprint[] = [
      {
        ...fingerprint[0]!,
        lastBarMs: fingerprint[0]!.lastBarMs! + 300_000,
      },
    ];
    expect(shouldSkipScan(cache, { ...baseOpts, dataFingerprint: changedBars })).toBe(false);
  });

  it("invalidates when a new archive zip appears (NDJSON unchanged)", () => {
    const cache = makeCache();
    const withArchive: ExchangeDataFingerprint[] = [
      {
        ...fingerprint[0]!,
        archiveFiles: [{ day: "2026-06-08", size: 4096 }],
      },
    ];
    expect(shouldSkipScan(cache, { ...baseOpts, dataFingerprint: withArchive })).toBe(false);
  });

  it("invalidates when cache predates archiveFiles field", () => {
    const cache = makeCache({
      dataFingerprint: [
        {
          exchange: "binance",
          barCount: 100,
          firstBarMs: 1_700_000_000_000,
          lastBarMs: 1_700_000_300_000,
          dayFiles: [],
        } as ExchangeDataFingerprint,
      ],
    });
    expect(shouldSkipScan(cache, baseOpts)).toBe(false);
  });
});

describe("shouldTailRescan", () => {
  const baseOpts = {
    detectorVersion: PUMP_DETECTOR_VERSION,
    windowStartMs: 1_700_000_000_000,
    scanParams,
    dataFingerprint: fingerprint,
  };

  it("returns false when cache is null", () => {
    expect(shouldTailRescan(null, baseOpts)).toBe(false);
  });

  it("returns false when fingerprint unchanged", () => {
    expect(shouldTailRescan(makeCache(), baseOpts)).toBe(false);
  });

  it("returns true when only tail bars appended", () => {
    const cache = makeCache();
    const tailAppend: ExchangeDataFingerprint[] = [
      {
        ...fingerprint[0]!,
        barCount: fingerprint[0]!.barCount + 1,
        lastBarMs: fingerprint[0]!.lastBarMs! + 300_000,
      },
    ];
    expect(
      shouldTailRescan(cache, { ...baseOpts, dataFingerprint: tailAppend }),
    ).toBe(true);
  });

  it("returns false when window start shifts", () => {
    const cache = makeCache();
    const tailAppend: ExchangeDataFingerprint[] = [
      {
        ...fingerprint[0]!,
        firstBarMs: fingerprint[0]!.firstBarMs! + 300_000,
        barCount: fingerprint[0]!.barCount + 1,
        lastBarMs: fingerprint[0]!.lastBarMs! + 300_000,
      },
    ];
    expect(
      shouldTailRescan(cache, { ...baseOpts, dataFingerprint: tailAppend }),
    ).toBe(false);
  });

  it("returns false when bar count drops", () => {
    const cache = makeCache();
    const shrunk: ExchangeDataFingerprint[] = [
      {
        ...fingerprint[0]!,
        barCount: fingerprint[0]!.barCount - 1,
      },
    ];
    expect(shouldTailRescan(cache, { ...baseOpts, dataFingerprint: shrunk })).toBe(false);
  });

  it("returns false when only archive zips change (full rescan required)", () => {
    const cache = makeCache();
    const withArchive: ExchangeDataFingerprint[] = [
      {
        ...fingerprint[0]!,
        archiveFiles: [{ day: "2026-06-08", size: 4096 }],
      },
    ];
    expect(shouldTailRescan(cache, { ...baseOpts, dataFingerprint: withArchive })).toBe(false);
  });
});

describe("saveCoinScanCache / loadCoinScanCache", () => {
  it("round-trips cache JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-cache-"));
    try {
      const cache = makeCache({
        candidates: [
          {
            timestamp: 1_700_000_000_000,
            baseAsset: "BTC",
            quoteAsset: "USDT",
            symbol: "BTCUSDT",
            exchange: "binance",
            timeframe: "5m",
            phase: "activation",
            score: 55,
            confidence: "medium",
            leadingExchange: "binance",
            confirmed: false,
            confirmedExchanges: ["binance"],
            peersAvailable: 1,
            coverage: [],
            metrics: {
              volumeRatio: 2,
              rangeRatio: 1.5,
              bodyRatio: 0.8,
              priceChangeLast3Candles: 0.01,
              priceChangeLast6Candles: 0.02,
              priceChangeLast12Candles: 0.03,
              greenCountLast4: 3,
              greenCountLast6: 4,
              strongGreenCountLast5: 2,
              currentPullback: null,
              confirmedExchanges: 1,
              medianQuoteVolume24h: 1_000_000,
              closePosition: 0.9,
              ema20: 100,
              ema50: 99,
              ema20Slope: 0.1,
            },
            reasons: ["volume spike"],
          },
        ],
      });
      const path = coinScanCachePath(dir, cache.coinKey);
      saveCoinScanCache(path, cache);
      const loaded = loadCoinScanCache(path);
      expect(loaded).toEqual(cache);
      expect(statSync(path).size).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null for missing cache file", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-cache-miss-"));
    try {
      expect(loadCoinScanCache(join(dir, "missing.json"))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null for corrupt cache file", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-cache-bad-"));
    try {
      const path = join(dir, "bad.json");
      writeFileSync(path, "not json", "utf-8");
      expect(loadCoinScanCache(path)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("computeCoinDataFingerprint", () => {
  it("fingerprints NDJSON day files on disk", async () => {
    const { computeCoinDataFingerprint } = await import("./scan-cache.js");
    const dir = mkdtempSync(join(tmpdir(), "scan-cache-fp-"));
    try {
      const day = "2026-06-01";
      const ndjsonPath = join(
        dir,
        "raw",
        "exchange=binance",
        "instrument_type=spot",
        "interval=5m",
        `date=${day}`,
        "symbol=BTCUSDT",
        "data.ndjson",
      );
      mkdirSync(dirname(ndjsonPath), { recursive: true });
      const row = JSON.stringify({
        exchange: "binance",
        instrument_type: "spot",
        symbol_native: "BTCUSDT",
        interval: "5m",
        open_time_ms: Date.parse(`${day}T12:00:00.000Z`),
        open: "100",
        high: "110",
        low: "99",
        close: "105",
        volume: "1000",
        quote_volume: "105000",
      });
      writeFileSync(ndjsonPath, `${row}\n`, "utf-8");

      const group: InstrumentGroup = {
        key: "spot|BTC|USDT",
        entry: {
          marketCategory: "spot",
          symbolCanonical: "BTC/USDT",
          instrumentType: "spot",
          base: "BTC",
          quote: "USDT",
          listedOn: ["binance"],
        },
        instrumentsByExchange: new Map([
          [
            "binance",
            {
              exchange: "binance",
              instrumentType: "spot",
              symbolNative: "BTCUSDT",
              symbolCanonical: "BTC/USDT",
              base: "BTC",
              quote: "USDT",
              metadata: {},
            },
          ],
        ]),
      };

      const startMs = Date.parse(`${day}T00:00:00.000Z`);
      const endMs = Date.parse(`${day}T23:59:59.999Z`) + 1;
      const fp = computeCoinDataFingerprint(group, "5m", [dir], startMs, endMs);
      expect(fp).toHaveLength(1);
      expect(fp[0]!.exchange).toBe("binance");
      expect(fp[0]!.barCount).toBe(1);
      expect(fp[0]!.dayFiles).toHaveLength(1);
      expect(fp[0]!.dayFiles[0]!.day).toBe(day);
      expect(fp[0]!.archiveFiles).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes on-disk archive zips in the fingerprint", async () => {
    const { computeCoinDataFingerprint } = await import("./scan-cache.js");
    const dir = mkdtempSync(join(tmpdir(), "scan-cache-arch-"));
    try {
      const archivesDir = join(dir, "archives");
      const day = "2026-06-08";
      const archivePath = join(
        archivesDir,
        "exchange=binance",
        "instrument_type=spot",
        "interval=5m",
        "symbol=XNOUSDT",
        `date=${day}`,
        `XNOUSDT-5m-${day}.zip`,
      );
      mkdirSync(dirname(archivePath), { recursive: true });
      writeFileSync(archivePath, "fake-zip-content", "utf-8");

      const group: InstrumentGroup = {
        key: "spot|XNO|USDT",
        entry: {
          marketCategory: "spot",
          symbolCanonical: "XNO/USDT",
          instrumentType: "spot",
          base: "XNO",
          quote: "USDT",
          listedOn: ["binance"],
        },
        instrumentsByExchange: new Map([
          [
            "binance",
            {
              exchange: "binance",
              instrumentType: "spot",
              symbolNative: "XNOUSDT",
              symbolCanonical: "XNO/USDT",
              base: "XNO",
              quote: "USDT",
              metadata: {},
            },
          ],
        ]),
      };

      const startMs = Date.parse("2026-06-05T00:00:00.000Z");
      const endMs = Date.parse("2026-06-09T00:00:00.000Z");
      const fp = computeCoinDataFingerprint(
        group,
        "5m",
        [join(dir, "raw")],
        startMs,
        endMs,
        archivesDir,
      );
      expect(fp[0]!.archiveFiles).toEqual([{ day, size: statSync(archivePath).size }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
