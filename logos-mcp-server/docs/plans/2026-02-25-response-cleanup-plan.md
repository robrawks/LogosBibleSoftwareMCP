# MCP Response Cleanup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Strip noisy markup, debug metadata, and useless fields from 5 MCP tool responses so LLMs receive clean, readable text.

**Architecture:** Extract shared `stripXml`/`stripRichText` into a utility module, clean data at the service layer, simplify handler formatting strings. TDD with vitest.

**Tech Stack:** TypeScript, vitest, better-sqlite3, Biblia API

---

### Task 1: Create shared markup utility with tests

**Files:**
- Create: `src/utils/strip-markup.ts`
- Create: `tests/strip-markup.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/strip-markup.test.ts
import { describe, it, expect } from "vitest";
import { stripXml, stripRichText } from "../src/utils/strip-markup.js";

describe("stripXml", () => {
  it("removes HTML/XML tags", () => {
    expect(stripXml("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("decodes HTML entities", () => {
    expect(stripXml("faith &amp; grace &lt;3&gt;")).toBe("faith & grace <3>");
  });

  it("normalizes whitespace", () => {
    expect(stripXml("hello   \n  world")).toBe("hello world");
  });

  it("returns null for null input", () => {
    expect(stripXml(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(stripXml("")).toBeNull();
  });
});

describe("stripRichText", () => {
  it("extracts text from Logos XAML Run elements", () => {
    const xaml = '<Paragraph><Run FontSize="12" Text="Grace alone"/></Paragraph>';
    expect(stripRichText(xaml)).toBe("Grace alone");
  });

  it("joins multiple Run elements with spaces", () => {
    const xaml = '<Paragraph><Run Text="Hello"/><Run Text="world"/></Paragraph>';
    expect(stripRichText(xaml)).toBe("Hello world");
  });

  it("adds newlines between paragraphs", () => {
    const xaml = '<Paragraph><Run Text="Line one"/></Paragraph><Paragraph><Run Text="Line two"/></Paragraph>';
    expect(stripRichText(xaml)).toBe("Line one\nLine two");
  });

  it("falls back to stripXml for non-XAML content", () => {
    expect(stripRichText("<p>Simple HTML</p>")).toBe("Simple HTML");
  });

  it("returns null for null input", () => {
    expect(stripRichText(null)).toBeNull();
  });

  it("returns null for whitespace-only result", () => {
    const xaml = '<Paragraph><Run Text="   "/></Paragraph>';
    expect(stripRichText(xaml)).toBeNull();
  });

  it("handles Text attributes with single quotes", () => {
    const xaml = "<Paragraph><Run Text='Grace alone'/></Paragraph>";
    expect(stripRichText(xaml)).toBe("Grace alone");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd logos-mcp-server && npx vitest run tests/strip-markup.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// src/utils/strip-markup.ts

/**
 * Remove XML/HTML tags and decode common entities.
 * Returns null if input is null or result is empty.
 */
export function stripXml(text: string | null): string | null {
  if (!text) return null;
  const result = text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return result.length > 0 ? result : null;
}

/**
 * Extract plain text from Logos XAML RichText content.
 * Handles <Run Text="..."/> elements across <Paragraph> blocks.
 * Falls back to generic stripXml for non-XAML content.
 */
export function stripRichText(text: string | null): string | null {
  if (!text) return null;

  // Check if this looks like Logos XAML (has Run elements with Text attributes)
  if (!text.includes("<Run ")) {
    return stripXml(text);
  }

  // Split by paragraph boundaries
  const paragraphs = text.split(/<\/Paragraph>\s*<Paragraph[^>]*>/i);

  const lines: string[] = [];
  for (const para of paragraphs) {
    // Extract all Text="..." or Text='...' attribute values
    const texts: string[] = [];
    const regex = /Text=["']([^"']*)["']/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(para)) !== null) {
      if (match[1].trim()) {
        texts.push(match[1]);
      }
    }
    if (texts.length > 0) {
      lines.push(texts.join(" "));
    }
  }

  const result = lines.join("\n").trim();
  return result.length > 0 ? result : null;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd logos-mcp-server && npx vitest run tests/strip-markup.test.ts`
Expected: PASS (all 13 tests)

**Step 5: Commit**

```bash
git add src/utils/strip-markup.ts tests/strip-markup.test.ts
git commit -m "feat: add shared stripXml/stripRichText markup utilities with tests"
```

---

### Task 2: Clean getUserNotes — strip XAML, filter empties

**Files:**
- Modify: `src/services/sqlite-reader.ts:246-298`
- Create: `tests/sqlite-reader-notes.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/sqlite-reader-notes.test.ts
import { describe, it, expect } from "vitest";
import { stripRichText } from "../src/utils/strip-markup.js";

describe("getUserNotes content cleaning", () => {
  it("strips XAML from note content", () => {
    const raw = '<Paragraph><Run FontSize="12" FontFamily="Segoe UI" Text="Salvation by grace through faith"/></Paragraph>';
    expect(stripRichText(raw)).toBe("Salvation by grace through faith");
  });

  it("returns null for empty XAML content", () => {
    const raw = '<Paragraph><Run FontSize="12" Text=""/></Paragraph>';
    expect(stripRichText(raw)).toBeNull();
  });

  it("handles multi-paragraph notes", () => {
    const raw = '<Paragraph><Run Text="First point"/></Paragraph><Paragraph><Run Text="Second point"/></Paragraph>';
    expect(stripRichText(raw)).toBe("First point\nSecond point");
  });
});
```

**Step 2: Run test to verify it passes** (uses already-built utility)

Run: `cd logos-mcp-server && npx vitest run tests/sqlite-reader-notes.test.ts`
Expected: PASS

**Step 3: Modify sqlite-reader.ts**

In `src/services/sqlite-reader.ts`:
- Add import: `import { stripRichText } from "../utils/strip-markup.js";`
- In `getUserNotes()`, change the return mapping (line 285-294) to strip content and filter empties:

```typescript
// Replace lines 285-294 with:
    return rows
      .map((r) => ({
        noteId: r.NoteId,
        externalId: r.ExternalId,
        content: stripRichText(r.ContentRichText),
        createdDate: r.CreatedDate,
        modifiedDate: r.ModifiedDate,
        notebookTitle: r.NotebookTitle,
        anchorsJson: r.AnchorsJson,
        tagsJson: r.TagsJson,
      }))
      .filter((n) => n.content !== null);
```

**Step 4: Simplify get_user_notes handler in index.ts**

In `src/index.ts` lines 141-146, the handler no longer needs `.substring(0, 300)` or the `(no content)` fallback:

```typescript
// Replace lines 141-146 with:
      const lines = notes.map((n) => {
        const header = n.notebookTitle ? `[${n.notebookTitle}]` : "[No notebook]";
        const date = n.modifiedDate ?? n.createdDate;
        return `${header} (${date})\n${n.content}`;
      });
```

**Step 5: Run full test suite**

Run: `cd logos-mcp-server && npx vitest run`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/services/sqlite-reader.ts src/index.ts tests/sqlite-reader-notes.test.ts
git commit -m "feat: strip XAML from user notes and filter empty notes"
```

---

### Task 3: Clean scanReferences — drop position/length

**Files:**
- Modify: `src/types.ts:144-148`
- Modify: `src/services/biblia-api.ts:68-78`
- Modify: `src/index.ts:351`

**Step 1: Update ScanResult type**

In `src/types.ts`, replace lines 144-148:

```typescript
export interface ScanResult {
  passage: string;
}
```

**Step 2: Update scanReferences service**

In `src/services/biblia-api.ts`, replace lines 68-78:

```typescript
export async function scanReferences(
  text: string,
  tagChapters: boolean = true
): Promise<ScanResult[]> {
  const data = await bibliaFetch("/scan", {
    text,
    tagChapters: String(tagChapters),
  }) as { results: Array<{ passage: string; textIndex: number; textLength: number }> };

  return (data.results ?? []).map((r) => ({ passage: r.passage }));
}
```

**Step 3: Update scan_references handler**

In `src/index.ts` line 351, replace:

```typescript
      const lines = results.map((r) => `- **${r.passage}**`);
```

**Step 4: Run full test suite**

Run: `cd logos-mcp-server && npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/types.ts src/services/biblia-api.ts src/index.ts
git commit -m "feat: drop position/length from scan_references results"
```

---

### Task 4: Clean getResourceTypeSummary — drop raw type codes

**Files:**
- Modify: `src/types.ts:136-140`
- Modify: `src/services/catalog-reader.ts:131-153`
- Modify: `src/index.ts:405`

**Step 1: Update ResourceTypeSummary type**

In `src/types.ts`, replace lines 136-140:

```typescript
export interface ResourceTypeSummary {
  label: string;
  count: number;
}
```

**Step 2: Update getResourceTypeSummary service**

In `src/services/catalog-reader.ts`, the return mapping (lines 145-149) becomes:

```typescript
    return rows.map((r) => ({
      label: typeLabel(r.Type),
      count: r.Count,
    }));
```

**Step 3: Update get_resource_types handler**

In `src/index.ts` line 405, replace:

```typescript
        const lines = summary.map((s) => `- **${s.label}**: ${s.count}`);
```

**Step 4: Run full test suite**

Run: `cd logos-mcp-server && npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/types.ts src/services/catalog-reader.ts src/index.ts
git commit -m "feat: show only human labels in resource type summary"
```

---

### Task 5: Clean get_cross_references handler — remove debug info and self-references

**Files:**
- Modify: `src/index.ts:101-127`

**Step 1: Update get_cross_references handler**

In `src/index.ts`, replace lines 123-127:

```typescript
      // Filter out self-references (the queried passage itself)
      const filtered = results.results.filter(
        (r) => r.title.toLowerCase() !== passage.toLowerCase()
      );
      if (filtered.length === 0) return text(`No cross-references found for ${passage}.`);
      const lines = filtered.map((r) => `**${r.title}**: ${r.preview}`);
      return text(`Cross-references for **${passage}**:\n\n${lines.join("\n\n")}`);
```

Note: The `(searched: "${searchQuery}")` debug string is removed from the response.

**Step 2: Run full test suite**

Run: `cd logos-mcp-server && npx vitest run`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: remove debug info and self-references from cross-references"
```

---

### Task 6: Clean get_library_catalog handler — remove useCount noise

**Files:**
- Modify: `src/types.ts:124-134`
- Modify: `src/services/catalog-reader.ts:113-123`
- Modify: `src/index.ts:278-282`

**Step 1: Remove useCount from CatalogResource type**

In `src/types.ts`, remove the `useCount` field from `CatalogResource` (line 133).

**Step 2: Remove useCount from searchCatalog service**

In `src/services/catalog-reader.ts`:
- Remove `UseCount` from the SQL SELECT (line 77)
- Remove `useCount: r.UseCount` from the return mapping (line 122)

**Step 3: Update get_library_catalog handler**

In `src/index.ts` lines 278-282, remove the useStr line:

```typescript
        const lines = resources.map((r) => {
          const authorStr = r.authors ? ` — ${r.authors}` : "";
          const label = typeLabel(r.type);
          return `- **${r.title}**${authorStr}\n  ID: \`${r.resourceId}\` | Type: ${label}`;
        });
```

**Step 4: Run full test suite**

Run: `cd logos-mcp-server && npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/types.ts src/services/catalog-reader.ts src/index.ts
git commit -m "feat: remove useCount noise from library catalog results"
```

---

### Task 7: Migrate catalog-reader to shared stripXml

**Files:**
- Modify: `src/services/catalog-reader.ts:1-63`

**Step 1: Replace local stripXml with shared import**

In `src/services/catalog-reader.ts`:
- Add import: `import { stripXml } from "../utils/strip-markup.js";`
- Delete the local `stripXml` function (lines 52-63)

**Step 2: Run full test suite**

Run: `cd logos-mcp-server && npx vitest run`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/services/catalog-reader.ts
git commit -m "refactor: use shared stripXml utility in catalog-reader"
```

---

### Task 8: Build, verify, final commit

**Step 1: Run full test suite**

Run: `cd logos-mcp-server && npx vitest run`
Expected: All PASS

**Step 2: Build the project**

Run: `cd logos-mcp-server && npm run build`
Expected: Clean compile, no errors

**Step 3: Verify with tool-tester agent**

Run the tool-tester agent to confirm all 21 tools still work and responses are clean.
