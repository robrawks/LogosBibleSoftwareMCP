import { DB_PATHS } from "../config.js";
import { stripRichText } from "../utils/strip-markup.js";
import { decodeLogosBlob, extractClippingText } from "../utils/clippings.js";
import { getResourceTitles } from "./catalog-reader.js";
import type Database from "better-sqlite3";
import { openDb, escapeLike, hasTable } from "./db.js";
import { logosRawToHuman, parseLogosBibleRef } from "./logos-books.js";
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

// ─── Highlights ──────────────────────────────────────────────────────────────

export function getUserHighlights(options: {
  resourceId?: string;
  styleName?: string;
  limit?: number;
} = {}): HighlightResult[] {
  let results: HighlightResult[];
  try {
    results = queryVisualMarkupHighlights(options);
  } catch {
    // visualmarkup.db may be missing entirely on current installs.
    results = [];
  }
  if (results.length === 0) {
    // Modern Logos stores highlights as Kind=1 notes in notestool.db;
    // visualmarkup.db is the legacy store and is empty on current installs.
    results = getHighlightsFromNotes(options);
  }
  return withResourceTitles(results);
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
      reference: null, // visualmarkup.db stores text ranges, not Bible references
      rawReferences: [],
    }));
  } finally {
    db.close();
  }
}

function getHighlightsFromNotes(options: {
  resourceId?: string;
  styleName?: string;
  limit?: number;
}): HighlightResult[] {
  const db = openDb(DB_PATHS.notes);
  try {
    let sql = `
      SELECT n.NoteId, r.ResourceId, n.AnchorsJson, s.Name AS StyleName, n.ModifiedDate
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
      NoteId: number;
      ResourceId: string | null;
      AnchorsJson: string | null;
      StyleName: string | null;
      ModifiedDate: string | null;
    }>;
    const facetRefs = getFacetReferences(db, rows.map((r) => r.NoteId));

    return rows.map((r) => {
      const anchors = describeAnchors(facetRefs.get(r.NoteId), r.AnchorsJson);
      return {
        resourceId: r.ResourceId ?? "",
        textRange: r.AnchorsJson ?? "",
        styleName: r.StyleName ?? "",
        syncDate: r.ModifiedDate,
        resourceTitle: null, // filled in by withResourceTitles below
        reference: anchors.reference,
        rawReferences: anchors.rawReferences,
      };
    });
  } finally {
    db.close();
  }
}

// Logos 54+ keeps each anchor's Bible reference in NoteAnchorFacetReferences
// (design doc F2). Returns NoteId -> raw references in anchor order; empty
// when the table is absent (older installs) or no ids are given.
function getFacetReferences(db: Database.Database, noteIds: number[]): Map<number, string[]> {
  const refs = new Map<number, string[]>();
  if (noteIds.length === 0 || !hasTable(db, "NoteAnchorFacetReferences")) return refs;
  const CHUNK = 500; // stay well under SQLite's bound-parameter limit
  for (let i = 0; i < noteIds.length; i += CHUNK) {
    const chunk = noteIds.slice(i, i + CHUNK);
    const rows = db
      .prepare(`
        SELECT NoteId, Reference FROM NoteAnchorFacetReferences
        WHERE NoteId IN (${chunk.map(() => "?").join(", ")})
        ORDER BY NoteId, AnchorIndex, NoteAnchorFacetReferenceId
      `)
      .all(...chunk) as Array<{ NoteId: number; Reference: string }>;
    for (const r of rows) {
      const list = refs.get(r.NoteId) ?? [];
      list.push(r.Reference);
      refs.set(r.NoteId, list);
    }
  }
  return refs;
}

// Readable and raw Bible references for a note's or highlight's anchors: the
// facet table first (unmapped books keep their raw string), else AnchorsJson.
function describeAnchors(
  facetRefs: string[] | undefined,
  anchorsJson: string | null
): { reference: string | null; rawReferences: string[] } {
  if (facetRefs && facetRefs.length > 0) {
    return {
      reference: facetRefs.map((raw) => logosRawToHuman(raw) ?? raw).join("; "),
      rawReferences: facetRefs,
    };
  }
  return {
    reference: parseAnchorReference(anchorsJson),
    rawReferences: parseAnchorRawReferences(anchorsJson),
  };
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
      title: extractClippingText(decodeLogosBlob(r.TitleBlob)),
      content: extractClippingText(decodeLogosBlob(r.ContentBlob)),
      notes: extractClippingText(decodeLogosBlob(r.NotesBlob)),
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
  /** Readable Bible reference(s) the note is anchored to, "; "-joined (null when none). Facet table first, then AnchorsJson. */
  anchorReference: string | null;
  /** Raw Logos references behind anchorReference, e.g. "bible.65.9.35". */
  anchorRawReferences: string[];
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

    // The passage filter matches readable references after the query, so the
    // limit must wait for it — otherwise older matching notes are cut first.
    if (options.limit && !options.passage) {
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
    const facetRefs = getFacetReferences(db, rows.map((r) => r.NoteId));

    const notes = rows
      .map((r) => {
        const anchors = describeAnchors(facetRefs.get(r.NoteId), r.AnchorsJson);
        return {
          noteId: r.NoteId,
          externalId: r.ExternalId,
          content: stripRichText(r.ContentRichText),
          createdDate: r.CreatedDate,
          modifiedDate: r.ModifiedDate,
          notebookTitle: r.NotebookTitle,
          anchorsJson: r.AnchorsJson,
          tagsJson: r.TagsJson,
          anchorReference: anchors.reference,
          anchorRawReferences: anchors.rawReferences,
          tags: parseTagsJson(r.TagsJson),
        };
      })
      .filter((n) => n.content !== null);

    const filtered = filterNotesByPassage(notes, options.passage);
    return options.limit && options.passage ? filtered.slice(0, options.limit) : filtered;
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

// Raw Bible reference strings ("bible.66.8.28") from a note's AnchorsJson, in
// anchor order. Empty when the JSON is missing/malformed. Never throws.
export function parseAnchorRawReferences(anchorsJson: string | null): string[] {
  if (!anchorsJson) return [];
  let anchors: unknown;
  try {
    anchors = JSON.parse(anchorsJson);
  } catch {
    return [];
  }
  if (!Array.isArray(anchors)) return [];

  const raws: string[] = [];
  for (const anchor of anchors) {
    if (typeof anchor !== "object" || anchor === null) continue;
    const reference = (anchor as Record<string, unknown>).reference;
    if (typeof reference !== "object" || reference === null) continue;
    const raw = (reference as Record<string, unknown>).raw;
    if (typeof raw === "string" && parseLogosBibleRef(raw)) raws.push(raw);
  }
  return raws;
}

// Best-effort human-readable Bible reference from a note's AnchorsJson: the
// first raw reference whose book is mapped. Null when none. Never throws.
export function parseAnchorReference(anchorsJson: string | null): string | null {
  for (const raw of parseAnchorRawReferences(anchorsJson)) {
    const human = logosRawToHuman(raw);
    if (human) return human;
  }
  return null;
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
