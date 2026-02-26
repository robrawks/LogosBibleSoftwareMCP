#!/usr/bin/env node

import { existsSync } from "fs";
import { LOGOS_DATA_DIR, LOGOS_CATALOG_DIR, DB_PATHS, BIBLIA_API_KEY } from "./config.js";

let ok = true;

console.log("Logos MCP Environment Diagnostics\n");

console.log(`LOGOS_DATA_DIR:    ${LOGOS_DATA_DIR}`);
console.log(`  ${existsSync(LOGOS_DATA_DIR) ? "OK" : "MISSING"}`);

console.log(`LOGOS_CATALOG_DIR: ${LOGOS_CATALOG_DIR}`);
console.log(`  ${existsSync(LOGOS_CATALOG_DIR) ? "OK" : "MISSING"}`);

console.log("\nDatabases:");
for (const [name, path] of Object.entries(DB_PATHS)) {
  const found = existsSync(path);
  if (!found) ok = false;
  const icon = found ? "\u2713" : "\u2717";
  console.log(`  ${icon} ${name.padEnd(14)} ${path}`);
}

console.log(`\nBIBLIA_API_KEY: ${BIBLIA_API_KEY ? "set" : "NOT SET"}`);
if (!BIBLIA_API_KEY) ok = false;

console.log(`\nStatus: ${ok ? "All checks passed" : "Some checks failed"}`);
process.exit(ok ? 0 : 1);
