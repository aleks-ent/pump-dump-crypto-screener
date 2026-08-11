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

function formatDetectedAt(detectedAtMs: number): {
  iso: string;
  display: string;
  date: string;
  time: string;
} {
  const detectedAt = new Date(detectedAtMs);
  if (Number.isNaN(detectedAt.getTime())) {
    return { iso: "", display: "Unknown UTC time", date: "", time: "" };
  }
  const iso = detectedAt.toISOString();
  return {
    iso,
    display: `${iso.slice(0, 19).replace("T", " ")} UTC`,
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
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
  const pumpDate = escapeAttribute(detectedAt.date);
  const pumpMinute = escapeAttribute(detectedAt.time);
  return `<div class="chart-card" data-chart-root data-chart-state="loading" data-event-id="${eventId}" data-detected-at-ms="${options.detectedAtMs}">
          <div class="chart-toolbar">
            <div><strong>Historical chart</strong><span data-chart-context>2h before · 2h after pump time</span></div>
            <div class="timeframe-switch" aria-label="Chart timeframe">
              <button type="button" data-chart-interval="1m" aria-pressed="false">1m</button><button type="button" class="is-active" data-chart-interval="5m" aria-pressed="true">5m</button>
            </div>
          </div>
          <div class="tradingview-tools" data-tradingview-tools>
            <div class="tradingview-context">
              <strong>TradingView fallback</strong>
              <span>Pump time <time datetime="${escapeAttribute(detectedAt.iso)}">${pumpTime}</time></span>
            </div>
            <div class="tradingview-actions">
              <a href="${tradingView1m}" target="_blank" rel="noopener noreferrer" data-tradingview-link data-tradingview-interval="1m">TradingView 1m <span aria-hidden="true">↗</span></a>
              <a href="${tradingView5m}" target="_blank" rel="noopener noreferrer" data-tradingview-link data-tradingview-interval="5m">TradingView 5m <span aria-hidden="true">↗</span></a>
              <button type="button" data-copy-tradingview-value data-copy-value="${pumpDate}" data-copy-field="date">Copy date</button>
              <button type="button" data-copy-tradingview-value data-copy-value="${pumpMinute}" data-copy-field="time">Copy time</button>
            </div>
            <span class="tradingview-guidance" data-copy-pump-feedback aria-live="polite">Set the TradingView chart timezone to UTC. Press Alt/Option + G, then paste the date and time separately.</span>
          </div>
          <div class="chart-stage" data-chart-stage role="img" tabindex="0" aria-label="Interactive historical OHLCV chart for the selected event">
            <svg data-chart-svg aria-hidden="true"></svg>
            <div class="chart-tooltip" data-chart-tooltip hidden></div>
            <div class="chart-message" data-chart-message role="status" aria-live="polite">
              <span class="spinner" data-chart-spinner aria-hidden="true"></span>
              <strong data-chart-message-title>Loading historical candles…</strong>
              <span data-chart-message-detail>Preparing the 5 minute view around the pump time.</span>
              <button type="button" data-chart-retry hidden>Retry</button>
            </div>
          </div>
          <footer class="chart-footer">
            <span data-chart-legend><i class="legend-up"></i> Up <i class="legend-down"></i> Down <i class="legend-volume"></i> Volume</span>
            <span class="chart-interaction-hint">Scroll to zoom · drag to pan · double-click to reset</span>
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
        const tooltip = root.querySelector('[data-chart-tooltip]');
        const copyTradingViewValues = root.querySelectorAll('[data-copy-tradingview-value]');
        const copyFeedback = root.querySelector('[data-copy-pump-feedback]');
        const buttons = root.querySelectorAll('[data-chart-interval]');
        const eventId = root.dataset.eventId || '';
        const detectedAtMs = Number(root.dataset.detectedAtMs);
        let interval = '5m';
        let payload = null;
        let requestNumber = 0;
        let controller = null;
        let resizeFrame = 0;
        let viewFromSeconds = null;
        let viewToSeconds = null;
        let chartGeometry = null;
        let drag = null;

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
            tooltip.hidden = true;
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
            showState('empty', 'No valid candles in this window', 'The exchange and local market data did not return usable candles.');
            return;
          }
          const dataFromSeconds = Number.isFinite(payload.fromMs) ? payload.fromMs / 1000 : detectedAtMs / 1000 - CONTEXT_MS / 1000;
          const dataToSeconds = Number.isFinite(payload.toMs) ? payload.toMs / 1000 : detectedAtMs / 1000 + CONTEXT_MS / 1000;
          if (!Number.isFinite(viewFromSeconds) || !Number.isFinite(viewToSeconds) || viewFromSeconds >= viewToSeconds) {
            viewFromSeconds = dataFromSeconds;
            viewToSeconds = dataToSeconds;
          }
          const fromSeconds = viewFromSeconds;
          const toSeconds = viewToSeconds;
          const timeSpan = Math.max(1, toSeconds - fromSeconds);
          const intervalSeconds = interval === '5m' ? 300 : 60;
          const visibleItems = items.filter((item) => item.time >= fromSeconds - intervalSeconds && item.time <= toSeconds + intervalSeconds);
          if (visibleItems.length === 0) return;
          const lows = visibleItems.map((item) => item.low);
          const highs = visibleItems.map((item) => item.high);
          let priceMin = Math.min(...lows);
          let priceMax = Math.max(...highs);
          const rawRange = priceMax - priceMin;
          const pricePad = rawRange === 0 ? Math.max(Math.abs(priceMax) * 0.002, 0.00000001) : rawRange * 0.06;
          priceMin -= pricePad;
          priceMax += pricePad;
          const priceRange = Math.max(Number.EPSILON, priceMax - priceMin);
          const maxVolume = Math.max(1, ...visibleItems.map((item) => Math.max(0, item.volume)));
          const x = (time) => plotLeft + ((time - fromSeconds) / timeSpan) * plotWidth;
          const y = (price) => priceTop + ((priceMax - price) / priceRange) * (priceBottom - priceTop);
          const candleWidth = Math.max(1.5, Math.min(12, (plotWidth * intervalSeconds / timeSpan) * 0.72));
          chartGeometry = { plotLeft, plotRight, plotWidth, priceTop, volumeBottom, fromSeconds, toSeconds, dataFromSeconds, dataToSeconds, items, priceRange };

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
          visibleItems.forEach((item) => {
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
            [0, 'Pump start', true],
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
          const exchangeBars = payload.source && Number.isFinite(payload.source.exchangeApiBars) ? payload.source.exchangeApiBars : 0;
          const source = exchangeBars > 0 ? 'exchange API' : 'local history';
          quality.textContent = loaded + ' candles' + (coverage == null ? '' : ' · ' + coverage + '% coverage') + ' · ' + source + ' · UTC';
          root.dataset.chartState = 'ready';
          message.hidden = true;
        };

        const stageX = (event) => event.clientX - stage.getBoundingClientRect().left;

        const clampView = (from, to, dataFrom, dataTo) => {
          const span = to - from;
          if (from < dataFrom) return [dataFrom, dataFrom + span];
          if (to > dataTo) return [dataTo - span, dataTo];
          return [from, to];
        };

        const hideCrosshair = () => {
          svg.querySelector('[data-chart-crosshair]')?.remove();
          tooltip.hidden = true;
        };

        const showCrosshair = (event) => {
          if (!chartGeometry || !payload || drag) return;
          const pointerX = Math.max(chartGeometry.plotLeft, Math.min(stageX(event), chartGeometry.plotRight));
          const pointerTime = chartGeometry.fromSeconds + ((pointerX - chartGeometry.plotLeft) / chartGeometry.plotWidth) * (chartGeometry.toSeconds - chartGeometry.fromSeconds);
          const candle = chartGeometry.items.reduce((nearest, item) =>
            nearest == null || Math.abs(item.time - pointerTime) < Math.abs(nearest.time - pointerTime) ? item : nearest
          , null);
          if (!candle) return;
          const candleX = chartGeometry.plotLeft + ((candle.time - chartGeometry.fromSeconds) / (chartGeometry.toSeconds - chartGeometry.fromSeconds)) * chartGeometry.plotWidth;
          svg.querySelector('[data-chart-crosshair]')?.remove();
          const crosshair = svgNode('g', { 'data-chart-crosshair': '', class: 'chart-crosshair' });
          crosshair.append(svgNode('line', { x1: candleX, x2: candleX, y1: chartGeometry.priceTop, y2: chartGeometry.volumeBottom }));
          crosshair.append(svgNode('line', { x1: chartGeometry.plotLeft, x2: chartGeometry.plotRight, y1: Math.max(chartGeometry.priceTop, Math.min(event.offsetY, chartGeometry.volumeBottom)), y2: Math.max(chartGeometry.priceTop, Math.min(event.offsetY, chartGeometry.volumeBottom)) }));
          svg.append(crosshair);
          const iso = new Date(candle.time * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
          tooltip.textContent = iso + '  O ' + formatPrice(candle.open, chartGeometry.priceRange) + '  H ' + formatPrice(candle.high, chartGeometry.priceRange) + '  L ' + formatPrice(candle.low, chartGeometry.priceRange) + '  C ' + formatPrice(candle.close, chartGeometry.priceRange) + '  V ' + candle.volume.toLocaleString('en-US');
          tooltip.hidden = false;
          const tooltipLeft = Math.max(8, Math.min(pointerX + 12, stage.clientWidth - tooltip.offsetWidth - 8));
          tooltip.style.left = tooltipLeft + 'px';
          tooltip.style.top = '8px';
        };

        stage.addEventListener('wheel', (event) => {
          if (!chartGeometry) return;
          event.preventDefault();
          const currentSpan = chartGeometry.toSeconds - chartGeometry.fromSeconds;
          const minimumSpan = (interval === '5m' ? 300 : 60) * 6;
          const maximumSpan = chartGeometry.dataToSeconds - chartGeometry.dataFromSeconds;
          const nextSpan = Math.max(minimumSpan, Math.min(maximumSpan, currentSpan * (event.deltaY < 0 ? 0.8 : 1.25)));
          const ratio = Math.max(0, Math.min(1, (stageX(event) - chartGeometry.plotLeft) / chartGeometry.plotWidth));
          const anchor = chartGeometry.fromSeconds + currentSpan * ratio;
          [viewFromSeconds, viewToSeconds] = clampView(anchor - nextSpan * ratio, anchor + nextSpan * (1 - ratio), chartGeometry.dataFromSeconds, chartGeometry.dataToSeconds);
          hideCrosshair();
          render();
        }, { passive: false });

        stage.addEventListener('pointerdown', (event) => {
          if (!chartGeometry || event.button !== 0) return;
          drag = { x: stageX(event), from: chartGeometry.fromSeconds, to: chartGeometry.toSeconds };
          stage.setPointerCapture(event.pointerId);
          stage.classList.add('is-panning');
          hideCrosshair();
        });
        stage.addEventListener('pointermove', (event) => {
          if (!chartGeometry) return;
          if (!drag) {
            showCrosshair(event);
            return;
          }
          const span = drag.to - drag.from;
          const shift = (drag.x - stageX(event)) / chartGeometry.plotWidth * span;
          [viewFromSeconds, viewToSeconds] = clampView(drag.from + shift, drag.to + shift, chartGeometry.dataFromSeconds, chartGeometry.dataToSeconds);
          render();
        });
        const stopDrag = (event) => {
          if (!drag) return;
          drag = null;
          stage.classList.remove('is-panning');
          if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
        };
        stage.addEventListener('pointerup', stopDrag);
        stage.addEventListener('pointercancel', stopDrag);
        stage.addEventListener('pointerleave', () => { if (!drag) hideCrosshair(); });
        stage.addEventListener('dblclick', () => {
          if (!chartGeometry) return;
          viewFromSeconds = chartGeometry.dataFromSeconds;
          viewToSeconds = chartGeometry.dataToSeconds;
          hideCrosshair();
          render();
        });

        const load = async () => {
          if (!eventId || !Number.isFinite(detectedAtMs)) {
            showState('error', 'Chart configuration is unavailable', 'Open the event in TradingView above. Annotation controls remain available.');
            return;
          }
          const currentRequest = ++requestNumber;
          if (controller) controller.abort();
          controller = new AbortController();
          viewFromSeconds = null;
          viewToSeconds = null;
          showState('loading', 'Loading historical candles…', 'Preparing the ' + interval + ' view around the pump time.');
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
              showState('empty', 'No historical candles found', 'Neither the exchange API nor local market history returned this event window.');
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
        copyTradingViewValues.forEach((button) => {
          button.addEventListener('click', async () => {
            const value = button.dataset.copyValue || '';
            const field = button.dataset.copyField || 'value';
            if (!value) return;
            try {
              await writeClipboard(value);
              if (copyFeedback) copyFeedback.textContent = field.charAt(0).toUpperCase() + field.slice(1) + ' copied (' + value + '). Paste it into TradingView’s ' + field + ' field.';
            } catch {
              if (copyFeedback) copyFeedback.textContent = 'Could not copy automatically. Enter the UTC ' + field + ' shown in the pump time.';
            }
          });
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
