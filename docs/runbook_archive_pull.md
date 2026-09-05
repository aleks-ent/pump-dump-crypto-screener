# Runbook: Universe Archive Pull

## Purpose

Download 1m and 5m kline **archives** for instruments listed in `symbol_universe.json` from **Binance and Bybit** (same CLI and multi-process runner for each). The script stops per series once data for the requested window is satisfied on disk. **REST klines** fill individual missing archive days, spot-only series (Bybit spot), and **today’s partial UTC day** through `--end` (default: now).

## Prerequisites

Requires **Node.js 20+** and **pnpm**. Run from the repository root.

```bash
pnpm install
pnpm build
```

## Commands

### All exchanges (recommended)

Fetch **Binance and Bybit** for the last **N calendar days** of coverage. Series already on disk (archives + REST for gaps and today) are **not** re-downloaded. Uses one shared time window for the whole run.

```bash
pnpm fetch:all -- 5
```

Only **days** is required (positional, or `--days 5`). Everything else is optional with defaults: USDT quotes, 1m/5m, `data/market_stats`, REST fallback on. Per-exchange workers: Binance 16, Bybit 8 (`--processes` overrides all).

If `symbol_universe.json` is missing, `fetch:all` discovers currently listed USDT spot/futures on the selected exchanges and writes the file before fetching.

### Window semantics (`--days N`)

When `--start` / `--end` are omitted, the lookback is **calendar-based in UTC**:

| Component | Range | Source |
|-----------|--------|--------|
| Prior days | `[today − (N−1) days at 00:00 UTC, today 00:00 UTC)` | Daily/monthly **archives** (Binance CDN; Bybit when enabled) |
| Today | `[today 00:00 UTC, now)` | **REST** klines |

Example: `pnpm fetch:all -- 5` on `2026-06-06T15:00:00Z` fetches archive zips for **2026-06-02 … 2026-06-05** and REST for **2026-06-06 00:00 → 15:00**.

`--days 1` means **today only** (REST). Explicit `--start` / `--end` still use the exact ISO range (rolling/custom windows for backfills).

### Single-process CLI (all exchanges in one process, no symbol sharding)

Full pull with parallel workers (default 8 series + 4 files per series). Default quote is **USDT** (spot and USDT-margined futures only):

```bash
pnpm fetch:archives -- \
  --universe data/market_stats/reports/symbol_universe.json \
  --output data/market_stats \
  --workers 8 --file-workers 4 --max-downloads 32
```

Tune parallelism:

- `--workers` — series in parallel (symbol × interval tasks)
- `--file-workers` — daily/monthly archive files per series in parallel
- `--max-downloads` — global HTTP download cap across all concurrent downloads

By default, series are **skipped** when archives plus any required REST fallback for the window already exist on disk (no re-download). For REST days, skip checks also verify the **last candle** in each day's `data.ndjson` reaches the end of that day's slice (so a truncated **today** file is re-fetched on the next run). Use `--no-skip-existing` to force a full re-fetch.

**REST fallback strategy:** after archive downloads, the runner requests REST klines only for (1) **missing archive days** in the planned window and (2) **today’s partial day** through `--end`. It does **not** re-fetch the full window when a single archive 404s. Disable REST entirely with `--no-fallback` (archives only).

Custom window:

```bash
pnpm fetch:archives -- \
  --start 2026-04-01T00:00:00Z \
  --end 2026-05-01T00:00:00Z
```

Archive-only (no REST fallback):

```bash
pnpm fetch:archives -- --no-fallback
```

### Multi-process per exchange (recommended for Binance)

Spawns **N separate Node processes**, each handling a shard of symbols (all 1m/5m series per symbol). Default window is **5 days** when `--start` / `--end` are omitted.

```bash
# Binance: 16 parallel workers, last 5 days, USDT universe
pnpm fetch:archives:exchange -- --exchange binance --processes 16

# Bybit
pnpm fetch:archives:exchange -- --exchange bybit --processes 8
```

Per-worker tuning: `--file-workers` (per series), `--max-downloads` (per process). Gap records are written per exchange-specific shard, merged into the current-run `archive_gaps.ndjson`, then the shard files are removed.

## Output layout

- `data/market_stats/archives/` — downloaded zip/csv.gz files
- `data/market_stats/api_fallback/raw/` — REST fallback rows (same ndjson schema as API pull); writes dedupe on `open_time_ms` per day file
- `data/market_stats/reports/archive_run_manifest.json` — run summary
- `data/market_stats/reports/archive_gaps.ndjson` — 404 / missing archive URLs
- `data/market_stats/reports/instrument_index.json` — canonical → native mapping cache

## Exchange notes (same behavior per exchange)

| Exchange | Archive source | REST fallback |
|----------|----------------|---------------|
| Binance | [data.binance.vision](https://data.binance.vision) daily kline zips | **Per missing archive day**; **today** from 00:00 UTC through `--end` |
| Bybit | [public.bybit.com](https://public.bybit.com) `kline_for_metatrader4` | Linear/inverse: archives + per-gap/today REST when CDN works. If you see **403**, set `bybit_skip_public_archives: true` in `config/archives.yaml` (default **true**) to use **REST klines only** via `api.bybit.com`. Spot always uses REST. |

Skip-existing and multi-process `fetch:archives:exchange` work the same for `binance` and `bybit`.

## Related

- How `pump:monitor` uses `fetch:all` (step-by-step): [fetch_all.md](fetch_all.md)
- Discovery-based REST pull: [runbook_market_pull.md](runbook_market_pull.md)
- Data dictionary: [data_dictionary.md](data_dictionary.md)
