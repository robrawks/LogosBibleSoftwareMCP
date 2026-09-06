#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync } from "fs";
import Database from "better-sqlite3";
import { SERVER_NAME, SERVER_VERSION, LOGOS_DATA_DIR, LOGOS_CATALOG_DIR, DB_PATHS, BIBLIA_API_KEY, DEFAULT_BIBLE } from "./config.js";

// Service imports
import { getBibleText, searchBible, scanReferences, comparePassages, getAvailableBibles } from "./services/biblia-api.js";
import { navigateToPassage, openWordStudy, openFactbook, openResource, openGuide, searchAll, isLogosRunning } from "./services/logos-app.js";
import { expandRange, parseReference } from "./services/reference-parser.js";
import {
  getUserHighlights,
  getClippings,
  getFavorites,
  getWorkflowTemplates,
  getWorkflowInstances,
  getReadingProgress,
  getUserNotes,
} from "./services/sqlite-reader.js";
import { searchCatalog, getResourceTypeSummary, typeLabel } from "./services/catalog-reader.js";
import { captureLogosPanel, getLogosWindowTitles } from "./services/screenshot-capture.js";
import { readPanelText, readPanelTextUnlocked, type PanelSelector } from "./services/panel-text.js";
import { withUiLock } from "./utils/ui-lock.js";
import { getSermons, getSermon, getReadingPlans, getPassageLists } from "./services/documents-reader.js";
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
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. To READ what it opens, follow with read_panel_text (text) or capture_panel_screenshot (image). Open a Bible passage in the Logos Bible Software UI. Provide a reference like 'Genesis 1:1' or 'Romans 8:28-30'. Use to show the user a passage in Logos, or to position the app before capture_panel_screenshot.",
    { reference: z.string().describe("Bible reference (e.g., 'Genesis 1:1', 'Romans 8:28-30')") },
    async ({ reference }) => {
      if (!(await isLogosRunning())) {
        return text("Logos is not running. Ask the user to launch Logos first, or use get_bible_text / search_bible, which work without the app.");
      }
      const result = await withUiLock(() => navigateToPassage(reference));
      return result.success
        ? text(`Dispatched to Logos: Bible passage ${reference}. This only opens the Logos UI on the user's screen — no data is returned to you. Call get_logos_state to confirm what Logos is showing, or read_panel_text to get the passage text from the user's own Bible (e.g. LBLA).`)
        : err(`Failed to open passage: ${result.error}`);
    }
  );

  // ── 2. get_bible_text ────────────────────────────────────────────────────
  server.tool(
    "get_bible_text",
    `Retrieve the text of a Bible passage. Default version: ${DEFAULT_BIBLE} (set LOGOS_DEFAULT_BIBLE to change). Provide a reference like 'Genesis 1:1-5', 'Romans 8:28-30' or 'Romanos 8:28-30' (English and Spanish book names accepted). Returns the passage text with its version. Useful for reading Scripture directly when the Logos app isn't running or when plain text is enough.`,
    {
      passage: z.string().describe("Bible reference (e.g., 'Genesis 1:1-5', 'John 3:16')"),
      bible: z.string().optional()
        .describe(`Bible version code, case-insensitive (default ${DEFAULT_BIBLE}; also RVR60, RVA, LEB, KJV, ASV and more). Served by the free Biblia web API (requires network + BIBLIA_API_KEY), NOT the user's Logos library. Call get_available_bibles for the full list.`),
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
        .describe(`Bible version code, case-insensitive (default ${DEFAULT_BIBLE}; also RVR60, RVA, LEB, KJV, ASV and more). Served by the free Biblia web API (requires network + BIBLIA_API_KEY), NOT the user's Logos library. Call get_available_bibles for the full list.`),
    },
    async ({ passage, context_verses, bible }) => {
      try {
        const expanded = expandRange(passage, context_verses ?? 5);
        const result = await getBibleText(expanded, bible);
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
    "Search the Bible for a word, phrase, or topic. Returns matching verses with previews. Useful for topical studies and finding related passages.",
    {
      query: z.string().describe("Search terms (e.g., 'justification by faith')"),
      limit: z.number().optional().describe("Max results (default: 20)"),
      bible: z.string().optional()
        .describe(`Bible version code, case-insensitive (default ${DEFAULT_BIBLE}; also RVR60, RVA, LEB, KJV, ASV and more). Served by the free Biblia web API (requires network + BIBLIA_API_KEY), NOT the user's Logos library. Call get_available_bibles for the full list.`),
    },
    async ({ query, limit, bible }) => {
      try {
        const result = await searchBible(query, { limit, bible });
        if (result.resultCount === 0) return text(`No results for "${query}".`);
        const lines = result.results.map((r) => `**${r.title}**: ${r.preview}`);
        return text(`Found ${result.resultCount} results for "${query}":\n\n${lines.join("\n\n")}`);
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
        return text("No notes found — the Logos notes database appears empty.");
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
    "Read the user's highlights and visual markup from Logos Bible Software. Shows which passages have been highlighted and with what styles. Returns the highlight style and the resource title it lives in.",
    {
      resource_id: z.string().optional().describe("Filter by resource ID"),
      style_name: z.string().optional().describe("Filter by highlight style name"),
      limit: z.number().optional().describe("Max highlights to return (default: 50)"),
    },
    async ({ resource_id, style_name, limit }) => {
      const highlights = getUserHighlights({
        resourceId: resource_id,
        styleName: style_name,
        limit: limit ?? 50,
      });
      if (highlights.length === 0) {
        const filter = resource_id ? `resource '${resource_id}'` : style_name ? `style '${style_name}'` : null;
        return text(filter
          ? `No highlights matched ${filter}. Try removing the filters to see all highlights.`
          : "No highlights found — the Logos highlights database appears empty.");
      }
      const lines = highlights.map((h) => `- **${h.styleName}**: ${h.resourceTitle ?? h.resourceId}`);
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
          : "No clippings found — the Logos clippings database appears empty.");
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
      if (favorites.length === 0) return text("No favorites found — the Logos favorites database appears empty.");
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
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. To READ what it opens, follow with read_panel_text (text) or capture_panel_screenshot (image). Open a word study in Logos for a Greek, Hebrew, or English word. Use to study a word in its original-language resources, or to position Logos before capture_panel_screenshot.",
    { word: z.string().describe("The word to study (e.g., 'agape', 'hesed', 'justification')") },
    async ({ word }) => {
      if (!(await isLogosRunning())) {
        return text("Logos is not running. Ask the user to launch Logos first, or use get_bible_text / search_bible, which work without the app.");
      }
      const result = await withUiLock(() => openWordStudy(word));
      return result.success
        ? text(`Dispatched to Logos: word study for "${word}". This only opens the Logos UI on the user's screen — no data is returned to you. Call get_logos_state to confirm what Logos is showing, or read_panel_text to get the word study as text.`)
        : err(`Failed to open word study: ${result.error}`);
    }
  );

  // ── 12. open_factbook ────────────────────────────────────────────────────
  server.tool(
    "open_factbook",
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. To READ what it opens, follow with read_panel_text (text) or capture_panel_screenshot (image). Open the Logos Factbook for a person, place, event, or topic (e.g., 'Moses', 'Jerusalem', 'Passover'). Use to look up background information, or to position Logos before capture_panel_screenshot.",
    { topic: z.string().describe("The topic to look up (e.g., 'Moses', 'Jerusalem', 'Passover')") },
    async ({ topic }) => {
      if (!(await isLogosRunning())) {
        return text("Logos is not running. Ask the user to launch Logos first, or use get_bible_text / search_bible, which work without the app.");
      }
      const result = await withUiLock(() => openFactbook(topic));
      return result.success
        ? text(`Dispatched to Logos: Factbook entry for "${topic}". This only opens the Logos UI on the user's screen — no data is returned to you. Call get_logos_state to confirm what Logos is showing, or read_panel_text to get the Factbook entry as text.`)
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
          const iLines = instances.map((i) => {
            const status = i.completedDate ? "Completed" : `Step: ${i.currentStep ?? "unknown"}`;
            return `- **${i.title}** (${i.key}) — ${status}, ${i.completedSteps.length} steps done`;
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
    "Search the user's Logos library catalog by type, author, keyword or language. By default returns only LICENSED resources (the catalog also lists titles merely available for purchase; pass licensed_only=false to include them — they are flagged 'sin licencia'). Returns title, author, resource ID, type, languages and license status. Useful for finding resources to open with open_resource.",
    {
      type: z.string().optional().describe("Filter by resource type — accepts a human label (e.g., 'commentary') or a raw dotted type (e.g., 'text.monograph.commentary.bible')"),
      query: z.string().optional().describe("Search titles, descriptions, and subjects"),
      author: z.string().optional().describe("Filter by author name"),
      language: z.string().optional().describe("ISO language code, e.g. 'es' (Spanish), 'en', 'grc' (Greek), 'he' (Hebrew)"),
      licensed_only: z.boolean().optional().describe("Only resources the user actually owns (default: true). Set false to also see catalog entries not licensed."),
      limit: z.number().optional().describe("Max results to return (default: 25)"),
    },
    async ({ type, query, author, language, licensed_only, limit }) => {
      try {
        const resources = searchCatalog({ type, query, author, language, licensedOnly: licensed_only ?? true, limit: limit ?? 25 });
        if (resources.length === 0) {
          if (type) {
            return text(`No resources matched type '${type}'. The type filter accepts either a human label from get_resource_types (e.g. 'Commentary') or a raw dotted type (e.g. 'text.monograph.commentary.bible'). Call get_resource_types to see valid labels, or remove the filter.`);
          }
          return text("No matching resources found in library catalog — the catalog appears empty.");
        }
        const lines = resources.map((r) => {
          const authorStr = r.authors ? ` — ${r.authors}` : "";
          const label = typeLabel(r.type);
          const lang = r.languages ? ` | Lang: ${r.languages}` : "";
          const lic = r.licensed ? "" : " | ⚠️ sin licencia (not owned)";
          const pub = [r.publishers, r.publicationDate].filter(Boolean).join(", ");
          const pubStr = pub ? ` | ${pub}` : "";
          return `- **${r.title}**${authorStr}\n  ID: \`${r.resourceId}\` | Type: ${label}${lang}${pubStr}${lic}`;
        });
        const scope = licensed_only === false ? "catalog entries (licensed and not)" : "licensed resources";
        return text(`Found ${resources.length} ${scope}:\n\n${lines.join("\n\n")}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(`Library catalog error: ${msg}`);
      }
    }
  );

  // ── 15. open_resource ─────────────────────────────────────────────────────
  server.tool(
    "open_resource",
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. To READ what it opens, follow with read_panel_text (text) or capture_panel_screenshot (image). Open a specific resource (commentary, lexicon, etc.) in Logos, optionally at a Bible passage. Use to show the user a resource, or to position Logos before capture_panel_screenshot.",
    {
      resource_id: z.string().describe("Resource ID from the library catalog (e.g., 'LLS:CLVNCOMM')"),
      reference: z.string().optional().describe("Bible reference to navigate to within the resource (e.g., 'Romans 12:1')"),
    },
    async ({ resource_id, reference }) => {
      if (!(await isLogosRunning())) {
        return text("Logos is not running. Ask the user to launch Logos first, or use get_bible_text / search_bible, which work without the app.");
      }
      const result = await withUiLock(() => openResource(resource_id, reference));
      const refStr = reference ? ` at ${reference}` : "";
      return result.success
        ? text(`Dispatched to Logos: resource \`${resource_id}\`${refStr}. This only opens the Logos UI on the user's screen — no data is returned to you. Call get_logos_state to confirm what Logos is showing, or read_panel_text to get its text (or read_resource_at to open and read in one step).`)
        : err(`Failed to open resource: ${result.error}`);
    }
  );

  // ── 16. open_guide ────────────────────────────────────────────────────────
  server.tool(
    "open_guide",
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. To READ what it opens, follow with read_panel_text (text) or capture_panel_screenshot (image). Open an Exegetical Guide, Passage Guide, or other guide type in Logos for a Bible passage. Use to run a guide on a passage, or to position Logos before capture_panel_screenshot.",
    {
      guide_type: z.string().describe("Guide template name (e.g., 'Exegetical Guide', 'Passage Guide')"),
      reference: z.string().describe("Bible reference (e.g., 'Romans 12:1', 'John 3:16')"),
    },
    async ({ guide_type, reference }) => {
      if (!(await isLogosRunning())) {
        return text("Logos is not running. Ask the user to launch Logos first, or use get_bible_text / search_bible, which work without the app.");
      }
      const result = await withUiLock(() => openGuide(guide_type, reference));
      return result.success
        ? text(`Dispatched to Logos: ${guide_type} for ${reference}. This only opens the Logos UI on the user's screen — no data is returned to you. Call get_logos_state to confirm what Logos is showing, or read_panel_text to get the guide contents as text.`)
        : err(`Failed to open guide: ${result.error}`);
    }
  );

  // ── 17. search_all ────────────────────────────────────────────────────────
  server.tool(
    "search_all",
    "SIDE EFFECT ONLY — opens the Logos UI on screen; returns no data. To READ what it opens, follow with read_panel_text (text) or capture_panel_screenshot (image). Search across ALL resources in the Logos library (not just Bible text). Use for broad research, or to position Logos before capture_panel_screenshot.",
    {
      query: z.string().describe("Search query (e.g., 'justification by faith', 'baptism')"),
    },
    async ({ query }) => {
      if (!(await isLogosRunning())) {
        return text("Logos is not running. Ask the user to launch Logos first, or use get_bible_text / search_bible, which work without the app.");
      }
      const result = await withUiLock(() => searchAll(query));
      return result.success
        ? text(`Dispatched to Logos: search for "${query}" across all resources. This only opens the Logos UI on the user's screen — no data is returned to you. Call get_logos_state to confirm what Logos is showing, or read_panel_text to get the result list as text.`)
        : err(`Failed to open search: ${result.error}`);
    }
  );

  // ── 25. read_panel_text ───────────────────────────────────────────────────
  server.tool(
    "read_panel_text",
    "Read the TEXT of the resource panel currently open in Logos (commentary, lexicon, book, Bible). Works by drag-selecting the visible text, copying it and returning the clipboard, plus the citation Logos attaches (title, editor, publisher, year, pages). Returns real text, not an image — prefer this over capture_panel_screenshot when you need to quote or analyze content. Typical flow: open_resource (or navigate_passage) → read_panel_text. Use `pages` to scroll and read several screens in one call. macOS only; moves the mouse and takes focus for a few seconds; the Logos window must not be covered by other windows.",
    {
      pages: z.number().int().min(1).max(20).optional().describe("How many screens to read, pressing Page Down between them (default: 1)"),
      wait_ms: z.number().int().min(0).max(15000).optional().describe("Milliseconds to wait before reading, e.g. after open_resource (default: 0)"),
      panel: z.union([z.enum(["left", "right", "largest"]), z.number().int().min(1)]).optional().describe("Which panel to read when several are open side by side: 'left', 'right', 'largest' (default) or a 1-based index from the left"),
    },
    async ({ pages, wait_ms, panel }) => {
      if (!(await isLogosRunning())) return err("Logos is not running. Launch Logos first.");
      try {
        if (wait_ms) await new Promise((r) => setTimeout(r, wait_ms));
        const result = await readPanelText(pages ?? 1, panel ?? "largest");
        const cite = Object.entries(result.citation).map(([k, v]) => `${k}: ${v}`).join(" · ");
        const short = result.pages < result.requestedPages ? ` (requested ${result.requestedPages}; the rest came back empty)` : "";
        const header = `Read ${result.pages} screen(s)${short} from Logos window "${result.window}"${cite ? `\nCitation — ${cite}` : ""}\n\n`;
        return text(header + result.text);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    }
  );

  // ── 26. get_sermons ───────────────────────────────────────────────────────
  server.tool(
    "get_sermons",
    "List the user's own sermons from the Logos Sermon Builder (title, series, preaching occasions with date/venue, tags, audience). Optional full-text search across titles and sermon bodies. Use to find what the user has already preached on a passage or theme, then get_sermon for the full text.",
    {
      query: z.string().optional().describe("Text to find in title, series, description or sermon body (e.g. 'Samuel', 'gracia')"),
      series: z.string().optional().describe("Filter by series name (partial match)"),
      limit: z.number().optional().describe("Max sermons to return (default: 30)"),
    },
    async ({ query, series, limit }) => {
      try {
        const sermons = getSermons({ query, series, limit: limit ?? 30 });
        if (sermons.length === 0) return text(query || series ? "No sermons matched the filters." : "No sermons found in the Logos Sermon Builder database.");
        const lines = sermons.map((s) => {
          const occ = s.occasions.map((o) => [o.date, o.venue, o.service].filter(Boolean).join(" · ")).filter(Boolean);
          const meta = [
            s.series ? `Series: ${s.series}${s.seriesNumber ? ` #${s.seriesNumber}` : ""}` : null,
            occ.length ? `Preached: ${occ.join(" | ")}` : null,
            s.tags.length ? `Tags: ${s.tags.join(", ")}` : null,
            s.audience.length ? `Audience: ${s.audience.join(", ")}` : null,
            `Blocks: ${s.blockCount} · Modified: ${s.modifiedDate.slice(0, 10)}`,
          ].filter(Boolean);
          return `- **${s.title}** (id ${s.id})\n  ${meta.join("\n  ")}`;
        });
        return text(`Found ${sermons.length} sermons:\n\n${lines.join("\n\n")}`);
      } catch (e) {
        return err(`Sermon database error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // ── 27. get_sermon ────────────────────────────────────────────────────────
  server.tool(
    "get_sermon",
    "Read one of the user's sermons from the Logos Sermon Builder as Markdown, preserving the outline (headings, bullets, quoted passages with references, illustrations). Select by id (from get_sermons) or by title.",
    {
      id: z.number().int().optional().describe("Sermon id from get_sermons"),
      title: z.string().optional().describe("Sermon title (exact, or partial match as fallback)"),
    },
    async ({ id, title }) => {
      if (id === undefined && !title) return err("Provide either id or title.");
      try {
        const sermon = getSermon({ id, title });
        if (!sermon) return text(`No sermon found for ${id !== undefined ? `id ${id}` : `title "${title}"`}.`);
        const occ = sermon.occasions.map((o) => [o.date, o.venue, o.service].filter(Boolean).join(" · ")).filter(Boolean);
        const header = [
          `# ${sermon.title}`,
          sermon.series ? `Series: ${sermon.series}` : null,
          occ.length ? `Preached: ${occ.join(" | ")}` : null,
          sermon.description ? `Description: ${sermon.description}` : null,
          `Modified: ${sermon.modifiedDate.slice(0, 10)} · ${sermon.blocks.length} blocks`,
        ].filter(Boolean).join("\n");
        return text(`${header}\n\n---\n\n${sermon.markdown}`);
      } catch (e) {
        return err(`Sermon database error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // ── 28. get_reading_plans ─────────────────────────────────────────────────
  server.tool(
    "get_reading_plans",
    "List the user's Logos reading plans with progress: resource, schedule, sessions read vs total, and the next unread reading. Use to see what the user is currently reading and how far along they are.",
    {
      include_archived: z.boolean().optional().describe("Include archived plans (default: false)"),
    },
    async ({ include_archived }) => {
      try {
        const plans = getReadingPlans({ includeArchived: include_archived ?? false });
        if (plans.length === 0) return text("No reading plans found.");
        const lines = plans.map((p) => {
          const pct = p.totalSessions ? Math.round((p.readSessions / p.totalSessions) * 100) : 0;
          const meta = [
            p.resourceTitle ?? p.resourceId,
            p.frequency ? `Schedule: ${p.frequency}` : null,
            `Progress: ${p.readSessions}/${p.totalSessions} sessions (${pct}%)${p.firstDate ? ` · ${p.firstDate} → ${p.lastDate}` : ""}`,
            p.nextUnread ? `Next: ${p.nextUnread.date} — ${p.nextUnread.reading || "(see plan)"}` : "Completed",
            p.isArchived ? "Archived" : null,
          ].filter(Boolean);
          return `- **${p.title}**\n  ${meta.join("\n  ")}`;
        });
        return text(`Found ${plans.length} reading plans:\n\n${lines.join("\n\n")}`);
      } catch (e) {
        return err(`Reading plan database error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // ── 29. get_passage_lists ─────────────────────────────────────────────────
  server.tool(
    "get_passage_lists",
    "List the user's Logos passage lists (curated sets of Bible references, e.g. for visitation or memorization). Pass with_items=true to include the references of each list.",
    {
      query: z.string().optional().describe("Filter by list title (partial match)"),
      with_items: z.boolean().optional().describe("Include the Bible references in each list (default: false)"),
      limit: z.number().optional().describe("Max lists to return (default: 30)"),
    },
    async ({ query, with_items, limit }) => {
      try {
        const lists = getPassageLists({ query, withItems: with_items ?? false, limit: limit ?? 30 });
        if (lists.length === 0) return text("No passage lists found.");
        const lines = lists.map((l) => {
          const head = `- **${l.title}** — ${l.itemCount} passages${l.modifiedDate ? ` · ${l.modifiedDate.slice(0, 10)}` : ""}`;
          return l.references.length ? `${head}\n  ${l.references.join("; ")}` : head;
        });
        return text(`Found ${lists.length} passage lists:\n\n${lines.join("\n\n")}`);
      } catch (e) {
        return err(`Passage list database error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );

  // ── 30. read_resource_at ──────────────────────────────────────────────────
  server.tool(
    "read_resource_at",
    "ONE-STEP READ: open a Logos resource (commentary, lexicon, book) at a Bible passage and return its TEXT. Combines open_resource + read_panel_text: dispatches the logosres: link, waits for Logos to render, then drag-selects and copies the panel screen by screen (overlaps removed) and returns the text with the citation Logos attaches. Get resource_id from get_library_catalog. Spanish or English references accepted ('1 Corintios 1:4', 'Romans 8'). macOS only; takes over mouse/keyboard for a few seconds and the Logos window must be visible.",
    {
      resource_id: z.string().describe("Logos resource ID (e.g. 'LLS:CMNTRBBLCDVNTST6')"),
      reference: z.string().optional().describe("Bible reference to open at, e.g. '1 Corintios 1:4-9'"),
      pages: z.number().int().min(1).max(20).optional().describe("Screens to read (default: 3)"),
      panel: z.union([z.enum(["left", "right", "largest"]), z.number().int().min(1)]).optional().describe("Panel to read if several are open (default: 'largest'). Logos opens the resource in its active panel."),
      wait_ms: z.number().int().min(500).max(15000).optional().describe("Wait after opening before reading (default: 2500)"),
    },
    async ({ resource_id, reference, pages, panel, wait_ms }) => {
      if (!(await isLogosRunning())) return err("Logos is not running. Launch Logos first.");
      try {
        // One lock for the whole open → wait → read sequence so no other UI
        // tool can change the panel in between.
        const result = await withUiLock(async () => {
          const opened = await openResource(resource_id, reference);
          if (!opened.success) throw new Error(`Failed to open resource: ${opened.error ?? "unknown error"}`);
          await new Promise((r) => setTimeout(r, wait_ms ?? 2500));
          return readPanelTextUnlocked(pages ?? 3, (panel as PanelSelector | undefined) ?? "largest");
        });
        const cite = Object.entries(result.citation).map(([k, v]) => `${k}: ${v}`).join(" · ");
        const short = result.pages < result.requestedPages ? ` (requested ${result.requestedPages}; the rest came back empty — end of the article or the panel lost focus)` : "";
        const header = `${resource_id}${reference ? ` @ ${reference}` : ""} — ${result.pages} screen(s)${short}${cite ? `\nCitation — ${cite}` : ""}\n\n`;
        return text(header + result.text);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
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
    "Get a summary of resource types and counts in the user's Logos library (licensed resources only by default). Returns each type's label and count. Useful for choosing a type filter for get_library_catalog.",
    {
      language: z.string().optional().describe("Restrict counts to one ISO language code, e.g. 'es'"),
      licensed_only: z.boolean().optional().describe("Count only owned resources (default: true)"),
    },
    async ({ language, licensed_only }) => {
      try {
        const summary = getResourceTypeSummary({ language, licensedOnly: licensed_only ?? true });
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
