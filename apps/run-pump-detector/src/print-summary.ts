import type { PumpEpisode, EpisodeStats } from "@screener/pump-detector";

const useColor = process.stdout.isTTY;

const c = {
  reset: useColor ? "\x1b[0m" : "",
  dim: useColor ? "\x1b[2m" : "",
  bold: useColor ? "\x1b[1m" : "",
  green: useColor ? "\x1b[32m" : "",
  red: useColor ? "\x1b[31m" : "",
  yellow: useColor ? "\x1b[33m" : "",
  cyan: useColor ? "\x1b[36m" : "",
  magenta: useColor ? "\x1b[35m" : "",
};

function fmtUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtExchanges(ep: PumpEpisode): string {
  const leader = ep.leadingExchange;
  const peers = ep.confirmedExchanges.filter((ex) => ex !== leader);
  if (peers.length === 0) return leader;
  return `${leader} (+${peers.join(",")})`;
}

function pad(s: string, n: number): string {
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  if (visible.length >= n) return s.slice(0, n + (s.length - visible.length));
  return s + " ".repeat(n - visible.length);
}

function line(width: number, char = "─"): string {
  return char.repeat(width);
}

export function printEpisodeSummary(
  episodes: PumpEpisode[],
  stats: EpisodeStats,
  opts: { limit: number; rawOutputPath: string; write?: (line: string) => void },
): void {
  const out = opts.write ?? ((line: string) => console.log(line));
  const width = 96;
  const shown = opts.limit > 0 ? episodes.slice(0, opts.limit) : episodes;
  const hidden = episodes.length - shown.length;

  out("");
  out(`${c.cyan}╭${line(width - 2, "─")}╮${c.reset}`);
  out(
    `${c.cyan}│${c.reset}${c.bold}  PUMP / DUMP SUMMARY${c.reset}` +
      pad(
        `  ${stats.totalEpisodes} episodes · ${stats.rawEventCount.toLocaleString()} raw candle hits`,
        width - 22 - String(stats.totalEpisodes).length - String(stats.rawEventCount).length,
      ) +
      `${c.cyan}│${c.reset}`,
  );
  out(`${c.cyan}╰${line(width - 2, "─")}╯${c.reset}`);
  out("");
  out(
    `  ${c.dim}Window stats:${c.reset}  ` +
      `${c.green}${stats.pumpEpisodes} pump episodes${c.reset} across ${stats.coinsWithPump} coins  ·  ` +
      `${c.red}${stats.dumpEpisodes} dump episodes${c.reset} across ${stats.coinsWithDump} coins`,
  );
  out(`  ${c.dim}Raw detail:${c.reset}     ${opts.rawOutputPath}`);
  out("");

  if (shown.length === 0) {
    out(`  ${c.dim}No pump or dump episodes detected.${c.reset}`);
    out("");
    return;
  }

  const hdrCoin = 18;
  const hdrType = 6;
  const hdrStart = 18;
  const hdrEnd = 18;
  const hdrDur = 8;
  const hdrPeak = 5;
  const hdrEx = 22;

  out(
    `  ${c.bold}${pad("COIN", hdrCoin)} ${pad("TYPE", hdrType)} ${pad("START (UTC)", hdrStart)} ${pad("END (UTC)", hdrEnd)} ${pad("DURATION", hdrDur)} ${pad("PEAK", hdrPeak)} EXCHANGES${c.reset}`,
  );
  out(`  ${c.dim}${line(hdrCoin + hdrType + hdrStart + hdrEnd + hdrDur + hdrPeak + hdrEx + 6, "─")}${c.reset}`);

  for (const ep of shown) {
    const peakColor =
      ep.peakScore >= 70 ? c.magenta : ep.peakScore >= 55 ? c.yellow : c.dim;
    const typeCol =
      ep.type === "pump"
        ? `${c.green}${c.bold}PUMP${c.reset}`
        : `${c.red}${c.bold}DUMP${c.reset}`;
    out(
      `  ${pad(ep.coin, hdrCoin)} ${typeCol}  ` +
        `${pad(fmtUtc(ep.startMs), hdrStart)} ${pad(fmtUtc(ep.endMs), hdrEnd)} ` +
        `${pad(fmtDuration(ep.durationMinutes), hdrDur)} ` +
        `${peakColor}${pad(String(ep.peakScore), hdrPeak)}${c.reset}  ` +
        `${fmtExchanges(ep)}`,
    );
    out(`  ${c.dim}Chart:${c.reset} ${c.cyan}${ep.tradingViewUrl}${c.reset}`);
    out(`  ${c.dim}Scroll to ${fmtUtc(ep.startMs)} UTC (episode start)${c.reset}`);
  }

  if (hidden > 0) {
    out("");
    out(
      `  ${c.dim}… and ${hidden} more episode(s). Full candle-level log: ${opts.rawOutputPath}${c.reset}`,
    );
  }
  out("");
}
