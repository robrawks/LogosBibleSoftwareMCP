import { execFile } from "child_process";
import { promisify } from "util";
import { toLogosUrlRef } from "./reference-parser.js";
import type { LogosCommandResult } from "../types.js";

const execFileAsync = promisify(execFile);

async function openUrl(url: string): Promise<LogosCommandResult> {
  try {
    if (process.platform === "win32") {
      // rundll32 takes the URL as one argument — avoids cmd.exe mangling
      // the `&` in query strings that `start` would require escaping for.
      await execFileAsync("rundll32", ["url.dll,FileProtocolHandler", url]);
    } else {
      await execFileAsync("open", [url]);
    }
    return { success: true, command: url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, command: url, error: msg };
  }
}

// ─── URL builders ────────────────────────────────────────────────────────────
// logos4: links use the same semicolon syntax as the L4 links Logos itself
// emits ("Copy location"), with values in ref.ly query encoding: '+' for
// spaces, percent-escapes for '/', ':' and non-ASCII. The desktop parser
// silently ignores commands with literal slashes in values or with the
// slash-path/query-string forms this file used previously.

function encodeValue(s: string): string {
  return encodeURIComponent(s).replace(/%20/g, "+");
}

export function buildPassageUrl(reference: string): string {
  // logosref: opens the user's preferred Bible (resource-independent).
  return `logosref:Bible.${toLogosUrlRef(reference)}`;
}

export function buildGuideUrl(guideType: string, reference: string): string {
  const logosRef = toLogosUrlRef(reference);
  return `logos4:Guide;t=${encodeValue(guideType)};ref=Bible.${logosRef}`;
}

// Bible Word Study takes a lemma of the form lbs/<lang>/<word>. Detect the
// language from the script of the word itself.
function lemmaLanguage(word: string): string {
  if (/[֐-׿יִ-ﭏ]/.test(word)) return "he";
  if (/[Ͱ-Ͽἀ-῿]/.test(word)) return "el";
  return "en";
}

export function buildWordStudyUrl(word: string): string {
  const lemma = `lbs/${lemmaLanguage(word)}/${word.trim()}`;
  return `logos4:Guide;t=Bible+Word+Study;lemma=${encodeValue(lemma)}`;
}

// Factbook keys carry an entity-kind sigil: #person, @place, %event, $thing.
// An unprefixed key opens an empty Factbook panel.
const FACTBOOK_KIND_PREFIX: Record<string, string> = {
  person: "#",
  place: "@",
  event: "%",
  thing: "$",
};

// "City gate" -> "cityGate" (thing keys lowercase the first letter),
// "John the Baptist" -> "JohnTheBaptist".
function factbookKey(topic: string, lowerFirst: boolean): string {
  const joined = topic
    .split(/\s+/)
    .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
  return lowerFirst ? joined.charAt(0).toLowerCase() + joined.slice(1) : joined;
}

export function buildFactbookUrl(topic: string, kind?: string): string {
  const trimmed = topic.trim();
  let key: string;
  if (trimmed.startsWith("bk.")) {
    key = trimmed.slice(3);
  } else if (/^[#@%$]/.test(trimmed)) {
    key = trimmed;
  } else {
    const kindKey = (kind ?? "person").toLowerCase();
    const prefix = FACTBOOK_KIND_PREFIX[kindKey] ?? "#";
    key = prefix + factbookKey(trimmed, kindKey === "thing");
  }
  return `logos4:Factbook;id=${encodeValue(`ref:bk.${key}`)};lens=all`;
}

const SEARCH_KINDS: Record<string, string> = {
  all: "Everything",
  bible: "Bible",
  books: "Books",
};

export function buildSearchUrl(query: string, kind: string = "all"): string {
  const k = SEARCH_KINDS[kind.toLowerCase()] ?? "Everything";
  return `logos4:Search;kind=${k};q=${encodeValue(query)}`;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export async function navigateToPassage(reference: string): Promise<LogosCommandResult> {
  try {
    return openUrl(buildPassageUrl(reference));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, command: reference, error: msg };
  }
}

export async function searchBibleInLogos(query: string): Promise<LogosCommandResult> {
  return openUrl(buildSearchUrl(query, "bible"));
}

export async function openWordStudy(word: string): Promise<LogosCommandResult> {
  return openUrl(buildWordStudyUrl(word));
}

export async function openFactbook(topic: string, kind?: string): Promise<LogosCommandResult> {
  return openUrl(buildFactbookUrl(topic, kind));
}

export async function openResource(
  resourceId: string,
  reference?: string
): Promise<LogosCommandResult> {
  try {
    const encodedId = encodeURIComponent(resourceId);
    let url = `logosres:${encodedId}`;
    if (reference) {
      const logosRef = toLogosUrlRef(reference);
      url += `;ref=bible.${logosRef}`;
    }
    return openUrl(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, command: `logosres:${resourceId}`, error: msg };
  }
}

export async function openGuide(
  guideType: string,
  reference: string
): Promise<LogosCommandResult> {
  try {
    return openUrl(buildGuideUrl(guideType, reference));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, command: "", error: msg };
  }
}

export async function searchAll(query: string, kind: string = "all"): Promise<LogosCommandResult> {
  return openUrl(buildSearchUrl(query, kind));
}

export async function isLogosRunning(): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("tasklist", [
        "/FI",
        "IMAGENAME eq Logos.exe",
        "/NH",
      ]);
      return stdout.toLowerCase().includes("logos.exe");
    }
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'tell application "System Events" to (name of processes) contains "Logos"',
    ]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}
