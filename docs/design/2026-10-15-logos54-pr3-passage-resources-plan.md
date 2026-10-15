# Passage Commentary Finder (PR 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the assistant find which of the user's books cover a Bible passage and open them there, with Logos confirming the open. PR 3 of [2026-10-15-logos54-fixes-and-study-data-design.md](2026-10-15-logos54-fixes-and-study-data-design.md).

**Architecture:** The library catalog records each resource's Bible coverage (`Records.ReferenceSupersets`) and commentary traits (`Records.Traits`). Pure range parsing and containment go in `logos-books.ts`; `find_passage_resources` in `catalog-reader.ts` filters and sorts the catalog, with parsed coverage cached per process keyed by the catalog file's mtime. After launching a resource link, `open_resource` (and `navigate_passage`) poll `history.db` read-only for up to 8 s to confirm Logos really opened it.

**Tech Stack:** TypeScript (strict, ESM), Node ≥ 18, better-sqlite3 (read-only), zod, `@modelcontextprotocol/sdk`, Vitest.

## Summary

Plain-language version: Logos's catalog already says which Bible chapters each of your books covers. This plan reads that to answer "which of my commentaries cover John 5:14?" — commentaries first, the ones you use most on top, filterable by kind (commentary, study Bible…) and purpose (exegetical, expositional…). Opening one is then checked against Logos's own history so the assistant can say "Opened PNTC Jn at John 5:14" or "Logos didn't respond" instead of guessing. One new tool; the count goes from 27 to 28.

## Glossary

| Term | Meaning |
|---|---|
| ReferenceSupersets | Catalog column listing the Bible ranges a resource covers, **tab-separated** on Logos 54: `bible.72.1.1-72.4.18\tbible.78.1.1-78.1.25` (Colossians + Philemon). Non-Bible entries (`af.1-2`, `pseud.3`) are ignored. |
| Open end | A range part without chapter or verse: `bible.64` = all of John; `bible.64.5-64.6` = all of chapters 5–6. |
| Traits | Catalog column of tab-separated `key:value` entries, e.g. `commentary-purpose:exegetical\tera:contemporary\tauthor-denomination-group:bk.%Baptists`. |
| Coverage cache | The parsed catalog rows kept in memory until `catalog.db` or its `catalog.db-wal` file changes (modification time or size). |
| History snapshot | Read just before a link is sent: the `Id`s of the resource's `history.db` rows, and whether Logos is already showing the requested location (the most recently inserted row). |
| History confirmation | A **new** `history.db` row for the resource, one not in the snapshot. Logos inserts a row when it arrives somewhere and only updates `LastVisited` on the row it leaves (observed on Logos 54, 2026-10-15). |
| Already showing | Logos was already at the requested resource and location. Sending the link then adds no history row, so it is reported as such, not as "did not confirm". |

## Global Constraints

- **Depends on PR 1 and PR 2.** PR 2 supplies `json()`/`formatParam` (`src/index.ts`), `resolveLimit` (`src/utils/output.ts`), `getReadingHistory`/`HistoryVisit` (`src/services/study-data.ts`, `src/types.ts`), and the test helpers `startServer`/`callTool` (`tests/helpers/server.ts`) and `HISTORY_SCHEMA` (`tests/helpers/schemas.ts`). PR 1 supplies `parseLogosBibleRef`, `logosBookNumber`, `LogosBibleRange`, `LogosRefPoint` (`src/services/logos-books.ts`), `buildResourceUrl`/`buildPassageUrl`, `launchLogosUrl`, `DISPATCHED_NOTE`/`uiFollowUpHint` (`src/utils/tool-text.ts`), `LOGOS_NOT_RUNNING` (`src/index.ts`), and the fixture helpers and `CATALOG_SCHEMA`.
- All paths below are relative to `logos-mcp-server/`; run every command from that directory.
- Branch: `feature/passage-resources`. Conventional commits with lower-case summaries (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
- TypeScript `strict`, ES modules, `.js` suffix on relative imports; 2-space indent, double quotes, semicolons, trailing commas. No linter exists — match the surrounding code.
- Every database read-only via `openDb`, per call, closed in `finally`; parameterized SQL only. Never write to any Logos file; `history.db` is only ever read.
- Do **not** modify `src/services/screenshot-capture.ts` or the Biblia tools (design non-goals).
- Best-effort parsers never throw.
- No `.db` files committed; fixtures built in a temp dir (column names from the Logos 54 install, synthetic rows).
- `UseCount` is used for sorting only: it appears in JSON, never in text (response-cleanup rule).
- Server tests (`startServer`) are for read tools only — never call `open_resource`, `navigate_passage`, `open_guide` or `open_factbook` through the harness; it would send real links to a running Logos.
- Tool count: **27 → 28**; the new banner is `28. find_passage_resources`.

## Deviations From and Clarifications of the Spec

1. **PR 3 is stacked on PR 2**, not only PR 1: `find_passage_resources` takes `format`, whose `json()` helper and `formatParam` arrive in PR 2. (Branch setup, Task 1)
2. **`ReferenceSupersets` is tab-separated**, not space-separated as the spec says (verified on the test install: `bible.72.1.1-72.4.18<TAB>bible.78.1.1-78.1.25`). The parser splits on any whitespace, so either works. (Task 1)
3. **A chapter-only passage starts at verse 1** for containment (`John 5` ≡ John 5:1), so a commentary whose range begins at 5:1 matches. (Task 1)
4. **`navigate_passage` also confirms via history** in the `current` link style: it now sends a resource link (PR 1), so the same check applies. (Task 3)
5. **Multiple authors** (tab-separated in `Records.Authors`) are shown joined with "; ". (Task 2)
6. **Guide and Factbook replies say the server doesn't check them**, rather than claiming Logos records nothing. On Logos 54 they do add history rows (observed 2026-10-15: `Guides|Key=…|TemplateName=ExegeticalGuide`, `Factbook|ReportId=ref:bk.#Moses`), contrary to F12. Confirming them is possible but left for a follow-up. (Task 3)
7. **Confirmation waits for a new row, not a newer timestamp.** The spec said "a row newer than the launch time". `LastVisited` has whole-second resolution, so an earlier visit in the same second would count (adversarial review). Logos also bumps `LastVisited` on the row the user *leaves*, so a changed timestamp means leaving, not opening (observed on Logos 54, 2026-10-15). The handler snapshots the resource's row `Id`s before launching and waits for an `Id` not in the snapshot. Sending the location Logos is already showing adds no row at all (also observed). So the snapshot also records whether the most recently inserted row is the requested resource and location. That case waits only 2 s and reports "already showing" instead of "did not confirm". (Task 3)
8. **The coverage cache also watches `catalog.db-wal`.** Logos keeps the catalog in WAL mode, so a committed change can sit in the `-wal` file without changing the main file's modification time. The cache key is the modification time and size of both files. `PRAGMA data_version` was considered and rejected: it is only comparable within one connection, and the server opens a new connection per call. (Task 2)
9. **A failed read while polling counts as "not yet".** A transient lock or open failure while Logos writes `history.db` retries at the next interval rather than ending the poll or throwing out of the handler. (Task 3)

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/services/logos-books.ts` | Modify | `parseReferenceSupersets()`, `rangeContains()` |
| `src/services/catalog-reader.ts` | Modify | `parseTraits()`, coverage cache, `findPassageResources()`, `PASSAGE_RESOURCE_KINDS` |
| `src/services/study-data.ts` | Modify | `snapshotHistory()`, `waitForHistoryVisit()` |
| `src/types.ts` | Modify | `PassageResource`, `HistoryConfirmation` |
| `src/utils/tool-text.ts` | Modify | `openConfirmationText()` |
| `src/index.ts` | Modify | Tool 28; confirmation in `open_resource`/`navigate_passage`; guide/Factbook wording |
| `tests/coverage.test.ts`, `tests/passage-resources.test.ts`, `tests/history-confirmation.test.ts` | Create | Unit tests |
| `tests/server-passage-resources.test.ts` | Create | Server test |
| `tests/tool-text.test.ts`, `tests/server-smoke.test.ts` | Modify | New cases; tool count 28 |
| `../README.md`, `../.claude/agents/tool-tester.md` | Modify | Tool 28, usage pattern, prioritization note |

---

### Task 1: Coverage ranges and catalog traits

**Files:**
- Modify: `src/services/logos-books.ts` (append)
- Modify: `src/services/catalog-reader.ts` (append `parseTraits`)
- Create: `tests/coverage.test.ts`

**Interfaces:**
- Consumes: `parseLogosBibleRef`, `LogosBibleRange`, `LogosRefPoint` (PR 1).
- Produces:
  - `parseReferenceSupersets(value: string): LogosBibleRange[]`
  - `rangeContains(range: LogosBibleRange, point: LogosRefPoint): boolean` — `point.chapter`/`point.verse` default to 1.
  - `parseTraits(traits: string): Map<string, string>` — first value per key.

- [ ] **Step 0: Create the branch**

If PR 2 has merged: `git fetch origin && git switch -c feature/passage-resources origin/main`. Otherwise stack on it: `git switch -c feature/passage-resources feature/study-data` (open the PR against `feature/study-data` in Task 4). Then `npm ci && npm test` — all PR 1 and PR 2 tests pass.

- [ ] **Step 1: Write the failing tests**

`tests/coverage.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseReferenceSupersets, rangeContains, parseLogosBibleRef } from "../src/services/logos-books.js";
import { parseTraits } from "../src/services/catalog-reader.js";

// Values copied from the Logos 54 test install's catalog.db (design doc F11).

const range = (raw: string) => {
  const parsed = parseLogosBibleRef(raw);
  if (!parsed) throw new Error(`bad fixture ${raw}`);
  return parsed;
};

describe("parseReferenceSupersets", () => {
  it("splits tab-separated ranges", () => {
    expect(parseReferenceSupersets("bible.72.1.1-72.4.18\tbible.78.1.1-78.1.25")).toEqual([
      { start: { book: 72, chapter: 1, verse: 1 }, end: { book: 72, chapter: 4, verse: 18 } },
      { start: { book: 78, chapter: 1, verse: 1 }, end: { book: 78, chapter: 1, verse: 25 } },
    ]);
  });

  it("also accepts spaces and keeps edition-prefixed ranges", () => {
    expect(parseReferenceSupersets("bible+leb2.1.1.1-87.22.21 bible+kjv.61-87")).toHaveLength(2);
  });

  it("ignores non-Bible entries and empty values", () => {
    expect(parseReferenceSupersets("af.1-2\tpseud.3\tbible.64")).toEqual([{ start: { book: 64 }, end: null }]);
    expect(parseReferenceSupersets("")).toEqual([]);
  });
});

describe("rangeContains", () => {
  it("matches a verse inside a verse range", () => {
    const john = range("bible.64.1.1-64.21.25");
    expect(rangeContains(john, { book: 64, chapter: 5, verse: 14 })).toBe(true);
    expect(rangeContains(john, { book: 64, chapter: 21, verse: 25 })).toBe(true);
    expect(rangeContains(john, { book: 65, chapter: 1, verse: 1 })).toBe(false);
  });

  it("treats a book-only range as the whole book", () => {
    const john = range("bible.64");
    expect(rangeContains(john, { book: 64, chapter: 21, verse: 25 })).toBe(true);
    expect(rangeContains(john, { book: 63, chapter: 24, verse: 53 })).toBe(false);
  });

  it("treats chapter-only ends as whole chapters", () => {
    const chapters = range("bible.64.5-64.6");
    expect(rangeContains(chapters, { book: 64, chapter: 5, verse: 1 })).toBe(true);
    expect(rangeContains(chapters, { book: 64, chapter: 6, verse: 71 })).toBe(true);
    expect(rangeContains(chapters, { book: 64, chapter: 7, verse: 1 })).toBe(false);
    const toChapterEnd = range("bible.64.3.16-64.4");
    expect(rangeContains(toChapterEnd, { book: 64, chapter: 4, verse: 54 })).toBe(true);
    expect(rangeContains(toChapterEnd, { book: 64, chapter: 3, verse: 15 })).toBe(false);
  });

  it("matches a single-verse range exactly", () => {
    const verse = range("bible.64.3.16");
    expect(rangeContains(verse, { book: 64, chapter: 3, verse: 16 })).toBe(true);
    expect(rangeContains(verse, { book: 64, chapter: 3, verse: 17 })).toBe(false);
  });

  it("treats a chapter-only passage as starting at verse 1", () => {
    expect(rangeContains(range("bible.64.5.1-64.5.47"), { book: 64, chapter: 5 })).toBe(true);
  });

  it("matches cross-book ranges", () => {
    const peter = range("bible.81.1.1-82.3.18");
    expect(rangeContains(peter, { book: 82, chapter: 1, verse: 5 })).toBe(true);
    expect(rangeContains(peter, { book: 83, chapter: 1, verse: 1 })).toBe(false);
  });
});

describe("parseTraits", () => {
  it("reads tab-separated key:value traits, keeping the first value per key", () => {
    const traits = parseTraits(
      "author-denomination-group:bk.%Anglicanism_Belief\tauthor-denomination-group:bk.%Presbyterianism\tcommentary-purpose:concise\tera:reformation\tsupports-bible"
    );
    expect(traits.get("commentary-purpose")).toBe("concise");
    expect(traits.get("era")).toBe("reformation");
    expect(traits.get("author-denomination-group")).toBe("bk.%Anglicanism_Belief");
    expect(traits.has("supports-bible")).toBe(false);
  });

  it("returns an empty map for an empty value", () => {
    expect(parseTraits("").size).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/coverage.test.ts`
Expected: FAIL — `parseReferenceSupersets`, `rangeContains`, `parseTraits` are not exported.

- [ ] **Step 3: Implement the range helpers**

Append to `src/services/logos-books.ts`:

```typescript
// ─── Coverage ranges ─────────────────────────────────────────────────────────

// Bible ranges from a catalog ReferenceSupersets value. Entries are
// tab-separated on Logos 54 (split on any whitespace); non-Bible entries such
// as "af.1-2" are skipped. Never throws.
export function parseReferenceSupersets(value: string): LogosBibleRange[] {
  return value
    .split(/\s+/)
    .filter((entry) => entry.length > 0)
    .map((entry) => parseLogosBibleRef(entry))
    .filter((r): r is LogosBibleRange => r !== null);
}

type RefKey = [number, number, number];

// Missing chapter/verse parts are open: at a range's start they mean "from the
// beginning" (0), at its end "to the end" (Infinity).
function rangeKey(p: LogosRefPoint, edge: "start" | "end"): RefKey {
  const open = edge === "start" ? 0 : Number.POSITIVE_INFINITY;
  return [p.book, p.chapter ?? open, p.verse ?? open];
}

function compareKeys(a: RefKey, b: RefKey): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

// Whether a Bible location falls inside a Logos range. A location without a
// chapter or verse counts as chapter/verse 1 (so "John 5" = John 5:1).
export function rangeContains(range: LogosBibleRange, point: LogosRefPoint): boolean {
  const at: RefKey = [point.book, point.chapter ?? 1, point.verse ?? 1];
  const end = range.end ?? range.start;
  return compareKeys(rangeKey(range.start, "start"), at) <= 0 && compareKeys(at, rangeKey(end, "end")) <= 0;
}
```

- [ ] **Step 4: Implement `parseTraits`**

Append to `src/services/catalog-reader.ts`:

```typescript
// ─── Catalog traits ─────────────────────────────────────────────────────────

// Records.Traits is tab-separated "key:value" entries (plus bare flags such as
// "supports-bible", which are skipped). Keeps the first value per key.
export function parseTraits(traits: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of traits.split("\t")) {
    const colon = entry.indexOf(":");
    if (colon <= 0) continue;
    const key = entry.slice(0, colon);
    if (!map.has(key)) map.set(key, entry.slice(colon + 1));
  }
  return map;
}
```

- [ ] **Step 5: Run the tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS; `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/services/logos-books.ts src/services/catalog-reader.ts tests/coverage.test.ts
git commit -m "feat: parse catalog bible coverage ranges and resource traits"
```

---

### Task 2: `find_passage_resources`

**Files:**
- Modify: `src/types.ts` ("Catalog Types": `PassageResource`)
- Modify: `src/services/catalog-reader.ts` (coverage cache and finder)
- Create: `tests/passage-resources.test.ts`
- Create: `tests/server-passage-resources.test.ts`
- Modify: `tests/server-smoke.test.ts` (count 28)
- Modify: `tests/server-json.test.ts` (`READ_TOOLS` gains the new tool)
- Modify: `src/index.ts` (block 28)

**Interfaces:**
- Consumes: Task 1; `logosBookNumber`, `openDb` (PR 1); `parseReference` (`reference-parser.ts`); `resolveTypeFilter`, `typeLabel` (existing); `json`, `formatParam`, `resolveLimit` (PR 2).
- Produces:
  - `interface PassageResource { resourceId; title; abbreviatedTitle: string | null; authors: string | null; series: string | null; kind: string; type: string; purpose: string | null; era: string | null; communityRating: number | null; useCount: number }`
  - `PASSAGE_RESOURCE_KINDS: Record<PassageResourceKind, string>`; `type PassageResourceKind = "commentary" | "study bible" | "cross-references" | "bible" | "harmony"`
  - `findPassageResources(options: { passage: string; kind?: PassageResourceKind; purpose?: string; limit?: number }): PassageResource[]` — throws for an unparseable passage or a missing catalog.
  - Tool `find_passage_resources` (`passage`, `kind`, `purpose`, `limit`, `format`).

- [ ] **Step 1: Write the failing unit tests**

`tests/passage-resources.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/passage-resources.test.ts`
Expected: FAIL — `findPassageResources is not a function`.

- [ ] **Step 3: Add the type**

In `src/types.ts`, add to "Catalog Types":

```typescript
export interface PassageResource {
  resourceId: string;
  title: string;
  abbreviatedTitle: string | null;
  /** Authors joined with "; " (null when the catalog lists none). */
  authors: string | null;
  series: string | null;
  /** Human type label, e.g. "Commentary", "Study Bible". */
  kind: string;
  /** Raw dotted catalog type. */
  type: string;
  /** commentary-purpose trait, e.g. "exegetical". */
  purpose: string | null;
  /** era trait, e.g. "contemporary". */
  era: string | null;
  communityRating: number | null;
  /** How often the user opened it; used for sorting, shown only in JSON. */
  useCount: number;
}
```

- [ ] **Step 4: Implement the finder**

In `src/services/catalog-reader.ts`, extend the imports:

```typescript
import { statSync } from "fs";
import { parseReference } from "./reference-parser.js";
import { logosBookNumber, parseReferenceSupersets, rangeContains, type LogosBibleRange } from "./logos-books.js";
import type { CatalogResource, ResourceTypeSummary, PassageResource } from "../types.js";
```

Append:

```typescript
// ─── Passage coverage ───────────────────────────────────────────────────────

export type PassageResourceKind = "commentary" | "study bible" | "cross-references" | "bible" | "harmony";

// find_passage_resources kinds -> the TYPE_LABELS label that carries them.
export const PASSAGE_RESOURCE_KINDS: Record<PassageResourceKind, string> = {
  commentary: "Commentary",
  "study bible": "Study Bible",
  "cross-references": "Cross-References",
  bible: "Bible",
  harmony: "Harmony",
};

interface CoverageRecord {
  resource: PassageResource;
  ranges: LogosBibleRange[];
}

// Parsed coverage of every owned resource, kept until catalog.db changes.
let coverageCache: { path: string; version: string; records: CoverageRecord[] } | null = null;

// The catalog's on-disk version. Logos writes catalog.db in WAL mode, so a
// committed change can sit in catalog.db-wal without touching the main file;
// both files' mtime and size count. (PRAGMA data_version only compares within
// one connection, and each call opens a new one.)
function catalogVersion(path: string): string {
  const part = (p: string) => {
    try {
      const s = statSync(p);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return "-"; // no -wal file (checkpointed, or not in WAL mode)
    }
  };
  return `${part(path)}|${part(`${path}-wal`)}`;
}

function emptyToNull(s: string | null): string | null {
  return s && s.length > 0 ? s : null;
}

function loadCoverageRecords(): CoverageRecord[] {
  const path = DB_PATHS.catalog;
  const db = openDb(path); // throws "Database not found" when missing
  try {
    const version = catalogVersion(path);
    if (coverageCache && coverageCache.path === path && coverageCache.version === version) {
      return coverageCache.records;
    }
    const rows = db.prepare(`
      SELECT ResourceId, Title, AbbreviatedTitle, Type, Authors, Series, Traits,
             CommunityRating, UseCount, ReferenceSupersets
      FROM Records
      WHERE Availability >= 1 AND IsDataset = 0 AND ReferenceSupersets <> ''
    `).all() as Array<{
      ResourceId: string;
      Title: string;
      AbbreviatedTitle: string | null;
      Type: string;
      Authors: string | null;
      Series: string | null;
      Traits: string | null;
      CommunityRating: number | null;
      UseCount: number;
      ReferenceSupersets: string;
    }>;

    const records: CoverageRecord[] = [];
    for (const r of rows) {
      const ranges = parseReferenceSupersets(r.ReferenceSupersets);
      if (ranges.length === 0) continue;
      const traits = parseTraits(r.Traits ?? "");
      const authors = (r.Authors ?? "").split("\t").filter((a) => a.length > 0);
      records.push({
        ranges,
        resource: {
          resourceId: r.ResourceId,
          title: r.Title,
          abbreviatedTitle: emptyToNull(r.AbbreviatedTitle),
          authors: authors.length > 0 ? authors.join("; ") : null,
          series: emptyToNull(r.Series),
          kind: typeLabel(r.Type),
          type: r.Type,
          purpose: traits.get("commentary-purpose") ?? null,
          era: traits.get("era") ?? null,
          communityRating: r.CommunityRating,
          useCount: r.UseCount,
        },
      });
    }
    coverageCache = { path, version, records };
    return records;
  } finally {
    db.close();
  }
}

// Owned resources whose catalog coverage includes the passage's first verse.
// Commentaries first, then most-used, then highest community rating. The
// order differs from the user's Passage Guide prioritization, which Logos
// does not store locally (design doc F18). Throws for an unparseable passage
// or a missing catalog.
export function findPassageResources(options: {
  passage: string;
  kind?: PassageResourceKind;
  purpose?: string;
  limit?: number;
}): PassageResource[] {
  const ref = parseReference(options.passage);
  const book = logosBookNumber(ref.book);
  if (book === null) throw new Error(`No Logos book number for "${ref.book}"`);
  const point = { book, chapter: ref.chapter, verse: ref.verse };
  const rawTypes = options.kind ? resolveTypeFilter(PASSAGE_RESOURCE_KINDS[options.kind]) : null;

  const matches = loadCoverageRecords()
    .filter((r) => r.ranges.some((range) => rangeContains(range, point)))
    .map((r) => r.resource)
    .filter((r) => rawTypes === null || rawTypes.includes(r.type))
    .filter((r) => !options.purpose || r.purpose === options.purpose);

  matches.sort((a, b) => {
    const aCommentary = a.kind === "Commentary" ? 0 : 1;
    const bCommentary = b.kind === "Commentary" ? 0 : 1;
    if (aCommentary !== bCommentary) return aCommentary - bCommentary;
    if (a.useCount !== b.useCount) return b.useCount - a.useCount;
    const aRating = a.communityRating ?? -1;
    const bRating = b.communityRating ?? -1;
    if (aRating !== bRating) return bRating - aRating;
    return a.title.localeCompare(b.title);
  });
  return matches.slice(0, options.limit ?? 25);
}
```

- [ ] **Step 5: Run the unit tests**

Run: `npx vitest run tests/passage-resources.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing server test**

`tests/server-passage-resources.test.ts`:

```typescript
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
```

In `tests/server-smoke.test.ts`, change the tool count to `28`. In `tests/server-json.test.ts`, append `"find_passage_resources"` to `READ_TOOLS`, so the "offers format text|json on every read tool" test covers it.

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run tests/server-passage-resources.test.ts tests/server-smoke.test.ts tests/server-json.test.ts`
Expected: FAIL — unknown tool `find_passage_resources`.

- [ ] **Step 8: Register the tool**

In `src/index.ts`, extend the catalog import with `findPassageResources` and the types import with `PassageResource`. Insert after block 27:

```typescript
  // ── 28. find_passage_resources ────────────────────────────────────────────
  server.tool(
    "find_passage_resources",
    "Find which resources in the user's Logos library cover a Bible passage — commentaries, study Bibles, cross-reference works, Bibles, harmonies — from the library catalog's coverage data. Returns each resource's title, author, series, kind, commentary purpose and resource ID; commentaries first, then the ones the user opens most. Use with open_resource to open the chosen books at the passage.",
    {
      passage: z.string().describe("Bible reference (e.g., 'John 5:14', 'Romans 8')"),
      kind: z.enum(["commentary", "study bible", "cross-references", "bible", "harmony"]).optional()
        .describe("Only resources of this kind (default: all kinds)"),
      purpose: z.enum(["exegetical", "expositional", "application", "devotional", "concise"]).optional()
        .describe("Only commentaries written for this purpose (default: any)"),
      limit: z.number().optional().describe("Max resources to return (default: 25; up to 1000 with format 'json')"),
      format: formatParam,
    },
    async ({ passage, kind, purpose, limit, format }) => {
      let resources: PassageResource[];
      try {
        resources = findPassageResources({ passage, kind, purpose, limit: resolveLimit(limit, 25, format) });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(msg.startsWith("Database not found") ? `Library catalog error: ${msg}` : msg);
      }
      if (format === "json") return json(resources);
      if (resources.length === 0) {
        const filters = [kind, purpose].filter(Boolean).join(", ");
        return text(filters
          ? `No ${filters} resources in the user's library cover ${passage}. Try removing the kind/purpose filter.`
          : `No resources in the user's library cover ${passage}.`);
      }
      const lines = resources.map((r) => {
        const name = r.abbreviatedTitle ? `**${r.abbreviatedTitle}** — ${r.title}` : `**${r.title}**`;
        const by = r.authors ? ` — ${r.authors}` : "";
        const series = r.series ? ` (${r.series})` : "";
        const details = [r.kind, r.purpose, r.era, r.communityRating !== null ? `rated ${r.communityRating}` : null]
          .filter(Boolean)
          .join(" · ");
        return `- ${name}${by}${series}\n  ${details} | ID: \`${r.resourceId}\``;
      });
      return text(`Found ${resources.length} resources covering ${passage}:\n\n${lines.join("\n\n")}\n\nOpen one at the passage with open_resource (resource_id, reference).`);
    }
  );
```

- [ ] **Step 9: Run all tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS; `tsc` exits 0.

- [ ] **Step 10: Commit**

```bash
git add src/types.ts src/services/catalog-reader.ts src/index.ts tests/passage-resources.test.ts tests/server-passage-resources.test.ts tests/server-smoke.test.ts tests/server-json.test.ts
git commit -m "feat: add find_passage_resources — owned books covering a passage, from catalog coverage data"
```

---

### Task 3: Confirm opens through Logos's history

**Files:**
- Modify: `src/types.ts` (`HistoryConfirmation`)
- Modify: `src/services/study-data.ts` (`snapshotHistory`, `waitForHistoryVisit`)
- Modify: `src/utils/tool-text.ts` (`openConfirmationText`)
- Create: `tests/history-confirmation.test.ts`
- Modify: `tests/tool-text.test.ts`
- Modify: `src/index.ts` (blocks 1, 12, 15, 16)

**Interfaces:**
- Consumes: `getReadingHistory`, `openIfPresent`, `HistoryRow`, `historyRowToVisit`, `HistoryVisit` (PR 2); `parseLogosBibleRef`, `logosBookNumber` (PR 1); `parseReference` (`reference-parser.ts`); `uiFollowUpHint` (PR 1); `HISTORY_SCHEMA`, fixture helpers.
- Produces:
  - `type HistoryConfirmation = { status: "confirmed"; visit: HistoryVisit } | { status: "already_open"; visit: HistoryVisit } | { status: "unconfirmed" } | { status: "unavailable" }`
  - `interface HistorySnapshot { ids: Set<string>; alreadyShowing: HistoryVisit | null }`
  - `snapshotHistory(resourceId: string, reference?: string): HistorySnapshot | null` — `null` when `history.db` is absent; never throws.
  - `waitForHistoryVisit(resourceId: string, before: HistorySnapshot | null, options?: { timeoutMs?: number; intervalMs?: number }): Promise<HistoryConfirmation>` — defaults 8000 ms (2000 ms when already showing) / 500 ms; never throws.
  - `openConfirmationText(confirmation: HistoryConfirmation, what: string, panelType: CaptureToolType, platform?: NodeJS.Platform): string`

- [ ] **Step 1: Write the failing tests**

`tests/history-confirmation.test.ts`:

```typescript
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

type StudyData = typeof import("../src/services/study-data.js");

const FAST = { timeoutMs: 60, intervalMs: 10 };

// Tests run in order: later ones add and change rows.
describe("history confirmation with history.db", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;
  let historyPath: string;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    historyPath = join(dirs.catalogDir, "HistoryManager", "history.db");
    // WAL, like Logos's own history.db, so test writes and polling reads
    // follow the same locking rules as in real use.
    createDb(
      historyPath,
      `PRAGMA journal_mode = WAL;
       ${HISTORY_SCHEMA}
       INSERT INTO History (Id, Title, Subtitle, LastVisited, Bookmark) VALUES
         ('h1', 'PNTC Jn', 'John 5:14', '2026-10-15T06:58:20Z', 'Resource|Id=LLS:29.48.20|Reference=bible.64.5.14');`
    );
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("snapshots a resource's existing visits and where Logos is now", () => {
    const pntc = studyData.snapshotHistory("LLS:29.48.20", "John 5:14");
    expect(pntc?.ids).toEqual(new Set(["h1"]));
    expect(pntc?.alreadyShowing?.id).toBe("h1"); // h1 is the newest row and the same location
    expect(studyData.snapshotHistory("LLS:29.48.20", "John 5:20")?.alreadyShowing).toBeNull();
    expect(studyData.snapshotHistory("LLS:LEB")).toEqual({ ids: new Set(), alreadyShowing: null });
  });

  it("does not count a visit that was already there, even from the launch second", async () => {
    const before = studyData.snapshotHistory("LLS:29.48.20", "John 5:20");
    expect(await studyData.waitForHistoryVisit("LLS:29.48.20", before, FAST)).toEqual({ status: "unconfirmed" });
  });

  it("reports a location Logos was already showing, which adds no row", async () => {
    const before = studyData.snapshotHistory("LLS:29.48.20", "John 5:14");
    const r = await studyData.waitForHistoryVisit("LLS:29.48.20", before, FAST);
    expect(r.status === "already_open" && r.visit.id).toBe("h1");
  });

  it("does not count other resources", async () => {
    const before = studyData.snapshotHistory("LLS:LEB");
    expect(await studyData.waitForHistoryVisit("LLS:LEB", before, FAST)).toEqual({ status: "unconfirmed" });
  });

  it("keeps polling until Logos writes a new row", async () => {
    const before = studyData.snapshotHistory("LLS:LEB", "John 5:1");
    setTimeout(() => {
      createDb(
        historyPath,
        `INSERT INTO History (Id, Title, Subtitle, LastVisited, Bookmark) VALUES
           ('h2', 'LEB', 'John 5:1', '2026-10-15T07:00:00Z', 'Resource|Id=LLS:LEB|Reference=bible+leb2.64.5.1');`
      );
    }, 50);
    const r = await studyData.waitForHistoryVisit("LLS:LEB", before, { timeoutMs: 3000, intervalMs: 20 });
    expect(r.status).toBe("confirmed");
    if (r.status === "confirmed") {
      expect(r.visit).toMatchObject({ id: "h2", title: "LEB", subtitle: "John 5:1" });
    }
  });

  it("ignores an updated row: Logos bumps LastVisited on the row the user leaves", async () => {
    const before = studyData.snapshotHistory("LLS:29.48.20", "John 5:20");
    createDb(historyPath, "UPDATE History SET LastVisited = '2026-10-15T07:05:00Z' WHERE Id = 'h1';");
    expect(await studyData.waitForHistoryVisit("LLS:29.48.20", before, FAST)).toEqual({ status: "unconfirmed" });
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
    const before = studyData.snapshotHistory("LLS:LEB");
    expect(before).toBeNull();
    expect(await studyData.waitForHistoryVisit("LLS:LEB", before, FAST)).toEqual({ status: "unavailable" });
  });
});
```

Append to `tests/tool-text.test.ts` (and add `openConfirmationText` to its import):

```typescript
describe("openConfirmationText", () => {
  const visit = {
    id: "h1",
    title: "PNTC Jn",
    subtitle: "John 5:14",
    lastVisited: "2026-10-15T06:58:20Z",
    kind: "Resource",
    resourceId: "LLS:29.48.20",
    rawReference: "bible.64.5.14",
    reference: "John 5:14",
  };

  it("reports what Logos opened", () => {
    expect(openConfirmationText({ status: "confirmed", visit }, "resource `LLS:29.48.20`", "resource", "win32")).toBe(
      "Opened PNTC Jn at John 5:14 in Logos. This only opens the Logos UI on the user's screen — no data is returned to you."
    );
  });

  it("says when Logos was already showing the location", () => {
    expect(openConfirmationText({ status: "already_open", visit }, "resource `LLS:29.48.20`", "resource", "win32")).toBe(
      "Logos is already showing PNTC Jn at John 5:14. This only opens the Logos UI on the user's screen — no data is returned to you."
    );
  });

  it("says when Logos did not confirm", () => {
    expect(openConfirmationText({ status: "unconfirmed" }, "resource `LLS:X`", "resource", "win32")).toBe(
      "Sent resource `LLS:X` to Logos, but Logos did not confirm opening it — Logos may be busy; try again once it responds."
    );
  });

  it("falls back to the plain dispatch message without a history store", () => {
    expect(openConfirmationText({ status: "unavailable" }, "resource `LLS:X`", "resource", "win32")).toBe(
      "Dispatched to Logos: resource `LLS:X`. This only opens the Logos UI on the user's screen — no data is returned to you."
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/history-confirmation.test.ts tests/tool-text.test.ts`
Expected: FAIL — `snapshotHistory`, `waitForHistoryVisit`, `openConfirmationText` are not exported.

- [ ] **Step 3: Implement**

`src/types.ts` — append to "Study Data Types":

```typescript
/** Whether Logos's history shows that a resource link actually opened. */
export type HistoryConfirmation =
  | { status: "confirmed"; visit: HistoryVisit }
  /** Logos was already at that location, so it added no history row. */
  | { status: "already_open"; visit: HistoryVisit }
  | { status: "unconfirmed" }
  | { status: "unavailable" };
```

`src/services/study-data.ts` — add `HistoryConfirmation` to the types import, `parseLogosBibleRef, logosBookNumber` to the `./logos-books.js` import, `import { parseReference } from "./reference-parser.js";`, and append:

```typescript
// ─── Open confirmation ───────────────────────────────────────────────────────

/** History state just before a resource link is sent. */
export interface HistorySnapshot {
  /** Ids of the resource's existing history rows. */
  ids: Set<string>;
  /** Set when Logos is already at the requested location: it then adds no row. */
  alreadyShowing: HistoryVisit | null;
}

// Logos inserts a history row when it arrives somewhere and only bumps
// LastVisited on the row it leaves (observed on Logos 54, 2026-10-15), so the
// most recently inserted row (highest rowid), not the newest LastVisited, is
// where Logos is now. Null when history.db is absent or empty.
function getCurrentHistoryVisit(): HistoryVisit | null {
  const db = openIfPresent(DB_PATHS.history, "History");
  if (!db) return null;
  try {
    const row = db.prepare(`
      SELECT Id, Title, Subtitle, LastVisited, Bookmark FROM History
      WHERE IsDeleted = 0
      ORDER BY rowid DESC
      LIMIT 1
    `).get() as HistoryRow | undefined;
    return row ? historyRowToVisit(row) : null;
  } finally {
    db.close();
  }
}

// Whether a visit is `resourceId` at the start of `reference` (any location
// when no reference is given). Missing chapter/verse count as 1.
function isSameLocation(visit: HistoryVisit, resourceId: string, reference?: string): boolean {
  if (visit.kind !== "Resource" || visit.resourceId !== resourceId) return false;
  if (!reference) return true;
  const at = visit.rawReference ? parseLogosBibleRef(visit.rawReference)?.start : undefined;
  if (!at) return false;
  try {
    const ref = parseReference(reference);
    return logosBookNumber(ref.book) === at.book && ref.chapter === (at.chapter ?? 1) && (ref.verse ?? 1) === (at.verse ?? 1);
  } catch {
    return false;
  }
}

// Taken just before launching a link to `resourceId` (at `reference`). Null
// when history.db is absent (the open then can't be confirmed). Never throws.
export function snapshotHistory(resourceId: string, reference?: string): HistorySnapshot | null {
  try {
    const visits = getReadingHistory({ resourceId });
    if (visits === null) return null;
    const current = getCurrentHistoryVisit();
    return {
      ids: new Set(visits.map((v) => v.id)),
      alreadyShowing: current && isSameLocation(current, resourceId, reference) ? current : null,
    };
  } catch {
    return null;
  }
}

// Logos records a resource open in history.db (design doc F12); when it is
// busy a link can do nothing at all (F20). Polls history.db (read-only) until
// a visit to `resourceId` appears that is not in `before`. A changed
// LastVisited on an existing row is ignored: Logos bumps it on the row the
// user leaves. If Logos was already at the location it adds no row, so that
// case waits only briefly and reports "already_open". Never throws.
export async function waitForHistoryVisit(
  resourceId: string,
  before: HistorySnapshot | null,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<HistoryConfirmation> {
  if (before === null) return { status: "unavailable" };
  const timeoutMs = options.timeoutMs ?? (before.alreadyShowing ? 2000 : 8000);
  const intervalMs = options.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let visits: HistoryVisit[] = [];
    try {
      // A failed read while Logos writes (e.g. a transient lock) is "not yet".
      visits = getReadingHistory({ resourceId }) ?? [];
    } catch {
      // retry at the next interval
    }
    const fresh = visits.find((v) => !before.ids.has(v.id));
    if (fresh) return { status: "confirmed", visit: fresh };
    if (Date.now() >= deadline) {
      return before.alreadyShowing
        ? { status: "already_open", visit: before.alreadyShowing }
        : { status: "unconfirmed" };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
```

`src/utils/tool-text.ts` — change the type import to `import type { CaptureToolType, HistoryConfirmation, KnowledgeEntry } from "../types.js";` and append (it reuses the module's existing `DISPATCHED_NOTE` and `uiFollowUpHint`):

```typescript
// Reply for a resource link once Logos's history has been checked. `what`
// names the target, e.g. "resource `LLS:29.48.20` at John 5:14".
export function openConfirmationText(
  confirmation: HistoryConfirmation,
  what: string,
  panelType: CaptureToolType,
  platform: NodeJS.Platform = process.platform
): string {
  if (confirmation.status === "confirmed") {
    const { visit } = confirmation;
    const at = visit.subtitle ? ` at ${visit.subtitle}` : "";
    return `Opened ${visit.title}${at} in Logos. ${DISPATCHED_NOTE}`;
  }
  if (confirmation.status === "already_open") {
    const { visit } = confirmation;
    const at = visit.subtitle ? ` at ${visit.subtitle}` : "";
    return `Logos is already showing ${visit.title}${at}. ${DISPATCHED_NOTE}`;
  }
  if (confirmation.status === "unconfirmed") {
    return `Sent ${what} to Logos, but Logos did not confirm opening it — Logos may be busy; try again once it responds.`;
  }
  return `Dispatched to Logos: ${what}. ${DISPATCHED_NOTE}${uiFollowUpHint(panelType, platform)}`;
}
```

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run tests/history-confirmation.test.ts tests/tool-text.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the confirmation in the handlers**

In `src/index.ts`: extend the study-data import with `snapshotHistory, waitForHistoryVisit` and the tool-text import with `openConfirmationText`. Add after `LOGOS_NOT_RUNNING`:

```typescript
// Only resource links are confirmed through history.db. Guides and Factbook
// entries are not checked (design doc F12; whether guides add history rows
// is recorded in PR 1's verification), so their replies say so.
const UNCONFIRMABLE_NOTE = "The server does not check whether Logos opened guides or Factbook entries.";
```

In block 15 (`open_resource`), replace the handler body after the running check with:

```typescript
      const before = snapshotHistory(resource_id, reference);
      const result = await launchLogosUrl(() => buildResourceUrl(resource_id, reference));
      if (!result.success) return err(`Failed to open resource: ${result.error}`);
      const what = `resource \`${resource_id}\`${reference ? ` at ${reference}` : ""}`;
      return text(openConfirmationText(await waitForHistoryVisit(resource_id, before), what, "resource"));
```

and append to its description: " Waits up to 8 seconds for Logos to confirm the resource opened and reports what it opened."

In block 1 (`navigate_passage`), replace everything after the `bibleId` line with:

```typescript
      // Current links open the passage as a resource, which Logos records.
      const before = LOGOS_LINK_STYLE === "current" ? snapshotHistory(bibleId, reference) : null;
      const result = await launchLogosUrl(() => buildPassageUrl(reference, bibleId));
      if (!result.success) return err(`Failed to open passage: ${result.error}`);
      if (LOGOS_LINK_STYLE === "legacy") {
        return text(`Dispatched to Logos: Bible passage ${reference}. ${DISPATCHED_NOTE}${uiFollowUpHint("bible")}`);
      }
      const what = `Bible passage ${reference} in \`${bibleId}\``;
      return text(openConfirmationText(await waitForHistoryVisit(bibleId, before), what, "bible"));
```

and append to its description: " With the current link style, waits up to 8 seconds for Logos to confirm the passage opened and reports what it opened."

In block 12 (`open_factbook`), insert `${UNCONFIRMABLE_NOTE} ` before `${DISPATCHED_NOTE}` in both success messages, the legacy one and the final `resolved` one:

```typescript
          ? text(`Dispatched to Logos: Factbook entry for "${input}". ${UNCONFIRMABLE_NOTE} ${DISPATCHED_NOTE}${uiFollowUpHint("factbook")}`)
```

```typescript
        ? text(`Dispatched to Logos: Factbook entry ${entry.label} (\`${entry.id}\`). ${UNCONFIRMABLE_NOTE} ${DISPATCHED_NOTE}${uiFollowUpHint("factbook")}`)
```

In block 16 (`open_guide`), the success message likewise becomes:

```typescript
        ? text(`Dispatched to Logos: ${guide_type} for ${subject}. ${UNCONFIRMABLE_NOTE} ${DISPATCHED_NOTE}${uiFollowUpHint("guide")}`)
```

- [ ] **Step 6: Run all tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS; `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/services/study-data.ts src/utils/tool-text.ts src/index.ts tests/history-confirmation.test.ts tests/tool-text.test.ts
git commit -m "feat: confirm open_resource and navigate_passage through logos's history — say so when logos is busy"
```

---

### Task 4: Documentation, verification and the pull request

**Files:**
- Modify: `../README.md`
- Modify: `../.claude/agents/tool-tester.md`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: the PR.

- [ ] **Step 1: README**

1. Intro: `**27 MCP tools**` → `**28 MCP tools**`, and add "find which of your books cover a passage" after "search your library catalog".
2. Setup step 6: `with 27 tools` → `with 28 tools`.
3. Project Structure: `all 27 tools` → `all 28 tools`; `(27 tools)` → `(28 tools)`; `catalog-reader.ts` comment → `# Library catalog search and passage coverage (catalog.db)`.
4. "Library & Resources" table — add:

```markdown
| `find_passage_resources` | Lists the commentaries, study Bibles and other books you own that cover a passage (filter by kind and commentary purpose) |
```

and replace the `navigate_passage` and `open_resource` rows (Navigation & UI) with:

```markdown
| `navigate_passage` | Opens a passage in the Logos UI (in your most-used Bible, or one you name), and confirms it opened |
```

```markdown
| `open_resource` | Opens a specific commentary, lexicon, or other resource in Logos at a passage, and confirms it opened |
```

5. Insert after the "Library & Resources" table:

```markdown
**Opening your commentaries on a passage.** Ask "open my exegetical commentaries on John 5:14": the assistant calls `find_passage_resources` (`passage: "John 5:14"`, `kind: "commentary"`, `purpose: "exegetical"`) and then `open_resource` for each book you choose. Results are ordered commentaries first, then by how often you open each book — not by your Passage Guide prioritization list, which Logos keeps on Faithlife's servers rather than on disk.
```

- [ ] **Step 2: tool-tester.md**

1. Description and Purpose: `27` → `28` tools.
2. Database → Tool Dependencies: catalog row → `` `get_library_catalog`, `get_resource_types`, `navigate_passage` (picks the Bible), `find_passage_resources` ``; history row → `` `get_reading_history`, `open_resource` / `navigate_passage` (confirmation) ``.
3. Phase 2 — replace rows 6 and 15 and append row 28:

```markdown
| 6 | "Open Romans 12:1 in Logos" | `navigate_passage` | Returns "Opened … at …" or "Logos is already showing …", or "Logos did not confirm" (pass if Logos was busy; note it) |
```

```markdown
| 15 | "Open that first commentary at Romans 12:1" | `open_resource` | Returns "Opened … at …" or "Logos is already showing …", or "Logos did not confirm" (pass if Logos was busy; note it) |
```

```markdown
| 28 | "Which of my commentaries cover John 5:14?" | `find_passage_resources` | Returns resources with IDs, or an empty-result message (not an error) |
```

4. Testing Rules: append to the "Success message = pass" bullet: "For navigate_passage and open_resource, an "Opened … at …" reply is a pass; "Logos did not confirm" is also a pass when Logos was busy (note it in the report)." Append to the "Empty results are OK" bullet's list: "passage resources".
5. Phase 3: `After all 27 tests` → `After all 28 tests`; `PASS: 24/27 tools` → `PASS: 25/28 tools`; add `✓ find_passage_resources — OK (N resources)`.

Check: `grep -n "27" ../README.md ../.claude/agents/tool-tester.md` shows no stale tool counts.

- [ ] **Step 3: Commit the docs**

```bash
git add ../README.md ../.claude/agents/tool-tester.md
git commit -m "docs: document find_passage_resources, open confirmation and the 28-tool count"
```

- [ ] **Step 4: Full automated check**

Run: `npm test && npm run build`
Expected: all PASS; `tsc` exits 0.

- [ ] **Step 5: Manual verification on Windows Logos 54 (MANUAL — Will)**

Restart the MCP client so it loads `dist/`; with Logos open and idle, record for the PR:

1. `find_passage_resources passage="John 5:1" kind="commentary"` lists Carson (PNTC Jn) and Phillips (REC Jn).
2. `open_resource resource_id="LLS:29.48.20" reference="John 5:14"` replies "Opened PNTC Jn at John 5:14 …" and the tab appears.
3. `navigate_passage "John 5:1"` replies "Opened LEB at John 5:1 …"; calling it again at once replies "Logos is already showing LEB at John 5:1 …" within about 2 seconds.
4. Optional: while Logos is busy (e.g. just after launch), `open_resource` replies "Logos did not confirm opening it" within about 8 seconds.

- [ ] **Step 6: Push and open the PR (ask Will before pushing)**

```bash
git push -u origin feature/passage-resources
```

If PR 2 has merged:

```bash
gh pr create --repo robrawks/LogosBibleSoftwareMCP --base main --title "feat: find_passage_resources and confirmed resource opens" --body-file pr-body.md
```

Otherwise (stacked on PR 2):

```bash
gh pr create --repo robrawks/LogosBibleSoftwareMCP --base feature/study-data --title "feat: find_passage_resources and confirmed resource opens" --body-file pr-body.md
```

`pr-body.md` (not committed):

```markdown
PR 3 of 3 from docs/design/2026-10-15-logos54-fixes-and-study-data-design.md. Depends on PRs 1 and 2.

## What changes
- New tool find_passage_resources: owned resources whose catalog coverage (ReferenceSupersets) includes a passage; filter by kind and commentary purpose; commentaries first, then most used. 27 → 28 tools.
- open_resource and navigate_passage wait up to 8 s for a history.db row and report what Logos opened, or that it did not respond.
- Guide and Factbook replies say the server does not check whether they opened.

## Verified on Windows, Logos 54.0.0.252
[results of Task 4 Step 5]

## Needs confirmation on macOS
- history.db path and that opening a resource adds a row.
```

Then `rm pr-body.md`.

## Resume State

- **Last completed task:** none (plan written 2026-10-15).
- **Commit SHA:** plan committed on `docs/logos54-spec`.
- **Ticked checkboxes:** none.
- **Next task:** Task 1, Step 0 (create `feature/passage-resources` once PR 2's branch exists).
- **Caveats:** needs PR 1 and PR 2 code. Task 4 Step 5 needs Will on Windows with Logos 54.
