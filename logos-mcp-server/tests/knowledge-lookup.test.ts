import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";
import {
  makeFixtureDirs,
  createDb,
  useFixtureDirs,
  cleanupFixtureDirs,
  type FixtureDirs,
} from "./helpers/fixtures.js";
import { AUTOCOMPLETE_SCHEMA } from "./helpers/schemas.js";

type Lookup = typeof import("../src/services/knowledge-lookup.js");

// Entries copied from the Logos 54 test install's AutoComplete.db: "Moses" is
// both a person and a topic; "Healing" is two topics and a preaching theme.
// The Spanish description is inserted first to prove English is preferred.
const ROWS = `
  INSERT INTO Languages (LanguageId, Language) VALUES (1, 'en'), (2, 'es');
  INSERT INTO IconKinds (IconKindId, IconKind) VALUES (1, 'Man'), (12, 'Topic'), (13, 'PreachingTheme');
  INSERT INTO Terms (TermId, Reference, IconKindId, CompletionKind) VALUES
    (1, 'bk.#Moses', 1, 2),
    (2, 'bk.%Moses_Person', 12, 1024),
    (3, 'bk.%Sabbath', 12, 1024),
    (4, 'bk.%healing', 12, 1024),
    (5, 'bk.to:DBT-5333', 13, 1),
    (6, 'bk.%giftOfHealing', 12, 1024);
  INSERT INTO Labels (TermId, IsPrimary, LanguageId, LabelText) VALUES
    (1, 1, 1, 'Moses'), (1, 1, 2, 'Moisés'),
    (2, 1, 1, 'Moses'), (2, 1, 2, 'Moses'),
    (3, 1, 1, 'Sabbath'),
    (4, 1, 1, 'Healing'), (5, 1, 1, 'Healing'), (6, 0, 1, 'Healing');
  INSERT INTO Descriptions (TermId, LanguageId, Description) VALUES
    (1, 2, 'Hombre, Juez'),
    (1, 1, 'Man, Author of Biblical Book, Jewish Leaders, Judge'),
    (2, 1, 'Topic'),
    (3, 1, 'Topic');
`;

describe("knowledge lookup with AutoComplete.db present", () => {
  let dirs: FixtureDirs;
  let lookup: Lookup;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(join(dirs.catalogDir, "AutoComplete", "AutoComplete.db"), AUTOCOMPLETE_SCHEMA + ROWS);
    useFixtureDirs(dirs);
    lookup = await import("../src/services/knowledge-lookup.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("finds every entry for a name, case-insensitively, one per ID", () => {
    expect(lookup.lookupKnowledgeIds("moses")).toEqual([
      { id: "bk.#Moses", label: "Moses", kind: "Man", description: "Man, Author of Biblical Book, Jewish Leaders, Judge" },
      { id: "bk.%Moses_Person", label: "Moses", kind: "Topic", description: "Topic" },
    ]);
  });

  it("returns an empty list for an unknown name", () => {
    expect(lookup.lookupKnowledgeIds("Nobody")).toEqual([]);
  });

  it("matches accented names in any case, which SQLite's NOCASE alone misses", () => {
    // "É" vs "é" is not equal under NOCASE; the Spanish label is "Moisés".
    expect(lookup.lookupKnowledgeIds("MOISÉS").map((e) => e.id)).toEqual(["bk.#Moses"]);
    expect(lookup.lookupKnowledgeIds("moisés").map((e) => e.id)).toEqual(["bk.#Moses"]);
  });

  it("resolves a unique name", () => {
    const r = lookup.resolveKnowledgeId("Sabbath");
    expect(r).toEqual({
      status: "resolved",
      entry: { id: "bk.%Sabbath", label: "Sabbath", kind: "Topic", description: "Topic" },
    });
  });

  it("reports ambiguity with every match", () => {
    const r = lookup.resolveKnowledgeId("Moses");
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") {
      expect(r.matches.map((m) => m.id)).toEqual(["bk.#Moses", "bk.%Moses_Person"]);
    }
  });

  it("reports a missing name", () => {
    expect(lookup.resolveKnowledgeId("Nobody")).toEqual({ status: "not_found" });
  });

  it("passes a knowledge-base ID through without a lookup", () => {
    expect(lookup.resolveKnowledgeId(" bk.#Moses ")).toEqual({
      status: "resolved",
      entry: { id: "bk.#Moses", label: "bk.#Moses", kind: null, description: null },
    });
  });

  it("filters matches by entry kind", () => {
    const r = lookup.resolveKnowledgeId("Healing", { kinds: ["PreachingTheme"] });
    expect(r).toEqual({
      status: "resolved",
      entry: { id: "bk.to:DBT-5333", label: "Healing", kind: "PreachingTheme", description: null },
    });
  });

  describe("resolveGuideTarget", () => {
    it("treats a Bible reference as a Bible target", () => {
      expect(lookup.resolveGuideTarget("Passage Guide", "John 5:1")).toEqual({
        status: "bible",
        reference: "John 5:1",
      });
    });

    it("looks up Topic Guide subjects among topics only", () => {
      const sabbath = lookup.resolveGuideTarget("Topic Guide", "Sabbath");
      expect(sabbath.status === "resolved" && sabbath.entry.id).toBe("bk.%Sabbath");
      const healing = lookup.resolveGuideTarget("topic guide", "Healing");
      expect(healing.status === "ambiguous" && healing.matches.map((m) => m.id)).toEqual([
        "bk.%healing",
        "bk.%giftOfHealing",
      ]);
    });

    it("looks up Sermon Starter Guide subjects among preaching themes", () => {
      const r = lookup.resolveGuideTarget("Sermon Starter Guide", "Healing");
      expect(r.status === "resolved" && r.entry.id).toBe("bk.to:DBT-5333");
    });

    it("accepts a knowledge-base ID for any guide", () => {
      const r = lookup.resolveGuideTarget("Topic Guide", "bk.%Sabbath");
      expect(r.status === "resolved" && r.entry.id).toBe("bk.%Sabbath");
    });

    it("rejects a non-reference for a Bible-reference guide", () => {
      const r = lookup.resolveGuideTarget("Exegetical Guide", "Sabbath");
      expect(r.status).toBe("invalid");
    });
  });
});

describe("knowledge lookup without AutoComplete.db", () => {
  let dirs: FixtureDirs;
  let lookup: Lookup;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    useFixtureDirs(dirs);
    lookup = await import("../src/services/knowledge-lookup.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("explains how to get the lookup table", () => {
    const r = lookup.resolveKnowledgeId("Moses");
    expect(r.status).toBe("unavailable");
    if (r.status === "unavailable") {
      expect(r.message).toMatch(/open Logos once/);
    }
  });

  it("still opens a knowledge-base ID given directly", () => {
    expect(lookup.resolveKnowledgeId("bk.#Moses").status).toBe("resolved");
  });
});

describe("knowledge lookup with an unreadable AutoComplete.db", () => {
  let dirs: FixtureDirs;
  let lookup: Lookup;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    const dbDir = join(dirs.catalogDir, "AutoComplete");
    mkdirSync(dbDir, { recursive: true });
    writeFileSync(join(dbDir, "AutoComplete.db"), "this is not a SQLite database, just text padding ".repeat(50));
    useFixtureDirs(dirs);
    lookup = await import("../src/services/knowledge-lookup.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("says the table could not be read, without telling the user to open Logos", () => {
    const r = lookup.resolveKnowledgeId("Moses");
    expect(r.status).toBe("unavailable");
    if (r.status === "unavailable") {
      expect(r.message).toMatch(/could not be read/);
      expect(r.message).not.toMatch(/open Logos/);
    }
  });
});
