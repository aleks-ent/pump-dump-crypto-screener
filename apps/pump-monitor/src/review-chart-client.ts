import { buildTradingViewChartUrl } from "@screener/pump-detector";

export interface ReviewChartOptions {
  eventId: string;
  detectedAtMs: number;
  exchange: string;
  symbol: string;
  instrumentType?: string | null;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDetectedAt(detectedAtMs: number): { iso: string; display: string } {
  const detectedAt = new Date(detectedAtMs);
  if (Number.isNaN(detectedAt.getTime())) {
    return { iso: "", display: "Unknown UTC time" };
  }
  const iso = detectedAt.toISOString();
  return {
    iso,
    display: `${iso.slice(0, 19).replace("T", " ")} UTC`,
  };
}

/**
 * Markup for the selected event's single, browser-rendered OHLCV chart. The
 * script below progressively enhances this shell, so the event context and
 * annotation panel remain independent if candle loading fails.
 */
export function renderReviewChart(options: ReviewChartOptions): string {
  const eventId = escapeAttribute(options.eventId);
  const detectedAt = formatDetectedAt(options.detectedAtMs);
  const tradingViewOptions = {
    exchange: options.exchange,
    symbolNative: options.symbol,
    instrumentType: options.instrumentType ?? undefined,
  };
  const tradingView1m = escapeAttribute(
    buildTradingViewChartUrl({ ...tradingViewOptions, timeframe: "1m" }),
  );
  const tradingView5m = escapeAttribute(
    buildTradingViewChartUrl({ ...tradingViewOptions, timeframe: "5m" }),
  );
  const pumpTime = escapeAttribute(detectedAt.display);
  return `<div class="chart-card" data-chart-root data-chart-state="loading" data-event-id="${eventId}" data-detected-at-ms="${options.detectedAtMs}">
          <div class="chart-toolbar">
            <div><strong>Historical chart</strong><span data-chart-context>2h before · 2h after detection</span></div>
            <div class="timeframe-switch" aria-label="Chart timeframe">
              <button type="button" class="is-active" data-chart-interval="1m" aria-pressed="true">1m</button><button type="button" data-chart-interval="5m" aria-pressed="false">5m</button>
            </div>
          </div>
          <div class="tradingview-tools" data-tradingview-tools>
            <div class="tradingview-context">
              <strong>TradingView fallback</strong>
              <span>Detected <time datetime="${escapeAttribute(detectedAt.iso)}">${pumpTime}</time></span>
            </div>
            <div class="tradingview-actions">
              <a href="${tradingView1m}" target="_blank" rel="noopener noreferrer" data-tradingview-link data-tradingview-interval="1m">TradingView 1m <span aria-hidden="true">↗</span></a>
              <a href="${tradingView5m}" target="_blank" rel="noopener noreferrer" data-tradingview-link data-tradingview-interval="5m">TradingView 5m <span aria-hidden="true">↗</span></a>
              <button type="button" data-copy-pump-time data-pump-time="${pumpTime}">Copy pump time</button>
            </div>
            <span class="tradingview-guidance" data-copy-pump-feedback aria-live="polite">In TradingView, press Alt/Option + G and use this UTC time.</span>
          </div>
          <div class="chart-stage" data-chart-stage role="img" aria-label="Historical OHLCV chart for the selected event">
            <svg data-chart-svg aria-hidden="true"></svg>
            <div class="chart-message" data-chart-message role="status" aria-live="polite">
              <span class="spinner" data-chart-spinner aria-hidden="true"></span>
              <strong data-chart-message-title>Loading historical candles…</strong>
              <span data-chart-message-detail>Preparing the 1 minute view around detection.</span>
              <button type="button" data-chart-retry hidden>Retry</button>
            </div>
          </div>
          <footer class="chart-footer">
            <span data-chart-legend><i class="legend-up"></i> Up <i class="legend-down"></i> Down <i class="legend-volume"></i> Volume</span>
            <span data-chart-quality aria-live="polite"></span>
          </footer>
        </div>`;
}

/** Dependency-free browser client for the server-rendered chart shell. */
export const REVIEW_CHART_CLIENT_SCRIPT = String.raw`
    (() => {
      const NS = 'http://www.w3.org/2000/svg';
      const CONTEXT_MS = 2 * 60 * 60 * 1000;
      const roots = document.querySelectorAll('[data-chart-root]');

      const svgNode = (name, attributes, text) => {
        const node = document.createElementNS(NS, name);
        Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
        if (text != null) node.textContent = String(text);
        return node;
      };

      const formatTime = (seconds) => new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC'
      }).format(new Date(seconds * 1000));

      const formatPrice = (value, range) => {
        const magnitude = Math.abs(value);
        const digits = magnitude >= 100 ? 2 : magnitude >= 1 ? 4 : magnitude >= 0.01 ? 6 : 8;
        if (range > 0 && range < 0.0001) return value.toPrecision(6);
        return value.toLocaleString('en-US', { maximumFractionDigits: digits });
      };

      const init = (root) => {
        const svg = root.querySelector('[data-chart-svg]');
        const stage = root.querySelector('[data-chart-stage]');
        const message = root.querySelector('[data-chart-message]');
        const title = root.querySelector('[data-chart-message-title]');
        const detail = root.querySelector('[data-chart-message-detail]');
        const retry = root.querySelector('[data-chart-retry]');
        const spinner = root.querySelector('[data-chart-spinner]');
        const quality = root.querySelector('[data-chart-quality]');
        const copyPumpTime = root.querySelector('[data-copy-pump-time]');
        const copyFeedback = root.querySelector('[data-copy-pump-feedback]');
        const buttons = root.querySelectorAll('[data-chart-interval]');
        const eventId = root.dataset.eventId || '';
        const detectedAtMs = Number(root.dataset.detectedAtMs);
        let interval = '1m';
        let payload = null;
        let requestNumber = 0;
        let controller = null;
        let resizeFrame = 0;

        const writeClipboard = async (value) => {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(value);
            return;
          }
          const textarea = document.createElement('textarea');
          textarea.value = value;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.append(textarea);
          textarea.select();
          const copied = document.execCommand('copy');
          textarea.remove();
          if (!copied) throw new Error('Clipboard unavailable');
        };

        const showState = (state, heading, description) => {
          root.dataset.chartState = state;
          title.textContent = heading;
          detail.textContent = description;
          message.hidden = state === 'ready';
          retry.hidden = state !== 'error' && state !== 'empty';
          spinner.hidden = state !== 'loading';
          if (state !== 'ready') {
            svg.replaceChildren();
            quality.textContent = '';
          }
        };

        const addMarker = (group, x, label, strong, top, bottom) => {
          const line = svgNode('line', {
            x1: x, x2: x, y1: top, y2: bottom,
            class: strong ? 'marker-line marker-detection' : 'marker-line marker-followup'
          });
          group.append(line);
          const labelWidth = strong ? 58 : 34;
          const labelX = Math.max(2, Math.min(x + 4, Number(svg.getAttribute('viewBox').split(' ')[2]) - labelWidth - 2));
          group.append(svgNode('rect', {
            x: labelX, y: top + 3, width: labelWidth, height: 17, rx: 4,
            class: strong ? 'marker-label-bg marker-detection' : 'marker-label-bg marker-followup'
          }));
          group.append(svgNode('text', {
            x: labelX + 5, y: top + 15,
            class: strong ? 'marker-label marker-detection' : 'marker-label marker-followup'
          }, label));
        };

        const render = () => {
          if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) return;
          const width = Math.max(360, Math.round(stage.clientWidth || 800));
          const height = Math.max(300, Math.round(stage.clientHeight || 420));
          const margin = { top: 28, right: 72, bottom: 26, left: 12 };
          const volumeHeight = Math.max(52, Math.round(height * 0.2));
          const volumeBottom = height - margin.bottom;
          const volumeTop = volumeBottom - volumeHeight;
          const priceBottom = volumeTop - 16;
          const priceTop = margin.top;
          const plotLeft = margin.left;
          const plotRight = width - margin.right;
          const plotWidth = Math.max(1, plotRight - plotLeft);
          const items = payload.items.filter((item) =>
            Number.isFinite(item.time) && Number.isFinite(item.open) && Number.isFinite(item.high) &&
            Number.isFinite(item.low) && Number.isFinite(item.close) && Number.isFinite(item.volume)
          );
          if (items.length === 0) {
            showState('empty', 'No valid candles in this window', 'Open the event in TradingView above, or retry after local market data is restored.');
            return;
          }
          const fromSeconds = Number.isFinite(payload.fromMs) ? payload.fromMs / 1000 : detectedAtMs / 1000 - CONTEXT_MS / 1000;
          const toSeconds = Number.isFinite(payload.toMs) ? payload.toMs / 1000 : detectedAtMs / 1000 + CONTEXT_MS / 1000;
          const timeSpan = Math.max(1, toSeconds - fromSeconds);
          const lows = items.map((item) => item.low);
          const highs = items.map((item) => item.high);
          let priceMin = Math.min(...lows);
          let priceMax = Math.max(...highs);
          const rawRange = priceMax - priceMin;
          const pricePad = rawRange === 0 ? Math.max(Math.abs(priceMax) * 0.002, 0.00000001) : rawRange * 0.06;
          priceMin -= pricePad;
          priceMax += pricePad;
          const priceRange = Math.max(Number.EPSILON, priceMax - priceMin);
          const maxVolume = Math.max(1, ...items.map((item) => Math.max(0, item.volume)));
          const x = (time) => plotLeft + ((time - fromSeconds) / timeSpan) * plotWidth;
          const y = (price) => priceTop + ((priceMax - price) / priceRange) * (priceBottom - priceTop);
          const intervalSeconds = interval === '5m' ? 300 : 60;
          const candleWidth = Math.max(1.5, Math.min(12, (plotWidth * intervalSeconds / timeSpan) * 0.72));

          svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
          svg.replaceChildren();
          const grid = svgNode('g', { class: 'chart-grid' });
          for (let index = 0; index <= 4; index += 1) {
            const lineY = priceTop + ((priceBottom - priceTop) * index / 4);
            const price = priceMax - (priceRange * index / 4);
            grid.append(svgNode('line', { x1: plotLeft, x2: plotRight, y1: lineY, y2: lineY }));
            grid.append(svgNode('text', { x: plotRight + 7, y: lineY + 4 }, formatPrice(price, priceRange)));
          }
          for (let index = 0; index <= 4; index += 1) {
            const lineX = plotLeft + (plotWidth * index / 4);
            const time = fromSeconds + (timeSpan * index / 4);
            grid.append(svgNode('line', { x1: lineX, x2: lineX, y1: priceTop, y2: volumeBottom }));
            const anchor = index === 0 ? 'start' : index === 4 ? 'end' : 'middle';
            grid.append(svgNode('text', { x: lineX, y: height - 7, 'text-anchor': anchor }, formatTime(time)));
          }
          grid.append(svgNode('text', { x: plotRight + 7, y: volumeTop + 12 }, 'VOL'));
          svg.append(grid);

          const bars = svgNode('g', { class: 'chart-bars' });
          items.forEach((item) => {
            const center = x(item.time);
            if (center < plotLeft - candleWidth || center > plotRight + candleWidth) return;
            const rising = item.close >= item.open;
            const className = rising ? 'candle-up' : 'candle-down';
            const candle = svgNode('g', { class: className });
            candle.append(svgNode('title', {},
              formatTime(item.time) + ' UTC  O ' + formatPrice(item.open, priceRange) +
              '  H ' + formatPrice(item.high, priceRange) + '  L ' + formatPrice(item.low, priceRange) +
              '  C ' + formatPrice(item.close, priceRange) + '  V ' + item.volume.toLocaleString('en-US')
            ));
            candle.append(svgNode('line', { x1: center, x2: center, y1: y(item.high), y2: y(item.low), class: 'candle-wick' }));
            const bodyTop = Math.min(y(item.open), y(item.close));
            const bodyHeight = Math.max(1, Math.abs(y(item.open) - y(item.close)));
            candle.append(svgNode('rect', { x: center - candleWidth / 2, y: bodyTop, width: candleWidth, height: bodyHeight, rx: 0.5, class: 'candle-body' }));
            const barHeight = Math.max(1, Math.max(0, item.volume) / maxVolume * volumeHeight);
            candle.append(svgNode('rect', { x: center - candleWidth / 2, y: volumeBottom - barHeight, width: candleWidth, height: barHeight, class: 'volume-bar' }));
            bars.append(candle);
          });
          svg.append(bars);

          const markers = svgNode('g', { class: 'chart-markers' });
          const detectionSeconds = detectedAtMs / 1000;
          [
            [0, 'Detection', true],
            [5 * 60, '+5m', false],
            [10 * 60, '+10m', false],
            [15 * 60, '+15m', false]
          ].forEach(([offset, label, strong]) => {
            const markerX = x(detectionSeconds + Number(offset));
            if (markerX >= plotLeft && markerX <= plotRight) addMarker(markers, markerX, String(label), Boolean(strong), priceTop, volumeBottom);
          });
          svg.append(markers);

          const loaded = payload.quality && Number.isFinite(payload.quality.loadedBars) ? payload.quality.loadedBars : items.length;
          const coverage = payload.quality && Number.isFinite(payload.quality.coveragePct) ? Math.round(payload.quality.coveragePct) : null;
          quality.textContent = loaded + ' candles' + (coverage == null ? '' : ' · ' + coverage + '% coverage') + ' · UTC';
          root.dataset.chartState = 'ready';
          message.hidden = true;
        };

        const load = async () => {
          if (!eventId || !Number.isFinite(detectedAtMs)) {
            showState('error', 'Chart configuration is unavailable', 'Open the event in TradingView above. Annotation controls remain available.');
            return;
          }
          const currentRequest = ++requestNumber;
          if (controller) controller.abort();
          controller = new AbortController();
          showState('loading', 'Loading historical candles…', 'Preparing the ' + interval + ' view around detection.');
          buttons.forEach((button) => { button.disabled = true; });
          const params = new URLSearchParams({
            eventId,
            interval,
            from: String(detectedAtMs - CONTEXT_MS),
            to: String(detectedAtMs + CONTEXT_MS)
          });
          try {
            const response = await fetch('/api/market-data/candles?' + params.toString(), {
              headers: { accept: 'application/json' }, signal: controller.signal
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(body && body.error && body.error.message ? body.error.message : 'Request failed with status ' + response.status);
            }
            if (currentRequest !== requestNumber) return;
            payload = body;
            if (!Array.isArray(body.items) || body.items.length === 0) {
              showState('empty', 'No historical candles found', 'Use the TradingView links above to review this event without local candle history.');
              return;
            }
            render();
          } catch (error) {
            if (error && error.name === 'AbortError') return;
            if (currentRequest !== requestNumber) return;
            const reason = error instanceof Error ? error.message : 'Try the request again.';
            showState('error', 'Could not load historical candles', reason + ' Use TradingView above or retry.');
          } finally {
            if (currentRequest === requestNumber) buttons.forEach((button) => { button.disabled = false; });
          }
        };

        buttons.forEach((button) => {
          button.addEventListener('click', () => {
            const next = button.dataset.chartInterval;
            if (!next || next === interval) return;
            interval = next;
            buttons.forEach((candidate) => {
              const active = candidate === button;
              candidate.classList.toggle('is-active', active);
              candidate.setAttribute('aria-pressed', String(active));
            });
            load();
          });
        });
        copyPumpTime?.addEventListener('click', async () => {
          const pumpTime = copyPumpTime.dataset.pumpTime || '';
          if (!pumpTime) return;
          try {
            await writeClipboard(pumpTime);
            if (copyFeedback) copyFeedback.textContent = 'Pump time copied. In TradingView, press Alt/Option + G and paste it.';
          } catch {
            if (copyFeedback) copyFeedback.textContent = 'Could not copy automatically. Select the detected UTC time shown here.';
          }
        });
        retry.addEventListener('click', load);
        if ('ResizeObserver' in window) {
          new ResizeObserver(() => {
            cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(render);
          }).observe(stage);
        } else {
          window.addEventListener('resize', () => {
            cancelAnimationFrame(resizeFrame);
            resizeFrame = requestAnimationFrame(render);
          });
        }
        load();
      };

      roots.forEach(init);
    })();`;
