# Study Data Tools (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the study data Logos stores locally — reading plans, per-book reading progress, browsing history and passage lists — and let every read tool return JSON. PR 2 of [2026-10-15-logos54-fixes-and-study-data-design.md](2026-10-15-logos54-fixes-and-study-data-design.md).

**Architecture:** A new `src/services/study-data.ts` holds one reader per store; each returns `null` when its file or table is absent, so tools answer "not available on this Logos version" instead of failing. `get_reading_progress` switches to `ReadingPlan.db` (keeping the old `ReadingLists.db` output as a fallback). A shared `format` parameter and `json()` helper add JSON output. A new stdio test harness runs the real server against fixture databases so tool handlers get end-to-end tests.

**Tech Stack:** TypeScript (strict, ESM), Node ≥ 18, better-sqlite3 (read-only), zod, `@modelcontextprotocol/sdk` (server and, in tests, client), tsx, Vitest.

## Summary

Plain-language version: Logos keeps your reading plans, how far you've read in each book, what you've opened recently, and your saved passage lists on disk, but the server only read an older, empty reading-list file. This plan adds readers for all four, fixes `get_reading_progress` to show real plans with the next reading and how far behind schedule you are, adds three new tools, and lets every read tool answer in JSON so other tools (or a plan builder) can use the data. Tool count goes from 24 to 27.

## Glossary

| Term | Meaning |
|---|---|
| Reading plan store | `Documents/<profile>/Documents/ReadingPlan/ReadingPlan.db`: `ReadingPlanDocuments` (plan, settings, sessions) and `ReadingPlanStatus` (progress). |
| Session | One scheduled reading day in a plan: `{date, readings:[[{resourceId, reference}]]}`. Some sessions have no readings. |
| `ReadSessions` | Text column in `ReadingPlanStatus`: the **index of the last completed session, inclusive** (design doc F16) — not a count. |
| `ScheduleId` / `SyncId` | A plan document's 16-byte .NET GUID blob, and the status row's 32-char hex form of the same GUID (first three fields byte-swapped). |
| Reading tracker | `Data/<profile>/ReadingProgressManager/readingprogressmanager.db`: `ReadingStatus.PercentageRead` (a 0–1 fraction) per resource. |
| History | `Data/<profile>/HistoryManager/history.db`: `History` rows with `Title`, `Subtitle` (the location), `LastVisited` (UTC ISO), `Bookmark` (`Resource|Id=LLS:…|…|Reference=bible+leb2.65.3.21`). |
| Passage list | `PassageList.db` `PassageLists.CompressedItems`: a Logos blob (5-byte header, F17) holding `[{"ref":"bible.18.10.21-18.10.22"},…]`. |
| Server harness | `tests/helpers/server.ts`: starts `src/index.ts` under tsx with fixture paths and talks to it as an MCP client over stdio. |

## Global Constraints

- **Depends on PR 1** (`fix/logos54-compat`). Uses its `openDb`/`escapeLike`/`hasTable` (`src/services/db.ts`), `logosRawToHuman` (`src/services/logos-books.ts`), `decodeLogosBlob` (`src/utils/clippings.ts`), `OPTIONAL_DB_NAMES` (`src/config.ts`), and the test helpers `makeFixtureDirs`/`createDb`/`useFixtureDirs`/`cleanupFixtureDirs` (`tests/helpers/fixtures.ts`) and `NOTES_SCHEMA_LOGOS54`/`CATALOG_SCHEMA` (`tests/helpers/schemas.ts`). Also uses the existing `getResourceTitles`/`resolveTypeFilter`/`typeLabel` (`src/services/catalog-reader.ts`).
- All paths below are relative to `logos-mcp-server/`; run every command from that directory.
- Branch: `feature/study-data`. Conventional commits with lower-case summaries (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
- TypeScript `strict`, ES modules, `.js` suffix on relative imports; 2-space indent, double quotes, semicolons, trailing commas. No linter exists — match the surrounding code.
- Every database is opened read-only via `openDb`, per call, closed in `finally`. Never write to any Logos file. Parameterized SQL only (the only interpolated SQL fragments are fixed strings chosen in code). `LIKE` uses `escapeLike()` with `ESCAPE '\\'`.
- Detect stores by file and table (`hasTable`), never by Logos version. A missing store is "not available on this Logos version" (plain text, not an error). Each new store's `DB_PATHS` key joins `OPTIONAL_DB_NAMES`, so `diagnose` doesn't fail on installs without it (PR 1 deviation 7).
- Do **not** modify `src/services/screenshot-capture.ts` or the Biblia tools (design non-goals).
- Best-effort parsers never throw; they return `null` / `[]`.
- No `.db` files committed; fixtures built in a temp dir at test time with column names copied from the Logos 54 install (2026-10-15) and synthetic rows.
- Services return typed objects; handlers only format. Text output stays free of internal noise (no raw offsets/ranges, no use counts).
- New tools: snake_case names and parameters, every parameter `.describe()`d with its default; descriptions say what is returned and when to use it.
- Every read tool (existing SQLite/catalog tools and the new ones) accepts `format: "text" | "json"` (default `"text"`). In JSON mode `limit` is capped at 1,000; text-mode defaults are unchanged.
- The server harness is for **read tools only** — UI tools would send real links to a running Logos.
- Tool count: **24 → 27**. Banners continue the numbering: `25. get_resource_reading_progress`, `26. get_reading_history`, `27. get_passage_lists`.

## Deviations From and Clarifications of the Spec

1. **Reading-list section is shown only when useful.** The spec says "when both exist, shows both sections". On Logos 54 `ReadingLists.db` exists but is empty (F9), so it would always add a meaningless "0/0 items" block. The old section is shown when `ReadingPlan.db` is absent or the old store has any lists/items; JSON always includes both. Its headings become "Reading Lists" / "Items" (it holds reading lists, not plans). (Task 2)
2. **No store at all is an error**: when neither `ReadingPlan.db` nor `ReadingLists.db` exists, `get_reading_progress` returns an error pointing at `diagnose` (today it throws "Database not found"). (Task 2)
3. **`PercentageRead` is a 0–1 fraction** (observed values 0.0017–0.031 alongside small read ranges) and is reported as a percent with one decimal. `Ranges` (internal text offsets) is not output. (Task 3)
4. **Plan objects carry the parsed `Settings` JSON** (`settings`) so JSON consumers get range and frequency without the server modelling every field. Full session lists are not returned (CSB plan: 261 sessions); `nextReading` is. (Task 2)
5. **Server-level tests** (stdio harness) are added; the spec lists only unit tests. (Task 1)
6. **`diagnose` CLI column width** widens from 14 to 16 so the longer database names line up. (Task 3)
7. **New stores are optional in `diagnose`**: `readingPlans`, `readingLists`, `readingProgress`, `history` and `passageLists` join PR 1's `OPTIONAL_DB_NAMES`. Each has a fallback or a "not available" reply, so a missing one is not a setup fault. (Tasks 2–5)
8. **"Latest" compares instants, not text.** `ModifiedDate` columns mix UTC offsets on the real install (`-05:00` and `-04:00` across a daylight-saving change; adversarial review, 2026-10-15), and SQLite compares text lexically. Every ordering by `ModifiedDate` uses `julianday(ModifiedDate)`. `History.LastVisited` is always UTC `Z`, so it stays a text comparison. (Tasks 2, 3, 5)

## Interfaces Produced for PR 3

| Module | Export | Used by PR 3 for |
|---|---|---|
| `src/services/study-data.ts` | `getReadingHistory(options: { since?: string; resourceId?: string; limit?: number }): HistoryVisit[] \| null`; module-internal `openIfPresent`, `HistoryRow`, `historyRowToVisit` (PR 3 appends to the same file) | confirming `open_resource` via `history.db` |
| `src/types.ts` | `HistoryVisit` | same |
| `src/utils/output.ts` | `resolveLimit(limit, defaultLimit, format)`, `OutputFormat` | `find_passage_resources` |
| `src/index.ts` | `json(data)` helper, `formatParam` zod schema | `find_passage_resources` |
| `tests/helpers/server.ts` | `startServer(dirs, extraEnv?)`, `callTool(client, name, args?)` | PR 3 server tests |
| `tests/helpers/schemas.ts` | `HISTORY_SCHEMA` | PR 3 tests |

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/services/study-data.ts` | Create | Readers for reading plans, reading tracker, history, passage lists; GUID and reference helpers |
| `src/utils/output.ts` | Create | `OutputFormat`, `MAX_JSON_LIMIT`, `resolveLimit`, `toJsonText` |
| `src/config.ts` | Modify | `DB_PATHS.readingPlans`, `.readingProgress`, `.history`; new stores join `OPTIONAL_DB_NAMES` |
| `src/types.ts` | Modify | "Study Data Types" section |
| `src/services/catalog-reader.ts` | Modify | `getResourceIdsOfType()` |
| `src/index.ts` | Modify | `json()`, `formatParam`, reading-progress rewrite, three new tools, `format` on existing read tools |
| `src/cli.ts` | Modify | Column width |
| `tests/helpers/server.ts` | Create | stdio server harness |
| `tests/helpers/schemas.ts` | Modify | Study-store schemas |
| `tests/output.test.ts`, `tests/reading-plans.test.ts`, `tests/resource-progress.test.ts`, `tests/reading-history.test.ts`, `tests/passage-lists.test.ts` | Create | Unit tests |
| `tests/server-smoke.test.ts`, `tests/server-reading-progress.test.ts`, `tests/server-study-tools.test.ts`, `tests/server-json.test.ts` | Create | Server tests |
| `../README.md`, `../.claude/agents/tool-tester.md` | Modify | Tool count 27, tables, JSON note, test rows |

---

### Task 1: JSON output helpers and the server test harness

**Files:**
- Create: `src/utils/output.ts`
- Create: `tests/output.test.ts`
- Create: `tests/helpers/server.ts`
- Create: `tests/server-smoke.test.ts`
- Modify: `src/index.ts` (imports; `json()` helper and `formatParam` after `image()`)

**Interfaces:**
- Consumes: PR 1 fixture helpers and `NOTES_SCHEMA_LOGOS54`.
- Produces:
  - `type OutputFormat = "text" | "json"`; `MAX_JSON_LIMIT = 1000`; `resolveLimit(limit: number | undefined, defaultLimit: number, format: OutputFormat | undefined): number`; `toJsonText(data: unknown): string`.
  - In `index.ts`: `json(data: unknown)` and `formatParam` (`z.enum(["text","json"]).optional()`).
  - `startServer(dirs: FixtureDirs, extraEnv?: Record<string, string>): Promise<Client>`; `callTool(client: Client, name: string, args?: Record<string, unknown>): Promise<{ text: string; isError: boolean }>`.

- [x] **Step 0: Create the branch**

If PR 1 has merged: `git fetch origin && git switch -c feature/study-data origin/main`. Otherwise stack on it: `git switch -c feature/study-data fix/logos54-compat` (open the PR against `fix/logos54-compat` in Task 7). Then `npm ci && npm test` — all PR 1 tests pass.

- [x] **Step 1: Write the failing unit tests**

`tests/output.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveLimit, toJsonText, MAX_JSON_LIMIT } from "../src/utils/output.js";

describe("resolveLimit", () => {
  it("uses the tool default when no limit is given", () => {
    expect(resolveLimit(undefined, 20, undefined)).toBe(20);
    expect(resolveLimit(undefined, 20, "text")).toBe(20);
    expect(resolveLimit(undefined, 20, "json")).toBe(20);
  });

  it("leaves text-mode limits uncapped, as before", () => {
    expect(resolveLimit(5000, 20, "text")).toBe(5000);
  });

  it("caps JSON-mode limits at 1,000", () => {
    expect(MAX_JSON_LIMIT).toBe(1000);
    expect(resolveLimit(5000, 20, "json")).toBe(1000);
    expect(resolveLimit(999, 20, "json")).toBe(999);
  });
});

describe("toJsonText", () => {
  it("pretty-prints with two-space indentation", () => {
    expect(toJsonText({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}');
  });

  it("keeps nulls", () => {
    expect(toJsonText({ title: null })).toBe('{\n  "title": null\n}');
  });
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/output.test.ts`
Expected: FAIL — `output.js` does not exist.

- [x] **Step 3: Create `src/utils/output.ts`**

```typescript
export type OutputFormat = "text" | "json";

/** Largest `limit` honored in JSON mode (design doc 2.5). */
export const MAX_JSON_LIMIT = 1000;

// The row limit a read tool should use: the caller's value or the tool's
// default, capped at MAX_JSON_LIMIT when returning JSON. Text mode keeps its
// old behavior (no cap).
export function resolveLimit(
  limit: number | undefined,
  defaultLimit: number,
  format: OutputFormat | undefined
): number {
  const value = limit ?? defaultLimit;
  return format === "json" ? Math.min(value, MAX_JSON_LIMIT) : value;
}

// Pretty-printed JSON for a text content block.
export function toJsonText(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
```

- [x] **Step 4: Add `json()` and `formatParam` to `src/index.ts`**

Add the import beside the other utils imports:

```typescript
import { resolveLimit, toJsonText } from "./utils/output.js";
```

Add after the `image()` helper:

```typescript
function json(data: unknown) {
  return text(toJsonText(data));
}

const formatParam = z.enum(["text", "json"]).optional()
  .describe('Output format: "text" (default) for reading, or "json" for structured data — raw and readable references, ISO dates, resource IDs and titles — to process further');
```

(`resolveLimit`, `json` and `formatParam` are used from Task 2 on.)

- [x] **Step 5: Create the server harness**

`tests/helpers/server.ts`:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "path";
import { fileURLToPath } from "url";
import type { FixtureDirs } from "./fixtures.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// Runs the real server (src/index.ts under tsx) as a child process pointed at
// fixture databases, and talks to it over stdio like an MCP client. Use it for
// read tools only: UI tools would send real links to a running Logos.
export async function startServer(
  dirs: FixtureDirs,
  extraEnv: Record<string, string> = {}
): Promise<Client> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, { LOGOS_DATA_DIR: dirs.dataDir, LOGOS_CATALOG_DIR: dirs.catalogDir }, extraEnv);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(PACKAGE_ROOT, "node_modules", "tsx", "dist", "cli.mjs"), join(PACKAGE_ROOT, "src", "index.ts")],
    env,
    cwd: PACKAGE_ROOT,
  });
  const client = new Client({ name: "logos-mcp-tests", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

// Call a tool and join its text content blocks.
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  return {
    text: content.map((c) => c.text ?? "").join("\n"),
    isError: result.isError === true,
  };
}
```

- [x] **Step 6: Write the server smoke test**

`tests/server-smoke.test.ts`:

```typescript
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
    expect(tools).toHaveLength(24);
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
```

- [x] **Step 7: Run all tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS (the smoke test takes about a second to start the server); `tsc` exits 0.

- [x] **Step 8: Commit**

```bash
git add src/utils/output.ts src/index.ts tests/output.test.ts tests/helpers/server.ts tests/server-smoke.test.ts
git commit -m "test: add json output helpers and an stdio harness that runs the server against fixture dbs"
```

---

> **As built (`2ab82c9`):** matches plan.

### Task 2: Reading plans in `get_reading_progress`

**Files:**
- Modify: `src/config.ts` (`DB_PATHS.readingPlans`)
- Modify: `src/types.ts` (new "Study Data Types" section)
- Create: `src/services/study-data.ts`
- Modify: `tests/helpers/schemas.ts` (`READING_PLAN_SCHEMA`, `READING_LISTS_SCHEMA`)
- Create: `tests/reading-plans.test.ts`
- Create: `tests/server-reading-progress.test.ts`
- Modify: `src/index.ts` (block 10, two formatting helpers, imports)

**Interfaces:**
- Consumes: `openDb`, `hasTable` (PR 1); `logosRawToHuman` (PR 1); `getResourceTitles` (catalog-reader); `getReadingProgress` (sqlite-reader, unchanged); `json`, `formatParam` (Task 1).
- Produces:
  - `DB_PATHS.readingPlans`
  - Types `PlanReading`, `PlanSession`, `ReadingPlan` (see Step 3).
  - `dotnetGuidBytesToHex(value: unknown): string | null`
  - `formatPlanReference(raw: string): string`
  - `localDate(d?: Date): string` (`YYYY-MM-DD`, local time)
  - `getReadingPlans(today?: string): ReadingPlan[] | null` — `null` when `ReadingPlan.db` or its `ReadingPlanDocuments` table is absent.
  - Internal helper `openIfPresent(path, table)` reused by Tasks 3–5.

- [x] **Step 1: Add the fixture schemas**

Append to `tests/helpers/schemas.ts`:

```typescript
export const READING_PLAN_SCHEMA = `
  CREATE TABLE ReadingPlanDocuments (
    Id integer primary key autoincrement,
    DocumentId text not null,
    Title text,
    Settings text,
    ScheduleId guid,
    Sessions text,
    ModifiedDate text,
    IsDeleted int not null default 0
  );
  CREATE TABLE ReadingPlanStatus (
    Id integer primary key autoincrement,
    SyncId text not null,
    ResourceId text,
    ReadSessions text,
    ModifiedDate text,
    IsDeleted int not null default 0
  );
`;

// The older reading-list store (present but empty on Logos 54, F9).
export const READING_LISTS_SCHEMA = `
  CREATE TABLE ReadingListStatuses (
    ReadingListStatusId integer primary key autoincrement,
    ReadingListPathNormalized text not null,
    ModifiedDate text,
    IsDeleted bool not null default 0,
    Title text not null,
    Author text not null,
    Path text not null,
    Status int not null
  );
  CREATE TABLE Items (
    ItemRowId integer primary key autoincrement,
    ItemId text not null,
    ReadingListPathNormalized text not null,
    IsRead bool not null default 0,
    ModifiedDate text
  );
`;
```

- [x] **Step 2: Write the failing unit tests**

`tests/reading-plans.test.ts`:

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
```

- [x] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/reading-plans.test.ts`
Expected: FAIL — `study-data.js` does not exist.

- [x] **Step 4: Add the path and types**

In `src/config.ts`, add to `DB_PATHS` after `passageLists`:

```typescript
  readingPlans: join(LOGOS_DATA_DIR, "Documents", "ReadingPlan", "ReadingPlan.db"),
```

and add `"readingPlans", "readingLists"` to `OPTIONAL_DB_NAMES` (either store is enough for `get_reading_progress`).

In `src/types.ts`, add after the `ClippingResult` interface:

```typescript
// ─── Study Data Types ────────────────────────────────────────────────────────

export interface PlanReading {
  resourceId: string | null;
  /** Raw Logos reference, e.g. "bible+csb2.87.22" or "page.9-13". */
  rawReference: string;
  /** Readable form, e.g. "Revelation 22" or "pp 9-13" (raw when unrecognized). */
  reference: string;
}

export interface PlanSession {
  /** Position in the plan's session list (ReadSessions counts in these). */
  index: number;
  /** Scheduled date, YYYY-MM-DD. */
  date: string | null;
  readings: PlanReading[];
}

export interface ReadingPlan {
  documentId: string;
  title: string;
  resourceId: string | null;
  resourceTitle: string | null;
  startDate: string | null;
  /** The plan's Settings JSON as stored (range, frequency, timeframe…). */
  settings: Record<string, unknown> | null;
  /** Sessions that have at least one reading. */
  sessionsWithReadings: number;
  /** Sessions with readings that are marked read; null when progress is unknown. */
  sessionsRead: number | null;
  /** ReadSessions as stored when it isn't a plain non-negative integer. */
  unparsedReadSessions: string | null;
  nextReading: PlanSession | null;
  /** Days between the next reading's date and today, when positive. */
  daysBehind: number | null;
  completed: boolean;
}
```

- [x] **Step 5: Create `src/services/study-data.ts`**

```typescript
import type Database from "better-sqlite3";
import { DB_PATHS } from "../config.js";
import { openDb, hasTable } from "./db.js";
import { logosRawToHuman } from "./logos-books.js";
import { getResourceTitles } from "./catalog-reader.js";
import type { PlanReading, PlanSession, ReadingPlan } from "../types.js";

// Readers for study data Logos keeps locally beyond notes and highlights.
// Each returns null when its store is absent (older Logos versions), so tools
// can say "not available" instead of failing.

// Open a store only if it has the table the reader needs; null otherwise.
function openIfPresent(path: string, table: string): Database.Database | null {
  try {
    const db = openDb(path);
    if (hasTable(db, table)) return db;
    db.close();
  } catch {
    // store absent or unreadable
  }
  return null;
}

function parseJsonObject(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ─── Reading plans ───────────────────────────────────────────────────────────

// .NET writes a GUID's first three fields little-endian. Converts a 16-byte
// ScheduleId blob to the 32-char lowercase hex ReadingPlanStatus.SyncId uses
// (bytes 46 e9 0a d8 71 73 ee 41 … -> "d80ae946737141ee…"). Also accepts a
// GUID string. Null for anything else; never throws.
export function dotnetGuidBytesToHex(value: unknown): string | null {
  if (Buffer.isBuffer(value)) {
    if (value.length !== 16) return null;
    const order = [3, 2, 1, 0, 5, 4, 7, 6, 8, 9, 10, 11, 12, 13, 14, 15];
    return order.map((i) => value[i].toString(16).padStart(2, "0")).join("");
  }
  if (typeof value === "string") {
    const hex = value.replace(/[{}-]/g, "").toLowerCase();
    return /^[0-9a-f]{32}$/.test(hex) ? hex : null;
  }
  return null;
}

const PAGE_RE = /^page\.(\d+)(?:-(\d+))?$/;

// Readable form of a reading-plan reference: a Bible reference
// ("bible+csb2.87.22" -> "Revelation 22"), a page range ("page.9-13" ->
// "pp 9-13"), or the raw string. Never throws.
export function formatPlanReference(raw: string): string {
  const bible = logosRawToHuman(raw);
  if (bible) return bible;
  const page = raw.match(PAGE_RE);
  if (page) return page[2] ? `pp ${page[1]}-${page[2]}` : `p ${page[1]}`;
  return raw;
}

export function localDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Sessions JSON: [{date, readings: [[{resourceId, reference}]]}]. Malformed
// entries become sessions without readings. Never throws.
function parseSessions(json: string | null): PlanSession[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.map((entry, index) => {
    const session = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const date = typeof session.date === "string" ? session.date.slice(0, 10) : null;
    const readings: PlanReading[] = [];
    const groups = Array.isArray(session.readings) ? session.readings : [];
    for (const group of groups) {
      for (const item of Array.isArray(group) ? group : [group]) {
        if (typeof item !== "object" || item === null) continue;
        const { resourceId, reference } = item as Record<string, unknown>;
        if (typeof reference !== "string") continue;
        readings.push({
          resourceId: typeof resourceId === "string" ? resourceId : null,
          rawReference: reference,
          reference: formatPlanReference(reference),
        });
      }
    }
    return { index, date, readings };
  });
}

// ReadingPlanStatus.ReadSessions is the index of the last completed session,
// inclusive — not a count (design doc F16). -1 means nothing read; null means
// the value isn't a plain non-negative integer (progress unknown).
function lastReadIndex(readSessions: string | null): number | null {
  if (readSessions === null || readSessions.trim() === "") return -1;
  const s = readSessions.trim();
  return /^\d+$/.test(s) ? parseInt(s, 10) : null;
}

function daysBehind(scheduled: string | null, today: string): number | null {
  if (!scheduled) return null;
  const diff = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${scheduled}T00:00:00Z`)) / 86_400_000
  );
  return Number.isFinite(diff) && diff > 0 ? diff : null;
}

interface PlanDocumentRow {
  DocumentId: string;
  Title: string | null;
  Settings: string | null;
  ScheduleId: unknown;
  Sessions: string | null;
}

function buildPlan(
  doc: PlanDocumentRow,
  readSessionsBySyncId: Map<string, string | null>,
  today: string
): ReadingPlan {
  const settings = parseJsonObject(doc.Settings);
  const sessions = parseSessions(doc.Sessions);
  const withReadings = sessions.filter((s) => s.readings.length > 0);
  const syncId = dotnetGuidBytesToHex(doc.ScheduleId);
  // No status row = the plan has read nothing.
  const rawStatus = syncId !== null ? readSessionsBySyncId.get(syncId) ?? null : null;
  const lastRead = lastReadIndex(rawStatus);

  const base = {
    documentId: doc.DocumentId,
    title: doc.Title ?? "(untitled plan)",
    resourceId: typeof settings?.resourceId === "string" ? settings.resourceId : null,
    resourceTitle: null,
    startDate: typeof settings?.startDate === "string" ? settings.startDate : null,
    settings,
    sessionsWithReadings: withReadings.length,
  };

  if (lastRead === null) {
    return {
      ...base,
      sessionsRead: null,
      unparsedReadSessions: rawStatus,
      nextReading: null,
      daysBehind: null,
      completed: false,
    };
  }

  const nextReading = withReadings.find((s) => s.index > lastRead) ?? null;
  return {
    ...base,
    sessionsRead: withReadings.filter((s) => s.index <= lastRead).length,
    unparsedReadSessions: null,
    nextReading,
    daysBehind: nextReading ? daysBehind(nextReading.date, today) : null,
    completed: nextReading === null && withReadings.length > 0,
  };
}

// The user's reading plans with progress. `today` (YYYY-MM-DD) sets "days
// behind". Null when ReadingPlan.db is absent (callers fall back to the older
// ReadingLists.db store).
export function getReadingPlans(today: string = localDate()): ReadingPlan[] | null {
  const db = openIfPresent(DB_PATHS.readingPlans, "ReadingPlanDocuments");
  if (!db) return null;
  try {
    const readSessionsBySyncId = new Map<string, string | null>();
    if (hasTable(db, "ReadingPlanStatus")) {
      const statuses = db.prepare(`
        SELECT SyncId, ReadSessions FROM ReadingPlanStatus
        WHERE IsDeleted = 0
        ORDER BY julianday(ModifiedDate)
      `).all() as Array<{ SyncId: string; ReadSessions: string | null }>;
      for (const s of statuses) {
        readSessionsBySyncId.set(s.SyncId.toLowerCase(), s.ReadSessions); // latest row wins
      }
    }

    const docs = db.prepare(`
      SELECT DocumentId, Title, Settings, ScheduleId, Sessions
      FROM ReadingPlanDocuments
      WHERE IsDeleted = 0
      ORDER BY julianday(ModifiedDate) DESC
    `).all() as PlanDocumentRow[];

    const plans = docs.map((d) => buildPlan(d, readSessionsBySyncId, today));
    const titles = getResourceTitles(
      plans.map((p) => p.resourceId).filter((id): id is string => id !== null)
    );
    return plans.map((p) => ({
      ...p,
      resourceTitle: p.resourceId ? titles.get(p.resourceId) ?? null : null,
    }));
  } finally {
    db.close();
  }
}
```

- [x] **Step 6: Run the unit tests**

Run: `npx vitest run tests/reading-plans.test.ts`
Expected: PASS.

- [x] **Step 7: Write the failing server test**

`tests/server-reading-progress.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { makeFixtureDirs, createDb, cleanupFixtureDirs, type FixtureDirs } from "./helpers/fixtures.js";
import { READING_PLAN_SCHEMA, READING_LISTS_SCHEMA } from "./helpers/schemas.js";
import { startServer, callTool } from "./helpers/server.js";

const SESSIONS = JSON.stringify([
  { date: "2025-01-01", readings: [[{ resourceId: "LLS:CSB", reference: "bible+csb2.61.1" }]] },
  { date: "2025-01-06", readings: [[{ resourceId: "LLS:CSB", reference: "bible+csb2.87.22" }]] },
]);

describe("get_reading_progress on Logos 54 (plans + empty reading lists)", () => {
  let dirs: FixtureDirs;
  let client: Client;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(
      join(dirs.dataDir, "Documents", "ReadingPlan", "ReadingPlan.db"),
      `${READING_PLAN_SCHEMA}
       INSERT INTO ReadingPlanDocuments (DocumentId, Title, Settings, ScheduleId, Sessions, IsDeleted) VALUES
         ('doc-csb', 'Read CSB in one year', '{"resourceId":"LLS:CSB"}', X'6B3C3A5680EDCE4695F0540727842B7F', '${SESSIONS}', 0);
       INSERT INTO ReadingPlanStatus (SyncId, ReadSessions, IsDeleted) VALUES ('563a3c6bed8046ce95f0540727842b7f', '0', 0);`
    );
    createDb(join(dirs.dataDir, "ReadingLists", "ReadingLists.db"), READING_LISTS_SCHEMA);
    client = await startServer(dirs);
  }, 30_000);
  afterAll(async () => {
    await client.close();
    cleanupFixtureDirs(dirs);
  });

  it("shows each plan's progress and next reading, not the empty older store", async () => {
    const { text } = await callTool(client, "get_reading_progress");
    expect(text).toContain("## Reading Plans");
    expect(text).toContain("- **Read CSB in one year** — LLS:CSB");
    expect(text).toMatch(/1 of 2 sessions read · next: Revelation 22 \(2025-01-06\) · \d+ days behind/);
    expect(text).not.toContain("Reading Lists");
  });

  it("returns both stores as JSON", async () => {
    const { text } = await callTool(client, "get_reading_progress", { format: "json" });
    const data = JSON.parse(text);
    expect(data.readingPlans[0].nextReading.readings[0].rawReference).toBe("bible+csb2.87.22");
    expect(data.readingLists.totalItems).toBe(0);
  });
});

describe("get_reading_progress on an older install (reading lists only)", () => {
  let dirs: FixtureDirs;
  let client: Client;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(
      join(dirs.dataDir, "ReadingLists", "ReadingLists.db"),
      `${READING_LISTS_SCHEMA}
       INSERT INTO ReadingListStatuses (ReadingListPathNormalized, Title, Author, Path, Status) VALUES ('p', 'Church Fathers', 'Logos', 'p', 1);
       INSERT INTO Items (ItemId, ReadingListPathNormalized, IsRead) VALUES ('i1', 'p', 1), ('i2', 'p', 0);`
    );
    client = await startServer(dirs);
  }, 30_000);
  afterAll(async () => {
    await client.close();
    cleanupFixtureDirs(dirs);
  });

  it("falls back to the reading-list output", async () => {
    const { text } = await callTool(client, "get_reading_progress");
    expect(text).toContain("## Reading Lists");
    expect(text).toContain("**Overall**: 1/2 items (50%)");
    expect(text).toContain("- **Church Fathers** by Logos — Active");
    expect(text).not.toContain("## Reading Plans");
  });
});

describe("get_reading_progress with no store", () => {
  let dirs: FixtureDirs;
  let client: Client;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    client = await startServer(dirs);
  }, 30_000);
  afterAll(async () => {
    await client.close();
    cleanupFixtureDirs(dirs);
  });

  it("returns an error that points at diagnose", async () => {
    const result = await callTool(client, "get_reading_progress");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("diagnose");
  });
});
```

- [x] **Step 8: Run it to verify it fails**

Run: `npx vitest run tests/server-reading-progress.test.ts`
Expected: FAIL — the old handler prints only the reading-list summary.

- [x] **Step 9: Rewrite block 10 in `src/index.ts`**

Add imports:

```typescript
import { getReadingPlans } from "./services/study-data.js";
```

and extend the types import to `import type { CaptureToolType, GuideTarget, GuideTargetResolution, ReadingPlan, ReadingProgress } from "./types.js";`.

Add these helpers after `canonicalReference()`:

```typescript
function formatReadingPlan(p: ReadingPlan): string {
  const book = p.resourceTitle ?? p.resourceId;
  const header = `- **${p.title}**${book ? ` — ${book}` : ""}`;
  if (p.sessionsRead === null) {
    return `${header}\n  progress unknown (ReadSessions = "${p.unparsedReadSessions}")`;
  }
  if (p.completed) {
    return `${header}\n  all ${p.sessionsWithReadings} sessions read`;
  }
  const parts = [`${p.sessionsRead} of ${p.sessionsWithReadings} sessions read`];
  if (p.nextReading) {
    const readings = p.nextReading.readings.map((r) => r.reference).join(", ");
    parts.push(`next: ${readings}${p.nextReading.date ? ` (${p.nextReading.date})` : ""}`);
  }
  if (p.daysBehind !== null) parts.push(`${p.daysBehind} days behind`);
  return `${header}\n  ${parts.join(" · ")}`;
}

function formatReadingLists(progress: ReadingProgress): string {
  const sections: string[] = [
    `## Reading Lists\n\n**Overall**: ${progress.completedItems}/${progress.totalItems} items (${progress.percentComplete}%)`,
  ];
  if (progress.statuses.length > 0) {
    sections.push(progress.statuses.map((s) => `- **${s.title}** by ${s.author} — ${s.statusLabel}`).join("\n"));
  }
  if (progress.items.length > 0) {
    const MAX_ITEMS = 20;
    const itemLines = progress.items.slice(0, MAX_ITEMS).map((i) => `- ${i.isRead ? "[read]" : "[unread]"} ${i.readingListPath}`);
    const extra = progress.items.length > MAX_ITEMS ? `\n+${progress.items.length - MAX_ITEMS} more` : "";
    sections.push(`### Items\n\n${itemLines.join("\n")}${extra}`);
  }
  return sections.join("\n\n");
}
```

Replace block 10 with:

```typescript
  // ── 10. get_reading_progress ─────────────────────────────────────────────
  server.tool(
    "get_reading_progress",
    "Show the user's Logos reading plans: for each plan its book, how many sessions are read, the next reading with its scheduled date, and how many days behind schedule it is. Also shows lists from Logos's older reading-list store when it has any. Use format 'json' for structured data (e.g. to build a new plan from where the user is).",
    { format: formatParam },
    async ({ format }) => {
      const plans = getReadingPlans();
      let lists: ReadingProgress | null;
      try {
        lists = getReadingProgress();
      } catch {
        lists = null; // ReadingLists.db absent
      }
      if (format === "json") return json({ readingPlans: plans, readingLists: lists });
      if (plans === null && lists === null) {
        return err("No reading plan store found (neither ReadingPlan.db nor ReadingLists.db). Run diagnose to check the Logos data paths.");
      }

      const sections: string[] = [];
      if (plans !== null) {
        sections.push(plans.length > 0
          ? `## Reading Plans\n\n${plans.map(formatReadingPlan).join("\n\n")}`
          : "## Reading Plans\n\nNo reading plans found.");
      }
      // Logos 54 keeps an empty older store; show it only when it is the only
      // store or actually holds lists.
      if (lists !== null && (plans === null || lists.statuses.length > 0 || lists.items.length > 0)) {
        sections.push(formatReadingLists(lists));
      }
      return text(sections.join("\n\n"));
    }
  );
```

- [x] **Step 10: Run all tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS; `tsc` exits 0.

- [x] **Step 11: Commit**

```bash
git add src/config.ts src/types.ts src/services/study-data.ts src/index.ts tests/helpers/schemas.ts tests/reading-plans.test.ts tests/server-reading-progress.test.ts
git commit -m "fix: read reading plans from ReadingPlan.db — next reading and days behind, older reading lists as fallback"
```

> **As built (`3bca2e8`):** matches plan.

---

### Task 3: `get_resource_reading_progress`

**Files:**
- Modify: `src/config.ts` (`DB_PATHS.readingProgress`)
- Modify: `src/cli.ts` (column width in the database loop PR 1 rewrote)
- Modify: `src/types.ts` (`ResourceReadingProgressEntry`)
- Modify: `src/services/catalog-reader.ts` (`getResourceIdsOfType`)
- Modify: `src/services/study-data.ts` (append reader)
- Modify: `tests/helpers/schemas.ts` (`READING_PROGRESS_SCHEMA`)
- Create: `tests/resource-progress.test.ts`
- Create: `tests/server-study-tools.test.ts`
- Modify: `src/index.ts` (new block 25)

**Interfaces:**
- Consumes: `openIfPresent`, `hasTable`, `getResourceTitles`, `resolveTypeFilter`, `escapeLike`; `json`, `formatParam`, `resolveLimit`.
- Produces:
  - `DB_PATHS.readingProgress`
  - `interface ResourceReadingProgressEntry { resourceId: string; title: string | null; percentRead: number; lastReadDate: string | null }`
  - `getResourceIdsOfType(type: string): Set<string>` (catalog-reader; empty set on failure)
  - `getResourceReadingProgress(options?: { sort?: "recent" | "percent"; type?: string; limit?: number }): ResourceReadingProgressEntry[] | null`
  - Tool `get_resource_reading_progress` (`sort`, `type`, `limit`, `format`).

- [x] **Step 1: Add the fixture schema**

Append to `tests/helpers/schemas.ts`:

```typescript
export const READING_PROGRESS_SCHEMA = `
  CREATE TABLE ResourceReadingProgress (
    RowId integer primary key autoincrement,
    SyncId text not null,
    ResourceId text not null,
    Version text not null,
    IsDeleted bool not null default 0,
    ModifiedDate text,
    SyncState int not null default 0,
    Ranges text not null default '[]'
  );
  CREATE TABLE ReadingStatus (
    RowId integer primary key autoincrement,
    ResourceId text unique not null,
    Ranges text not null default '[]',
    PercentageRead double not null default 0
  );
`;
```

- [x] **Step 2: Write the failing unit tests**

`tests/resource-progress.test.ts`:

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
import { CATALOG_SCHEMA, READING_PROGRESS_SCHEMA } from "./helpers/schemas.js";

type StudyData = typeof import("../src/services/study-data.js");

// PercentageRead values copied from the test install (fractions of the book).
const PROGRESS_ROWS = `
  INSERT INTO ReadingStatus (ResourceId, PercentageRead) VALUES
    ('LLS:SUMMBBLOT', 0.003177), ('LLS:FNDTNLDOCS', 0.03116), ('LLS:29.48.20', 0.5);
  INSERT INTO ResourceReadingProgress (SyncId, ResourceId, Version, ModifiedDate, IsDeleted) VALUES
    ('s1', 'LLS:SUMMBBLOT', 'v1', '2020-12-31T05:57:16-05:00', 0),
    -- Sorts after s1 as text but is earlier in time (10:30Z vs 10:57Z).
    ('s6', 'LLS:SUMMBBLOT', 'v0', '2020-12-31T06:30:00-04:00', 0),
    ('s2', 'LLS:FNDTNLDOCS', 'v1', '2020-12-31T06:09:13-05:00', 0),
    ('s3', 'LLS:29.48.20', 'v1', '2024-01-01T00:00:00Z', 0),
    ('s4', 'LLS:29.48.20', 'v2', '2025-03-01T00:00:00Z', 0),
    ('s5', 'LLS:29.48.20', 'v3', '2026-01-01T00:00:00Z', 1);
`;
const CATALOG_ROWS = `
  INSERT INTO Records (ResourceId, Type, Title) VALUES
    ('LLS:29.48.20', 'text.monograph.commentary.bible', 'The Gospel according to John'),
    ('LLS:FNDTNLDOCS', 'text.monograph', 'Foundational Documents'),
    ('LLS:SUMMBBLOT', 'text.monograph', 'Summary of the Bible: Old Testament');
`;

describe("getResourceReadingProgress with the reading tracker", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(join(dirs.catalogDir, "ReadingProgressManager", "readingprogressmanager.db"), READING_PROGRESS_SCHEMA + PROGRESS_ROWS);
    createDb(join(dirs.catalogDir, "LibraryCatalog", "catalog.db"), CATALOG_SCHEMA + CATALOG_ROWS);
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("sorts by most recently read, ignoring deleted progress rows", () => {
    const entries = studyData.getResourceReadingProgress();
    expect(entries?.map((e) => e.resourceId)).toEqual(["LLS:29.48.20", "LLS:FNDTNLDOCS", "LLS:SUMMBBLOT"]);
    expect(entries?.[0]).toEqual({
      resourceId: "LLS:29.48.20",
      title: "The Gospel according to John",
      percentRead: 50,
      lastReadDate: "2025-03-01T00:00:00Z",
    });
  });

  it("picks the last-read date by instant, not by text, when UTC offsets differ", () => {
    const summary = studyData.getResourceReadingProgress()?.find((e) => e.resourceId === "LLS:SUMMBBLOT");
    expect(summary?.lastReadDate).toBe("2020-12-31T05:57:16-05:00");
  });

  it("sorts by percent read and reports percents with one decimal", () => {
    const entries = studyData.getResourceReadingProgress({ sort: "percent" });
    expect(entries?.map((e) => e.percentRead)).toEqual([50, 3.1, 0.3]);
  });

  it("filters by resource type label", () => {
    const entries = studyData.getResourceReadingProgress({ type: "commentary" });
    expect(entries?.map((e) => e.resourceId)).toEqual(["LLS:29.48.20"]);
  });

  it("applies the limit after sorting and filtering", () => {
    expect(studyData.getResourceReadingProgress({ sort: "percent", limit: 1 })?.map((e) => e.resourceId)).toEqual([
      "LLS:29.48.20",
    ]);
  });
});

describe("getResourceReadingProgress without the reading tracker", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("returns null", () => {
    expect(studyData.getResourceReadingProgress()).toBeNull();
  });
});
```

- [x] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/resource-progress.test.ts`
Expected: FAIL — `getResourceReadingProgress is not a function`.

- [x] **Step 4: Implement**

`src/config.ts` — add to `DB_PATHS` after `autoComplete` (`Data/<id>` paths use `LOGOS_CATALOG_DIR`, which despite its name is the `Data/<id>` directory):

```typescript
  readingProgress: join(LOGOS_CATALOG_DIR, "ReadingProgressManager", "readingprogressmanager.db"),
```

and add `"readingProgress"` to `OPTIONAL_DB_NAMES`.

`src/cli.ts` — in the database loop, change `name.padEnd(14)` to `name.padEnd(16)`.

`src/types.ts` — append to "Study Data Types":

```typescript
export interface ResourceReadingProgressEntry {
  resourceId: string;
  title: string | null;
  /** Percent of the resource read, 0–100, one decimal. */
  percentRead: number;
  /** When the user last read in it (ISO, as Logos stored it). */
  lastReadDate: string | null;
}
```

`src/services/catalog-reader.ts` — add after `getPreferredBibleResourceId`:

```typescript
// IDs of every catalog resource whose type matches a get_library_catalog-style
// filter (label or raw dotted type), regardless of availability. Empty set on
// any failure; never throws.
export function getResourceIdsOfType(type: string): Set<string> {
  const ids = new Set<string>();
  try {
    const db = openDb(DB_PATHS.catalog);
    try {
      const patterns = resolveTypeFilter(type);
      const rows = db
        .prepare(`SELECT ResourceId FROM Records WHERE ${patterns.map(() => "Type LIKE ? ESCAPE '\\'").join(" OR ")}`)
        .all(...patterns.map((p) => `%${escapeLike(p)}%`)) as Array<{ ResourceId: string }>;
      for (const r of rows) ids.add(r.ResourceId);
    } finally {
      db.close();
    }
  } catch {
    // catalog.db missing/unreadable
  }
  return ids;
}
```

`src/services/study-data.ts` — extend the imports:

```typescript
import { getResourceTitles, getResourceIdsOfType } from "./catalog-reader.js";
import type { PlanReading, PlanSession, ReadingPlan, ResourceReadingProgressEntry } from "../types.js";
```

and append:

```typescript
// ─── Per-book reading progress ───────────────────────────────────────────────

// How far the user has read in each book, from Logos's reading tracker.
// PercentageRead is stored as a 0–1 fraction. Null when the store is absent.
export function getResourceReadingProgress(options: {
  sort?: "recent" | "percent";
  type?: string;
  limit?: number;
} = {}): ResourceReadingProgressEntry[] | null {
  const db = openIfPresent(DB_PATHS.readingProgress, "ReadingStatus");
  if (!db) return null;
  try {
    // ModifiedDate mixes UTC offsets (-05:00 and -04:00 on the test install),
    // so "latest" compares instants via julianday(), never the text.
    const lastRead = hasTable(db, "ResourceReadingProgress")
      ? `(SELECT p.ModifiedDate FROM ResourceReadingProgress p
          WHERE p.ResourceId = s.ResourceId AND p.IsDeleted = 0
          ORDER BY julianday(p.ModifiedDate) DESC LIMIT 1)`
      : "NULL";
    const order = options.sort === "percent"
      ? "s.PercentageRead DESC"
      : "LastRead IS NULL, julianday(LastRead) DESC";
    let rows = db.prepare(`
      SELECT s.ResourceId, s.PercentageRead, ${lastRead} AS LastRead
      FROM ReadingStatus s
      ORDER BY ${order}, s.ResourceId
    `).all() as Array<{ ResourceId: string; PercentageRead: number; LastRead: string | null }>;

    if (options.type) {
      const ids = getResourceIdsOfType(options.type);
      rows = rows.filter((r) => ids.has(r.ResourceId));
    }
    if (options.limit) rows = rows.slice(0, options.limit);

    const titles = getResourceTitles(rows.map((r) => r.ResourceId));
    return rows.map((r) => ({
      resourceId: r.ResourceId,
      title: titles.get(r.ResourceId) ?? null,
      percentRead: Math.round(r.PercentageRead * 1000) / 10,
      lastReadDate: r.LastRead,
    }));
  } finally {
    db.close();
  }
}
```

- [x] **Step 5: Run the unit tests**

Run: `npx vitest run tests/resource-progress.test.ts`
Expected: PASS.

- [x] **Step 6: Write the failing server test**

`tests/server-study-tools.test.ts` (Tasks 4 and 5 add to this file):

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { makeFixtureDirs, createDb, cleanupFixtureDirs, type FixtureDirs } from "./helpers/fixtures.js";
import { CATALOG_SCHEMA, READING_PROGRESS_SCHEMA } from "./helpers/schemas.js";
import { startServer, callTool } from "./helpers/server.js";

describe("study-data tools with every store present", () => {
  let dirs: FixtureDirs;
  let client: Client;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(
      join(dirs.catalogDir, "ReadingProgressManager", "readingprogressmanager.db"),
      `${READING_PROGRESS_SCHEMA}
       INSERT INTO ReadingStatus (ResourceId, PercentageRead) VALUES ('LLS:29.48.20', 0.5);
       INSERT INTO ResourceReadingProgress (SyncId, ResourceId, Version, ModifiedDate) VALUES ('s1', 'LLS:29.48.20', 'v1', '2025-03-01T00:00:00Z');`
    );
    createDb(
      join(dirs.catalogDir, "LibraryCatalog", "catalog.db"),
      `${CATALOG_SCHEMA} INSERT INTO Records (ResourceId, Type, Title) VALUES ('LLS:29.48.20', 'text.monograph.commentary.bible', 'The Gospel according to John');`
    );
    client = await startServer(dirs);
  }, 30_000);
  afterAll(async () => {
    await client.close();
    cleanupFixtureDirs(dirs);
  });

  it("lists per-book progress", async () => {
    const { text } = await callTool(client, "get_resource_reading_progress");
    expect(text).toContain("Found 1 books with reading progress");
    expect(text).toContain("- **The Gospel according to John** — 50% read (last read 2025-03-01)");
  });

  it("returns per-book progress as JSON", async () => {
    const { text } = await callTool(client, "get_resource_reading_progress", { format: "json" });
    expect(JSON.parse(text)).toEqual([
      { resourceId: "LLS:29.48.20", title: "The Gospel according to John", percentRead: 50, lastReadDate: "2025-03-01T00:00:00Z" },
    ]);
  });
});

describe("study-data tools with no stores", () => {
  let dirs: FixtureDirs;
  let client: Client;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    client = await startServer(dirs);
  }, 30_000);
  afterAll(async () => {
    await client.close();
    cleanupFixtureDirs(dirs);
  });

  it("says per-book progress is not available, without an error", async () => {
    const result = await callTool(client, "get_resource_reading_progress");
    expect(result.isError).toBe(false);
    expect(result.text).toContain("not available on this Logos version");
  });
});
```

In `tests/server-smoke.test.ts`, change `toHaveLength(24)` to `toHaveLength(25)`.

- [x] **Step 7: Run it to verify it fails**

Run: `npx vitest run tests/server-study-tools.test.ts tests/server-smoke.test.ts`
Expected: FAIL — unknown tool `get_resource_reading_progress`; tool count 24.

- [x] **Step 8: Register the tool**

In `src/index.ts`, extend the study-data import to `import { getReadingPlans, getResourceReadingProgress } from "./services/study-data.js";` and insert before `// ── Start server`:

```typescript
  // ── 25. get_resource_reading_progress ─────────────────────────────────────
  server.tool(
    "get_resource_reading_progress",
    "List how far the user has read in each Logos book — percent read and when they last read in it — from Logos's own reading tracker. Use to see which books the user is working through or has nearly finished. Filter by resource type; sort by most recent or by percent read.",
    {
      sort: z.enum(["recent", "percent"]).optional()
        .describe("Order: 'recent' (most recently read first) or 'percent' (most read first) (default: recent)"),
      type: z.string().optional()
        .describe("Filter by resource type — a human label (e.g., 'commentary') or a raw dotted type, as in get_library_catalog"),
      limit: z.number().optional().describe("Max books to return (default: 20; up to 1000 with format 'json')"),
      format: formatParam,
    },
    async ({ sort, type, limit, format }) => {
      const entries = getResourceReadingProgress({ sort, type, limit: resolveLimit(limit, 20, format) });
      if (entries === null) {
        return text("Per-book reading progress is not available on this Logos version (readingprogressmanager.db not found).");
      }
      if (format === "json") return json(entries);
      if (entries.length === 0) {
        return text(type
          ? `No reading progress for resources of type '${type}'. Remove the type filter to see all books.`
          : "No reading progress recorded yet.");
      }
      const lines = entries.map((e) => {
        const last = e.lastReadDate ? ` (last read ${e.lastReadDate.slice(0, 10)})` : "";
        return `- **${e.title ?? e.resourceId}** — ${e.percentRead}% read${last}`;
      });
      return text(`Found ${entries.length} books with reading progress:\n\n${lines.join("\n")}`);
    }
  );
```

- [x] **Step 9: Run all tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS; `tsc` exits 0.

- [x] **Step 10: Commit**

```bash
git add src/config.ts src/cli.ts src/types.ts src/services/catalog-reader.ts src/services/study-data.ts src/index.ts tests/helpers/schemas.ts tests/resource-progress.test.ts tests/server-study-tools.test.ts tests/server-smoke.test.ts
git commit -m "feat: add get_resource_reading_progress from logos's reading tracker"
```

> **As built (`04b1ba4`):** matches plan.

---

### Task 4: `get_reading_history`

**Files:**
- Modify: `src/config.ts` (`DB_PATHS.history`)
- Modify: `src/types.ts` (`HistoryBookmark`, `HistoryVisit`)
- Modify: `src/services/study-data.ts` (append)
- Modify: `tests/helpers/schemas.ts` (`HISTORY_SCHEMA`)
- Create: `tests/reading-history.test.ts`
- Modify: `tests/server-study-tools.test.ts`, `tests/server-smoke.test.ts`
- Modify: `src/index.ts` (new block 26)

**Interfaces:**
- Consumes: `openIfPresent`, `escapeLike`, `logosRawToHuman`; `json`, `formatParam`, `resolveLimit`.
- Produces:
  - `DB_PATHS.history`
  - `interface HistoryBookmark { kind: string; resourceId: string | null; rawReference: string | null }`
  - `interface HistoryVisit { id: string; title: string; subtitle: string | null; lastVisited: string; kind: string; resourceId: string | null; rawReference: string | null; reference: string | null }`
  - `parseHistoryBookmark(bookmark: string): HistoryBookmark`
  - `getReadingHistory(options?: { since?: string; resourceId?: string; limit?: number }): HistoryVisit[] | null` — newest first; `since` compares against the UTC ISO `LastVisited` string.
  - `HISTORY_SCHEMA` (tests).
  - Tool `get_reading_history` (`since`, `resource_id`, `limit`, `format`).

- [x] **Step 1: Add the fixture schema**

Append to `tests/helpers/schemas.ts`:

```typescript
export const HISTORY_SCHEMA = `
  CREATE TABLE History (
    Id text primary key,
    Title text not null,
    Subtitle text not null,
    LastVisited text not null,
    Bookmark text not null,
    ParentId text,
    SyncState int not null default 1,
    IsDeleted bool not null default 0,
    SyncRevision integer null default null
  );
`;
```

- [x] **Step 2: Write the failing unit tests**

`tests/reading-history.test.ts`:

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
```

- [x] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/reading-history.test.ts`
Expected: FAIL — `parseHistoryBookmark` is not exported.

- [x] **Step 4: Implement**

`src/config.ts` — add to `DB_PATHS` after `readingProgress`:

```typescript
  history: join(LOGOS_CATALOG_DIR, "HistoryManager", "history.db"),
```

and add `"history"` to `OPTIONAL_DB_NAMES`.

`src/types.ts` — append to "Study Data Types":

```typescript
export interface HistoryBookmark {
  /** Text before the first "|": "Resource", "Guides", "Search", "Factbook". */
  kind: string;
  /** For resource visits, the resource ID (e.g. "LLS:LEB"). */
  resourceId: string | null;
  /** Raw Logos reference of the location, e.g. "bible+leb2.65.3.21". */
  rawReference: string | null;
}

export interface HistoryVisit {
  id: string;
  /** What was opened, as Logos shows it (e.g. "LEB", "Exegetical Guide"). */
  title: string;
  /** Where in it (e.g. "John 5:1-9"); null when Logos stored none. */
  subtitle: string | null;
  /** UTC ISO timestamp. */
  lastVisited: string;
  kind: string;
  resourceId: string | null;
  rawReference: string | null;
  /** Readable form of rawReference, when it is a mapped Bible reference. */
  reference: string | null;
}
```

`src/services/study-data.ts` — change the db import to `import { openDb, hasTable, escapeLike } from "./db.js";`, add `HistoryBookmark, HistoryVisit` to the types import, and append:

```typescript
// ─── Browsing history ────────────────────────────────────────────────────────

// History.Bookmark is "Kind|Key=Value|…", e.g.
// "Resource|Id=LLS:LEB|…|Reference=bible+leb2.65.3.21". Never throws.
export function parseHistoryBookmark(bookmark: string): HistoryBookmark {
  const [kind, ...fields] = bookmark.split("|");
  const values = new Map<string, string>();
  for (const field of fields) {
    const eq = field.indexOf("=");
    if (eq > 0) values.set(field.slice(0, eq), field.slice(eq + 1));
  }
  return {
    kind: kind ?? "",
    resourceId: kind === "Resource" ? values.get("Id") || null : null,
    rawReference: values.get("Reference") || null,
  };
}

interface HistoryRow {
  Id: string;
  Title: string;
  Subtitle: string;
  LastVisited: string;
  Bookmark: string;
}

function historyRowToVisit(r: HistoryRow): HistoryVisit {
  const bookmark = parseHistoryBookmark(r.Bookmark);
  return {
    id: r.Id,
    title: r.Title,
    subtitle: r.Subtitle || null,
    lastVisited: r.LastVisited,
    kind: bookmark.kind,
    resourceId: bookmark.resourceId,
    rawReference: bookmark.rawReference,
    reference: bookmark.rawReference ? logosRawToHuman(bookmark.rawReference) : null,
  };
}

// The user's Logos browsing history, newest first. `since` is compared with
// the stored UTC ISO LastVisited, so a date ("2026-10-01") or a full
// timestamp both work. Null when history.db is absent.
export function getReadingHistory(options: {
  since?: string;
  resourceId?: string;
  limit?: number;
} = {}): HistoryVisit[] | null {
  const db = openIfPresent(DB_PATHS.history, "History");
  if (!db) return null;
  try {
    let sql = "SELECT Id, Title, Subtitle, LastVisited, Bookmark FROM History WHERE IsDeleted = 0";
    const params: unknown[] = [];
    if (options.since) {
      sql += " AND LastVisited >= ?";
      params.push(options.since);
    }
    if (options.resourceId) {
      // Exact ID match: "Resource|Id=LLS:LEB|…" but not "…Id=LLS:LEB2|…".
      sql += " AND (Bookmark LIKE ? ESCAPE '\\' OR Bookmark = ?)";
      params.push(`Resource|Id=${escapeLike(options.resourceId)}|%`, `Resource|Id=${options.resourceId}`);
    }
    sql += " ORDER BY LastVisited DESC";
    if (options.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as HistoryRow[];
    return rows.map(historyRowToVisit);
  } finally {
    db.close();
  }
}
```

- [x] **Step 5: Run the unit tests**

Run: `npx vitest run tests/reading-history.test.ts`
Expected: PASS.

- [x] **Step 6: Extend the server tests (failing)**

In `tests/server-study-tools.test.ts`: add `HISTORY_SCHEMA` to the schemas import; in the "every store present" `beforeAll`, before `startServer`, add:

```typescript
    createDb(
      join(dirs.catalogDir, "HistoryManager", "history.db"),
      `${HISTORY_SCHEMA}
       INSERT INTO History (Id, Title, Subtitle, LastVisited, Bookmark) VALUES
         ('h1', 'LEB', 'Acts 3:21', '2026-10-15T06:58:20Z', 'Resource|Id=LLS:LEB|Reference=bible+leb2.65.3.21'),
         ('h2', 'Bible Word Study', '', '2026-10-15T06:39:32Z', 'Guides|TemplateName=BibleWordStudy');`
    );
```

Add to that `describe`:

```typescript
  it("lists browsing history newest first", async () => {
    const { text } = await callTool(client, "get_reading_history");
    expect(text).toContain("Found 2 visits (newest first, times UTC)");
    expect(text).toContain("- 2026-10-15 06:58 — **LEB** — Acts 3:21\n- 2026-10-15 06:39 — **Bible Word Study**");
  });

  it("rejects a malformed since date", async () => {
    const result = await callTool(client, "get_reading_history", { since: "last week" });
    expect(result.isError).toBe(true);
  });
```

Add to the "no stores" `describe`:

```typescript
  it("says history is not available, without an error", async () => {
    const result = await callTool(client, "get_reading_history");
    expect(result.isError).toBe(false);
    expect(result.text).toContain("not available on this Logos version");
  });
```

In `tests/server-smoke.test.ts`, change the tool count to `26`.

- [x] **Step 7: Run them to verify they fail**

Run: `npx vitest run tests/server-study-tools.test.ts tests/server-smoke.test.ts`
Expected: FAIL — unknown tool `get_reading_history`.

- [x] **Step 8: Register the tool**

Extend the study-data import in `src/index.ts` with `getReadingHistory`, and insert after block 25:

```typescript
  // ── 26. get_reading_history ───────────────────────────────────────────────
  server.tool(
    "get_reading_history",
    "Read the user's Logos browsing history — the books, Bible passages, guides and searches they opened, newest first, with when and where. This is the user's own usage history; use it to see what they have been studying recently or to pick up where they left off.",
    {
      since: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Use an ISO date such as 2026-10-01").optional()
        .describe("Only visits on or after this ISO date/time, UTC (e.g., '2026-10-01')"),
      resource_id: z.string().optional().describe("Only visits to this resource (e.g., 'LLS:LEB')"),
      limit: z.number().optional().describe("Max visits to return (default: 20; up to 1000 with format 'json')"),
      format: formatParam,
    },
    async ({ since, resource_id, limit, format }) => {
      const visits = getReadingHistory({ since, resourceId: resource_id, limit: resolveLimit(limit, 20, format) });
      if (visits === null) {
        return text("Reading history is not available on this Logos version (history.db not found).");
      }
      if (format === "json") return json(visits);
      if (visits.length === 0) {
        return text(since || resource_id
          ? "No history matched those filters. Try removing since or resource_id."
          : "No history recorded yet.");
      }
      const lines = visits.map((v) => {
        const when = v.lastVisited.replace("T", " ").slice(0, 16);
        const where = v.subtitle ? ` — ${v.subtitle}` : "";
        return `- ${when} — **${v.title}**${where}`;
      });
      return text(`Found ${visits.length} visits (newest first, times UTC):\n\n${lines.join("\n")}`);
    }
  );
```

- [x] **Step 9: Run all tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS; `tsc` exits 0.

- [x] **Step 10: Commit**

```bash
git add src/config.ts src/types.ts src/services/study-data.ts src/index.ts tests/helpers/schemas.ts tests/reading-history.test.ts tests/server-study-tools.test.ts tests/server-smoke.test.ts
git commit -m "feat: add get_reading_history from logos's history.db"
```

> **As built (`07dac3d`):** matches plan.

---

### Task 5: `get_passage_lists`

**Files:**
- Modify: `src/config.ts` (`OPTIONAL_DB_NAMES` gains `passageLists`)
- Modify: `src/types.ts` (`PassageListEntry`, `PassageList`)
- Modify: `src/services/study-data.ts` (append)
- Modify: `tests/helpers/schemas.ts` (`PASSAGE_LIST_SCHEMA`)
- Create: `tests/passage-lists.test.ts`
- Modify: `tests/server-study-tools.test.ts`, `tests/server-smoke.test.ts`
- Modify: `src/index.ts` (new block 27)

**Interfaces:**
- Consumes: `DB_PATHS.passageLists` (already exists), `decodeLogosBlob` (PR 1), `logosRawToHuman`, `openIfPresent`; `json`, `formatParam`.
- Produces:
  - `interface PassageListEntry { rawReference: string; reference: string }`; `interface PassageList { title: string | null; modifiedDate: string | null; passages: PassageListEntry[] }`
  - `parsePassageItems(blob: Buffer | null): PassageListEntry[]`
  - `getPassageLists(): PassageList[] | null`
  - Tool `get_passage_lists` (`format`).

- [x] **Step 1: Add the fixture schema**

Append to `tests/helpers/schemas.ts`:

```typescript
export const PASSAGE_LIST_SCHEMA = `
  CREATE TABLE PassageLists (
    Id integer primary key autoincrement,
    DocumentGuid guid not null,
    Title text,
    CompressedItems blob not null,
    ResourceList text not null default '',
    SyncState int not null default 0,
    ModifiedDate text,
    IsDeleted bool not null default 0,
    SyncRevision integer
  );
`;

// PassageLists.CompressedItems observed on the Logos 54 test install: the
// 5-byte 0x02 header, then [{"ref":…}] JSON (design doc F17).
export const OBSERVED_PASSAGE_ITEMS_HEX =
  "02530000005B7B22726566223A226269626C652E31382E31302E32312D31382E31302E3232227D2C7B22726566223A226269626C652E32312E392E3130227D2C7B22726566223A226269626C652E32332E352E3134227D5D";
```

- [x] **Step 2: Write the failing unit tests**

`tests/passage-lists.test.ts`:

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
import { PASSAGE_LIST_SCHEMA, OBSERVED_PASSAGE_ITEMS_HEX } from "./helpers/schemas.js";
import { parsePassageItems } from "../src/services/study-data.js";

type StudyData = typeof import("../src/services/study-data.js");

describe("parsePassageItems", () => {
  it("decodes the observed blob into readable passages", () => {
    expect(parsePassageItems(Buffer.from(OBSERVED_PASSAGE_ITEMS_HEX, "hex"))).toEqual([
      { rawReference: "bible.18.10.21-18.10.22", reference: "Job 10:21-22" },
      { rawReference: "bible.21.9.10", reference: "Ecclesiastes 9:10" },
      { rawReference: "bible.23.5.14", reference: "Isaiah 5:14" },
    ]);
  });

  it("keeps unmapped references raw and skips entries without a ref", () => {
    const json = '[{"ref":"bible.44.1.1"},{"other":1}]';
    const blob = Buffer.concat([Buffer.from([0x02, json.length, 0, 0, 0]), Buffer.from(json)]);
    expect(parsePassageItems(blob)).toEqual([{ rawReference: "bible.44.1.1", reference: "bible.44.1.1" }]);
  });

  it("returns an empty list for undecodable blobs", () => {
    expect(parsePassageItems(null)).toEqual([]);
    expect(parsePassageItems(Buffer.from([0x02, 0xff]))).toEqual([]);
    expect(parsePassageItems(Buffer.from("not json"))).toEqual([]);
  });
});

describe("getPassageLists with PassageList.db", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(
      join(dirs.dataDir, "Documents", "PassageList", "PassageList.db"),
      `${PASSAGE_LIST_SCHEMA}
       INSERT INTO PassageLists (DocumentGuid, Title, CompressedItems, ModifiedDate, IsDeleted) VALUES
         (X'00', 'Factbook | Sheol — Key Passages', X'${OBSERVED_PASSAGE_ITEMS_HEX}', '2024-07-20T00:11:38-04:00', 0),
         (X'01', 'Broken list', X'02FF', '2023-01-01T00:00:00Z', 0),
         (X'02', 'Deleted list', X'${OBSERVED_PASSAGE_ITEMS_HEX}', '2025-01-01T00:00:00Z', 1);`
    );
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("lists non-deleted lists newest first with their passages", () => {
    const lists = studyData.getPassageLists();
    expect(lists?.map((l) => l.title)).toEqual(["Factbook | Sheol — Key Passages", "Broken list"]);
    expect(lists?.[0].passages.map((p) => p.reference)).toEqual(["Job 10:21-22", "Ecclesiastes 9:10", "Isaiah 5:14"]);
    expect(lists?.[0].modifiedDate).toBe("2024-07-20T00:11:38-04:00");
    expect(lists?.[1].passages).toEqual([]);
  });
});

describe("getPassageLists without PassageList.db", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("returns null", () => {
    expect(studyData.getPassageLists()).toBeNull();
  });
});
```

- [x] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/passage-lists.test.ts`
Expected: FAIL — `parsePassageItems` is not exported.

- [x] **Step 4: Implement**

`src/config.ts` — add `"passageLists"` to `OPTIONAL_DB_NAMES` (the path already exists; older installs may not have the file).

`src/types.ts` — append to "Study Data Types":

```typescript
export interface PassageListEntry {
  /** Raw Logos reference, e.g. "bible.18.10.21-18.10.22". */
  rawReference: string;
  /** Readable form ("Job 10:21-22"), or the raw string when unmapped. */
  reference: string;
}

export interface PassageList {
  title: string | null;
  modifiedDate: string | null;
  passages: PassageListEntry[];
}
```

`src/services/study-data.ts` — add `import { decodeLogosBlob } from "../utils/clippings.js";`, add `PassageList, PassageListEntry` to the types import, and append:

```typescript
// ─── Passage lists ───────────────────────────────────────────────────────────

// CompressedItems -> passages. The blob is a Logos blob (5-byte header, F17)
// holding [{"ref":"bible.18.10.21-18.10.22"}, …]. Empty on any decode or
// parse failure; never throws.
export function parsePassageItems(blob: Buffer | null): PassageListEntry[] {
  const decoded = decodeLogosBlob(blob);
  if (!decoded) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const entries: PassageListEntry[] = [];
  for (const item of parsed) {
    const ref = typeof item === "object" && item !== null ? (item as Record<string, unknown>).ref : undefined;
    if (typeof ref !== "string") continue;
    entries.push({ rawReference: ref, reference: logosRawToHuman(ref) ?? ref });
  }
  return entries;
}

// The user's saved passage lists, newest first. Null when PassageList.db is
// absent.
export function getPassageLists(): PassageList[] | null {
  const db = openIfPresent(DB_PATHS.passageLists, "PassageLists");
  if (!db) return null;
  try {
    const rows = db.prepare(`
      SELECT Title, ModifiedDate, CompressedItems FROM PassageLists
      WHERE IsDeleted = 0
      ORDER BY julianday(ModifiedDate) DESC
    `).all() as Array<{ Title: string | null; ModifiedDate: string | null; CompressedItems: Buffer | null }>;
    return rows.map((r) => ({
      title: r.Title,
      modifiedDate: r.ModifiedDate,
      passages: parsePassageItems(r.CompressedItems),
    }));
  } finally {
    db.close();
  }
}
```

- [x] **Step 5: Run the unit tests**

Run: `npx vitest run tests/passage-lists.test.ts`
Expected: PASS.

- [x] **Step 6: Extend the server tests (failing)**

In `tests/server-study-tools.test.ts`: add `PASSAGE_LIST_SCHEMA, OBSERVED_PASSAGE_ITEMS_HEX` to the schemas import; in the "every store present" `beforeAll`, before `startServer`, add:

```typescript
    createDb(
      join(dirs.dataDir, "Documents", "PassageList", "PassageList.db"),
      `${PASSAGE_LIST_SCHEMA}
       INSERT INTO PassageLists (DocumentGuid, Title, CompressedItems, ModifiedDate) VALUES
         (X'00', 'Sheol — Key Passages', X'${OBSERVED_PASSAGE_ITEMS_HEX}', '2024-07-20T00:11:38-04:00');`
    );
```

Add to that `describe`:

```typescript
  it("lists passage lists with readable passages", async () => {
    const { text } = await callTool(client, "get_passage_lists");
    expect(text).toContain("**Sheol — Key Passages** (modified 2024-07-20)\n- Job 10:21-22\n- Ecclesiastes 9:10\n- Isaiah 5:14");
  });
```

Add to the "no stores" `describe`:

```typescript
  it("says passage lists are not available, without an error", async () => {
    const result = await callTool(client, "get_passage_lists");
    expect(result.isError).toBe(false);
    expect(result.text).toContain("not available on this Logos version");
  });
```

In `tests/server-smoke.test.ts`, change the tool count to `27`.

- [x] **Step 7: Run them to verify they fail**

Run: `npx vitest run tests/server-study-tools.test.ts tests/server-smoke.test.ts`
Expected: FAIL — unknown tool `get_passage_lists`.

- [x] **Step 8: Register the tool**

Extend the study-data import with `getPassageLists`, and insert after block 26:

```typescript
  // ── 27. get_passage_lists ─────────────────────────────────────────────────
  server.tool(
    "get_passage_lists",
    "List the user's saved passage lists from Logos — named lists of Bible references (e.g. key passages on a topic). Returns each list's title, date and passages. Use to reuse passages the user has already collected.",
    { format: formatParam },
    async ({ format }) => {
      const lists = getPassageLists();
      if (lists === null) {
        return text("Passage lists are not available on this Logos version (PassageList.db not found).");
      }
      if (format === "json") return json(lists);
      if (lists.length === 0) return text("No passage lists found.");
      const blocks = lists.map((l) => {
        const date = l.modifiedDate ? ` (modified ${l.modifiedDate.slice(0, 10)})` : "";
        const passages = l.passages.length > 0
          ? l.passages.map((p) => `- ${p.reference}`).join("\n")
          : "- (no passages)";
        return `**${l.title ?? "(untitled list)"}**${date}\n${passages}`;
      });
      return text(`Found ${lists.length} passage lists:\n\n${blocks.join("\n\n")}`);
    }
  );
```

- [x] **Step 9: Run all tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS; `tsc` exits 0.

- [x] **Step 10: Commit**

```bash
git add src/config.ts src/types.ts src/services/study-data.ts src/index.ts tests/helpers/schemas.ts tests/passage-lists.test.ts tests/server-study-tools.test.ts tests/server-smoke.test.ts
git commit -m "feat: add get_passage_lists"
```

> **As built (`e8caea1`):** matches plan.

---

### Task 6: `format: "json"` on the existing read tools

**Files:**
- Modify: `src/index.ts` (blocks 6, 7, 8, 9, 13, 14, 22)
- Create: `tests/server-json.test.ts`

**Interfaces:**
- Consumes: `json`, `formatParam`, `resolveLimit` (Task 1); `typeLabel` (catalog-reader).
- Produces: `format` parameter on `get_user_notes`, `get_user_highlights`, `get_clippings`, `get_favorites`, `get_study_workflows`, `get_library_catalog`, `get_resource_types`. JSON mode returns the service objects (`get_library_catalog` adds `typeLabel`; `get_study_workflows` returns `{ templates, instances }`), even when empty.

- [x] **Step 1: Write the failing server test**

`tests/server-json.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { makeFixtureDirs, createDb, cleanupFixtureDirs, type FixtureDirs } from "./helpers/fixtures.js";
import { NOTES_SCHEMA_LOGOS54, CATALOG_SCHEMA } from "./helpers/schemas.js";
import { startServer, callTool } from "./helpers/server.js";

// Every SQLite/catalog read tool (design doc 2.5).
const READ_TOOLS = [
  "get_user_notes",
  "get_user_highlights",
  "get_clippings",
  "get_favorites",
  "get_reading_progress",
  "get_study_workflows",
  "get_library_catalog",
  "get_resource_types",
  "get_resource_reading_progress",
  "get_reading_history",
  "get_passage_lists",
];

describe("JSON output", () => {
  let dirs: FixtureDirs;
  let client: Client;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(
      join(dirs.dataDir, "NotesToolManager", "notestool.db"),
      `${NOTES_SCHEMA_LOGOS54}
       INSERT INTO NoteStyles (NoteStyleId, Name) VALUES (1, 'none'), (2, 'custom:YellowHighlighter');
       INSERT INTO ResourceIds (ResourceIdId, ResourceId) VALUES (1, 'LLS:NIVAC66RO');
       INSERT INTO Notes (NoteId, ExternalId, CreatedDate, ModifiedDate, Kind, ContentRichText, NoteStyleId, AnchorsJson, AnchorResourceIdId, TagsJson, NotebookExternalId) VALUES
         (1, 'n1', '2021-01-14T12:04:37Z', '2021-01-14T12:04:37Z', 0, '<Paragraph><Run Text="Aeneas healed"/></Paragraph>', 1, '[]', NULL, '[]', ''),
         (2, 'h1', '2023-05-24T01:15:39Z', '2023-05-24T01:15:39Z', 1, NULL, 2, '[]', 1, NULL, '');
       INSERT INTO NoteAnchorFacetReferences (NoteId, AnchorIndex, DataTypeId, BibleBook, SortKey, Reference) VALUES
         (1, 0, 1, 65, x'00', 'bible.65.9.35'), (2, 0, 1, 66, x'00', 'bible.66.1.8-66.1.15');`
    );
    createDb(
      join(dirs.catalogDir, "LibraryCatalog", "catalog.db"),
      `${CATALOG_SCHEMA}
       INSERT INTO Records (ResourceId, Type, Title, UseCount) VALUES
         ('LLS:29.48.20', 'text.monograph.commentary.bible', 'The Gospel according to John', 4),
         ('LLS:LEB', 'text.monograph.bible', 'The Lexham English Bible', 19);`
    );
    client = await startServer(dirs);
  }, 30_000);
  afterAll(async () => {
    await client.close();
    cleanupFixtureDirs(dirs);
  });

  it("offers format text|json on every read tool", async () => {
    const { tools } = await client.listTools();
    for (const name of READ_TOOLS) {
      const tool = tools.find((t) => t.name === name);
      const format = (tool?.inputSchema.properties as Record<string, { enum?: string[] }> | undefined)?.format;
      expect(format?.enum, name).toEqual(["text", "json"]);
    }
  });

  it("returns notes with readable and raw references", async () => {
    const { text } = await callTool(client, "get_user_notes", { format: "json" });
    const [note] = JSON.parse(text);
    expect(note).toMatchObject({ anchorReference: "Acts 9:35", anchorRawReferences: ["bible.65.9.35"], content: "Aeneas healed" });
  });

  it("returns highlights with references and dates", async () => {
    const { text } = await callTool(client, "get_user_highlights", { format: "json" });
    expect(JSON.parse(text)[0]).toMatchObject({
      reference: "Romans 1:8-15",
      rawReferences: ["bible.66.1.8-66.1.15"],
      syncDate: "2023-05-24T01:15:39Z",
    });
  });

  it("returns catalog resources with their type label", async () => {
    const { text } = await callTool(client, "get_library_catalog", { format: "json" });
    expect(JSON.parse(text)).toEqual([
      expect.objectContaining({ resourceId: "LLS:LEB", type: "text.monograph.bible", typeLabel: "Bible" }),
      expect.objectContaining({ resourceId: "LLS:29.48.20", typeLabel: "Commentary" }),
    ]);
  });

  it("returns an empty JSON array instead of an empty-result message", async () => {
    const { text } = await callTool(client, "get_user_notes", { format: "json", query: "nothing matches this" });
    expect(JSON.parse(text)).toEqual([]);
  });

  it("returns resource types as JSON", async () => {
    const { text } = await callTool(client, "get_resource_types", { format: "json" });
    const summary = JSON.parse(text);
    // Both types have one resource, so their order is not defined.
    expect(summary).toHaveLength(2);
    expect(summary).toEqual(expect.arrayContaining([
      { label: "Bible", rawType: "text.monograph.bible", count: 1 },
      { label: "Commentary", rawType: "text.monograph.commentary.bible", count: 1 },
    ]));
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/server-json.test.ts`
Expected: FAIL — `format` missing on the seven existing tools; JSON calls return text.

- [x] **Step 3: Add `format` to the seven handlers**

In `src/index.ts`, make these changes (each adds `format: formatParam` to the schema, routes `limit` through `resolveLimit`, and returns `json(...)` before any empty-result message):

Block 6 `get_user_notes` — schema gains `format: formatParam` and the `limit` description becomes `"Max notes to return (default: 20; up to 1000 with format 'json')"`; handler start becomes:

```typescript
    async ({ notebook_title, query, passage, limit, format }) => {
      const notes = getUserNotes({ notebookTitle: notebook_title, query, passage, limit: resolveLimit(limit, 20, format) });
      if (format === "json") return json(notes);
```

(the rest of the handler is unchanged).

Block 7 `get_user_highlights` — schema gains `format: formatParam`; `limit` description `"Max highlights to return (default: 50; up to 1000 with format 'json')"`; handler start:

```typescript
    async ({ resource_id, style_name, limit, format }) => {
      const highlights = getUserHighlights({
        resourceId: resource_id,
        styleName: style_name,
        limit: resolveLimit(limit, 50, format),
      });
      if (format === "json") return json(highlights);
```

Block 8 `get_clippings` — schema gains `format: formatParam`; `limit` description `"Max clippings to return (default: 20; up to 1000 with format 'json')"`; handler start:

```typescript
    async ({ resource_id, tag, limit, format }) => {
      const clippings = getClippings({
        resourceId: resource_id,
        tag,
        limit: resolveLimit(limit, 20, format),
      });
      if (format === "json") return json(clippings);
```

Block 9 `get_favorites` — schema gains `format: formatParam`; `limit` description `"Max favorites to return (default: 30; up to 1000 with format 'json')"`; handler start:

```typescript
    async ({ limit, format }) => {
      const favorites = getFavorites(resolveLimit(limit, 30, format));
      if (format === "json") return json(favorites);
```

Block 13 `get_study_workflows` — schema gains `format: formatParam`; `instance_limit` description `"Max active instances to return (default: 10; up to 1000 with format 'json')"`; handler start:

```typescript
    async ({ include_instances, instance_limit, format }) => {
      const templates = getWorkflowTemplates();
      if (format === "json") {
        const instances = include_instances !== false ? getWorkflowInstances(resolveLimit(instance_limit, 10, format)) : [];
        return json({ templates, instances });
      }
```

Block 14 `get_library_catalog` — schema gains `format: formatParam`; `limit` description `"Max results to return (default: 25; up to 1000 with format 'json')"`; inside the `try`, replace the `searchCatalog` line with:

```typescript
        const resources = searchCatalog({ type, query, author, limit: resolveLimit(limit, 25, format) });
        if (format === "json") return json(resources.map((r) => ({ ...r, typeLabel: typeLabel(r.type) })));
```

and the handler signature becomes `async ({ type, query, author, limit, format }) => {`.

Block 22 `get_resource_types` — schema `{ format: formatParam }`; inside the `try`:

```typescript
        const summary = getResourceTypeSummary();
        if (format === "json") return json(summary);
```

with signature `async ({ format }) => {`.

- [x] **Step 4: Run all tests and the build**

Run: `npx vitest run && npm run build`
Expected: all PASS; `tsc` exits 0.

- [x] **Step 5: Commit**

```bash
git add src/index.ts tests/server-json.test.ts
git commit -m "feat: add format json to every read tool — limit capped at 1000 in json mode"
```

> **As built (`457452d`):** matches plan.

---

### Task 7: Documentation, verification and the pull request

**Files:**
- Modify: `../README.md`
- Modify: `../.claude/agents/tool-tester.md`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: the PR.

- [ ] **Step 1: README**

1. Intro bullet: `**24 MCP tools**` → `**27 MCP tools**`, and replace "check reading plans" with "check reading plans and per-book progress, browse your reading history and passage lists".
2. Setup step 6: `with 24 tools` → `with 27 tools`.
3. Project Structure: `# QA agent for testing all 24 tools` → `all 27 tools`; `# MCP server entry point (24 tools)` → `(27 tools)`; add under `services/` after `sqlite-reader.ts`:

```
│   │   │   ├── study-data.ts          # Reading plans, progress, history, passage lists
```

4. "Personal Study Data" table — replace the intro line with "Tools for accessing your notes, highlights, favorites, reading plans and history", replace the `get_reading_progress` row, and add three rows:

```markdown
| `get_reading_progress` | Shows your reading plans: sessions read, next reading, days behind schedule |
| `get_resource_reading_progress` | Shows how far you've read in each book (percent, last read) |
| `get_reading_history` | Lists what you've opened in Logos recently, newest first |
| `get_passage_lists` | Lists your saved passage lists and their passages |
```

5. Insert after the "System & Diagnostics" table:

```markdown
### Structured output

Every tool that reads your Logos data (notes, highlights, clippings, favorites, reading plans and progress, history, passage lists, workflows, library catalog, resource types) accepts `format: "json"`. JSON mode returns the underlying records — readable *and* raw Logos references, ISO dates, resource IDs and titles — for building reading plans or feeding other tools, and allows a `limit` of up to 1,000.
```

6. "How It Works" SQLite bullet: replace "(notes, highlights, favorites, workflows, reading plans)" with "(notes, highlights, favorites, workflows, reading plans and progress, history, passage lists)".

- [ ] **Step 2: tool-tester.md**

1. Front-matter description and Purpose: `all 24 Logos MCP tools` → `all 27 Logos MCP tools`.
2. Database → Tool Dependencies — replace the `readingLists` row and add rows:

```markdown
| readingPlans | `get_reading_progress` (current Logos) |
| readingLists | `get_reading_progress` (older Logos; empty on current installs is normal) |
| readingProgress | `get_resource_reading_progress` |
| history | `get_reading_history` |
| passageLists | `get_passage_lists` |
```

3. Phase 2 — replace row 13 and append rows 25–27:

```markdown
| 13 | "How's my reading plan going?" | `get_reading_progress` | Returns reading plans with sessions read and next reading (or reading lists on older Logos) |
```

```markdown
| 25 | "How far have I read in my books?" | `get_resource_reading_progress` | Returns books with percent read, or "not available" (not an error) |
| 26 | "What have I been reading in Logos lately?" | `get_reading_history` | Returns recent visits, or "not available" (not an error) |
| 27 | "Show my passage lists" | `get_passage_lists` | Returns lists with passages, or "not available" (not an error) |
```

4. Follow-up checks table — append:

```markdown
| 13a | "Give me my reading plans as JSON" | `get_reading_progress` (format json) | Valid JSON with `readingPlans` and `readingLists` keys |
```

5. Testing Rules "Empty results are OK" bullet: add "reading progress, history, passage lists" to its list and add "A 'not available on this Logos version' reply is a pass."
6. Phase 3: `After all 24 tests` → `After all 27 tests`; example `PASS: 21/24 tools` → `PASS: 24/27 tools`; add example lines `✓ get_resource_reading_progress — OK (N books)`, `✓ get_reading_history — OK (N visits)`, `✓ get_passage_lists — OK (N lists)`.

Check: `grep -n "24" ../README.md ../.claude/agents/tool-tester.md` shows no stale tool counts.

- [ ] **Step 3: Commit the docs**

```bash
git add ../README.md ../.claude/agents/tool-tester.md
git commit -m "docs: document study-data tools, json output and the 27-tool count"
```

- [ ] **Step 4: Full automated check**

Run: `npm test && npm run build`
Expected: all PASS; `tsc` exits 0.

- [ ] **Step 5: Manual verification on Windows Logos 54 (MANUAL — Will)**

Restart the MCP client so it loads `dist/`, then record for the PR:

1. `get_reading_progress` — next readings match Logos's Today page (test install: CSB → Revelation 22 (2025-12-31); 40 Questions → pp 9-13 (2025-01-02)).
2. `get_resource_reading_progress` — the top few books' percentages match each resource's progress indicator in Logos.
3. `get_reading_history limit=5` — matches the top of Logos's History panel.
4. `get_passage_lists` — "Sheol" list shows Job 10:21-22, Ecclesiastes 9:10, Isaiah 5:14.
5. `get_reading_progress format=json` parses as JSON.

- [ ] **Step 6: Push and open the PR (ask Will before pushing)**

```bash
git push -u origin feature/study-data
```

If PR 1 has merged:

```bash
gh pr create --repo robrawks/LogosBibleSoftwareMCP --base main --title "feat: reading plans, reading progress, history, passage lists and json output" --body-file pr-body.md
```

Otherwise (stacked on PR 1):

```bash
gh pr create --repo robrawks/LogosBibleSoftwareMCP --base fix/logos54-compat --title "feat: reading plans, reading progress, history, passage lists and json output" --body-file pr-body.md
```

`pr-body.md` (not committed):

```markdown
PR 2 of 3 from docs/design/2026-10-15-logos54-fixes-and-study-data-design.md. Depends on PR 1.

## What changes
- get_reading_progress reads ReadingPlan.db: sessions read, next reading, days behind (ReadSessions = last completed index, F16); older ReadingLists.db output kept as fallback.
- New tools: get_resource_reading_progress, get_reading_history, get_passage_lists (24 → 27 tools). Each says "not available on this Logos version" when its store is missing.
- format: "json" on every SQLite/catalog read tool; limit up to 1,000 in JSON mode.
- Tests: stdio harness runs the real server against fixture databases.

## Verified on Windows, Logos 54.0.0.252
[results of Task 7 Step 5]

## Needs confirmation on macOS
- Database paths: Documents/<id>/Documents/ReadingPlan/ReadingPlan.db, Data/<id>/ReadingProgressManager/readingprogressmanager.db, Data/<id>/HistoryManager/history.db.
```

Then `rm pr-body.md`.

## Divergence index

<!-- generated by plan_map.py --write-index; do not edit -->

_No divergences recorded._

## Resume State

- **Last completed task:** none (plan written 2026-10-15).
- **Commit SHA:** plan committed on `docs/logos54-spec`.
- **Ticked checkboxes:** none.
- **Next task:** Task 1, Step 0 (create `feature/study-data` once PR 1's branch exists).
- **Caveats:** needs PR 1's code. Task 7 Step 5 needs Will on Windows with Logos 54.
