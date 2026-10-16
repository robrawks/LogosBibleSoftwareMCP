import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import { openDb, escapeLike, hasTable } from "../src/services/db.js";
import {
  makeFixtureDirs,
  createDb,
  useFixtureDirs,
  cleanupFixtureDirs,
  type FixtureDirs,
} from "./helpers/fixtures.js";

describe("db helpers", () => {
  let dirs: FixtureDirs;
  let path: string;

  beforeAll(() => {
    dirs = makeFixtureDirs();
    path = join(dirs.root, "sample.db");
    createDb(path, "CREATE TABLE Things (Id integer primary key, Name text);");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("reports whether a table exists", () => {
    const db = openDb(path);
    try {
      expect(hasTable(db, "Things")).toBe(true);
      expect(hasTable(db, "Missing")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("opens databases read-only", () => {
    const db = openDb(path);
    try {
      expect(() => db.exec("INSERT INTO Things (Name) VALUES ('x')")).toThrow(/readonly/i);
    } finally {
      db.close();
    }
  });

  it("throws a descriptive error for a missing file", () => {
    expect(() => openDb(join(dirs.root, "nope.db"))).toThrow("Database not found");
  });

  it("escapes LIKE wildcards and backslashes", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});

describe("fixture harness", () => {
  let dirs: FixtureDirs;

  beforeAll(() => {
    dirs = makeFixtureDirs();
    useFixtureDirs(dirs);
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("points DB_PATHS at the fixture directories", async () => {
    const config = await import("../src/config.js");
    expect(config.DB_PATHS.notes).toBe(join(dirs.dataDir, "NotesToolManager", "notestool.db"));
    expect(config.DB_PATHS.catalog).toBe(join(dirs.catalogDir, "LibraryCatalog", "catalog.db"));
  });
});
