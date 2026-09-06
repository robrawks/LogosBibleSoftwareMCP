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

// Escape LIKE wildcards in user input so "%" and "_" match literally.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
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

// Reverse map: human label (lowercased) -> raw dotted type prefixes that carry
// that label. A label can map to several raw types (e.g. "Commentary").
const LABEL_TO_RAW_TYPES: Map<string, string[]> = new Map();
for (const [raw, label] of Object.entries(TYPE_LABELS)) {
  const key = label.toLowerCase();
  const list = LABEL_TO_RAW_TYPES.get(key) ?? [];
  list.push(raw);
  LABEL_TO_RAW_TYPES.set(key, list);
}

// Resolve a user-supplied type filter to raw dotted type prefix(es). Accepts
// either form: raw dotted types ("text.monograph.commentary.bible") pass
// through unchanged; human labels ("Commentary", "greek lexicon") are
// translated to the raw prefix(es) that carry that label.
export function resolveTypeFilter(input: string): string[] {
  const labelKey = input.trim().toLowerCase();
  const rawTypes = LABEL_TO_RAW_TYPES.get(labelKey);
  if (rawTypes && rawTypes.length > 0) return rawTypes;
  return [input];
}

// ─── Licensing ──────────────────────────────────────────────────────────────
// The Logos catalog mixes owned resources with ones merely visible for
// purchase/preview. Empirically (Logos v48 macOS, verified against titles the
// user confirmed not owning): Availability = 2 → licensed and downloaded,
// Availability = 3 → in catalog but not licensed (none of those have a
// resource file on disk). Treat 2 as licensed; anything else as not.
export const LICENSED_AVAILABILITY = 2;

export function isLicensed(availability: number | null | undefined): boolean {
  return availability === LICENSED_AVAILABILITY;
}

// Records.Languages is a space/comma separated list of ISO codes ("es", "en grc").
export function languageClause(language: string): { sql: string; params: string[] } {
  const code = language.trim().toLowerCase();
  // Match the code as a whole token: exact, leading, trailing, or in the middle.
  return {
    sql: "(LOWER(Languages) = ? OR LOWER(Languages) LIKE ? ESCAPE '\\' OR LOWER(Languages) LIKE ? ESCAPE '\\' OR LOWER(Languages) LIKE ? ESCAPE '\\')",
    params: [code, `${escapeLike(code)} %`, `% ${escapeLike(code)}`, `% ${escapeLike(code)} %`],
  };
}

// ─── Search Catalog ─────────────────────────────────────────────────────────

export function searchCatalog(options: {
  type?: string;
  query?: string;
  author?: string;
  language?: string;
  licensedOnly?: boolean;
  limit?: number;
} = {}): CatalogResource[] {
  const db = openDb(DB_PATHS.catalog);
  try {
    let sql = `
      SELECT ResourceId, Title, AbbreviatedTitle, Type, Authors,
             Subjects, Description, PublicationDate, Languages, Availability, Publishers
      FROM Records
      WHERE Availability >= 1 AND IsDataset = 0
    `;
    const params: unknown[] = [];

    if (options.licensedOnly !== false) {
      sql += " AND Availability = ?";
      params.push(LICENSED_AVAILABILITY);
    }
    if (options.language) {
      const clause = languageClause(options.language);
      sql += ` AND ${clause.sql}`;
      params.push(...clause.params);
    }

    if (options.type) {
      const patterns = resolveTypeFilter(options.type);
      sql += ` AND (${patterns.map(() => "Type LIKE ? ESCAPE '\\'").join(" OR ")})`;
      for (const p of patterns) {
        params.push(`%${escapeLike(p)}%`);
      }
    }
    if (options.query) {
      sql += " AND (Title LIKE ? ESCAPE '\\' OR Description LIKE ? ESCAPE '\\' OR Subjects LIKE ? ESCAPE '\\')";
      const q = `%${escapeLike(options.query)}%`;
      params.push(q, q, q);
    }
    if (options.author) {
      sql += " AND Authors LIKE ? ESCAPE '\\'";
      params.push(`%${escapeLike(options.author)}%`);
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
      Languages: string | null;
      Availability: number | null;
      Publishers: string | null;
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
      languages: r.Languages,
      licensed: isLicensed(r.Availability),
      publishers: r.Publishers,
    }));
  } finally {
    db.close();
  }
}

// ─── Resource Type Summary ──────────────────────────────────────────────────

export function getResourceTypeSummary(options: { licensedOnly?: boolean; language?: string } = {}): ResourceTypeSummary[] {
  const db = openDb(DB_PATHS.catalog);
  try {
    let where = "Availability >= 1 AND IsDataset = 0";
    const params: unknown[] = [];
    if (options.licensedOnly !== false) {
      where += " AND Availability = ?";
      params.push(LICENSED_AVAILABILITY);
    }
    if (options.language) {
      const clause = languageClause(options.language);
      where += ` AND ${clause.sql}`;
      params.push(...clause.params);
    }
    const rows = db.prepare(`
      SELECT Type, COUNT(*) as Count
      FROM Records
      WHERE ${where}
      GROUP BY Type
      ORDER BY Count DESC
    `).all(...params) as Array<{
      Type: string;
      Count: number;
    }>;

    // Collapse types that share the same human-readable label, keeping the
    // raw dotted type with the highest individual count as the representative.
    const merged = new Map<string, { count: number; rawType: string; topCount: number }>();
    for (const r of rows) {
      const label = typeLabel(r.Type);
      const entry = merged.get(label);
      if (!entry) {
        merged.set(label, { count: r.Count, rawType: r.Type, topCount: r.Count });
      } else {
        entry.count += r.Count;
        if (r.Count > entry.topCount) {
          entry.topCount = r.Count;
          entry.rawType = r.Type;
        }
      }
    }
    return Array.from(merged.entries())
      .map(([label, e]) => ({ label, rawType: e.rawType, count: e.count }))
      .sort((a, b) => b.count - a.count);
  } finally {
    db.close();
  }
}

// ─── Resource Title Lookup ──────────────────────────────────────────────────

// Best-effort title lookup for a resourceId. Returns null when the catalog
// DB is missing/unreadable or the id isn't found (callers should never throw).
export function getResourceTitle(resourceId: string): string | null {
  return getResourceTitles([resourceId]).get(resourceId) ?? null;
}

// Batched variant: one catalog open and one query for any number of ids.
// Missing ids are simply absent from the map; failures yield an empty map.
export function getResourceTitles(resourceIds: string[]): Map<string, string | null> {
  const titles = new Map<string, string | null>();
  const ids = resourceIds.filter(Boolean);
  if (ids.length === 0) return titles;
  try {
    const db = openDb(DB_PATHS.catalog);
    try {
      const placeholders = ids.map(() => "?").join(", ");
      const rows = db
        .prepare(`SELECT ResourceId, Title FROM Records WHERE ResourceId IN (${placeholders})`)
        .all(...ids) as Array<{ ResourceId: string; Title: string | null }>;
      for (const r of rows) {
        titles.set(r.ResourceId, r.Title ?? null);
      }
    } finally {
      db.close();
    }
  } catch {
    // catalog.db missing/unreadable — return what we have (empty map)
  }
  return titles;
}
