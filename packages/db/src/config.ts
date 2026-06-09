import { pathToFileURL } from "node:url";
import { resolveRepoPath } from "@screener/core";

export interface DatabaseConfig {
  url: string;
  authToken: string;
}

interface ConfigFile {
  database?: {
    url?: string;
    authToken?: string;
  };
}

export async function loadDatabaseConfig(configPath?: string): Promise<DatabaseConfig> {
  const path = resolveRepoPath(configPath ?? "config.js");
  const mod = await import(pathToFileURL(path).href);
  const cfg = (mod.default ?? mod) as ConfigFile;

  const url = (cfg.database?.url ?? "").trim();
  const authToken = (cfg.database?.authToken ?? "").trim();

  if (!url) {
    throw new Error("Database URL not configured. Set database.url in config.js.");
  }
  if (!authToken) {
    throw new Error("Database auth token not configured. Set database.authToken in config.js.");
  }

  return { url, authToken };
}
