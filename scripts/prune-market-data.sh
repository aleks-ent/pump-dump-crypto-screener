#!/usr/bin/env bash
# Prune cached market data and detector run logs under data/market_stats.
# Dry-run by default; pass --apply to delete.
#
#   RETAIN_DAYS      keep date= partitions newer than this (default 60)
#   RUN_RETAIN_DAYS  keep reports/pump_detector run dirs newer than this (default 2)
#   DATA_DIR         market data root (default data/market_stats)

set -euo pipefail

DATA_DIR="${DATA_DIR:-data/market_stats}"
RETAIN_DAYS="${RETAIN_DAYS:-60}"
RUN_RETAIN_DAYS="${RUN_RETAIN_DAYS:-2}"

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

if [ ! -d "$DATA_DIR" ]; then
  echo "no such data dir: $DATA_DIR" >&2
  exit 1
fi

days_ago() {
  date -u -d "$1 days ago" +%F 2>/dev/null || date -u -v-"$1"d +%F
}

cutoff="$(days_ago "$RETAIN_DAYS")"
run_cutoff="$(days_ago "$RUN_RETAIN_DAYS")"

targets="$(mktemp)"
trap 'rm -f "$targets"' EXIT

# Candle partitions: archives/, api_fallback/raw/, extracted/raw/ all carry a
# date=YYYY-MM-DD component. -prune so we never descend into a doomed partition.
for root in archives api_fallback extracted; do
  [ -d "$DATA_DIR/$root" ] || continue
  find "$DATA_DIR/$root" -type d -name 'date=*' -prune -print
done | awk -v c="$cutoff" '{ d = $0; sub(/.*date=/, "", d); if (d < c) print }' >>"$targets"

# Per-run detector output: written every pipeline run, never read back.
if [ -d "$DATA_DIR/reports/pump_detector" ]; then
  find "$DATA_DIR/reports/pump_detector" -mindepth 1 -maxdepth 1 -type d -print |
    awk -v c="$run_cutoff" '{ n = $0; sub(/.*\//, "", n); sub(/T.*/, "", n); if (n < c) print }' >>"$targets"
fi

count="$(wc -l <"$targets" | tr -d ' ')"
if [ "$count" -eq 0 ]; then
  echo "Nothing to prune (candles before $cutoff, runs before $run_cutoff)."
  exit 0
fi

size_mb="$(tr '\n' '\0' <"$targets" | xargs -0 du -sk 2>/dev/null | awk '{s+=$1} END {printf "%d", s/1024}')"

echo "Data dir:    $DATA_DIR"
echo "Candles:     drop date= partitions before $cutoff (keep ${RETAIN_DAYS}d)"
echo "Run logs:    drop pump_detector runs before $run_cutoff (keep ${RUN_RETAIN_DAYS}d)"
echo "Matched:     $count directories, ${size_mb} MB"

if [ "$APPLY" -eq 0 ]; then
  echo
  echo "Dry run. Sample:"
  head -20 "$targets" | sed 's/^/  /'
  echo
  echo "Re-run with --apply to delete."
  exit 0
fi

tr '\n' '\0' <"$targets" | xargs -0 rm -rf --
find "$DATA_DIR/archives" "$DATA_DIR/api_fallback" "$DATA_DIR/extracted" \
  -mindepth 1 -type d -empty -delete 2>/dev/null || true

echo "Deleted $count directories (~${size_mb} MB)."
