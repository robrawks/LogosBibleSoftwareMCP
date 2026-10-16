import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { makeFixtureDirs, createDb, cleanupFixtureDirs, type FixtureDirs } from "./helpers/fixtures.js";
import { CATALOG_SCHEMA, READING_PROGRESS_SCHEMA } from "./helpers/schemas.js";
import { startServer, callTool } from "./helpers/server.js";

describe("study-data tools with every store present", () => {
  let dirs: FixtureDirs;
  let client: Client;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(
      join(dirs.catalogDir, "ReadingProgressManager", "readingprogressmanager.db"),
      `${READING_PROGRESS_SCHEMA}
       INSERT INTO ReadingStatus (ResourceId, PercentageRead) VALUES ('LLS:29.48.20', 0.5);
       INSERT INTO ResourceReadingProgress (SyncId, ResourceId, Version, ModifiedDate) VALUES ('s1', 'LLS:29.48.20', 'v1', '2025-03-01T00:00:00Z');`
    );
    createDb(
      join(dirs.catalogDir, "LibraryCatalog", "catalog.db"),
      `${CATALOG_SCHEMA} INSERT INTO Records (ResourceId, Type, Title) VALUES ('LLS:29.48.20', 'text.monograph.commentary.bible', 'The Gospel according to John');`
    );
    client = await startServer(dirs);
  }, 30_000);
  afterAll(async () => {
    await client.close();
    cleanupFixtureDirs(dirs);
  });

  it("lists per-book progress", async () => {
    const { text } = await callTool(client, "get_resource_reading_progress");
    expect(text).toContain("Found 1 books with reading progress");
    expect(text).toContain("- **The Gospel according to John** — 50% read (last read 2025-03-01)");
  });

  it("returns per-book progress as JSON", async () => {
    const { text } = await callTool(client, "get_resource_reading_progress", { format: "json" });
    expect(JSON.parse(text)).toEqual([
      { resourceId: "LLS:29.48.20", title: "The Gospel according to John", percentRead: 50, lastReadDate: "2025-03-01T00:00:00Z" },
    ]);
  });
});

describe("study-data tools with no stores", () => {
  let dirs: FixtureDirs;
  let client: Client;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    client = await startServer(dirs);
  }, 30_000);
  afterAll(async () => {
    await client.close();
    cleanupFixtureDirs(dirs);
  });

  it("says per-book progress is not available, without an error", async () => {
    const result = await callTool(client, "get_resource_reading_progress");
    expect(result.isError).toBe(false);
    expect(result.text).toContain("not available on this Logos version");
  });
});
