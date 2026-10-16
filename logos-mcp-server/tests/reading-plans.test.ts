import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import {
  makeFixtureDirs,
  createDb,
  useFixtureDirs,
  cleanupFixtureDirs,
  type FixtureDirs,
} from "./helpers/fixtures.js";
import { CATALOG_SCHEMA, READING_PLAN_SCHEMA } from "./helpers/schemas.js";
import {
  dotnetGuidBytesToHex,
  formatPlanReference,
  localDate,
} from "../src/services/study-data.js";

type StudyData = typeof import("../src/services/study-data.js");

describe("dotnetGuidBytesToHex", () => {
  it("swaps the first three GUID fields to match ReadingPlanStatus.SyncId", () => {
    // Pair observed on the Logos 54 test install (design doc 2.1).
    const bytes = Buffer.from("46E90AD87173EE419438A1399D19602D", "hex");
    expect(dotnetGuidBytesToHex(bytes)).toBe("d80ae946737141ee9438a1399d19602d");
  });

  it("normalizes a GUID string", () => {
    expect(dotnetGuidBytesToHex("{D80AE946-7371-41EE-9438-A1399D19602D}")).toBe(
      "d80ae946737141ee9438a1399d19602d"
    );
  });

  it("returns null for anything else", () => {
    expect(dotnetGuidBytesToHex(Buffer.from("0102", "hex"))).toBeNull();
    expect(dotnetGuidBytesToHex("not a guid")).toBeNull();
    expect(dotnetGuidBytesToHex(null)).toBeNull();
    expect(dotnetGuidBytesToHex(42)).toBeNull();
  });
});

describe("formatPlanReference", () => {
  it("formats Bible readings with Logos book numbers", () => {
    expect(formatPlanReference("bible+csb2.87.22")).toBe("Revelation 22");
    expect(formatPlanReference("bible+csb2.61.1")).toBe("Matthew 1");
  });

  it("formats page ranges", () => {
    expect(formatPlanReference("page.9-13")).toBe("pp 9-13");
    expect(formatPlanReference("page.9")).toBe("p 9");
  });

  it("returns anything else unchanged", () => {
    expect(formatPlanReference("chapter.3")).toBe("chapter.3");
  });
});

describe("localDate", () => {
  it("formats a date as YYYY-MM-DD in local time", () => {
    expect(localDate(new Date(2025, 0, 9, 23, 30))).toBe("2025-01-09");
  });
});

// Two plans mirror the test install (design doc F16): the CSB plan's last
// completed session has no readings, so the next reading skips ahead; the
// 40 Questions plan has completed session 0 only.
const CSB_SESSIONS = JSON.stringify([
  { date: "2025-01-01", readings: [[{ resourceId: "LLS:CSB", reference: "bible+csb2.61.1" }]] },
  { date: "2025-01-02", readings: [[{ resourceId: "LLS:CSB", reference: "bible+csb2.61.2" }]] },
  { date: "2025-01-03", readings: [] },
  { date: "2025-01-06", readings: [[{ resourceId: "LLS:CSB", reference: "bible+csb2.87.22" }]] },
]);
const BOOK_SESSIONS = JSON.stringify([
  { date: "2025-01-01", readings: [[{ resourceId: "LLS:QSTNSCHRSTNSBLW", reference: "page.3-8" }]] },
  { date: "2025-01-02", readings: [[{ resourceId: "LLS:QSTNSCHRSTNSBLW", reference: "page.9-13" }]] },
  { date: "2025-01-03", readings: [[{ resourceId: "LLS:QSTNSCHRSTNSBLW", reference: "page.14-20" }]] },
]);
const FUTURE_SESSIONS = JSON.stringify([
  { date: "2025-02-01", readings: [[{ resourceId: "LLS:ESV", reference: "bible+esv.19.1" }]] },
]);
const SHORT_SESSIONS = JSON.stringify([
  { date: "2024-01-01", readings: [[{ resourceId: "LLS:ESV", reference: "bible.64.1" }]] },
  { date: "2024-01-02", readings: [[{ resourceId: "LLS:ESV", reference: "bible.64.2" }]] },
]);

const PLAN_ROWS = `
  INSERT INTO ReadingPlanDocuments (DocumentId, Title, Settings, ScheduleId, Sessions, ModifiedDate, IsDeleted) VALUES
    ('doc-csb', 'Read CSB in one year', '{"resourceId":"LLS:CSB","range":{"title":"New Testament"},"startDate":"2025-01-01"}', X'6B3C3A5680EDCE4695F0540727842B7F', '${CSB_SESSIONS}', '2025-01-02T19:43:27-05:00', 0),
    ('doc-book', 'Read 40 Questions', '{"resourceId":"LLS:QSTNSCHRSTNSBLW","startDate":"2025-01-01"}', X'46E90AD87173EE419438A1399D19602D', '${BOOK_SESSIONS}', '2025-01-02T19:46:21-05:00', 0),
    ('doc-new', 'Psalms plan', '{"resourceId":"LLS:ESV"}', X'00112233445566778899AABBCCDDEEFF', '${FUTURE_SESSIONS}', '2025-01-03T00:00:00Z', 0),
    ('doc-odd', 'Odd status', '{"resourceId":"LLS:ESV"}', X'FFEEDDCCBBAA99887766554433221100', '${FUTURE_SESSIONS}', '2025-01-04T00:00:00Z', 0),
    ('doc-done', 'Finished plan', '{"resourceId":"LLS:ESV"}', X'0102030405060708090A0B0C0D0E0F10', '${SHORT_SESSIONS}', '2025-01-05T00:00:00Z', 0),
    ('doc-gone', 'Deleted plan', '{}', X'AA', '[]', '2025-01-06T00:00:00Z', 1);
  INSERT INTO ReadingPlanStatus (SyncId, ReadSessions, ModifiedDate, IsDeleted) VALUES
    ('563a3c6bed8046ce95f0540727842b7f', '2', '2026-02-01T15:01:45-05:00', 0),
    -- Same plan, two rows. The first sorts later as text ("2025-01-03…") but
    -- is earlier in time (19:30Z vs 00:47Z next day), so "latest wins" must
    -- compare instants, not strings (the real store mixes -05:00 and -04:00).
    ('d80ae946737141ee9438a1399d19602d', '2', '2025-01-03T00:30:00+05:00', 0),
    ('d80ae946737141ee9438a1399d19602d', '0', '2025-01-02T19:47:28-05:00', 0),
    ('ccddeeffaabb88997766554433221100', 'abc', '2025-01-04T00:00:00Z', 0),
    ('0403020106050807090a0b0c0d0e0f10', '5', '2025-01-05T00:00:00Z', 0);
`;

describe("getReadingPlans with ReadingPlan.db", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;
  const TODAY = "2025-01-10";

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(join(dirs.dataDir, "Documents", "ReadingPlan", "ReadingPlan.db"), READING_PLAN_SCHEMA + PLAN_ROWS);
    createDb(
      join(dirs.catalogDir, "LibraryCatalog", "catalog.db"),
      `${CATALOG_SCHEMA} INSERT INTO Records (ResourceId, Type, Title) VALUES ('LLS:CSB', 'text.monograph.bible', 'Christian Standard Bible');`
    );
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  const plan = (title: string) => studyData.getReadingPlans(TODAY)?.find((p) => p.title === title);

  it("skips deleted plans", () => {
    expect(studyData.getReadingPlans(TODAY)?.map((p) => p.documentId).sort()).toEqual([
      "doc-book",
      "doc-csb",
      "doc-done",
      "doc-new",
      "doc-odd",
    ]);
  });

  it("treats ReadSessions as the last completed index and skips empty sessions", () => {
    const csb = plan("Read CSB in one year");
    expect(csb).toMatchObject({
      resourceId: "LLS:CSB",
      resourceTitle: "Christian Standard Bible",
      startDate: "2025-01-01",
      sessionsWithReadings: 3,
      sessionsRead: 2,
      daysBehind: 4,
      completed: false,
    });
    expect(csb?.nextReading).toEqual({
      index: 3,
      date: "2025-01-06",
      readings: [{ resourceId: "LLS:CSB", rawReference: "bible+csb2.87.22", reference: "Revelation 22" }],
    });
    expect(csb?.settings).toMatchObject({ range: { title: "New Testament" } });
  });

  it("uses the latest status row and formats page readings", () => {
    const book = plan("Read 40 Questions");
    expect(book?.sessionsRead).toBe(1);
    expect(book?.nextReading?.date).toBe("2025-01-02");
    expect(book?.nextReading?.readings[0].reference).toBe("pp 9-13");
    expect(book?.daysBehind).toBe(8);
  });

  it("treats a plan without a status row as unread and not behind before its first date", () => {
    const fresh = plan("Psalms plan");
    expect(fresh?.sessionsRead).toBe(0);
    expect(fresh?.nextReading?.readings[0].reference).toBe("Psalms 1");
    expect(fresh?.daysBehind).toBeNull();
  });

  it("reports an unparseable ReadSessions raw and leaves progress unknown", () => {
    const odd = plan("Odd status");
    expect(odd).toMatchObject({
      sessionsRead: null,
      unparsedReadSessions: "abc",
      nextReading: null,
      daysBehind: null,
      completed: false,
    });
  });

  it("marks a plan complete when every session is read", () => {
    const done = plan("Finished plan");
    expect(done).toMatchObject({ sessionsRead: 2, nextReading: null, completed: true });
  });
});

describe("getReadingPlans without ReadingPlan.db", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("returns null so callers fall back to the older store", () => {
    expect(studyData.getReadingPlans("2025-01-10")).toBeNull();
  });
});
