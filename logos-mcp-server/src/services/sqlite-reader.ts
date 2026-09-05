import Database from "better-sqlite3";
import { existsSync } from "fs";
import { DB_PATHS } from "../config.js";
import { stripRichText } from "../utils/strip-markup.js";
import { decodeClippingBlob, extractClippingText } from "../utils/clippings.js";
import { getResourceTitles } from "./catalog-reader.js";
import { parseReference, resolveBookName } from "./reference-parser.js";
import type {
  ClippingResult,
  HighlightResult,
  FavoriteResult,
  WorkflowTemplate,
  WorkflowInstance,
  ReadingListStatus,
  ReadingListItem,
  ReadingProgress,
} from "../types.js";

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

// ─── Highlights ──────────────────────────────────────────────────────────────

export function getUserHighlights(options: {
  resourceId?: string;
  styleName?: string;
  passage?: string;
  limit?: number;
} = {}): HighlightResult[] {
  // The passage filter needs the resolved anchor, which only exists after the
  // rows come back, so a SQL LIMIT would filter just the newest N highlights and
  // hide every older match. Fetch unlimited when filtering, cap afterwards.
  const limitInSql = options.limit !== undefined && !options.passage;
  const query = { ...options, limit: limitInSql ? options.limit : undefined };

  let results: HighlightResult[];
  try {
    results = queryVisualMarkupHighlights(query);
  } catch {
    // visualmarkup.db may be missing entirely on current installs.
    results = [];
  }
  if (results.length === 0) {
    // Modern Logos stores highlights as Kind=1 notes in notestool.db;
    // visualmarkup.db is the legacy store and is empty on current installs.
    results = getHighlightsFromNotes(query);
  }

  const filtered = filterHighlightsByPassage(results, options.passage);
  const capped =
    limitInSql || options.limit === undefined ? filtered : filtered.slice(0, options.limit);
  return withResourceTitles(capped);
}

// Keep highlights whose resolved anchor mentions the requested book, mirroring
// filterNotesByPassage. Highlights anchored to a resource rather than a Bible
// text have no reference and are therefore never a passage match.
function filterHighlightsByPassage(
  highlights: HighlightResult[],
  passage?: string
): HighlightResult[] {
  if (!passage) return highlights;
  const book = extractBookName(passage);
  if (!book) return highlights;
  const needle = book.toLowerCase();
  return highlights.filter((h) => h.anchorReference?.toLowerCase().includes(needle));
}

function queryVisualMarkupHighlights(options: {
  resourceId?: string;
  styleName?: string;
  limit?: number;
}): HighlightResult[] {
  const db = openDb(DB_PATHS.visualMarkup);
  try {
    let sql = "SELECT ResourceId, SavedTextRange, MarkupStyleName, SyncDate FROM Markup WHERE IsDeleted = 0";
    const params: unknown[] = [];

    if (options.resourceId) {
      sql += " AND ResourceId = ?";
      params.push(options.resourceId);
    }
    if (options.styleName) {
      // LIKE to match the notestool fallback path's behavior for the same input.
      sql += " AND MarkupStyleName LIKE ? ESCAPE '\\'";
      params.push(`%${escapeLike(options.styleName)}%`);
    }
    sql += " ORDER BY SyncDate DESC";
    if (options.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as Array<{
      ResourceId: string;
      SavedTextRange: string;
      MarkupStyleName: string;
      SyncDate: string | null;
    }>;

    return rows.map((r) => ({
      resourceId: r.ResourceId,
      textRange: r.SavedTextRange,
      styleName: r.MarkupStyleName,
      syncDate: r.SyncDate,
      resourceTitle: null, // filled in by withResourceTitles below
      // The legacy markup table stores no anchor reference.
      anchorReference: null,
    }));
  } finally {
    db.close();
  }
}

// NoteAnchorFacetReferences is absent on older notestool.db schemas; probe once
// per query so a missing table degrades to AnchorsJson parsing instead of throwing.
function facetReferencesAvailable(db: Database.Database): boolean {
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get("NoteAnchorFacetReferences");
    return row !== undefined;
  } catch {
    return false;
  }
}

function getHighlightsFromNotes(options: {
  resourceId?: string;
  styleName?: string;
  limit?: number;
}): HighlightResult[] {
  const db = openDb(DB_PATHS.notes);
  try {
    // Logos resolves each anchor itself into NoteAnchorFacetReferences, which
    // stores the raw reference string plus the book number. Prefer that over
    // re-parsing AnchorsJson: it is the app's own resolution, and it is the only
    // place a highlight's passage is recorded at all.
    //
    // Correlated scalar subqueries (rather than a join) keep this to one row per
    // highlight — a highlight with several anchors would otherwise be duplicated.
    // Ordering by AnchorIndex picks the first anchor deterministically.
    const facet = facetReferencesAvailable(db)
      ? `(SELECT f.Reference FROM NoteAnchorFacetReferences f
           WHERE f.NoteId = n.NoteId ORDER BY f.AnchorIndex LIMIT 1)`
      : "NULL";

    let sql = `
      SELECT r.ResourceId, n.AnchorsJson, s.Name AS StyleName, n.ModifiedDate,
             ${facet} AS FacetReference
      FROM Notes n
      LEFT JOIN NoteStyles s ON n.NoteStyleId = s.NoteStyleId
      LEFT JOIN ResourceIds r ON n.AnchorResourceIdId = r.ResourceIdId
      WHERE n.Kind = 1 AND n.IsDeleted = 0 AND n.IsTrashed = 0
    `;
    const params: unknown[] = [];

    if (options.resourceId) {
      sql += " AND r.ResourceId = ?";
      params.push(options.resourceId);
    }
    if (options.styleName) {
      sql += " AND s.Name LIKE ? ESCAPE '\\'";
      params.push(`%${escapeLike(options.styleName)}%`);
    }
    sql += " ORDER BY n.ModifiedDate DESC";
    if (options.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as Array<{
      ResourceId: string | null;
      AnchorsJson: string | null;
      StyleName: string | null;
      ModifiedDate: string | null;
      FacetReference: string | null;
    }>;

    return rows.map((r) => ({
      resourceId: r.ResourceId ?? "",
      textRange: r.AnchorsJson ?? "",
      styleName: r.StyleName ?? "",
      syncDate: r.ModifiedDate,
      resourceTitle: null, // filled in by withResourceTitles below
      // Fall back to AnchorsJson when Logos has not written a facet row.
      anchorReference:
        (r.FacetReference ? bibleRawToHuman(r.FacetReference) : null) ??
        parseAnchorReference(r.AnchorsJson),
    }));
  } finally {
    db.close();
  }
}

// Resolve resource titles lazily and batched: one catalog lookup per distinct
// resourceId (cached), null on any failure (catalog.db may be missing).
function withResourceTitles(results: HighlightResult[]): HighlightResult[] {
  if (results.length === 0) return results;
  const ids = [...new Set(results.map((h) => h.resourceId).filter(Boolean))];
  const titles = getResourceTitles(ids);
  return results.map((h) => ({
    ...h,
    resourceTitle: h.resourceId ? titles.get(h.resourceId) ?? null : null,
  }));
}

// ─── Favorites ───────────────────────────────────────────────────────────────

export function getFavorites(limit?: number): FavoriteResult[] {
  const db = openDb(DB_PATHS.favorites);
  try {
    let sql = `
      SELECT f.Id, f.Title, f.Rank, i.AppCommand, i.ResourceId
      FROM Favorites f
      JOIN Items i ON f.Id = i.FavoriteId
      WHERE f.IsDeleted = 0
      ORDER BY f.Rank ASC
    `;
    const params: unknown[] = [];
    if (limit) {
      sql += " LIMIT ?";
      params.push(limit);
    }

    const rows = db.prepare(sql).all(...params) as Array<{
      Id: string;
      Title: string;
      Rank: number;
      AppCommand: string;
      ResourceId: string | null;
    }>;

    return rows.map((r) => ({
      id: r.Id,
      title: r.Title,
      appCommand: r.AppCommand,
      resourceId: r.ResourceId,
      rank: r.Rank,
    }));
  } finally {
    db.close();
  }
}

// ─── Workflows ───────────────────────────────────────────────────────────────

export function getWorkflowTemplates(): WorkflowTemplate[] {
  const db = openDb(DB_PATHS.workflows);
  try {
    const rows = db.prepare(`
      SELECT TemplateId, ExternalId, TemplateJson, Author, CreatedDate
      FROM Templates WHERE IsDeleted = 0
    `).all() as Array<{
      TemplateId: number;
      ExternalId: string;
      TemplateJson: string | null;
      Author: string | null;
      CreatedDate: string;
    }>;

    return rows.map((r) => {
      let parsed: Record<string, unknown> | null = null;
      if (r.TemplateJson) {
        try {
          parsed = JSON.parse(r.TemplateJson);
        } catch { /* ignore parse errors */ }
      }
      return {
        templateId: r.TemplateId,
        externalId: r.ExternalId,
        title: (parsed as Record<string, string>)?.title ?? r.ExternalId,
        author: r.Author,
        templateJson: parsed,
        createdDate: r.CreatedDate,
      };
    });
  } finally {
    db.close();
  }
}

export function getWorkflowInstances(limit: number = 20): WorkflowInstance[] {
  const db = openDb(DB_PATHS.workflows);
  try {
    const rows = db.prepare(`
      SELECT InstanceId, ExternalId, TemplateId, Key, Title,
             CurrentStep, CompletedStepsJson, SkippedStepsJson,
             CreatedDate, CompletedDate, ModifiedDate
      FROM Instances WHERE IsDeleted = 0
      ORDER BY ModifiedDate DESC LIMIT ?
    `).all(limit) as Array<{
      InstanceId: number;
      ExternalId: string;
      TemplateId: string;
      Key: string;
      Title: string;
      CurrentStep: string | null;
      CompletedStepsJson: string | null;
      SkippedStepsJson: string | null;
      CreatedDate: string;
      CompletedDate: string | null;
      ModifiedDate: string | null;
    }>;

    return rows.map((r) => ({
      instanceId: r.InstanceId,
      externalId: r.ExternalId,
      templateId: r.TemplateId,
      key: r.Key,
      title: r.Title,
      currentStep: r.CurrentStep,
      completedSteps: safeParseArray(r.CompletedStepsJson),
      skippedSteps: safeParseArray(r.SkippedStepsJson),
      createdDate: r.CreatedDate,
      completedDate: r.CompletedDate,
      modifiedDate: r.ModifiedDate,
    }));
  } finally {
    db.close();
  }
}

// ─── Reading Progress ────────────────────────────────────────────────────────

function statusLabel(status: number): string {
  switch (status) {
    case 1:
      return "Active";
    case 2:
      return "Completed";
    default:
      return `Unknown (code ${status})`;
  }
}

export function getReadingProgress(): ReadingProgress {
  const db = openDb(DB_PATHS.readingLists);
  try {
    const statuses = db.prepare(`
      SELECT Title, Author, Path, Status, ModifiedDate
      FROM ReadingListStatuses WHERE IsDeleted = 0
    `).all() as Array<{
      Title: string;
      Author: string;
      Path: string;
      Status: number;
      ModifiedDate: string | null;
    }>;

    const items = db.prepare(`
      SELECT ItemId, ReadingListPathNormalized, IsRead, ModifiedDate
      FROM Items
    `).all() as Array<{
      ItemId: string;
      ReadingListPathNormalized: string;
      IsRead: number;
      ModifiedDate: string | null;
    }>;

    const totalItems = items.length;
    const completedItems = items.filter((i) => i.IsRead === 1).length;

    return {
      statuses: statuses.map((s) => ({
        title: s.Title,
        author: s.Author,
        path: s.Path,
        status: s.Status,
        statusLabel: statusLabel(s.Status),
        modifiedDate: s.ModifiedDate,
      })),
      items: items.map((i) => ({
        itemId: i.ItemId,
        readingListPath: i.ReadingListPathNormalized,
        isRead: i.IsRead === 1,
        modifiedDate: i.ModifiedDate,
      })),
      totalItems,
      completedItems,
      percentComplete: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
    };
  } finally {
    db.close();
  }
}

// ─── Clippings ───────────────────────────────────────────────────────────────

export function getClippings(options: {
  resourceId?: string;
  tag?: string;
  limit?: number;
} = {}): ClippingResult[] {
  const db = openDb(DB_PATHS.clippings);
  try {
    let sql = `
      SELECT c.RowId, c.ResourceId, c.CreatedDate, c.Title as TitleBlob,
             c.Content as ContentBlob, c.Notes as NotesBlob, c.Tags,
             cd.Title as CollectionTitle
      FROM Clippings c
      LEFT JOIN ClippingsDocuments cd ON c.DocumentRowId = cd.RowId
      WHERE (cd.IsDeleted = 0 OR cd.IsDeleted IS NULL)
    `;
    const params: unknown[] = [];

    if (options.resourceId) {
      sql += " AND c.ResourceId = ?";
      params.push(options.resourceId);
    }

    if (options.tag) {
      sql += " AND c.Tags LIKE ? ESCAPE '\\'";
      params.push(`%${escapeLike(options.tag)}%`);
    }

    sql += " ORDER BY c.CreatedDate DESC";

    if (options.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as Array<{
      RowId: number;
      ResourceId: string;
      CreatedDate: string;
      TitleBlob: Buffer;
      ContentBlob: Buffer;
      NotesBlob: Buffer | null;
      Tags: string | null;
      CollectionTitle: string | null;
    }>;

    return rows.map((r) => ({
      rowId: r.RowId,
      resourceId: r.ResourceId,
      createdDate: r.CreatedDate,
      collectionTitle: r.CollectionTitle,
      title: extractClippingText(decodeClippingBlob(r.TitleBlob)),
      content: extractClippingText(decodeClippingBlob(r.ContentBlob)),
      notes: extractClippingText(decodeClippingBlob(r.NotesBlob)),
      tags: r.Tags,
    }));
  } finally {
    db.close();
  }
}

// ─── Notes ───────────────────────────────────────────────────────────────────

export interface NoteResult {
  noteId: number;
  externalId: string;
  content: string | null;
  createdDate: string;
  modifiedDate: string | null;
  notebookTitle: string | null;
  anchorsJson: string | null;
  tagsJson: string | null;
  /** Best-effort human-readable Bible reference parsed from anchorsJson (null when not parseable). */
  anchorReference: string | null;
  /** Tags parsed from tagsJson (empty array on parse failure). */
  tags: string[];
}

export function getUserNotes(options: {
  notebookTitle?: string;
  limit?: number;
  query?: string;
  passage?: string;
} = {}): NoteResult[] {
  const db = openDb(DB_PATHS.notes);
  try {
    let sql = `
      SELECT n.NoteId, n.ExternalId, n.ContentRichText, n.CreatedDate,
             n.ModifiedDate, nb.Title as NotebookTitle,
             n.AnchorsJson, n.TagsJson
      FROM Notes n
      LEFT JOIN Notebooks nb ON n.NotebookExternalId = nb.ExternalId AND nb.IsDeleted = 0
      WHERE n.IsDeleted = 0 AND n.IsTrashed = 0
        AND n.ContentRichText IS NOT NULL
    `;
    const params: unknown[] = [];

    if (options.notebookTitle) {
      sql += " AND nb.Title LIKE ? ESCAPE '\\'";
      params.push(`%${escapeLike(options.notebookTitle)}%`);
    }

    if (options.query) {
      sql += " AND n.ContentRichText LIKE ? ESCAPE '\\'";
      params.push(`%${escapeLike(options.query)}%`);
    }

    sql += " ORDER BY n.ModifiedDate DESC";

    // The passage filter runs in JS (it needs AnchorsJson parsed), so pushing
    // LIMIT into SQL here would filter only the newest N notes and silently
    // hide every older match. Defer the limit to after filtering in that case.
    const limitInSql = options.limit && !options.passage;
    if (limitInSql) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as Array<{
      NoteId: number;
      ExternalId: string;
      ContentRichText: string | null;
      CreatedDate: string;
      ModifiedDate: string | null;
      NotebookTitle: string | null;
      AnchorsJson: string | null;
      TagsJson: string | null;
    }>;

    const notes = rows
      .map((r) => ({
        noteId: r.NoteId,
        externalId: r.ExternalId,
        content: stripRichText(r.ContentRichText),
        createdDate: r.CreatedDate,
        modifiedDate: r.ModifiedDate,
        notebookTitle: r.NotebookTitle,
        anchorsJson: r.AnchorsJson,
        tagsJson: r.TagsJson,
        anchorReference: parseAnchorReference(r.AnchorsJson),
        tags: parseTagsJson(r.TagsJson),
      }))
      .filter((n) => n.content !== null);

    const filtered = filterNotesByPassage(notes, options.passage);
    return limitInSql || !options.limit ? filtered : filtered.slice(0, options.limit);
  } finally {
    db.close();
  }
}

// Post-filter notes by the book name of a passage string (e.g. "John 3:16" ->
// keep notes whose anchorReference mentions "John"). Case-insensitive; when the
// passage's book name can't be resolved the filter is skipped entirely.
function filterNotesByPassage(notes: NoteResult[], passage?: string): NoteResult[] {
  if (!passage) return notes;
  const book = extractBookName(passage);
  if (!book) return notes;
  const needle = book.toLowerCase();
  return notes.filter((n) => n.anchorReference?.toLowerCase().includes(needle));
}

function extractBookName(passage: string): string | null {
  try {
    return parseReference(passage).book;
  } catch {
    // Not a full reference (e.g. just "John" or "1 John") — try resolving the
    // raw string as a book name.
    return resolveBookName(passage);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeParseArray(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Anchor / Tag JSON parsing ───────────────────────────────────────────────

// Logos Bible book numbers (standard Protestant canon order, 1-66). Numbers
// outside this range (e.g. deuterocanonical books in some installs) are left
// unmapped and parse to null — best-effort only.
// Logos book numbers, NOT Protestant canonical order. Logos numbers the
// deuterocanonical books at 40-60, so the New Testament starts at 61 (Matthew)
// and runs to 87 (Revelation). Confirmed against this install's own notes:
// bible.68.5.11-68.5.21 is 2 Corinthians 5:11-21, bible.70.1.4-70.1.14 is
// Ephesians 1:4-14, and bible+esv.80.1.2 is James 1:2.
//
// 40-60 are deliberately absent: the exact deuterocanonical ordering is not
// verified against real data here, and returning null beats naming the wrong
// book. bibleRawToHuman() returns null for any number missing from this table.
const BOOKS_BY_NUMBER: Record<number, string> = {
  1: "Genesis", 2: "Exodus", 3: "Leviticus", 4: "Numbers", 5: "Deuteronomy",
  6: "Joshua", 7: "Judges", 8: "Ruth", 9: "1 Samuel", 10: "2 Samuel",
  11: "1 Kings", 12: "2 Kings", 13: "1 Chronicles", 14: "2 Chronicles",
  15: "Ezra", 16: "Nehemiah", 17: "Esther", 18: "Job", 19: "Psalms",
  20: "Proverbs", 21: "Ecclesiastes", 22: "Song of Solomon", 23: "Isaiah",
  24: "Jeremiah", 25: "Lamentations", 26: "Ezekiel", 27: "Daniel",
  28: "Hosea", 29: "Joel", 30: "Amos", 31: "Obadiah", 32: "Jonah",
  33: "Micah", 34: "Nahum", 35: "Habakkuk", 36: "Zephaniah", 37: "Haggai",
  38: "Zechariah", 39: "Malachi",
  61: "Matthew", 62: "Mark", 63: "Luke", 64: "John", 65: "Acts",
  66: "Romans", 67: "1 Corinthians", 68: "2 Corinthians", 69: "Galatians",
  70: "Ephesians", 71: "Philippians", 72: "Colossians",
  73: "1 Thessalonians", 74: "2 Thessalonians", 75: "1 Timothy",
  76: "2 Timothy", 77: "Titus", 78: "Philemon", 79: "Hebrews", 80: "James",
  81: "1 Peter", 82: "2 Peter", 83: "1 John", 84: "2 John", 85: "3 John",
  86: "Jude", 87: "Revelation",
};

// Matches raw Logos reference strings found in AnchorsJson, e.g.:
//   "bible.65.3.21"              -> Acts 3:21
//   "bible.65.3.21-65.3.23"      -> Acts 3:21-23
//   "bible.70"                   -> Ephesians (whole-book anchor)
//   "bible+kjv.6.1.8"            -> Joshua 1:8 (version qualifier ignored)
// Chapter and verse are both optional: Logos writes whole-book anchors as plain
// "bible.70" (Ephesians), which a chapter-mandatory pattern silently rejects.
const BIBLE_RAW_RE =
  /^bible(?:\+[a-z0-9]*)?\.(\d+)(?:\.(\d+)(?:\.(\d+))?)?(?:-(\d+)(?:\.(\d+)(?:\.(\d+))?)?)?$/i;

// Best-effort human-readable Bible reference from a note's AnchorsJson.
// Returns null when the JSON is missing/malformed or no bible reference anchor
// is found. Never throws.
export function parseAnchorReference(anchorsJson: string | null): string | null {
  if (!anchorsJson) return null;
  let anchors: unknown;
  try {
    anchors = JSON.parse(anchorsJson);
  } catch {
    return null;
  }
  if (!Array.isArray(anchors)) return null;

  for (const anchor of anchors) {
    if (typeof anchor !== "object" || anchor === null) continue;
    const reference = (anchor as Record<string, unknown>).reference;
    if (typeof reference !== "object" || reference === null) continue;
    const raw = (reference as Record<string, unknown>).raw;
    if (typeof raw !== "string") continue;
    const human = bibleRawToHuman(raw);
    if (human) return human;
  }
  return null;
}

/**
 * Decode a raw Logos bible reference ("bible.70.1.4-70.1.14") to a human one
 * ("Ephesians 1:4-14"). Returns null for anything that is not a bible
 * reference — workflow keys, for instance, may be topic keys like
 * "bk.%goodnessOfGod". Never throws.
 */
export function bibleRawToHuman(raw: string): string | null {
  const m = raw.match(BIBLE_RAW_RE);
  if (!m) return null;
  const book = BOOKS_BY_NUMBER[parseInt(m[1], 10)];
  if (!book) return null;

  const chapter = m[2] ? parseInt(m[2], 10) : undefined;
  const verse = m[3] ? parseInt(m[3], 10) : undefined;
  const endBook = m[4] ? BOOKS_BY_NUMBER[parseInt(m[4], 10)] : undefined;
  const endChapter = m[5] ? parseInt(m[5], 10) : undefined;
  const endVerse = m[6] ? parseInt(m[6], 10) : undefined;

  // A book-only anchor renders as just the book name.
  if (chapter === undefined) return book;

  let result = `${book} ${chapter}`;
  if (verse !== undefined) result += `:${verse}`;
  if (endChapter !== undefined) {
    if (endBook !== undefined && endBook !== book) {
      // Cross-book range, e.g. "bible.1.50.26-2.1.1" -> Genesis 50:26-Exodus 1:1
      result += `-${endBook} ${endChapter}`;
      if (endVerse !== undefined) result += `:${endVerse}`;
    } else if (endVerse !== undefined) {
      result += endChapter === chapter ? `-${endVerse}` : `-${endChapter}:${endVerse}`;
    } else {
      result += `-${endChapter}`;
    }
  }
  return result;
}

// Tags from a note's TagsJson, e.g. [{"plain":{"text":"faith"}}] -> ["faith"].
// Returns an empty array when the JSON is missing/malformed. Never throws.
export function parseTagsJson(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(tagsJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const tags: string[] = [];
  for (const entry of parsed) {
    if (typeof entry === "string") {
      if (entry.length > 0) tags.push(entry);
    } else if (typeof entry === "object" && entry !== null) {
      const plain = (entry as Record<string, unknown>).plain;
      if (typeof plain === "object" && plain !== null) {
        const text = (plain as Record<string, unknown>).text;
        if (typeof text === "string" && text.length > 0) tags.push(text);
      }
    }
  }
  return tags;
}
