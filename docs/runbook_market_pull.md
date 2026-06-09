# Runbook: 30-Day Market Statistics Pull

## Purpose

Fetch 1m and 5m market statistics for Binance and ByBit over the last 30 days, preserving all API-provided fields.

For universe-scoped **bulk archive** downloads (with REST fallback), see [runbook_archive_pull.md](runbook_archive_pull.md).

## API Contracts

### Binance
- Discovery:
  - `GET /api/v3/exchangeInfo` (spot)
  - `GET /fapi/v1/exchangeInfo` (USDT perpetual/futures)
  - `GET /dapi/v1/exchangeInfo` (coin-margined futures)
- Candles:
  - `GET /api/v3/klines`
  - `GET /fapi/v1/klines`
  - `GET /dapi/v1/klines`
- Pagination:
  - `startTime`, `endTime`, `limit` (max 1000)
  - loop forward by last open time + interval

### ByBit (V5)
- Discovery:
  - `GET /v5/market/instruments-info` with `category` and cursor paging
- Candles:
  - `GET /v5/market/kline` (`category` in `spot`, `linear`, `inverse`)
- Pagination:
  - `start`, `end`, `limit` (max 1000)
  - response rows sorted descending by default; script normalizes ascending

## Time Semantics

- Internal canonical time unit: Unix milliseconds UTC
- Default window: `[now - 30 days, now]`
- Intervals: from `config.js` (`fetch.intervals`: `1m`, `5m`, or both)

## Retry and Rate-Limit Strategy

- Retry on transient statuses (`429`, `5xx`, and related)
- Exponential backoff + jitter
- Global per-host token-bucket limiter for optional parallel workers

## Commands

Requires **Node.js 20+** and **pnpm**. Run from the repository root.

Install dependencies and build:

```bash
pnpm install
pnpm build
```

Default full run (30 days, all exchanges, 1m + 5m):

```bash
pnpm fetch:stats -- --output data/market_stats
```

Resume interrupted run:

```bash
pnpm fetch:stats -- --resume --workers 1
```

Custom window and filtering:

```bash
pnpm fetch:stats -- \
  --start 2026-05-01T00:00:00Z \
  --end 2026-05-31T00:00:00Z \
  --exchanges binance bybit \
  --instrument-types spot linear_perp inverse_futures \
  --output data/market_stats
```

## Output Layout

- `data/market_stats/raw/...`: lossless row-level records
- `data/market_stats/normalized/...`: normalized rows + `extra_fields`
- `data/market_stats/reports/quality_report.ndjson`
- `data/market_stats/reports/symbol_universe.json`
- `data/market_stats/reports/run_manifest.json`
- `data/market_stats/reports/checkpoint.json` (resume mode)
