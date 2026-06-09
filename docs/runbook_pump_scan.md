# Runbook: Pump detection scan

## Purpose

Scan downloaded OHLCV for pump-like regimes using rules in [PUMP_DETECTION_RULES.md](../PUMP_DETECTION_RULES.md). Data can come from **NDJSON** (`raw/`, `api_fallback/raw/`) and/or **archive zips** under `archives/` (unzipped on the fly when needed). Output is `pump_events.ndjson` with scores, phases, and human-readable reasons.

## Prerequisites

```bash
pnpm install
pnpm build
```

Ingested candle data under `data/market_stats` (REST pull `raw/` or archive REST fallback `api_fallback/raw/`). Universe artifacts:

- `reports/symbol_universe.json`
- `reports/instrument_index.json`

## Command

```bash
pnpm scan:pumps -- \
  --data-dir data/market_stats \
  --start 2026-05-28T00:00:00Z \
  --end 2026-06-03T00:00:00Z \
  --output data/market_stats/reports/pump_events.ndjson
```

Loads candles from `raw/`, `api_fallback/raw/`, and `archives/` (zips unpacked on read). Defaults: last 5 days, `pump.minScore` from `config.js` (80), liquidity floor 100k quote volume (median 24h).

Logs on stderr show per-series load path: `[ndjson]`, `[archive]` (unzipped), `[merged]`, or `[missing]`. A summary block counts sources at the end.

### Useful flags

| Flag | Description |
|------|-------------|
| `--market-category spot\|futures` | Filter universe |
| `--exchanges binance,bybit` | Filter exchanges |
| `--liquidity-threshold 500000` | Stricter liquidity filter (score penalty below threshold) |
| `--max-groups 10` | Limit groups (debug) |

## Cross-exchange matching

Instruments are grouped by `instrument_type` + `base` + `quote` (same row in `symbol_universe.json`). Native tickers differ per exchange; paths come from `instrument_index.json`. Peer confirmation aligns 5m candles by `open_time_ms` within ±15 minutes.

## Output

One JSON object per line (`PumpCandidate`): `timestamp`, `phase`, `score`, `confidence`, `metrics`, `reasons`.

Phases: `activation`, `active_pump`, `late_pump`, `distribution_or_fade`, `spike`.

## Related

- Data dictionary: [data_dictionary.md](data_dictionary.md)
- Market pull: [runbook_market_pull.md](runbook_market_pull.md)
