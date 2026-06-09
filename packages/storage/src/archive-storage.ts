import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

export function appendArchiveGaps(
  baseDir: string,
  rows: Record<string, unknown>[],
): void {
  if (rows.length === 0) return;
  const path = join(baseDir, "reports", "archive_gaps.ndjson");
  ensureParent(path);
  for (const row of rows) {
    appendFileSync(path, `${JSON.stringify(row)}\n`, "utf-8");
  }
}

export function writeArchiveManifest(
  baseDir: string,
  manifest: Record<string, unknown>,
): string {
  const path = join(baseDir, "reports", "archive_run_manifest.json");
  ensureParent(path);
  writeFileSync(path, JSON.stringify(manifest, null, 2), "utf-8");
  return path;
}

export function appendShardArchiveGaps(
  baseDir: string,
  shardIndex: number,
  shardCount: number,
  rows: Record<string, unknown>[],
): void {
  if (rows.length === 0) return;
  const path = join(baseDir, "reports", `archive_gaps.shard-${shardIndex}-of-${shardCount}.ndjson`);
  ensureParent(path);
  for (const row of rows) {
    appendFileSync(path, `${JSON.stringify(row)}\n`, "utf-8");
  }
}

export function mergeShardArchiveGaps(baseDir: string, shardCount: number): void {
  const reportsDir = join(baseDir, "reports");
  if (!existsSync(reportsDir)) return;
  const pattern = new RegExp(`^archive_gaps\\.shard-\\d+-of-${shardCount}\\.ndjson$`);
  const rows: Record<string, unknown>[] = [];
  for (const name of readdirSync(reportsDir).sort()) {
    if (!pattern.test(name)) continue;
    const src = join(reportsDir, name);
    for (const line of readFileSync(src, "utf-8").split("\n")) {
      if (line.trim().length === 0) continue;
      rows.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  appendArchiveGaps(baseDir, rows);
}

export function appendShardArchiveIncomplete(
  baseDir: string,
  exchange: string,
  shardIndex: number,
  shardCount: number,
  rows: Record<string, unknown>[],
): void {
  if (rows.length === 0) return;
  const path = join(
    baseDir,
    "reports",
    `archive_incomplete.${exchange}.shard-${shardIndex}-of-${shardCount}.ndjson`,
  );
  ensureParent(path);
  for (const row of rows) {
    appendFileSync(path, `${JSON.stringify(row)}\n`, "utf-8");
  }
}

export function mergeShardArchiveIncomplete(
  baseDir: string,
  exchange: string,
  shardCount: number,
): void {
  const reportsDir = join(baseDir, "reports");
  if (!existsSync(reportsDir)) return;
  const pattern = new RegExp(
    `^archive_incomplete\\.${exchange}\\.shard-\\d+-of-${shardCount}\\.ndjson$`,
  );
  const rows: Record<string, unknown>[] = [];
  for (const name of readdirSync(reportsDir).sort()) {
    if (!pattern.test(name)) continue;
    const src = join(reportsDir, name);
    for (const line of readFileSync(src, "utf-8").split("\n")) {
      if (line.trim().length === 0) continue;
      rows.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  if (rows.length === 0) return;
  const path = join(baseDir, "reports", `archive_incomplete.${exchange}.ndjson`);
  ensureParent(path);
  writeFileSync(
    path,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : ""),
    "utf-8",
  );
}

export function appendArchiveIncomplete(
  baseDir: string,
  rows: Record<string, unknown>[],
): void {
  if (rows.length === 0) return;
  const path = join(baseDir, "reports", "archive_incomplete.ndjson");
  ensureParent(path);
  for (const row of rows) {
    appendFileSync(path, `${JSON.stringify(row)}\n`, "utf-8");
  }
}

export function readArchiveIncomplete(baseDir: string): Record<string, unknown>[] {
  const path = join(baseDir, "reports", "archive_incomplete.ndjson");
  if (!existsSync(path)) return [];
  const rows: Record<string, unknown>[] = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (line.trim().length === 0) continue;
    rows.push(JSON.parse(line) as Record<string, unknown>);
  }
  return rows;
}

export function writeArchiveIncompleteReport(
  baseDir: string,
  report: Record<string, unknown>,
): string {
  const path = join(baseDir, "reports", "archive_incomplete_report.json");
  ensureParent(path);
  writeFileSync(path, JSON.stringify(report, null, 2), "utf-8");
  return path;
}
