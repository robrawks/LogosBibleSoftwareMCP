import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { makeFixtureDirs, createDb, cleanupFixtureDirs, type FixtureDirs } from "./helpers/fixtures.js";
import { CATALOG_SCHEMA } from "./helpers/schemas.js";
import { startServer, callTool } from "./helpers/server.js";

describe("find_passage_resources", () => {
  let dirs: FixtureDirs;
  let client: Client;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(
      join(dirs.catalogDir, "LibraryCatalog", "catalog.db"),
      `${CATALOG_SCHEMA}
       INSERT INTO Records (ResourceId, Type, Title, AbbreviatedTitle, Authors, Series, Traits, CommunityRating, UseCount, ReferenceSupersets) VALUES
         ('LLS:29.48.20', 'text.monograph.commentary.bible', 'The Gospel according to John', 'PNTC Jn', 'Carson, D. A.', 'Pillar New Testament Commentary',
            'commentary-purpose:exegetical\tera:contemporary', 4.4, 4, 'bible.64.1.1-64.21.25'),
         ('LLS:REC64JN', 'text.monograph.commentary.bible', 'John, Volumes 1 & 2', 'REC Jn', 'Phillips, Richard D.', 'Reformed Expository Commentary',
            'commentary-purpose:expositional\tera:contemporary', 3.8, 4, 'bible.64');`
    );
    client = await startServer(dirs);
  }, 30_000);
  afterAll(async () => {
    await client.close();
    cleanupFixtureDirs(dirs);
  });

  it("lists commentaries covering the passage without use counts", async () => {
    const { text } = await callTool(client, "find_passage_resources", { passage: "John 5:1", kind: "commentary" });
    expect(text).toContain("Found 2 resources covering John 5:1");
    expect(text).toContain(
      "- **PNTC Jn** — The Gospel according to John — Carson, D. A. (Pillar New Testament Commentary)\n  Commentary · exegetical · contemporary · rated 4.4 | ID: `LLS:29.48.20`"
    );
    expect(text).toContain("**REC Jn**");
    expect(text).toContain("open_resource");
    expect(text.toLowerCase()).not.toContain("use count");
  });

  it("includes use counts in JSON", async () => {
    const { text } = await callTool(client, "find_passage_resources", { passage: "John 5:1", format: "json" });
    expect(JSON.parse(text)[0]).toMatchObject({ resourceId: "LLS:29.48.20", useCount: 4 });
  });

  it("explains an empty result with the filters used", async () => {
    const { text } = await callTool(client, "find_passage_resources", { passage: "Acts 1:1", kind: "commentary" });
    expect(text).toContain("No commentary resources in the user's library cover Acts 1:1");
  });

  it("reports an unparseable passage as an error", async () => {
    const result = await callTool(client, "find_passage_resources", { passage: "nonsense" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Cannot parse reference");
  });
});
