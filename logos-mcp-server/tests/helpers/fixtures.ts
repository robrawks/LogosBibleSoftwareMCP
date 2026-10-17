import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { vi } from "vitest";

// Builds throwaway Logos-shaped SQLite databases in a temp dir. Nothing is
// committed (*.db is git-ignored): every database is created at test time.

export interface FixtureDirs {
  root: string;
  /** Stands in for Documents/<profile> (LOGOS_DATA_DIR). */
  dataDir: string;
  /** Stands in for Data/<profile> (LOGOS_CATALOG_DIR). */
  catalogDir: string;
}

/** Creates a temp directory tree mirroring the Logos Documents/Data layout. */
export function makeFixtureDirs(): FixtureDirs {
  const root = mkdtempSync(join(tmpdir(), "logos-mcp-"));
  const dataDir = join(root, "Documents", "test.w14");
  const catalogDir = join(root, "Data", "test.w14");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(catalogDir, { recursive: true });
  return { root, dataDir, catalogDir };
}

/** Creates (or extends) a database file and runs the given SQL against it. */
export function createDb(path: string, sql: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

/**
 * Points config.ts at the fixture dirs and drops cached modules, so the next
 * dynamic `await import(...)` re-evaluates DB_PATHS against them.
 */
export function useFixtureDirs(dirs: FixtureDirs): void {
  vi.stubEnv("LOGOS_DATA_DIR", dirs.dataDir);
  vi.stubEnv("LOGOS_CATALOG_DIR", dirs.catalogDir);
  vi.resetModules();
}

/** Restores env stubs and deletes the fixture directory tree. */
export function cleanupFixtureDirs(dirs: FixtureDirs): void {
  vi.unstubAllEnvs();
  rmSync(dirs.root, { recursive: true, force: true });
}
