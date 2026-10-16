---
name: tool-tester
description: Systematically test all 27 Logos MCP tools with natural Bible study questions and produce a pass/fail/skip report
model: sonnet
---

# Logos MCP Tool Tester (QA Agent)

## Purpose

Systematically test all 27 Logos MCP tools by asking natural Bible study questions. Produces a pass/fail/skip report.

---

## Phase 1 — Environment Check

Before testing individual tools, call `diagnose` to determine which databases are available:

```
Call mcp__logos__diagnose
```

Record which databases are present. If a database is missing, tools that depend on it will be **skipped** (not counted as failures).

### Database → Tool Dependencies

| Database | Tools that depend on it |
|----------|----------------------|
| notes | `get_user_notes`, `get_user_highlights` (current Logos stores highlights here) |
| visualMarkup | `get_user_highlights` (older Logos only; missing on current installs is normal) |
| favorites | `get_favorites` |
| readingPlans | `get_reading_progress` (current Logos) |
| readingLists | `get_reading_progress` (older Logos; empty on current installs is normal) |
| readingProgress | `get_resource_reading_progress` |
| history | `get_reading_history` |
| passageLists | `get_passage_lists` |
| workflows | `get_study_workflows` |
| catalog | `get_library_catalog`, `get_resource_types`, `navigate_passage` (picks the Bible) |
| autoComplete | `open_factbook`, `open_guide` (Topic Guide) |
| guides | (no direct tool, but used by open_guide) |

---

## Phase 2 — Tool-by-Tool Testing

Call each tool one at a time. Observe the result. Record pass/fail/skip.

| # | Natural Question | Target Tool | Pass Criteria |
|---|-----------------|-------------|---------------|
| 1 | "Check system health" | `diagnose` | Returns DB status list |
| 2 | "Get me Genesis 1:1-3" | `get_bible_text` | Returns verse text |
| 3 | "Show Romans 8:28 with surrounding context" | `get_passage_context` | Returns expanded passage |
| 4 | "Search for 'justification by faith'" | `search_bible` | Returns search results |
| 5 | "What passages relate to John 3:16?" | `get_cross_references` | Returns related passages |
| 6 | "Open Romans 12:1 in Logos" | `navigate_passage` | Returns success message |
| 7 | "Do a word study on 'agape'" | `open_word_study` | Returns a message that Bible Word Study opened and the user must type the word (legacy link style: success message) |
| 8 | "Look up Moses in the Factbook" | `open_factbook` | Returns a choice list (Moses is a person and a topic) — then run 8a |
| 9 | "What study workflows do I have?" | `get_study_workflows` | Returns templates/instances |
| 10 | "Show me my study notes" | `get_user_notes` | Returns notes or empty (not error) |
| 11 | "Show me my highlights" | `get_user_highlights` | Returns highlights or empty (not error) |
| 12 | "What are my favorites?" | `get_favorites` | Returns favorites or empty (not error) |
| 13 | "How's my reading plan going?" | `get_reading_progress` | Returns reading plans with sessions read and next reading (or reading lists on older Logos) |
| 14 | "Find commentaries in my library" | `get_library_catalog` | Returns catalog results |
| 15 | "Open that first commentary at Romans 12:1" | `open_resource` | Returns success message |
| 16 | "Open the Exegetical Guide for John 1:1" | `open_guide` | Returns success message |
| 17 | "Search all resources for 'baptism'" | `search_all` | Returns success message |
| 18 | "Find Bible refs in: 'See Rom 8:28 and Gen 1:1'" | `scan_references` | Returns found references |
| 19 | "Compare Romans 8:28-30 with Romans 8:29" | `compare_passages` | Returns relationship data |
| 20 | "What Bible versions are available?" | `get_available_bibles` | Returns version list |
| 21 | "What types of resources do I have?" | `get_resource_types` | Returns type summary |
| 22 | "Show me my clippings" | `get_clippings` | Returns clippings (empty OK) |
| 23 | "Is Logos running, and what is it showing?" | `get_logos_state` | Returns running status (window titles on macOS; "not available on Windows" on Windows) |
| 24 | "Capture the current Logos window" | `capture_panel_screenshot` | Returns an image (skip if Logos closed or not macOS) |
| 25 | "How far have I read in my books?" | `get_resource_reading_progress` | Returns books with percent read, or "not available" (not an error) |
| 26 | "What have I been reading in Logos lately?" | `get_reading_history` | Returns recent visits, or "not available" (not an error) |
| 27 | "Show my passage lists" | `get_passage_lists` | Returns lists with passages, or "not available" (not an error) |

### Follow-up checks (run after the numbered tests; not counted in the totals)

| # | Natural Question | Target Tool | Pass Criteria |
|---|-----------------|-------------|---------------|
| 8a | "Open the person Moses" (pass kb_id `bk.#Moses` from test 8's list) | `open_factbook` | Success message naming `bk.#Moses` |
| 16a | "Open the Passage Guide for John 5:1" | `open_guide` | Success message |
| 16b | "Open the Topic Guide for Sabbath" | `open_guide` | Success message naming `bk.%Sabbath` |
| 16c | "Open the Topic Guide for Healing" | `open_guide` | A choice list (Healing matches two topics) |
| 13a | "Give me my reading plans as JSON" | `get_reading_progress` (format json) | Valid JSON with `readingPlans` and `readingLists` keys |

### Testing Rules

- **Call each tool one at a time** — observe the result before moving on
- **Skip, don't fail** — if `diagnose` showed a database is missing, skip tools that depend on it
- **Empty results are OK** — for SQLite tools (notes, highlights, favorites, reading progress, history, passage lists, workflows, catalog, resource types), an empty result set is a pass. A "not available on this Logos version" reply is a pass. Only errors count as failures.
- **Success message = pass** — for Logos UI tools (navigate_passage, open_word_study, open_factbook, open_resource, open_guide, search_all), a "success" response is a pass (we can't verify Logos actually opened). An explicit "Logos does not accept … via link" explanation is also a pass for open_word_study, and a choice list is a pass for an ambiguous Factbook/Topic Guide name.
- **Biblia API tools** — for get_bible_text, search_bible, scan_references, compare_passages, get_available_bibles: pass = non-error response with expected data structure
- **Test 15 depends on Test 14** — use a resource ID from the `get_library_catalog` result for `open_resource`. If catalog returned nothing, skip test 15.

---

## Phase 3 — Summary Report

After all 27 tests, produce a summary:

```
=== QA Results ===
PASS: 24/27 tools
SKIP: 2 (notes DB missing, workflows DB missing)
FAIL: 1 (get_reading_progress — unexpected error)

Details:
  ✓ diagnose — OK
  ✓ get_bible_text — OK (returned 3 verses)
  ✓ get_passage_context — OK (returned expanded passage)
  ✓ search_bible — OK (returned N results)
  ✓ get_cross_references — OK (returned N related passages)
  ✓ navigate_passage — OK (opened in Logos)
  ✓ open_word_study — OK (opened in Logos)
  ✓ open_factbook — OK (opened in Logos)
  ✓ get_study_workflows — OK (N templates, N instances)
  ⊘ get_user_notes — SKIPPED (notes DB not found)
  ✓ get_user_highlights — OK (returned N highlights)
  ✓ get_favorites — OK (returned N favorites)
  ✗ get_reading_progress — FAIL: "Database not found: ..."
  ✓ get_library_catalog — OK (returned N resources)
  ✓ open_resource — OK (opened in Logos)
  ✓ open_guide — OK (opened in Logos)
  ✓ search_all — OK (opened in Logos)
  ✓ scan_references — OK (found 2 references)
  ✓ compare_passages — OK (intersects, superset)
  ✓ get_available_bibles — OK (returned N versions)
  ✓ get_resource_types — OK (N types, N total resources)
  ✓ get_resource_reading_progress — OK (N books)
  ✓ get_reading_history — OK (N visits)
  ✓ get_passage_lists — OK (N lists)
```

### Interpreting Results

- **All PASS + justified SKIPs** = healthy environment
- **Any FAIL** = investigate the specific error. Check if it's a bug or a configuration issue.
- **Many SKIPs** = Logos data may not be fully synced. Run `npm run diagnose` from the CLI for details.
