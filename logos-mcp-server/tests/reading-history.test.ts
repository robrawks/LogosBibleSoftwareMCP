import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import {
  makeFixtureDirs,
  createDb,
  useFixtureDirs,
  cleanupFixtureDirs,
  type FixtureDirs,
} from "./helpers/fixtures.js";
import { HISTORY_SCHEMA } from "./helpers/schemas.js";
import { parseHistoryBookmark } from "../src/services/study-data.js";

type StudyData = typeof import("../src/services/study-data.js");

// Bookmark shapes copied from the Logos 54 test install's history.db.
const LEB_BOOKMARK =
  "Resource|Id=LLS:LEB|Milestone=DataType%3dbible+leb2%7cResource%3dLLS:LEB%7cStartSegment%3d4780730|Position=res/LLS:LEB/2022-04-20T19:37:43Z/4780730|Reference=bible+leb2.65.3.21";

describe("parseHistoryBookmark", () => {
  it("reads the resource ID and reference of a resource visit", () => {
    expect(parseHistoryBookmark(LEB_BOOKMARK)).toEqual({
      kind: "Resource",
      resourceId: "LLS:LEB",
      rawReference: "bible+leb2.65.3.21",
    });
  });

  it("gives guides and searches no resource ID", () => {
    expect(parseHistoryBookmark("Guides|Key=BibleReference%7cref%3dbible.64.5.14|TemplateName=ExegeticalGuide")).toEqual({
      kind: "Guides",
      resourceId: null,
      rawReference: null,
    });
  });

  it("never throws on odd input", () => {
    expect(parseHistoryBookmark("")).toEqual({ kind: "", resourceId: null, rawReference: null });
    expect(parseHistoryBookmark("Resource|Id=|Reference=")).toEqual({ kind: "Resource", resourceId: null, rawReference: null });
  });
});

const HISTORY_ROWS = `
  INSERT INTO History (Id, Title, Subtitle, LastVisited, Bookmark, IsDeleted) VALUES
    ('h1', 'LEB', 'Acts 3:21', '2026-10-15T06:58:20Z', '${LEB_BOOKMARK}', 0),
    ('h2', 'PNTC Jn', 'John 5:1', '2026-10-14T10:00:00Z', 'Resource|Id=LLS:29.48.20|Reference=bible.64.5.1', 0),
    ('h3', 'Exegetical Guide', 'John 5:14', '2026-10-13T09:00:00Z', 'Guides|Key=BibleReference%7cref%3dbible.64.5.14|TemplateName=ExegeticalGuide', 0),
    ('h4', 'LEB', 'Romans 1:1', '2026-10-12T09:00:00Z', 'Resource|Id=LLS:LEB|Reference=bible+leb2.66.1.1', 1),
    ('h5', 'LEB2', 'Genesis 1:1', '2026-10-11T09:00:00Z', 'Resource|Id=LLS:LEB2|Reference=bible.1.1.1', 0);
`;

describe("getReadingHistory with history.db", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(join(dirs.catalogDir, "HistoryManager", "history.db"), HISTORY_SCHEMA + HISTORY_ROWS);
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("lists visits newest first, skipping deleted rows", () => {
    expect(studyData.getReadingHistory()?.map((v) => v.id)).toEqual(["h1", "h2", "h3", "h5"]);
  });

  it("describes each visit", () => {
    const [first] = studyData.getReadingHistory() ?? [];
    expect(first).toEqual({
      id: "h1",
      title: "LEB",
      subtitle: "Acts 3:21",
      lastVisited: "2026-10-15T06:58:20Z",
      kind: "Resource",
      resourceId: "LLS:LEB",
      rawReference: "bible+leb2.65.3.21",
      reference: "Acts 3:21",
    });
  });

  it("filters by date", () => {
    expect(studyData.getReadingHistory({ since: "2026-10-14" })?.map((v) => v.id)).toEqual(["h1", "h2"]);
  });

  it("filters by exact resource ID", () => {
    expect(studyData.getReadingHistory({ resourceId: "LLS:LEB" })?.map((v) => v.id)).toEqual(["h1"]);
  });

  it("applies the limit", () => {
    expect(studyData.getReadingHistory({ limit: 2 })?.map((v) => v.id)).toEqual(["h1", "h2"]);
  });
});

describe("getReadingHistory without history.db", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("returns null", () => {
    expect(studyData.getReadingHistory()).toBeNull();
  });
});
