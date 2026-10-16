import Database from "better-sqlite3";
import { existsSync } from "fs";

/**
 * Opens a Logos database read-only.
 *
 * @param path - Absolute path to the SQLite file.
 * @returns A read-only database handle; the caller must close it.
 * @throws Error when the file is missing, so callers can say which store is absent. Never creates or writes a file.
 */
export function openDb(path: string): Database.Database {
  if (!existsSync(path)) {
    throw new Error(`Database not found: ${path}`);
  }
  return new Database(path, { readonly: true, fileMustExist: true });
}

/**
 * Escapes LIKE wildcards in user input so "%" and "_" match literally.
 *
 * @param s - Raw user text.
 * @returns Text with backslash, "%" and "_" backslash-escaped.
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/**
 * Checks whether a table exists. Logos versions differ in which tables exist,
 * so readers pick a code path by checking the schema rather than the Logos version.
 *
 * @param db - An open database handle.
 * @param table - Table name to look for.
 * @returns True when the table exists.
 */
export function hasTable(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return row !== undefined;
}
