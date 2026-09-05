import { BIBLIA_API_KEY, BIBLIA_API_BASE, DEFAULT_BIBLE } from "../config.js";
import { expandRange, parseReference } from "./reference-parser.js";
import type { BibleTextResult, BibleSearchResult, BibleSearchHit, ScanResult, CompareResult, BibleInfo } from "../types.js";

async function bibliaFetch(path: string, params: Record<string, string>): Promise<unknown> {
  if (!BIBLIA_API_KEY) {
    throw new Error("BIBLIA_API_KEY is not set. Get a free key at https://bibliaapi.com");
  }

  const url = new URL(`${BIBLIA_API_BASE}${path}`);
  url.searchParams.set("key", BIBLIA_API_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Error bodies can be full HTML blobs — keep the message digestible.
    const snippet = body.length > 200 ? `${body.slice(0, 200)}…` : body;
    throw new Error(`Biblia API error ${res.status}: ${snippet}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

export async function getBibleText(
  passage: string,
  bible: string = DEFAULT_BIBLE
): Promise<BibleTextResult> {
  // Biblia version codes are uppercase; accept any case from callers.
  bible = bible.toUpperCase();
  const text = await bibliaFetch(`/content/${bible}.txt`, { passage });
  return {
    passage,
    text: String(text).trim(),
    bible,
  };
}

// Biblia returns resultCount: -1 when the total is unknown; fall back to the
// number of results actually returned in that case.
export function normalizeResultCount(
  resultCount: number | null | undefined,
  resultsLength: number
): number {
  return resultCount != null && resultCount >= 0 ? resultCount : resultsLength;
}

/**
 * Biblia treats a multi-word query as OR over the individual terms, so
 * "traditions delivered handed down" matches any verse containing "hand" or
 * "reed". Double-quoting the query switches Biblia to phrase matching.
 * Exported for testing.
 */
export function buildSearchQuery(query: string, match: "any" | "phrase" = "any"): string {
  if (match !== "phrase") return query;
  const trimmed = query.trim();
  // Already explicitly quoted by the caller — don't double-wrap.
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 1) {
    return trimmed;
  }
  return `"${trimmed}"`;
}

export async function searchBible(
  query: string,
  options: { bible?: string; limit?: number; mode?: string; match?: "any" | "phrase" } = {}
): Promise<BibleSearchResult> {
  const bible = (options.bible ?? DEFAULT_BIBLE).toUpperCase();
  const data = await bibliaFetch(`/search/${bible}`, {
    query: buildSearchQuery(query, options.match ?? "any"),
    mode: options.mode ?? "verse",
    limit: String(options.limit ?? 20),
  }) as { resultCount: number; results: Array<{ title: string; preview: string }> };

  const results = data.results ?? [];
  return {
    query: buildSearchQuery(query, options.match ?? "any"),
    resultCount: normalizeResultCount(data.resultCount, results.length),
    results: results.map((r): BibleSearchHit => ({
      title: r.title ?? "",
      preview: r.preview ?? "",
    })),
  };
}

// ─── Chapter-end clamping ───────────────────────────────────────────────────

// Highest existing verse per chapter, keyed "Book|chapter". Only written when
// an overshoot is actually detected, so the stored value is the true last verse
// of the chapter. Chapter lengths don't change, so this is safe for the life of
// the process.
const chapterEndCache = new Map<string, number>();

/** Whether Biblia recognises this verse. /parse returns an empty passage for
 *  references past the end of a chapter. Exported for testing. */
export async function verseExists(book: string, chapter: number, verse: number): Promise<boolean> {
  try {
    const data = (await bibliaFetch("/parse", {
      passage: `${book} ${chapter}:${verse}`,
    })) as { passage?: string };
    return Boolean(data.passage);
  } catch {
    return false;
  }
}

/**
 * Highest verse that actually exists in `chapter`, at or below `desiredEnd` and
 * never below `floor`. Walks downward, so the common case (no overshoot) never
 * calls this at all.
 */
export async function resolveChapterEnd(
  book: string,
  chapter: number,
  desiredEnd: number,
  floor: number
): Promise<number> {
  const key = `${book}|${chapter}`;
  const cached = chapterEndCache.get(key);
  if (cached !== undefined) return Math.max(Math.min(cached, desiredEnd), floor);

  for (let v = desiredEnd; v > floor; v--) {
    if (await verseExists(book, chapter, v)) {
      // v exists and v+1 did not, so v is the chapter's last verse.
      chapterEndCache.set(key, v);
      return v;
    }
  }
  return floor;
}

/**
 * A passage plus surrounding verses. `expandRange` clamps the lower bound to
 * verse 1 but cannot clamp the upper bound without knowing the chapter length,
 * so an expansion near the end of a chapter asks Biblia for a verse that does
 * not exist and 404s (e.g. 1 Timothy 3:15 +5 -> 3:20, but the chapter ends at
 * 16). Rather than pay a lookup on every call, we let the 404 happen and clamp
 * only on that path.
 */
export async function getPassageWithContext(
  passage: string,
  contextVerses: number,
  bible?: string
): Promise<BibleTextResult> {
  const expanded = expandRange(passage, contextVerses);
  try {
    return await getBibleText(expanded, bible);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("404")) throw e;

    const ref = parseReference(passage);
    // Only single-chapter expansions can be clamped this way.
    if (ref.verse === undefined || (ref.endChapter && ref.endChapter !== ref.chapter)) {
      throw e;
    }

    const centreEnd = ref.endVerse ?? ref.verse;
    const end = await resolveChapterEnd(
      ref.book,
      ref.chapter,
      centreEnd + contextVerses,
      centreEnd
    );
    const start = Math.max(1, ref.verse - contextVerses);
    return await getBibleText(`${ref.book} ${ref.chapter}:${start}-${end}`, bible);
  }
}

export async function parsePassage(text: string): Promise<string> {
  const data = await bibliaFetch("/parse", { passage: text }) as { passage: string };
  return data.passage ?? text;
}

// ─── Scan References ────────────────────────────────────────────────────────

export async function scanReferences(
  text: string,
  tagChapters: boolean = true
): Promise<ScanResult[]> {
  const data = await bibliaFetch("/scan", {
    text,
    tagChapters: String(tagChapters),
  }) as { results: Array<{ passage: string; textIndex: number; textLength: number }> };

  return (data.results ?? []).map((r) => ({ passage: r.passage }));
}

// ─── Compare Passages ───────────────────────────────────────────────────────

export async function comparePassages(
  first: string,
  second: string
): Promise<CompareResult> {
  const data = await bibliaFetch("/compare", {
    first,
    second,
  }) as CompareResult;

  return {
    equal: data.equal ?? false,
    intersects: data.intersects ?? false,
    subset: data.subset ?? false,
    superset: data.superset ?? false,
    before: data.before ?? false,
    after: data.after ?? false,
  };
}

// ─── Get Available Bibles ───────────────────────────────────────────────────

export async function getAvailableBibles(
  query?: string
): Promise<BibleInfo[]> {
  const params: Record<string, string> = {};
  if (query) {
    params.query = query;
  }

  const data = await bibliaFetch("/find", params) as { bibles: BibleInfo[] };

  return data.bibles ?? [];
}
