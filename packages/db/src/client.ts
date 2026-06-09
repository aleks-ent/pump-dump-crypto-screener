import { createClient, type Client } from "@libsql/client";
import type { DatabaseConfig } from "./config.js";

export function createDbClient(config: DatabaseConfig): Client {
  return createClient({
    url: config.url,
    authToken: config.authToken,
  });
}

export function createMemoryDbClient(): Client {
  return createClient({ url: ":memory:" });
}
