#!/usr/bin/env node
import { importLegacyPumpIndex } from "./pumps/import-json.js";

importLegacyPumpIndex().catch((err) => {
  console.error(err);
  process.exit(1);
});
