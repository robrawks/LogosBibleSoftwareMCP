import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import {
  makeFixtureDirs,
  createDb,
  useFixtureDirs,
  cleanupFixtureDirs,
  type FixtureDirs,
} from "./helpers/fixtures.js";
import { NOTES_SCHEMA_LEGACY, NOTES_SCHEMA_LOGOS54 } from "./helpers/schemas.js";

type Reader = typeof import("../src/services/sqlite-reader.js");

const content = (s: string) => `<Paragraph><Run Text="${s}"/></Paragraph>`;

// Rows mirror the Logos 54 test install: anchors are textRange-only in
// AnchorsJson, and the verse lives in NoteAnchorFacetReferences (design doc
// F2). Kind 0 = note, Kind 1 = highlight.
const LOGOS54_ROWS = `
  INSERT INTO NoteStyles (NoteStyleId, Name) VALUES (1, 'none'), (2, 'custom:YellowHighlighter');
  INSERT INTO ResourceIds (ResourceIdId, ResourceId) VALUES (1, 'LLS:FSB'), (2, 'LLS:NIVAC66RO');
  INSERT INTO Notes (NoteId, ExternalId, CreatedDate, ModifiedDate, Kind, ContentRichText, NoteStyleId, AnchorsJson, AnchorResourceIdId, TagsJson, NotebookExternalId, IsDeleted) VALUES
    (1, 'n1', '2021-01-14T12:04:37Z', '2021-01-14T12:04:37Z', 0, '${content("Aeneas healed")}', 1, '[{"textRange":{"resourceId":"LLS:FSB","offset":6208725,"length":0}}]', 1, '[]', '', 0),
    (2, 'n2', '2022-01-01T00:00:00Z', '2022-01-01T00:00:00Z', 0, '${content("Unanchored thought")}', 1, '[]', NULL, '[]', '', 0),
    (3, 'h1', '2023-05-24T01:15:39Z', '2023-05-24T01:15:39Z', 1, NULL, 2, '[{"textRange":{"resourceId":"LLS:NIVAC66RO","offset":156977,"length":157}}]', 2, NULL, '', 0),
    (4, 'h2', '2023-05-24T01:16:10Z', '2023-05-24T01:16:10Z', 1, NULL, 2, '[]', 2, NULL, '', 1),
    (5, 'n3', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', 0, '${content("Word made flesh")}', 1, '[]', NULL, '[]', '', 0),
    (6, 'n4', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 0, '${content("Tobit note")}', 1, '[]', NULL, '[]', '', 0);
  INSERT INTO NoteAnchorFacetReferences (NoteId, AnchorIndex, DataTypeId, BibleBook, SortKey, Reference) VALUES
    (1, 0, 1, 65, x'00', 'bible.65.9.35'),
    (3, 0, 1, 66, x'00', 'bible.66.1.8-66.1.15'),
    (4, 0, 1, 66, x'00', 'bible.66.1.1-66.1.7'),
    (5, 1, 1, 64, x'00', 'bible.64.1.45'),
    (5, 0, 1, 64, x'00', 'bible.64.1.1'),
    (6, 0, 1, 44, x'00', 'bible.44.1.1');
`;

// Older installs keep the verse inside AnchorsJson and have no facet table.
const LEGACY_ROWS = `
  INSERT INTO NoteStyles (NoteStyleId, Name) VALUES (1, 'highlight');
  INSERT INTO ResourceIds (ResourceIdId, ResourceId) VALUES (1, 'LLS:ESV');
  INSERT INTO Notes (NoteId, ExternalId, CreatedDate, ModifiedDate, Kind, ContentRichText, NoteStyleId, AnchorsJson, AnchorResourceIdId, TagsJson, NotebookExternalId) VALUES
    (1, 'n1', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z', 0, '${content("All things work together")}', NULL, '[{"reference":{"raw":"bible.66.8.28"}}]', NULL, '[{"plain":{"text":"providence"}}]', ''),
    (2, 'h1', '2020-02-01T00:00:00Z', '2020-02-01T00:00:00Z', 1, NULL, 1, '[{"reference":{"raw":"bible+esv.64.3.16"}}]', 1, NULL, '');
`;

describe("notes and highlights on a Logos 54 schema (facet table)", () => {
  let dirs: FixtureDirs;
  let reader: Reader;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(join(dirs.dataDir, "NotesToolManager", "notestool.db"), NOTES_SCHEMA_LOGOS54 + LOGOS54_ROWS);
    useFixtureDirs(dirs);
    reader = await import("../src/services/sqlite-reader.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("labels a note with the verse from the facet table", () => {
    const note = reader.getUserNotes().find((n) => n.externalId === "n1");
    expect(note?.anchorReference).toBe("Acts 9:35");
    expect(note?.anchorRawReferences).toEqual(["bible.65.9.35"]);
  });

  it("lists several anchors in AnchorIndex order", () => {
    const note = reader.getUserNotes().find((n) => n.externalId === "n3");
    expect(note?.anchorReference).toBe("John 1:1; John 1:45");
  });

  it("shows the raw reference for an unmapped book", () => {
    const note = reader.getUserNotes().find((n) => n.externalId === "n4");
    expect(note?.anchorReference).toBe("bible.44.1.1");
  });

  it("leaves unanchored notes without a reference", () => {
    const note = reader.getUserNotes().find((n) => n.externalId === "n2");
    expect(note?.anchorReference).toBeNull();
    expect(note?.anchorRawReferences).toEqual([]);
  });

  it("filters notes by passage using the facet-table verse", () => {
    const notes = reader.getUserNotes({ passage: "Acts 9" });
    expect(notes.map((n) => n.externalId)).toEqual(["n1"]);
  });

  it("applies the limit after the passage filter", () => {
    // n1 is the oldest note; a SQL LIMIT 1 would have returned n4 instead.
    const notes = reader.getUserNotes({ passage: "Acts 9", limit: 1 });
    expect(notes.map((n) => n.externalId)).toEqual(["n1"]);
  });

  it("gives highlights their verse, style and date, skipping deleted ones", () => {
    const highlights = reader.getUserHighlights();
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toMatchObject({
      resourceId: "LLS:NIVAC66RO",
      styleName: "custom:YellowHighlighter",
      reference: "Romans 1:8-15",
      rawReferences: ["bible.66.1.8-66.1.15"],
      syncDate: "2023-05-24T01:15:39Z",
    });
  });
});

describe("notes and highlights on a legacy schema (no facet table)", () => {
  let dirs: FixtureDirs;
  let reader: Reader;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(join(dirs.dataDir, "NotesToolManager", "notestool.db"), NOTES_SCHEMA_LEGACY + LEGACY_ROWS);
    useFixtureDirs(dirs);
    reader = await import("../src/services/sqlite-reader.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("labels notes from AnchorsJson", () => {
    const [note] = reader.getUserNotes();
    expect(note.anchorReference).toBe("Romans 8:28");
    expect(note.anchorRawReferences).toEqual(["bible.66.8.28"]);
    expect(note.tags).toEqual(["providence"]);
  });

  it("filters by passage book name", () => {
    expect(reader.getUserNotes({ passage: "Romans 8" })).toHaveLength(1);
    expect(reader.getUserNotes({ passage: "John 3" })).toHaveLength(0);
  });

  it("labels highlights from AnchorsJson", () => {
    const [highlight] = reader.getUserHighlights();
    expect(highlight.reference).toBe("John 3:16");
    expect(highlight.rawReferences).toEqual(["bible+esv.64.3.16"]);
  });
});
