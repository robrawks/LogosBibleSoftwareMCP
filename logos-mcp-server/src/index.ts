#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync } from "fs";
import { SERVER_NAME, SERVER_VERSION, LOGOS_DATA_DIR, LOGOS_CATALOG_DIR, DB_PATHS, BIBLIA_API_KEY } from "./config.js";

// Service imports
import { getBibleText, searchBible, scanReferences, comparePassages, getAvailableBibles } from "./services/biblia-api.js";
import { navigateToPassage, openWordStudy, openFactbook, openResource, openGuide, searchAll } from "./services/logos-app.js";
import { expandRange } from "./services/reference-parser.js";
import {
  getUserHighlights,
  getFavorites,
  getWorkflowTemplates,
  getWorkflowInstances,
  getReadingProgress,
  getUserNotes,
} from "./services/sqlite-reader.js";
import { searchCatalog, getResourceTypeSummary, typeLabel } from "./services/catalog-reader.js";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function err(s: string) {
  return { content: [{ type: "text" as const, text: s }], isError: true as const };
}

async function main() {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // ── 1. navigate_passage ──────────────────────────────────────────────────
  server.tool(
    "navigate_passage",
    "Open a Bible passage in the Logos Bible Software UI",
    { reference: z.string().describe("Bible reference (e.g., 'Genesis 1:1', 'Romans 8:28-30')") },
    async ({ reference }) => {
      const result = await navigateToPassage(reference);
      return result.success
        ? text(`Opened ${reference} in Logos.`)
        : err(`Failed to open passage: ${result.error}`);
    }
  );

  // ── 2. get_bible_text ────────────────────────────────────────────────────
  server.tool(
    "get_bible_text",
    "Retrieve the text of a Bible passage (LEB default)",
    {
      passage: z.string().describe("Bible reference (e.g., 'Genesis 1:1-5', 'John 3:16')"),
      bible: z.string().optional().describe("Bible version: LEB, KJV, ASV, DARBY, YLT, WEB"),
    },
    async ({ passage, bible }) => {
      const result = await getBibleText(passage, bible);
      return text(`**${result.passage}** (${result.bible})\n\n${result.text}`);
    }
  );

  // ── 3. get_passage_context ───────────────────────────────────────────────
  server.tool(
    "get_passage_context",
    "Get a Bible passage with surrounding verses for context",
    {
      passage: z.string().describe("Bible reference to center on"),
      context_verses: z.number().optional().describe("Verses before/after to include (default: 5)"),
      bible: z.string().optional().describe("Bible version (default: LEB)"),
    },
    async ({ passage, context_verses, bible }) => {
      const expanded = expandRange(passage, context_verses ?? 5);
      const result = await getBibleText(expanded, bible);
      return text(`**${result.passage}** (${result.bible}) — context around ${passage}\n\n${result.text}`);
    }
  );

  // ── 4. search_bible ──────────────────────────────────────────────────────
  server.tool(
    "search_bible",
    "Search the Bible for a word, phrase, or topic",
    {
      query: z.string().describe("Search terms (e.g., 'justification by faith')"),
      limit: z.number().optional().describe("Max results (default: 20)"),
      bible: z.string().optional().describe("Bible version (default: LEB)"),
    },
    async ({ query, limit, bible }) => {
      const result = await searchBible(query, { limit, bible });
      if (result.resultCount === 0) return text(`No results for "${query}".`);
      const lines = result.results.map((r) => `**${r.title}**: ${r.preview}`);
      return text(`Found ${result.resultCount} results for "${query}":\n\n${lines.join("\n\n")}`);
    }
  );

  // ── 5. get_cross_references ──────────────────────────────────────────────
  server.tool(
    "get_cross_references",
    "Find cross-references and parallel passages for a Bible verse",
    {
      passage: z.string().describe("Bible reference (e.g., 'Romans 8:28')"),
      key_terms: z.string().optional().describe("Specific terms to search instead of auto-extracting"),
    },
    async ({ passage, key_terms }) => {
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
      const filtered = results.results.filter(
        (r) => r.title.toLowerCase() !== passage.toLowerCase()
      );
      if (filtered.length === 0) return text(`No cross-references found for ${passage}.`);
      const lines = filtered.map((r) => `**${r.title}**: ${r.preview}`);
      return text(`Cross-references for **${passage}**:\n\n${lines.join("\n\n")}`);
    }
  );

  // ── 6. get_user_notes ────────────────────────────────────────────────────
  server.tool(
    "get_user_notes",
    "Read the user's study notes from Logos Bible Software",
    {
      notebook_title: z.string().optional().describe("Filter by notebook title (partial match)"),
      limit: z.number().optional().describe("Max notes to return (default: 20)"),
    },
    async ({ notebook_title, limit }) => {
      const notes = getUserNotes({ notebookTitle: notebook_title, limit: limit ?? 20 });
      if (notes.length === 0) return text("No notes found.");
      const lines = notes.map((n) => {
        const header = n.notebookTitle ? `[${n.notebookTitle}]` : "[No notebook]";
        const date = n.modifiedDate ?? n.createdDate;
        return `${header} (${date})\n${n.content}`;
      });
      return text(`Found ${notes.length} notes:\n\n${lines.join("\n\n---\n\n")}`);
    }
  );

  // ── 7. get_user_highlights ───────────────────────────────────────────────
  server.tool(
    "get_user_highlights",
    "Read the user's highlights and visual markup from Logos",
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
      if (highlights.length === 0) return text("No highlights found.");
      const lines = highlights.map((h) => `- **${h.styleName}**: ${h.textRange} (${h.resourceId})`);
      return text(`Found ${highlights.length} highlights:\n\n${lines.join("\n")}`);
    }
  );

  // ── 8. get_favorites ─────────────────────────────────────────────────────
  server.tool(
    "get_favorites",
    "List the user's saved favorites/bookmarks in Logos",
    {
      limit: z.number().optional().describe("Max favorites to return (default: 30)"),
    },
    async ({ limit }) => {
      const favorites = getFavorites(limit ?? 30);
      if (favorites.length === 0) return text("No favorites found.");
      const lines = favorites.map((f) => `- **${f.title}** → ${f.appCommand}`);
      return text(`Found ${favorites.length} favorites:\n\n${lines.join("\n")}`);
    }
  );

  // ── 9. get_reading_progress ──────────────────────────────────────────────
  server.tool(
    "get_reading_progress",
    "Show the user's reading plan progress from Logos",
    {},
    async () => {
      const progress = getReadingProgress();
      const sections: string[] = [];
      sections.push(`**Overall**: ${progress.completedItems}/${progress.totalItems} items (${progress.percentComplete}%)`);
      if (progress.statuses.length > 0) {
        const statusLines = progress.statuses.map((s) => {
          const label = s.status === 1 ? "Active" : s.status === 2 ? "Completed" : `Status ${s.status}`;
          return `- **${s.title}** by ${s.author} — ${label}`;
        });
        sections.push(`## Reading Plans\n\n${statusLines.join("\n")}`);
      }
      return text(sections.join("\n\n"));
    }
  );

  // ── 10. open_word_study ──────────────────────────────────────────────────
  server.tool(
    "open_word_study",
    "Open a word study in Logos for a Greek, Hebrew, or English word",
    { word: z.string().describe("The word to study (e.g., 'agape', 'hesed', 'justification')") },
    async ({ word }) => {
      const result = await openWordStudy(word);
      return result.success
        ? text(`Opened word study for "${word}" in Logos.`)
        : err(`Failed to open word study: ${result.error}`);
    }
  );

  // ── 11. open_factbook ────────────────────────────────────────────────────
  server.tool(
    "open_factbook",
    "Open the Logos Factbook for a person, place, event, or topic",
    { topic: z.string().describe("The topic to look up (e.g., 'Moses', 'Jerusalem', 'Passover')") },
    async ({ topic }) => {
      const result = await openFactbook(topic);
      return result.success
        ? text(`Opened Factbook entry for "${topic}" in Logos.`)
        : err(`Failed to open Factbook: ${result.error}`);
    }
  );

  // ── 12. get_study_workflows ──────────────────────────────────────────────
  server.tool(
    "get_study_workflows",
    "List available study workflow templates and active instances from Logos",
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

  // ── 13. get_library_catalog ─────────────────────────────────────────────
  server.tool(
    "get_library_catalog",
    "Search the user's Logos library catalog for owned resources by type, author, or keyword",
    {
      type: z.string().optional().describe("Filter by resource type (e.g., 'commentary', 'lexicon', 'theology', 'dictionary')"),
      query: z.string().optional().describe("Search titles, descriptions, and subjects"),
      author: z.string().optional().describe("Filter by author name"),
      limit: z.number().optional().describe("Max results to return (default: 25)"),
    },
    async ({ type, query, author, limit }) => {
      try {
        const resources = searchCatalog({ type, query, author, limit: limit ?? 25 });
        if (resources.length === 0) return text("No matching resources found in library catalog.");
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

  // ── 14. open_resource ─────────────────────────────────────────────────────
  server.tool(
    "open_resource",
    "Open a specific resource (commentary, lexicon, etc.) in Logos, optionally at a Bible passage",
    {
      resource_id: z.string().describe("Resource ID from the library catalog (e.g., 'LLS:CLVNCOMM')"),
      reference: z.string().optional().describe("Bible reference to navigate to within the resource (e.g., 'Romans 12:1')"),
    },
    async ({ resource_id, reference }) => {
      const result = await openResource(resource_id, reference);
      const refStr = reference ? ` at ${reference}` : "";
      return result.success
        ? text(`Opened resource \`${resource_id}\`${refStr} in Logos.`)
        : err(`Failed to open resource: ${result.error}`);
    }
  );

  // ── 15. open_guide ────────────────────────────────────────────────────────
  server.tool(
    "open_guide",
    "Open an Exegetical Guide, Passage Guide, or other guide type in Logos for a Bible passage",
    {
      guide_type: z.string().describe("Guide template name (e.g., 'Exegetical Guide', 'Passage Guide')"),
      reference: z.string().describe("Bible reference (e.g., 'Romans 12:1', 'John 3:16')"),
    },
    async ({ guide_type, reference }) => {
      const result = await openGuide(guide_type, reference);
      return result.success
        ? text(`Opened ${guide_type} for ${reference} in Logos.`)
        : err(`Failed to open guide: ${result.error}`);
    }
  );

  // ── 16. search_all ────────────────────────────────────────────────────────
  server.tool(
    "search_all",
    "Search across ALL resources in the Logos library (not just Bible text)",
    {
      query: z.string().describe("Search query (e.g., 'justification by faith', 'baptism')"),
    },
    async ({ query }) => {
      const result = await searchAll(query);
      return result.success
        ? text(`Opened Logos search for "${query}" across all resources.`)
        : err(`Failed to open search: ${result.error}`);
    }
  );

  // ── 17. scan_references ───────────────────────────────────────────────────
  server.tool(
    "scan_references",
    "Find Bible references in arbitrary text (e.g., extract all references from a paragraph)",
    {
      text: z.string().describe("Text to scan for Bible references"),
      tag_chapters: z.boolean().optional().describe("Tag chapter-level references too (default: true)"),
    },
    async ({ text: inputText, tag_chapters }) => {
      const results = await scanReferences(inputText, tag_chapters ?? true);
      if (results.length === 0) return text("No Bible references found in the text.");
      const lines = results.map((r) => `- **${r.passage}**`);
      return text(`Found ${results.length} Bible references:\n\n${lines.join("\n")}`);
    }
  );

  // ── 18. compare_passages ──────────────────────────────────────────────────
  server.tool(
    "compare_passages",
    "Compare two Bible references for overlap, subset, ordering",
    {
      first: z.string().describe("First Bible reference (e.g., 'Romans 8:28-30')"),
      second: z.string().describe("Second Bible reference (e.g., 'Romans 8:29')"),
    },
    async ({ first, second }) => {
      const result = await comparePassages(first, second);
      const relations: string[] = [];
      if (result.equal) relations.push("equal");
      if (result.intersects) relations.push("intersects");
      if (result.subset) relations.push("first is subset of second");
      if (result.superset) relations.push("first is superset of second");
      if (result.before) relations.push("first comes before second");
      if (result.after) relations.push("first comes after second");
      return text(`**${first}** vs **${second}**:\n${relations.join(", ") || "no relationship detected"}`);
    }
  );

  // ── 19. get_available_bibles ──────────────────────────────────────────────
  server.tool(
    "get_available_bibles",
    "List all Bible versions available for text retrieval via the Biblia API",
    {
      query: z.string().optional().describe("Optional search query to filter Bible versions"),
    },
    async ({ query }) => {
      const bibles = await getAvailableBibles(query);
      if (bibles.length === 0) return text("No Bible versions found.");
      const lines = bibles.map((b) => {
        const langs = b.languages?.length ? ` [${b.languages.join(", ")}]` : "";
        return `- **${b.title}** (\`${b.bible}\`)${langs}`;
      });
      return text(`Found ${bibles.length} Bible versions:\n\n${lines.join("\n")}`);
    }
  );

  // ── 20. get_resource_types ────────────────────────────────────────────────
  server.tool(
    "get_resource_types",
    "Get a summary of resource types and counts in the user's Logos library",
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

  // ── 21. diagnose ────────────────────────────────────────────────────────
  server.tool(
    "diagnose",
    "Check Logos data paths, database availability, and API configuration",
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
