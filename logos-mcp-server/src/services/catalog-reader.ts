import { DB_PATHS } from "../config.js";
import { stripXml } from "../utils/strip-markup.js";
import { openDb, escapeLike } from "./db.js";
import { statSync } from "fs";
import { parseReference } from "./reference-parser.js";
import { logosBookNumber, parseReferenceSupersets, rangeContains, type LogosBibleRange } from "./logos-books.js";
import type { CatalogResource, ResourceTypeSummary, PassageResource } from "../types.js";

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

// ─── Preferred Bible ────────────────────────────────────────────────────────

/**
 * Finds the Bible the user opens most (catalog UseCount), for passage links
 * that must name a Bible resource.
 *
 * @returns The resource ID, or null when the catalog is missing or holds no
 *   available Bible. Never throws.
 */
export function getPreferredBibleResourceId(): string | null {
  try {
    const db = openDb(DB_PATHS.catalog);
    try {
      const row = db.prepare(`
        SELECT ResourceId FROM Records
        WHERE Type IN ('text.monograph.bible', 'text.bible')
          AND Availability >= 1 AND IsDataset = 0
        ORDER BY UseCount DESC
        LIMIT 1
      `).get() as { ResourceId: string } | undefined;
      return row?.ResourceId ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null; // missing/unreadable catalog.db, and (by design) any unexpected SQL/schema error
  }
}

/**
 * IDs of every catalog resource whose type matches a get_library_catalog-style
 * filter (label or raw dotted type), regardless of availability.
 *
 * @returns The IDs; an empty set on any failure. Never throws.
 */
export function getResourceIdsOfType(type: string): Set<string> {
  const ids = new Set<string>();
  try {
    const db = openDb(DB_PATHS.catalog);
    try {
      const patterns = resolveTypeFilter(type);
      const rows = db
        .prepare(`SELECT ResourceId FROM Records WHERE ${patterns.map(() => "Type LIKE ? ESCAPE '\\'").join(" OR ")}`)
        .all(...patterns.map((p) => `%${escapeLike(p)}%`)) as Array<{ ResourceId: string }>;
      for (const r of rows) ids.add(r.ResourceId);
    } finally {
      db.close();
    }
  } catch {
    // catalog.db missing/unreadable
  }
  return ids;
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

// ─── Catalog traits ─────────────────────────────────────────────────────────

/**
 * Records.Traits is tab-separated "key:value" entries (plus bare flags such as
 * "supports-bible", which are skipped). Keeps the first value per key.
 *
 * @param traits - The raw Traits column value.
 * @returns A map of trait key to its first value.
 */
export function parseTraits(traits: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of traits.split("\t")) {
    const colon = entry.indexOf(":");
    if (colon <= 0) continue;
    const key = entry.slice(0, colon);
    if (!map.has(key)) map.set(key, entry.slice(colon + 1));
  }
  return map;
}

// ─── Passage coverage ───────────────────────────────────────────────────────

/** Resource kinds `findPassageResources` can filter by. */
export type PassageResourceKind = "commentary" | "study bible" | "cross-references" | "bible" | "harmony";

// find_passage_resources kinds -> the TYPE_LABELS label that carries them.
/** Maps each passage-resource kind to the catalog type label that carries it. */
export const PASSAGE_RESOURCE_KINDS: Record<PassageResourceKind, string> = {
  commentary: "Commentary",
  "study bible": "Study Bible",
  "cross-references": "Cross-References",
  bible: "Bible",
  harmony: "Harmony",
};

interface CoverageRecord {
  resource: PassageResource;
  ranges: LogosBibleRange[];
}

// Parsed coverage of every owned resource, kept until catalog.db changes.
let coverageCache: { path: string; version: string; records: CoverageRecord[] } | null = null;

// The catalog's on-disk version. Logos writes catalog.db in WAL mode, so a
// committed change can sit in catalog.db-wal without touching the main file;
// both files' mtime and size count. (PRAGMA data_version only compares within
// one connection, and each call opens a new one.)
function catalogVersion(path: string): string {
  const part = (p: string) => {
    try {
      const s = statSync(p);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return "-"; // no -wal file (checkpointed, or not in WAL mode)
    }
  };
  return `${part(path)}|${part(`${path}-wal`)}`;
}

function emptyToNull(s: string | null): string | null {
  return s && s.length > 0 ? s : null;
}

function loadCoverageRecords(): CoverageRecord[] {
  const path = DB_PATHS.catalog;
  const db = openDb(path); // throws "Database not found" when missing
  try {
    const version = catalogVersion(path);
    if (coverageCache && coverageCache.path === path && coverageCache.version === version) {
      return coverageCache.records;
    }
    const rows = db.prepare(`
      SELECT ResourceId, Title, AbbreviatedTitle, Type, Authors, Series, Traits,
             CommunityRating, UseCount, ReferenceSupersets
      FROM Records
      WHERE Availability >= 1 AND IsDataset = 0 AND ReferenceSupersets <> ''
    `).all() as Array<{
      ResourceId: string;
      Title: string;
      AbbreviatedTitle: string | null;
      Type: string;
      Authors: string | null;
      Series: string | null;
      Traits: string | null;
      CommunityRating: number | null;
      UseCount: number;
      ReferenceSupersets: string;
    }>;

    const records: CoverageRecord[] = [];
    for (const r of rows) {
      const ranges = parseReferenceSupersets(r.ReferenceSupersets);
      if (ranges.length === 0) continue;
      const traits = parseTraits(r.Traits ?? "");
      const authors = (r.Authors ?? "").split("\t").filter((a) => a.length > 0);
      records.push({
        ranges,
        resource: {
          resourceId: r.ResourceId,
          title: r.Title,
          abbreviatedTitle: emptyToNull(r.AbbreviatedTitle),
          authors: authors.length > 0 ? authors.join("; ") : null,
          series: emptyToNull(r.Series),
          kind: typeLabel(r.Type),
          type: r.Type,
          purpose: traits.get("commentary-purpose") ?? null,
          era: traits.get("era") ?? null,
          communityRating: r.CommunityRating,
          useCount: r.UseCount,
        },
      });
    }
    coverageCache = { path, version, records };
    return records;
  } finally {
    db.close();
  }
}

/**
 * Owned resources whose catalog coverage includes the passage's first verse.
 * Commentaries first, then most-used, then highest community rating. The
 * order differs from the user's Passage Guide prioritization, which Logos
 * does not store locally (design doc F18).
 *
 * @param options.passage - The passage reference, e.g. "John 5:1".
 * @param options.kind - Restrict to one resource kind.
 * @param options.purpose - Restrict commentaries to one commentary purpose.
 * @param options.limit - Maximum number of results.
 * @returns The matching resources in the order above.
 * @throws Error for an unparseable passage or a missing catalog.
 */
export function findPassageResources(options: {
  passage: string;
  kind?: PassageResourceKind;
  purpose?: string;
  limit?: number;
}): PassageResource[] {
  const ref = parseReference(options.passage);
  const book = logosBookNumber(ref.book);
  if (book === null) throw new Error(`No Logos book number for "${ref.book}"`);
  const point = { book, chapter: ref.chapter, verse: ref.verse };
  const rawTypes = options.kind ? resolveTypeFilter(PASSAGE_RESOURCE_KINDS[options.kind]) : null;

  const matches = loadCoverageRecords()
    .filter((r) => r.ranges.some((range) => rangeContains(range, point)))
    .map((r) => r.resource)
    .filter((r) => rawTypes === null || rawTypes.includes(r.type))
    .filter((r) => !options.purpose || r.purpose === options.purpose);

  matches.sort((a, b) => {
    const aCommentary = a.kind === "Commentary" ? 0 : 1;
    const bCommentary = b.kind === "Commentary" ? 0 : 1;
    if (aCommentary !== bCommentary) return aCommentary - bCommentary;
    if (a.useCount !== b.useCount) return b.useCount - a.useCount;
    const aRating = a.communityRating ?? -1;
    const bRating = b.communityRating ?? -1;
    if (aRating !== bRating) return bRating - aRating;
    return a.title.localeCompare(b.title);
  });
  return matches.slice(0, options.limit ?? 25);
}
