import { createDbClient } from "./client.js";
import { loadDatabaseConfig } from "./config.js";
import { applySchema } from "./pumps/repository.js";

export async function bootstrapDatabase(): Promise<void> {
  const config = await loadDatabaseConfig();
  const client = createDbClient(config);
  await applySchema(client);
  console.error("Screener database schema applied.");
}
