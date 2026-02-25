import Database from "better-sqlite3";
import { existsSync } from "fs";
import { DB_PATHS } from "../config.js";
import type { CatalogResource, ResourceTypeSummary } from "../types.js";

function openDb(path: string): Database.Database {
  if (!existsSync(path)) {
    throw new Error(`Database not found: ${path}`);
  }
  return new Database(path, { readonly: true, fileMustExist: true });
}

// ─── Human-friendly type labels ─────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  "text.monograph.commentary.bible": "Commentary",
  "text.monograph.dictionary": "Dictionary",
  "text.monograph.dictionary.bible": "Bible Dictionary",
  "text.monograph.dictionary.encyclopedia": "Encyclopedia",
  "text.monograph.dictionary.encyclopedia.bible": "Bible Encyclopedia",
  "text.monograph.dictionary.lexicon": "Lexicon",
  "text.monograph.dictionary.lexicon.greek": "Greek Lexicon",
  "text.monograph.dictionary.lexicon.hebrew": "Hebrew Lexicon",
  "text.monograph.studynotes": "Study Notes",
  "text.monograph": "Book",
  "text.monograph.theology.systematic": "Systematic Theology",
  "text.monograph.theology": "Theology",
  "text.monograph.bible.reference": "Bible Reference",
  "text.monograph.sermons": "Sermons",
  "text.monograph.devotional": "Devotional",
  "text.monograph.history": "History",
  "text.monograph.history.church": "Church History",
  "text.bible": "Bible",
  "text.bible.interlinear": "Interlinear Bible",
  "text.monograph.atlas": "Atlas",
  "text.monograph.introduction.bible": "Bible Introduction",
  "text.monograph.guide": "Guide",
  "text.monograph.grammar": "Grammar",
  "text.monograph.grammar.greek": "Greek Grammar",
  "text.monograph.grammar.hebrew": "Hebrew Grammar",
  "text.monograph.journal": "Journal",
  "text.monograph.creeds.confessions": "Creeds & Confessions",
  "text.monograph.earlyChurchFathers": "Early Church Fathers",
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.split(".").pop() ?? type;
}

// ─── Strip XML markup from description fields ──────────────────────────────

function stripXml(text: string | null): string | null {
  if (!text) return null;
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Search Catalog ─────────────────────────────────────────────────────────

export function searchCatalog(options: {
  type?: string;
  query?: string;
  author?: string;
  limit?: number;
} = {}): CatalogResource[] {
  const db = openDb(DB_PATHS.catalog);
  try {
    let sql = `
      SELECT ResourceId, Title, AbbreviatedTitle, Type, Authors,
             Subjects, Description, PublicationDate, UseCount
      FROM Records
      WHERE Availability >= 1 AND IsDataset = 0
    `;
    const params: unknown[] = [];

    if (options.type) {
      sql += " AND Type LIKE ?";
      params.push(`%${options.type}%`);
    }
    if (options.query) {
      sql += " AND (Title LIKE ? OR Description LIKE ? OR Subjects LIKE ?)";
      const q = `%${options.query}%`;
      params.push(q, q, q);
    }
    if (options.author) {
      sql += " AND Authors LIKE ?";
      params.push(`%${options.author}%`);
    }

    sql += " ORDER BY UseCount DESC";
    sql += " LIMIT ?";
    params.push(options.limit ?? 25);

    const rows = db.prepare(sql).all(...params) as Array<{
      ResourceId: string;
      Title: string;
      AbbreviatedTitle: string | null;
      Type: string;
      Authors: string | null;
      Subjects: string | null;
      Description: string | null;
      PublicationDate: string | null;
      UseCount: number;
    }>;

    return rows.map((r) => ({
      resourceId: r.ResourceId,
      title: r.Title,
      abbreviatedTitle: r.AbbreviatedTitle,
      type: r.Type,
      authors: r.Authors,
      subjects: r.Subjects,
      description: stripXml(r.Description),
      publicationDate: r.PublicationDate,
      useCount: r.UseCount,
    }));
  } finally {
    db.close();
  }
}

// ─── Resource Type Summary ──────────────────────────────────────────────────

export function getResourceTypeSummary(): ResourceTypeSummary[] {
  const db = openDb(DB_PATHS.catalog);
  try {
    const rows = db.prepare(`
      SELECT Type, COUNT(*) as Count
      FROM Records
      WHERE Availability >= 1 AND IsDataset = 0
      GROUP BY Type
      ORDER BY Count DESC
    `).all() as Array<{
      Type: string;
      Count: number;
    }>;

    return rows.map((r) => ({
      type: r.Type,
      count: r.Count,
      label: typeLabel(r.Type),
    }));
  } finally {
    db.close();
  }
}
