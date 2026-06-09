# Market data download (`fetch:all`)

`pnpm pump:monitor` downloads candles in its first step by calling **`fetch:all`**
internally (`apps/fetch-market-archives/src/run-all.ts`). You do not need to run
`fetch:all` yourself — this document describes what that step does.

The orchestrator fans out parallel download workers for **Binance and Bybit**. Lookback
length comes from `pump.days` in `config.js` (default `5`).

## Defaults

- **Quotes:** USDT spot and USDT-margined futures
- **Intervals:** from `config.js` (`fetch.intervals`, default `["5m"]`)
- **Output:** `data/market_stats`
- **REST fallback:** on (missing archive days + today's partial UTC day)
- **Workers:** Binance 16, Bybit 8 per exchange (`--processes` overrides both when run manually)

If `symbol_universe.json` is missing, the run discovers currently listed instruments from
exchange APIs and writes the file before downloading.

## What it does, step by step

1. **Resolve window** — `(N−1)` full UTC calendar days through yesterday's archive
   boundary, plus **today through `now` via REST** (or `--start` / `--end` when overridden).
2. **Load universe** — reads `symbol_universe.json` (auto-generated when missing), filters
   to USDT instruments.
3. **Discover instruments** — hits exchange APIs, writes `reports/instrument_index.json`
   (canonical → native symbol mapping).
4. **Build tasks** — one task per `(exchange, coin, interval)` from `config.js`.
5. **Skip existing** — for each task, checks archives + REST on disk; for REST days the
   last candle must reach the window end (so incomplete **today** files are refreshed).
   Satisfied series are not re-downloaded.
6. **Spawn per exchange** — one `run-exchange.ts` child per exchange, **in parallel**
   (Binance 16 workers, Bybit 8). Children use `--skip-discovery` so they don't race on
   `instrument_index.json`.
7. **Shard by symbol** — each worker handles a round-robin slice of symbols and runs
   `runArchiveSeries()` per series:
   - download missing archive zips from CDN (`data.binance.vision`, etc.) for complete
     prior UTC days
   - REST fallback **per missing archive day** (not the full window) and for **today**
     from 00:00 UTC through `--end` (also used for Bybit spot and when
     `bybit_skip_public_archives: true` in `config/archives.yaml`)
8. **Merge results** — gap records → `archive_gaps.ndjson`, run summary →
   `archive_run_manifest.json`.

## Output layout

```
data/market_stats/
├── archives/              # bulk kline zips
├── api_fallback/raw/      # REST tail NDJSON
└── reports/
    ├── instrument_index.json
    ├── symbol_universe.json
    ├── archive_gaps.ndjson
    ├── archive_run_manifest.json
    └── .cooldowns/        # shared 418/429 cooldowns across workers
```

## Window semantics

When start/end are omitted, the lookback is **calendar-based in UTC**:

| Component | Range | Source |
|-----------|--------|--------|
| Prior days | `[today − (N−1) days at 00:00 UTC, today 00:00 UTC)` | Daily/monthly **archives** |
| Today | `[today 00:00 UTC, now)` | **REST** klines |

Example: `pump.days: 5` on `2026-06-06T15:00:00Z` fetches archive zips for
**2026-06-02 … 2026-06-05** and REST for **2026-06-06 00:00 → 15:00**.

## Related

- Archive pull runbook (manual CLIs, flags, exchange notes): [runbook_archive_pull.md](runbook_archive_pull.md)
- Data on disk: [data_dictionary.md](data_dictionary.md)
