import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { makeFixtureDirs, createDb, cleanupFixtureDirs, type FixtureDirs } from "./helpers/fixtures.js";
import { CATALOG_SCHEMA, READING_PROGRESS_SCHEMA, HISTORY_SCHEMA } from "./helpers/schemas.js";
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
    createDb(
      join(dirs.catalogDir, "HistoryManager", "history.db"),
      `${HISTORY_SCHEMA}
       INSERT INTO History (Id, Title, Subtitle, LastVisited, Bookmark) VALUES
         ('h1', 'LEB', 'Acts 3:21', '2026-10-15T06:58:20Z', 'Resource|Id=LLS:LEB|Reference=bible+leb2.65.3.21'),
         ('h2', 'Bible Word Study', '', '2026-10-15T06:39:32Z', 'Guides|TemplateName=BibleWordStudy');`
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

  it("lists browsing history newest first", async () => {
    const { text } = await callTool(client, "get_reading_history");
    expect(text).toContain("Found 2 visits (newest first, times UTC)");
    expect(text).toContain("- 2026-10-15 06:58 — **LEB** — Acts 3:21\n- 2026-10-15 06:39 — **Bible Word Study**");
  });

  it("rejects a malformed since date", async () => {
    const result = await callTool(client, "get_reading_history", { since: "last week" });
    expect(result.isError).toBe(true);
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

  it("says history is not available, without an error", async () => {
    const result = await callTool(client, "get_reading_history");
    expect(result.isError).toBe(false);
    expect(result.text).toContain("not available on this Logos version");
  });
});
