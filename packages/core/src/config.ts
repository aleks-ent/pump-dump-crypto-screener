import { readFileSync } from "node:fs";
import { parse } from "yaml";

export function loadYaml(path: string | null | undefined): Record<string, unknown> {
  if (!path) return {};
  const raw = readFileSync(path, "utf-8");
  return (parse(raw) as Record<string, unknown>) ?? {};
}
