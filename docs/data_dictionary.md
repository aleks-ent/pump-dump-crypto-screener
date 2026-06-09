# Data Dictionary: Multi-Exchange Market Stats

## Raw Dataset (`raw/.../data.ndjson`)

Each row preserves exchange response fields while adding ingestion metadata.

- `exchange`: Source exchange (`binance`, `bybit`)
- `instrument_type`: Exchange-native market class (examples: `spot`, `linear_perp`, `swap`)
- `symbol_native`: Native symbol / instrument id
- `interval`: Candle interval (`1m`, `5m`)
- `open_time_ms`: Candle open time in Unix milliseconds
- `close_time_ms`: Candle close time in Unix milliseconds (when available)
- `open`, `high`, `low`, `close`: OHLC values as strings
- `volume`: Base volume (string)
- `quote_volume`: Quote volume when available (string or null)
- `trade_count`: Trade count when available (int or null)
- `raw_payload`: Entire source row payload from exchange API
- `ingestion.fetched_at_utc`: Ingestion timestamp
- `ingestion.request_meta`: Endpoint/window metadata from request loop

## Normalized Dataset (`normalized/.../data.ndjson`)

Normalized schema for downstream scripts. No exchange fields are dropped.

- Core fields are identical to raw (`exchange`, `instrument_type`, `symbol_native`, `interval`, OHLCV)
- `extra_fields.raw_payload` stores full source payload for lossless retention

## Symbol Universe (`reports/symbol_universe.json`)

Union of **spot and futures instruments quoted in USDT** listed on at least one exchange. Options and non-USDT quotes are excluded by default.

- `market_category`: `spot` or `futures`
- `instrument_type`: exchange-native type (`spot`, `linear_perp`, `inverse_futures`, `swap`, `futures`)
- `symbol_canonical`
- `base`
- `quote`
- `listed_on`: exchanges where this canonical instrument appears

## Quality Report (`reports/quality_report.ndjson`)

One record per `exchange + instrument_type + symbol_native + interval`.

- `expected_bars`
- `actual_bars`
- `duplicate_bars`
- `gaps`
- `coverage_pct`
- `first_open_time_ms`
- `last_open_time_ms`

## Archive cache (`archives/` + `api_fallback/raw/`)

Bulk kline zips under `archives/` cover complete prior UTC days. REST rows under
`api_fallback/raw/` cover missing archive days and the partial current UTC day when
using `fetch:all` / `fetch:archives` with `--days N` (calendar window: N−1 archive
days + today via REST).

## Run Manifest (`reports/run_manifest.json`)

Summary artifact for downstream processing.

- ingestion window
- selected exchanges / intervals
- counts (instruments, series, rows)
- resolved dataset paths
