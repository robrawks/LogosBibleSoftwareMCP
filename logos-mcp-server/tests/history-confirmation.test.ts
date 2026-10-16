import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import { readFileSync, writeFileSync } from "fs";
import {
  makeFixtureDirs,
  createDb,
  useFixtureDirs,
  cleanupFixtureDirs,
  type FixtureDirs,
} from "./helpers/fixtures.js";
import { HISTORY_SCHEMA } from "./helpers/schemas.js";
import type { HistoryTarget } from "../src/types.js";

type StudyData = typeof import("../src/services/study-data.js");

const FAST = { timeoutMs: 60, intervalMs: 10 };

const resource = (resourceId: string, reference?: string): HistoryTarget => ({ kind: "resource", resourceId, reference });
const bibleGuide = (guideTitle: string, reference: string): HistoryTarget => ({
  kind: "guide",
  guideTitle,
  subject: { kind: "bible", reference },
});
const kbGuide = (guideTitle: string, id: string): HistoryTarget => ({ kind: "guide", guideTitle, subject: { kind: "kb", id } });
const factbook = (kbId: string): HistoryTarget => ({ kind: "factbook", kbId });
const search = (query: string, searchKind = "AllSearch"): HistoryTarget => ({ kind: "search", query, searchKind });

// Bookmark, title and subtitle shapes from the Logos 54 test install (design
// doc F12); search bookmarks are trimmed to the fields that matter.
function addRow(path: string, id: string, title: string, subtitle: string, bookmark: string): void {
  createDb(
    path,
    `INSERT INTO History (Id, Title, Subtitle, LastVisited, Bookmark) VALUES
       ('${id}', '${title}', '${subtitle}', '2026-10-15T07:00:00Z', '${bookmark}');`
  );
}

function historyFixture(rows: string): { dirs: FixtureDirs; historyPath: string } {
  const dirs = makeFixtureDirs();
  const historyPath = join(dirs.catalogDir, "HistoryManager", "history.db");
  // WAL, like Logos's own history.db, so test writes and polling reads
  // follow the same locking rules as in real use.
  createDb(historyPath, `PRAGMA journal_mode = WAL; ${HISTORY_SCHEMA} ${rows}`);
  return { dirs, historyPath };
}

// Tests run in order: later ones add and change rows.
describe("history confirmation for resources", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;
  let historyPath: string;

  beforeAll(async () => {
    ({ dirs, historyPath } = historyFixture(
      `INSERT INTO History (Id, Title, Subtitle, LastVisited, Bookmark) VALUES
         ('h1', 'PNTC Jn', 'John 5:14', '2026-10-15T06:58:20Z', 'Resource|Id=LLS:29.48.20|Reference=bible.64.5.14');`
    ));
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("snapshots a resource's existing visits and where Logos is now", () => {
    const pntc = studyData.snapshotHistory(resource("LLS:29.48.20", "John 5:14"));
    expect(pntc?.ids).toEqual(new Set(["h1"]));
    expect(pntc?.alreadyShowing?.id).toBe("h1"); // h1 is the newest row and the same location
    expect(studyData.snapshotHistory(resource("LLS:29.48.20", "John 5:20"))?.alreadyShowing).toBeNull();
    expect(studyData.snapshotHistory(resource("LLS:LEB"))).toEqual({ ids: new Set(), alreadyShowing: null });
  });

  it("does not count a visit that was already there, even from the launch second", async () => {
    const target = resource("LLS:29.48.20", "John 5:20");
    const before = studyData.snapshotHistory(target);
    expect(await studyData.waitForHistoryVisit(target, before, FAST)).toEqual({ status: "unconfirmed" });
  });

  it("reports a location Logos was already showing, which adds no row", async () => {
    const target = resource("LLS:29.48.20", "John 5:14");
    const before = studyData.snapshotHistory(target);
    const r = await studyData.waitForHistoryVisit(target, before, FAST);
    expect(r.status === "already_open" && r.visit.id).toBe("h1");
  });

  it("does not count other resources", async () => {
    const before = studyData.snapshotHistory(resource("LLS:LEB"));
    expect(await studyData.waitForHistoryVisit(resource("LLS:LEB"), before, FAST)).toEqual({ status: "unconfirmed" });
  });

  it("keeps polling until Logos writes a new row", async () => {
    const target = resource("LLS:LEB", "John 5:1");
    const before = studyData.snapshotHistory(target);
    setTimeout(() => {
      addRow(historyPath, "h2", "LEB", "John 5:1", "Resource|Id=LLS:LEB|Reference=bible+leb2.64.5.1");
    }, 50);
    const r = await studyData.waitForHistoryVisit(target, before, { timeoutMs: 3000, intervalMs: 20 });
    expect(r.status).toBe("confirmed");
    if (r.status === "confirmed") {
      expect(r.visit).toMatchObject({ id: "h2", title: "LEB", subtitle: "John 5:1" });
    }
  });

  it("ignores an updated row: Logos bumps LastVisited on the row the user leaves", async () => {
    const target = resource("LLS:29.48.20", "John 5:20");
    const before = studyData.snapshotHistory(target);
    createDb(historyPath, "UPDATE History SET LastVisited = '2026-10-15T07:05:00Z' WHERE Id = 'h1';");
    expect(await studyData.waitForHistoryVisit(target, before, FAST)).toEqual({ status: "unconfirmed" });
  });
});

const EXEGETICAL_JN_5_14 = "Guides|Key=BibleReference%7cref%3dbible.64.5.14|TemplateName=ExegeticalGuide";
const TOPIC_SABBATH = "Guides|Key=Topic%7cref%3dbk.%2525Sabbath|TemplateName=TopicGuide";
const SERMON_STARTER = "Guides|TemplateName=SermonStarterGuide";
const FACTBOOK_MOSES = "Factbook|ReportId=ref:bk.#Moses";
const SEARCH_BAPTISM = "Search|QueryText=baptism|SearchKindName=AllSearch";

// Tests run in order: each adds the row it then expects to be the newest.
describe("history confirmation for guides, Factbook entries and searches", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;
  let historyPath: string;

  beforeAll(async () => {
    ({ dirs, historyPath } = historyFixture(
      `INSERT INTO History (Id, Title, Subtitle, LastVisited, Bookmark) VALUES
         ('g1', 'Exegetical Guide', 'John 5:14', '2026-10-15T06:50:00Z', '${EXEGETICAL_JN_5_14}'),
         ('t1', 'Topic Guide', 'Sabbath', '2026-10-15T06:51:00Z', '${TOPIC_SABBATH}'),
         ('f1', 'Factbook | Moses', '', '2026-10-15T06:52:00Z', '${FACTBOOK_MOSES}'),
         ('s1', 'Search', 'baptism | All', '2026-10-15T06:53:00Z', '${SEARCH_BAPTISM}');`
    ));
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("snapshots the rows of the same kind of target", () => {
    expect(studyData.snapshotHistory(bibleGuide("Exegetical Guide", "Romans 12:1"))?.ids).toEqual(new Set(["g1"]));
    expect(studyData.snapshotHistory(kbGuide("topic guide", "bk.%Rest"))?.ids).toEqual(new Set(["t1"]));
    expect(studyData.snapshotHistory(bibleGuide("Passage Guide", "John 5:14"))?.ids).toEqual(new Set());
    expect(studyData.snapshotHistory(factbook("bk.#David"))?.ids).toEqual(new Set(["f1"]));
    expect(studyData.snapshotHistory(search("grace"))?.ids).toEqual(new Set(["s1"]));
    expect(studyData.snapshotHistory(search("grace", "BooksSearch"))?.ids).toEqual(new Set());
  });

  it("compares a search's query, ignoring case and surrounding spaces", () => {
    expect(studyData.snapshotHistory(search(" Baptism "))?.alreadyShowing?.id).toBe("s1");
    expect(studyData.snapshotHistory(search("faith"))?.alreadyShowing).toBeNull();
    expect(studyData.snapshotHistory(bibleGuide("Exegetical Guide", "John 5:14"))?.alreadyShowing).toBeNull(); // g1 is not the newest row
  });

  it("compares an encoded search query", () => {
    addRow(historyPath, "s2", "Search", "justification by faith | All", "Search|QueryText=justification%20by%20faith|SearchKindName=AllSearch");
    expect(studyData.snapshotHistory(search("justification by faith"))?.alreadyShowing?.id).toBe("s2");
  });

  it("compares a Bible guide's passage and template", () => {
    addRow(historyPath, "g2", "Exegetical Guide", "John 5:14", EXEGETICAL_JN_5_14);
    expect(studyData.snapshotHistory(bibleGuide("Exegetical Guide", "John 5:14"))?.alreadyShowing?.id).toBe("g2");
    expect(studyData.snapshotHistory(bibleGuide("Exegetical Guide", "John 5:15"))?.alreadyShowing).toBeNull();
    expect(studyData.snapshotHistory(bibleGuide("Passage Guide", "John 5:14"))?.alreadyShowing).toBeNull();
  });

  it("compares a topic guide's knowledge-base ID through both encodings", () => {
    addRow(historyPath, "t2", "Topic Guide", "Sabbath", TOPIC_SABBATH);
    expect(studyData.snapshotHistory(kbGuide("Topic Guide", "bk.%Sabbath"))?.alreadyShowing?.id).toBe("t2");
    expect(studyData.snapshotHistory(kbGuide("Topic Guide", "bk.%Rest"))?.alreadyShowing).toBeNull();
  });

  it("treats a Sermon Starter row, which has no subject, as showing any subject", () => {
    addRow(historyPath, "ss1", "Sermon Starter Guide", "", SERMON_STARTER);
    expect(studyData.snapshotHistory(kbGuide("Sermon Starter Guide", "bk.to:DBT-5333"))?.alreadyShowing?.id).toBe("ss1");
  });

  it("compares a Factbook entry's knowledge-base ID", () => {
    addRow(historyPath, "f2", "Factbook | Moses", "", FACTBOOK_MOSES);
    expect(studyData.snapshotHistory(factbook("bk.#Moses"))?.alreadyShowing?.id).toBe("f2");
    expect(studyData.snapshotHistory(factbook("bk.%Moses_Person"))?.alreadyShowing).toBeNull();
  });

  it("compares a Factbook ID whose % Logos stored encoded", () => {
    addRow(historyPath, "f2s", "Factbook | Sabbath", "", "Factbook|ReportId=ref:bk.%25Sabbath");
    expect(studyData.snapshotHistory(factbook("bk.%Sabbath"))?.alreadyShowing?.id).toBe("f2s");
  });

  it("reports an already-showing guide when no row is added", async () => {
    addRow(historyPath, "g3", "Exegetical Guide", "John 5:14", EXEGETICAL_JN_5_14);
    const target = bibleGuide("Exegetical Guide", "John 5:14");
    const before = studyData.snapshotHistory(target);
    const r = await studyData.waitForHistoryVisit(target, before, FAST);
    expect(r.status === "already_open" && r.visit.id).toBe("g3");
  });

  it("confirms a new guide row of the same template", async () => {
    const target = bibleGuide("Exegetical Guide", "Romans 12:1");
    const before = studyData.snapshotHistory(target);
    setTimeout(() => {
      addRow(historyPath, "g4", "Exegetical Guide", "Romans 12:1", "Guides|Key=BibleReference%7cref%3dbible.66.12.1|TemplateName=ExegeticalGuide");
    }, 50);
    const r = await studyData.waitForHistoryVisit(target, before, { timeoutMs: 3000, intervalMs: 20 });
    expect(r.status === "confirmed" && r.visit).toMatchObject({ id: "g4", title: "Exegetical Guide", kind: "Guides" });
  });

  it("does not count a new guide row of another template", async () => {
    const target = bibleGuide("Passage Guide", "John 5:1");
    const before = studyData.snapshotHistory(target);
    addRow(historyPath, "g5", "Exegetical Guide", "John 5:1", "Guides|Key=BibleReference%7cref%3dbible.64.5.1|TemplateName=ExegeticalGuide");
    expect(await studyData.waitForHistoryVisit(target, before, FAST)).toEqual({ status: "unconfirmed" });
  });

  it("confirms a new Factbook row", async () => {
    const target = factbook("bk.#David");
    const before = studyData.snapshotHistory(target);
    addRow(historyPath, "f3", "Factbook | David", "", "Factbook|ReportId=ref:bk.#David");
    const r = await studyData.waitForHistoryVisit(target, before, FAST);
    expect(r.status === "confirmed" && r.visit.id).toBe("f3");
  });

  it("confirms a new search row of the same kind, and only that kind", async () => {
    const all = search("grace");
    const books = search("grace", "BooksSearch");
    const beforeAllSearch = studyData.snapshotHistory(all);
    const beforeBooksSearch = studyData.snapshotHistory(books);
    addRow(historyPath, "s3", "Search", "grace | All", "Search|QueryText=grace|SearchKindName=AllSearch");
    const r = await studyData.waitForHistoryVisit(all, beforeAllSearch, FAST);
    expect(r.status === "confirmed" && r.visit.id).toBe("s3");
    expect(await studyData.waitForHistoryVisit(books, beforeBooksSearch, FAST)).toEqual({ status: "unconfirmed" });
  });
});

describe("history confirmation without history.db", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("cannot snapshot, so confirmation is unavailable", async () => {
    for (const target of [resource("LLS:LEB"), bibleGuide("Passage Guide", "John 5:1"), factbook("bk.#Moses"), search("baptism")]) {
      const before = studyData.snapshotHistory(target);
      expect(before).toBeNull();
      expect(await studyData.waitForHistoryVisit(target, before, FAST)).toEqual({ status: "unavailable" });
    }
  });
});

describe("history confirmation when history.db cannot be read", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;
  let historyPath: string;

  beforeAll(async () => {
    ({ dirs, historyPath } = historyFixture(
      `INSERT INTO History (Id, Title, Subtitle, LastVisited, Bookmark) VALUES
         ('h1', 'LEB', 'John 5:1', '2026-10-15T06:58:20Z', 'Resource|Id=LLS:LEB|Reference=bible+leb2.64.5.1');`
    ));
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("snapshots as null, without throwing, when the file is not a database", () => {
    const good = readFileSync(historyPath);
    try {
      writeFileSync(historyPath, "this is not a sqlite database");
      expect(studyData.snapshotHistory(resource("LLS:LEB", "John 5:1"))).toBeNull();
    } finally {
      writeFileSync(historyPath, good);
    }
  });

  it("treats a failed read while polling as 'not yet' and confirms once the file is readable", async () => {
    const target = resource("LLS:LEB", "John 5:2");
    const before = studyData.snapshotHistory(target);
    expect(before).not.toBeNull();
    const good = readFileSync(historyPath);
    writeFileSync(historyPath, "this is not a sqlite database");
    setTimeout(() => {
      writeFileSync(historyPath, good);
      addRow(historyPath, "h2", "LEB", "John 5:2", "Resource|Id=LLS:LEB|Reference=bible+leb2.64.5.2");
    }, 80);
    const r = await studyData.waitForHistoryVisit(target, before, { timeoutMs: 3000, intervalMs: 20 });
    expect(r.status).toBe("confirmed");
  });

  it("reports unconfirmed, not an error, when the file stays unreadable until the deadline", async () => {
    const target = resource("LLS:LEB", "John 5:3");
    const before = studyData.snapshotHistory(target);
    const good = readFileSync(historyPath);
    writeFileSync(historyPath, "this is not a sqlite database");
    try {
      expect(await studyData.waitForHistoryVisit(target, before, FAST)).toEqual({ status: "unconfirmed" });
    } finally {
      writeFileSync(historyPath, good);
    }
  });
});
