import type {
  StoredPump,
  TelegramSubscriberHistoryPoint,
} from "@screener/db";
import { formatBytes, type DiskSpace } from "./disk-space.js";

export interface IndexPageOptions {
  pumps: StoredPump[];
  subscriberHistory: TelegramSubscriberHistoryPoint[];
  generatedAt?: Date;
  disk?: DiskSpace | null;
}

interface ChartPoint extends TelegramSubscriberHistoryPoint {
  timestamp: number;
  x: number;
  y: number;
}

const CHART_WIDTH = 960;
const CHART_HEIGHT = 360;
const CHART_MARGIN = { top: 24, right: 24, bottom: 52, left: 64 };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

function fmtChartDate(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(ms);
}

function fmtChartDateTime(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(ms);
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function classificationText(pump: StoredPump): string {
  switch (pump.classification) {
    case "pump":
      return "Pump";
    case "dump":
      return "Dump";
    case "none":
      return "None";
    default:
      return "Unclassified";
  }
}

function renderPumpRow(pump: StoredPump): string {
  const chartUrl = safeHttpUrl(pump.tradingViewUrl);
  const exchanges =
    pump.confirmedExchanges.length > 0
      ? pump.confirmedExchanges.join(", ")
      : pump.leadingExchange;
  return `
        <tr class="border-b border-zinc-100 last:border-0">
          <td class="whitespace-nowrap px-4 py-3 font-medium text-zinc-950">${escapeHtml(pump.coin)}</td>
          <td class="whitespace-nowrap px-4 py-3 text-zinc-700">${fmtUtc(pump.startMs)} UTC</td>
          <td class="whitespace-nowrap px-4 py-3">
            <span class="inline-flex min-w-12 justify-center rounded-md bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">${pump.peakScore}</span>
          </td>
          <td class="whitespace-nowrap px-4 py-3 text-zinc-700">${fmtDuration(pump.durationMinutes)}</td>
          <td class="whitespace-nowrap px-4 py-3 text-zinc-700">${escapeHtml(exchanges)}</td>
          <td class="whitespace-nowrap px-4 py-3 text-zinc-700">${escapeHtml(classificationText(pump))}</td>
          <td class="whitespace-nowrap px-4 py-3">${
            chartUrl
              ? `<a class="font-medium text-emerald-700 hover:text-emerald-900" href="${escapeHtml(chartUrl)}">TradingView</a>`
              : `<span class="text-zinc-400">Unavailable</span>`
          }</td>
        </tr>`;
}

function renderDiskSpace(disk: DiskSpace | null): string {
  if (!disk) {
    return `<p class="mt-1 text-sm text-zinc-500">Disk usage unavailable</p>`;
  }

  const freePercent = disk.totalBytes > 0 ? (disk.freeBytes / disk.totalBytes) * 100 : 0;
  const barColor =
    freePercent < 5 ? "bg-red-500" : freePercent < 15 ? "bg-amber-500" : "bg-emerald-500";
  const textColor =
    freePercent < 5 ? "text-red-700" : freePercent < 15 ? "text-amber-700" : "text-zinc-600";

  return `<div class="mt-1 flex items-center gap-3">
          <p class="text-sm ${textColor}">${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)} (${disk.usedPercent}% used)</p>
          <div class="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-200"><div class="h-full ${barColor}" style="width:${disk.usedPercent}%"></div></div>
        </div>`;
}

function renderPumpsPanel(pumps: StoredPump[], disk: DiskSpace | null): string {
  const rows =
    pumps.length > 0
      ? pumps.map((pump) => renderPumpRow(pump)).join("\n")
      : `
        <tr>
          <td colspan="7" class="px-4 py-8 text-center text-sm text-zinc-500">No pumps stored yet.</td>
        </tr>`;

  return `<section id="panel-pumps" role="tabpanel" aria-labelledby="tab-pumps" tabindex="0">
      <div class="mb-4">
        <h2 class="text-lg font-semibold">Latest detected pumps</h2>
        <p class="mt-1 text-sm text-zinc-600">The 10 most recent stored pump episodes.</p>
        ${renderDiskSpace(disk)}
      </div>
      <div class="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div class="overflow-x-auto">
          <table class="min-w-full text-left text-sm">
            <thead class="border-b border-zinc-200 bg-zinc-100 text-xs uppercase text-zinc-600">
              <tr>
                <th class="px-4 py-3 font-semibold">Coin</th>
                <th class="px-4 py-3 font-semibold">Start</th>
                <th class="px-4 py-3 font-semibold">Score</th>
                <th class="px-4 py-3 font-semibold">Duration</th>
                <th class="px-4 py-3 font-semibold">Exchange</th>
                <th class="px-4 py-3 font-semibold">Classification</th>
                <th class="px-4 py-3 font-semibold">Chart</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-100">
${rows}
            </tbody>
          </table>
        </div>
      </div>
    </section>`;
}

function normalizedHistory(
  history: TelegramSubscriberHistoryPoint[],
): Array<TelegramSubscriberHistoryPoint & { timestamp: number }> {
  return history
    .map((point) => ({
      occurredAt: point.occurredAt,
      count: Math.max(0, Math.round(point.count)),
      timestamp: Date.parse(point.occurredAt),
    }))
    .filter((point) => Number.isFinite(point.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function renderSubscriberChart(history: TelegramSubscriberHistoryPoint[]): string {
  const normalized = normalizedHistory(history);
  if (normalized.length === 0) {
    return `<div class="flex min-h-80 flex-col items-center justify-center px-6 text-center" data-subscriber-chart-empty>
      <div class="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-2xl text-emerald-700" aria-hidden="true">↗</div>
      <h3 class="mt-4 font-semibold text-zinc-900">No subscriber history yet</h3>
      <p class="mt-1 max-w-md text-sm text-zinc-500">The chart will appear after the bot records its first subscriber.</p>
    </div>`;
  }

  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const plotBottom = CHART_MARGIN.top + plotHeight;
  const firstTimestamp = normalized[0]!.timestamp;
  const lastTimestamp = normalized.at(-1)!.timestamp;
  const timeSpan = lastTimestamp - firstTimestamp;
  const maximumCount = Math.max(1, ...normalized.map((point) => point.count));
  const points: ChartPoint[] = normalized.map((point) => ({
    ...point,
    x:
      timeSpan === 0
        ? CHART_MARGIN.left + plotWidth / 2
        : CHART_MARGIN.left + ((point.timestamp - firstTimestamp) / timeSpan) * plotWidth,
    y: CHART_MARGIN.top + (1 - point.count / maximumCount) * plotHeight,
  }));

  const linePath = points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    return `${path} H ${point.x.toFixed(2)} V ${point.y.toFixed(2)}`;
  }, "");
  const firstPoint = points[0]!;
  const lastPoint = points.at(-1)!;
  const areaPath = `${linePath} L ${lastPoint.x.toFixed(2)} ${plotBottom} L ${firstPoint.x.toFixed(2)} ${plotBottom} Z`;

  const yTickValues = [
    ...new Set([
      0,
      Math.round(maximumCount / 3),
      Math.round((maximumCount * 2) / 3),
      maximumCount,
    ]),
  ].sort((a, b) => a - b);
  const yTicks = yTickValues
    .map((value) => {
      const y = CHART_MARGIN.top + (1 - value / maximumCount) * plotHeight;
      return `<g class="chart-grid-line">
        <line x1="${CHART_MARGIN.left}" x2="${CHART_WIDTH - CHART_MARGIN.right}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}"></line>
        <text x="${CHART_MARGIN.left - 12}" y="${(y + 4).toFixed(2)}" text-anchor="end">${value.toLocaleString("en-US")}</text>
      </g>`;
    })
    .join("\n");

  const xTickIndices = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const xTicks = xTickIndices
    .map((index) => {
      const point = points[index]!;
      const textAnchor =
        points.length === 1
          ? "middle"
          : index === 0
            ? "start"
            : index === points.length - 1
              ? "end"
              : "middle";
      return `<g class="chart-axis-label">
        <line x1="${point.x.toFixed(2)}" x2="${point.x.toFixed(2)}" y1="${plotBottom}" y2="${plotBottom + 6}"></line>
        <text x="${point.x.toFixed(2)}" y="${plotBottom + 28}" text-anchor="${textAnchor}">${escapeHtml(fmtChartDate(point.timestamp))}</text>
      </g>`;
    })
    .join("\n");

  const markers = points
    .map((point) => {
      const label = `${fmtChartDateTime(point.timestamp)}: ${point.count.toLocaleString("en-US")} subscriber${point.count === 1 ? "" : "s"}`;
      return `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="4" data-subscriber-point data-occurred-at="${escapeHtml(point.occurredAt)}" data-count="${point.count}"><title>${escapeHtml(label)}</title></circle>`;
    })
    .join("\n");

  return `<div class="overflow-x-auto" data-subscriber-chart>
      <svg class="subscriber-chart min-w-[640px]" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-labelledby="subscriber-chart-title subscriber-chart-description">
        <title id="subscriber-chart-title">Telegram bot subscriber count over time</title>
        <desc id="subscriber-chart-description">Subscriber count changed from ${firstPoint.count.toLocaleString("en-US")} to ${lastPoint.count.toLocaleString("en-US")} between ${escapeHtml(fmtChartDateTime(firstTimestamp))} and ${escapeHtml(fmtChartDateTime(lastTimestamp))}.</desc>
        ${yTicks}
        <line class="chart-axis" x1="${CHART_MARGIN.left}" x2="${CHART_MARGIN.left}" y1="${CHART_MARGIN.top}" y2="${plotBottom}"></line>
        <line class="chart-axis" x1="${CHART_MARGIN.left}" x2="${CHART_WIDTH - CHART_MARGIN.right}" y1="${plotBottom}" y2="${plotBottom}"></line>
        ${xTicks}
        <path class="chart-area" d="${areaPath}"></path>
        <path class="chart-line" d="${linePath}"></path>
        <g class="chart-markers">${markers}</g>
      </svg>
    </div>`;
}

function renderSubscribersPanel(history: TelegramSubscriberHistoryPoint[]): string {
  const normalized = normalizedHistory(history);
  const currentCount = normalized.at(-1)?.count ?? 0;
  const firstSeen = normalized[0]?.timestamp;
  const rangeText =
    firstSeen == null
      ? "Waiting for the first event"
      : `Tracking since ${fmtChartDate(firstSeen)} UTC`;

  return `<section id="panel-subscribers" role="tabpanel" aria-labelledby="tab-subscribers" tabindex="0" hidden>
      <div class="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 class="text-lg font-semibold">Subscriber history</h2>
          <p class="mt-1 text-sm text-zinc-600">Active Telegram bot subscribers over time.</p>
        </div>
        <div class="min-w-48 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3" data-active-subscriber-count="${currentCount}">
          <p class="text-xs font-semibold uppercase tracking-wide text-emerald-800">Active subscribers</p>
          <p class="mt-1 text-3xl font-semibold text-emerald-950">${currentCount.toLocaleString("en-US")}</p>
          <p class="mt-1 text-xs text-emerald-800">${escapeHtml(rangeText)}</p>
        </div>
      </div>
      <div class="overflow-hidden rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
        ${renderSubscriberChart(history)}
      </div>
    </section>`;
}

const TAB_CLIENT_SCRIPT = `(() => {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const activate = (tab, focus) => {
    tabs.forEach((candidate) => {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      const panelId = candidate.getAttribute('aria-controls');
      const panel = panelId ? document.getElementById(panelId) : null;
      if (panel) panel.hidden = !selected;
    });
    if (focus) tab.focus();
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab, false));
    tab.addEventListener('keydown', (event) => {
      let nextIndex = null;
      if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = tabs.length - 1;
      if (nextIndex == null) return;
      event.preventDefault();
      activate(tabs[nextIndex], true);
    });
  });
})();`;

export function renderIndexPage(options: IndexPageOptions): string {
  const generatedAt = options.generatedAt ?? new Date();
  const disk = options.disk ?? null;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pump Monitor</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    [role="tab"]{border-bottom:2px solid transparent;color:#52525b}
    [role="tab"]:hover{color:#18181b}
    [role="tab"][aria-selected="true"]{border-bottom-color:#047857;color:#065f46}
    [role="tab"]:focus-visible,[role="tabpanel"]:focus-visible{outline:2px solid #059669;outline-offset:3px}
    .subscriber-chart{display:block;width:100%;height:auto}
    .chart-grid-line line{stroke:#e4e4e7;stroke-width:1;vector-effect:non-scaling-stroke}
    .chart-grid-line text,.chart-axis-label text{fill:#71717a;font:12px ui-sans-serif,system-ui,sans-serif}
    .chart-axis,.chart-axis-label line{stroke:#a1a1aa;stroke-width:1;vector-effect:non-scaling-stroke}
    .chart-area{fill:#d1fae5;opacity:.7}
    .chart-line{fill:none;stroke:#047857;stroke-linejoin:round;stroke-width:3;vector-effect:non-scaling-stroke}
    .chart-markers circle{fill:#fff;stroke:#047857;stroke-width:2;vector-effect:non-scaling-stroke}
  </style>
</head>
<body class="bg-zinc-50 text-zinc-950">
  <main class="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
    <header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold">Pump Monitor</h1>
        <p class="mt-1 text-sm text-zinc-600">Updated ${fmtUtc(generatedAt.getTime())} UTC</p>
      </div>
      <a class="inline-flex h-9 w-fit items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-100" href="/">Refresh</a>
    </header>

    <div class="mb-6 border-b border-zinc-200">
      <div class="flex gap-6" role="tablist" aria-label="Dashboard sections">
        <button class="px-1 pb-3 text-sm font-semibold" id="tab-pumps" type="button" role="tab" aria-controls="panel-pumps" aria-selected="true">Last 10 Pumps</button>
        <button class="px-1 pb-3 text-sm font-semibold" id="tab-subscribers" type="button" role="tab" aria-controls="panel-subscribers" aria-selected="false" tabindex="-1">Subscribers</button>
      </div>
    </div>

    ${renderPumpsPanel(options.pumps, disk)}
    ${renderSubscribersPanel(options.subscriberHistory)}
  </main>
  <script>${TAB_CLIENT_SCRIPT}</script>
</body>
</html>`;
}
