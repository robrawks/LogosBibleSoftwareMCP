import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import {
  makeFixtureDirs,
  createDb,
  useFixtureDirs,
  cleanupFixtureDirs,
  type FixtureDirs,
} from "./helpers/fixtures.js";
import { CATALOG_SCHEMA } from "./helpers/schemas.js";

type Catalog = typeof import("../src/services/catalog-reader.js");

describe("getPreferredBibleResourceId with a catalog", () => {
  let dirs: FixtureDirs;
  let catalog: Catalog;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(
      join(dirs.catalogDir, "LibraryCatalog", "catalog.db"),
      `${CATALOG_SCHEMA}
       INSERT INTO Records (ResourceId, Type, Title, UseCount, Availability) VALUES
         ('LLS:LEB', 'text.monograph.bible', 'The Lexham English Bible', 19, 2),
         ('LLS:CSB', 'text.monograph.bible', 'Christian Standard Bible', 8, 2),
         ('LLS:KJV', 'text.bible', 'King James Version', 50, 0),
         ('LLS:PNTCJN', 'text.monograph.commentary.bible', 'The Gospel according to John', 100, 2);`
    );
    useFixtureDirs(dirs);
    catalog = await import("../src/services/catalog-reader.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("picks the most-used Bible the user owns", () => {
    expect(catalog.getPreferredBibleResourceId()).toBe("LLS:LEB");
  });
});

describe("getPreferredBibleResourceId without a catalog", () => {
  let dirs: FixtureDirs;
  let catalog: Catalog;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    useFixtureDirs(dirs);
    catalog = await import("../src/services/catalog-reader.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("returns null", () => {
    expect(catalog.getPreferredBibleResourceId()).toBeNull();
  });
});
