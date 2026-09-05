#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync } from "fs";
import Database from "better-sqlite3";
import { SERVER_NAME, SERVER_VERSION, LOGOS_DATA_DIR, LOGOS_CATALOG_DIR, DB_PATHS, BIBLIA_API_KEY } from "./config.js";

// Service imports
import { getBibleText, searchBible, scanReferences, comparePassages, getAvailableBibles, getPassageWithContext } from "./services/biblia-api.js";
import { navigateToPassage, openWordStudy, openFactbook, openResource, openGuide, searchAll, isLogosRunning } from "./services/logos-app.js";
import { parseReference } from "./services/reference-parser.js";
import {
  getUserHighlights,
  getClippings,
  getFavorites,
  getWorkflowTemplates,
  getWorkflowInstances,
  bibleRawToHuman,
  getReadingProgress,
  getUserNotes,
} from "./services/sqlite-reader.js";
import { searchCatalog, getResourceTypeSummary, typeLabel } from "./services/catalog-reader.js";
import { captureLogosPanel, getLogosWindowTitles } from "./services/screenshot-capture.js";
import type { CaptureToolType } from "./types.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function err(s: string) {
  return { content: [{ type: "text" as const, text: s }], isError: true as const };
}

function image(base64: string, description: string) {
  return {
    content: [
      { type: "image" as const, data: base64, mimeType: "image/png" },
      { type: "text" as const, text: description },
    ],
  };
}

// Canonical lowercase form of a Bible reference ("Ro 8:28" -> "romans 8:28",
// "Genesis 1:1-3" -> "genesis 1:1-3"). Returns null when the input isn't a
// parseable reference — callers fall back to plain string comparison then.
function canonicalReference(input: string): string | null {
  try {
    const ref = parseReference(input);
    let result = `${ref.book} ${ref.chapter}`;
    if (ref.verse !== undefined) {
      result += `:${ref.verse}`;
    }
    if (ref.endChapter !== undefined) {
      if (ref.endVerse !== undefined) {
        result += ref.endChapter === ref.chapter ? `-${ref.endVerse}` : `-${ref.endChapter}:${ref.endVerse}`;
      } else {
        result += `-${ref.endChapter}`;
      }
    }
    return result.toLowerCase();
  } catch {
    return null;
  }
}

async function main() {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // ── 1. navigate_passage ──────────────────────────────────────────────────
  server.tool(
    "navigate_passage",
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. Open a Bible passage in the Logos Bible Software UI. Provide a reference like 'Genesis 1:1' or 'Romans 8:28-30'. Use to show the user a passage in Logos, or to position the app before capture_panel_screenshot.",
    { reference: z.string().describe("Bible reference (e.g., 'Genesis 1:1', 'Romans 8:28-30')") },
    async ({ reference }) => {
      if (!(await isLogosRunning())) {
        return text("Logos is not running. Ask the user to launch Logos first, or use get_bible_text / search_bible, which work without the app.");
      }
      const result = await navigateToPassage(reference);
      return result.success
        ? text(`Dispatched to Logos: Bible passage ${reference}. This only opens the Logos UI on the user's screen — no data is returned to you. Call get_logos_state to confirm what Logos is showing, or capture_panel_screenshot (panel_type: 'bible') to see the results.`)
        : err(`Failed to open passage: ${result.error}`);
    }
  );

  // ── 2. get_bible_text ────────────────────────────────────────────────────
  server.tool(
    "get_bible_text",
    "Retrieve the text of a Bible passage. Defaults to the Lexham English Bible (LEB). Provide a reference like 'Genesis 1:1-5' or 'Romans 8:28-30'. Returns the passage text with its version. Useful for reading Scripture directly when the Logos app isn't running or when plain text is enough.",
    {
      passage: z.string().describe("Bible reference (e.g., 'Genesis 1:1-5', 'John 3:16')"),
      bible: z.string().optional()
        .describe("Bible version code, case-insensitive (default LEB; also KJV, ASV, DARBY, YLT, WEB and more). Served by the free Biblia web API (requires network + BIBLIA_API_KEY), NOT the user's Logos library. Call get_available_bibles for the full list."),
    },
    async ({ passage, bible }) => {
      try {
        const result = await getBibleText(passage, bible);
        return text(`**${result.passage}** (${result.bible})\n\n${result.text}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const note = msg.includes("BIBLIA_API_KEY")
          ? "\n\nNote: only the Biblia-backed Bible-text tools need this key — the Logos library, notes, highlights, navigation, and screenshot tools all still work."
          : "";
        return err(`${msg}${note}`);
      }
    }
  );

  // ── 3. get_passage_context ───────────────────────────────────────────────
  server.tool(
    "get_passage_context",
    "Get a Bible passage along with surrounding verses for context. Useful when examining a verse that might be taken out of context. Returns the passage text with its version.",
    {
      passage: z.string().describe("Bible reference to center on"),
      context_verses: z.number().optional().describe("Verses before/after to include (default: 5)"),
      bible: z.string().optional()
        .describe("Bible version code, case-insensitive (default LEB; also KJV, ASV, DARBY, YLT, WEB and more). Served by the free Biblia web API (requires network + BIBLIA_API_KEY), NOT the user's Logos library. Call get_available_bibles for the full list."),
    },
    async ({ passage, context_verses, bible }) => {
      try {
        const result = await getPassageWithContext(passage, context_verses ?? 5, bible);
        return text(`**${result.passage}** (${result.bible}) — context around ${passage}\n\n${result.text}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const note = msg.includes("BIBLIA_API_KEY")
          ? "\n\nNote: only the Biblia-backed Bible-text tools need this key — the Logos library, notes, highlights, navigation, and screenshot tools all still work."
          : "";
        return err(`${msg}${note}`);
      }
    }
  );

  // ── 4. search_bible ──────────────────────────────────────────────────────
  server.tool(
    "search_bible",
    "Search the Bible for a word, phrase, or topic. Returns matching verses with previews. Useful for topical studies and finding related passages. NOTE: multiple words are matched as OR by default — 'traditions delivered handed down' returns any verse containing any of those terms. Pass match='phrase' to find the words together as a phrase.",
    {
      query: z.string().describe("Search terms (e.g., 'justification by faith')"),
      match: z.enum(["any", "phrase"]).optional()
        .describe("'any' (default) matches verses containing ANY of the words; 'phrase' matches the words together as a contiguous phrase."),
      limit: z.number().optional().describe("Max results (default: 20)"),
      bible: z.string().optional()
        .describe("Bible version code, case-insensitive (default LEB; also KJV, ASV, DARBY, YLT, WEB and more). Served by the free Biblia web API (requires network + BIBLIA_API_KEY), NOT the user's Logos library. Call get_available_bibles for the full list."),
    },
    async ({ query, match, limit, bible }) => {
      try {
        const result = await searchBible(query, { limit, bible, match });
        if (result.resultCount === 0) {
          const hint = (match ?? "any") === "phrase"
            ? " Try match='any' to match the words separately."
            : "";
          return text(`No results for ${result.query}.${hint}`);
        }
        const lines = result.results.map((r) => `**${r.title}**: ${r.preview}`);
        return text(`Found ${result.resultCount} results for ${result.query}:\n\n${lines.join("\n\n")}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const note = msg.includes("BIBLIA_API_KEY")
          ? "\n\nNote: only the Biblia-backed Bible-text tools need this key — the Logos library, notes, highlights, navigation, and screenshot tools all still work."
          : "";
        return err(`${msg}${note}`);
      }
    }
  );

  // ── 5. get_cross_references ──────────────────────────────────────────────
  server.tool(
    "get_cross_references",
    "Find verses with overlapping key vocabulary using Biblia full-text search. NOTE: this is keyword similarity, not a curated cross-reference index — results share wording, not necessarily theology or true parallels. Returns matching verses with previews.",
    {
      passage: z.string().describe("Bible reference (e.g., 'Romans 8:28')"),
      key_terms: z.string().optional().describe("Specific terms to search instead of auto-extracting"),
    },
    async ({ passage, key_terms }) => {
      try {
        let searchQuery: string;
        if (key_terms) {
          searchQuery = key_terms;
        } else {
          const passageResult = await getBibleText(passage);
          const stopWords = new Set([
            "the","a","an","and","or","but","in","on","at","to","for","of","with",
            "by","from","is","are","was","were","be","been","have","has","had","do",
            "does","did","will","would","could","should","may","might","shall","that",
            "this","these","those","it","its","he","she","they","them","his","her",
            "their","not","no","nor","as","if","then","than","so","all","who","which",
            "what","when","where","how","i","me","my","we","us","you","your","him",
            "up","out","into","upon",
          ]);
          const words = passageResult.text
            .replace(/[^\w\s]/g, "")
            .split(/\s+/)
            .filter((w) => w.length > 3 && !stopWords.has(w.toLowerCase()))
            .slice(0, 5);
          searchQuery = words.join(" ");
        }
        const results = await searchBible(searchQuery, { limit: 15 });
        // Exclude the source verse itself. Compare canonical parsed forms so
        // abbreviations/formatting differences ("Ro 8:28" vs "Romans 8:28")
        // still match; fall back to the old string comparison when either
        // side fails to parse.
        const canonicalPassage = canonicalReference(passage);
        const filtered = results.results.filter((r) => {
          const canonicalTitle = canonicalReference(r.title);
          if (canonicalTitle !== null && canonicalPassage !== null) {
            return canonicalTitle !== canonicalPassage;
          }
          return r.title.toLowerCase() !== passage.toLowerCase();
        });
        if (filtered.length === 0) return text(`No cross-references found for ${passage}.`);
        const lines = filtered.map((r) => `**${r.title}**: ${r.preview}`);
        return text(`Cross-references for **${passage}**:\n\n${lines.join("\n\n")}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const note = msg.includes("BIBLIA_API_KEY")
          ? "\n\nNote: only the Biblia-backed Bible-text tools need this key — the Logos library, notes, highlights, navigation, and screenshot tools all still work."
          : "";
        return err(`${msg}${note}`);
      }
    }
  );

  // ── 6. get_user_notes ────────────────────────────────────────────────────
  server.tool(
    "get_user_notes",
    "Read the user's study notes from Logos Bible Software. Can filter by notebook title, full-text query, or Bible passage anchor. Returns note content, dates, anchors, and tags.",
    {
      notebook_title: z.string().optional().describe("Filter by notebook title (partial match)"),
      query: z.string().optional().describe("full-text match on note content"),
      passage: z.string().optional().describe("filter to notes anchored to this Bible passage, e.g. 'Romans 8'"),
      limit: z.number().optional().describe("Max notes to return (default: 20)"),
    },
    async ({ notebook_title, query, passage, limit }) => {
      const notes = getUserNotes({ notebookTitle: notebook_title, query, passage, limit: limit ?? 20 });
      if (notes.length === 0) {
        if (notebook_title) {
          return text(`No notes matched notebook '${notebook_title}'. Try get_user_notes without filters to see all notebooks, or check the spelling.`);
        }
        if (query) {
          return text(`No notes matched query "${query}". Try removing the filter or broadening the search.`);
        }
        if (passage) {
          return text(`No notes matched passage '${passage}'. Try a different passage, or call get_user_notes without the passage filter to see all notes.`);
        }
        return text("No notes matched this query.");
      }
      const lines = notes.map((n) => {
        const header = n.notebookTitle ? `[${n.notebookTitle}]` : "[No notebook]";
        const date = n.modifiedDate ?? n.createdDate;
        const anchor = n.anchorReference ? ` — anchored to ${n.anchorReference}` : "";
        const tags = n.tags.length > 0 ? ` [tags: ${n.tags.join(", ")}]` : "";
        return `${header}${anchor}${tags} (${date})\n${n.content}`;
      });
      return text(`Found ${notes.length} notes:\n\n${lines.join("\n\n---\n\n")}`);
    }
  );

  // ── 7. get_user_highlights ───────────────────────────────────────────────
  server.tool(
    "get_user_highlights",
    "Read the user's highlights and visual markup from Logos Bible Software. Shows which passages have been highlighted and with what styles. Returns the Bible reference (when the highlight is anchored to a Bible text), the highlight style, and the resource title it lives in. Filter by passage to find highlights in a given book, e.g. passage: 'Job'.",
    {
      resource_id: z.string().optional().describe("Filter by resource ID"),
      style_name: z.string().optional().describe("Filter by highlight style name"),
      passage: z
        .string()
        .optional()
        .describe("Filter to highlights anchored in this book, e.g. 'Job' or 'Ephesians 1'"),
      limit: z.number().optional().describe("Max highlights to return (default: 50)"),
    },
    async ({ resource_id, style_name, passage, limit }) => {
      const highlights = getUserHighlights({
        resourceId: resource_id,
        styleName: style_name,
        passage,
        limit: limit ?? 50,
      });
      if (highlights.length === 0) {
        const filter = passage
          ? `passage '${passage}'`
          : resource_id
            ? `resource '${resource_id}'`
            : style_name
              ? `style '${style_name}'`
              : null;
        return text(filter
          ? `No highlights matched ${filter}. Try removing the filters to see all highlights.`
          : "No highlights matched this query.");
      }
      // Lead with the reference when there is one: it is what distinguishes two
      // highlights that share a style and a resource.
      const lines = highlights.map((h) => {
        const where = h.resourceTitle ?? h.resourceId;
        return h.anchorReference
          ? `- **${h.anchorReference}** — ${h.styleName} (${where})`
          : `- **${h.styleName}**: ${where}`;
      });
      return text(`Found ${highlights.length} highlights:\n\n${lines.join("\n")}`);
    }
  );

  // ── 8. get_clippings ─────────────────────────────────────────────────────
  server.tool(
    "get_clippings",
    "Read the user's saved clippings from Logos (excerpt text from resources the user clipped). Returns clipping titles, excerpt content, source resource, collection, tags, and notes.",
    {
      resource_id: z.string().optional().describe("Filter by resource ID"),
      tag: z.string().optional().describe("Filter by clipping tag text (partial match)"),
      limit: z.number().optional().describe("Max clippings to return (default: 20)"),
    },
    async ({ resource_id, tag, limit }) => {
      const clippings = getClippings({
        resourceId: resource_id,
        tag,
        limit: limit ?? 20,
      });

      if (clippings.length === 0) {
        const filter = resource_id ? `resource '${resource_id}'` : tag ? `tag '${tag}'` : null;
        return text(filter
          ? `No clippings matched ${filter}. Try removing the filters to see all clippings.`
          : "No clippings matched this query.");
      }

      const lines = clippings.map((c) => {
        const heading = c.title ? `**${c.title}**` : `**${c.resourceId}**`;
        const content = c.content ?? "(no content)";
        const source = `Source: ${c.resourceId}${c.collectionTitle ? ` | Collection: ${c.collectionTitle}` : ""}`;
        const tags = c.tags ? `Tags: ${c.tags}` : null;
        const notes = c.notes ? `Notes: ${c.notes}` : null;
        return [heading, content, source, tags, notes].filter(Boolean).join("\n");
      });

      return text(`Found ${clippings.length} clippings:\n\n${lines.join("\n\n---\n\n")}`);
    }
  );

  // ── 9. get_favorites ─────────────────────────────────────────────────────
  server.tool(
    "get_favorites",
    "List the user's saved favorites/bookmarks in Logos Bible Software. Returns each favorite's title and the command it runs.",
    {
      limit: z.number().optional().describe("Max favorites to return (default: 30)"),
    },
    async ({ limit }) => {
      const favorites = getFavorites(limit ?? 30);
      if (favorites.length === 0) return text("No favorites matched this query.");
      const lines = favorites.map((f) => `- **${f.title}** → ${f.appCommand}`);
      return text(`Found ${favorites.length} favorites:\n\n${lines.join("\n")}`);
    }
  );

  // ── 10. get_reading_progress ─────────────────────────────────────────────
  server.tool(
    "get_reading_progress",
    "Show the user's reading plan progress from Logos Bible Software. Displays reading lists, completion percentages, status, and recent items.",
    {},
    async () => {
      const progress = getReadingProgress();
      const sections: string[] = [];
      sections.push(`**Overall**: ${progress.completedItems}/${progress.totalItems} items (${progress.percentComplete}%)`);
      if (progress.statuses.length > 0) {
        const statusLines = progress.statuses.map((s) => `- **${s.title}** by ${s.author} — ${s.statusLabel}`);
        sections.push(`## Reading Plans\n\n${statusLines.join("\n")}`);
      }
      if (progress.items.length > 0) {
        const MAX_ITEMS = 20;
        const shown = progress.items.slice(0, MAX_ITEMS);
        const itemLines = shown.map((i) => `- ${i.isRead ? "[read]" : "[unread]"} ${i.readingListPath}`);
        const extra = progress.items.length > MAX_ITEMS ? `\n+${progress.items.length - MAX_ITEMS} more` : "";
        sections.push(`## Items\n\n${itemLines.join("\n")}${extra}`);
      }
      return text(sections.join("\n\n"));
    }
  );

  // ── 11. open_word_study ──────────────────────────────────────────────────
  server.tool(
    "open_word_study",
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. Open a word study in Logos for a Greek, Hebrew, or English word. Use to study a word in its original-language resources, or to position Logos before capture_panel_screenshot.",
    { word: z.string().describe("The word to study (e.g., 'agape', 'hesed', 'justification')") },
    async ({ word }) => {
      if (!(await isLogosRunning())) {
        return text("Logos is not running. Ask the user to launch Logos first, or use get_bible_text / search_bible, which work without the app.");
      }
      const result = await openWordStudy(word);
      return result.success
        ? text(`Dispatched to Logos: word study for "${word}". This only opens the Logos UI on the user's screen — no data is returned to you. Call get_logos_state to confirm what Logos is showing, or capture_panel_screenshot (panel_type: 'wordstudy') to see the results.`)
        : err(`Failed to open word study: ${result.error}`);
    }
  );

  // ── 12. open_factbook ────────────────────────────────────────────────────
  server.tool(
    "open_factbook",
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. Open the Logos Factbook for a person, place, event, or topic (e.g., 'Moses', 'Jerusalem', 'Passover'). Use to look up background information, or to position Logos before capture_panel_screenshot.",
    { topic: z.string().describe("The topic to look up (e.g., 'Moses', 'Jerusalem', 'Passover')") },
    async ({ topic }) => {
      if (!(await isLogosRunning())) {
        return text("Logos is not running. Ask the user to launch Logos first, or use get_bible_text / search_bible, which work without the app.");
      }
      const result = await openFactbook(topic);
      return result.success
        ? text(`Dispatched to Logos: Factbook entry for "${topic}". This only opens the Logos UI on the user's screen — no data is returned to you. Call get_logos_state to confirm what Logos is showing, or capture_panel_screenshot (panel_type: 'factbook') to see the results.`)
        : err(`Failed to open Factbook: ${result.error}`);
    }
  );

  // ── 13. get_study_workflows ──────────────────────────────────────────────
  server.tool(
    "get_study_workflows",
    "List available study workflow templates and active workflow instances from Logos Bible Software. Workflows provide structured, step-by-step study approaches like 'Inductive Bible Study', 'Lectio Divina', etc. Returns template titles and instance progress.",
    {
      include_instances: z.boolean().optional().describe("Also show active workflow instances (default: true)"),
      instance_limit: z.number().optional().describe("Max active instances to return (default: 10)"),
    },
    async ({ include_instances, instance_limit }) => {
      const templates = getWorkflowTemplates();
      const sections: string[] = [];
      if (templates.length > 0) {
        const tLines = templates.map((t) => `- **${t.title}** (${t.externalId})`);
        sections.push(`## Workflow Templates\n\n${tLines.join("\n")}`);
      } else {
        sections.push("No workflow templates found.");
      }
      if (include_instances !== false) {
        const instances = getWorkflowInstances(instance_limit ?? 10);
        if (instances.length > 0) {
          // The instance key is a raw Logos anchor ("bible.70.1.4-70.1.14").
          // Decode it to a canonical reference. Titles usually carry the
          // passage too, but they are free text and may not; the key always
          // has it. Non-bible keys (topic studies, e.g. "bk.%goodnessOfGod")
          // do not decode and stay raw.
          const iLines = instances.map((i) => {
            const status = i.completedDate ? "Completed" : `Step: ${i.currentStep ?? "unknown"}`;
            const subject = bibleRawToHuman(i.key) ?? i.key;
            return `- **${i.title}** — ${subject} · ${status}, ${i.completedSteps.length} steps done`;
          });
          sections.push(`## Active Instances\n\n${iLines.join("\n")}`);
        }
      }
      return text(sections.join("\n\n"));
    }
  );

  // ── 14. get_library_catalog ──────────────────────────────────────────────
  server.tool(
    "get_library_catalog",
    "Search the user's Logos library catalog for owned resources by type, author, or keyword. Returns matching resources with title, author, resource ID, and type. Useful for finding resources to open with open_resource.",
    {
      type: z.string().optional().describe("Filter by resource type — accepts a human label (e.g., 'commentary') or a raw dotted type (e.g., 'text.monograph.commentary.bible')"),
      query: z.string().optional().describe("Search titles, descriptions, and subjects"),
      author: z.string().optional().describe("Filter by author name"),
      limit: z.number().optional().describe("Max results to return (default: 25)"),
    },
    async ({ type, query, author, limit }) => {
      try {
        const resources = searchCatalog({ type, query, author, limit: limit ?? 25 });
        if (resources.length === 0) {
          if (type) {
            return text(`No resources matched type '${type}'. The type filter accepts either a human label from get_resource_types (e.g. 'Commentary') or a raw dotted type (e.g. 'text.monograph.commentary.bible'). Call get_resource_types to see valid labels, or remove the filter.`);
          }
          return text("No matches for this query.");
        }
        const lines = resources.map((r) => {
          const authorStr = r.authors ? ` — ${r.authors}` : "";
          const label = typeLabel(r.type);
          return `- **${r.title}**${authorStr}\n  ID: \`${r.resourceId}\` | Type: ${label}`;
        });
        return text(`Found ${resources.length} resources:\n\n${lines.join("\n\n")}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(`Library catalog error: ${msg}`);
      }
    }
  );

  // ── 15. open_resource ─────────────────────────────────────────────────────
  server.tool(
    "open_resource",
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. Open a specific resource (commentary, lexicon, etc.) in Logos, optionally at a Bible passage. Use to show the user a resource, or to position Logos before capture_panel_screenshot.",
    {
      resource_id: z.string().describe("Resource ID from the library catalog (e.g., 'LLS:CLVNCOMM')"),
      reference: z.string().optional().describe("Bible reference to navigate to within the resource (e.g., 'Romans 12:1')"),
    },
    async ({ resource_id, reference }) => {
      if (!(await isLogosRunning())) {
        return text("Logos is not running. Ask the user to launch Logos first, or use get_bible_text / search_bible, which work without the app.");
      }
      const result = await openResource(resource_id, reference);
      const refStr = reference ? ` at ${reference}` : "";
      return result.success
        ? text(`Dispatched to Logos: resource \`${resource_id}\`${refStr}. This only opens the Logos UI on the user's screen — no data is returned to you. Call get_logos_state to confirm what Logos is showing, or capture_panel_screenshot (panel_type: 'resource') to see the results.`)
        : err(`Failed to open resource: ${result.error}`);
    }
  );

  // ── 16. open_guide ────────────────────────────────────────────────────────
  server.tool(
    "open_guide",
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. Open an Exegetical Guide, Passage Guide, or other guide type in Logos for a Bible passage. Use to run a guide on a passage, or to position Logos before capture_panel_screenshot.",
    {
      guide_type: z.string().describe("Guide template name (e.g., 'Exegetical Guide', 'Passage Guide')"),
      reference: z.string().describe("Bible reference (e.g., 'Romans 12:1', 'John 3:16')"),
    },
    async ({ guide_type, reference }) => {
      if (!(await isLogosRunning())) {
        return text("Logos is not running. Ask the user to launch Logos first, or use get_bible_text / search_bible, which work without the app.");
      }
      const result = await openGuide(guide_type, reference);
      return result.success
        ? text(`Dispatched to Logos: ${guide_type} for ${reference}. This only opens the Logos UI on the user's screen — no data is returned to you.${result.warning ? ` Note: ${result.warning}` : ""} Call get_logos_state to confirm what Logos is showing, or capture_panel_screenshot (panel_type: 'guide') to see the results.`)
        : err(`Failed to open guide: ${result.error}`);
    }
  );

  // ── 17. search_all ────────────────────────────────────────────────────────
  server.tool(
    "search_all",
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. Search across ALL resources in the Logos library (not just Bible text). Use for broad research, or to position Logos before capture_panel_screenshot.",
    {
      query: z.string().describe("Search query (e.g., 'justification by faith', 'baptism')"),
    },
    async ({ query }) => {
      if (!(await isLogosRunning())) {
        return text("Logos is not running. Ask the user to launch Logos first, or use get_bible_text / search_bible, which work without the app.");
      }
      const result = await searchAll(query);
      return result.success
        ? text(`Dispatched to Logos: search for "${query}" across all resources. This only opens the Logos UI on the user's screen — no data is returned to you. Call get_logos_state to confirm what Logos is showing, or capture_panel_screenshot (panel_type: 'searchall') to see the results.`)
        : err(`Failed to open search: ${result.error}`);
    }
  );

  // ── 18. get_logos_state ───────────────────────────────────────────────────
  server.tool(
    "get_logos_state",
    "Check what Logos Bible Software is currently showing: whether the app is running and the titles of its open windows. Returns text. Use after navigate/open tools to confirm navigation happened, or before them to check Logos is ready. Cheap and fast — prefer this over capture_panel_screenshot when window titles are enough.",
    {},
    async () => {
      const running = await isLogosRunning();
      if (!running) return text("Logos is not running.");
      const titles = await getLogosWindowTitles();
      const lines = titles.length > 0 ? titles.map((t) => `- ${t}`) : ["- (no named windows found)"];
      return text(`Logos is running. Window titles:\n${lines.join("\n")}`);
    }
  );

  // ── 19. scan_references ───────────────────────────────────────────────────
  server.tool(
    "scan_references",
    "Find Bible references in arbitrary text (e.g., extract all references from a paragraph). Returns the list of references found. Useful for turning free-form text into structured Bible references.",
    {
      text: z.string().describe("Text to scan for Bible references"),
      tag_chapters: z.boolean().optional().describe("Tag chapter-level references too (default: true)"),
    },
    async ({ text: inputText, tag_chapters }) => {
      try {
        const results = await scanReferences(inputText, tag_chapters ?? true);
        if (results.length === 0) return text("No Bible references found in the text.");
        const lines = results.map((r) => `- **${r.passage}**`);
        return text(`Found ${results.length} Bible references:\n\n${lines.join("\n")}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const note = msg.includes("BIBLIA_API_KEY")
          ? "\n\nNote: only the Biblia-backed Bible-text tools need this key — the Logos library, notes, highlights, navigation, and screenshot tools all still work."
          : "";
        return err(`${msg}${note}`);
      }
    }
  );

  // ── 20. compare_passages ──────────────────────────────────────────────────
  server.tool(
    "compare_passages",
    "Compare two Bible references for overlap, subset, ordering. Returns the relationships detected (equal, intersects, subset, superset, before, after). Useful for checking whether one passage contains another.",
    {
      first: z.string().describe("First Bible reference (e.g., 'Romans 8:28-30')"),
      second: z.string().describe("Second Bible reference (e.g., 'Romans 8:29')"),
    },
    async ({ first, second }) => {
      try {
        const result = await comparePassages(first, second);
        const relations: string[] = [];
        if (result.equal) relations.push("equal");
        if (result.intersects) relations.push("intersects");
        if (result.subset) relations.push("first is subset of second");
        if (result.superset) relations.push("first is superset of second");
        if (result.before) relations.push("first comes before second");
        if (result.after) relations.push("first comes after second");
        return text(`**${first}** vs **${second}**:\n${relations.join(", ") || "no relationship detected"}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const note = msg.includes("BIBLIA_API_KEY")
          ? "\n\nNote: only the Biblia-backed Bible-text tools need this key — the Logos library, notes, highlights, navigation, and screenshot tools all still work."
          : "";
        return err(`${msg}${note}`);
      }
    }
  );

  // ── 21. get_available_bibles ──────────────────────────────────────────────
  server.tool(
    "get_available_bibles",
    "List all Bible versions available for text retrieval via the Biblia API. Returns each version's code, title, and languages. Useful for picking a bible value for get_bible_text.",
    {
      query: z.string().optional().describe("Optional search query to filter Bible versions"),
    },
    async ({ query }) => {
      try {
        const bibles = await getAvailableBibles(query);
        if (bibles.length === 0) return text("No Bible versions found.");
        const lines = bibles.map((b) => {
          const langs = b.languages?.length ? ` [${b.languages.join(", ")}]` : "";
          return `- **${b.title}** (\`${b.bible}\`)${langs}`;
        });
        return text(`Found ${bibles.length} Bible versions:\n\n${lines.join("\n")}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const note = msg.includes("BIBLIA_API_KEY")
          ? "\n\nNote: only the Biblia-backed Bible-text tools need this key — the Logos library, notes, highlights, navigation, and screenshot tools all still work."
          : "";
        return err(`${msg}${note}`);
      }
    }
  );

  // ── 22. get_resource_types ────────────────────────────────────────────────
  server.tool(
    "get_resource_types",
    "Get a summary of resource types and counts in the user's Logos library. Returns each type's label and count. Useful for choosing a type filter for get_library_catalog.",
    {},
    async () => {
      try {
        const summary = getResourceTypeSummary();
        if (summary.length === 0) return text("No resources found in library catalog.");
        const total = summary.reduce((sum, s) => sum + s.count, 0);
        const lines = summary.map((s) => `- **${s.label}**: ${s.count}`);
        return text(`Library contains ${total} resources across ${summary.length} types:\n\n${lines.join("\n")}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(`Library catalog error: ${msg}`);
      }
    }
  );

  // ── 23. capture_panel_screenshot ──────────────────────────────────────────
  server.tool(
    "capture_panel_screenshot",
    "Navigate Logos to a passage/resource and capture a screenshot of the window. Returns the screenshot as an image for the LLM to read with vision. Useful for reading Bible text, commentaries, and other content that is only available in the Logos UI.",
    {
      panel_type: z.enum(["bible", "factbook", "wordstudy", "guide", "search", "searchall", "resource"])
        .describe("Type of Logos panel to capture"),
      reference: z.string().optional()
        .describe("Bible reference, topic, word, or search query depending on panel_type"),
      guide_type: z.string().optional()
        .describe("Guide template name (required when panel_type is 'guide', e.g., 'Exegetical Guide')"),
      resource_id: z.string().optional()
        .describe("Resource ID from the library catalog (required when panel_type is 'resource')"),
      wait_ms: z.number().optional()
        .describe("Milliseconds to wait for content to render (default: 4000, max: 15000)"),
      max_width: z.number().int().optional()
        .describe("Max image width in px before base64 encoding (default 1400). Lower = fewer tokens."),
    },
    async ({ panel_type, reference, guide_type, resource_id, wait_ms, max_width }) => {
      const result = await captureLogosPanel(panel_type as CaptureToolType, {
        reference,
        guideType: guide_type,
        resourceId: resource_id,
        waitMs: wait_ms,
        maxWidth: max_width,
      });

      if (!result.success || !result.imageBase64) {
        return err(result.error ?? "Screenshot capture failed");
      }

      const desc = result.description ?? `Logos ${panel_type} screenshot`;
      const boundsInfo = result.bounds
        ? ` (${result.bounds.width}x${result.bounds.height})`
        : "";
      return image(result.imageBase64, `${desc}${boundsInfo}`);
    }
  );

  // ── 24. diagnose ──────────────────────────────────────────────────────────
  server.tool(
    "diagnose",
    "Check the server's own environment: Logos data paths, database availability, and Biblia API configuration. Returns a diagnostic report. Use when other tools fail with missing-database or missing-key errors to pinpoint the setup problem.",
    {},
    async () => {
      const lines: string[] = [];
      lines.push("## Logos MCP Environment Diagnostics\n");

      lines.push(`**LOGOS_DATA_DIR**: \`${LOGOS_DATA_DIR}\``);
      lines.push(`  ${existsSync(LOGOS_DATA_DIR) ? "OK" : "MISSING"}\n`);

      lines.push(`**LOGOS_CATALOG_DIR**: \`${LOGOS_CATALOG_DIR}\``);
      lines.push(`  ${existsSync(LOGOS_CATALOG_DIR) ? "OK" : "MISSING"}\n`);

      lines.push("### Databases\n");
      for (const [name, path] of Object.entries(DB_PATHS)) {
        const found = existsSync(path);
        const icon = found ? "OK" : "MISSING";
        lines.push(`- **${name}**: ${icon}  \`${path}\``);
      }

      // existsSync alone can't catch an unloadable SQLite driver (e.g. a
      // better-sqlite3 ABI mismatch after a Node upgrade) — actually open one.
      lines.push("");
      lines.push("### SQLite engine\n");
      const openable = Object.values(DB_PATHS).find((p) => existsSync(p));
      if (openable) {
        try {
          const db = new Database(openable, { readonly: true, fileMustExist: true });
          db.prepare("SELECT 1").get();
          db.close();
          lines.push("Opened a database successfully: OK");
        } catch (e) {
          const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
          lines.push(`Cannot open databases: ${msg}`);
          lines.push("(If this mentions ABI/NODE_MODULE_VERSION, run: npm rebuild better-sqlite3)");
        }
      } else {
        lines.push("Skipped (no database files found).");
      }

      lines.push("");
      lines.push(`### API Configuration\n`);
      lines.push(`**BIBLIA_API_KEY**: ${BIBLIA_API_KEY ? "set" : "NOT SET"}`);

      return text(lines.join("\n"));
    }
  );

  // ── Start server ─────────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
