import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { join } from "path";
import { utimesSync } from "fs";
import {
  makeFixtureDirs,
  createDb,
  useFixtureDirs,
  cleanupFixtureDirs,
  type FixtureDirs,
} from "./helpers/fixtures.js";
import { CATALOG_SCHEMA } from "./helpers/schemas.js";

type Catalog = typeof import("../src/services/catalog-reader.js");

// Rows modeled on the Logos 54 test install's catalog (design doc F11).
const RECORDS = `
  INSERT INTO Records (ResourceId, Type, Title, AbbreviatedTitle, Authors, Series, Traits, CommunityRating, UseCount, ReferenceSupersets, Availability, IsDataset) VALUES
    ('LLS:29.48.20', 'text.monograph.commentary.bible', 'The Gospel according to John', 'PNTC Jn', 'Carson, D. A.', 'Pillar New Testament Commentary',
       'author-denomination-group:bk.%Baptists\tcommentary-purpose:exegetical\tera:contemporary\tsupports-bible', 4.4, 4, 'bible.64.1.1-64.21.25', 2, 0),
    ('LLS:REC64JN', 'text.monograph.commentary.bible', 'John, Volumes 1 & 2', 'REC Jn', 'Phillips, Richard D.', 'Reformed Expository Commentary',
       'commentary-purpose:expositional\tera:contemporary', 3.8, 4, 'bible.64', 2, 0),
    ('LLS:LEB', 'text.monograph.bible', 'The Lexham English Bible', 'LEB', 'Harris, W. Hall, III\tRitzema, Elliot', '',
       'era:contemporary', 3.8, 19, 'bible+leb2.1.1.1-87.22.21', 2, 0),
    ('LLS:FSB', 'text.monograph.study.bible', 'Faithlife Study Bible', 'FSB', 'Barry, John D.', '', '', NULL, 2, 'bible.1.1.1-87.22.21', 2, 0),
    ('LLS:PNTCCOLPHM', 'text.monograph.commentary.bible', 'The Letters to the Colossians and to Philemon', 'PNTC Col/Phm', 'Moo, Douglas J.', 'Pillar New Testament Commentary',
       'commentary-purpose:exegetical', 4.6, 9, 'bible.72.1.1-72.4.18\tbible.78.1.1-78.1.25', 2, 0),
    ('LLS:NOTOWNED', 'text.monograph.commentary.bible', 'Unowned John', 'UJ', '', '', '', NULL, 50, 'bible.64', 0, 0),
    ('LLS:DATASET', 'text.monograph.commentary.bible', 'Dataset John', 'DJ', '', '', '', NULL, 50, 'bible.64', 2, 1),
    ('LLS:FATHERS', 'text.monograph', 'Apostolic Fathers', 'AF', '', '', '', NULL, 50, 'af.1-2', 2, 0);
`;

describe("findPassageResources", () => {
  let dirs: FixtureDirs;
  let catalog: Catalog;
  let catalogPath: string;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    catalogPath = join(dirs.catalogDir, "LibraryCatalog", "catalog.db");
    createDb(catalogPath, CATALOG_SCHEMA + RECORDS);
    useFixtureDirs(dirs);
    catalog = await import("../src/services/catalog-reader.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  const ids = (resources: { resourceId: string }[]) => resources.map((r) => r.resourceId);

  it("lists owned resources covering the passage, commentaries first, then by use and rating", () => {
    expect(ids(catalog.findPassageResources({ passage: "John 5:1" }))).toEqual([
      "LLS:29.48.20",
      "LLS:REC64JN",
      "LLS:LEB",
      "LLS:FSB",
    ]);
  });

  it("filters by kind", () => {
    expect(ids(catalog.findPassageResources({ passage: "John 5:1", kind: "commentary" }))).toEqual([
      "LLS:29.48.20",
      "LLS:REC64JN",
    ]);
    expect(ids(catalog.findPassageResources({ passage: "John 5:1", kind: "study bible" }))).toEqual(["LLS:FSB"]);
  });

  it("filters by commentary purpose", () => {
    expect(ids(catalog.findPassageResources({ passage: "John 5:14", purpose: "exegetical" }))).toEqual([
      "LLS:29.48.20",
    ]);
  });

  it("uses every range a resource covers", () => {
    expect(ids(catalog.findPassageResources({ passage: "Philemon 5", kind: "commentary" }))).toEqual(["LLS:PNTCCOLPHM"]);
    expect(ids(catalog.findPassageResources({ passage: "Colossians 4:18", kind: "commentary" }))).toEqual(["LLS:PNTCCOLPHM"]);
  });

  it("describes each resource", () => {
    const [carson] = catalog.findPassageResources({ passage: "John 5:1", kind: "commentary" });
    expect(carson).toEqual({
      resourceId: "LLS:29.48.20",
      title: "The Gospel according to John",
      abbreviatedTitle: "PNTC Jn",
      authors: "Carson, D. A.",
      series: "Pillar New Testament Commentary",
      kind: "Commentary",
      type: "text.monograph.commentary.bible",
      purpose: "exegetical",
      era: "contemporary",
      communityRating: 4.4,
      useCount: 4,
    });
    const leb = catalog.findPassageResources({ passage: "John 5:1", kind: "bible" })[0];
    expect(leb.authors).toBe("Harris, W. Hall, III; Ritzema, Elliot");
    expect(leb.series).toBeNull();
  });

  it("applies the limit", () => {
    expect(ids(catalog.findPassageResources({ passage: "John 5:1", limit: 1 }))).toEqual(["LLS:29.48.20"]);
  });

  it("throws for a passage it cannot parse", () => {
    expect(() => catalog.findPassageResources({ passage: "not a passage" })).toThrow("Cannot parse reference");
  });

  it("re-reads the catalog when its file changes", () => {
    expect(ids(catalog.findPassageResources({ passage: "Acts 1:1", kind: "commentary" }))).toEqual([]);
    createDb(
      catalogPath,
      "INSERT INTO Records (ResourceId, Type, Title, UseCount, ReferenceSupersets) VALUES ('LLS:ACTS', 'text.monograph.commentary.bible', 'Acts', 1, 'bible.65');"
    );
    const later = new Date(Date.now() + 60_000);
    utimesSync(catalogPath, later, later);
    expect(ids(catalog.findPassageResources({ passage: "Acts 1:1", kind: "commentary" }))).toEqual(["LLS:ACTS"]);
  });

  it("re-reads the catalog when a change is still only in its WAL file", () => {
    // Logos keeps catalog.db in WAL mode: a committed write can stay in
    // catalog.db-wal, leaving the main file's mtime unchanged, until a
    // checkpoint. Autocheckpoint is off so the write stays there.
    const writer = new Database(catalogPath);
    try {
      writer.pragma("journal_mode = WAL");
      writer.pragma("wal_autocheckpoint = 0");
      expect(ids(catalog.findPassageResources({ passage: "Jude 1:3", kind: "commentary" }))).toEqual([]);
      writer.exec(
        "INSERT INTO Records (ResourceId, Type, Title, UseCount, ReferenceSupersets) VALUES ('LLS:JUDE', 'text.monograph.commentary.bible', 'Jude', 1, 'bible.86');"
      );
      expect(ids(catalog.findPassageResources({ passage: "Jude 1:3", kind: "commentary" }))).toEqual(["LLS:JUDE"]);
    } finally {
      writer.close();
    }
  });
});
