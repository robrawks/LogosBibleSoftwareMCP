import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import {
  makeFixtureDirs,
  createDb,
  useFixtureDirs,
  cleanupFixtureDirs,
  type FixtureDirs,
} from "./helpers/fixtures.js";
import { CATALOG_SCHEMA, READING_PROGRESS_SCHEMA } from "./helpers/schemas.js";

type StudyData = typeof import("../src/services/study-data.js");

// PercentageRead values copied from the test install (fractions of the book).
const PROGRESS_ROWS = `
  INSERT INTO ReadingStatus (ResourceId, PercentageRead) VALUES
    ('LLS:SUMMBBLOT', 0.003177), ('LLS:FNDTNLDOCS', 0.03116), ('LLS:29.48.20', 0.5);
  INSERT INTO ResourceReadingProgress (SyncId, ResourceId, Version, ModifiedDate, IsDeleted) VALUES
    ('s1', 'LLS:SUMMBBLOT', 'v1', '2020-12-31T05:57:16-05:00', 0),
    -- Sorts after s1 as text but is earlier in time (10:30Z vs 10:57Z).
    ('s6', 'LLS:SUMMBBLOT', 'v0', '2020-12-31T06:30:00-04:00', 0),
    ('s2', 'LLS:FNDTNLDOCS', 'v1', '2020-12-31T06:09:13-05:00', 0),
    ('s3', 'LLS:29.48.20', 'v1', '2024-01-01T00:00:00Z', 0),
    ('s4', 'LLS:29.48.20', 'v2', '2025-03-01T00:00:00Z', 0),
    ('s5', 'LLS:29.48.20', 'v3', '2026-01-01T00:00:00Z', 1);
`;
const CATALOG_ROWS = `
  INSERT INTO Records (ResourceId, Type, Title) VALUES
    ('LLS:29.48.20', 'text.monograph.commentary.bible', 'The Gospel according to John'),
    ('LLS:FNDTNLDOCS', 'text.monograph', 'Foundational Documents'),
    ('LLS:SUMMBBLOT', 'text.monograph', 'Summary of the Bible: Old Testament');
`;

describe("getResourceReadingProgress with the reading tracker", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(join(dirs.catalogDir, "ReadingProgressManager", "readingprogressmanager.db"), READING_PROGRESS_SCHEMA + PROGRESS_ROWS);
    createDb(join(dirs.catalogDir, "LibraryCatalog", "catalog.db"), CATALOG_SCHEMA + CATALOG_ROWS);
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("sorts by most recently read, ignoring deleted progress rows", () => {
    const entries = studyData.getResourceReadingProgress();
    expect(entries?.map((e) => e.resourceId)).toEqual(["LLS:29.48.20", "LLS:FNDTNLDOCS", "LLS:SUMMBBLOT"]);
    expect(entries?.[0]).toEqual({
      resourceId: "LLS:29.48.20",
      title: "The Gospel according to John",
      percentRead: 50,
      lastReadDate: "2025-03-01T00:00:00Z",
    });
  });

  it("picks the last-read date by instant, not by text, when UTC offsets differ", () => {
    const summary = studyData.getResourceReadingProgress()?.find((e) => e.resourceId === "LLS:SUMMBBLOT");
    expect(summary?.lastReadDate).toBe("2020-12-31T05:57:16-05:00");
  });

  it("sorts by percent read and reports percents with one decimal", () => {
    const entries = studyData.getResourceReadingProgress({ sort: "percent" });
    expect(entries?.map((e) => e.percentRead)).toEqual([50, 3.1, 0.3]);
  });

  it("filters by resource type label", () => {
    const entries = studyData.getResourceReadingProgress({ type: "commentary" });
    expect(entries?.map((e) => e.resourceId)).toEqual(["LLS:29.48.20"]);
  });

  it("applies the limit after sorting and filtering", () => {
    expect(studyData.getResourceReadingProgress({ sort: "percent", limit: 1 })?.map((e) => e.resourceId)).toEqual([
      "LLS:29.48.20",
    ]);
  });
});

describe("getResourceReadingProgress without the reading tracker", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("returns null", () => {
    expect(studyData.getResourceReadingProgress()).toBeNull();
  });
});
