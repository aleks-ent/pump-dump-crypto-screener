import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

export function resolveRepoPath(rel: string, root?: string): string {
  if (isAbsolute(rel)) return rel;
  return join(root ?? findRepoRoot(), rel);
}
