# Logos 54 Fixes, Study Data, and Commentary Finder — Design Document

## Summary

The MCP server was built and tested on macOS against Logos 48. On a current install (Logos 54.0, Windows 11, Free Edition) every database query still runs, but several tools give wrong or empty answers, and most tools that open things in Logos silently do nothing:

- **Wrong book names.** Logos numbers Bible books its own way (Genesis = 1 … Malachi = 39, the deuterocanon in 40–60, Matthew = 61 … Revelation = 87). The server assumes Protestant 1–66 order, so a note on Romans (`bible.66`) would be labeled "Revelation".
- **Notes and highlights lose their verses.** Current Logos stores the verse a note or highlight is attached to in a separate table the server never reads, so passage filters find nothing and highlights show only a color and a book title.
- **Links Logos ignores.** Passage, guide, Factbook, word-study and search links use a format Logos 54 ignores. Formats that do work were found and verified.
- **Study data left on the table.** Reading plans, per-book reading progress, browsing history and passage lists are all stored locally, but the server reads none of them (it reads an older, empty reading-list file).

This design fixes those problems and adds study-data tools, in three small pull requests: **(1) fixes**, **(2) study data**, **(3) a commentary finder** that lists which of the user's books cover a passage and opens them there. Nothing reads or copies book text. Every change detects what the user's Logos data contains and falls back to today's behavior on older installs.

## Glossary

| Term | Meaning |
|---|---|
| **Logos book number** | Logos's internal Bible book index used in references like `bible.64.5.1` (= John 5:1). OT 1–39, deuterocanon 40–60, NT 61–87. |
| **Raw reference** | A Logos reference string such as `bible.66.1.8-66.1.15` (Romans 1:8–15). |
| **Profile directory** | The randomly named per-install folder, e.g. `xmt0sr2y.xit`, under both `Documents/` (user data) and `Data/` (library/app data). |
| **Facet table** | `NoteAnchorFacetReferences` in `notestool.db`: one row per note/highlight anchor, holding its Bible reference. |
| **Knowledge-base ID** | Logos's ID for a Factbook entry: `bk.#Moses` (person), `bk.%Sabbath` (topic), `bk.@Abana` (place), `bk.to:DBT-5333` (preaching theme). |
| **Lookup table** | `Data/<id>/AutoComplete/AutoComplete.db`: maps display names to knowledge-base IDs (55,381 terms on the test install). |
| **Resource link** | `logosres:<ResourceId>;ref=<reference>` — opens a book at a location. The one link family that worked unchanged. |
| **Semicolon link** | `logos4:<Command>;<key>=<value>;…` — the `logos4:` form Logos 54 accepts. The server currently builds query-string links (`logos4:///Guide?t=…&ref=…`), which Logos 54 ignores. |
| **ReferenceSupersets** | Catalog column listing the Bible range a resource covers, e.g. `bible.64.1.1-64.21.25` (all of John). |
| **Detection** | Choosing a code path by checking which files, tables and columns exist, rather than by Logos version number. |

## Background: Verified Findings

All findings come from a live Logos 54.0.0.252 install on Windows 11 (profile `xmt0sr2y.xit`), with the server built from `6d4a414` and driven over stdio against copies of the databases and, later, the live files with Logos running. Evidence was taken from Logos itself (its `history.db` rows and on-screen tabs), not from the server's own success messages.

| # | Finding | Evidence |
|---|---|---|
| F1 | Logos book numbers are not 1–66. | `logosres:LLS:LEB;ref=bible.N.1.1` opened Genesis (1), Psalm (19), Malachi (39), Matthew (61), Revelation (87); 40–60 opened nothing in LEB (no apocrypha). `bible.66.8.28` → Romans 8:28; `bible.64.1.45` → John 1:45; `bible.65.3.21` → Acts 3:21; `bible.44.3.21` → nothing. A CSB "New Testament" reading plan stores its range as `bible+csb2.61-87`. |
| F2 | Note/highlight anchors on Logos 54 have no `reference.raw`; the verse is in the facet table. | All 12 anchored rows in `notestool.db` use `{"textRange":{resourceId, offset, length}}`; `NoteAnchorFacetReferences.Reference` holds `bible.66.1.8-66.1.15` etc. `get_user_notes passage="Acts 9"` returns nothing for a note the facet table places at Acts 9:35. |
| F3 | The existing test fixture `bible.44.3.21` → "Acts 3:21" (in `tests/anchor-parsing.test.ts`) does not match Logos. | See F1: Logos opens nothing for `bible.44.3.21` and Acts 3:21 for `bible.65.3.21`. |
| F4 | `navigate_passage`, `open_word_study`, `open_factbook`, `open_guide`, `search_all` open nothing on Logos 54/Windows. | No new tabs (UI Automation tab list) and no history rows after each call; screenshot showed no new panels. `open_resource` worked. |
| F5 | Guides open with semicolon links and the guide's **display title**. | `logos4:Guide;t=Passage%20Guide;ref=bible.Jn5.1`, `…t=Exegetical%20Guide;ref=bible.Jn5.14`, `…t=Topic%20Guide;ref=bk.%25Sabbath` opened correctly. Internal template names (`PassageGuide`, `ExegeticalGuide`) opened blank tabs. Query-string form did nothing. |
| F6 | Factbook needs a knowledge-base ID. | `logos4:Factbook;ref=bk.%23Moses` and `…ref=bk.%25Sabbath` opened the right entries; `ref=Moses` and the query-string form did not. IDs found in the lookup table and in saved layouts (`ReportId=ref:bk.#Nicodemus.1`). |
| F7 | Word study links are unsolved. | `logos4:Guide;t=Bible%20Word%20Study;ref=…` with `g:agape`, `q=g:agape`, `lemma.lbs/grc/ἀγάπη`, and `en:healing` all opened an empty word box. |
| F8 | Sermon Starter Guide opens but its subject was not confirmed. | `…t=Sermon%20Starter%20Guide;ref=bk.to%3ADBT-5333` opened a tab titled only "Sermon Starter Guide". |
| F9 | `get_reading_progress` reads the wrong store. | `ReadingLists.db` is empty (0/0); two plans live in `Documents/ReadingPlan/ReadingPlan.db`. |
| F10 | Unread local study data. | `readingprogressmanager.db` (69 resources with percent read), `history.db` (45 visits with passages), `PassageList.db` (1 list; path already in `DB_PATHS`, no tool). |
| F11 | The catalog records each resource's Bible coverage and commentary type. | `Records.ReferenceSupersets` (`bible.64.1.1-64.21.25` for Carson's John) and `Traits` (`commentary-purpose:exegetical`, `era:contemporary`, `author-denomination-group:…`). For John 5:1 this yields 15 commentaries + 22 other resources, a superset of the Passage Guide's commentary list. |
| F12 | Opening a resource adds a `history.db` row; guides and Factbook do not. | Used as the confirmation signal in PR 3. `Guides\|…` history rows were seen once on the test install; PR 1's verification records which is right. |
| F13 | Reads are safe while Logos runs. | Three rounds of every read tool against the live files with Logos open: no lock errors. The diagnose run did not touch live `-shm`/`-wal` files. |
| F14 | Profile auto-detection works for non-`.w14` names. | `xmt0sr2y.xit` was found by the relaxed fallback in `config.ts`. |
| F15 | On Windows, `get_logos_state` can report only running/not running; `capture_panel_screenshot` cannot work. | The window helper is compiled Objective-C (`clang`); `ensureHelper()` fails and is swallowed. |
| F16 | `ReadingPlanStatus.ReadSessions` is the index of the last completed session (inclusive), not a count. | CSB plan: `259` of 261 sessions (index 259 has no readings); Logos's Today page shows its next reading as Rev 22 = session 260. 40 Questions plan: `0`; Today page shows pp 9–13 = session 1. A count would predict session 0 (pp 3–8) for the second plan. `ReadSessionsMetadata` was `{"259":{"completedDate":…}}` in one read and `null` in a later one, so it is not reliable. |
| F17 | Logos `0x02` blobs have a 5-byte header: `0x02` + little-endian uint32 length + payload. | `PassageLists.CompressedItems`: `02 53 00 00 00` then 83 bytes of JSON; parsing from offset 4 fails. `decodeClippingBlob()` skips only 4 bytes for `0x02` (its test fixture is a hand-built 4-byte header); its `0x01` gzip branch already skips 5. No clipping rows exist on the test install to confirm the clipping side. |
| F18 | The Passage Guide's resource prioritization is not stored in any local SQLite database. | Searched every profile database for "priorit": only a sync marker (`UserEventManager.Events` row `ResourcePriorities` with a revision blob) and unrelated `Priority` columns. Logos's code references `ResourcePrioritiesSyncBaseUri`, so the list is likely fetched from Faithlife's servers. |
| F19 | Saved Search panels store `SearchKindName` (`AllSearch`, `BooksSearch`), `QueryText` and `SyntaxVersion=V2`. | `layouts.db` panel settings. A working `search_all` link was not found (see Open Questions). |
| F20 | When Logos is busy, a link can leave a second `Logos.exe` running and nothing opens. | After Logos recovered from a hang, `logosres:LLS:LEB;ref=bible.64.5.1` started a second `Logos.exe` that stayed running; no history row appeared, and known-good guide links also did nothing. |

## Goals

1. Every tool gives correct results, or an honest "not supported here", on current Logos (verified on Windows 54), without regressing older installs.
2. Expose locally stored study data (reading plans, reading progress, history, passage lists) in forms useful for building reading plans and for other tools, including JSON.
3. Let the assistant find which of the user's books cover a passage and open them there.

## Non-Goals

- Reading, copying or screenshotting book text on Windows (a separate design, after a pilot).
- Changes to the Biblia API tools.
- Changes to macOS screenshot capture.
- Any write to Logos data. Every database stays read-only.
- Exposing the prayer list (personal and sensitive), layouts or preferences.

## Delivery: Three Pull Requests

| PR | Branch | Contents | Depends on |
|---|---|---|---|
| 1 | `fix/logos54-compat` | Book numbers, facet-table verses, link formats, knowledge-base lookup, honest word study/search, Windows status honesty, blob decoder fix, compatibility switch, docs | — |
| 2 | `feature/study-data` | Reading plans (fixing `get_reading_progress`), `get_resource_reading_progress`, `get_reading_history`, `get_passage_lists`, `format: "json"` | PR 1 |
| 3 | `feature/passage-resources` | `find_passage_resources`, history confirmation in `open_resource` | PR 1, PR 2 (`format`/`json()` helper, history reader) |

Each PR is independently reviewable, passes `npm test` and `npm run build`, updates the tool count everywhere it appears, and states in its description what was verified on Windows Logos 54 and what needs macOS confirmation.

## Compatibility (applies to all PRs)

### Database changes: detection with fallback

Each reader checks for the files, tables and columns it needs (via `sqlite_master` / `pragma table_info`) and picks a path. It never branches on Logos version number.

| Change | Detection | Fallback |
|---|---|---|
| Verses for notes/highlights | `NoteAnchorFacetReferences` exists | Existing `AnchorsJson` parsing |
| Reading plans | `ReadingPlan.db` exists with `ReadingPlanDocuments` | Existing `ReadingLists.db` path; `diagnose` reports both stores as optional |
| Highlights store | Existing `visualmarkup.db` → `notestool.db` logic | Unchanged; `diagnose` reports `visualmarkup.db` as optional (absent on Logos 54) |
| Reading progress, history, passage lists | File and table exist | Tool returns "not available on this Logos version" (not an error); `diagnose` reports the store as optional, not failed |
| Knowledge-base lookup | `AutoComplete.db` exists | Clear error: open Logos once so it builds the lookup table; `diagnose` reports the store as optional, not failed |

### Book numbers: no switch

The 1–66 table was wrong for any version, because the numbers come from Logos's stored reference format, not the platform. The PR asks the maintainer to confirm one NT note's label on macOS.

### Links: an explicit switch

Whether Logos accepted a link cannot be detected for guides and Factbook (F12), and the old `logos4:///Bible/…` form reportedly worked on macOS Logos 48 (`docs/research/screenshot-approach.md`). Therefore:

- New setting `LOGOS_LINK_STYLE`, read in `config.ts`: `current` (default, the formats in F5/F6 and resource links) or `legacy` (today's URLs, unchanged).
- The README explains when to use `legacy`. If the maintainer confirms the new formats on macOS, the README can describe `legacy` as a fallback only.

### Regression fixtures

Tests build two small SQLite databases per store in a temp directory at test time (better-sqlite3; `*.db` is git-ignored): one shaped like the schema the current code expects, one like Logos 54 (column names copied from the real install, synthetic rows, no user data). Every reader runs against both.

## PR 1: Fixes

### 1.1 Logos book numbers — new `src/services/logos-books.ts`

- One table mapping Logos book numbers to names: 1–39 (Genesis–Malachi), 61–87 (Matthew–Revelation). Numbers 40–60 are deliberately unmapped.
- `logosRawToHuman(raw)`: parses `bible[+edition].B.C.V[-B.C.V]` (same shapes as today's `BIBLE_RAW_RE`) and returns a readable reference; returns `null` for unmapped books (callers then show the raw string). Never throws.
- `sqlite-reader.ts` drops `BOOKS_BY_NUMBER` and uses this module.
- `tests/anchor-parsing.test.ts` fixtures are corrected (`bible.65.3.21` → Acts 3:21) and gain cases for 64 → John, 66 → Romans, 87 → Revelation, 44 → unmapped. The provenance comment is updated to cite F1/F3.

### 1.2 Verses for notes and highlights

- When the facet table exists, `getUserNotes()` and `getHighlightsFromNotes()` left-join `NoteAnchorFacetReferences` on `NoteId` and take each note's references (ordered by `AnchorIndex`), converted with 1.1.
- `anchorReference` is filled from the facet table first, then from today's `AnchorsJson` parsing.
- The `passage` filter compares against the readable references (current book-name match is kept as the matching rule).
- `HighlightResult` gains `reference` and keeps `syncDate`; `get_user_highlights` output shows style, book title, reference and date (e.g. `- custom:YellowHighlighter — Romans — Romans 1:8–15 (2023-05-24)`, where the first "Romans" is the resource title).

### 1.3 Link builder — new `src/services/logos-urls.ts`

All Logos URL construction moves here; `logos-app.ts` keeps only the launching (`openUrl`) and running checks. With `LOGOS_LINK_STYLE=current`:

| Tool | Link |
|---|---|
| `navigate_passage` | `logosres:<BibleId>;ref=bible.<LogosRef>` — `<BibleId>` = optional new `bible_resource_id` param, else the most-used available Bible in the catalog (`Type IN ('text.monograph.bible', 'text.bible')`, `Availability >= 1`, highest `UseCount`), else `LLS:LEB` |
| `open_resource` | unchanged (`logosres:<id>;ref=bible.<LogosRef>`) |
| `open_guide` | `logos4:Guide;t=<encodeURIComponent(title)>;ref=bible.<LogosRef>` |
| `open_factbook` | `logos4:Factbook;ref=<encodeURIComponent(kbId)>` (from 1.4) |
| `open_word_study` | `logos4:Guide;t=Bible%20Word%20Study` (empty; see 1.5) |
| `search_all` | Verify during implementation (see Open Questions); if no working form is found, same honest treatment as 1.5 |

`<LogosRef>` is today's `toLogosUrlRef()` output (`Jn5.1`). `open_guide`'s `guide_type` description lists the verified titles: "Passage Guide", "Exegetical Guide", "Topic Guide" (topic guides take a knowledge-base ID via 1.4); "Sermon Starter Guide" is described as unconfirmed. With `legacy`, every builder returns today's exact string. Each builder gets a unit test for both styles.

### 1.4 Knowledge-base lookup — new `src/services/knowledge-lookup.ts`

- New `DB_PATHS.autoComplete` = `join(LOGOS_CATALOG_DIR, "AutoComplete", "AutoComplete.db")` (~110 MB on the test install; queries touch only `Labels`, `Terms`, `IconKinds` and `Descriptions`).
- `lookupKnowledgeIds(name)`: exact, case-insensitive match on `Labels.LabelText` joined to `Terms` and `IconKinds`; returns distinct `{ id, label, kind, description }` (English description preferred). Language rows are de-duplicated by `id`.
- `open_factbook`: if exactly one ID matches, or the caller passes an ID (`bk.…`) directly, open it. If several match (e.g. "Moses" → person `bk.#Moses` and topic `bk.%Moses_Person`), return the list and ask the assistant to call again with `kb_id`. No match → actionable "no Factbook entry named …".
- New optional `kb_id` parameter on `open_factbook`; `open_guide` accepts a knowledge-base ID or a name for Topic Guide.

### 1.5 Honest word study

`open_word_study` opens an empty Bible Word Study and returns: "Opened Bible Word Study. Logos does not accept the word via link — ask the user to type it (use `g:` / `h:` for Greek/Hebrew, e.g. `g:agape`)." The README's limitations section lists the formats tried (F7).

### 1.6 Honest status on Windows

- `get_logos_state` on Windows: "Logos is running. Window titles are not available on Windows." instead of "(no named windows found)".
- UI-tool success messages stop suggesting `capture_panel_screenshot` when not on macOS.
- README Prerequisites/Available Tools mark `capture_panel_screenshot` and window titles as macOS-only.

### 1.7 Blob decoder

`decodeClippingBlob()` in `src/utils/clippings.ts` becomes a general `decodeLogosBlob()` (the old name kept as an alias for existing callers):

- `0x01`: gzip payload after the 5-byte header (unchanged).
- `0x02`: raw UTF-8 payload after the 5-byte header (was 4; F17). When the declared length matches the remaining bytes, use exactly that many; otherwise fall back to everything after byte 5.
- Anything else: unchanged best-effort UTF-8 decode.

`tests/clippings-utils.test.ts` fixtures change to the real header shape (`02` + uint32 LE length), plus a fixture copied from the observed passage-list blob. The PR notes that the clipping side is unconfirmed on a real install because the test install has no clippings.

### 1.8 Docs

README: link-style switch, Logos book-number note, limitations (word study, sermon starter, search), updated troubleshooting. `.claude/agents/tool-tester.md`: test prompts for Factbook disambiguation and guide titles.

## PR 2: Study Data

New `DB_PATHS` entries: `readingPlans` = `join(LOGOS_DATA_DIR, "Documents", "ReadingPlan", "ReadingPlan.db")`, `readingProgress` = `join(LOGOS_CATALOG_DIR, "ReadingProgressManager", "readingprogressmanager.db")`, `history` = `join(LOGOS_CATALOG_DIR, "HistoryManager", "history.db")`. (`LOGOS_CATALOG_DIR` is the `Data/<id>` directory despite its name.) `passageLists` already exists. `diagnose` lists them automatically as optional stores (reported as not present, not as a failure).

### 2.1 Reading plans — `get_reading_progress`

- Reads `ReadingPlanDocuments` (non-deleted): `Title`, `Settings` JSON (`resourceId`, range, frequency, start date), `Sessions` JSON (`[{date, readings:[[{resourceId, reference}]]}]`).
- Joins to `ReadingPlanStatus` by matching the document's `ScheduleId` blob (a .NET GUID in little-endian field order) to the status row's `SyncId` hex string. Verified on the test install: status `d80ae946…602d` ↔ ScheduleId bytes `46 e9 0a d8 71 73 ee 41 94 38 a1 39 9d 19 60 2d`. Helper `dotnetGuidBytesToHex()` with a unit test.
- `ReadSessions` (F16) is parsed as the index of the last completed session. Sessions `0…ReadSessions` count as read; the next reading is the first later session whose `readings` list is non-empty (empty sessions are skipped). A plan with no status row has read nothing. A value that isn't a plain non-negative integer is reported raw and the plan's progress is shown as unknown, never guessed. `ReadSessionsMetadata` is ignored (F16).
- Reports per plan: title, resource title, sessions with readings, sessions read, next reading (date + readable passage via 1.1, or page range for non-Bible plans such as `page.9-13`), and days behind (today minus the next reading's scheduled date, when positive). Verified expectations for the test install: CSB plan → next Rev 22 (2025-12-31); 40 Questions plan → next pp 9–13 (2025-01-02).
- Falls back to the existing `ReadingLists.db` output when no plan store exists; when both exist, shows both sections.

### 2.2 `get_resource_reading_progress` (new)

Reads `ReadingStatus` (`ResourceId`, `PercentageRead`, `Ranges`) and `ResourceReadingProgress.ModifiedDate`; titles via `getResourceTitles()`. Parameters: `sort` (`recent` | `percent`, default `recent`), `type` (same label/raw resolution as `get_library_catalog`), `limit` (default 20), `format`.

### 2.3 `get_reading_history` (new)

Reads `History` (non-deleted): `Title`, `Subtitle` (the location, e.g. "John 5:1–9"), `LastVisited`, and the resource ID parsed from `Bookmark` (`Resource|Id=LLS:…|…`). Parameters: `since` (ISO date), `resource_id`, `limit` (default 20), `format`. The description states it is the user's Logos browsing history.

### 2.4 `get_passage_lists` (new)

Reads `PassageLists` (non-deleted): `Title`, `ModifiedDate`, `CompressedItems`. The blob is decoded with the shared decoder from 1.7 (F17) and parsed as JSON (`[{"ref":"bible.18.10.21-18.10.22"},…]`); references are converted via 1.1 (the test list decodes to Job 10:21–22, Ecclesiastes 9:10, Isaiah 5:14).

### 2.5 `format: "json"`

- New helper `json(data)` beside `text()`/`err()`, returning pretty-printed JSON in a text content block.
- Every read tool (existing and new SQLite/catalog tools) accepts `format` (`"text"` default | `"json"`). JSON returns the service objects plus readable *and* raw references, ISO dates, resource IDs and titles.
- `limit` maximum: 1,000 in JSON mode; text-mode defaults unchanged.

## PR 3: Commentary Finder

### 3.1 `find_passage_resources` (new) — in `catalog-reader.ts`

- Input: `passage`; optional `kind` (`commentary`, `study bible`, `cross-references`, `bible`, `harmony`; mapped through the existing type labels), `purpose` (`exegetical`, `expositional`, `application`, `devotional`, `concise`, from `commentary-purpose:` traits), `limit` (default 25), `format`.
- Parses `ReferenceSupersets` (tab-separated on the test install, e.g. `bible.72.1.1-72.4.18<TAB>bible.78.1.1-78.1.25`; split on any whitespace). Uses only `bible` / `bible+edition` entries: `bible.B.C.V-B.C.V`, `bible.B.C-B.C`, `bible.B-B`; missing end parts are treated as open ("to the end of the chapter/book"). Ignores other range types (`af.`, `augustine.`, …). The passage's start must fall inside a range (Logos book numbers via 1.1).
- Output per resource: title, abbreviation, authors, series, kind, purpose, era, community rating, resource ID. Sort: commentaries first, then `UseCount` desc, then `CommunityRating` desc. `UseCount` is used for sorting only and appears in JSON, not text (matching the response-cleanup design that removed it from catalog text).
- Parsed ranges are cached per process, keyed by the catalog file's mtime.
- README notes that the order differs from the user's Passage Guide prioritization list, which is not stored locally (F18).

### 3.2 `open_resource` confirms

After launching, poll `history.db` (read-only) for up to 8 s for a row newer than the launch time whose bookmark contains the resource ID. Report "Opened <abbrev> at <Subtitle>" or "Sent to Logos, but Logos did not confirm opening it — Logos may be busy; try again once it responds." (F20). When the history store is absent, keep today's message. Guide and Factbook replies say the server does not check them.

### 3.3 No batch tool

The assistant calls `find_passage_resources` then `open_resource` per chosen book. README shows the pattern ("open my exegetical commentaries on John 5:14").

## Code Conventions to Preserve

Derived from the code at `6d4a414`, its tests, `docs/design/`, and commit history.

**Language and layout**
- TypeScript `strict`, ES modules, `.js` suffix on relative imports; `tsc` build to `dist/`; Node ≥ 18 (`.env` loading needs Node 20.12+).
- `src/services/` = one module per backend (`sqlite-reader`, `catalog-reader`, `biblia-api`, `logos-app`, `reference-parser`, `screenshot-capture`). New modules follow suit: `logos-books`, `logos-urls`, `knowledge-lookup`.
- `src/utils/` = pure helpers; `src/types.ts` = shared interfaces under `// ─── Section ───` banners; `src/config.ts` = every path, constant and env setting; `src/cli.ts` = diagnose CLI.
- New databases go into `DB_PATHS`; `Data/<id>` paths are built from `LOGOS_CATALOG_DIR`.

**Database access**
- `openDb(path)`: `new Database(path, { readonly: true, fileMustExist: true })`, opened per call and closed in `finally`. No pooling.
- Parameterized SQL only; `LIKE` filters use `escapeLike()` with `ESCAPE '\\'`.
- Best-effort parsers never throw; they return `null` / `[]` and say so in a comment.

**Service vs handler** (per `2026-02-25-response-cleanup-design.md`)
- Services return clean typed objects; handlers only format. Markup stripping via `utils/strip-markup`.
- Keep responses free of debug metadata and noise; don't reintroduce fields the cleanup removed (e.g. use counts in catalog text).

**Tool registration (`src/index.ts`)**
- `server.tool(name, description, zodSchema, handler)` under a numbered banner `// ── N. tool_name ───…`.
- snake_case tool and parameter names, mapped to camelCase service options; every parameter has `.describe()`, including its default ("(default: 20)").
- Descriptions state what is returned and when to use the tool. UI tools begin "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data." and gate on `isLogosRunning()` with an actionable message.
- Return through `text()` / `err()` / `image()` (plus the new `json()`); "Found N …:" list headers; empty results give a filter-specific next step; errors give the message plus a hint.

**Tests**
- Vitest; `tests/<module>.test.ts` importing `../src/….js`; `describe`/`it` with descriptive sentences; inline fixtures with a provenance comment.
- No committed `.db` files (`*.db` is git-ignored): build SQLite fixtures in a temp dir at test time.

**Docs and process**
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`), lower-case summaries, em-dash elaboration for larger changes; branches `feature/…`, `fix/…`, `chore/…`, `docs/…`.
- Keep the tool count in sync everywhere: README intro ("24 MCP tools"), README tool tables by category, project-structure tree, `/mcp` verification step, and `.claude/agents/tool-tester.md` (description, purpose, numbered test table, database→tool dependency table). That file is tracked despite `.claude/agents/` being git-ignored; edit it in place.
- Design docs in `docs/design/YYYY-MM-DD-*.md`, indexed in `docs/design/README.md`; investigations in `docs/research/`.
- No linter/formatter config: match the surrounding style (2-space indent, double quotes, semicolons, trailing commas).

## Testing and Verification

**Unit (all PRs, `npm test`)**
- Book-number conversion including unmapped 40–60; facet-table joins; every URL builder in both link styles; knowledge-base lookup (single, multiple, none); GUID byte-order helper; `ReadSessions` handling (inclusive index, empty-session skip, missing status row, non-integer value); `0x01`/`0x02` blob decoding with the 5-byte header, including a length mismatch; `ReferenceSupersets` range parsing and containment (verse, chapter-only, book-only, edition-prefixed, non-Bible entries ignored); JSON helper and limit capping.
- Two-schema fixtures (legacy and Logos 54 shapes) for every reader.

**Manual verification on Windows Logos 54 (recorded in each PR description)**
- PR 1: a Romans note/highlight labeled Romans; `get_user_notes passage="Acts 9"` returns the Acts 9:35 note; `navigate_passage "John 5:1"` adds a history row; Passage/Exegetical/Topic guides open (tab titles); `open_factbook "Moses"` disambiguates, `kb_id="bk.#Moses"` opens; word study message is honest.
- PR 2: reading plans' next readings match Logos's Today page (CSB → Rev 22, 40 Questions → pp 9–13 on the test install); per-book progress matches the resource's progress indicator; history matches the History panel.
- PR 3: `find_passage_resources "John 5:1" kind=commentary` lists Carson (PNTC Jn) and Phillips (REC Jn); `open_resource` confirms via history.

**Requested of the maintainer on macOS**
- New link formats with `LOGOS_LINK_STYLE=current`; one NT note label; database paths for reading plans, progress and history.

## Open Questions (resolved during implementation, not blocking the design)

1. **`search_all` link.** Saved panels use `SearchKindName`, `QueryText` and `SyntaxVersion` (F19). Try, with Logos idle and the workspace (not the Today page) showing: `logos4:Search;kind=AllSearch;q=…;syntax=v2`, `logos4:Search;kind=BooksSearch;q=…`, and `logos4:Search;SearchKindName=AllSearch;QueryText=…`. These three were tried once while Logos was not processing any links (F20), so that run proves nothing. If none works, give `search_all` the honest treatment from 1.5.
2. **Sermon Starter theme.** Confirm whether `logos4:Guide;t=Sermon%20Starter%20Guide;ref=bk.to%3ADBT-5333` loads "Healing" (F8), under the same idle conditions. If not, describe the guide as opening without a theme.

### Resolved

- `ReadSessions` meaning → F16, applied in 2.1.
- `0x02` blob header length → F17, applied in 1.7 and 2.4.
- Passage Guide prioritization storage → F18, applied in 3.1 (not used).
