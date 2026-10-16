import type Database from "better-sqlite3";
import { DB_PATHS } from "../config.js";
import { openDb, hasTable } from "./db.js";
import { logosRawToHuman } from "./logos-books.js";
import { getResourceTitles, getResourceIdsOfType } from "./catalog-reader.js";
import type { PlanReading, PlanSession, ReadingPlan, ResourceReadingProgressEntry } from "../types.js";

// Readers for study data Logos keeps locally beyond notes and highlights.
// Each returns null when its store is absent (older Logos versions), so tools
// can say "not available" instead of failing.

// Open a store only if it has the table the reader needs; null otherwise.
function openIfPresent(path: string, table: string): Database.Database | null {
  try {
    const db = openDb(path);
    if (hasTable(db, table)) return db;
    db.close();
  } catch {
    // store absent or unreadable
  }
  return null;
}

function parseJsonObject(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ─── Reading plans ───────────────────────────────────────────────────────────

/**
 * Converts a .NET GUID to the 32-char lowercase hex ReadingPlanStatus.SyncId
 * uses. .NET writes a GUID's first three fields little-endian, so a 16-byte
 * ScheduleId blob has them byte-swapped (bytes 46 e9 0a d8 71 73 ee 41 …
 * become "d80ae946737141ee…"). Also accepts a GUID string. Returns null for
 * anything else; never throws.
 */
export function dotnetGuidBytesToHex(value: unknown): string | null {
  if (Buffer.isBuffer(value)) {
    if (value.length !== 16) return null;
    const order = [3, 2, 1, 0, 5, 4, 7, 6, 8, 9, 10, 11, 12, 13, 14, 15];
    return order.map((i) => value[i].toString(16).padStart(2, "0")).join("");
  }
  if (typeof value === "string") {
    const hex = value.replace(/[{}-]/g, "").toLowerCase();
    return /^[0-9a-f]{32}$/.test(hex) ? hex : null;
  }
  return null;
}

const PAGE_RE = /^page\.(\d+)(?:-(\d+))?$/;

/**
 * Readable form of a reading-plan reference: a Bible reference
 * ("bible+csb2.87.22" -> "Revelation 22"), a page range ("page.9-13" ->
 * "pp 9-13"), or the raw string. Never throws.
 */
export function formatPlanReference(raw: string): string {
  const bible = logosRawToHuman(raw);
  if (bible) return bible;
  const page = raw.match(PAGE_RE);
  if (page) return page[2] ? `pp ${page[1]}-${page[2]}` : `p ${page[1]}`;
  return raw;
}

/** Formats a date (default: now) as YYYY-MM-DD in local time. */
export function localDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Sessions JSON: [{date, readings: [[{resourceId, reference}]]}]. Malformed
// entries become sessions without readings. Never throws.
function parseSessions(json: string | null): PlanSession[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.map((entry, index) => {
    const session = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const date = typeof session.date === "string" ? session.date.slice(0, 10) : null;
    const readings: PlanReading[] = [];
    const groups = Array.isArray(session.readings) ? session.readings : [];
    for (const group of groups) {
      for (const item of Array.isArray(group) ? group : [group]) {
        if (typeof item !== "object" || item === null) continue;
        const { resourceId, reference } = item as Record<string, unknown>;
        if (typeof reference !== "string") continue;
        readings.push({
          resourceId: typeof resourceId === "string" ? resourceId : null,
          rawReference: reference,
          reference: formatPlanReference(reference),
        });
      }
    }
    return { index, date, readings };
  });
}

// ReadingPlanStatus.ReadSessions is the index of the last completed session,
// inclusive — not a count (design doc F16). -1 means nothing read; null means
// the value isn't a plain non-negative integer (progress unknown).
function lastReadIndex(readSessions: string | null): number | null {
  if (readSessions === null || readSessions.trim() === "") return -1;
  const s = readSessions.trim();
  return /^\d+$/.test(s) ? parseInt(s, 10) : null;
}

function daysBehind(scheduled: string | null, today: string): number | null {
  if (!scheduled) return null;
  const diff = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${scheduled}T00:00:00Z`)) / 86_400_000
  );
  return Number.isFinite(diff) && diff > 0 ? diff : null;
}

interface PlanDocumentRow {
  DocumentId: string;
  Title: string | null;
  Settings: string | null;
  ScheduleId: unknown;
  Sessions: string | null;
}

function buildPlan(
  doc: PlanDocumentRow,
  readSessionsBySyncId: Map<string, string | null>,
  today: string
): ReadingPlan {
  const settings = parseJsonObject(doc.Settings);
  const sessions = parseSessions(doc.Sessions);
  const withReadings = sessions.filter((s) => s.readings.length > 0);
  const syncId = dotnetGuidBytesToHex(doc.ScheduleId);
  // No status row = the plan has read nothing.
  const rawStatus = syncId !== null ? readSessionsBySyncId.get(syncId) ?? null : null;
  const lastRead = lastReadIndex(rawStatus);

  const base = {
    documentId: doc.DocumentId,
    title: doc.Title ?? "(untitled plan)",
    resourceId: typeof settings?.resourceId === "string" ? settings.resourceId : null,
    resourceTitle: null,
    startDate: typeof settings?.startDate === "string" ? settings.startDate : null,
    settings,
    sessionsWithReadings: withReadings.length,
  };

  if (lastRead === null) {
    return {
      ...base,
      sessionsRead: null,
      unparsedReadSessions: rawStatus,
      nextReading: null,
      daysBehind: null,
      completed: false,
    };
  }

  const nextReading = withReadings.find((s) => s.index > lastRead) ?? null;
  return {
    ...base,
    sessionsRead: withReadings.filter((s) => s.index <= lastRead).length,
    unparsedReadSessions: null,
    nextReading,
    daysBehind: nextReading ? daysBehind(nextReading.date, today) : null,
    completed: nextReading === null && withReadings.length > 0,
  };
}

/**
 * The user's reading plans with progress. `today` (YYYY-MM-DD) sets "days
 * behind". Returns null when ReadingPlan.db is absent (callers fall back to
 * the older ReadingLists.db store).
 */
export function getReadingPlans(today: string = localDate()): ReadingPlan[] | null {
  const db = openIfPresent(DB_PATHS.readingPlans, "ReadingPlanDocuments");
  if (!db) return null;
  try {
    const readSessionsBySyncId = new Map<string, string | null>();
    if (hasTable(db, "ReadingPlanStatus")) {
      const statuses = db.prepare(`
        SELECT SyncId, ReadSessions FROM ReadingPlanStatus
        WHERE IsDeleted = 0
        ORDER BY julianday(ModifiedDate)
      `).all() as Array<{ SyncId: string; ReadSessions: string | null }>;
      for (const s of statuses) {
        readSessionsBySyncId.set(s.SyncId.toLowerCase(), s.ReadSessions); // latest row wins
      }
    }

    const docs = db.prepare(`
      SELECT DocumentId, Title, Settings, ScheduleId, Sessions
      FROM ReadingPlanDocuments
      WHERE IsDeleted = 0
      ORDER BY julianday(ModifiedDate) DESC
    `).all() as PlanDocumentRow[];

    const plans = docs.map((d) => buildPlan(d, readSessionsBySyncId, today));
    const titles = getResourceTitles(
      plans.map((p) => p.resourceId).filter((id): id is string => id !== null)
    );
    return plans.map((p) => ({
      ...p,
      resourceTitle: p.resourceId ? titles.get(p.resourceId) ?? null : null,
    }));
  } finally {
    db.close();
  }
}

// ─── Per-book reading progress ───────────────────────────────────────────────

/**
 * How far the user has read in each book, from Logos's reading tracker.
 * PercentageRead is stored as a 0-1 fraction and reported as a percent with one
 * decimal. `limit` applies after sorting and type filtering.
 *
 * @returns The entries, or null when the tracker store is absent.
 */
export function getResourceReadingProgress(options: {
  sort?: "recent" | "percent";
  type?: string;
  limit?: number;
} = {}): ResourceReadingProgressEntry[] | null {
  const db = openIfPresent(DB_PATHS.readingProgress, "ReadingStatus");
  if (!db) return null;
  try {
    // ModifiedDate mixes UTC offsets (-05:00 and -04:00 on the test install),
    // so "latest" compares instants via julianday(), never the text.
    const lastRead = hasTable(db, "ResourceReadingProgress")
      ? `(SELECT p.ModifiedDate FROM ResourceReadingProgress p
          WHERE p.ResourceId = s.ResourceId AND p.IsDeleted = 0
          ORDER BY julianday(p.ModifiedDate) DESC LIMIT 1)`
      : "NULL";
    const order = options.sort === "percent"
      ? "s.PercentageRead DESC"
      : "LastRead IS NULL, julianday(LastRead) DESC";
    let rows = db.prepare(`
      SELECT s.ResourceId, s.PercentageRead, ${lastRead} AS LastRead
      FROM ReadingStatus s
      ORDER BY ${order}, s.ResourceId
    `).all() as Array<{ ResourceId: string; PercentageRead: number; LastRead: string | null }>;

    if (options.type) {
      const ids = getResourceIdsOfType(options.type);
      rows = rows.filter((r) => ids.has(r.ResourceId));
    }
    if (options.limit) rows = rows.slice(0, options.limit);

    const titles = getResourceTitles(rows.map((r) => r.ResourceId));
    return rows.map((r) => ({
      resourceId: r.ResourceId,
      title: titles.get(r.ResourceId) ?? null,
      percentRead: Math.round(r.PercentageRead * 1000) / 10,
      lastReadDate: r.LastRead,
    }));
  } finally {
    db.close();
  }
}
