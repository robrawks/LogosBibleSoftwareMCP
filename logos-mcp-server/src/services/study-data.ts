import type Database from "better-sqlite3";
import { DB_PATHS } from "../config.js";
import { openDb, hasTable, escapeLike } from "./db.js";
import { logosRawToHuman, parseLogosBibleRef, logosBookNumber } from "./logos-books.js";
import { parseReference } from "./reference-parser.js";
import { getResourceTitles, getResourceIdsOfType } from "./catalog-reader.js";
import { decodeLogosBlob } from "../utils/clippings.js";
import type { HistoryBookmark, HistoryConfirmation, HistoryTarget, HistoryVisit, PassageList, PassageListEntry, PlanReading, PlanSession, ReadingPlan, ResourceReadingProgressEntry } from "../types.js";

// Readers for study data Logos keeps locally beyond notes and highlights.
// Each returns null when its store is absent (older Logos versions), so tools
// can say "not available" instead of failing.

// Open a store only if it has the table the reader needs; null otherwise.
function openIfPresent(path: string, table: string): Database.Database | null {
  let db: Database.Database;
  try {
    db = openDb(path);
  } catch {
    return null; // store absent or unreadable
  }
  try {
    if (hasTable(db, table)) return db;
  } catch {
    // corrupt or locked: the first query fails, not the open
  }
  db.close();
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

// ─── Browsing history ────────────────────────────────────────────────────────

// "Kind|Key=Value|…" → the kind and the fields, values as stored. Never throws.
function splitBookmark(bookmark: string): { kind: string; values: Map<string, string> } {
  const [kind, ...fields] = bookmark.split("|");
  const values = new Map<string, string>();
  for (const field of fields) {
    const eq = field.indexOf("=");
    if (eq > 0) values.set(field.slice(0, eq), field.slice(eq + 1));
  }
  return { kind: kind ?? "", values };
}

/**
 * Parse a History.Bookmark string ("Kind|Key=Value|…", e.g.
 * "Resource|Id=LLS:LEB|…|Reference=bible+leb2.65.3.21"). Never throws.
 */
export function parseHistoryBookmark(bookmark: string): HistoryBookmark {
  const { kind, values } = splitBookmark(bookmark);
  return {
    kind,
    resourceId: kind === "Resource" ? values.get("Id") || null : null,
    rawReference: values.get("Reference") || null,
  };
}

interface HistoryRow {
  Id: string;
  Title: string;
  Subtitle: string;
  LastVisited: string;
  Bookmark: string;
}

function historyRowToVisit(r: HistoryRow): HistoryVisit {
  const bookmark = parseHistoryBookmark(r.Bookmark);
  return {
    id: r.Id,
    title: r.Title,
    subtitle: r.Subtitle || null,
    lastVisited: r.LastVisited,
    kind: bookmark.kind,
    resourceId: bookmark.resourceId,
    rawReference: bookmark.rawReference,
    reference: bookmark.rawReference ? logosRawToHuman(bookmark.rawReference) : null,
  };
}

/**
 * The user's Logos browsing history, newest first. `since` is compared with
 * the stored UTC ISO LastVisited, so a date ("2026-10-01") or a full
 * timestamp both work. Null when history.db is absent.
 */
export function getReadingHistory(options: {
  since?: string;
  resourceId?: string;
  limit?: number;
} = {}): HistoryVisit[] | null {
  const db = openIfPresent(DB_PATHS.history, "History");
  if (!db) return null;
  try {
    let sql = "SELECT Id, Title, Subtitle, LastVisited, Bookmark FROM History WHERE IsDeleted = 0";
    const params: unknown[] = [];
    if (options.since) {
      sql += " AND LastVisited >= ?";
      params.push(options.since);
    }
    if (options.resourceId) {
      // Exact ID match: "Resource|Id=LLS:LEB|…" but not "…Id=LLS:LEB2|…".
      sql += " AND (Bookmark LIKE ? ESCAPE '\\' OR Bookmark = ?)";
      params.push(`Resource|Id=${escapeLike(options.resourceId)}|%`, `Resource|Id=${options.resourceId}`);
    }
    sql += " ORDER BY LastVisited DESC";
    if (options.limit) {
      sql += " LIMIT ?";
      params.push(options.limit);
    }

    const rows = db.prepare(sql).all(...params) as HistoryRow[];
    return rows.map(historyRowToVisit);
  } finally {
    db.close();
  }
}

// ─── Passage lists ───────────────────────────────────────────────────────────

/**
 * CompressedItems -> passages. The blob is a Logos blob (5-byte header, F17)
 * holding [{"ref":"bible.18.10.21-18.10.22"}, …]. Empty on any decode or
 * parse failure; never throws.
 */
export function parsePassageItems(blob: Buffer | null): PassageListEntry[] {
  const decoded = decodeLogosBlob(blob);
  if (!decoded) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const entries: PassageListEntry[] = [];
  for (const item of parsed) {
    const ref = typeof item === "object" && item !== null ? (item as Record<string, unknown>).ref : undefined;
    if (typeof ref !== "string") continue;
    entries.push({ rawReference: ref, reference: logosRawToHuman(ref) ?? ref });
  }
  return entries;
}

/** The user's saved passage lists, newest first. Null when PassageList.db is absent. */
export function getPassageLists(): PassageList[] | null {
  const db = openIfPresent(DB_PATHS.passageLists, "PassageLists");
  if (!db) return null;
  try {
    const rows = db.prepare(`
      SELECT Title, ModifiedDate, CompressedItems FROM PassageLists
      WHERE IsDeleted = 0
      ORDER BY julianday(ModifiedDate) DESC
    `).all() as Array<{ Title: string | null; ModifiedDate: string | null; CompressedItems: Buffer | null }>;
    return rows.map((r) => ({
      title: r.Title,
      modifiedDate: r.ModifiedDate,
      passages: parsePassageItems(r.CompressedItems),
    }));
  } finally {
    db.close();
  }
}

// ─── Open confirmation ───────────────────────────────────────────────────────

/** History state just before a link is sent. */
export interface HistorySnapshot {
  /** Ids of the existing history rows for the same kind of target. */
  ids: Set<string>;
  /** Set when Logos is already at the requested location: it then adds no row. */
  alreadyShowing: HistoryVisit | null;
}

type Bookmark = ReturnType<typeof splitBookmark>;

const BOOKMARK_KIND: Record<HistoryTarget["kind"], string> = {
  resource: "Resource",
  guide: "Guides",
  factbook: "Factbook",
  search: "Search",
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// A stored value equals `wanted` as stored or URL-decoded: Logos encodes some
// bookmark fields (a guide's Key) and not others (a Factbook ReportId).
function storedEquals(stored: string | undefined, wanted: string, ignoreCase = false): boolean {
  if (stored === undefined) return false;
  const norm = (s: string) => (ignoreCase ? s.trim().toLowerCase() : s);
  return [stored, safeDecode(stored)].some((s) => norm(s) === norm(wanted));
}

// Whether raw Logos reference `raw` starts at `reference`. Missing
// chapter/verse count as 1.
function startsAt(raw: string | undefined, reference: string): boolean {
  const at = raw ? parseLogosBibleRef(raw)?.start : undefined;
  if (!at) return false;
  try {
    const ref = parseReference(reference);
    return logosBookNumber(ref.book) === at.book && ref.chapter === (at.chapter ?? 1) && (ref.verse ?? 1) === (at.verse ?? 1);
  } catch {
    return false;
  }
}

// Whether a new row with this bookmark shows that the link opened: the same
// resource, guide template, or kind of search, or any Factbook entry. The
// exact location is not required, so a value Logos stores differently can
// cost the "already showing" reply but never a real confirmation.
function matchesIdentity(b: Bookmark, target: HistoryTarget): boolean {
  if (b.kind !== BOOKMARK_KIND[target.kind]) return false;
  switch (target.kind) {
    case "resource":
      return b.values.get("Id") === target.resourceId;
    case "guide":
      return (b.values.get("TemplateName") ?? "").toLowerCase() === target.guideTitle.replace(/\s+/g, "").toLowerCase();
    case "factbook":
      return true;
    case "search":
      return b.values.get("SearchKindName") === target.searchKind;
  }
}

// Whether a bookmark that matches the target's identity is also the
// requested location.
function matchesLocation(b: Bookmark, target: HistoryTarget): boolean {
  switch (target.kind) {
    case "resource":
      return !target.reference || startsAt(b.values.get("Reference"), target.reference);
    case "guide": {
      const key = b.values.get("Key");
      // Sermon Starter Guide ignores its subject and records no Key (PR 1).
      if (!target.subject || key === undefined) return true;
      // Key=BibleReference%7cref%3dbible.64.5.14 → "BibleReference|ref=bible.64.5.14".
      const ref = splitBookmark(safeDecode(key)).values.get("ref");
      return target.subject.kind === "bible"
        ? startsAt(ref, target.subject.reference)
        : storedEquals(ref, target.subject.id);
    }
    case "factbook": {
      const reportId = b.values.get("ReportId");
      return reportId !== undefined && reportId.startsWith("ref:") && storedEquals(reportId.slice(4), target.kbId);
    }
    case "search":
      return storedEquals(b.values.get("QueryText"), target.query, true);
  }
}

// The target's rows (identity match), oldest first. Null when history.db is
// absent.
function readTargetRows(target: HistoryTarget): HistoryRow[] | null {
  const db = openIfPresent(DB_PATHS.history, "History");
  if (!db) return null;
  try {
    // Narrow by the bookmark's leading text; matchesIdentity decides.
    const head = target.kind === "resource" ? `Resource|Id=${target.resourceId}` : BOOKMARK_KIND[target.kind];
    const rows = db.prepare(`
      SELECT Id, Title, Subtitle, LastVisited, Bookmark FROM History
      WHERE IsDeleted = 0 AND (Bookmark LIKE ? ESCAPE '\\' OR Bookmark = ?)
      ORDER BY rowid
    `).all(`${escapeLike(head)}|%`, head) as HistoryRow[];
    return rows.filter((r) => matchesIdentity(splitBookmark(r.Bookmark), target));
  } finally {
    db.close();
  }
}

// Logos inserts a history row when it arrives somewhere and only bumps
// LastVisited on the row it leaves (observed on Logos 54, 2026-10-15), so the
// most recently inserted row (highest rowid), not the newest LastVisited, is
// where Logos is now. Null when history.db is absent or empty.
function getCurrentHistoryRow(): HistoryRow | null {
  const db = openIfPresent(DB_PATHS.history, "History");
  if (!db) return null;
  try {
    const row = db.prepare(`
      SELECT Id, Title, Subtitle, LastVisited, Bookmark FROM History
      WHERE IsDeleted = 0
      ORDER BY rowid DESC
      LIMIT 1
    `).get() as HistoryRow | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

/**
 * Taken just before launching a link to `target`.
 *
 * @param target - What the link will open.
 * @returns The snapshot, or null when history.db is absent or unreadable (the
 *   open then can't be confirmed). Never throws.
 */
export function snapshotHistory(target: HistoryTarget): HistorySnapshot | null {
  try {
    const rows = readTargetRows(target);
    if (rows === null) return null;
    const current = getCurrentHistoryRow();
    const showing =
      current !== null &&
      matchesIdentity(splitBookmark(current.Bookmark), target) &&
      matchesLocation(splitBookmark(current.Bookmark), target);
    return {
      ids: new Set(rows.map((r) => r.Id)),
      alreadyShowing: showing ? historyRowToVisit(current) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Logos records each resource, guide, Factbook entry and search it opens in
 * history.db (design doc F12); when it is busy a link can do nothing at all
 * (F20). Polls history.db (read-only) until a row for `target` appears that
 * is not in `before`. A changed LastVisited on an existing row is ignored:
 * Logos bumps it on the row the user leaves. If Logos was already at the
 * location it adds no row, so that case waits only briefly and reports
 * "already_open". A failed read while polling counts as "not yet".
 *
 * @param target - What the link opened.
 * @param before - The snapshot from `snapshotHistory`; null yields `unavailable`.
 * @param options.timeoutMs - Defaults to 8000 (2000 when already showing).
 * @param options.intervalMs - Poll interval; defaults to 500.
 * @returns The confirmation outcome. Never throws.
 */
export async function waitForHistoryVisit(
  target: HistoryTarget,
  before: HistorySnapshot | null,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<HistoryConfirmation> {
  if (before === null) return { status: "unavailable" };
  const timeoutMs = options.timeoutMs ?? (before.alreadyShowing ? 2000 : 8000);
  const intervalMs = options.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let rows: HistoryRow[] = [];
    try {
      // A failed read while Logos writes (e.g. a transient lock) is "not yet".
      rows = readTargetRows(target) ?? [];
    } catch {
      // retry at the next interval
    }
    const fresh = rows.find((r) => !before.ids.has(r.Id));
    if (fresh) return { status: "confirmed", visit: historyRowToVisit(fresh) };
    if (Date.now() >= deadline) {
      return before.alreadyShowing
        ? { status: "already_open", visit: before.alreadyShowing }
        : { status: "unconfirmed" };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
