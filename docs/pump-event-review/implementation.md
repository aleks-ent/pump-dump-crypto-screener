# Pump Event Review: Operator Guide

This guide covers the production setup and release checks for the internal pump-event
reviewer. The reviewer uses the screener's existing Turso database and locally stored
Binance/Bybit candle history.

## Setup

Requirements are Node.js 20+, pnpm 9+, a configured Turso database, and enough local
disk space for the requested market-data window.

```bash
pnpm install --frozen-lockfile
cp config.example.js config.js
pnpm build
pnpm db:bootstrap
```

Set `database.url` and `database.authToken` in the untracked `config.js`. Keep the
default local bind unless an authenticated HTTPS reverse proxy is ready:

```js
web: {
  host: "127.0.0.1",
  port: 3000,
}
```

Start the web process locally with `pnpm pump:web`. The workspace is available at
`http://127.0.0.1:3000/review`; `GET /healthz` is the process health check.

## Database schema and migrations

Apply schema changes before deploying the new web build:

```bash
pnpm db:bootstrap
```

The schema operation is designed to be repeatable. The web process also applies the
schema defensively during startup, but an explicit bootstrap makes migration failures
visible before traffic is switched. Back up the production database according to the
Turso retention policy before the first production migration.

After migration, verify that an existing pump can be opened, an annotation can be
created, and the same annotation can be edited without producing a duplicate row.

## Historical market data

Charts read local files under `data/market_stats/`; they do not retrieve historical
candles during a review request. The event's exchange, native symbol, instrument type,
and timestamp must fall within the locally retained window.

For both chart timeframes, configure:

```js
fetch: {
  intervals: ["1m", "5m"],
},
```

The normal `pnpm pump:monitor` pipeline refreshes the configured lookback before it
scans. To prepare or repair the local history independently, use `pnpm fetch:all` and
inspect coverage with `pnpm report:coverage`. The first download can take hours and
requires network access and substantial disk space. Retain these paths when deploying
or restarting:

- `data/market_stats/archives/`
- `data/market_stats/api_fallback/raw/`
- `data/market_stats/reports/instrument_index.json`
- `data/market_stats/reports/symbol_universe.json`

Missing data should produce an explicit chart state; it must not prevent the reviewer
from assigning or updating a label. Every selected event also provides TradingView 1m
and 5m links derived from the stored exchange, native symbol, and instrument type. If
local candles are unavailable, use either link, set the TradingView chart timezone to
UTC, and press `Alt+G` (`Option+G` on macOS) to open **Go to date**. TradingView uses
separate inputs, so use **Copy date** for the `YYYY-MM-DD` field and **Copy time** for
the `HH:mm` field. TradingView availability and intraday history depth still depend on
the symbol and the reviewer's TradingView plan.

The reviewer UI intentionally omits detector version, detector score, trigger summary,
and detector-specific filters. Those values remain untouched in the source event data
and labeled-data exports for future analysis; they are simply outside the current human
review workflow. Detection time and chart markers remain visible to locate the event.

## Access control

Authentication is optional for a loopback-only deployment. Without credentials, the
web server must remain bound to `127.0.0.1` (or another loopback address). Startup
refuses an unauthenticated non-loopback bind.

For any shared or remotely reachable deployment, provide both credentials through the
process environment:

```bash
export PUMP_REVIEW_AUTH_USERNAME="reviewer"
export PUMP_REVIEW_AUTH_PASSWORD="replace-with-a-long-random-secret"
export PUMP_REVIEW_AUTH_REALM="Pump Event Review"
```

The corresponding `web.reviewAuth.username`, `web.reviewAuth.password`, and
`web.reviewAuth.realm` config values may be used for local configuration, but
environment values take precedence. Do not commit credentials to `config.js` or any
other repository file. Setting only a username or only a password is a startup error.

Basic authentication protects `/review`, `/api/pump-events` and all of its subpaths,
and `/api/market-data/candles`. `/healthz` remains available for monitoring. Basic
authentication does not encrypt credentials, so terminate TLS at nginx (or another
trusted reverse proxy) before allowing remote access. Restrict network ingress to the
smallest practical trusted range and never log the `Authorization` header.

Quick access checks:

```bash
curl -i http://127.0.0.1:3000/review
curl -i -u "$PUMP_REVIEW_AUTH_USERNAME:$PUMP_REVIEW_AUTH_PASSWORD" \
  http://127.0.0.1:3000/api/pump-events/stats
curl -i http://127.0.0.1:3000/healthz
```

With authentication enabled, the first command must return `401` and a
`WWW-Authenticate: Basic` header, while the second and third return `200`.

## Build, deploy, and restart

PM2 runs compiled output and does not rebuild after a pull. Use this order:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm db:bootstrap
pm2 restart pump-web --update-env
pm2 status
pm2 logs pump-web --lines 100
```

Use `--update-env` when credentials or other environment variables changed. Restarting
only `pump-web` avoids interrupting an active download/scan run. Roll back to the prior
application revision if the health check, migration, or smoke test fails; do not roll
back the database by deleting annotation data.

## Release acceptance checklist

- [ ] `pnpm test` and `pnpm build` pass on the release revision.
- [ ] `pnpm db:bootstrap` completes against the target database.
- [ ] `/healthz` returns `200` after restart.
- [ ] An unauthenticated `/review` request returns `401` when auth is enabled.
- [ ] Valid credentials open the review workspace and APIs.
- [ ] The first unreviewed event is selected and its detection marker is visible.
- [ ] Both 1m and 5m candles load around a known historical event.
- [ ] Missing candle history displays a recoverable error without losing form input.
- [ ] TradingView 1m and 5m links open the selected exchange instrument in a new tab.
- [ ] Copy date and Copy time produce values accepted by TradingView's separate UTC fields.
- [ ] Keys `1` through `6` select the exact six-category taxonomy.
- [ ] Save & Next persists category, confidence, and comment, then advances once.
- [ ] A reviewed annotation can be revisited and edited without duplication.
- [ ] Filters, progress totals, next-event behavior, and unsaved-change protection work.
- [ ] No detector version, score, trigger summary, or detector filter is visible in the reviewer.
- [ ] JSON and CSV exports contain the annotation and preserved detector metadata.
- [ ] Keyboard focus order and visible focus states work at desktop and narrow widths.
- [ ] Logs contain useful failures but no database token, password, or Authorization header.
- [ ] The HTTPS proxy, firewall rules, database backup, and rollback owner are confirmed.
