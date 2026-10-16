import { DB_PATHS } from "../config.js";
import { openDb } from "./db.js";
import { parseReference } from "./reference-parser.js";
import type { KnowledgeEntry, KnowledgeResolution, GuideTargetResolution } from "../types.js";

// Factbook entries and topic guides are addressed by knowledge-base IDs such
// as "bk.#Moses" (person), "bk.%Sabbath" (topic), "bk.@Abana" (place) or
// "bk.to:DBT-5333" (preaching theme); a plain name opens nothing (design doc
// F6). Logos's AutoComplete.db maps display names to those IDs.

/** Whether the input is already a knowledge-base ID (starts with "bk."). */
export function isKnowledgeId(input: string): boolean {
  return input.trim().startsWith("bk.");
}

interface LabelRow {
  Id: string;
  Label: string;
  Kind: string | null;
  Description: string | null;
}

function labelQuery(where: string): string {
  return `
      SELECT t.Reference AS Id, l.LabelText AS Label, k.IconKind AS Kind,
             (SELECT d.Description
                FROM Descriptions d
                LEFT JOIN Languages g ON g.LanguageId = d.LanguageId
               WHERE d.TermId = t.TermId
               ORDER BY CASE WHEN g.Language = 'en' THEN 0 ELSE 1 END, d.DescriptionId
               LIMIT 1) AS Description
      FROM Labels l
      JOIN Terms t ON t.TermId = l.TermId
      LEFT JOIN IconKinds k ON k.IconKindId = t.IconKindId
      WHERE ${where}
      ORDER BY l.IsPrimary DESC, t.TermId
    `;
}

// Case folding that covers accented letters too ("É" = "é").
function foldCase(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

/**
 * Find every knowledge-base entry whose label equals `name`, ignoring case
 * (accented letters included).
 *
 * One entry per ID (Labels has a row per language), primary labels first,
 * English descriptions preferred. SQLite's NOCASE folds only A-Z, and about
 * 16% of real labels carry accents, so a name with non-ASCII letters that
 * NOCASE misses is retried with full case folding (a slower scan, only on that
 * path).
 *
 * @param name - Display name to look up, e.g. "Moses".
 * @returns Matching entries; empty when none match.
 * @throws When AutoComplete.db is missing; resolveKnowledgeId reports that.
 */
export function lookupKnowledgeIds(name: string): KnowledgeEntry[] {
  const db = openDb(DB_PATHS.autoComplete);
  try {
    const trimmed = name.trim();
    let rows = db.prepare(labelQuery("l.LabelText = ? COLLATE NOCASE")).all(trimmed) as LabelRow[];
    // The fold-case fallback runs only after a NOCASE miss, so an ASCII-case
    // match masks an accent-case sibling (e.g. "Émile" hits "ÉMILE" and hides "émile").
    if (rows.length === 0 && /[^\x00-\x7F]/.test(trimmed)) {
      // Registered on this read-only connection only; nothing is written.
      db.function("fold_case", { deterministic: true }, (s: unknown) =>
        typeof s === "string" ? foldCase(s) : null
      );
      rows = db.prepare(labelQuery("fold_case(l.LabelText) = ?")).all(foldCase(trimmed)) as LabelRow[];
    }

    const seen = new Set<string>();
    const entries: KnowledgeEntry[] = [];
    for (const r of rows) {
      if (seen.has(r.Id)) continue;
      seen.add(r.Id);
      entries.push({ id: r.Id, label: r.Label, kind: r.Kind, description: r.Description });
    }
    return entries;
  } finally {
    db.close();
  }
}

/**
 * Turn a name or ID into one knowledge-base entry. An input starting "bk." is
 * used as-is (no lookup). Never throws: a missing lookup table comes back as
 * "unavailable".
 *
 * @param input - Display name or knowledge-base ID.
 * @param options - `kinds` keeps only entries of those IconKinds.
 */
export function resolveKnowledgeId(
  input: string,
  options: { kinds?: string[] } = {}
): KnowledgeResolution {
  const trimmed = input.trim();
  if (isKnowledgeId(trimmed)) {
    return { status: "resolved", entry: { id: trimmed, label: trimmed, kind: null, description: null } };
  }

  let matches: KnowledgeEntry[];
  try {
    matches = lookupKnowledgeIds(trimmed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      status: "unavailable",
      message: msg.startsWith("Database not found")
        ? `Logos's lookup table was not found (${DB_PATHS.autoComplete}). Ask the user to open Logos once so it builds the table, then try again — or pass a knowledge-base ID such as "bk.#Moses" directly.`
        : `Logos's lookup table could not be read: ${msg}`,
    };
  }

  const { kinds } = options;
  if (kinds) {
    matches = matches.filter((m) => m.kind !== null && kinds.includes(m.kind));
  }
  if (matches.length === 1) return { status: "resolved", entry: matches[0] };
  if (matches.length > 1) return { status: "ambiguous", matches };
  return { status: "not_found" };
}

// Guides whose subject is a knowledge-base entry rather than a Bible
// reference, with the entry kinds each accepts.
const KB_GUIDE_KINDS: Record<string, string[]> = {
  "topic guide": ["Topic"],
  "sermon starter guide": ["PreachingTheme"],
};

/**
 * Decide what a guide link should point at: a knowledge-base ID (given
 * directly, or looked up for topic-style guides) or a Bible reference. Never
 * throws.
 *
 * @param guideType - Guide name, e.g. "Topic Guide".
 * @param reference - Bible reference, subject name, or knowledge-base ID.
 */
export function resolveGuideTarget(guideType: string, reference: string): GuideTargetResolution {
  const trimmed = reference.trim();
  if (isKnowledgeId(trimmed)) return resolveKnowledgeId(trimmed);

  const kinds = KB_GUIDE_KINDS[guideType.trim().toLowerCase()];
  if (kinds) return resolveKnowledgeId(trimmed, { kinds });

  try {
    parseReference(trimmed);
    return { status: "bible", reference: trimmed };
  } catch (e) {
    return { status: "invalid", message: e instanceof Error ? e.message : String(e) };
  }
}
