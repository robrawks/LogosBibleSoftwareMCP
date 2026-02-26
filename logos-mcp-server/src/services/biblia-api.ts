import { BIBLIA_API_KEY, BIBLIA_API_BASE, DEFAULT_BIBLE } from "../config.js";
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
    throw new Error(`Biblia API error ${res.status}: ${body}`);
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
  const text = await bibliaFetch(`/content/${bible}.txt`, { passage });
  return {
    passage,
    text: String(text).trim(),
    bible,
  };
}

export async function searchBible(
  query: string,
  options: { bible?: string; limit?: number; mode?: string } = {}
): Promise<BibleSearchResult> {
  const bible = options.bible ?? DEFAULT_BIBLE;
  const data = await bibliaFetch(`/search/${bible}`, {
    query,
    mode: options.mode ?? "verse",
    limit: String(options.limit ?? 20),
  }) as { resultCount: number; results: Array<{ title: string; preview: string }> };

  return {
    query,
    resultCount: data.resultCount ?? 0,
    results: (data.results ?? []).map((r): BibleSearchHit => ({
      title: r.title ?? "",
      preview: r.preview ?? "",
    })),
  };
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
