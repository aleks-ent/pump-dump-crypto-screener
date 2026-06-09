#!/usr/bin/env node
import { bootstrapDatabase } from "./bootstrap.js";

bootstrapDatabase().catch((err) => {
  console.error(err);
  process.exit(1);
});
