import {
  renderReviewChart,
  REVIEW_CHART_CLIENT_SCRIPT,
} from "./review-chart-client.js";
import {
  renderReviewAnnotation,
  REVIEW_ANNOTATION_CLIENT_SCRIPT,
  type ReviewAnnotationConfidence,
} from "./review-annotation-client.js";
import {
  renderReviewKeyboardUi,
  REVIEW_KEYBOARD_CLIENT_SCRIPT,
} from "./review-keyboard-client.js";

export type PumpReviewCategory =
  | "sustained_move"
  | "wick_spike"
  | "volume_only"
  | "market_move"
  | "illiquid_noise"
  | "unclear";

export type ReviewStatus = "unreviewed" | "reviewed" | "unclear";
export type ReviewStatusFilter = "all" | ReviewStatus;
export type ReviewSort =
  | "detectedAtDesc"
  | "detectedAtAsc"
  | "unreviewedFirst"
  | "symbolAsc";

export interface ReviewEventSummary {
  id: string;
  symbol: string;
  exchange: string;
  detectedAt: string | number | Date;
  status: ReviewStatus;
  category?: PumpReviewCategory | null;
  confidence?: ReviewAnnotationConfidence | null;
  comment?: string | null;
  marketType?: string | null;
  telegramVotes: {
    pump: number;
    dump: number;
    none: number;
  };
}

export interface ReviewFilters {
  status: ReviewStatusFilter;
  category: "all" | PumpReviewCategory;
  exchange: string;
  symbol: string;
  dateFrom: string;
  dateTo: string;
  sort: ReviewSort;
}

export interface ReviewProgress {
  total: number;
  reviewed: number;
  unreviewed: number;
  unclear: number;
}

export interface ReviewFilterOptions {
  exchanges?: string[];
}

export interface ReviewPagination {
  page: number;
  pageSize: number;
  loadedCount?: number;
  hasMore: boolean;
}

export interface ReviewPageOptions {
  events?: ReviewEventSummary[];
  selectedEventId?: string | null;
  filters?: Partial<ReviewFilters>;
  progress?: Partial<ReviewProgress>;
  filterOptions?: ReviewFilterOptions;
  pagination?: Partial<ReviewPagination>;
  listState?: "ready" | "loading" | "error";
  errorMessage?: string;
}

const CATEGORIES: ReadonlyArray<{
  value: PumpReviewCategory;
  label: string;
  hint: string;
}> = [
  {
    value: "sustained_move",
    label: "Sustained move",
    hint: "Directional move with continuation",
  },
  {
    value: "wick_spike",
    label: "Wick spike",
    hint: "Brief spike without continuation",
  },
  {
    value: "volume_only",
    label: "Volume only",
    hint: "Activity increased without a price move",
  },
  {
    value: "market_move",
    label: "Market move",
    hint: "Moved with the broader market",
  },
  {
    value: "illiquid_noise",
    label: "Illiquid noise",
    hint: "Sparse, unreliable, or untradeable market",
  },
  {
    value: "unclear",
    label: "Unclear",
    hint: "Insufficient or ambiguous evidence",
  },
];

const DEFAULT_FILTERS: ReviewFilters = {
  status: "unreviewed",
  category: "all",
  exchange: "",
  symbol: "",
  dateFrom: "",
  dateTo: "",
  sort: "detectedAtDesc",
};

const DEFAULT_PAGINATION: ReviewPagination = {
  page: 1,
  pageSize: 50,
  hasMore: false,
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatUtc(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(String(value));
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function categoryLabel(category: PumpReviewCategory): string {
  return CATEGORIES.find((item) => item.value === category)?.label ?? category;
}

function statusLabel(event: ReviewEventSummary): string {
  if (event.status === "unreviewed") return "Unreviewed";
  if (event.status === "unclear") return "Unclear";
  return "Reviewed";
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim() !== ""))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function renderOptions(
  values: string[],
  selectedValue: string,
  emptyLabel: string,
): string {
  const options = [`<option value="">${escapeHtml(emptyLabel)}</option>`];
  for (const value of values) {
    options.push(
      `<option value="${escapeHtml(value)}"${value === selectedValue ? " selected" : ""}>${escapeHtml(value)}</option>`,
    );
  }
  return options.join("");
}

function reviewQuery(
  filters: ReviewFilters,
  extras: Record<string, string | number | undefined> = {},
): string {
  const params = new URLSearchParams();
  params.set("status", filters.status);
  if (filters.category !== "all") params.set("category", filters.category);
  if (filters.exchange) params.set("exchange", filters.exchange);
  if (filters.symbol) params.set("symbol", filters.symbol);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  params.set("sort", filters.sort);
  for (const [key, value] of Object.entries(extras)) {
    if (value !== undefined && String(value) !== "") params.set(key, String(value));
  }
  return `/review?${escapeHtml(params.toString())}`;
}

function reviewExportQuery(
  filters: ReviewFilters,
  format: "json" | "csv",
  scope: "filtered" | "all-reviewed",
): string {
  const params = new URLSearchParams({ format, scope });
  if (scope === "filtered") {
    params.set("status", filters.status);
    if (filters.category !== "all") params.set("category", filters.category);
    if (filters.exchange) params.set("exchange", filters.exchange);
    if (filters.symbol) params.set("symbol", filters.symbol);
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    params.set("sort", filters.sort);
  }
  return `/api/pump-events/export?${escapeHtml(params.toString())}`;
}

function renderExportMenu(filters: ReviewFilters): string {
  return `<details class="export-menu" data-export-menu>
    <summary>Export</summary>
    <div>
      <strong>Current filters</strong>
      <a href="${reviewExportQuery(filters, "json", "filtered")}" data-review-export>JSON</a>
      <a href="${reviewExportQuery(filters, "csv", "filtered")}" data-review-export>CSV</a>
      <strong>All labeled events</strong>
      <a href="${reviewExportQuery(filters, "json", "all-reviewed")}" data-review-export>JSON</a>
      <a href="${reviewExportQuery(filters, "csv", "all-reviewed")}" data-review-export>CSV</a>
    </div>
    <span class="export-feedback" data-export-feedback aria-live="polite"></span>
  </details>`;
}

function renderProgress(progress: ReviewProgress): string {
  const completed = Math.max(0, progress.reviewed + progress.unclear);
  const percentage =
    progress.total === 0
      ? 0
      : Math.min(100, Math.round((completed / progress.total) * 100));
  return `<section class="progress-card" aria-label="Review progress" data-review-progress>
          <div class="progress-summary"><strong>${completed.toLocaleString()}</strong> / ${progress.total.toLocaleString()} reviewed <span>${percentage}%</span></div>
          <div class="progress-track" aria-hidden="true"><span style="width:${percentage}%"></span></div>
          <dl class="progress-counts">
            <div><dt>Reviewed</dt><dd>${progress.reviewed.toLocaleString()}</dd></div>
            <div><dt>Unreviewed</dt><dd>${progress.unreviewed.toLocaleString()}</dd></div>
            <div><dt>Unclear</dt><dd>${progress.unclear.toLocaleString()}</dd></div>
          </dl>
        </section>`;
}

function renderEventRow(
  event: ReviewEventSummary,
  selected: boolean,
  filters: ReviewFilters,
  page: number,
): string {
  const category = event.category ? categoryLabel(event.category) : null;
  const details =
    category && event.status === "reviewed" ? ` · ${category}` : "";
  const telegramVoteTotal =
    event.telegramVotes.pump + event.telegramVotes.dump + event.telegramVotes.none;
  const telegramVoteSummary =
    telegramVoteTotal > 0
      ? `<span class="telegram-vote-total" title="${telegramVoteTotal.toLocaleString()} Telegram subscriber vote${telegramVoteTotal === 1 ? "" : "s"}">TG ${telegramVoteTotal.toLocaleString()}</span>`
      : "";
  return `<a class="event-row status-${event.status}${selected ? " is-selected" : ""}"
            href="${reviewQuery(filters, { event: event.id, page })}"
            data-event-row data-event-id="${escapeHtml(event.id)}" data-review-status="${event.status}"
            ${selected ? 'aria-current="true"' : ""}>
          <span class="event-row-top"><strong>${escapeHtml(event.symbol)}</strong>${telegramVoteSummary}</span>
          <span>${escapeHtml(event.exchange)} · ${formatUtc(event.detectedAt)}</span>
          <span class="event-status"><i aria-hidden="true"></i>${statusLabel(event)}${escapeHtml(details)}</span>
        </a>`;
}

function renderTelegramVotes(event: ReviewEventSummary): string {
  const { pump, dump, none } = event.telegramVotes;
  const total = pump + dump + none;
  return `<section class="telegram-votes" aria-label="Telegram subscriber votes" data-telegram-votes>
    <div class="telegram-votes-heading">
      <div><p class="eyebrow">Telegram crowd</p><strong>Subscriber votes</strong></div>
      <span>${total.toLocaleString()} vote${total === 1 ? "" : "s"}</span>
    </div>
    <dl>
      <div class="telegram-vote-pump"><dt>Pump</dt><dd>${pump.toLocaleString()}</dd></div>
      <div class="telegram-vote-dump"><dt>Dump</dt><dd>${dump.toLocaleString()}</dd></div>
      <div class="telegram-vote-none"><dt>Neither</dt><dd>${none.toLocaleString()}</dd></div>
    </dl>
    ${total === 0 ? "<p>No Telegram subscribers have voted on this event yet.</p>" : ""}
  </section>`;
}

function renderListState(
  options: ReviewPageOptions,
  events: ReviewEventSummary[],
  selectedId: string | null,
  filters: ReviewFilters,
  pagination: ReviewPagination,
): string {
  if (options.listState === "loading") {
    return `<div class="list-message" role="status" data-list-state="loading">
      <span class="spinner" aria-hidden="true"></span>
      <strong>Loading events…</strong><span>Fetching matching pump events.</span>
    </div>`;
  }
  if (options.listState === "error") {
    return `<div class="list-message list-error" role="alert" data-list-state="error">
      <strong>Could not load events</strong>
      <span>${escapeHtml(options.errorMessage ?? "Try refreshing the review page.")}</span>
      <a href="${reviewQuery(filters)}">Try again</a>
    </div>`;
  }
  if (events.length === 0) {
    return `<div class="list-message" data-list-state="empty">
      <strong>No matching events</strong>
      <span>Adjust the filters or clear them to see more pump events.</span>
      <a href="/review?status=unreviewed&amp;sort=detectedAtDesc">Reset filters</a>
    </div>`;
  }
  return events
    .map((event) =>
      renderEventRow(event, event.id === selectedId, filters, pagination.page),
    )
    .join("\n");
}

function renderSelectedEvent(event: ReviewEventSummary | null): string {
  if (!event) {
    return `<section class="review-empty" data-selection-state="empty">
      <div aria-hidden="true">↖</div>
      <h2>Select an event to begin</h2>
      <p>Choose a pump event from the list. The first unreviewed event is selected automatically when results are available.</p>
    </section>`;
  }
  const metadata = [event.exchange, event.marketType].filter(Boolean).join(" · ");
  const detectedAtMs = new Date(event.detectedAt).getTime();
  return `<section class="event-context" data-event-context data-event-id="${escapeHtml(event.id)}">
        <header class="event-header">
          <div>
            <p class="eyebrow">Selected event</p>
            <h1>${escapeHtml(event.symbol)}</h1>
            <p>${escapeHtml(metadata)}</p>
          </div>
          <dl>
            <div><dt>Pump time</dt><dd>${formatUtc(event.detectedAt)}</dd></div>
            <div><dt>Event ID</dt><dd title="${escapeHtml(event.id)}">${escapeHtml(event.id)}</dd></div>
          </dl>
        </header>
        ${renderTelegramVotes(event)}
        ${renderReviewChart({
          eventId: event.id,
          detectedAtMs,
          exchange: event.exchange,
          symbol: event.symbol,
          instrumentType: event.marketType,
        })}
      </section>`;
}

export function renderReviewPage(options: ReviewPageOptions = {}): string {
  const events = options.events ?? [];
  const filters: ReviewFilters = { ...DEFAULT_FILTERS, ...options.filters };
  const progress: ReviewProgress = {
    total: options.progress?.total ?? events.length,
    reviewed:
      options.progress?.reviewed ??
      events.filter((event) => event.status === "reviewed").length,
    unreviewed:
      options.progress?.unreviewed ??
      events.filter((event) => event.status === "unreviewed").length,
    unclear:
      options.progress?.unclear ??
      events.filter((event) => event.status === "unclear").length,
  };
  const pagination: ReviewPagination = {
    ...DEFAULT_PAGINATION,
    ...options.pagination,
  };
  const selectedEvent =
    events.find((event) => event.id === options.selectedEventId) ??
    events.find((event) => event.status === "unreviewed") ??
    events[0] ??
    null;
  const selectedId = selectedEvent?.id ?? null;
  const exchanges = uniqueSorted([
    ...(options.filterOptions?.exchanges ?? []),
    ...events.map((event) => event.exchange),
  ]);
  const loadedCount = pagination.loadedCount ?? events.length;
  const loadMore = pagination.hasMore
    ? `<a class="load-more" href="${reviewQuery(filters, { page: pagination.page + 1 })}" data-load-more>Load more events</a>`
    : `<p class="list-end">${loadedCount.toLocaleString()} event${loadedCount === 1 ? "" : "s"} shown</p>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pump Event Review</title>
  <style>
    :root{color-scheme:light;--ink:#17211b;--muted:#68736c;--line:#dce3de;--soft:#f3f6f4;--panel:#fff;--accent:#176b43;--accent-soft:#e5f4eb;--warn:#9a6216;--danger:#a43939;--shadow:0 1px 2px rgba(23,33,27,.06)}
    *{box-sizing:border-box}html,body{height:100%}body{margin:0;background:#eef2ef;color:var(--ink);font:14px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select,textarea{font:inherit;color:inherit}a{color:inherit}.app-shell{height:100%;min-height:640px;display:flex;flex-direction:column;outline:none}.app-bar{height:60px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.96)}.brand{display:flex;align-items:center;gap:11px}.brand-mark{width:30px;height:30px;display:grid;place-items:center;border-radius:8px;background:var(--ink);color:#fff;font-size:16px}.brand strong{display:block;font-size:15px}.brand span,.app-actions>span{font-size:12px;color:var(--muted)}.app-actions{display:flex;align-items:center;gap:10px}.export-menu{position:relative}.export-menu summary{list-style:none;border:1px solid #bdc8c0;border-radius:7px;padding:6px 9px;background:#fff;font-size:11px;font-weight:700;cursor:pointer}.export-menu summary::-webkit-details-marker{display:none}.export-menu>div{position:absolute;z-index:20;top:calc(100% + 8px);right:0;width:210px;display:grid;grid-template-columns:1fr 1fr;gap:6px;border:1px solid var(--line);border-radius:10px;padding:11px;background:#fff;box-shadow:0 10px 30px rgba(23,33,27,.18)}.export-menu strong{grid-column:1/-1;color:var(--muted);font-size:10px;text-transform:uppercase}.export-menu a{border:1px solid var(--line);border-radius:6px;padding:6px;text-align:center;text-decoration:none;font-size:11px;font-weight:700}.export-menu a:hover{background:var(--soft)}.export-feedback{position:absolute;top:calc(100% + 7px);right:0;width:230px;color:var(--danger);font-size:10px;text-align:right}.review-grid{min-height:0;flex:1;display:grid;grid-template-columns:minmax(290px,320px) minmax(520px,1fr) minmax(310px,350px);gap:1px;background:var(--line)}.event-browser,.review-main,.annotation-panel{min-width:0;background:var(--panel)}
    .event-browser{display:flex;flex-direction:column;overflow:hidden}.browser-head{padding:15px 15px 12px;border-bottom:1px solid var(--line)}.browser-title{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px}.browser-title h2,.annotation-panel h2{margin:0;font-size:18px}.browser-title span{color:var(--muted);font-size:12px}.filter-form{display:grid;grid-template-columns:1fr 1fr;gap:8px}.filter-form label{display:grid;gap:4px;color:var(--muted);font-size:11px;font-weight:650;letter-spacing:.02em}.filter-form .span-two{grid-column:1/-1}.search-wrap{display:flex}.search-wrap input{border-radius:7px 0 0 7px}.search-wrap button{width:36px;border:1px solid #bdc8c0;border-left:0;border-radius:0 7px 7px 0;background:var(--soft);cursor:pointer}.filter-form input,.filter-form select,.annotation-panel select,.annotation-panel textarea{width:100%;min-width:0;border:1px solid #bdc8c0;border-radius:7px;background:#fff;padding:7px 8px;outline:none}.filter-form input:focus,.filter-form select:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}.date-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.progress-card{padding:12px 15px;border-bottom:1px solid var(--line);background:#fbfcfb}.progress-summary{display:flex;align-items:baseline;gap:4px;font-size:12px}.progress-summary strong{font-size:16px}.progress-summary span{margin-left:auto;color:var(--accent);font-weight:700}.progress-track{height:5px;margin:8px 0 10px;overflow:hidden;border-radius:99px;background:#dce5df}.progress-track span{display:block;height:100%;background:var(--accent)}.progress-counts{display:grid;grid-template-columns:repeat(3,1fr);margin:0}.progress-counts div+div{border-left:1px solid var(--line);padding-left:10px}.progress-counts dt{color:var(--muted);font-size:10px}.progress-counts dd{margin:1px 0 0;font-size:12px;font-weight:700}.event-list{min-height:0;flex:1;overflow-y:auto}.event-row{position:relative;display:grid;gap:3px;padding:11px 14px 11px 17px;border-bottom:1px solid #e9eeea;text-decoration:none}.event-row:hover{background:var(--soft)}.event-row:focus-visible{z-index:1;outline:2px solid var(--accent);outline-offset:-2px}.event-row.is-selected{background:var(--accent-soft)}.event-row.is-selected:before{position:absolute;inset:0 auto 0 0;width:4px;background:var(--accent);content:""}.event-row-top{display:flex;justify-content:space-between}.telegram-vote-total{border:1px solid #b9d3c4;border-radius:999px;padding:1px 6px;background:#f2faf5;color:var(--accent);font-size:9px;font-weight:800;letter-spacing:.03em}.event-row>span:not(.event-row-top){color:var(--muted);font-size:11px}.event-status{display:flex;align-items:center;gap:5px}.event-status i{width:6px;height:6px;border-radius:50%;background:#a9b2ac}.status-reviewed .event-status i{background:var(--accent)}.status-unclear .event-status i{background:#d69332}.list-footer{flex:none;padding:10px 14px;border-top:1px solid var(--line);background:#fbfcfb}.load-more,.list-message a{display:block;border:1px solid #bdc8c0;border-radius:7px;padding:8px;text-align:center;text-decoration:none;font-weight:650;background:#fff}.list-end{margin:0;color:var(--muted);text-align:center;font-size:11px}.list-message{display:flex;min-height:210px;align-items:center;justify-content:center;flex-direction:column;gap:7px;padding:25px;text-align:center;color:var(--muted)}.list-message strong{color:var(--ink)}.list-message a{margin-top:6px;width:100%;color:var(--ink)}.list-error strong{color:var(--danger)}.spinner{width:22px;height:22px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
    .review-main{overflow:auto}.event-context{min-height:100%;display:flex;flex-direction:column;padding:18px}.event-header{display:flex;justify-content:space-between;gap:24px;padding:2px 2px 16px}.eyebrow{margin:0 0 3px;color:var(--accent);font-size:10px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}.event-header h1{margin:0;font-size:25px;line-height:1.15}.event-header h1+p{margin:5px 0 0;color:var(--muted)}.event-header dl{width:min(50%,360px);margin:0;display:grid;gap:4px}.event-header dl div{display:grid;grid-template-columns:70px minmax(0,1fr);gap:8px}.event-header dt{color:var(--muted);font-size:11px}.event-header dd{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:600}.telegram-votes{display:flex;align-items:center;gap:18px;margin:0 0 14px;padding:10px 12px;border:1px solid var(--line);border-radius:9px;background:#fbfcfb;box-shadow:var(--shadow)}.telegram-votes-heading{display:flex;min-width:145px;align-items:center;justify-content:space-between;gap:12px}.telegram-votes-heading strong{font-size:12px}.telegram-votes-heading>span{color:var(--muted);font-size:10px;white-space:nowrap}.telegram-votes dl{display:grid;grid-template-columns:repeat(3,minmax(70px,1fr));flex:1;margin:0}.telegram-votes dl div{display:flex;align-items:baseline;justify-content:center;gap:7px;border-left:1px solid var(--line)}.telegram-votes dt{color:var(--muted);font-size:10px}.telegram-votes dd{margin:0;font-size:16px;font-weight:800}.telegram-vote-pump dd{color:var(--accent)}.telegram-vote-dump dd{color:var(--danger)}.telegram-vote-none dd{color:var(--warn)}.telegram-votes>p{margin:0;color:var(--muted);font-size:10px}.chart-card{min-height:410px;flex:1;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:10px;background:#fbfcfb;box-shadow:var(--shadow);overflow:hidden}.chart-toolbar{height:52px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 13px;border-bottom:1px solid var(--line);background:#fff}.chart-toolbar strong,.chart-toolbar span{display:block}.chart-toolbar span{margin-top:2px;color:var(--muted);font-size:10px}.timeframe-switch{display:flex}.timeframe-switch button{border:1px solid var(--line);padding:5px 9px;background:#fff;color:var(--muted);cursor:pointer}.timeframe-switch button:first-child{border-radius:6px 0 0 6px}.timeframe-switch button:last-child{margin-left:-1px;border-radius:0 6px 6px 0}.timeframe-switch button.is-active{position:relative;background:var(--accent-soft);color:var(--accent);border-color:#a9cdb8}.timeframe-switch button:focus-visible,.chart-message button:focus-visible,.tradingview-actions a:focus-visible,.tradingview-actions button:focus-visible,.chart-stage:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.timeframe-switch button:disabled{cursor:wait;opacity:.65}.tradingview-tools{position:relative;flex:none;display:grid;grid-template-columns:minmax(180px,1fr) auto;align-items:center;gap:4px 12px;padding:9px 12px;border-bottom:1px solid var(--line);background:#f7faf8;transition:background .15s,border-color .15s}.tradingview-context strong,.tradingview-context span{display:block}.tradingview-context strong{font-size:11px}.tradingview-context span,.tradingview-guidance{color:var(--muted);font-size:9px}.tradingview-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px}.tradingview-actions a,.tradingview-actions button{border:1px solid #bdc8c0;border-radius:6px;padding:5px 8px;background:#fff;color:var(--ink);font-size:10px;font-weight:700;text-decoration:none;cursor:pointer;white-space:nowrap}.tradingview-actions a:hover,.tradingview-actions button:hover{border-color:#89b59b;background:var(--accent-soft)}.tradingview-actions a span{color:var(--accent)}.tradingview-guidance{grid-column:1/-1}.chart-card[data-chart-state="empty"] .tradingview-tools,.chart-card[data-chart-state="error"] .tradingview-tools{background:#fff7e8;border-bottom-color:#e6c98d}.chart-card[data-chart-state="empty"] .tradingview-context strong,.chart-card[data-chart-state="error"] .tradingview-context strong{color:var(--warn)}.chart-stage{position:relative;min-height:330px;flex:1;overflow:hidden;background:#fff;cursor:crosshair;touch-action:none;user-select:none}.chart-stage.is-panning{cursor:grabbing}.chart-stage svg{display:block;width:100%;height:100%;min-height:330px}.chart-tooltip{position:absolute;z-index:3;max-width:calc(100% - 16px);border:1px solid #cbd6ce;border-radius:6px;padding:5px 7px;background:rgba(255,255,255,.96);box-shadow:var(--shadow);color:var(--ink);font-size:9px;font-weight:650;pointer-events:none;white-space:nowrap}.chart-tooltip[hidden]{display:none}.chart-crosshair line{stroke:#69746d;stroke-width:1;stroke-dasharray:3 3;vector-effect:non-scaling-stroke}.chart-message{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;padding:28px;text-align:center;color:var(--muted);background:linear-gradient(rgba(251,252,251,.94),rgba(251,252,251,.94)),linear-gradient(#edf2ee 1px,transparent 1px),linear-gradient(90deg,#edf2ee 1px,transparent 1px);background-size:auto,48px 42px,48px 42px}.chart-message[hidden]{display:none}.chart-message strong{color:var(--ink)}.chart-message button{margin-top:6px;border:1px solid #bdc8c0;border-radius:7px;padding:7px 15px;background:#fff;font-weight:700;cursor:pointer}.chart-footer{height:31px;flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 12px;border-top:1px solid var(--line);background:#fff;color:var(--muted);font-size:9px}.chart-interaction-hint{flex:1;text-align:center}.chart-footer i{display:inline-block;width:8px;height:8px;margin:0 2px 0 7px;border-radius:2px}.chart-footer i:first-child{margin-left:0}.legend-up{background:#198754}.legend-down{background:#c44b45}.legend-volume{background:#9db4a5}.chart-grid line{stroke:#e7ece8;stroke-width:1;vector-effect:non-scaling-stroke}.chart-grid text{fill:#7a847e;font:9px ui-sans-serif,system-ui}.candle-up .candle-wick,.candle-up .candle-body{stroke:#198754;fill:#198754}.candle-down .candle-wick,.candle-down .candle-body{stroke:#c44b45;fill:#c44b45}.candle-wick{stroke-width:1;vector-effect:non-scaling-stroke}.candle-up .volume-bar{fill:#198754;opacity:.25}.candle-down .volume-bar{fill:#c44b45;opacity:.25}.marker-line{vector-effect:non-scaling-stroke}.marker-line.marker-detection{stroke:#a33d2c;stroke-width:2;stroke-dasharray:5 3}.marker-line.marker-followup{stroke:#bf8b7f;stroke-width:1;stroke-dasharray:3 4}.marker-label-bg.marker-detection{fill:#f6ddd7}.marker-label-bg.marker-followup{fill:#faeeeb}.marker-label{font:700 9px ui-sans-serif,system-ui}.marker-label.marker-detection{fill:#7c2c1e}.marker-label.marker-followup{fill:#9a5a4b}.review-empty{height:100%;min-height:400px;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:40px;text-align:center;color:var(--muted)}.review-empty div{font-size:30px;color:var(--accent)}.review-empty h2{margin:12px 0 3px;color:var(--ink)}.review-empty p{max-width:430px;margin:0}
    .annotation-panel{padding:18px 16px;overflow-y:auto}.annotation-panel header{margin-bottom:17px}.annotation-panel fieldset{margin:0;padding:0;border:0}.annotation-panel legend,.field-label{display:block;margin:0 0 7px;font-size:11px;font-weight:750}.category-list{display:grid;gap:7px;margin-bottom:16px}.category-option{display:grid;grid-template-columns:28px 1fr;align-items:center;gap:8px;padding:8px;border:1px solid var(--line);border-radius:8px;background:#fbfcfb;cursor:pointer}.category-option:hover{border-color:#a9cdb8;background:#f7fbf8}.category-option:has(input:checked){border-color:var(--accent);background:var(--accent-soft);box-shadow:0 0 0 1px var(--accent)}.category-option:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}.category-option input{position:absolute;opacity:0}.category-option kbd{width:26px;height:26px;display:grid;place-items:center;border:1px solid #cbd4ce;border-radius:6px;background:#fff;font:700 11px ui-monospace,monospace}.category-option strong,.category-option small{display:block}.category-option small{margin-top:1px;color:var(--muted);font-size:9px}.field-label{margin-top:13px}.field-label span{color:var(--muted);font-weight:400}.annotation-panel textarea{resize:vertical;min-height:82px}.annotation-panel select:focus,.annotation-panel textarea:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}.save-actions{display:grid;grid-template-columns:1fr 1.35fr;gap:8px;margin-top:15px}.save-actions button{border-radius:7px;padding:9px;border:1px solid #bdc8c0;font-weight:700;cursor:pointer}.save-actions button:disabled{cursor:wait;opacity:.7}.save-actions button:focus-visible,.annotation-feedback button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.button-primary{background:var(--accent);color:#fff}.button-secondary{background:#fff}.annotation-panel fieldset:disabled{opacity:.7}.annotation-feedback{display:flex;align-items:center;justify-content:center;gap:8px;min-height:28px;margin:10px 0 0;color:var(--muted);text-align:center;font-size:10px}.annotation-feedback button{border:1px solid #bdc8c0;border-radius:6px;padding:4px 8px;background:#fff;font-weight:700;cursor:pointer}.annotation-panel[data-annotation-state="success"] .annotation-feedback,.annotation-panel[data-annotation-state="no-more"] .annotation-feedback{color:var(--accent);font-weight:700}.annotation-panel[data-annotation-state="error"] .annotation-feedback,.annotation-panel[data-annotation-state="validation-error"] .annotation-feedback{color:var(--danger);font-weight:700}
    .shortcut-help-wrap{position:relative}.shortcut-help-button{border:1px solid #bdc8c0;border-radius:7px;padding:6px 9px;background:#fff;color:var(--ink);font-size:11px;font-weight:700;cursor:pointer}.shortcut-help-button:focus-visible,.shortcut-popover button:focus-visible,.unsaved-dialog button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.shortcut-popover{position:absolute;z-index:20;top:calc(100% + 8px);right:0;width:285px;border:1px solid var(--line);border-radius:10px;padding:12px;background:#fff;box-shadow:0 10px 30px rgba(23,33,27,.18)}.shortcut-popover[hidden]{display:none}.shortcut-popover>div{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.shortcut-popover button{border:0;background:transparent;font-size:20px;line-height:1;cursor:pointer}.shortcut-popover dl{display:grid;gap:5px;margin:0}.shortcut-popover dl div{display:grid;grid-template-columns:128px 1fr;align-items:center}.shortcut-popover dt,.shortcut-popover dd{margin:0;font-size:11px}.shortcut-popover kbd{display:inline-block;border:1px solid #cbd4ce;border-radius:4px;padding:1px 5px;background:var(--soft);font:700 10px ui-monospace,monospace}.unsaved-dialog{width:min(460px,calc(100% - 32px));border:1px solid var(--line);border-radius:12px;padding:0;background:#fff;color:var(--ink);box-shadow:0 20px 60px rgba(23,33,27,.25)}.unsaved-dialog::backdrop{background:rgba(23,33,27,.42)}.unsaved-dialog form{padding:22px}.unsaved-dialog h2{margin:0 0 6px;font-size:20px}.unsaved-dialog p{margin:0;color:var(--muted)}.unsaved-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.unsaved-actions button{border:1px solid #bdc8c0;border-radius:7px;padding:8px 12px;font-weight:700;cursor:pointer}.unsaved-actions .button-danger{background:#fff;color:var(--danger);border-color:#d7aaaa}
    @media (max-width:1050px){.app-shell{height:auto}.review-grid{grid-template-columns:300px minmax(0,1fr)}.annotation-panel{grid-column:1/-1;min-height:auto;border-top:1px solid var(--line)}.annotation-panel fieldset{display:grid;grid-template-columns:1fr 1fr;gap:12px}.category-list{grid-column:1/-1;grid-template-columns:repeat(3,1fr)}.field-label{margin:0}.save-actions{align-self:end}}
    @media (max-width:720px){.app-bar{padding:0 14px}.app-actions>span{display:none}.review-grid{display:block}.event-browser{max-height:none}.event-list{max-height:440px}.review-main{min-height:560px}.event-header{display:block}.event-header dl{width:100%;margin-top:14px}.telegram-votes{display:block}.telegram-votes-heading{width:100%}.telegram-votes dl{margin-top:10px}.telegram-votes dl div:first-child{border-left:0}.telegram-votes>p{margin-top:8px;text-align:center}.tradingview-tools{grid-template-columns:1fr}.tradingview-actions{justify-content:flex-start;flex-wrap:wrap}.tradingview-guidance{grid-column:1}.annotation-panel fieldset{display:block}.category-list{display:grid;grid-template-columns:1fr}.field-label{margin-top:13px}.unsaved-actions{align-items:stretch;flex-direction:column}}
  </style>
</head>
<body>
  <div class="app-shell" data-review-page data-selected-event-id="${selectedId ? escapeHtml(selectedId) : ""}" tabindex="-1">
    <header class="app-bar">
      <div class="brand"><span class="brand-mark" aria-hidden="true">↗</span><div><strong>Pump Event Reviewer</strong><span>Human labeling workspace</span></div></div>
      <div class="app-actions"><span>All timestamps shown in UTC</span>${renderExportMenu(filters)}${renderReviewKeyboardUi()}</div>
    </header>
    <main class="review-grid">
      <aside class="event-browser" aria-label="Event browser">
        <div class="browser-head">
          <div class="browser-title"><h2>Events</h2><span>${progress.total.toLocaleString()} total</span></div>
          <form class="filter-form" action="/review" method="get" data-review-filters>
            <label class="span-two">Symbol search<div class="search-wrap"><input type="search" name="symbol" value="${escapeHtml(filters.symbol)}" placeholder="e.g. FUELUSDT"><button type="submit" aria-label="Search">⌕</button></div></label>
            <label>Status<select name="status">
              <option value="all"${filters.status === "all" ? " selected" : ""}>All</option><option value="unreviewed"${filters.status === "unreviewed" ? " selected" : ""}>Unreviewed</option><option value="reviewed"${filters.status === "reviewed" ? " selected" : ""}>Reviewed</option><option value="unclear"${filters.status === "unclear" ? " selected" : ""}>Unclear</option>
            </select></label>
            <label>Category<select name="category"><option value="all">All categories</option>${CATEGORIES.map((category) => `<option value="${category.value}"${filters.category === category.value ? " selected" : ""}>${category.label}</option>`).join("")}</select></label>
            <label>Exchange<select name="exchange">${renderOptions(exchanges, filters.exchange, "All exchanges")}</select></label>
            <div class="date-pair span-two">
              <label>From<input type="date" name="dateFrom" value="${escapeHtml(filters.dateFrom)}"></label>
              <label>To<input type="date" name="dateTo" value="${escapeHtml(filters.dateTo)}"></label>
            </div>
            <label class="span-two">Sort<select name="sort">
              <option value="detectedAtAsc"${filters.sort === "detectedAtAsc" ? " selected" : ""}>Pump time: oldest first</option><option value="detectedAtDesc"${filters.sort === "detectedAtDesc" ? " selected" : ""}>Pump time: newest first</option><option value="unreviewedFirst"${filters.sort === "unreviewedFirst" ? " selected" : ""}>Unreviewed first</option><option value="symbolAsc"${filters.sort === "symbolAsc" ? " selected" : ""}>Symbol: A–Z</option>
            </select></label>
          </form>
        </div>
        ${renderProgress(progress)}
        <nav class="event-list" aria-label="Matching events" data-event-list>
          ${renderListState(options, events, selectedId, filters, pagination)}
        </nav>
        <footer class="list-footer">${options.listState && options.listState !== "ready" ? "" : loadMore}</footer>
      </aside>
      <section class="review-main" aria-label="Chart and event context">
        ${renderSelectedEvent(selectedEvent)}
      </section>
      ${renderReviewAnnotation(selectedEvent)}
    </main>
  </div>
  <script>
    (() => {
      const form = document.querySelector('[data-review-filters]');
      if (!form) return;
      const navigate = () => {
        const params = new URLSearchParams(new FormData(form));
        for (const [key, value] of [...params.entries()]) {
          if (!String(value).trim() || (key === 'category' && value === 'all')) params.delete(key);
        }
        params.delete('event');
        params.delete('page');
        const href = '/review?' + params.toString();
        const navigationEvent = new CustomEvent('review:navigate-request', {
          cancelable: true, detail: { href }
        });
        if (document.dispatchEvent(navigationEvent)) window.location.assign(href);
      };
      form.addEventListener('submit', (event) => { event.preventDefault(); navigate(); });
      form.querySelectorAll('select,input[type="date"]').forEach((control) => {
        control.addEventListener('change', navigate);
      });
    })();
    (() => {
      const feedback = document.querySelector('[data-export-feedback]');
      document.querySelectorAll('[data-review-export]').forEach((link) => {
        link.addEventListener('click', async (event) => {
          event.preventDefault();
          if (link.getAttribute('aria-busy') === 'true') return;
          link.setAttribute('aria-busy', 'true');
          if (feedback) feedback.textContent = 'Preparing export…';
          try {
            const response = await fetch(link.href, { headers: { accept: link.href.includes('format=csv') ? 'text/csv' : 'application/json' } });
            if (!response.ok) {
              const body = await response.json().catch(() => ({}));
              throw new Error(body && body.error ? body.error.message : 'Export failed');
            }
            const blob = await response.blob();
            const disposition = response.headers.get('content-disposition') || '';
            const match = /filename="([^"]+)"/.exec(disposition);
            const download = document.createElement('a');
            download.href = URL.createObjectURL(blob);
            download.download = match ? match[1] : 'pump-event-reviews';
            download.click();
            URL.revokeObjectURL(download.href);
            if (feedback) feedback.textContent = '';
            document.querySelector('[data-export-menu]')?.removeAttribute('open');
          } catch (error) {
            if (feedback) feedback.textContent = error instanceof Error ? error.message : 'Export failed';
          } finally {
            link.removeAttribute('aria-busy');
          }
        });
      });
    })();
${REVIEW_CHART_CLIENT_SCRIPT}
${REVIEW_ANNOTATION_CLIENT_SCRIPT}
${REVIEW_KEYBOARD_CLIENT_SCRIPT}
  </script>
</body>
</html>`;
}
