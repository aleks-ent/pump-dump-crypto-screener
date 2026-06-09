import { register } from "tsx/esm/api";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

register();

const dir = dirname(fileURLToPath(import.meta.url));
const ext = fileURLToPath(import.meta.url).endsWith(".ts") ? "ts" : "js";
await import(pathToFileURL(join(dir, `scan-worker-thread.${ext}`)).href);
