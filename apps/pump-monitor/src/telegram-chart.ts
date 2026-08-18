import sharp from "sharp";
import type { StoredPump } from "@screener/db";
import {
  DEFAULT_REVIEW_CANDLE_CONTEXT_MS,
  loadReviewCandleWindowWithExchangeFallback,
  type ReviewCandleWindow,
} from "./review-candles.js";

const CHART_WIDTH = 1_200;
const CHART_HEIGHT = 720;
const FIVE_MINUTES_MS = 5 * 60_000;
const MIN_AFTER_CONTEXT_MS = 30 * 60_000;
const EVENT_FOLLOWUP_MS = 15 * 60_000;

export interface TelegramChartImage {
  buffer: Buffer;
  filename: string;
  caption: string;
}

export type TelegramChartWindowLoader = (
  request: Parameters<typeof loadReviewCandleWindowWithExchangeFallback>[0],
  storage?: Parameters<typeof loadReviewCandleWindowWithExchangeFallback>[1],
) => Promise<ReviewCandleWindow>;

export interface TelegramChartDependencies {
  loadWindow?: TelegramChartWindowLoader;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rounded(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function formatPrice(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  if (magnitude >= 1) return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (magnitude >= 0.01) return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return value.toPrecision(6).replace(/0+$/, "").replace(/\.$/, "");
}

function formatUtc(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function formatTickUtc(seconds: number): string {
  return new Date(seconds * 1_000).toISOString().slice(11, 16);
}

function validCandle(candle: ReviewCandleWindow["items"][number]): boolean {
  return (
    Number.isFinite(candle.time) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    Number.isFinite(candle.volume) &&
    candle.high >= candle.low
  );
}

/** Render a self-contained 5-minute candlestick chart suitable for rasterizing. */
export function renderTelegramChartSvg(
  event: StoredPump,
  window: ReviewCandleWindow,
): string {
  const candles = window.items.filter(validCandle);
  if (candles.length === 0) {
    throw new Error(`No valid 5-minute candles available for ${event.coin}`);
  }

  const plot = { left: 74, right: 1_104, top: 112, bottom: 526 };
  const volume = { top: 552, bottom: 650 };
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;
  const volumeHeight = volume.bottom - volume.top;
  const firstTime = candles[0]!.time;
  const lastTime = candles[candles.length - 1]!.time + FIVE_MINUTES_MS / 1_000;
  const timeSpan = Math.max(FIVE_MINUTES_MS / 1_000, lastTime - firstTime);
  const rawLow = Math.min(...candles.map((candle) => candle.low));
  const rawHigh = Math.max(...candles.map((candle) => candle.high));
  const rawRange = rawHigh - rawLow;
  const pricePadding = rawRange > 0
    ? rawRange * 0.08
    : Math.max(Math.abs(rawHigh) * 0.01, 0.00000001);
  const priceLow = rawLow - pricePadding;
  const priceHigh = rawHigh + pricePadding;
  const priceRange = priceHigh - priceLow;
  const maxVolume = Math.max(1, ...candles.map((candle) => Math.max(0, candle.volume)));
  const candleWidth = Math.max(3, Math.min(16, (plotWidth / candles.length) * 0.62));

  const xFor = (seconds: number): number =>
    plot.left + ((seconds - firstTime) / timeSpan) * plotWidth;
  const yFor = (price: number): number =>
    plot.bottom - ((price - priceLow) / priceRange) * plotHeight;

  const horizontalGrid: string[] = [];
  for (let index = 0; index <= 5; index += 1) {
    const ratio = index / 5;
    const y = plot.top + ratio * plotHeight;
    const price = priceHigh - ratio * priceRange;
    horizontalGrid.push(
      `<line x1="${plot.left}" y1="${rounded(y)}" x2="${plot.right}" y2="${rounded(y)}" class="grid"/>`,
      `<text x="${plot.right + 14}" y="${rounded(y + 5)}" class="axis">${escapeXml(formatPrice(price))}</text>`,
    );
  }

  const verticalGrid: string[] = [];
  for (let index = 0; index <= 5; index += 1) {
    const ratio = index / 5;
    const x = plot.left + ratio * plotWidth;
    const time = firstTime + ratio * timeSpan;
    verticalGrid.push(
      `<line x1="${rounded(x)}" y1="${plot.top}" x2="${rounded(x)}" y2="${volume.bottom}" class="grid"/>`,
      `<text x="${rounded(x)}" y="680" text-anchor="middle" class="axis">${formatTickUtc(time)}</text>`,
    );
  }

  const eventStart = event.startMs / 1_000;
  const eventEnd = Math.max(eventStart + FIVE_MINUTES_MS / 1_000, event.endMs / 1_000);
  const visibleEventStart = Math.max(firstTime, Math.min(lastTime, eventStart));
  const visibleEventEnd = Math.max(visibleEventStart, Math.min(lastTime, eventEnd));
  const eventStartX = xFor(visibleEventStart);
  const eventEndX = xFor(visibleEventEnd);
  const eventOverlay = eventEndX > eventStartX
    ? `<rect x="${rounded(eventStartX)}" y="${plot.top}" width="${rounded(eventEndX - eventStartX)}" height="${volume.bottom - plot.top}" class="event-window"/>`
    : "";
  const eventMarker = eventStart >= firstTime && eventStart <= lastTime
    ? [
        `<line x1="${rounded(eventStartX)}" y1="${plot.top}" x2="${rounded(eventStartX)}" y2="${volume.bottom}" class="event-marker"/>`,
        `<rect x="${rounded(Math.min(eventStartX + 7, plot.right - 92))}" y="119" width="85" height="24" rx="6" class="marker-label-bg"/>`,
        `<text x="${rounded(Math.min(eventStartX + 15, plot.right - 84))}" y="136" class="marker-label">DETECTED</text>`,
      ].join("")
    : "";

  const candleShapes = candles.map((candle) => {
    const x = xFor(candle.time + FIVE_MINUTES_MS / 2_000);
    const openY = yFor(candle.open);
    const closeY = yFor(candle.close);
    const highY = yFor(candle.high);
    const lowY = yFor(candle.low);
    const up = candle.close >= candle.open;
    const className = up ? "up" : "down";
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(2, Math.abs(closeY - openY));
    const volumeBarHeight = (Math.max(0, candle.volume) / maxVolume) * volumeHeight;
    return [
      `<line x1="${rounded(x)}" y1="${rounded(highY)}" x2="${rounded(x)}" y2="${rounded(lowY)}" class="wick ${className}"/>`,
      `<rect x="${rounded(x - candleWidth / 2)}" y="${rounded(bodyTop)}" width="${rounded(candleWidth)}" height="${rounded(bodyHeight)}" rx="1" class="body ${className}"/>`,
      `<rect x="${rounded(x - candleWidth / 2)}" y="${rounded(volume.bottom - volumeBarHeight)}" width="${rounded(candleWidth)}" height="${rounded(volumeBarHeight)}" rx="1" class="volume ${className}"/>`,
    ].join("");
  });

  const typeLabel = event.episodeType === "dump" ? "DUMP" : "PUMP";
  const typeClass = event.episodeType === "dump" ? "badge-down" : "badge-up";
  const subtitle = `${window.exchange.toUpperCase()} · ${event.symbolNative} · 5-minute candles · detected ${formatUtc(event.startMs)}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}">
  <style>
    text { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .title { fill: #f8fafc; font-size: 29px; font-weight: 700; }
    .subtitle { fill: #94a3b8; font-size: 16px; }
    .axis { fill: #94a3b8; font-size: 13px; }
    .grid { stroke: #263449; stroke-width: 1; }
    .wick { stroke-width: 2; }
    .body.up, .wick.up { fill: #22c55e; stroke: #22c55e; }
    .body.down, .wick.down { fill: #ef4444; stroke: #ef4444; }
    .volume { opacity: 0.42; }
    .volume.up { fill: #22c55e; }
    .volume.down { fill: #ef4444; }
    .event-window { fill: #f59e0b; opacity: 0.08; }
    .event-marker { stroke: #fbbf24; stroke-width: 2; stroke-dasharray: 7 6; }
    .marker-label-bg { fill: #f59e0b; }
    .marker-label { fill: #111827; font-size: 12px; font-weight: 800; letter-spacing: 0.5px; }
    .badge { fill: #07111f; font-size: 13px; font-weight: 800; letter-spacing: 1px; }
    .badge-up { fill: #22c55e; }
    .badge-down { fill: #ef4444; }
  </style>
  <rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="#09111f"/>
  <rect x="54" y="94" width="1096" height="580" rx="14" fill="#0d1829" stroke="#263449"/>
  <text x="58" y="49" class="title">${escapeXml(event.coin)} · ${escapeXml(typeLabel)} · peak ${escapeXml(String(event.peakScore))}</text>
  <text x="58" y="77" class="subtitle">${escapeXml(subtitle)}</text>
  <rect x="1052" y="29" width="98" height="31" rx="15.5" class="${typeClass}"/>
  <text x="1101" y="50" text-anchor="middle" class="badge">${typeLabel}</text>
  ${horizontalGrid.join("")}
  ${verticalGrid.join("")}
  ${eventOverlay}
  ${candleShapes.join("")}
  ${eventMarker}
  <text x="74" y="548" class="axis">VOLUME</text>
  <text x="1128" y="703" text-anchor="end" class="axis">UTC</text>
</svg>`;
}

function safeFilename(coin: string): string {
  const normalized = coin.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${normalized || "episode"}-5m.png`;
}

export async function createTelegramChartImage(
  event: StoredPump,
  dataDir: string,
  dependencies: TelegramChartDependencies = {},
): Promise<TelegramChartImage> {
  const eventDurationMs = Math.max(0, event.endMs - event.startMs);
  const afterMs = Math.min(
    DEFAULT_REVIEW_CANDLE_CONTEXT_MS,
    Math.max(MIN_AFTER_CONTEXT_MS, eventDurationMs + EVENT_FOLLOWUP_MS),
  );
  const loadWindow = dependencies.loadWindow ?? loadReviewCandleWindowWithExchangeFallback;
  const window = await loadWindow(
    {
      event,
      interval: "5m",
      beforeMs: DEFAULT_REVIEW_CANDLE_CONTEXT_MS,
      afterMs,
    },
    { dataDir },
  );
  const svg = renderTelegramChartSvg(event, window);
  const buffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  return {
    buffer,
    filename: safeFilename(event.coin),
    caption: `<b>${escapeXml(event.coin)} · 5m chart</b>`,
  };
}
