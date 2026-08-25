#!/usr/bin/env node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import {
  createDbClient,
  loadDatabaseConfig,
  PumpRepository,
  PumpReviewRepository,
  TelegramSubscriberRepository,
  type PumpReviewEvent,
} from "@screener/db";
import { resolveRepoPath } from "@screener/core";
import { pickProbePath, readDiskSpace } from "./disk-space.js";
import { renderIndexPage } from "./index-page.js";
import { handleReviewApiRequest, parsePumpEventFilters } from "./review-api.js";
import { handleReviewCandleApiRequest } from "./review-candle-api.js";
import { handleReviewExportRequest } from "./review-export.js";
import {
  assertSafeReviewExposure,
  authorizeReviewRoute,
  resolveReviewAuthConfig,
  type ReviewAuthConfig,
  type ReviewAuthConfigInput,
} from "./review-auth.js";
import {
  renderReviewPage,
  type ReviewEventSummary,
  type ReviewFilters,
} from "./review-page.js";

const DEFAULT_WEB_PORT = 3000;
const DEFAULT_WEB_HOST = "127.0.0.1";
const PUMP_LIMIT = 10;
const MARKET_DATA_DIR = "data/market_stats";

interface WebCliOptions {
  port?: string;
  host?: string;
}

interface WebConfig {
  port: number;
  host: string;
  reviewAuth?: ReviewAuthConfigInput;
}

interface ConfigFile {
  web?: {
    port?: string | number;
    host?: string;
    reviewAuth?: ReviewAuthConfigInput;
  };
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
  return { port, host, reviewAuth: cfg.web?.reviewAuth };
}

function reviewSummary({
  pump,
  annotation,
  status,
  telegramVotes,
}: PumpReviewEvent): ReviewEventSummary {
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
    telegramVotes,
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
    sort: (url.searchParams.get("sort") ?? "detectedAtDesc") as ReviewFilters["sort"],
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
  subscriberRepo: TelegramSubscriberRepository,
  reviewAuth: ReviewAuthConfig,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!authorizeReviewRoute(req, res, reviewAuth)) return;
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

  const [pumps, disk, subscriberHistory] = await Promise.all([
    repo.listStoredPumps({ episodeType: "pump", limit: PUMP_LIMIT }),
    readDiskSpace(
      pickProbePath([resolveRepoPath(MARKET_DATA_DIR), resolveRepoPath(".")]),
    ),
    subscriberRepo.listHistory(),
  ]);
  send(
    res,
    200,
    renderIndexPage({ pumps, subscriberHistory, generatedAt: new Date(), disk }),
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
  const subscriberRepo = new TelegramSubscriberRepository(client);
  const reviewAuth = resolveReviewAuthConfig(config.reviewAuth);
  assertSafeReviewExposure(config.host, reviewAuth);
  await repo.applySchema();

  const server = createServer((req, res) => {
    void handleRequest(req, res, repo, reviewRepo, subscriberRepo, reviewAuth).catch(
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        log(`Web request failed: ${message}`);
        if (!res.headersSent) {
          send(res, 500, "Internal server error\n", "text/plain; charset=utf-8");
        } else {
          res.end();
        }
      },
    );
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
    .description("Serve the pump and Telegram subscriber dashboard")
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
