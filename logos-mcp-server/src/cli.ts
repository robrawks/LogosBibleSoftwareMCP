#!/usr/bin/env node

import { existsSync } from "fs";
import Database from "better-sqlite3";
import { LOGOS_DATA_DIR, LOGOS_CATALOG_DIR, DB_PATHS, OPTIONAL_DB_NAMES, BIBLIA_API_KEY } from "./config.js";

let ok = true;

console.log("Logos MCP Environment Diagnostics\n");

console.log(`LOGOS_DATA_DIR:    ${LOGOS_DATA_DIR}`);
console.log(`  ${existsSync(LOGOS_DATA_DIR) ? "OK" : "MISSING"}`);

console.log(`LOGOS_CATALOG_DIR: ${LOGOS_CATALOG_DIR}`);
console.log(`  ${existsSync(LOGOS_CATALOG_DIR) ? "OK" : "MISSING"}`);

console.log("\nDatabases:");
for (const [name, path] of Object.entries(DB_PATHS)) {
  const found = existsSync(path);
  const optional = OPTIONAL_DB_NAMES.has(name);
  if (!found && !optional) ok = false;
  const icon = found ? "✓" : optional ? "-" : "✗";
  const note = !found && optional ? "  (optional: not on every Logos version)" : "";
  console.log(`  ${icon} ${name.padEnd(16)} ${path}${note}`);
}

// existsSync alone can't catch an unloadable SQLite driver (e.g. a
// better-sqlite3 ABI mismatch after a Node upgrade) — actually open one DB.
console.log("\nSQLite engine:");
const openable = Object.values(DB_PATHS).find((p) => existsSync(p));
if (openable) {
  try {
    const db = new Database(openable, { readonly: true, fileMustExist: true });
    db.prepare("SELECT 1").get();
    db.close();
    console.log("  ✓ opened a database successfully");
  } catch (err) {
    ok = false;
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.log(`  ✗ cannot open databases: ${msg}`);
    console.log("    (if this mentions ABI/NODE_MODULE_VERSION, run: npm rebuild better-sqlite3)");
  }
} else {
  console.log("  - skipped (no database files found)");
}

// The key is optional: only the Biblia-backed Bible-text tools need it.
console.log(`\nBIBLIA_API_KEY: ${BIBLIA_API_KEY ? "set" : "NOT SET (optional — Bible-text tools need it; Logos-local tools work without it)"}`);

console.log(`\nStatus: ${ok ? "All checks passed" : "Some checks failed"}`);
process.exit(ok ? 0 : 1);
