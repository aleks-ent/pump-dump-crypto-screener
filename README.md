# Pump and Dump Crypto Screener

TypeScript pnpm monorepo for pulling 1m/5m market statistics and bulk kline archives from Binance and Bybit.

## How to set up

**No exchange API keys.** Binance and Bybit data comes from public bulk archives and public
REST endpoints — nothing to sign up for on the exchanges. Support for more exchanges is
coming soon.

You only need two free accounts (~2 minutes each):

| Service | Why | Setup |
|---------|-----|--------|
| **[Turso](https://turso.tech)** | Stores detected pumps and monitor run history | [Turso CLI](https://docs.turso.tech/cli): `turso db create screener` → copy URL + auth token into `config.js` |
| **Telegram** | Pump alerts and `/stats` / `/runs` bot | [@BotFather](https://t.me/BotFather) → `/newbot` → copy token + chat ID — see [docs/telegram_setup.md](docs/telegram_setup.md) |

```bash
# 1. Install
pnpm install
cp config.example.js config.js   # fill in Turso + Telegram (see table above)

# 2. Build and init DB
pnpm build
pnpm db:bootstrap

# 3. Run (downloads market data on first run — can take hours)
pnpm pump:monitor
pnpm pump:bot   # optional: handle classification buttons in Telegram
```

Market data is **not** in the repository. The first `pnpm pump:monitor` run downloads
`pump.days` of candles into `data/market_stats/` (network + disk required).

**Requirements:** Node.js 20+, pnpm 9+.

## Commands

### `pump:monitor` — download, scan, store, and alert

End-to-end pipeline: download the last `pump.days` of 1m/5m candles from **Binance and
Bybit** (public archives + REST), run pump/dump detection, persist **pump episodes** to
the **screener database** (Turso), and send a Telegram message for each **new** pump
(key = `coin|pump_start_utc`).

On disk, candles land under `data/market_stats/` (`archives/`, `api_fallback/raw/`,
`reports/`). Series already cached for the window are skipped on repeat runs.
See [docs/fetch_all.md](docs/fetch_all.md) for how the download step works.

Each new-pump alert is a separate message with **Pump | Dump | None** buttons. Clicking a button
updates `pumps.classification` in the database. Run `pnpm pump:bot` so button clicks are handled.

Lookback window and scan settings in `config.js` (`pump.days`, default `5`; see
[`config.example.js`](config.example.js)). Telegram setup:
[docs/telegram_setup.md](docs/telegram_setup.md).

```bash
pnpm pump:monitor

# Force a full re-scan — set pump.scanCache: false in config.js, or delete scan_cache/:
pnpm pump:monitor
```

#### Screener database (Turso)

Set credentials in `database` in `config.js` (copy from
[`config.example.js`](config.example.js); Telegram setup:
[docs/telegram_setup.md](docs/telegram_setup.md)):

```javascript
database: {
  url: "libsql://screener-....turso.io",
  authToken: "...",
},
```

Bootstrap and one-time JSON import:

```bash
turso db create screener
turso db show screener --url
turso db tokens create screener

pnpm db:bootstrap
pnpm pump:import-index   # imports legacy pump_index.json if present, then deletes it
pnpm pump:bot            # required for classification button clicks
```

Flags: `--no-telegram`, `--cache-dir`.

#### Scan cache (speed)

`pump:monitor` caches per-coin scan results under
`data/market_stats/reports/scan_cache/` (override with `--cache-dir`). A cache entry is reused when
the detector version, scan parameters, window start, and loaded candle identity per exchange
(`barCount`, `firstBarMs`, `lastBarMs`, plus on-disk archive zip `day`+`size`) are unchanged —
not file mtimes, so refreshing files without new bars does not force a rescan. When
new 5m bars are downloaded, workers run an
**incremental tail rescan** (last ~400 bars only, reusing older cached candidates) instead of a
full window rescan. UTC midnight window rolls still trigger a full rescan.

Scanning uses a **worker thread pool** (size = auto-detected CPU cores). Production runs compiled
`dist/cli.js` with native worker threads (no tsx in workers — required for Linux/VDS). Run
`pnpm build` after install or code changes — `pump:monitor` does not rebuild itself.
Local dev without a build can use `pnpm --filter run-pump-detector dev`.

```bash
# Production cron:
pnpm pump:monitor

# Disable scan cache — set pump.scanCache: false in config.js
```

On repeat runs, the scan cache skips unchanged coins after the download step completes; coins
whose candle files changed are recomputed automatically.

### Local cache coverage report

Optional diagnostic — how complete locally cached data is for the last N calendar days
(same window as `pump.days`), per exchange. For every coin present on an exchange it checks
whether all intervals from `config.js` are fully cached on disk for the
window, then prints the percentage of coins that are complete:

```bash
# Last 5 days, all exchanges:
pnpm report:coverage

# Restrict to a fast, fully-local check:
pnpm report:coverage -- --exchanges binance --days 7

# Explicit window + machine-readable JSON:
pnpm report:coverage -- --start 2026-06-03T00:00:00Z --end 2026-06-04T00:00:00Z --json
```

Example output:

```
Window: 2026-06-03 → 2026-06-04 (1 days), intervals 5m
For all coins present on exchange: Binance 82.9% cached (1133/1367), Bybit 80.0% cached (...)
```

A coin counts as cached only when every requested interval is complete on disk.
Useful flags: `--days <n>` (lookback when `--start/--end` omitted), `--exchanges binance bybit`,
`--quote-currencies USDT`, `--discover` (force fresh
instrument discovery instead of reusing `instrument_index.json`), and `--json`.

## Workspace layout

- `packages/core` — HTTP client, config, pull window (`resolveArchiveWindow` for calendar fetch)
- `packages/exchanges` — exchange adapters
- `packages/storage` — NDJSON, gaps, and manifest I/O
- `packages/universe` — symbol universe and task resolution
- `packages/archive` — archive planners and download runner
- `apps/fetch-market-stats` — REST candle pull CLI
- `apps/fetch-market-archives` — universe archive pull CLI (+ `report:coverage` local cache report)
- `packages/db` — screener database (Turso/libSQL): pumps table, bootstrap, import
- `packages/pump-detector` — pump regime detection from OHLCV (PUMP_DETECTION_RULES.md)
- `apps/run-pump-detector` — scan NDJSON history and emit pump_events.ndjson
- `apps/pump-monitor` — fetch + scan + Turso pump store + Telegram alerts and classification
