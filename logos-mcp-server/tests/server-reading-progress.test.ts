import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { makeFixtureDirs, createDb, cleanupFixtureDirs, type FixtureDirs } from "./helpers/fixtures.js";
import { READING_PLAN_SCHEMA, READING_LISTS_SCHEMA } from "./helpers/schemas.js";
import { startServer, callTool } from "./helpers/server.js";

const SESSIONS = JSON.stringify([
  { date: "2025-01-01", readings: [[{ resourceId: "LLS:CSB", reference: "bible+csb2.61.1" }]] },
  { date: "2025-01-06", readings: [[{ resourceId: "LLS:CSB", reference: "bible+csb2.87.22" }]] },
]);

describe("get_reading_progress on Logos 54 (plans + empty reading lists)", () => {
  let dirs: FixtureDirs;
  let client: Client;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(
      join(dirs.dataDir, "Documents", "ReadingPlan", "ReadingPlan.db"),
      `${READING_PLAN_SCHEMA}
       INSERT INTO ReadingPlanDocuments (DocumentId, Title, Settings, ScheduleId, Sessions, IsDeleted) VALUES
         ('doc-csb', 'Read CSB in one year', '{"resourceId":"LLS:CSB"}', X'6B3C3A5680EDCE4695F0540727842B7F', '${SESSIONS}', 0);
       INSERT INTO ReadingPlanStatus (SyncId, ReadSessions, IsDeleted) VALUES ('563a3c6bed8046ce95f0540727842b7f', '0', 0);`
    );
    createDb(join(dirs.dataDir, "ReadingLists", "ReadingLists.db"), READING_LISTS_SCHEMA);
    client = await startServer(dirs);
  }, 30_000);
  afterAll(async () => {
    await client.close();
    cleanupFixtureDirs(dirs);
  });

  it("shows each plan's progress and next reading, not the empty older store", async () => {
    const { text } = await callTool(client, "get_reading_progress");
    expect(text).toContain("## Reading Plans");
    expect(text).toContain("- **Read CSB in one year** — LLS:CSB");
    expect(text).toMatch(/1 of 2 sessions read · next: Revelation 22 \(2025-01-06\) · \d+ days behind/);
    expect(text).not.toContain("Reading Lists");
  });

  it("returns both stores as JSON", async () => {
    const { text } = await callTool(client, "get_reading_progress", { format: "json" });
    const data = JSON.parse(text);
    expect(data.readingPlans[0].nextReading.readings[0].rawReference).toBe("bible+csb2.87.22");
    expect(data.readingLists.totalItems).toBe(0);
  });
});

describe("get_reading_progress on an older install (reading lists only)", () => {
  let dirs: FixtureDirs;
  let client: Client;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(
      join(dirs.dataDir, "ReadingLists", "ReadingLists.db"),
      `${READING_LISTS_SCHEMA}
       INSERT INTO ReadingListStatuses (ReadingListPathNormalized, Title, Author, Path, Status) VALUES ('p', 'Church Fathers', 'Logos', 'p', 1);
       INSERT INTO Items (ItemId, ReadingListPathNormalized, IsRead) VALUES ('i1', 'p', 1), ('i2', 'p', 0);`
    );
    client = await startServer(dirs);
  }, 30_000);
  afterAll(async () => {
    await client.close();
    cleanupFixtureDirs(dirs);
  });

  it("falls back to the reading-list output", async () => {
    const { text } = await callTool(client, "get_reading_progress");
    expect(text).toContain("## Reading Lists");
    expect(text).toContain("**Overall**: 1/2 items (50%)");
    expect(text).toContain("- **Church Fathers** by Logos — Active");
    expect(text).not.toContain("## Reading Plans");
  });
});

describe("get_reading_progress with no store", () => {
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

  it("returns an error that points at diagnose", async () => {
    const result = await callTool(client, "get_reading_progress");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("diagnose");
  });
});
