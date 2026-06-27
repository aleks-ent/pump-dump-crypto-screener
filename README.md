# Pump and Dump Crypto Screener

<p align="center">
  <img src="docs/assets/pump-dump-summary-demo.png" alt="Pump/dump summary terminal output — episodes table with coin, duration, peak, and TradingView links" width="900"/>
</p>

TypeScript pnpm monorepo for pulling 1m/5m market statistics and bulk kline archives from Binance and Bybit, detecting pump/dump regimes, and alerting via Telegram.

**Try the live bot:** [Open @pumpdumpscreenerautobot on Telegram](https://t.me/pumpdumpscreenerautobot)

**Requirements:** Node.js 20+, pnpm 9+, [pm2](https://pm2.keymetrics.io/) (process manager for production).

## How to set up

**No exchange API keys.** Binance and Bybit data comes from public bulk archives and public REST endpoints.

You need two free accounts (~2 minutes each):

| Service | Why | Setup |
|---------|-----|--------|
| **[Turso](https://turso.tech)** | Stores pumps, monitor runs, and Telegram subscribers | [Turso CLI](https://docs.turso.tech/cli): `turso db create screener` → copy URL + auth token into `config.js` |
| **Telegram** | Pump alerts and `/stats` / `/runs` / `/about` bot | [@BotFather](https://t.me/BotFather) → `/newbot` → see [docs/telegram_setup.md](docs/telegram_setup.md) |

### 1. Install dependencies and configure

```bash
pnpm install
cp config.example.js config.js   # fill in Turso + Telegram (see table above)
```

Edit `config.js` — at minimum, configure `database`, `telegramBotToken`, and your private `classifierTelegramChatId`. Anyone who sends `/start` is automatically subscribed to alerts and can use `/stats`, `/runs`, and `/about`; only the configured chat can classify alerts. Pump lookback and scan settings live under `pump` (defaults in [`config.example.js`](config.example.js)):

```javascript
database: {
  url: "libsql://screener-....turso.io",
  authToken: "...",
},
telegramBotToken: "123456789:ABC...",
classifierTelegramChatId: "36772199",
web: {
  port: 80,       // plain HTTP; no HTTPS or external web server
  host: "0.0.0.0",
},
pump: {
  days: 5,        // lookback calendar days for download + scan
  minScore: 80,
  scanCache: true,
},
```

### 2. Build and init the database

```bash
pnpm build
pnpm db:bootstrap
```

Run `pnpm build` again after every code change — PM2 does not rebuild for you.

### 3. Start with PM2

Production runs are defined in [`ecosystem.config.cjs`](ecosystem.config.cjs) at the repo root. It starts three processes:

| PM2 name | What it runs | Role |
|----------|--------------|------|
| `pump-monitor` | `pnpm pump:monitor` | Download → scan → persist pumps → Telegram alerts |
| `pump-bot` | `pnpm pump:bot` | `/stats`, `/runs`, `/about`, and **Pump \| Dump \| None** button clicks |
| `pump-web` | `pnpm pump:web` | Plain HTTP page showing the last 10 stored pumps |

```bash
pm2 start ecosystem.config.cjs
```

<p align="center">
  <img src="docs/assets/pm2-monit.png" alt="pm2 monit dashboard — pump-monitor and pump-bot processes with live pipeline logs" width="900"/>
</p>

PM2 keeps all processes alive. When `pump-monitor` finishes a pipeline run it exits; PM2 immediately starts the next run (`autorestart: true`). That replaces a manual cron loop.

**First run** downloads `pump.days` of candles into `data/market_stats/` — network + disk required; can take hours. Market data is not in the repository.

The web page is served directly by the Node app at `http://<server>/` on port `80` by default. On Linux/macOS, binding port `80` may require running PM2 with sufficient privileges or granting Node permission to bind low ports; change `web.port` or `PORT` only if you intentionally want a non-standard port.

Persist PM2 across reboots:

```bash
pm2 save
pm2 startup   # follow the printed command (once per server)
```

## PM2 day-to-day

```bash
pm2 status
pm2 logs                          # all apps
pm2 logs pump-monitor             # download + scan pipeline
pm2 logs pump-bot                 # Telegram bot
pm2 logs pump-web                 # HTTP page

pm2 restart ecosystem.config.cjs  # after config.js or code changes (rebuild first)
pm2 restart pump-monitor          # restart pipeline only
pm2 restart pump-bot              # restart bot only
pm2 restart pump-web              # restart HTTP page only

pm2 stop ecosystem.config.cjs
pm2 delete ecosystem.config.cjs
```

After editing `config.js`, restart the affected process (`pm2 restart pump-monitor`, `pump-bot`, or `pump-web`). No PM2 reload is needed for config-only changes if you restart.

**Classification buttons** need `pump-bot` running — it is included in `ecosystem.config.cjs`, not optional in production.

## What `pump-monitor` does

Each PM2-driven run is an end-to-end pipeline:

1. **Download** — last `pump.days` of 1m/5m candles from **Binance and Bybit** (archives + REST fallback). See [docs/fetch_all.md](docs/fetch_all.md).
2. **Scan** — pump/dump detection; output `data/market_stats/reports/pump_events.ndjson`.
3. **Persist + alert** — upsert pump episodes to Turso; Telegram message per **new** pump (`coin|pump_start_utc`).

On disk: `data/market_stats/` (`archives/`, `api_fallback/raw/`, `reports/`). Cached series are skipped on repeat runs.

Alerts sent to `classifierTelegramChatId` have **Pump | Dump | None** buttons. `pump-bot` verifies the callback came from that chat before writing `pumps.classification`; other subscribers receive the same alerts without classification buttons.

<p align="center">
  <img src="docs/assets/telegram-bot-alert.png" alt="Telegram bot — pump alert with peak score, window, TradingView link, and /stats /runs /about commands" width="400"/>
</p>

Turso bootstrap (one-time):

```bash
turso db create screener
turso db show screener --url
turso db tokens create screener
pnpm db:bootstrap
```

Telegram details: [docs/telegram_setup.md](docs/telegram_setup.md).

### Scan cache

Per-coin results under `data/market_stats/reports/scan_cache/` (override with `--cache-dir` on the underlying CLI). Entries are reused when detector version, scan params, window start, and loaded candle identity per exchange are unchanged — not file mtimes. New 5m bars trigger an **incremental tail rescan** (~400 bars); UTC midnight window rolls trigger a full rescan.

Disable cache: set `pump.scanCache: false` in `config.js`, or delete `scan_cache/`, then `pm2 restart pump-monitor`.

Scanning uses a **worker thread pool** (auto-detected CPU cores). Production scan step uses compiled `dist/cli.js` with native worker threads (required on Linux/VDS).

### One-off CLI flags

The pipeline CLIs accept flags if you need a single manual run (debugging only):

```bash
pnpm pump:monitor -- --no-telegram --cache-dir /path/to/cache
```

Normal operation should stay on PM2.

## Diagnostics

**Local cache coverage** — how complete on-disk data is for the lookback window:

```bash
pnpm report:coverage
pnpm report:coverage -- --exchanges binance --days 7
pnpm report:coverage -- --start 2026-06-03T00:00:00Z --end 2026-06-04T00:00:00Z --json
```

Example output:

```
Window: 2026-06-03 → 2026-06-04 (1 days), intervals 5m
For all coins present on exchange: Binance 82.9% cached (1133/1367), Bybit 80.0% cached (...)
```

Useful flags: `--days`, `--exchanges`, `--quote-currencies`, `--discover`, `--json`.

## Workspace layout

- `ecosystem.config.cjs` — PM2 process definitions (`pump-monitor`, `pump-bot`, `pump-web`)
- `config.js` — Turso, Telegram bot token, `pump.*`, `fetch.intervals` (copy from `config.example.js`)
- `packages/core` — HTTP client, config, pull window
- `packages/exchanges` — exchange adapters
- `packages/storage` — NDJSON, gaps, manifest I/O
- `packages/universe` — symbol universe and task resolution
- `packages/archive` — archive planners and download runner
- `apps/fetch-market-archives` — universe archive pull CLI (+ coverage reports)
- `packages/db` — screener database (Turso/libSQL)
- `packages/pump-detector` — pump regime detection ([PUMP_DETECTION_RULES.md](PUMP_DETECTION_RULES.md))
- `apps/run-pump-detector` — scan worker pool and `pump_events.ndjson`
- `apps/pump-monitor` — fetch + scan + Turso + Telegram alerts + HTTP pump page
- `apps/fetch-market-stats` — REST candle pull CLI (standalone; not used by `pump-monitor`)
