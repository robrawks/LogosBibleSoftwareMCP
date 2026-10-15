# Logos 54 Fixes (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every existing tool give correct results, or an honest "not supported here", on Logos 54 (Windows) without regressing older installs — PR 1 of the design in [2026-10-15-logos54-fixes-and-study-data-design.md](2026-10-15-logos54-fixes-and-study-data-design.md).

**Architecture:** Three new service modules: `logos-books` (Logos book numbering and raw-reference parsing), `logos-urls` (every link the UI tools send, in a `current` and a `legacy` style), and `knowledge-lookup` (Factbook names → knowledge-base IDs via `AutoComplete.db`). Shared database helpers move to `services/db.ts`. Readers detect the Logos 54 schema (`NoteAnchorFacetReferences`) with `sqlite_master` and fall back to today's parsing. Handlers in `index.ts` only format.

**Tech Stack:** TypeScript (strict, ESM), Node ≥ 18, better-sqlite3 (read-only), zod, `@modelcontextprotocol/sdk`, Vitest.

## Summary

Plain-language version: Logos numbers Bible books differently from what the server assumed, newer Logos stores the verse a note is attached to in a table the server never read, and most "open this in Logos" links use a format Logos 54 ignores. This plan fixes the book numbering, reads the verse table, rebuilds the links in the formats that were verified to work (keeping the old ones behind a switch), looks up Factbook entries by their internal ID, and makes tools say plainly when something can't work (word-study links, Sermon Starter themes, window titles on Windows). The tool count stays at 24.

## Glossary

| Term | Meaning |
|---|---|
| Logos book number | Logos's own Bible book index in raw references: OT 1–39, deuterocanon 40–60 (unmapped here), NT 61–87. `bible.64.5.1` = John 5:1. |
| Raw reference | A Logos reference string, e.g. `bible.66.1.8-66.1.15` (Romans 1:8–15) or `bible+csb2.61-87` (Matthew–Revelation in the CSB). |
| Facet table | `NoteAnchorFacetReferences` in `notestool.db`: one row per note/highlight anchor holding its raw Bible reference. Present on Logos 54. |
| Knowledge-base ID | Factbook entry ID, e.g. `bk.#Moses` (person), `bk.%Sabbath` (topic), `bk.@Abana` (place), `bk.to:DBT-5333` (preaching theme), `bk.$AlabasterFlask` (thing). The server never parses the marker character; it uses the whole ID and the entry's `IconKind`. |
| Lookup table | `Data/<profile>/AutoComplete/AutoComplete.db`: display names (`Labels`) → knowledge-base IDs (`Terms.Reference`). |
| Link style | `LOGOS_LINK_STYLE` env setting: `current` (default; formats verified on Logos 54) or `legacy` (today's exact URLs). |
| Fixture harness | `tests/helpers/fixtures.ts`: builds Logos-shaped SQLite files in a temp dir and re-imports the server modules pointed at them. |

## Global Constraints

- All paths below are relative to `logos-mcp-server/`; run every command from that directory.
- Branch: `fix/logos54-compat`. Conventional commits with lower-case summaries (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
- TypeScript `strict`, ES modules, `.js` suffix on relative imports. 2-space indent, double quotes, semicolons, trailing commas. No linter exists — match the surrounding code.
- Every database is opened read-only through `openDb(path)` (`readonly: true, fileMustExist: true`), per call, closed in `finally`. Never write to any Logos file.
- Parameterized SQL only; `LIKE` filters use `escapeLike()` with `ESCAPE '\\'`.
- Choose code paths by checking which files/tables exist (`sqlite_master`), never by Logos version number.
- Best-effort parsers never throw; they return `null` / `[]` and say so in a comment.
- No `.db` files are committed (`*.db` is git-ignored). Tests build databases in a temp dir at test time; table/column names copied from the real install, rows synthetic.
- Services return typed objects; handlers in `src/index.ts` only format. Don't reintroduce fields the response cleanup removed (e.g. use counts in catalog text).
- Tool and parameter names stay snake_case; every parameter has `.describe()` including its default. UI tools keep the prefix "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data." and gate on `isLogosRunning()`.
- Tool count stays **24** in this PR.
- Do **not** modify `src/services/screenshot-capture.ts` (its own `logos4:///` URLs are macOS screenshot capture, a non-goal) or the Biblia tools.
- `LOGOS_LINK_STYLE=legacy` must reproduce today's URL strings byte-for-byte.

## Deviations From and Clarifications of the Spec

Recorded here so the reviewer can check them; each is applied in the task named.

1. **Readable ranges use a hyphen** (`Romans 1:8-15`), matching the existing `anchor-parsing` tests; the spec's en dashes were typographic. (Task 2)
2. **`0x02` blob length rule:** the spec says "when the declared length matches the remaining bytes, use exactly that many", which is the same as taking everything. Implemented as: declared length ≤ remaining bytes → use the declared bytes; otherwise everything after byte 5. Blobs shorter than the 5-byte header decode to `null`. (Task 3)
3. **`get_user_notes` applies `limit` after the `passage` filter.** Today the SQL `LIMIT` runs first, so an older matching note is cut before the filter sees it. (Task 4)
4. **Lookup also reads the tiny `Languages` table** to prefer English descriptions without hard-coding a language ID. (Task 5)
5. **Unused `searchBibleInLogos()` is removed** from `logos-app.ts` (no caller; its link format is one Logos 54 ignores). (Task 9)
6. **`search_all` uses `logos4:Search;kind=AllSearch;q=<query>;syntax=v2`**, resolving Open Question 1. Verified on Logos 54 with Logos idle (2026-10-15): it opened an All search with the query run, including multi-word queries. `kind=BooksSearch` also works; `SearchKindName=…;QueryText=…` opens Search without the query. **Sermon Starter Guide ignores its subject** (Open Question 2): every form tried opened it without a theme, and its history row has no subject. (Tasks 6, 9)
7. **`diagnose` treats version-dependent stores as optional.** The spec says `diagnose` lists new stores automatically, but the CLI fails on any missing file, so a store only some Logos versions have would fail it on every other install. That contradicts the spec's "not available, not an error" rule. `OPTIONAL_DB_NAMES` (`visualMarkup`, absent on Logos 54; `autoComplete`, absent until Logos first runs) are reported as not present without failing. PR 2 adds its stores to the set. (Task 8)
8. **Name lookup folds case for accented letters too.** The spec says "case-insensitive", but SQLite's `NOCASE` folds only A–Z, and about 16% of real `AutoComplete.db` labels carry accents (adversarial review, 2026-10-15). A miss on a name with non-ASCII letters is retried with a JS case-folding function registered on the read-only connection. That fallback is a full scan, measured at about 40 ms on the real file. Accent-insensitive matching ("Jose" = "José") is not added. (Task 5)

## Interfaces Produced for PRs 2 and 3

| Module | Export | Used by |
|---|---|---|
| `src/services/db.ts` | `openDb(path)`, `escapeLike(s)`, `hasTable(db, table)` | PR 2 readers, PR 3 |
| `src/services/logos-books.ts` | `logosBookName(n)`, `logosBookNumber(name)`, `parseLogosBibleRef(raw)`, `logosRawToHuman(raw)`, types `LogosRefPoint`, `LogosBibleRange` | PR 2 (reading plans, history, passage lists), PR 3 (coverage) |
| `src/utils/clippings.ts` | `decodeLogosBlob(blob)` | PR 2 passage lists |
| `src/services/logos-urls.ts` | `buildResourceUrl(resourceId, reference?)`, `buildPassageUrl(reference, bibleResourceId, style?)` | PR 3 |
| `src/services/logos-app.ts` | `launchLogosUrl(build)`, `isLogosRunning()` | PR 3 |
| `src/config.ts` | `LOGOS_LINK_STYLE`, `DEFAULT_BIBLE_RESOURCE_ID`, `OPTIONAL_DB_NAMES` | PR 2 (`OPTIONAL_DB_NAMES`), PR 3 (`navigate_passage`) |
| `src/utils/tool-text.ts` | `DISPATCHED_NOTE`, `uiFollowUpHint(panelType, platform?)` | PR 3 |
| `src/index.ts` | `LOGOS_NOT_RUNNING` constant; the rewritten UI tool handlers (blocks 1, 12, 15, 16) | PR 3 |
| `tests/helpers/fixtures.ts` | `makeFixtureDirs()`, `createDb(path, sql)`, `useFixtureDirs(dirs)`, `cleanupFixtureDirs(dirs)`, `FixtureDirs` | PR 2, PR 3 tests |
| `tests/helpers/schemas.ts` | `NOTES_SCHEMA_LEGACY`, `NOTES_SCHEMA_LOGOS54`, `CATALOG_SCHEMA`, `AUTOCOMPLETE_SCHEMA` | PR 2, PR 3 tests |

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/services/db.ts` | Create | `openDb`, `escapeLike`, `hasTable` (shared by every reader) |
| `src/services/logos-books.ts` | Create | Logos book numbers ↔ names; raw Bible reference parsing and readable formatting |
| `src/services/knowledge-lookup.ts` | Create | Name → knowledge-base ID lookup; Factbook and guide target resolution |
| `src/services/logos-urls.ts` | Create | Every UI-tool link, in `current` and `legacy` styles |
| `src/utils/tool-text.ts` | Create | Platform-aware status/hint text and the ambiguous-entry choice list |
| `src/services/sqlite-reader.ts` | Modify | Use `db.ts` and `logos-books`; facet-table verses for notes and highlights |
| `src/services/catalog-reader.ts` | Modify | Use `db.ts`; `getPreferredBibleResourceId()` |
| `src/services/logos-app.ts` | Modify | Keep only `launchLogosUrl` / `openUrl` and `isLogosRunning` |
| `src/utils/clippings.ts` | Modify | `decodeLogosBlob()` with the 5-byte header; `decodeClippingBlob` alias |
| `src/config.ts` | Modify | `DB_PATHS.autoComplete`, `LOGOS_LINK_STYLE`, `DEFAULT_BIBLE_RESOURCE_ID`, `OPTIONAL_DB_NAMES` |
| `src/cli.ts` | Modify | `diagnose` CLI: optional stores don't fail the check |
| `src/types.ts` | Modify | `HighlightResult` reference fields, knowledge-base and guide-target types |
| `src/index.ts` | Modify | UI handlers use builders/lookup; honest messages; highlight output |
| `tests/helpers/fixtures.ts`, `tests/helpers/schemas.ts` | Create | Fixture harness and Logos-shaped schemas |
| `tests/db.test.ts`, `tests/logos-books.test.ts`, `tests/notes-reader.test.ts`, `tests/knowledge-lookup.test.ts`, `tests/logos-urls.test.ts`, `tests/preferred-bible.test.ts`, `tests/tool-text.test.ts`, `tests/logos-app.test.ts` | Create | Unit tests |
| `tests/anchor-parsing.test.ts`, `tests/clippings-utils.test.ts` | Modify | Corrected fixtures (F3, F17) |
| `../README.md`, `../.claude/agents/tool-tester.md` | Modify | Link style, book numbers, limitations, troubleshooting, test prompts |

---

### Task 1: Shared database helpers and the fixture harness

**Files:**
- Create: `src/services/db.ts`
- Create: `tests/helpers/fixtures.ts`
- Create: `tests/helpers/schemas.ts`
- Create: `tests/db.test.ts`
- Modify: `src/services/sqlite-reader.ts:1-29` (imports; delete local `openDb`/`escapeLike`)
- Modify: `src/services/catalog-reader.ts:1-17` (same)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `openDb(path: string): Database.Database` — throws `Error("Database not found: <path>")` when missing.
  - `escapeLike(s: string): string`
  - `hasTable(db: Database.Database, table: string): boolean`
  - Test helpers: `interface FixtureDirs { root: string; dataDir: string; catalogDir: string }`, `makeFixtureDirs(): FixtureDirs`, `createDb(path: string, sql: string): void`, `useFixtureDirs(dirs: FixtureDirs): void`, `cleanupFixtureDirs(dirs: FixtureDirs): void`.
  - Schema strings: `NOTES_SCHEMA_LEGACY`, `NOTES_SCHEMA_LOGOS54`, `CATALOG_SCHEMA`, `AUTOCOMPLETE_SCHEMA`.

- [x] **Step 0: Create the branch**

If `docs/logos54-spec` has already merged to `main`:

```bash
git fetch origin && git switch -c fix/logos54-compat origin/main
```

Otherwise branch from the docs branch so the design and plans travel with the work:

```bash
git switch -c fix/logos54-compat docs/logos54-spec
```

Then `cd logos-mcp-server && npm ci` and confirm the baseline: `npm test` → 134 tests pass.

- [x] **Step 1: Write the fixture harness and schemas**

`tests/helpers/fixtures.ts`:

```typescript
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { vi } from "vitest";

// Builds throwaway Logos-shaped SQLite databases in a temp dir. Nothing is
// committed (*.db is git-ignored): every database is created at test time.

export interface FixtureDirs {
  root: string;
  /** Stands in for Documents/<profile> (LOGOS_DATA_DIR). */
  dataDir: string;
  /** Stands in for Data/<profile> (LOGOS_CATALOG_DIR). */
  catalogDir: string;
}

export function makeFixtureDirs(): FixtureDirs {
  const root = mkdtempSync(join(tmpdir(), "logos-mcp-"));
  const dataDir = join(root, "Documents", "test.w14");
  const catalogDir = join(root, "Data", "test.w14");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(catalogDir, { recursive: true });
  return { root, dataDir, catalogDir };
}

// Create (or extend) a database file and run the given SQL against it.
export function createDb(path: string, sql: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

// Point config.ts at the fixture dirs and drop cached modules, so the next
// dynamic `await import(...)` re-evaluates DB_PATHS against them.
export function useFixtureDirs(dirs: FixtureDirs): void {
  vi.stubEnv("LOGOS_DATA_DIR", dirs.dataDir);
  vi.stubEnv("LOGOS_CATALOG_DIR", dirs.catalogDir);
  vi.resetModules();
}

export function cleanupFixtureDirs(dirs: FixtureDirs): void {
  vi.unstubAllEnvs();
  rmSync(dirs.root, { recursive: true, force: true });
}
```

`tests/helpers/schemas.ts`:

```typescript
// SQLite schemas for test fixtures. Table and column names are copied from a
// Logos 54.0 install on Windows (2026-10-15); only the columns the server
// reads are kept, and catalog columns get defaults so tests can insert
// partial rows. "Legacy" is the shape the pre-Logos-54 code expects.

export const NOTES_SCHEMA_LEGACY = `
  CREATE TABLE Notes (
    NoteId integer primary key autoincrement,
    ExternalId text not null,
    CreatedDate text not null,
    ModifiedDate text,
    IsDeleted bool not null default 0,
    IsTrashed bool not null default 0,
    Kind int not null,
    ContentRichText text,
    NoteStyleId int,
    AnchorsJson text,
    AnchorResourceIdId int,
    TagsJson text,
    NotebookExternalId text not null
  );
  CREATE TABLE Notebooks (
    NotebookId integer primary key autoincrement,
    ExternalId text not null,
    Title text,
    IsDeleted bool not null default 0
  );
  CREATE TABLE NoteStyles (
    NoteStyleId integer primary key autoincrement,
    Name text not null
  );
  CREATE TABLE ResourceIds (
    ResourceIdId integer primary key autoincrement,
    ResourceId text not null
  );
`;

export const NOTES_SCHEMA_LOGOS54 = `${NOTES_SCHEMA_LEGACY}
  CREATE TABLE NoteAnchorFacetReferences (
    NoteAnchorFacetReferenceId integer primary key autoincrement,
    NoteId integer not null,
    AnchorIndex int not null,
    DataTypeId int not null,
    BibleBook int,
    SortKey blob not null,
    Reference text not null
  );
`;

export const CATALOG_SCHEMA = `
  CREATE TABLE Records (
    RecordId integer primary key autoincrement,
    ResourceId text not null,
    Type text not null,
    Title text not null,
    AbbreviatedTitle text not null default '',
    Authors text not null default '',
    Series text not null default '',
    Subjects text not null default '',
    Description text,
    PublicationDate text not null default '',
    CommunityRating double,
    Traits text not null default '',
    Availability int not null default 2,
    IsDataset bool not null default 0,
    ReferenceSupersets text not null default '',
    UseCount integer not null default 0
  );
`;

export const AUTOCOMPLETE_SCHEMA = `
  CREATE TABLE Terms (
    TermId integer primary key autoincrement,
    Reference text unique not null,
    IconKindId integer not null,
    CompletionKind integer not null
  );
  CREATE TABLE Descriptions (
    DescriptionId integer primary key autoincrement,
    TermId integer not null,
    LanguageId integer not null,
    Description text not null
  );
  CREATE TABLE Labels (
    LabelId integer primary key autoincrement,
    TermId integer not null,
    IsPrimary bool not null,
    LanguageId integer not null,
    LabelText text not null
  );
  CREATE TABLE Languages (
    LanguageId integer primary key autoincrement,
    Language text not null
  );
  CREATE TABLE IconKinds (
    IconKindId integer primary key autoincrement,
    IconKind text not null
  );
`;
```

- [x] **Step 2: Write the failing tests**

`tests/db.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import { openDb, escapeLike, hasTable } from "../src/services/db.js";
import {
  makeFixtureDirs,
  createDb,
  useFixtureDirs,
  cleanupFixtureDirs,
  type FixtureDirs,
} from "./helpers/fixtures.js";

describe("db helpers", () => {
  let dirs: FixtureDirs;
  let path: string;

  beforeAll(() => {
    dirs = makeFixtureDirs();
    path = join(dirs.root, "sample.db");
    createDb(path, "CREATE TABLE Things (Id integer primary key, Name text);");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("reports whether a table exists", () => {
    const db = openDb(path);
    try {
      expect(hasTable(db, "Things")).toBe(true);
      expect(hasTable(db, "Missing")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("opens databases read-only", () => {
    const db = openDb(path);
    try {
      expect(() => db.exec("INSERT INTO Things (Name) VALUES ('x')")).toThrow(/readonly/i);
    } finally {
      db.close();
    }
  });

  it("throws a descriptive error for a missing file", () => {
    expect(() => openDb(join(dirs.root, "nope.db"))).toThrow("Database not found");
  });

  it("escapes LIKE wildcards and backslashes", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});

describe("fixture harness", () => {
  let dirs: FixtureDirs;

  beforeAll(() => {
    dirs = makeFixtureDirs();
    useFixtureDirs(dirs);
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("points DB_PATHS at the fixture directories", async () => {
    const config = await import("../src/config.js");
    expect(config.DB_PATHS.notes).toBe(join(dirs.dataDir, "NotesToolManager", "notestool.db"));
    expect(config.DB_PATHS.catalog).toBe(join(dirs.catalogDir, "LibraryCatalog", "catalog.db"));
  });
});
```

- [x] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL — `Failed to load url ../src/services/db.js` (module does not exist). The "fixture harness" block may already pass; that is fine.

- [x] **Step 4: Create `src/services/db.ts`**

```typescript
import Database from "better-sqlite3";
import { existsSync } from "fs";

// Open a Logos database read-only. Throws when the file is missing so callers
// can say which store is absent; never creates or writes a file.
export function openDb(path: string): Database.Database {
  if (!existsSync(path)) {
    throw new Error(`Database not found: ${path}`);
  }
  return new Database(path, { readonly: true, fileMustExist: true });
}

// Escape LIKE wildcards in user input so "%" and "_" match literally.
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

// Logos versions differ in which tables exist, so readers pick a code path by
// checking the schema rather than the Logos version number.
export function hasTable(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return row !== undefined;
}
```

- [x] **Step 5: Point the two readers at the shared helpers**

In `src/services/sqlite-reader.ts`, replace lines 1–29 (imports through the local `escapeLike`) with:

```typescript
import { DB_PATHS } from "../config.js";
import { stripRichText } from "../utils/strip-markup.js";
import { decodeClippingBlob, extractClippingText } from "../utils/clippings.js";
import { getResourceTitles } from "./catalog-reader.js";
import { openDb, escapeLike } from "./db.js";
import { parseReference, resolveBookName } from "./reference-parser.js";
import type {
  ClippingResult,
  HighlightResult,
  FavoriteResult,
  WorkflowTemplate,
  WorkflowInstance,
  ReadingListStatus,
  ReadingListItem,
  ReadingProgress,
} from "../types.js";
```

In `src/services/catalog-reader.ts`, replace lines 1–17 with:

```typescript
import { DB_PATHS } from "../config.js";
import { stripXml } from "../utils/strip-markup.js";
import { openDb, escapeLike } from "./db.js";
import type { CatalogResource, ResourceTypeSummary } from "../types.js";
```

- [x] **Step 6: Run all tests and the build**

Run: `npx vitest run && npm run build`
Expected: all tests PASS (134 existing + 5 new); `tsc` exits 0. If `tsc` reports an unused `Database`/`existsSync` import, delete that import line.

- [x] **Step 7: Commit**

```bash
git add src/services/db.ts src/services/sqlite-reader.ts src/services/catalog-reader.ts tests/db.test.ts tests/helpers/fixtures.ts tests/helpers/schemas.ts
git commit -m "refactor: share read-only db helpers and add a sqlite fixture harness for tests"
```

---

> **As built (`0052bb6`):** matches plan.

### Task 2: Logos book numbers and raw-reference parsing

**Files:**
- Create: `src/services/logos-books.ts`
- Create: `tests/logos-books.test.ts`
- Modify: `src/services/sqlite-reader.ts` (delete `BOOKS_BY_NUMBER`, `BIBLE_RAW_RE`, `bibleRawToHuman`; `parseAnchorReference` uses `logosRawToHuman`)
- Modify: `tests/anchor-parsing.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (`src/services/logos-books.ts`):
  - `interface LogosRefPoint { book: number; chapter?: number; verse?: number }`
  - `interface LogosBibleRange { start: LogosRefPoint; end: LogosRefPoint | null }` — `end` is `null` for a single reference.
  - `logosBookName(n: number): string | null`
  - `logosBookNumber(name: string): number | null` — takes the canonical names `parseReference()` returns ("Psalms", "Song of Solomon", "1 John").
  - `parseLogosBibleRef(raw: string): LogosBibleRange | null`
  - `logosRawToHuman(raw: string): string | null` — `null` for non-Bible input or any unmapped book (40–60, >87).

- [x] **Step 1: Write the failing tests**

`tests/logos-books.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  logosBookName,
  logosBookNumber,
  parseLogosBibleRef,
  logosRawToHuman,
} from "../src/services/logos-books.js";

// Book numbers verified on Logos 54 by opening logosres:LLS:LEB;ref=bible.N.1.1
// (design doc F1): 1 Genesis, 19 Psalms, 39 Malachi, 61 Matthew, 87 Revelation;
// 40–60 opened nothing in the LEB.

describe("logosBookName", () => {
  it("maps Old Testament numbers 1–39", () => {
    expect(logosBookName(1)).toBe("Genesis");
    expect(logosBookName(19)).toBe("Psalms");
    expect(logosBookName(22)).toBe("Song of Solomon");
    expect(logosBookName(39)).toBe("Malachi");
  });

  it("maps New Testament numbers 61–87", () => {
    expect(logosBookName(61)).toBe("Matthew");
    expect(logosBookName(64)).toBe("John");
    expect(logosBookName(65)).toBe("Acts");
    expect(logosBookName(66)).toBe("Romans");
    expect(logosBookName(83)).toBe("1 John");
    expect(logosBookName(87)).toBe("Revelation");
  });

  it("leaves the deuterocanon range and out-of-range numbers unmapped", () => {
    expect(logosBookName(40)).toBeNull();
    expect(logosBookName(44)).toBeNull();
    expect(logosBookName(60)).toBeNull();
    expect(logosBookName(0)).toBeNull();
    expect(logosBookName(88)).toBeNull();
  });
});

describe("logosBookNumber", () => {
  it("returns the Logos number for a canonical book name", () => {
    expect(logosBookNumber("Genesis")).toBe(1);
    expect(logosBookNumber("John")).toBe(64);
    expect(logosBookNumber("Romans")).toBe(66);
    expect(logosBookNumber("Revelation")).toBe(87);
  });

  it("returns null for names it does not map", () => {
    expect(logosBookNumber("Tobit")).toBeNull();
    expect(logosBookNumber("john")).toBeNull();
  });
});

describe("parseLogosBibleRef", () => {
  it("parses a single verse", () => {
    expect(parseLogosBibleRef("bible.64.5.1")).toEqual({
      start: { book: 64, chapter: 5, verse: 1 },
      end: null,
    });
  });

  it("parses a verse range and ignores the edition qualifier", () => {
    expect(parseLogosBibleRef("bible+leb2.66.1.8-66.1.15")).toEqual({
      start: { book: 66, chapter: 1, verse: 8 },
      end: { book: 66, chapter: 1, verse: 15 },
    });
  });

  it("parses book-only and chapter-only shapes", () => {
    expect(parseLogosBibleRef("bible.64")).toEqual({ start: { book: 64 }, end: null });
    expect(parseLogosBibleRef("bible+csb2.61-87")).toEqual({
      start: { book: 61 },
      end: { book: 87 },
    });
    expect(parseLogosBibleRef("bible+csb2.61.1")).toEqual({
      start: { book: 61, chapter: 1 },
      end: null,
    });
    expect(parseLogosBibleRef("bible.64.1-64.2.5")).toEqual({
      start: { book: 64, chapter: 1 },
      end: { book: 64, chapter: 2, verse: 5 },
    });
  });

  it("returns null for non-Bible references", () => {
    expect(parseLogosBibleRef("page.9-13")).toBeNull();
    expect(parseLogosBibleRef("bk.%Sabbath")).toBeNull();
    expect(parseLogosBibleRef("af.1-2")).toBeNull();
    expect(parseLogosBibleRef("")).toBeNull();
  });
});

describe("logosRawToHuman", () => {
  it("formats verses, ranges and chapters with Logos book numbers", () => {
    expect(logosRawToHuman("bible.64.5.1")).toBe("John 5:1");
    expect(logosRawToHuman("bible.66.1.8-66.1.15")).toBe("Romans 1:8-15");
    expect(logosRawToHuman("bible.65.3.21-65.4.5")).toBe("Acts 3:21-4:5");
    expect(logosRawToHuman("bible.19.23")).toBe("Psalms 23");
    expect(logosRawToHuman("bible+csb2.61.1")).toBe("Matthew 1");
  });

  it("formats the observed passage-list references", () => {
    expect(logosRawToHuman("bible.18.10.21-18.10.22")).toBe("Job 10:21-22");
    expect(logosRawToHuman("bible.21.9.10")).toBe("Ecclesiastes 9:10");
    expect(logosRawToHuman("bible.23.5.14")).toBe("Isaiah 5:14");
  });

  it("formats cross-book, book-only and chapter-span ranges", () => {
    expect(logosRawToHuman("bible.65.3.21-66.4.5")).toBe("Acts 3:21-Romans 4:5");
    expect(logosRawToHuman("bible+csb2.61-87")).toBe("Matthew-Revelation");
    expect(logosRawToHuman("bible.64")).toBe("John");
    expect(logosRawToHuman("bible.64.1-64.2.5")).toBe("John 1-2:5");
    expect(logosRawToHuman("bible.64.5-64.6")).toBe("John 5-6");
    expect(logosRawToHuman("bible.64.5-64.5")).toBe("John 5");
  });

  it("returns null when any book is unmapped or the input is not a Bible reference", () => {
    expect(logosRawToHuman("bible.44.3.21")).toBeNull();
    expect(logosRawToHuman("bible.64.1.1-44.1.1")).toBeNull();
    expect(logosRawToHuman("page.9-13")).toBeNull();
  });
});
```

Replace the whole of `tests/anchor-parsing.test.ts`'s `describe("parseAnchorReference", ...)` block and its provenance comment (lines 7–87) with:

```typescript
// Fixtures are modeled on real AnchorsJson/TagsJson values observed in
// notestool.db (NotesToolManager). Book numbers follow Logos's own numbering,
// verified on Logos 54 (design doc F1/F3): Acts is 65, Romans 66; 40–60 are
// the deuterocanon and stay unmapped.

describe("parseAnchorReference", () => {
  it("parses a simple bible reference anchor", () => {
    expect(parseAnchorReference('[{"reference":{"raw":"bible.65.3.21"}}]')).toBe(
      "Acts 3:21"
    );
  });

  it("parses a verse range within one chapter", () => {
    expect(
      parseAnchorReference('[{"reference":{"raw":"bible.65.3.21-65.3.23"}}]')
    ).toBe("Acts 3:21-23");
  });

  it("parses a cross-chapter range", () => {
    expect(
      parseAnchorReference('[{"reference":{"raw":"bible.65.3.21-65.4.5"}}]')
    ).toBe("Acts 3:21-4:5");
  });

  it("parses a cross-book range without dropping the end book", () => {
    expect(
      parseAnchorReference('[{"reference":{"raw":"bible.65.3.21-66.4.5"}}]')
    ).toBe("Acts 3:21-Romans 4:5");
  });

  it("parses a chapter-only reference", () => {
    expect(parseAnchorReference('[{"reference":{"raw":"bible.19.23"}}]')).toBe(
      "Psalms 23"
    );
  });

  it("ignores the version qualifier in the raw reference", () => {
    expect(parseAnchorReference('[{"reference":{"raw":"bible+kjv.6.1.8"}}]')).toBe(
      "Joshua 1:8"
    );
    expect(
      parseAnchorReference('[{"reference":{"raw":"bible+leb2.12.5.13"}}]')
    ).toBe("2 Kings 5:13");
  });

  it("labels New Testament books by Logos numbering", () => {
    expect(parseAnchorReference('[{"reference":{"raw":"bible.64.1.45"}}]')).toBe(
      "John 1:45"
    );
    expect(parseAnchorReference('[{"reference":{"raw":"bible.66.8.28"}}]')).toBe(
      "Romans 8:28"
    );
    expect(parseAnchorReference('[{"reference":{"raw":"bible.87.22.21"}}]')).toBe(
      "Revelation 22:21"
    );
  });

  it("returns the first bible reference when multiple anchors exist", () => {
    const json =
      '[{"workflow":{"templateId":"WORKFLOW:BASIC-BIBLICAL-TOPIC-STUDY","workflowKey":"bk.%GiftsOfTheHolySpirit","responseId":"08C0D3E2B51D93DBF5AD1F399A38967B"}},{"reference":{"raw":"bible.65.3.21-65.3.23"}}]';
    expect(parseAnchorReference(json)).toBe("Acts 3:21-23");
  });

  it("returns null for textRange-only anchors (no reference key)", () => {
    const json =
      '[{"textRange":{"resourceId":"LLS:CATCATHCHRCHITL","version":"2016-08-18T23:01:31Z","offset":1391022,"length":138}}]';
    expect(parseAnchorReference(json)).toBeNull();
  });

  it("returns null for non-bible reference schemes", () => {
    expect(
      parseAnchorReference('[{"reference":{"raw":"bk.%GiftsOfTheHolySpirit"}}]')
    ).toBeNull();
  });

  it("returns null for the unmapped deuterocanon range and out-of-range numbers", () => {
    expect(parseAnchorReference('[{"reference":{"raw":"bible.44.3.21"}}]')).toBeNull();
    expect(parseAnchorReference('[{"reference":{"raw":"bible.50.1.3"}}]')).toBeNull();
    expect(parseAnchorReference('[{"reference":{"raw":"bible.88.1.1"}}]')).toBeNull();
  });

  it("returns null for null/empty/malformed JSON", () => {
    expect(parseAnchorReference(null)).toBeNull();
    expect(parseAnchorReference("")).toBeNull();
    expect(parseAnchorReference("not json")).toBeNull();
    expect(parseAnchorReference('{"not":"an array"}')).toBeNull();
    expect(parseAnchorReference("[42]")).toBeNull();
  });

  it("returns null when the reference object lacks a raw string", () => {
    expect(parseAnchorReference('[{"reference":{"passage":"John 3:16"}}]')).toBeNull();
    expect(parseAnchorReference('[{"reference":null}]')).toBeNull();
  });
});
```

Leave the `describe("parseTagsJson", ...)` block unchanged.

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/logos-books.test.ts tests/anchor-parsing.test.ts`
Expected: `logos-books` FAILS to load the module; `anchor-parsing` FAILS on the Acts/Romans/John cases (the old 1–66 table reads `bible.65` as Jude).

- [x] **Step 3: Create `src/services/logos-books.ts`**

```typescript
// Logos's own Bible book numbers, as used in raw references such as
// "bible.64.5.1" (= John 5:1). Verified on Logos 54 (design doc F1): Old
// Testament 1–39, deuterocanon 40–60, New Testament 61–87. 40–60 are
// deliberately unmapped (their order was not verified); callers show the raw
// reference string instead. Names match reference-parser's canonical names.
const LOGOS_BOOKS: Record<number, string> = {
  1: "Genesis", 2: "Exodus", 3: "Leviticus", 4: "Numbers", 5: "Deuteronomy",
  6: "Joshua", 7: "Judges", 8: "Ruth", 9: "1 Samuel", 10: "2 Samuel",
  11: "1 Kings", 12: "2 Kings", 13: "1 Chronicles", 14: "2 Chronicles",
  15: "Ezra", 16: "Nehemiah", 17: "Esther", 18: "Job", 19: "Psalms",
  20: "Proverbs", 21: "Ecclesiastes", 22: "Song of Solomon", 23: "Isaiah",
  24: "Jeremiah", 25: "Lamentations", 26: "Ezekiel", 27: "Daniel",
  28: "Hosea", 29: "Joel", 30: "Amos", 31: "Obadiah", 32: "Jonah",
  33: "Micah", 34: "Nahum", 35: "Habakkuk", 36: "Zephaniah", 37: "Haggai",
  38: "Zechariah", 39: "Malachi",
  61: "Matthew", 62: "Mark", 63: "Luke", 64: "John", 65: "Acts",
  66: "Romans", 67: "1 Corinthians", 68: "2 Corinthians", 69: "Galatians",
  70: "Ephesians", 71: "Philippians", 72: "Colossians",
  73: "1 Thessalonians", 74: "2 Thessalonians", 75: "1 Timothy",
  76: "2 Timothy", 77: "Titus", 78: "Philemon", 79: "Hebrews", 80: "James",
  81: "1 Peter", 82: "2 Peter", 83: "1 John", 84: "2 John", 85: "3 John",
  86: "Jude", 87: "Revelation",
};

const NUMBER_BY_BOOK: Map<string, number> = new Map(
  Object.entries(LOGOS_BOOKS).map(([n, name]) => [name, Number(n)])
);

export function logosBookName(n: number): string | null {
  return LOGOS_BOOKS[n] ?? null;
}

// Logos number for a canonical book name (as returned by parseReference).
export function logosBookNumber(name: string): number | null {
  return NUMBER_BY_BOOK.get(name) ?? null;
}

export interface LogosRefPoint {
  book: number;
  chapter?: number;
  verse?: number;
}

export interface LogosBibleRange {
  start: LogosRefPoint;
  /** Null for a single reference such as "bible.64.5.1". */
  end: LogosRefPoint | null;
}

// bible[+edition].B[.C[.V]][-B[.C[.V]]], e.g. "bible.64.5.1",
// "bible+leb2.65.3.21", "bible.66.1.8-66.1.15", "bible+csb2.61-87".
const LOGOS_BIBLE_RE =
  /^bible(?:\+[a-z0-9]*)?\.(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-(\d+)(?:\.(\d+))?(?:\.(\d+))?)?$/i;

function optionalInt(s: string | undefined): number | undefined {
  return s === undefined ? undefined : parseInt(s, 10);
}

// Structured form of a raw Logos Bible reference. Returns null for anything
// else (e.g. "page.9-13", "bk.%Sabbath"). Never throws.
export function parseLogosBibleRef(raw: string): LogosBibleRange | null {
  const m = raw.trim().match(LOGOS_BIBLE_RE);
  if (!m) return null;
  const start: LogosRefPoint = {
    book: parseInt(m[1], 10),
    chapter: optionalInt(m[2]),
    verse: optionalInt(m[3]),
  };
  const end: LogosRefPoint | null =
    m[4] === undefined
      ? null
      : { book: parseInt(m[4], 10), chapter: optionalInt(m[5]), verse: optionalInt(m[6]) };
  return { start, end };
}

function formatPoint(name: string, p: LogosRefPoint): string {
  if (p.chapter === undefined) return name;
  return p.verse === undefined ? `${name} ${p.chapter}` : `${name} ${p.chapter}:${p.verse}`;
}

// Readable form of a raw Logos Bible reference ("bible.66.1.8-66.1.15" ->
// "Romans 1:8-15"). Returns null when the input isn't a Bible reference or
// names an unmapped book; callers then show the raw string. Never throws.
export function logosRawToHuman(raw: string): string | null {
  const parsed = parseLogosBibleRef(raw);
  if (!parsed) return null;
  const { start, end } = parsed;
  const startName = logosBookName(start.book);
  if (!startName) return null;
  const result = formatPoint(startName, start);
  if (!end) return result;

  const endName = logosBookName(end.book);
  if (!endName) return null;
  if (end.book !== start.book) return `${result}-${formatPoint(endName, end)}`;
  if (end.chapter === undefined) return result;
  if (end.verse === undefined) {
    return end.chapter === start.chapter ? result : `${result}-${end.chapter}`;
  }
  if (start.verse !== undefined && end.chapter === start.chapter) {
    return `${result}-${end.verse}`;
  }
  return `${result}-${end.chapter}:${end.verse}`;
}
```

- [x] **Step 4: Switch `sqlite-reader.ts` to the new module**

Add the import beside the others:

```typescript
import { logosRawToHuman } from "./logos-books.js";
```

Delete, under "Anchor / Tag JSON parsing": the `// Logos Bible book numbers (standard Protestant canon order, 1-66)…` comment and `BOOKS_BY_NUMBER` table, the `// Matches raw Logos reference strings…` comment and `BIBLE_RAW_RE` constant, and the whole `bibleRawToHuman` function. In `parseAnchorReference`, replace `const human = bibleRawToHuman(raw);` with `const human = logosRawToHuman(raw);`. Then `grep -n "BOOKS_BY_NUMBER\|BIBLE_RAW_RE\|bibleRawToHuman" src/` prints nothing.

- [x] **Step 5: Run the tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS; `tsc` exits 0.

- [x] **Step 6: Commit**

```bash
git add src/services/logos-books.ts src/services/sqlite-reader.ts tests/logos-books.test.ts tests/anchor-parsing.test.ts
git commit -m "fix: label bible references with logos book numbers (nt is 61-87, not 40-66)"
```

> **As built (`669367d`):** matches plan.

---

### Task 3: Blob decoder with the 5-byte header

**Files:**
- Modify: `src/utils/clippings.ts:1-26`
- Modify: `src/services/sqlite-reader.ts` (`getClippings` uses `decodeLogosBlob`)
- Modify: `tests/clippings-utils.test.ts:1-28`

**Interfaces:**
- Consumes: nothing.
- Produces: `decodeLogosBlob(blob: Buffer | null): string | null`; `decodeClippingBlob` kept as an alias (same function object).

- [x] **Step 1: Write the failing tests**

Replace lines 1–28 of `tests/clippings-utils.test.ts` (imports, both helpers and the `decodeClippingBlob` block) with:

```typescript
import { describe, it, expect } from "vitest";
import { gzipSync } from "zlib";
import {
  decodeLogosBlob,
  decodeClippingBlob,
  extractClippingText,
} from "../src/utils/clippings.js";

// Logos blobs start with a 5-byte header: a format byte (0x01 gzip, 0x02 raw
// UTF-8) and a little-endian uint32 payload length (design doc F17).
function withHeader(prefix: number, payload: Buffer, declaredLength = payload.length): Buffer {
  const header = Buffer.alloc(5);
  header[0] = prefix;
  header.writeUInt32LE(declaredLength, 1);
  return Buffer.concat([header, payload]);
}

function makeGzipBlob(text: string): Buffer {
  return withHeader(0x01, gzipSync(Buffer.from(text, "utf-8")));
}

function makeRawBlob(text: string): Buffer {
  return withHeader(0x02, Buffer.from(text, "utf-8"));
}

describe("decodeLogosBlob", () => {
  it("decodes gzip-prefixed blobs", () => {
    const xml = "<Span><Run Text='Grace'/></Span>";
    expect(decodeLogosBlob(makeGzipBlob(xml))).toBe(xml);
  });

  it("decodes raw-prefixed blobs after the 5-byte header", () => {
    const xml = "<Span><Run Text='Peace'/></Span>";
    expect(decodeLogosBlob(makeRawBlob(xml))).toBe(xml);
  });

  it("decodes the passage-list blob observed on Logos 54", () => {
    // PassageLists.CompressedItems from a real install (synthetic-safe: it
    // holds only Bible references).
    const blob = Buffer.from(
      "02530000005B7B22726566223A226269626C652E31382E31302E32312D31382E31302E3232227D2C7B22726566223A226269626C652E32312E392E3130227D2C7B22726566223A226269626C652E32332E352E3134227D5D",
      "hex"
    );
    expect(decodeLogosBlob(blob)).toBe(
      '[{"ref":"bible.18.10.21-18.10.22"},{"ref":"bible.21.9.10"},{"ref":"bible.23.5.14"}]'
    );
  });

  it("uses only the declared length when trailing bytes follow the payload", () => {
    const blob = withHeader(0x02, Buffer.from("[1,2]garbage", "utf-8"), 5);
    expect(decodeLogosBlob(blob)).toBe("[1,2]");
  });

  it("falls back to everything after the header when the declared length is too long", () => {
    const blob = withHeader(0x02, Buffer.from("[1,2]", "utf-8"), 999);
    expect(decodeLogosBlob(blob)).toBe("[1,2]");
  });

  it("returns null for a blob shorter than its header", () => {
    expect(decodeLogosBlob(Buffer.from([0x02, 0x05, 0x00]))).toBeNull();
  });

  it("returns null for an empty blob", () => {
    expect(decodeLogosBlob(Buffer.alloc(0))).toBeNull();
    expect(decodeLogosBlob(null)).toBeNull();
  });

  it("keeps decodeClippingBlob as an alias", () => {
    expect(decodeClippingBlob).toBe(decodeLogosBlob);
  });
});
```

Leave the `describe("extractClippingText", ...)` block unchanged.

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/clippings-utils.test.ts`
Expected: FAIL — `decodeLogosBlob` is not exported, so every case errors.

- [x] **Step 3: Implement the decoder**

Replace lines 1–26 of `src/utils/clippings.ts` with:

```typescript
import { gunzipSync } from "zlib";
import { stripXml } from "./strip-markup.js";

const HEADER_LENGTH = 5;

/**
 * Decode a Logos blob field (Clippings.db, PassageList.db). Blobs start with a
 * 5-byte header: a format byte and a little-endian uint32 payload length
 * (design doc F17).
 * Prefix 0x01 = gzip payload; 0x02 = raw UTF-8 payload, cut to the declared
 * length when it fits. Anything else is decoded best-effort as UTF-8.
 * Returns null for empty, truncated or undecodable blobs. Never throws.
 */
export function decodeLogosBlob(blob: Buffer | null): string | null {
  if (!blob || blob.length === 0) return null;

  const prefix = blob[0];
  if (prefix === 0x01 || prefix === 0x02) {
    if (blob.length < HEADER_LENGTH) return null;
    const payload = blob.subarray(HEADER_LENGTH);
    try {
      if (prefix === 0x01) {
        return gunzipSync(payload).toString("utf-8");
      }
      const declared = blob.readUInt32LE(1);
      const body = declared <= payload.length ? payload.subarray(0, declared) : payload;
      return body.toString("utf-8");
    } catch {
      return null;
    }
  }

  // Unknown format: best-effort UTF-8 decode.
  return blob.toString("utf-8");
}

/** Former name, kept for existing callers. */
export const decodeClippingBlob = decodeLogosBlob;
```

In `src/services/sqlite-reader.ts`, change the import to `import { decodeLogosBlob, extractClippingText } from "../utils/clippings.js";` and replace the three `decodeClippingBlob(` calls in `getClippings` with `decodeLogosBlob(`.

- [x] **Step 4: Run the tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS; `tsc` exits 0.

- [x] **Step 5: Commit**

```bash
git add src/utils/clippings.ts src/services/sqlite-reader.ts tests/clippings-utils.test.ts
git commit -m "fix: skip the full 5-byte header when decoding raw logos blobs"
```

> **As built (`534a514`):** matches plan.

---

### Task 4: Verses for notes and highlights from the facet table

**Files:**
- Modify: `src/types.ts:53-60` (`HighlightResult`)
- Modify: `src/services/sqlite-reader.ts` (`queryVisualMarkupHighlights`, `getHighlightsFromNotes`, `NoteResult`, `getUserNotes`, anchor parsing)
- Modify: `src/index.ts` (`get_user_highlights` handler output)
- Create: `tests/notes-reader.test.ts`
- Modify: `tests/anchor-parsing.test.ts` (add `parseAnchorRawReferences` cases)

**Interfaces:**
- Consumes: `openDb`, `escapeLike`, `hasTable` (Task 1); `parseLogosBibleRef`, `logosRawToHuman` (Task 2); fixture helpers and `NOTES_SCHEMA_*` (Task 1).
- Produces:
  - `HighlightResult` gains `reference: string | null` (readable, `"; "`-joined) and `rawReferences: string[]`.
  - `NoteResult` gains `anchorRawReferences: string[]`; `anchorReference` now comes from the facet table first.
  - `parseAnchorRawReferences(anchorsJson: string | null): string[]` (exported).

- [x] **Step 1: Write the failing tests**

Append to `tests/anchor-parsing.test.ts` (add `parseAnchorRawReferences` to its import list):

```typescript
describe("parseAnchorRawReferences", () => {
  it("returns every bible raw reference in anchor order", () => {
    const json =
      '[{"reference":{"raw":"bible.66.8.28"}},{"textRange":{"resourceId":"LLS:LEB"}},{"reference":{"raw":"bible.44.1.1"}},{"reference":{"raw":"bk.%Grace"}}]';
    expect(parseAnchorRawReferences(json)).toEqual(["bible.66.8.28", "bible.44.1.1"]);
  });

  it("returns an empty array for missing or malformed JSON", () => {
    expect(parseAnchorRawReferences(null)).toEqual([]);
    expect(parseAnchorRawReferences("not json")).toEqual([]);
    expect(parseAnchorRawReferences('{"a":1}')).toEqual([]);
  });
});
```

Create `tests/notes-reader.test.ts`:

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
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/notes-reader.test.ts tests/anchor-parsing.test.ts`
Expected: FAIL — `parseAnchorRawReferences` is not exported; `anchorRawReferences`/`reference` are undefined; "Acts 9" filter returns nothing.

- [x] **Step 3: Extend `HighlightResult`**

In `src/types.ts`, replace the `HighlightResult` interface with:

```typescript
export interface HighlightResult {
  resourceId: string;
  textRange: string;
  styleName: string;
  syncDate: string | null;
  /** Human-readable title of the resource this highlight lives in (best-effort, null when the catalog is unavailable). */
  resourceTitle: string | null;
  /** Readable Bible reference(s) the highlight covers, "; "-joined (null when unknown). */
  reference: string | null;
  /** Raw Logos references behind `reference`, e.g. "bible.66.1.8-66.1.15". */
  rawReferences: string[];
}
```

- [x] **Step 4: Implement facet lookups in `sqlite-reader.ts`**

Update imports:

```typescript
import type Database from "better-sqlite3";
import { openDb, escapeLike, hasTable } from "./db.js";
import { logosRawToHuman, parseLogosBibleRef } from "./logos-books.js";
```

In `queryVisualMarkupHighlights`, add to the mapped object (after `resourceTitle: null, ...`):

```typescript
      reference: null, // visualmarkup.db stores text ranges, not Bible references
      rawReferences: [],
```

Replace the whole `getHighlightsFromNotes` function with:

```typescript
function getHighlightsFromNotes(options: {
  resourceId?: string;
  styleName?: string;
  limit?: number;
}): HighlightResult[] {
  const db = openDb(DB_PATHS.notes);
  try {
    let sql = `
      SELECT n.NoteId, r.ResourceId, n.AnchorsJson, s.Name AS StyleName, n.ModifiedDate
      FROM Notes n
      LEFT JOIN NoteStyles s ON n.NoteStyleId = s.NoteStyleId
      LEFT JOIN ResourceIds r ON n.AnchorResourceIdId = r.ResourceIdId
      WHERE n.Kind = 1 AND n.IsDeleted = 0 AND n.IsTrashed = 0
    `;
    const params: unknown[] = [];

    if (options.resourceId) {
      sql += " AND r.ResourceId = ?";
      params.push(options.resourceId);
    }
    if (options.styleName) {
      sql += " AND s.Name LIKE ? ESCAPE '\\'";
      params.push(`%${escapeLike(options.styleName)}%`);
    }
    sql += " ORDER BY n.ModifiedDate DESC";
    if (options.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as Array<{
      NoteId: number;
      ResourceId: string | null;
      AnchorsJson: string | null;
      StyleName: string | null;
      ModifiedDate: string | null;
    }>;
    const facetRefs = getFacetReferences(db, rows.map((r) => r.NoteId));

    return rows.map((r) => {
      const anchors = describeAnchors(facetRefs.get(r.NoteId), r.AnchorsJson);
      return {
        resourceId: r.ResourceId ?? "",
        textRange: r.AnchorsJson ?? "",
        styleName: r.StyleName ?? "",
        syncDate: r.ModifiedDate,
        resourceTitle: null, // filled in by withResourceTitles below
        reference: anchors.reference,
        rawReferences: anchors.rawReferences,
      };
    });
  } finally {
    db.close();
  }
}

// Logos 54+ keeps each anchor's Bible reference in NoteAnchorFacetReferences
// (design doc F2). Returns NoteId -> raw references in anchor order; empty
// when the table is absent (older installs) or no ids are given.
function getFacetReferences(db: Database.Database, noteIds: number[]): Map<number, string[]> {
  const refs = new Map<number, string[]>();
  if (noteIds.length === 0 || !hasTable(db, "NoteAnchorFacetReferences")) return refs;
  const CHUNK = 500; // stay well under SQLite's bound-parameter limit
  for (let i = 0; i < noteIds.length; i += CHUNK) {
    const chunk = noteIds.slice(i, i + CHUNK);
    const rows = db
      .prepare(`
        SELECT NoteId, Reference FROM NoteAnchorFacetReferences
        WHERE NoteId IN (${chunk.map(() => "?").join(", ")})
        ORDER BY NoteId, AnchorIndex, NoteAnchorFacetReferenceId
      `)
      .all(...chunk) as Array<{ NoteId: number; Reference: string }>;
    for (const r of rows) {
      const list = refs.get(r.NoteId) ?? [];
      list.push(r.Reference);
      refs.set(r.NoteId, list);
    }
  }
  return refs;
}

// Readable and raw Bible references for a note's or highlight's anchors: the
// facet table first (unmapped books keep their raw string), else AnchorsJson.
function describeAnchors(
  facetRefs: string[] | undefined,
  anchorsJson: string | null
): { reference: string | null; rawReferences: string[] } {
  if (facetRefs && facetRefs.length > 0) {
    return {
      reference: facetRefs.map((raw) => logosRawToHuman(raw) ?? raw).join("; "),
      rawReferences: facetRefs,
    };
  }
  return {
    reference: parseAnchorReference(anchorsJson),
    rawReferences: parseAnchorRawReferences(anchorsJson),
  };
}
```

In the `NoteResult` interface, replace the `anchorReference` doc comment and add the raw field:

```typescript
  /** Readable Bible reference(s) the note is anchored to, "; "-joined (null when none). Facet table first, then AnchorsJson. */
  anchorReference: string | null;
  /** Raw Logos references behind anchorReference, e.g. "bible.65.9.35". */
  anchorRawReferences: string[];
```

In `getUserNotes`, replace everything from `sql += " ORDER BY n.ModifiedDate DESC";` through `return filterNotesByPassage(notes, options.passage);` with:

```typescript
    sql += " ORDER BY n.ModifiedDate DESC";

    // The passage filter matches readable references after the query, so the
    // limit must wait for it — otherwise older matching notes are cut first.
    if (options.limit && !options.passage) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as Array<{
      NoteId: number;
      ExternalId: string;
      ContentRichText: string | null;
      CreatedDate: string;
      ModifiedDate: string | null;
      NotebookTitle: string | null;
      AnchorsJson: string | null;
      TagsJson: string | null;
    }>;
    const facetRefs = getFacetReferences(db, rows.map((r) => r.NoteId));

    const notes = rows
      .map((r) => {
        const anchors = describeAnchors(facetRefs.get(r.NoteId), r.AnchorsJson);
        return {
          noteId: r.NoteId,
          externalId: r.ExternalId,
          content: stripRichText(r.ContentRichText),
          createdDate: r.CreatedDate,
          modifiedDate: r.ModifiedDate,
          notebookTitle: r.NotebookTitle,
          anchorsJson: r.AnchorsJson,
          tagsJson: r.TagsJson,
          anchorReference: anchors.reference,
          anchorRawReferences: anchors.rawReferences,
          tags: parseTagsJson(r.TagsJson),
        };
      })
      .filter((n) => n.content !== null);

    const filtered = filterNotesByPassage(notes, options.passage);
    return options.limit && options.passage ? filtered.slice(0, options.limit) : filtered;
```

Replace the existing `parseAnchorReference` function (and its comment) with:

```typescript
// Raw Bible reference strings ("bible.66.8.28") from a note's AnchorsJson, in
// anchor order. Empty when the JSON is missing/malformed. Never throws.
export function parseAnchorRawReferences(anchorsJson: string | null): string[] {
  if (!anchorsJson) return [];
  let anchors: unknown;
  try {
    anchors = JSON.parse(anchorsJson);
  } catch {
    return [];
  }
  if (!Array.isArray(anchors)) return [];

  const raws: string[] = [];
  for (const anchor of anchors) {
    if (typeof anchor !== "object" || anchor === null) continue;
    const reference = (anchor as Record<string, unknown>).reference;
    if (typeof reference !== "object" || reference === null) continue;
    const raw = (reference as Record<string, unknown>).raw;
    if (typeof raw === "string" && parseLogosBibleRef(raw)) raws.push(raw);
  }
  return raws;
}

// Best-effort human-readable Bible reference from a note's AnchorsJson: the
// first raw reference whose book is mapped. Null when none. Never throws.
export function parseAnchorReference(anchorsJson: string | null): string | null {
  for (const raw of parseAnchorRawReferences(anchorsJson)) {
    const human = logosRawToHuman(raw);
    if (human) return human;
  }
  return null;
}
```

- [x] **Step 5: Show the verse in `get_user_highlights`**

In `src/index.ts`, in the `get_user_highlights` handler, replace the `lines` line with:

```typescript
      const lines = highlights.map((h) => {
        const title = h.resourceTitle ?? h.resourceId;
        const ref = h.reference ? ` — ${h.reference}` : "";
        const date = h.syncDate ? ` (${h.syncDate.slice(0, 10)})` : "";
        return `- **${h.styleName}** — ${title}${ref}${date}`;
      });
```

and change that tool's description to end "Returns each highlight's style, the resource title it lives in, the Bible passage it covers, and its date."

- [x] **Step 6: Run the tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS; `tsc` exits 0.

- [x] **Step 7: Commit**

```bash
git add src/types.ts src/services/sqlite-reader.ts src/index.ts tests/notes-reader.test.ts tests/anchor-parsing.test.ts
git commit -m "fix: read note and highlight verses from the logos 54 facet table — falls back to AnchorsJson on older installs"
```

> **As built (`125480f`):** matches plan.

---

### Task 5: Knowledge-base lookup

**Files:**
- Modify: `src/config.ts:121-132` (`DB_PATHS.autoComplete`)
- Modify: `src/types.ts` (new "Knowledge Base Types" section)
- Create: `src/services/knowledge-lookup.ts`
- Create: `tests/knowledge-lookup.test.ts`

**Interfaces:**
- Consumes: `openDb` (Task 1); `parseReference` (`reference-parser.ts`); `AUTOCOMPLETE_SCHEMA` and fixture helpers (Task 1).
- Produces:
  - `DB_PATHS.autoComplete: string`
  - Types: `KnowledgeEntry { id: string; label: string; kind: string | null; description: string | null }`; `KnowledgeResolution = { status: "resolved"; entry } | { status: "ambiguous"; matches } | { status: "not_found" } | { status: "unavailable"; message }`; `GuideTargetResolution = KnowledgeResolution | { status: "bible"; reference: string } | { status: "invalid"; message: string }`.
  - `isKnowledgeId(input: string): boolean`
  - `lookupKnowledgeIds(name: string): KnowledgeEntry[]` (throws when the file is missing)
  - `resolveKnowledgeId(input: string, options?: { kinds?: string[] }): KnowledgeResolution` (never throws)
  - `resolveGuideTarget(guideType: string, reference: string): GuideTargetResolution` (never throws)

- [x] **Step 1: Write the failing tests**

`tests/knowledge-lookup.test.ts`:

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
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/knowledge-lookup.test.ts`
Expected: FAIL — `knowledge-lookup.js` does not exist.

- [x] **Step 3: Add the database path and types**

In `src/config.ts`, add inside `DB_PATHS` after `catalog`:

```typescript
  // Name -> knowledge-base ID lookup (~110 MB; queries touch only small tables).
  autoComplete: join(LOGOS_CATALOG_DIR, "AutoComplete", "AutoComplete.db"),
```

In `src/types.ts`, add after the "Catalog Types" section:

```typescript
// ─── Knowledge Base Types ────────────────────────────────────────────────────

export interface KnowledgeEntry {
  /** Knowledge-base ID, e.g. "bk.#Moses", "bk.%Sabbath", "bk.to:DBT-5333". */
  id: string;
  label: string;
  /** Logos entry kind (IconKinds.IconKind), e.g. "Man", "Topic", "PreachingTheme". */
  kind: string | null;
  description: string | null;
}

export type KnowledgeResolution =
  | { status: "resolved"; entry: KnowledgeEntry }
  | { status: "ambiguous"; matches: KnowledgeEntry[] }
  | { status: "not_found" }
  | { status: "unavailable"; message: string };

export type GuideTargetResolution =
  | KnowledgeResolution
  | { status: "bible"; reference: string }
  | { status: "invalid"; message: string };
```

- [x] **Step 4: Create `src/services/knowledge-lookup.ts`**

```typescript
import { DB_PATHS } from "../config.js";
import { openDb } from "./db.js";
import { parseReference } from "./reference-parser.js";
import type { KnowledgeEntry, KnowledgeResolution, GuideTargetResolution } from "../types.js";

// Factbook entries and topic guides are addressed by knowledge-base IDs such
// as "bk.#Moses" (person), "bk.%Sabbath" (topic), "bk.@Abana" (place) or
// "bk.to:DBT-5333" (preaching theme); a plain name opens nothing (design doc
// F6). Logos's AutoComplete.db maps display names to those IDs.

export function isKnowledgeId(input: string): boolean {
  return input.trim().startsWith("bk.");
}

interface LabelRow {
  Id: string;
  Label: string;
  Kind: string | null;
  Description: string | null;
}

function labelQuery(where: string): string {
  return `
      SELECT t.Reference AS Id, l.LabelText AS Label, k.IconKind AS Kind,
             (SELECT d.Description
                FROM Descriptions d
                LEFT JOIN Languages g ON g.LanguageId = d.LanguageId
               WHERE d.TermId = t.TermId
               ORDER BY CASE WHEN g.Language = 'en' THEN 0 ELSE 1 END, d.DescriptionId
               LIMIT 1) AS Description
      FROM Labels l
      JOIN Terms t ON t.TermId = l.TermId
      LEFT JOIN IconKinds k ON k.IconKindId = t.IconKindId
      WHERE ${where}
      ORDER BY l.IsPrimary DESC, t.TermId
    `;
}

// Case folding that covers accented letters too ("É" = "é").
function foldCase(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

// Exact, case-insensitive name match: one entry per ID (Labels has a row per
// language), primary labels first, English descriptions preferred. SQLite's
// NOCASE folds only A–Z, and about 16% of real labels carry accents, so a
// name with non-ASCII letters that NOCASE misses is retried with full case
// folding (a slower scan, only on that path). Throws when AutoComplete.db is
// missing — resolveKnowledgeId reports that.
export function lookupKnowledgeIds(name: string): KnowledgeEntry[] {
  const db = openDb(DB_PATHS.autoComplete);
  try {
    const trimmed = name.trim();
    let rows = db.prepare(labelQuery("l.LabelText = ? COLLATE NOCASE")).all(trimmed) as LabelRow[];
    if (rows.length === 0 && /[^\x00-\x7F]/.test(trimmed)) {
      // Registered on this read-only connection only; nothing is written.
      db.function("fold_case", { deterministic: true }, (s: unknown) =>
        typeof s === "string" ? foldCase(s) : null
      );
      rows = db.prepare(labelQuery("fold_case(l.LabelText) = ?")).all(foldCase(trimmed)) as LabelRow[];
    }

    const seen = new Set<string>();
    const entries: KnowledgeEntry[] = [];
    for (const r of rows) {
      if (seen.has(r.Id)) continue;
      seen.add(r.Id);
      entries.push({ id: r.Id, label: r.Label, kind: r.Kind, description: r.Description });
    }
    return entries;
  } finally {
    db.close();
  }
}

// Turn a name or ID into one knowledge-base entry. An input starting "bk." is
// used as-is (no lookup). `kinds` keeps only entries of those IconKinds.
// Never throws: a missing lookup table comes back as "unavailable".
export function resolveKnowledgeId(
  input: string,
  options: { kinds?: string[] } = {}
): KnowledgeResolution {
  const trimmed = input.trim();
  if (isKnowledgeId(trimmed)) {
    return { status: "resolved", entry: { id: trimmed, label: trimmed, kind: null, description: null } };
  }

  let matches: KnowledgeEntry[];
  try {
    matches = lookupKnowledgeIds(trimmed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: "unavailable",
      message: msg.startsWith("Database not found")
        ? `Logos's lookup table was not found (${DB_PATHS.autoComplete}). Ask the user to open Logos once so it builds the table, then try again — or pass a knowledge-base ID such as "bk.#Moses" directly.`
        : `Logos's lookup table could not be read: ${msg}`,
    };
  }

  const { kinds } = options;
  if (kinds) {
    matches = matches.filter((m) => m.kind !== null && kinds.includes(m.kind));
  }
  if (matches.length === 1) return { status: "resolved", entry: matches[0] };
  if (matches.length > 1) return { status: "ambiguous", matches };
  return { status: "not_found" };
}

// Guides whose subject is a knowledge-base entry rather than a Bible
// reference, with the entry kinds each accepts.
const KB_GUIDE_KINDS: Record<string, string[]> = {
  "topic guide": ["Topic"],
  "sermon starter guide": ["PreachingTheme"],
};

// Decide what a guide link should point at: a knowledge-base ID (given
// directly, or looked up for topic-style guides) or a Bible reference.
// Never throws.
export function resolveGuideTarget(guideType: string, reference: string): GuideTargetResolution {
  const trimmed = reference.trim();
  if (isKnowledgeId(trimmed)) return resolveKnowledgeId(trimmed);

  const kinds = KB_GUIDE_KINDS[guideType.trim().toLowerCase()];
  if (kinds) return resolveKnowledgeId(trimmed, { kinds });

  try {
    parseReference(trimmed);
    return { status: "bible", reference: trimmed };
  } catch (e) {
    return { status: "invalid", message: e instanceof Error ? e.message : String(e) };
  }
}
```

- [x] **Step 5: Run the tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS; `tsc` exits 0.

- [x] **Step 6: Commit**

```bash
git add src/config.ts src/types.ts src/services/knowledge-lookup.ts tests/knowledge-lookup.test.ts
git commit -m "feat: resolve factbook and topic-guide names to knowledge-base ids via AutoComplete.db"
```

> **As built (`537b9be`):** matches plan.

---

### Task 6: Link style setting and the link builders

**Files:**
- Modify: `src/config.ts:140-142` ("Logos URL Schemes" section)
- Modify: `src/types.ts` (add `GuideTarget` under "Logos App Types")
- Create: `src/services/logos-urls.ts`
- Create: `tests/logos-urls.test.ts`

**Interfaces:**
- Consumes: `toLogosUrlRef` (`reference-parser.ts`).
- Produces:
  - `type LinkStyle = "current" | "legacy"`; `LOGOS_LINK_STYLE: LinkStyle`; `DEFAULT_BIBLE_RESOURCE_ID = "LLS:LEB"` (all in `config.ts`).
  - `type GuideTarget = { kind: "bible"; reference: string } | { kind: "kb"; id: string }` (`types.ts`).
  - In `logos-urls.ts` (each `style` parameter defaults to `LOGOS_LINK_STYLE`):
    - `buildPassageUrl(reference: string, bibleResourceId: string, style?): string`
    - `buildResourceUrl(resourceId: string, reference?: string): string`
    - `buildGuideUrl(guideTitle: string, target: GuideTarget, style?): string`
    - `buildFactbookUrl(target: string, style?): string` — `target` is a knowledge-base ID (`current`) or a topic name (`legacy`).
    - `buildWordStudyUrl(word: string, style?): string`
    - `buildSearchAllUrl(query: string, style?): string`
  - Builders throw only when `toLogosUrlRef` cannot parse a reference, or for a `kb` guide target in `legacy` style.

- [x] **Step 1: Write the failing tests**

`tests/logos-urls.test.ts`:

```typescript
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  buildPassageUrl,
  buildResourceUrl,
  buildGuideUrl,
  buildFactbookUrl,
  buildWordStudyUrl,
  buildSearchAllUrl,
} from "../src/services/logos-urls.js";

// "current" strings are the formats verified on Logos 54 (design doc F1, F5,
// F6); "legacy" strings must equal the URLs the server built before.

describe("buildPassageUrl", () => {
  it("opens the passage in a Bible resource (current)", () => {
    expect(buildPassageUrl("John 5:1", "LLS:LEB", "current")).toBe("logosres:LLS%3ALEB;ref=bible.Jn5.1");
    expect(buildPassageUrl("Romans 8:28-30", "LLS:CSB", "current")).toBe("logosres:LLS%3ACSB;ref=bible.Ro8.28-8.30");
  });

  it("keeps the old Bible URL (legacy)", () => {
    expect(buildPassageUrl("John 5:1", "LLS:LEB", "legacy")).toBe("logos4:///Bible/Jn5.1");
  });

  it("throws for an unparseable reference", () => {
    expect(() => buildPassageUrl("not a ref", "LLS:LEB", "current")).toThrow("Cannot parse reference");
  });
});

describe("buildResourceUrl", () => {
  it("is the same in both styles", () => {
    expect(buildResourceUrl("LLS:29.48.20", "John 5:14")).toBe("logosres:LLS%3A29.48.20;ref=bible.Jn5.14");
    expect(buildResourceUrl("LLS:29.48.20")).toBe("logosres:LLS%3A29.48.20");
  });
});

describe("buildGuideUrl", () => {
  it("uses semicolon links with the display title (current)", () => {
    expect(buildGuideUrl("Passage Guide", { kind: "bible", reference: "John 5:1" }, "current")).toBe(
      "logos4:Guide;t=Passage%20Guide;ref=bible.Jn5.1"
    );
    expect(buildGuideUrl("Exegetical Guide", { kind: "bible", reference: "John 5:14" }, "current")).toBe(
      "logos4:Guide;t=Exegetical%20Guide;ref=bible.Jn5.14"
    );
  });

  it("passes a knowledge-base subject as an encoded ref (current)", () => {
    expect(buildGuideUrl("Topic Guide", { kind: "kb", id: "bk.%Sabbath" }, "current")).toBe(
      "logos4:Guide;t=Topic%20Guide;ref=bk.%25Sabbath"
    );
    expect(buildGuideUrl("Sermon Starter Guide", { kind: "kb", id: "bk.to:DBT-5333" }, "current")).toBe(
      "logos4:Guide;t=Sermon%20Starter%20Guide;ref=bk.to%3ADBT-5333"
    );
  });

  it("keeps the old query-string URL (legacy)", () => {
    expect(buildGuideUrl("Exegetical Guide", { kind: "bible", reference: "Romans 12:1" }, "legacy")).toBe(
      "logos4:///Guide?t=Exegetical%20Guide&ref=bible.Ro12.1"
    );
  });

  it("refuses knowledge-base subjects in legacy style", () => {
    expect(() => buildGuideUrl("Topic Guide", { kind: "kb", id: "bk.%Sabbath" }, "legacy")).toThrow(
      /LOGOS_LINK_STYLE=current/
    );
  });
});

describe("buildFactbookUrl", () => {
  it("opens a knowledge-base ID (current)", () => {
    expect(buildFactbookUrl("bk.#Moses", "current")).toBe("logos4:Factbook;ref=bk.%23Moses");
    expect(buildFactbookUrl("bk.%Sabbath", "current")).toBe("logos4:Factbook;ref=bk.%25Sabbath");
  });

  it("keeps the old topic URL (legacy)", () => {
    expect(buildFactbookUrl("Sea of Galilee", "legacy")).toBe("logos4:///Factbook?ref=Sea%20of%20Galilee");
  });
});

describe("buildWordStudyUrl", () => {
  it("opens an empty Bible Word Study (current)", () => {
    expect(buildWordStudyUrl("agape", "current")).toBe("logos4:Guide;t=Bible%20Word%20Study");
  });

  it("keeps the old word URL (legacy)", () => {
    expect(buildWordStudyUrl("agape", "legacy")).toBe("logos4:///WordStudy?word=agape");
  });
});

describe("buildSearchAllUrl", () => {
  it("opens an All search with the query (current)", () => {
    expect(buildSearchAllUrl("justification by faith", "current")).toBe(
      "logos4:Search;kind=AllSearch;q=justification%20by%20faith;syntax=v2"
    );
  });

  it("keeps the old search URL (legacy)", () => {
    expect(buildSearchAllUrl("justification by faith", "legacy")).toBe(
      "logos4:///Search?kind=AllSearch&syntax=v2&q=justification%20by%20faith"
    );
  });
});

describe("LOGOS_LINK_STYLE", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function loadStyle(value: string | undefined) {
    vi.stubEnv("LOGOS_LINK_STYLE", value);
    vi.resetModules();
    return (await import("../src/config.js")).LOGOS_LINK_STYLE;
  }

  it("defaults to current", async () => {
    expect(await loadStyle(undefined)).toBe("current");
  });

  it("accepts legacy in any case", async () => {
    expect(await loadStyle("Legacy")).toBe("legacy");
  });

  it("treats unknown values as current", async () => {
    expect(await loadStyle("bogus")).toBe("current");
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/logos-urls.test.ts`
Expected: FAIL — `logos-urls.js` does not exist.

- [x] **Step 3: Add the setting and the type**

In `src/config.ts`, replace the "Logos URL Schemes" section (the banner and `LOGOS_URL_BASE`) with:

```typescript
// ─── Logos URL Schemes ───────────────────────────────────────────────────────

// "current" = link formats verified on Logos 54 (design doc F1/F5/F6);
// "legacy"  = the logos4:/// query-string URLs used before, reported to work
// on macOS Logos 48. Whether Logos accepted a guide/Factbook link can't be
// detected, so this is an explicit setting.
export type LinkStyle = "current" | "legacy";
export const LOGOS_LINK_STYLE: LinkStyle =
  process.env.LOGOS_LINK_STYLE?.trim().toLowerCase() === "legacy" ? "legacy" : "current";

// Bible to open passages in when the catalog names none.
export const DEFAULT_BIBLE_RESOURCE_ID = "LLS:LEB";
```

(`LOGOS_URL_BASE` had no users; it is removed.)

In `src/types.ts`, add under "Logos App Types" after `LogosCommandResult`:

```typescript
/** What a guide link points at: a Bible reference or a knowledge-base ID. */
export type GuideTarget =
  | { kind: "bible"; reference: string }
  | { kind: "kb"; id: string };
```

- [x] **Step 4: Create `src/services/logos-urls.ts`**

```typescript
import { LOGOS_LINK_STYLE, type LinkStyle } from "../config.js";
import { toLogosUrlRef } from "./reference-parser.js";
import type { GuideTarget } from "../types.js";

// Every link the UI tools hand to Logos. "current" builds the formats
// verified on Logos 54; "legacy" returns the exact URLs the server used
// before. Builders throw only for an unparseable Bible reference (or a
// knowledge-base guide subject in legacy style); callers report the message.

export function buildPassageUrl(
  reference: string,
  bibleResourceId: string,
  style: LinkStyle = LOGOS_LINK_STYLE
): string {
  if (style === "legacy") return `logos4:///Bible/${toLogosUrlRef(reference)}`;
  return buildResourceUrl(bibleResourceId, reference);
}

// Resource links worked unchanged on Logos 54, so both styles share them.
export function buildResourceUrl(resourceId: string, reference?: string): string {
  let url = `logosres:${encodeURIComponent(resourceId)}`;
  if (reference) url += `;ref=bible.${toLogosUrlRef(reference)}`;
  return url;
}

// Guides open by their display title ("Passage Guide"); internal template
// names opened blank tabs (design doc F5).
export function buildGuideUrl(
  guideTitle: string,
  target: GuideTarget,
  style: LinkStyle = LOGOS_LINK_STYLE
): string {
  const title = encodeURIComponent(guideTitle);
  if (style === "legacy") {
    if (target.kind !== "bible") {
      throw new Error("Guides on a knowledge-base subject need LOGOS_LINK_STYLE=current.");
    }
    return `logos4:///Guide?t=${title}&ref=bible.${toLogosUrlRef(target.reference)}`;
  }
  const ref =
    target.kind === "bible"
      ? `bible.${toLogosUrlRef(target.reference)}`
      : encodeURIComponent(target.id);
  return `logos4:Guide;t=${title};ref=${ref}`;
}

// current: `target` is a knowledge-base ID (a plain name opens nothing, F6).
// legacy: `target` is the topic name, as before.
export function buildFactbookUrl(target: string, style: LinkStyle = LOGOS_LINK_STYLE): string {
  if (style === "legacy") return `logos4:///Factbook?ref=${encodeURIComponent(target)}`;
  return `logos4:Factbook;ref=${encodeURIComponent(target)}`;
}

// Logos 54 opens Bible Word Study but ignores any word passed in the link
// (design doc F7), so the current link opens it empty.
export function buildWordStudyUrl(word: string, style: LinkStyle = LOGOS_LINK_STYLE): string {
  if (style === "legacy") return `logos4:///WordStudy?word=${encodeURIComponent(word)}`;
  return "logos4:Guide;t=Bible%20Word%20Study";
}

// Verified on Logos 54 (design doc F19, Open Question 1): opens an All
// search with the query run. The SearchKindName/QueryText form opened Search
// without the query.
export function buildSearchAllUrl(query: string, style: LinkStyle = LOGOS_LINK_STYLE): string {
  if (style === "legacy") return `logos4:///Search?kind=AllSearch&syntax=v2&q=${encodeURIComponent(query)}`;
  return `logos4:Search;kind=AllSearch;q=${encodeURIComponent(query)};syntax=v2`;
}
```

- [x] **Step 5: Run the tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS; `tsc` exits 0. (`index.ts` still uses the old `logos-app.ts` wrappers; Task 9 switches it.)

- [x] **Step 6: Commit**

```bash
git add src/config.ts src/types.ts src/services/logos-urls.ts tests/logos-urls.test.ts
git commit -m "feat: build logos links in the formats verified on logos 54 — LOGOS_LINK_STYLE=legacy keeps the old urls"
```

> **As built (`5705b4b`):** matches plan.

---

### Task 7: Most-used Bible for passage links

**Files:**
- Modify: `src/services/catalog-reader.ts` (new section after "Resource Type Summary")
- Create: `tests/preferred-bible.test.ts`

**Interfaces:**
- Consumes: `openDb` (Task 1); `CATALOG_SCHEMA`, fixture helpers (Task 1).
- Produces: `getPreferredBibleResourceId(): string | null` — never throws.

- [x] **Step 1: Write the failing test**

`tests/preferred-bible.test.ts`:

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
import { CATALOG_SCHEMA } from "./helpers/schemas.js";

type Catalog = typeof import("../src/services/catalog-reader.js");

describe("getPreferredBibleResourceId with a catalog", () => {
  let dirs: FixtureDirs;
  let catalog: Catalog;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(
      join(dirs.catalogDir, "LibraryCatalog", "catalog.db"),
      `${CATALOG_SCHEMA}
       INSERT INTO Records (ResourceId, Type, Title, UseCount, Availability) VALUES
         ('LLS:LEB', 'text.monograph.bible', 'The Lexham English Bible', 19, 2),
         ('LLS:CSB', 'text.monograph.bible', 'Christian Standard Bible', 8, 2),
         ('LLS:KJV', 'text.bible', 'King James Version', 50, 0),
         ('LLS:PNTCJN', 'text.monograph.commentary.bible', 'The Gospel according to John', 100, 2);`
    );
    useFixtureDirs(dirs);
    catalog = await import("../src/services/catalog-reader.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("picks the most-used Bible the user owns", () => {
    expect(catalog.getPreferredBibleResourceId()).toBe("LLS:LEB");
  });
});

describe("getPreferredBibleResourceId without a catalog", () => {
  let dirs: FixtureDirs;
  let catalog: Catalog;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    useFixtureDirs(dirs);
    catalog = await import("../src/services/catalog-reader.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("returns null", () => {
    expect(catalog.getPreferredBibleResourceId()).toBeNull();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/preferred-bible.test.ts`
Expected: FAIL — `catalog.getPreferredBibleResourceId is not a function`.

- [x] **Step 3: Implement**

Add to `src/services/catalog-reader.ts` before "Resource Title Lookup":

```typescript
// ─── Preferred Bible ────────────────────────────────────────────────────────

// The Bible the user opens most (catalog UseCount), for passage links that
// must name a Bible resource. Null when the catalog is missing or holds no
// available Bible; never throws.
export function getPreferredBibleResourceId(): string | null {
  try {
    const db = openDb(DB_PATHS.catalog);
    try {
      const row = db.prepare(`
        SELECT ResourceId FROM Records
        WHERE Type IN ('text.monograph.bible', 'text.bible')
          AND Availability >= 1 AND IsDataset = 0
        ORDER BY UseCount DESC
        LIMIT 1
      `).get() as { ResourceId: string } | undefined;
      return row?.ResourceId ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null; // catalog.db missing/unreadable
  }
}
```

- [x] **Step 4: Run the tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS; `tsc` exits 0.

- [x] **Step 5: Commit**

```bash
git add src/services/catalog-reader.ts tests/preferred-bible.test.ts
git commit -m "feat: find the user's most-used bible for passage links"
```

> **As built (`ed50732`):** matches plan.

---

### Task 8: Honest status text on Windows

**Files:**
- Create: `src/utils/tool-text.ts`
- Create: `tests/tool-text.test.ts`
- Modify: `src/index.ts` (`get_logos_state` handler and description; `capture_panel_screenshot` description; `diagnose` database list)
- Modify: `src/config.ts` (`OPTIONAL_DB_NAMES` after `DB_PATHS`)
- Modify: `src/cli.ts:18-23` (database loop)

**Interfaces:**
- Consumes: `CaptureToolType` (`types.ts`), `KnowledgeEntry` (`types.ts`, Task 5), `DB_PATHS.autoComplete` (Task 5).
- Produces (`src/utils/tool-text.ts`):
  - `DISPATCHED_NOTE: string` — "This only opens the Logos UI on the user's screen — no data is returned to you."
  - `uiFollowUpHint(panelType: CaptureToolType, platform?: NodeJS.Platform): string` — leading space when non-empty; `""` off macOS.
  - `logosStateText(titles: string[], platform?: NodeJS.Platform): string`
  - `formatKnowledgeChoices(matches: KnowledgeEntry[]): string`
- Produces (`src/config.ts`): `OPTIONAL_DB_NAMES: ReadonlySet<string>` — `DB_PATHS` keys that `diagnose` reports as "not present" instead of failing. PR 2 adds its stores.

- [x] **Step 1: Write the failing tests**

`tests/tool-text.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { uiFollowUpHint, logosStateText, formatKnowledgeChoices } from "../src/utils/tool-text.js";

describe("uiFollowUpHint", () => {
  it("suggests confirming with window titles or a screenshot on macOS", () => {
    expect(uiFollowUpHint("bible", "darwin")).toBe(
      " Call get_logos_state to confirm what Logos is showing, or capture_panel_screenshot (panel_type: 'bible') to see the results."
    );
  });

  it("suggests nothing where those tools cannot work", () => {
    expect(uiFollowUpHint("bible", "win32")).toBe("");
    expect(uiFollowUpHint("guide", "linux")).toBe("");
  });
});

describe("logosStateText", () => {
  it("lists window titles on macOS", () => {
    expect(logosStateText(["Logos", "John 5"], "darwin")).toBe("Logos is running. Window titles:\n- Logos\n- John 5");
    expect(logosStateText([], "darwin")).toBe("Logos is running. Window titles:\n- (no named windows found)");
  });

  it("says titles are unavailable on Windows instead of implying none are open", () => {
    expect(logosStateText([], "win32")).toBe("Logos is running. Window titles are not available on Windows.");
  });
});

describe("formatKnowledgeChoices", () => {
  it("lists each entry with its ID, kind and description", () => {
    expect(
      formatKnowledgeChoices([
        { id: "bk.#Moses", label: "Moses", kind: "Man", description: "Man, Judge" },
        { id: "bk.to:DBT-5333", label: "Healing", kind: "PreachingTheme", description: null },
        { id: "bk.%X", label: "X", kind: null, description: null },
      ])
    ).toBe(
      "- `bk.#Moses` — Moses (Man): Man, Judge\n- `bk.to:DBT-5333` — Healing (PreachingTheme)\n- `bk.%X` — X"
    );
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/tool-text.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Create `src/utils/tool-text.ts`**

```typescript
import type { CaptureToolType, KnowledgeEntry } from "../types.js";

// Window titles and screenshots come from a compiled macOS helper (design doc
// F15). Elsewhere there is nothing to confirm with, so messages must not
// suggest those tools.

export const DISPATCHED_NOTE = "This only opens the Logos UI on the user's screen — no data is returned to you.";

export function uiFollowUpHint(
  panelType: CaptureToolType,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform !== "darwin") return "";
  return ` Call get_logos_state to confirm what Logos is showing, or capture_panel_screenshot (panel_type: '${panelType}') to see the results.`;
}

export function logosStateText(
  titles: string[],
  platform: NodeJS.Platform = process.platform
): string {
  if (platform !== "darwin") {
    const where = platform === "win32" ? "Windows" : "this platform";
    return `Logos is running. Window titles are not available on ${where}.`;
  }
  const lines = titles.length > 0 ? titles.map((t) => `- ${t}`) : ["- (no named windows found)"];
  return `Logos is running. Window titles:\n${lines.join("\n")}`;
}

// One line per knowledge-base entry, for asking which of several matches the
// assistant means.
export function formatKnowledgeChoices(matches: KnowledgeEntry[]): string {
  return matches
    .map((m) => {
      const kind = m.kind ? ` (${m.kind})` : "";
      const description = m.description ? `: ${m.description}` : "";
      return `- \`${m.id}\` — ${m.label}${kind}${description}`;
    })
    .join("\n");
}
```

- [x] **Step 4: Use it in `get_logos_state`; mark screenshots macOS-only**

In `src/index.ts`, add the import:

```typescript
import { DISPATCHED_NOTE, uiFollowUpHint, logosStateText, formatKnowledgeChoices } from "./utils/tool-text.js";
```

Replace the `get_logos_state` registration (block 18) with:

```typescript
  // ── 18. get_logos_state ───────────────────────────────────────────────────
  server.tool(
    "get_logos_state",
    "Check what Logos Bible Software is currently showing: whether the app is running and, on macOS only, the titles of its open windows. Returns text. Use after navigate/open tools to confirm navigation happened, or before them to check Logos is ready. Cheap and fast — prefer this over capture_panel_screenshot when window titles are enough.",
    {},
    async () => {
      const running = await isLogosRunning();
      if (!running) return text("Logos is not running.");
      // Window titles need the macOS helper; don't try to build it elsewhere.
      const titles = process.platform === "darwin" ? await getLogosWindowTitles() : [];
      return text(logosStateText(titles));
    }
  );
```

In the `capture_panel_screenshot` registration (block 23), prefix its description with `"macOS only. "` so it begins `"macOS only. Navigate Logos to a passage/resource and capture a screenshot..."`.

`DISPATCHED_NOTE`, `uiFollowUpHint` and `formatKnowledgeChoices` are used in Task 9; until then `tsc` accepts the unused named imports (no `noUnusedLocals`).

- [x] **Step 5: Let `diagnose` tolerate stores only some Logos versions have**

In `src/config.ts`, add after the `DB_PATHS` object:

```typescript
// DB_PATHS entries that only some Logos versions (or a Logos that has run at
// least once) have. diagnose reports them as not present instead of failing;
// their tools fall back or answer "not available". visualMarkup is absent on
// Logos 54 (highlights moved to notestool.db); AutoComplete.db is built on
// first run.
export const OPTIONAL_DB_NAMES: ReadonlySet<string> = new Set(["visualMarkup", "autoComplete"]);
```

In `src/cli.ts`, add `OPTIONAL_DB_NAMES` to the `./config.js` import and replace the database loop with:

```typescript
for (const [name, path] of Object.entries(DB_PATHS)) {
  const found = existsSync(path);
  const optional = OPTIONAL_DB_NAMES.has(name);
  if (!found && !optional) ok = false;
  const icon = found ? "✓" : optional ? "-" : "✗";
  const note = !found && optional ? "  (optional: not on every Logos version)" : "";
  console.log(`  ${icon} ${name.padEnd(14)} ${path}${note}`);
}
```

In `src/index.ts`, add `OPTIONAL_DB_NAMES` to the config import (Task 9 rewrites that import; keep it there), and in the `diagnose` handler (block 24) replace the `const icon = …` line with:

```typescript
        const icon = found ? "OK" : OPTIONAL_DB_NAMES.has(name) ? "not present (optional: not on every Logos version)" : "MISSING";
```

(No unit test: both are report formatting. PR 2's server smoke test asserts the `diagnose` tool's wording.)

- [x] **Step 6: Run the tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS; `tsc` exits 0.

- [x] **Step 7: Commit**

```bash
git add src/utils/tool-text.ts src/index.ts src/config.ts src/cli.ts tests/tool-text.test.ts
git commit -m "fix: report honest logos status on windows — no window titles or screenshot hints off macos, optional stores don't fail diagnose"
```

> **As built (`9e0772c`):** matches plan.

---

### Task 9: Rewire the UI tools to the new links

**Files:**
- Modify: `src/services/logos-app.ts` (whole file)
- Create: `tests/logos-app.test.ts`
- Modify: `src/index.ts` (imports; blocks 1, 11, 12, 15, 16, 17)

**Interfaces:**
- Consumes: `buildPassageUrl`, `buildResourceUrl`, `buildGuideUrl`, `buildFactbookUrl`, `buildWordStudyUrl`, `buildSearchAllUrl` (Task 6); `LOGOS_LINK_STYLE`, `DEFAULT_BIBLE_RESOURCE_ID` (Task 6); `resolveKnowledgeId`, `resolveGuideTarget` (Task 5); `getPreferredBibleResourceId` (Task 7); `uiFollowUpHint`, `formatKnowledgeChoices` (Task 8); `GuideTarget`, `GuideTargetResolution` (Tasks 5–6).
- Produces: `launchLogosUrl(build: () => string): Promise<LogosCommandResult>` and `isLogosRunning(): Promise<boolean>` are the only exports of `logos-app.ts`. New tool parameters: `navigate_passage.bible_resource_id` (optional), `open_factbook.kb_id` (optional; `topic` becomes optional).

- [ ] **Step 1: Write the failing test**

`tests/logos-app.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { launchLogosUrl } from "../src/services/logos-app.js";

describe("launchLogosUrl", () => {
  it("returns a failed result without launching when the link cannot be built", async () => {
    const result = await launchLogosUrl(() => {
      throw new Error('Cannot parse reference: "nonsense"');
    });
    expect(result).toEqual({ success: false, command: "", error: 'Cannot parse reference: "nonsense"' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/logos-app.test.ts`
Expected: FAIL — `launchLogosUrl` is not exported.

- [ ] **Step 3: Rewrite `src/services/logos-app.ts`**

```typescript
import { execFile } from "child_process";
import { promisify } from "util";
import type { LogosCommandResult } from "../types.js";

const execFileAsync = promisify(execFile);

// Launching and "is Logos running" checks only; links are built in
// logos-urls.ts.

async function openUrl(url: string): Promise<LogosCommandResult> {
  try {
    if (process.platform === "win32") {
      // rundll32 takes the URL as one argument — avoids cmd.exe mangling
      // the `&` in query strings that `start` would require escaping for.
      await execFileAsync("rundll32", ["url.dll,FileProtocolHandler", url]);
    } else {
      await execFileAsync("open", [url]);
    }
    return { success: true, command: url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, command: url, error: msg };
  }
}

// Build a link and hand it to the OS. A builder error (e.g. an unparseable
// reference) comes back as a failed result, the same as a launch failure.
export async function launchLogosUrl(build: () => string): Promise<LogosCommandResult> {
  let url: string;
  try {
    url = build();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, command: "", error: msg };
  }
  return openUrl(url);
}

export async function isLogosRunning(): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("tasklist", [
        "/FI",
        "IMAGENAME eq Logos.exe",
        "/NH",
      ]);
      return stdout.toLowerCase().includes("logos.exe");
    }
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'tell application "System Events" to (name of processes) contains "Logos"',
    ]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}
```

(`navigateToPassage`, `searchBibleInLogos`, `openWordStudy`, `openFactbook`, `openResource`, `openGuide`, `searchAll` are gone; `searchBibleInLogos` had no caller.)

- [ ] **Step 4: Update `src/index.ts` imports and shared text**

Replace the config and `logos-app` import lines, and the `catalog-reader` import, with:

```typescript
import {
  SERVER_NAME,
  SERVER_VERSION,
  LOGOS_DATA_DIR,
  LOGOS_CATALOG_DIR,
  DB_PATHS,
  BIBLIA_API_KEY,
  LOGOS_LINK_STYLE,
  DEFAULT_BIBLE_RESOURCE_ID,
  OPTIONAL_DB_NAMES,
} from "./config.js";
```

```typescript
import { launchLogosUrl, isLogosRunning } from "./services/logos-app.js";
import {
  buildPassageUrl,
  buildResourceUrl,
  buildGuideUrl,
  buildFactbookUrl,
  buildWordStudyUrl,
  buildSearchAllUrl,
} from "./services/logos-urls.js";
import { resolveKnowledgeId, resolveGuideTarget } from "./services/knowledge-lookup.js";
```

```typescript
import { searchCatalog, getResourceTypeSummary, typeLabel, getPreferredBibleResourceId } from "./services/catalog-reader.js";
```

Change `import type { CaptureToolType } from "./types.js";` to:

```typescript
import type { CaptureToolType, GuideTarget, GuideTargetResolution } from "./types.js";
```

Add after the `image()` helper:

```typescript
const LOGOS_NOT_RUNNING =
  "Logos is not running. Ask the user to launch Logos first, or use get_bible_text / search_bible, which work without the app.";
```

(`DISPATCHED_NOTE` comes from `tool-text.ts`, imported in Task 8.)

- [ ] **Step 5: Replace the six UI tool registrations**

Replace block 1 (`navigate_passage`) with:

```typescript
  // ── 1. navigate_passage ──────────────────────────────────────────────────
  server.tool(
    "navigate_passage",
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. Open a Bible passage in the Logos Bible Software UI, in bible_resource_id if given, otherwise in the user's most-used Bible. Provide a reference like 'Genesis 1:1' or 'Romans 8:28-30'. Use to show the user a passage in Logos, or (macOS) to position the app before capture_panel_screenshot.",
    {
      reference: z.string().describe("Bible reference (e.g., 'Genesis 1:1', 'Romans 8:28-30')"),
      bible_resource_id: z.string().optional()
        .describe("Resource ID of the Bible to open it in, e.g. 'LLS:LEB' (find IDs with get_library_catalog type 'Bible'). Default: the user's most-used Bible, else LLS:LEB"),
    },
    async ({ reference, bible_resource_id }) => {
      if (!(await isLogosRunning())) return text(LOGOS_NOT_RUNNING);
      const bibleId = bible_resource_id ?? getPreferredBibleResourceId() ?? DEFAULT_BIBLE_RESOURCE_ID;
      const result = await launchLogosUrl(() => buildPassageUrl(reference, bibleId));
      if (!result.success) return err(`Failed to open passage: ${result.error}`);
      const where = LOGOS_LINK_STYLE === "current" ? ` in \`${bibleId}\`` : "";
      return text(`Dispatched to Logos: Bible passage ${reference}${where}. ${DISPATCHED_NOTE}${uiFollowUpHint("bible")}`);
    }
  );
```

Replace block 11 (`open_word_study`) with:

```typescript
  // ── 11. open_word_study ──────────────────────────────────────────────────
  server.tool(
    "open_word_study",
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. Open Bible Word Study in Logos for a Greek, Hebrew, or English word. Current Logos does not accept the word via link, so it opens empty and the user must type the word — this tool's reply says so. Use to send the user to a word study.",
    { word: z.string().describe("The word to study (e.g., 'agape', 'hesed', 'justification')") },
    async ({ word }) => {
      if (!(await isLogosRunning())) return text(LOGOS_NOT_RUNNING);
      const result = await launchLogosUrl(() => buildWordStudyUrl(word));
      if (!result.success) return err(`Failed to open word study: ${result.error}`);
      if (LOGOS_LINK_STYLE === "current") {
        return text(`Opened Bible Word Study. Logos does not accept the word via link — ask the user to type "${word}" into it (use \`g:\` / \`h:\` for Greek/Hebrew, e.g. \`g:agape\`).`);
      }
      return text(`Dispatched to Logos: word study for "${word}". ${DISPATCHED_NOTE}${uiFollowUpHint("wordstudy")}`);
    }
  );
```

Replace block 12 (`open_factbook`) with:

```typescript
  // ── 12. open_factbook ────────────────────────────────────────────────────
  server.tool(
    "open_factbook",
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. Open the Logos Factbook for a person, place, event, or topic (e.g., 'Moses', 'Jerusalem', 'Passover'). The name is looked up in Logos's own index; when it matches several entries (e.g. Moses the person and Moses the topic) nothing opens and the reply lists them — call again with kb_id.",
    {
      topic: z.string().optional().describe("Name to look up (e.g., 'Moses', 'Jerusalem', 'Passover')"),
      kb_id: z.string().optional()
        .describe("Knowledge-base ID to open directly (e.g., 'bk.#Moses'), as listed when a topic name is ambiguous. Takes precedence over topic"),
    },
    async ({ topic, kb_id }) => {
      const input = kb_id ?? topic;
      if (!input) return err("Provide a topic name or a kb_id.");
      if (!(await isLogosRunning())) return text(LOGOS_NOT_RUNNING);

      if (LOGOS_LINK_STYLE === "legacy") {
        const result = await launchLogosUrl(() => buildFactbookUrl(input));
        return result.success
          ? text(`Dispatched to Logos: Factbook entry for "${input}". ${DISPATCHED_NOTE}${uiFollowUpHint("factbook")}`)
          : err(`Failed to open Factbook: ${result.error}`);
      }

      const resolution = resolveKnowledgeId(input);
      if (resolution.status === "unavailable") return err(resolution.message);
      if (resolution.status === "not_found") {
        return text(`No Factbook entry named "${input}". Check the spelling or try a broader name; a knowledge-base ID such as "bk.#Moses" can also be passed as kb_id.`);
      }
      if (resolution.status === "ambiguous") {
        return text(`"${input}" matches ${resolution.matches.length} Factbook entries, so nothing was opened. Call open_factbook again with kb_id set to the one you mean:\n\n${formatKnowledgeChoices(resolution.matches)}`);
      }
      const { entry } = resolution;
      const result = await launchLogosUrl(() => buildFactbookUrl(entry.id));
      return result.success
        ? text(`Dispatched to Logos: Factbook entry ${entry.label} (\`${entry.id}\`). ${DISPATCHED_NOTE}${uiFollowUpHint("factbook")}`)
        : err(`Failed to open Factbook: ${result.error}`);
    }
  );
```

Replace block 15 (`open_resource`) with:

```typescript
  // ── 15. open_resource ─────────────────────────────────────────────────────
  server.tool(
    "open_resource",
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. Open a specific resource (commentary, lexicon, etc.) in Logos, optionally at a Bible passage. Use to show the user a resource, or (macOS) to position Logos before capture_panel_screenshot.",
    {
      resource_id: z.string().describe("Resource ID from the library catalog (e.g., 'LLS:CLVNCOMM')"),
      reference: z.string().optional().describe("Bible reference to navigate to within the resource (e.g., 'Romans 12:1')"),
    },
    async ({ resource_id, reference }) => {
      if (!(await isLogosRunning())) return text(LOGOS_NOT_RUNNING);
      const result = await launchLogosUrl(() => buildResourceUrl(resource_id, reference));
      const refStr = reference ? ` at ${reference}` : "";
      return result.success
        ? text(`Dispatched to Logos: resource \`${resource_id}\`${refStr}. ${DISPATCHED_NOTE}${uiFollowUpHint("resource")}`)
        : err(`Failed to open resource: ${result.error}`);
    }
  );
```

Replace block 16 (`open_guide`) with:

```typescript
  // ── 16. open_guide ────────────────────────────────────────────────────────
  server.tool(
    "open_guide",
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. Open a guide in Logos: a Passage Guide or Exegetical Guide for a Bible passage, or a Topic Guide for a topic. A topic name is looked up in Logos's own index; when it matches several entries nothing opens and the reply lists their IDs — call again with one as reference.",
    {
      guide_type: z.string()
        .describe("Guide title as shown in Logos: 'Passage Guide', 'Exegetical Guide' or 'Topic Guide' (verified); 'Sermon Starter Guide' opens without its theme (Logos ignores the subject in the link)"),
      reference: z.string()
        .describe("Bible reference for Passage/Exegetical guides (e.g., 'Romans 12:1'); for Topic Guide a topic name (e.g., 'Sabbath') or knowledge-base ID (e.g., 'bk.%Sabbath')"),
    },
    async ({ guide_type, reference }) => {
      if (!(await isLogosRunning())) return text(LOGOS_NOT_RUNNING);

      // Legacy links only ever took a Bible reference; keep that behavior.
      const resolution: GuideTargetResolution =
        LOGOS_LINK_STYLE === "legacy" ? { status: "bible", reference } : resolveGuideTarget(guide_type, reference);
      if (resolution.status === "unavailable") return err(resolution.message);
      if (resolution.status === "invalid") return err(`Failed to open guide: ${resolution.message}`);
      if (resolution.status === "not_found") {
        return text(`No ${guide_type} subject named "${reference}". Check the spelling, or pass a knowledge-base ID such as "bk.%Sabbath" as reference.`);
      }
      if (resolution.status === "ambiguous") {
        return text(`"${reference}" matches ${resolution.matches.length} entries, so nothing was opened. Call open_guide again with reference set to the ID you mean:\n\n${formatKnowledgeChoices(resolution.matches)}`);
      }

      const target: GuideTarget =
        resolution.status === "bible"
          ? { kind: "bible", reference: resolution.reference }
          : { kind: "kb", id: resolution.entry.id };
      const subject =
        resolution.status === "bible" ? resolution.reference : `${resolution.entry.label} (\`${resolution.entry.id}\`)`;
      const result = await launchLogosUrl(() => buildGuideUrl(guide_type, target));
      return result.success
        ? text(`Dispatched to Logos: ${guide_type} for ${subject}. ${DISPATCHED_NOTE}${uiFollowUpHint("guide")}`)
        : err(`Failed to open guide: ${result.error}`);
    }
  );
```

Replace block 17 (`search_all`) with:

```typescript
  // ── 17. search_all ────────────────────────────────────────────────────────
  server.tool(
    "search_all",
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. Run a search across ALL resources in the Logos library (not just Bible text) in Logos's Search panel. Use for broad research.",
    {
      query: z.string().describe("Search query (e.g., 'justification by faith', 'baptism')"),
    },
    async ({ query }) => {
      if (!(await isLogosRunning())) return text(LOGOS_NOT_RUNNING);
      const result = await launchLogosUrl(() => buildSearchAllUrl(query));
      return result.success
        ? text(`Dispatched to Logos: search for "${query}" across all resources. ${DISPATCHED_NOTE}${uiFollowUpHint("searchall")}`)
        : err(`Failed to open search: ${result.error}`);
    }
  );
```

- [ ] **Step 6: Run the tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS; `tsc` exits 0. Then `grep -n "logos4:///" src/index.ts src/services/logos-app.ts` → no output (the only remaining `logos4:///` strings are in `logos-urls.ts` legacy branches and `screenshot-capture.ts`).

- [ ] **Step 7: Commit**

```bash
git add src/services/logos-app.ts src/index.ts tests/logos-app.test.ts
git commit -m "fix: open passages, guides, factbook entries and searches with links logos 54 accepts — honest word study message"
```

---

### Task 10: Documentation

**Files:**
- Modify: `../README.md`
- Modify: `../.claude/agents/tool-tester.md` (tracked despite the `.claude/agents/` ignore rule — edit in place)

**Interfaces:**
- Consumes: tool behavior from Tasks 4–9.
- Produces: no code.

- [ ] **Step 1: README — Prerequisites**

In the Prerequisites table replace three rows:

```markdown
| **macOS or Windows** | macOS uses the `open` command and AppleScript; Windows uses the registered `logos4:` protocol handler and `tasklist`. Window titles (`get_logos_state`) and `capture_panel_screenshot` are macOS-only |
| **Logos Bible Software** | macOS: `/Applications/Logos.app` (tested with v48); Windows: standard install under `%LOCALAPPDATA%\Logos` (tested with v54) |
```

```markdown
| **Xcode Command Line Tools** | macOS only: `clang` is required to compile the window-capture helper used by `capture_panel_screenshot` (install: `xcode-select --install`) |
```

- [ ] **Step 2: README — tool tables**

In "Navigation & UI", replace the table body rows with:

```markdown
| `navigate_passage` | Opens a passage in the Logos UI (in your most-used Bible, or one you name) |
| `open_word_study` | Opens Bible Word Study (current Logos opens it empty — type the word in; see [Limitations](#limitations)) |
| `open_factbook` | Opens a Factbook entry for a person, place, event, or topic; lists the choices when a name matches several entries |
| `open_resource` | Opens a specific commentary, lexicon, or other resource in Logos at a passage |
| `open_guide` | Opens a Passage Guide or Exegetical Guide for a passage, or a Topic Guide for a topic |
| `get_logos_state` | Checks whether Logos is running and, on macOS, lists its open window titles |
| `capture_panel_screenshot` | macOS only: navigates Logos and captures the visible panel as an image for AI vision |
```

In "Search & Discovery", replace the `search_all` row with:

```markdown
| `search_all` | Runs a search across ALL resources in your library (not just Bible text) in Logos's Search panel |
```

In "Personal Study Data", replace the `get_user_highlights` row with:

```markdown
| `get_user_highlights` | Reads your highlights: style, resource, the passage covered, and date |
```

- [ ] **Step 3: README — project structure**

Replace the `logos-mcp-server/` part of the Project Structure tree with:

```
├── logos-mcp-server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                   # MCP server entry point (24 tools)
│   │   ├── cli.ts                     # Diagnose CLI entry point
│   │   ├── config.ts                  # Paths, link style, API config, constants
│   │   ├── types.ts                   # Shared TypeScript types
│   │   ├── services/
│   │   │   ├── reference-parser.ts    # Bible reference normalization
│   │   │   ├── logos-books.ts         # Logos book numbers and raw references
│   │   │   ├── biblia-api.ts          # Biblia.com REST API client
│   │   │   ├── logos-urls.ts          # Links the UI tools send to Logos
│   │   │   ├── logos-app.ts           # Launching links; is Logos running
│   │   │   ├── knowledge-lookup.ts    # Factbook names -> knowledge-base IDs
│   │   │   ├── db.ts                  # Shared read-only SQLite helpers
│   │   │   ├── sqlite-reader.ts       # Read-only Logos SQLite access
│   │   │   ├── catalog-reader.ts      # Library catalog search (catalog.db)
│   │   │   └── screenshot-capture.ts  # macOS window capture
│   │   └── utils/                     # Markup stripping, blob decoding, tool text
│   └── dist/                          # Built output (after npm run build)
```

- [ ] **Step 4: README — How It Works, link style, book numbers**

In "How It Works", replace the "URL schemes" bullet with:

```markdown
- **URL schemes** - Opens passages, resources, guides and Factbook entries in the Logos app using `logosres:` and `logos4:` links (via `open` on macOS, the registered protocol handler on Windows); see [Logos Link Style](#logos-link-style)
```

Insert after the "Logos Data Path" section (before "## Troubleshooting"):

````markdown
## Logos Link Style

Logos 54 ignores the `logos4:///…?…` query-string links older versions accepted, so by default the server sends the link formats verified on Logos 54. Set `LOGOS_LINK_STYLE` in the `env` block of `.mcp.json` to choose:

| Value | Links sent | Use when |
|---|---|---|
| `current` (default) | `logosres:<resource>;ref=…` for passages and resources; `logos4:Guide;t=<title>;ref=…`, `logos4:Factbook;ref=<id>` and `logos4:Search;kind=AllSearch;q=…;syntax=v2` | Current Logos (verified on Logos 54, Windows) |
| `legacy` | The `logos4:///Bible/…`, `logos4:///Guide?t=…&ref=…`, `logos4:///Factbook?ref=…` URLs used before | Older Logos versions where the current formats open nothing (reported to work on macOS Logos 48) |

```json
"env": {
  "BIBLIA_API_KEY": "your_key",
  "LOGOS_LINK_STYLE": "legacy"
}
```

Factbook entries and Topic Guides are opened by knowledge-base ID (e.g. `bk.#Moses`). With `current`, the server looks names up in Logos's own index, `Data/<instance-id>/AutoComplete/AutoComplete.db`, which Logos builds the first time it runs.

### Logos book numbers

Logos numbers Bible books its own way in stored references: Genesis–Malachi are 1–39, the deuterocanon 40–60, and Matthew–Revelation 61–87 (so `bible.66.8.28` is Romans 8:28). Notes and highlights are labeled with that numbering; references in the 40–60 range are shown as the raw Logos string.
````

- [ ] **Step 5: README — Troubleshooting and Limitations**

Replace the "Database not found" and "Logos doesn't open passages" entries with:

```markdown
**"Database not found"** - Logos isn't installed, or your data is at a non-standard path. Locate your databases (macOS: `find ~/Library/Application\ Support/Logos4 -name "*.db" -maxdepth 5`; Windows PowerShell: `Get-ChildItem $env:LOCALAPPDATA\Logos -Recurse -Filter *.db`) and set `LOGOS_DATA_DIR`.
```

```markdown
**Logos doesn't open passages** - Make sure Logos Bible Software is running before using the navigation tools. On an older Logos version, try `LOGOS_LINK_STYLE=legacy` (see [Logos Link Style](#logos-link-style)). If Logos is busy (still starting or indexing), a link can start a second `Logos.exe` that opens nothing — wait until Logos responds, end the extra process, and try again.

**"Logos's lookup table was not found"** - `open_factbook` and Topic Guides find entries in `AutoComplete.db`, which Logos builds when it first runs. Open Logos once and let it finish starting, or pass a knowledge-base ID such as `bk.#Moses` directly.
```

Insert before "## License":

```markdown
## Limitations

- **Word study links** - Logos 54 opens Bible Word Study but ignores the word in the link. Tried: `logos4:Guide;t=Bible%20Word%20Study;ref=…` with `g:agape`, `q=g:agape`, `lemma.lbs/grc/ἀγάπη` and `en:healing`. `open_word_study` therefore opens it empty and asks the user to type the word (`g:`/`h:` prefixes for Greek/Hebrew).
- **Sermon Starter Guide** - opens via link, but without the requested theme: Logos ignores the subject in the link.
- **Windows** - `get_logos_state` reports only whether Logos is running, and `capture_panel_screenshot` is unavailable (it relies on a macOS helper).
```

- [ ] **Step 6: tool-tester.md**

In "Database → Tool Dependencies", replace the table rows with:

```markdown
| notes | `get_user_notes`, `get_user_highlights` (current Logos stores highlights here) |
| visualMarkup | `get_user_highlights` (older Logos only; missing on current installs is normal) |
| favorites | `get_favorites` |
| readingLists | `get_reading_progress` |
| workflows | `get_study_workflows` |
| catalog | `get_library_catalog`, `get_resource_types`, `navigate_passage` (picks the Bible) |
| autoComplete | `open_factbook`, `open_guide` (Topic Guide) |
| guides | (no direct tool, but used by open_guide) |
```

In the Phase 2 table, replace rows 7, 8, 17 and 23 with:

```markdown
| 7 | "Do a word study on 'agape'" | `open_word_study` | Returns a message that Bible Word Study opened and the user must type the word (legacy link style: success message) |
| 8 | "Look up Moses in the Factbook" | `open_factbook` | Returns a choice list (Moses is a person and a topic) — then run 8a |
```

```markdown
| 17 | "Search all resources for 'baptism'" | `search_all` | Returns success message |
```

```markdown
| 23 | "Is Logos running, and what is it showing?" | `get_logos_state` | Returns running status (window titles on macOS; "not available on Windows" on Windows) |
```

Insert after the Phase 2 table (before "### Testing Rules"):

```markdown
### Follow-up checks (run after the numbered tests; not counted in the totals)

| # | Natural Question | Target Tool | Pass Criteria |
|---|-----------------|-------------|---------------|
| 8a | "Open the person Moses" (pass kb_id `bk.#Moses` from test 8's list) | `open_factbook` | Success message naming `bk.#Moses` |
| 16a | "Open the Passage Guide for John 5:1" | `open_guide` | Success message |
| 16b | "Open the Topic Guide for Sabbath" | `open_guide` | Success message naming `bk.%Sabbath` |
| 16c | "Open the Topic Guide for Healing" | `open_guide` | A choice list (Healing matches two topics) |
```

In "Testing Rules", replace the "Success message = pass" bullet with:

```markdown
- **Success message = pass** — for Logos UI tools (navigate_passage, open_word_study, open_factbook, open_resource, open_guide, search_all), a "success" response is a pass (we can't verify Logos actually opened). An explicit "Logos does not accept … via link" explanation is also a pass for open_word_study, and a choice list is a pass for an ambiguous Factbook/Topic Guide name.
```

- [ ] **Step 7: Check the docs**

Run: `grep -n "24" ../README.md ../.claude/agents/tool-tester.md`
Expected: every tool count still reads 24 (no count changes in this PR).

- [ ] **Step 8: Commit**

```bash
git add ../README.md ../.claude/agents/tool-tester.md
git commit -m "docs: document link style, logos book numbers and current-logos limitations"
```

---

### Task 11: Verification, open-question probes, and the pull request

**Files:**
- Possibly modify (only per Step 3 outcomes): `src/services/logos-urls.ts`, `tests/logos-urls.test.ts`, `src/index.ts`, `../README.md`, `../.claude/agents/tool-tester.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the PR.

- [ ] **Step 1: Full automated check**

Run: `npm test && npm run build`
Expected: all tests PASS; `tsc` exits 0.

- [ ] **Step 2: Manual verification on Windows Logos 54 (MANUAL — Will)**

Build, then restart the MCP client so it loads `dist/`. With Logos open and idle (workspace showing, not the Today page), confirm and record each result for the PR description:

1. `get_user_highlights` — the Romans highlight reads `… — Romans 1:8-15 (2023-05-24)`, not "Revelation".
2. `get_user_notes passage="Acts 9"` returns the note anchored at Acts 9:35.
3. `navigate_passage "John 5:1"` opens John 5:1 in the LEB; Logos's History panel (or `history.db`) shows a new row.
4. `open_guide` opens Passage Guide (John 5:1), Exegetical Guide (John 5:14), Topic Guide ("Sabbath") — check the tab titles.
5. `open_factbook topic="Moses"` lists `bk.#Moses` and `bk.%Moses_Person`; `open_factbook kb_id="bk.#Moses"` opens Moses.
6. `open_word_study "agape"` opens an empty Bible Word Study with the honest message.
7. `get_logos_state` → "Logos is running. Window titles are not available on Windows."
8. `search_all "justification by faith"` opens an All search with the query run.

Already observed on the test install (2026-10-15, Logos 54 idle; record in the PR): guides add `Guides|Key=…|TemplateName=<Template>` history rows, Factbook adds `Factbook|ReportId=ref:<kb id>`, and searches add `Search|…|QueryText=…`. Design doc F12 ("guides and Factbook do not") is wrong on Logos 54.

- [ ] **Step 3: Open questions (already resolved — nothing to run)**

Both open questions were probed on the test install on 2026-10-15, with Logos 54 idle, by sending each link and reading the new `history.db` row:

- **Search:** `logos4:Search;kind=AllSearch;q=baptism;syntax=v2` opened an All search with "baptism" run (history subtitle "baptism | All"). Multi-word queries work (`q=justification%20by%20faith`). `kind=BooksSearch` also works. `SearchKindName=AllSearch;QueryText=baptism` opened Search with no query. Tasks 6 and 9 already use the working form.
- **Sermon Starter Guide:** `ref=bk.to%3ADBT-5333`, `ref=bk.to:DBT-5333` and `ref=bk.%25healing` all opened it without a theme (history row `Guides|TemplateName=SermonStarterGuide`, no `Key`, empty subtitle; compare Topic Guide's `Key=Topic|ref=…`). Task 9's `guide_type` description and the README limitation say so.

- [ ] **Step 4: Push and open the PR (ask Will before pushing)**

```bash
git push -u origin fix/logos54-compat
```

```bash
gh pr create --repo robrawks/LogosBibleSoftwareMCP --base main --title "fix: logos 54 compatibility (book numbers, note verses, links, factbook ids)" --body-file pr-body.md
```

Write `pr-body.md` (do not commit it) from this template, filling the bracketed results from Steps 2–3:

```markdown
PR 1 of 3 from docs/design/2026-10-15-logos54-fixes-and-study-data-design.md.

## What changes
- Logos book numbers (NT is 61–87): notes, highlights and anchors are labeled correctly.
- Logos 54 note/highlight verses read from NoteAnchorFacetReferences (AnchorsJson fallback kept).
- Links rebuilt in the formats verified on Logos 54; `LOGOS_LINK_STYLE=legacy` keeps the old URLs.
- Factbook/Topic Guide names resolved to knowledge-base IDs via AutoComplete.db, with disambiguation.
- search_all opens an All search via `logos4:Search;kind=AllSearch;q=…;syntax=v2` (verified).
- Honest messages: word study (word not accepted via link), Sermon Starter (theme not accepted via link), Windows status.
- 0x02 blob decoder skips the full 5-byte header.

## Verified on Windows, Logos 54.0.0.252
[results of Task 11 Step 2, items 1–8]

## Needs confirmation on macOS
- With `LOGOS_LINK_STYLE=current`: navigate_passage, open_guide, open_factbook open the right thing. If not, `legacy` restores the old URLs.
- One New Testament note or highlight is labeled with the right book.
- The clipping blob decoder on a real clipping (the test install has none).
```

- [ ] **Step 5: Remove the scratch file**

```bash
rm pr-body.md
```

## Divergence index

<!-- generated by plan_map.py --write-index; do not edit -->

_No divergences recorded._

## Resume State

- **Last completed task:** none (plan written 2026-10-15).
- **Commit SHA:** plan committed on `docs/logos54-spec`.
- **Ticked checkboxes:** none.
- **Next task:** Task 1, Step 0 (create `fix/logos54-compat`).
- **Caveats:** Task 11 Steps 2–3 need Will at a Windows machine with Logos 54 running; everything before them runs unattended.
