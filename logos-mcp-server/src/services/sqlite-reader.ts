import { DB_PATHS } from "../config.js";
import { stripRichText } from "../utils/strip-markup.js";
import { decodeLogosBlob, extractClippingText } from "../utils/clippings.js";
import { getResourceTitles } from "./catalog-reader.js";
import { openDb, escapeLike } from "./db.js";
import { logosRawToHuman } from "./logos-books.js";
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
      SELECT r.ResourceId, n.AnchorsJson, s.Name AS StyleName, n.ModifiedDate
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
    }>;

    return rows.map((r) => ({
      resourceId: r.ResourceId ?? "",
      textRange: r.AnchorsJson ?? "",
      styleName: r.StyleName ?? "",
      syncDate: r.ModifiedDate,
      resourceTitle: null, // filled in by withResourceTitles below
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

    if (options.limit) {
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

    return filterNotesByPassage(notes, options.passage);
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
