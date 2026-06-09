#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { resolveRepoPath } from "@screener/core";
import {
  groupEventsIntoEpisodes,
  summarizeEpisodes,
  type PumpCandidate,
} from "@screener/pump-detector";
import { printEpisodeSummary } from "./print-summary.js";

const program = new Command();
program
  .description("Print pump/dump episode summary from an existing pump_events.ndjson")
  .option(
    "--input <path>",
    "Raw pump_events.ndjson path",
    "data/market_stats/reports/pump_events.ndjson",
  )
  .option("--summary-limit <n>", "Max episodes to print (0 = all)", "50");

program.parse(process.argv.slice(2).filter((a) => a !== "--"), { from: "user" });
const opts = program.opts<{ input: string; summaryLimit: string }>();

const path = resolveRepoPath(opts.input);
const events: PumpCandidate[] = [];
for (const line of readFileSync(path, "utf-8").split("\n")) {
  if (!line.trim()) continue;
  events.push(JSON.parse(line) as PumpCandidate);
}

const episodes = groupEventsIntoEpisodes(events);
const stats = summarizeEpisodes(episodes, events.length);
const limit = Number(opts.summaryLimit);

printEpisodeSummary(episodes, stats, {
  limit: Number.isFinite(limit) ? limit : 50,
  rawOutputPath: path,
});
