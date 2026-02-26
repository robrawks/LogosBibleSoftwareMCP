import Database from "better-sqlite3";
import { existsSync } from "fs";
import { DB_PATHS } from "../config.js";
import { stripXml } from "../utils/strip-markup.js";
import type { CatalogResource, ResourceTypeSummary } from "../types.js";

function openDb(path: string): Database.Database {
  if (!existsSync(path)) {
    throw new Error(`Database not found: ${path}`);
  }
  return new Database(path, { readonly: true, fileMustExist: true });
}

// ─── Human-friendly type labels ─────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  // Books & monographs
  "text.monograph": "Book",
  "text.monograph.collected-work": "Collected Work",
  "text.monograph.biography": "Biography",
  "text.monograph.autobiography": "Autobiography",
  "text.monograph.letters": "Letters",
  "text.monograph.festschrift": "Festschrift",
  "text.monograph.quotations": "Quotations",
  "text.monograph.illustrations": "Illustrations",
  "text.monograph.handbook": "Handbook",
  "text.monograph.workbook": "Workbook",
  "text.monograph.lecture": "Lecture",
  "text.monograph.prayers": "Prayers",
  // Bible & Bible-related
  "text.monograph.bible": "Bible",
  "text.bible": "Bible",
  "text.bible.interlinear": "Interlinear Bible",
  "text.monograph.bible.reference": "Bible Reference",
  "text.monograph.concordance.bible": "Concordance",
  "text.monograph.harmony.bible": "Harmony",
  "text.monograph.lectionary.bible": "Lectionary",
  "text.monograph.study.bible": "Study Bible",
  "text.monograph.notes.bible": "Bible Notes",
  "text.monograph.cross-references.bible": "Cross-References",
  "text.monograph.critical-apparatus.bible": "Critical Apparatus",
  "text.monograph.introduction.bible": "Bible Introduction",
  "text.monograph.introduction.new-testament": "NT Introduction",
  "text.monograph.survey.new-testament": "NT Survey",
  "text.monograph.bible-study": "Bible Study",
  "text.visualization.bible": "Bible Visualization",
  // Commentary
  "text.monograph.commentary.bible": "Commentary",
  "text.monograph.commentary": "Commentary",
  // Reference & dictionaries
  "text.monograph.dictionary": "Dictionary",
  "text.monograph.dictionary.bible": "Bible Dictionary",
  "text.monograph.dictionary.encyclopedia": "Encyclopedia",
  "text.monograph.dictionary.encyclopedia.bible": "Bible Encyclopedia",
  "text.monograph.dictionary.lexicon": "Lexicon",
  "text.monograph.dictionary.lexicon.greek": "Greek Lexicon",
  "text.monograph.dictionary.lexicon.hebrew": "Hebrew Lexicon",
  "text.monograph.encyclopedia": "Encyclopedia",
  "text.monograph.lexicon": "Lexicon",
  "text.monograph.glossary": "Glossary",
  "text.monograph.thesaurus": "Thesaurus",
  "text.monograph.bibliography": "Bibliography",
  // Theology
  "text.monograph.theology.systematic": "Systematic Theology",
  "text.monograph.systematic-theology": "Systematic Theology",
  "text.monograph.theology": "Theology",
  "text.monograph.biblical-theology": "Biblical Theology",
  // History & church
  "text.monograph.history": "History",
  "text.monograph.history.church": "Church History",
  "text.monograph.church-history": "Church History",
  "text.monograph.ancient-manuscript": "Ancient Manuscript",
  "text.monograph.ancient-manuscript.translation": "Ancient Text Translation",
  "text.monograph.earlyChurchFathers": "Early Church Fathers",
  // Sermons & devotional
  "text.monograph.sermons": "Sermons",
  "text.monograph.devotional": "Devotional",
  "text.monograph.hymnal": "Hymnal",
  "text.monograph.service-book": "Service Book",
  "text.monograph.catechism": "Catechism",
  "text.monograph.confessional-document": "Confessional Document",
  "text.monograph.creeds.confessions": "Creeds & Confessions",
  // Study & education
  "text.monograph.studynotes": "Study Notes",
  "text.monograph.study-guide": "Study Guide",
  "text.monograph.courseware": "Courseware",
  "text.monograph.grammar": "Grammar",
  "text.monograph.grammar.greek": "Greek Grammar",
  "text.monograph.grammar.hebrew": "Hebrew Grammar",
  "text.monograph.guide": "Guide",
  "text.monograph.atlas": "Atlas",
  "text.manual": "Manual",
  // Journals
  "text.monograph.journal": "Journal",
  "text.serial.journal": "Journal",
  // Interactive & media
  "lbx.media": "Media",
  "lbx.media.courseware": "Interactive Courseware",
  "lbx.interactive": "Interactive Resource",
  "lbx.calendar-devotional": "Daily Devotional",
  "lbx.timelines": "Timeline",
  "lbx.biblicalpeoplediagrams": "People Diagrams",
  "lbx.biblicalplacesmaps": "Place Maps",
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.split(".").pop() ?? type;
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
             Subjects, Description, PublicationDate
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

    // Collapse types that share the same human-readable label
    const merged = new Map<string, number>();
    for (const r of rows) {
      const label = typeLabel(r.Type);
      merged.set(label, (merged.get(label) ?? 0) + r.Count);
    }
    return Array.from(merged.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  } finally {
    db.close();
  }
}
