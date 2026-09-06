/**
 * documents-reader.ts
 *
 * Read-only access to the user's own Logos documents that live under
 * Documents/<profile>/Documents/: Sermon Builder sermons, reading plans and
 * passage lists. All queries open the SQLite files read-only.
 */

import Database from "better-sqlite3";
import { existsSync } from "fs";
import { DB_PATHS } from "../config.js";
import { decodeClippingBlob, extractClippingText } from "../utils/clippings.js";
import { stripXml } from "../utils/strip-markup.js";
import { bibleRawToHuman } from "./sqlite-reader.js";
import { getResourceTitles } from "./catalog-reader.js";
import type {
  SermonSummary,
  SermonBlock,
  SermonDocument,
  ReadingPlanSummary,
  PassageListSummary,
} from "../types.js";

function openDb(path: string): Database.Database {
  if (!existsSync(path)) throw new Error(`Database not found: ${path}`);
  return new Database(path, { readonly: true, fileMustExist: true });
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ─── Sermons ────────────────────────────────────────────────────────────────

interface SermonRow {
  Id: number;
  Title: string | null;
  Series: string | null;
  SeriesNumber: number | null;
  Language: string | null;
  OccasionsJson: string | null;
  TagsJson: string | null;
  AudienceJson: string | null;
  Description: string | null;
  ModifiedDate: string;
  BlockCount: number;
}

/** Flatten Logos' TagsJson ({referenceTags, topicTags, miscellaneousTags}) to strings. */
export function flattenSermonTags(tagsJson: string | null): string[] {
  const parsed = parseJson<Record<string, unknown>>(tagsJson, {});
  const out: string[] = [];
  for (const v of Object.values(parsed)) {
    if (!Array.isArray(v)) continue;
    for (const t of v) {
      if (typeof t === "string") out.push(t);
      else if (t && typeof t === "object") {
        const o = t as Record<string, unknown>;
        const label = o.title ?? o.name ?? o.text ?? o.reference;
        if (typeof label === "string") out.push(label);
      }
    }
  }
  return out;
}

function rowToSummary(r: SermonRow): SermonSummary {
  return {
    id: r.Id,
    title: r.Title?.trim() || "(sin título)",
    series: r.Series?.trim() || null,
    seriesNumber: r.SeriesNumber ?? null,
    language: r.Language || null,
    occasions: parseJson<Array<{ date?: string; venue?: string; service?: string }>>(r.OccasionsJson, []),
    tags: flattenSermonTags(r.TagsJson),
    audience: parseJson<string[]>(r.AudienceJson, []),
    description: r.Description?.trim() || null,
    modifiedDate: r.ModifiedDate,
    blockCount: r.BlockCount,
  };
}

const SERMON_SELECT = `
  SELECT d.Id, d.Title, d.Series, d.SeriesNumber, d.Language, d.OccasionsJson,
         d.TagsJson, d.AudienceJson, d.Description, d.ModifiedDate,
         (SELECT COUNT(*) FROM Blocks b WHERE b.DocumentId = d.Id AND b.IsDeleted = 0) AS BlockCount
  FROM Documents d
  WHERE d.IsDeleted = 0 AND d.IsTemplate = 0
`;

export function getSermons(options: { query?: string; series?: string; limit?: number } = {}): SermonSummary[] {
  const db = openDb(DB_PATHS.sermons);
  try {
    let sql = SERMON_SELECT;
    const params: unknown[] = [];
    if (options.query) {
      // Title/series/description match, or full-text match in the sermon body.
      sql += ` AND (d.Title LIKE ? ESCAPE '\\' OR d.Series LIKE ? ESCAPE '\\' OR d.Description LIKE ? ESCAPE '\\'
               OR EXISTS (SELECT 1 FROM Blocks b WHERE b.DocumentId = d.Id AND b.IsDeleted = 0 AND b.Content LIKE ? ESCAPE '\\'))`;
      const q = `%${escapeLike(options.query)}%`;
      params.push(q, q, q, q);
    }
    if (options.series) {
      sql += " AND d.Series LIKE ? ESCAPE '\\'";
      params.push(`%${escapeLike(options.series)}%`);
    }
    sql += " ORDER BY d.ModifiedDate DESC LIMIT ?";
    params.push(options.limit ?? 30);
    return (db.prepare(sql).all(...params) as SermonRow[]).map(rowToSummary);
  } finally {
    db.close();
  }
}

/** Decode XAML-ish rich text from a sermon block into plain text. */
export function blockText(content: string | null): string {
  if (!content) return "";
  const text = extractClippingText(content) ?? stripXml(content) ?? "";
  return text
    .replace(/&#xA;|&#10;/g, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

interface BlockRow {
  Kind: string;
  Indent: number;
  Content: string | null;
  PassageJson: string | null;
  ClippingJson: string | null;
}

function blockFromRow(b: BlockRow): SermonBlock {
  let reference: string | null = null;
  let source: string | null = null;
  const passage = parseJson<{ reference?: { raw?: string }; resource?: { title?: string; abbreviatedTitle?: string } } | null>(b.PassageJson, null);
  if (passage) {
    reference = passage.reference?.raw ? bibleRawToHuman(passage.reference.raw) ?? passage.reference.raw : null;
    source = passage.resource?.abbreviatedTitle ?? passage.resource?.title ?? null;
  }
  const clipping = parseJson<{ resource?: { title?: string; abbreviatedTitle?: string }; reference?: { raw?: string } } | null>(b.ClippingJson, null);
  if (clipping && !source) {
    source = clipping.resource?.abbreviatedTitle ?? clipping.resource?.title ?? null;
  }
  return { kind: b.Kind, indent: b.Indent ?? 0, text: blockText(b.Content), reference, source };
}

/** Render sermon blocks as Markdown, preserving the Sermon Builder outline. */
export function blocksToMarkdown(blocks: SermonBlock[]): string {
  const lines: string[] = [];
  let numbered = 0;
  for (const b of blocks) {
    if (b.kind !== "number") numbered = 0;
    const indent = "  ".repeat(Math.max(0, b.indent));
    const text = b.text;
    if (!text && !b.reference) continue;
    switch (b.kind) {
      case "heading1": lines.push(`# ${text}`); break;
      case "heading2": lines.push(`## ${text}`); break;
      case "heading3": lines.push(`### ${text}`); break;
      case "heading4": lines.push(`#### ${text}`); break;
      case "heading5": lines.push(`##### ${text}`); break;
      case "bullet": lines.push(`${indent}- ${text}`); break;
      case "number": numbered += 1; lines.push(`${indent}${numbered}. ${text}`); break;
      case "blockquote": lines.push(`> ${text.replace(/\n/g, "\n> ")}`); break;
      case "passage": {
        const label = [b.reference, b.source].filter(Boolean).join(", ");
        lines.push(`> **${label || "Pasaje"}** ${text}`);
        break;
      }
      case "clipping": lines.push(`> ${text}${b.source ? `\n> — ${b.source}` : ""}`); break;
      case "illustration": lines.push(`*Ilustración:* ${text}`); break;
      case "prompt": lines.push(`_${text}_`); break;
      default: lines.push(`${indent}${text}`);
    }
  }
  return lines.join("\n\n");
}

export function getSermon(selector: { id?: number; title?: string }): SermonDocument | null {
  const db = openDb(DB_PATHS.sermons);
  try {
    let row: SermonRow | undefined;
    if (selector.id !== undefined) {
      row = db.prepare(`${SERMON_SELECT} AND d.Id = ?`).get(selector.id) as SermonRow | undefined;
    } else if (selector.title) {
      row = db.prepare(`${SERMON_SELECT} AND d.Title = ? COLLATE NOCASE ORDER BY d.ModifiedDate DESC`).get(selector.title) as SermonRow | undefined
        ?? db.prepare(`${SERMON_SELECT} AND d.Title LIKE ? ESCAPE '\\' ORDER BY d.ModifiedDate DESC`).get(`%${escapeLike(selector.title)}%`) as SermonRow | undefined;
    }
    if (!row) return null;
    const blocks = (db.prepare(
      "SELECT Kind, Indent, Content, PassageJson, ClippingJson FROM Blocks WHERE DocumentId = ? AND IsDeleted = 0 ORDER BY Rank"
    ).all(row.Id) as BlockRow[]).map(blockFromRow);
    return { ...rowToSummary(row), blocks, markdown: blocksToMarkdown(blocks) };
  } finally {
    db.close();
  }
}

// ─── Reading plans ──────────────────────────────────────────────────────────

interface PlanRow {
  Id: number;
  DocumentId: string;
  ScheduleId: Buffer | null;
  Title: string | null;
  Settings: string | null;
  Sessions: string | null;
  ModifiedDate: string | null;
}

interface PlanSession {
  date: string;
  readings?: Array<Array<{ resourceId?: string; reference?: string }>>;
}

/** "0-4, 7, 9-10" → set of session indexes that were read. */
export function parseReadSessions(spec: string | null): Set<number> {
  const out = new Set<number>();
  if (!spec) return out;
  for (const part of spec.split(/[,\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    for (let i = a; i <= b; i++) out.add(i);
  }
  return out;
}

function describeFrequency(settings: { frequency?: { mode?: string; days?: string } } | null): string | null {
  const f = settings?.frequency;
  if (!f) return null;
  if (f.mode === "everyDay") return "every day";
  return f.days ? `${f.mode ?? ""} ${f.days}`.trim() : f.mode ?? null;
}

function readingLabel(reading: Array<{ resourceId?: string; reference?: string }> | undefined): string {
  if (!reading || reading.length === 0) return "";
  return reading
    .map((r) => {
      const ref = r.reference ?? "";
      return ref.startsWith("bible") ? bibleRawToHuman(ref) ?? ref : ref;
    })
    .join("; ");
}

export function getReadingPlans(options: { includeArchived?: boolean } = {}): ReadingPlanSummary[] {
  const db = openDb(DB_PATHS.readingPlans);
  try {
    const plans = db.prepare(
      "SELECT Id, DocumentId, ScheduleId, Title, Settings, Sessions, ModifiedDate FROM ReadingPlanDocuments WHERE IsDeleted = 0 ORDER BY ModifiedDate DESC"
    ).all() as PlanRow[];
    // Status rows are keyed by SyncId = the plan's ScheduleId GUID, which the
    // Documents table stores as a 16-byte .NET GUID blob (mixed-endian).
    const statusRows = db.prepare(
      "SELECT SyncId, ReadSessions, IsArchived FROM ReadingPlanStatus WHERE IsDeleted = 0 ORDER BY ModifiedDate"
    ).all() as Array<{ SyncId: string; ReadSessions: string | null; IsArchived: number | null }>;
    const status = new Map<string, { ReadSessions: string | null; IsArchived: number | null }>();
    for (const s of statusRows) status.set(planKey(s.SyncId), s);

    const resourceIds = new Set<string>();
    const parsed = plans.map((p) => {
      const settings = parseJson<{ resourceId?: string; startDate?: string; frequency?: { mode?: string; days?: string } } | null>(p.Settings, null);
      if (settings?.resourceId) resourceIds.add(settings.resourceId);
      return { p, settings, sessions: parseJson<PlanSession[]>(p.Sessions, []) };
    });
    const titles = resourceIds.size > 0 ? safeResourceTitles([...resourceIds]) : new Map<string, string | null>();

    return parsed
      .map(({ p, settings, sessions }) => {
        const st = p.ScheduleId ? status.get(guidBlobToHex(p.ScheduleId)) : undefined;
        const read = parseReadSessions(st?.ReadSessions ?? null);
        let nextUnread: ReadingPlanSummary["nextUnread"] = null;
        for (let i = 0; i < sessions.length; i++) {
          if (!read.has(i)) {
            nextUnread = { date: sessions[i].date, reading: readingLabel(sessions[i].readings?.[0]) };
            break;
          }
        }
        return {
          id: p.Id,
          title: p.Title?.trim() || "(sin título)",
          resourceId: settings?.resourceId ?? null,
          resourceTitle: settings?.resourceId ? titles.get(settings.resourceId) ?? null : null,
          startDate: settings?.startDate ?? null,
          frequency: describeFrequency(settings),
          totalSessions: sessions.length,
          readSessions: [...read].filter((i) => i < sessions.length).length,
          firstDate: sessions[0]?.date ?? null,
          lastDate: sessions[sessions.length - 1]?.date ?? null,
          nextUnread,
          isArchived: (st?.IsArchived ?? 0) === 1,
          modifiedDate: p.ModifiedDate,
        };
      })
      .filter((plan) => options.includeArchived || !plan.isArchived);
  } finally {
    db.close();
  }
}

/** Normalise a GUID string to bare lower-case hex. */
export function planKey(id: string): string {
  return (id.split(":").pop() ?? id).replace(/-/g, "").toLowerCase();
}

/**
 * .NET stores a GUID as 16 bytes with the first three groups little-endian:
 * blob f54fe519 5ec2 184d 8704… ↔ GUID 19e54ff5-c25e-4d18-8704…
 */
export function guidBlobToHex(blob: Buffer | Uint8Array): string {
  const b = Buffer.from(blob);
  if (b.length !== 16) return b.toString("hex").toLowerCase();
  const swap = (from: number, to: number) => Buffer.from(b.subarray(from, to)).reverse().toString("hex");
  return (swap(0, 4) + swap(4, 6) + swap(6, 8) + b.subarray(8).toString("hex")).toLowerCase();
}

function safeResourceTitles(ids: string[]): Map<string, string | null> {
  try {
    return getResourceTitles(ids);
  } catch {
    return new Map();
  }
}

// ─── Passage lists ──────────────────────────────────────────────────────────

export function decodePassageListItems(blob: Buffer | null): string[] {
  const json = decodeClippingBlob(blob);
  const items = parseJson<Array<{ ref?: string }>>(json, []);
  return items
    .map((it) => (it.ref ? bibleRawToHuman(it.ref) ?? it.ref : null))
    .filter((x): x is string => Boolean(x));
}

export function getPassageLists(options: { query?: string; limit?: number; withItems?: boolean } = {}): PassageListSummary[] {
  const db = openDb(DB_PATHS.passageLists);
  try {
    let sql = "SELECT Id, Title, CompressedItems, ModifiedDate FROM PassageLists WHERE IsDeleted = 0";
    const params: unknown[] = [];
    if (options.query) {
      sql += " AND Title LIKE ? ESCAPE '\\'";
      params.push(`%${escapeLike(options.query)}%`);
    }
    sql += " ORDER BY ModifiedDate DESC LIMIT ?";
    params.push(options.limit ?? 30);
    const rows = db.prepare(sql).all(...params) as Array<{ Id: number; Title: string | null; CompressedItems: Buffer | null; ModifiedDate: string | null }>;
    return rows.map((r) => {
      const refs = decodePassageListItems(r.CompressedItems);
      return {
        id: r.Id,
        title: r.Title?.trim() || "(sin título)",
        itemCount: refs.length,
        modifiedDate: r.ModifiedDate,
        references: options.withItems ? refs : [],
      };
    });
  } finally {
    db.close();
  }
}
