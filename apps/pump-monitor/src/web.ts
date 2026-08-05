#!/usr/bin/env node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import {
  createDbClient,
  loadDatabaseConfig,
  PumpRepository,
  PumpReviewRepository,
  type PumpReviewEvent,
  type StoredPump,
} from "@screener/db";
import { resolveRepoPath } from "@screener/core";
import { handleReviewApiRequest, parsePumpEventFilters } from "./review-api.js";
import { handleReviewCandleApiRequest } from "./review-candle-api.js";
import { handleReviewExportRequest } from "./review-export.js";
import {
  renderReviewPage,
  type ReviewEventSummary,
  type ReviewFilters,
} from "./review-page.js";

const DEFAULT_WEB_PORT = 3000;
const DEFAULT_WEB_HOST = "127.0.0.1";
const PUMP_LIMIT = 10;

interface WebCliOptions {
  port?: string;
  host?: string;
}

interface WebConfig {
  port: number;
  host: string;
}

interface ConfigFile {
  web?: {
    port?: string | number;
    host?: string;
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parsePort(value: unknown): number | null {
  const port =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  return port;
}

async function loadConfigFile(): Promise<ConfigFile> {
  const mod = await import(pathToFileURL(resolveRepoPath("config.js")).href);
  return (mod.default ?? mod) as ConfigFile;
}

async function loadWebConfig(opts: WebCliOptions): Promise<WebConfig> {
  const cfg = await loadConfigFile();
  const port =
    parsePort(opts.port) ??
    parsePort(process.env.PORT) ??
    parsePort(cfg.web?.port) ??
    DEFAULT_WEB_PORT;
  const host =
    opts.host?.trim() ||
    process.env.HOST?.trim() ||
    cfg.web?.host?.trim() ||
    DEFAULT_WEB_HOST;
  return { port, host };
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

function reviewSummary({ pump, annotation, status }: PumpReviewEvent): ReviewEventSummary {
  return {
    id: pump.index,
    symbol: pump.symbolNative,
    exchange: pump.leadingExchange,
    detectedAt: pump.startUtc,
    status,
    category: annotation?.category,
    confidence: annotation?.confidence,
    comment: annotation?.comment,
    marketType: pump.instrumentType,
    detectorVersion: null,
    detectorScore: pump.peakScore,
    triggerSummary: `${pump.dominantPhase} · ${pump.durationMinutes}m · ${pump.eventCount} trigger${pump.eventCount === 1 ? "" : "s"}`,
  };
}

function reviewPageFilters(url: URL): Partial<ReviewFilters> {
  return {
    status: (url.searchParams.get("status") ?? "unreviewed") as ReviewFilters["status"],
    category: (url.searchParams.get("category") ?? "all") as ReviewFilters["category"],
    exchange: url.searchParams.get("exchange") ?? "",
    symbol: url.searchParams.get("symbol") ?? "",
    dateFrom: url.searchParams.get("dateFrom") ?? "",
    dateTo: url.searchParams.get("dateTo") ?? "",
    detectorVersion: "",
    sort: (url.searchParams.get("sort") ?? "detectedAtAsc") as ReviewFilters["sort"],
  };
}

async function renderReviewWorkspace(
  url: URL,
  reviewRepo: PumpReviewRepository,
): Promise<string> {
  try {
    const filters = parsePumpEventFilters(url.searchParams);
    const [result, progress] = await Promise.all([
      reviewRepo.listReviewEvents(filters),
      reviewRepo.getReviewStats(),
    ]);
    const events = result.items.map(reviewSummary);
    const selectedEventId = url.searchParams.get("event");
    if (selectedEventId && !events.some((event) => event.id === selectedEventId)) {
      const selected = await reviewRepo.getReviewEvent(selectedEventId);
      if (selected) events.unshift(reviewSummary(selected));
    }
    return renderReviewPage({
      events,
      selectedEventId,
      filters: reviewPageFilters(url),
      progress,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        loadedCount: events.length,
        hasMore: result.page * result.pageSize < result.total,
      },
      listState: "ready",
    });
  } catch (error) {
    return renderReviewPage({
      filters: reviewPageFilters(url),
      listState: "error",
      errorMessage: error instanceof Error ? error.message : "Could not load review events",
    });
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

export function renderPumpsPage(
  pumps: StoredPump[],
  generatedAt: Date = new Date(),
): string {
  const rows =
    pumps.length > 0
      ? pumps.map((pump) => renderPumpRow(pump)).join("\n")
      : `
        <tr>
          <td colspan="7" class="px-4 py-8 text-center text-sm text-zinc-500">No pumps stored yet.</td>
        </tr>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Last 10 Pumps</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-zinc-50 text-zinc-950">
  <main class="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
    <header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold">Last 10 Pumps</h1>
        <p class="mt-1 text-sm text-zinc-600">Updated ${fmtUtc(generatedAt.getTime())} UTC</p>
      </div>
      <a class="inline-flex h-9 w-fit items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-100" href="/">Refresh</a>
    </header>

    <section class="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
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
    </section>
  </main>
</body>
</html>`;
}

function send(
  res: ServerResponse,
  status: number,
  body: string,
  contentType: string,
  headOnly = false,
): void {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(headOnly ? undefined : body);
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  repo: PumpRepository,
  reviewRepo: PumpReviewRepository,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api/market-data/candles") {
    if (await handleReviewCandleApiRequest(req, res, reviewRepo)) return;
  }
  if (url.pathname === "/api/pump-events/export") {
    if (await handleReviewExportRequest(req, res, reviewRepo)) return;
  }
  if (url.pathname.startsWith("/api/pump-events")) {
    if (await handleReviewApiRequest(req, res, reviewRepo)) return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method not allowed\n", "text/plain; charset=utf-8");
    return;
  }

  const headOnly = req.method === "HEAD";
  if (url.pathname === "/healthz") {
    send(res, 200, "ok\n", "text/plain; charset=utf-8", headOnly);
    return;
  }
  if (url.pathname === "/favicon.ico") {
    send(res, 204, "", "text/plain; charset=utf-8", headOnly);
    return;
  }
  if (url.pathname === "/review") {
    send(
      res,
      200,
      await renderReviewWorkspace(url, reviewRepo),
      "text/html; charset=utf-8",
      headOnly,
    );
    return;
  }
  if (url.pathname !== "/" && url.pathname !== "/pumps") {
    send(res, 404, "Not found\n", "text/plain; charset=utf-8", headOnly);
    return;
  }

  const pumps = await repo.listStoredPumps({
    episodeType: "pump",
    limit: PUMP_LIMIT,
  });
  send(
    res,
    200,
    renderPumpsPage(pumps),
    "text/html; charset=utf-8",
    headOnly,
  );
}

export async function createPumpWebServer(
  config: WebConfig,
  log: (message: string) => void = console.error,
): Promise<Server> {
  const dbConfig = await loadDatabaseConfig();
  const client = createDbClient(dbConfig);
  const repo = new PumpRepository(client);
  const reviewRepo = new PumpReviewRepository(client);
  await repo.applySchema();

  const server = createServer((req, res) => {
    void handleRequest(req, res, repo, reviewRepo).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      log(`Web request failed: ${message}`);
      if (!res.headersSent) {
        send(res, 500, "Internal server error\n", "text/plain; charset=utf-8");
      } else {
        res.end();
      }
    });
  });
  server.on("close", () => client.close());

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, config.host);
  });

  return server;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("pump-web")
    .description("Serve a basic HTTP page with the last 10 stored pump episodes")
    .option("--port <port>", "HTTP port (default: 3000)")
    .option("--host <host>", "HTTP bind host (default: 127.0.0.1)");

  program.parse(process.argv.slice(2).filter((arg) => arg !== "--"), {
    from: "user",
  });

  const config = await loadWebConfig(program.opts<WebCliOptions>());
  await createPumpWebServer(config);
  console.error(`Pump web listening on http://${config.host}:${config.port}`);
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint != null && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
