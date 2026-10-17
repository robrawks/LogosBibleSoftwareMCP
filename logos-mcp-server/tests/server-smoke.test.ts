import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { makeFixtureDirs, createDb, cleanupFixtureDirs, type FixtureDirs } from "./helpers/fixtures.js";
import { NOTES_SCHEMA_LOGOS54 } from "./helpers/schemas.js";
import { startServer, callTool } from "./helpers/server.js";

// One note and one highlight shaped like the Logos 54 test install.
const ROWS = `
  INSERT INTO NoteStyles (NoteStyleId, Name) VALUES (1, 'none'), (2, 'custom:YellowHighlighter');
  INSERT INTO ResourceIds (ResourceIdId, ResourceId) VALUES (1, 'LLS:NIVAC66RO');
  INSERT INTO Notes (NoteId, ExternalId, CreatedDate, ModifiedDate, Kind, ContentRichText, NoteStyleId, AnchorsJson, AnchorResourceIdId, TagsJson, NotebookExternalId) VALUES
    (1, 'n1', '2021-01-14T12:04:37Z', '2021-01-14T12:04:37Z', 0, '<Paragraph><Run Text="Aeneas healed"/></Paragraph>', 1, '[]', NULL, '[]', ''),
    (2, 'h1', '2023-05-24T01:15:39Z', '2023-05-24T01:15:39Z', 1, NULL, 2, '[]', 1, NULL, '');
  INSERT INTO NoteAnchorFacetReferences (NoteId, AnchorIndex, DataTypeId, BibleBook, SortKey, Reference) VALUES
    (1, 0, 1, 65, x'00', 'bible.65.9.35'),
    (2, 0, 1, 66, x'00', 'bible.66.1.8-66.1.15');
`;

describe("server smoke test", () => {
  let dirs: FixtureDirs;
  let client: Client;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(join(dirs.dataDir, "NotesToolManager", "notestool.db"), NOTES_SCHEMA_LOGOS54 + ROWS);
    client = await startServer(dirs);
  }, 30_000);
  afterAll(async () => {
    await client.close();
    cleanupFixtureDirs(dirs);
  });

  it("registers every tool", async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(28);
  });

  it("shows a highlight's verse and date", async () => {
    const { text } = await callTool(client, "get_user_highlights");
    expect(text).toContain("- **custom:YellowHighlighter** — LLS:NIVAC66RO — Romans 1:8-15 (2023-05-24)");
  });

  it("filters notes by a passage stored in the facet table", async () => {
    const { text } = await callTool(client, "get_user_notes", { passage: "Acts 9" });
    expect(text).toContain("anchored to Acts 9:35");
  });

  it("reports optional stores as not present and required ones as missing", async () => {
    const { text } = await callTool(client, "diagnose");
    expect(text).toContain("- **autoComplete**: not present (optional");
    expect(text).toContain("- **favorites**: MISSING");
  });
});
