# MCP Response Cleanup — Design Document

## Problem

Five Logos MCP tools return noisy data that wastes LLM context tokens:

1. **get_user_notes** — Raw XAML markup (`<Paragraph><Run FontSize="12"...>`) instead of plain text; empty notes returned
2. **scan_references** — Useless `position`/`length` byte offsets
3. **get_resource_types** — Raw internal type codes alongside labels (e.g. `text.monograph.concordance.bible`)
4. **get_cross_references** — Leaks debug info `(searched: "...")` and returns queried verse as its own cross-reference
5. **get_library_catalog** — `(used N×)` noise on every result

## Decision: Service-Layer Cleanup (Option 2)

Clean data at the service layer so handlers always receive clean data. No raw data preservation needed.

## Changes by File

### 1. New file: `src/utils/strip-markup.ts`
- Extract `stripXml()` from `catalog-reader.ts` into shared utility
- Add `stripRichText()` that handles Logos XAML/RichText specifically (extracts `Text="..."` attributes, then falls back to generic XML strip)
- Single source of truth for all markup removal

### 2. `src/services/sqlite-reader.ts`
- `getUserNotes()`: Strip XAML from `ContentRichText` before returning; filter out notes with empty content after stripping

### 3. `src/services/biblia-api.ts`
- `scanReferences()`: Return only `passage` field, drop `textIndex`/`textLength` from results

### 4. `src/services/catalog-reader.ts`
- Import `stripXml` from shared utility instead of local function
- `getResourceTypeSummary()`: Drop the raw `type` field, return only `label` and `count`

### 5. `src/types.ts`
- `ScanResult`: Remove `textIndex`/`textLength` fields
- `ResourceTypeSummary`: Remove `type` field
- `CatalogResource`: Remove `useCount` field

### 6. `src/index.ts` (tool handlers)
- `get_user_notes`: Remove `.substring(0, 300)` truncation (service returns clean text now); remove `(no content)` fallback (empty notes filtered)
- `scan_references`: Remove position/length from format string
- `get_resource_types`: Remove `(${s.type})` from format string
- `get_cross_references`: Remove `(searched: "${searchQuery}")` from response; filter out self-references
- `get_library_catalog`: Remove `(used ${r.useCount}×)` from format string
