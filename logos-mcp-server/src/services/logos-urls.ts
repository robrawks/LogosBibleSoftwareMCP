import { LOGOS_LINK_STYLE, type LinkStyle } from "../config.js";
import { toLogosUrlRef } from "./reference-parser.js";
import type { GuideTarget } from "../types.js";

// Every link the UI tools hand to Logos. "current" builds the formats
// verified on Logos 54; "legacy" returns the exact URLs the server used
// before. Builders throw only for an unparseable Bible reference (or a
// knowledge-base guide subject in legacy style); callers report the message.

/**
 * Builds a link that opens a passage.
 * @param reference - Bible reference, e.g. "John 5:1".
 * @param bibleResourceId - Bible resource to open it in (ignored in legacy style).
 * @param style - Link style; defaults to `LOGOS_LINK_STYLE`.
 * @returns The Logos URL.
 * @throws When the reference cannot be parsed.
 */
export function buildPassageUrl(
  reference: string,
  bibleResourceId: string,
  style: LinkStyle = LOGOS_LINK_STYLE
): string {
  if (style === "legacy") return `logos4:///Bible/${toLogosUrlRef(reference)}`;
  return buildResourceUrl(bibleResourceId, reference);
}

// Resource links worked unchanged on Logos 54, so both styles share them.
/**
 * Builds a link that opens a resource, optionally at a Bible reference.
 * @param resourceId - Resource ID, e.g. "LLS:29.48.20".
 * @param reference - Optional Bible reference to open it at.
 * @returns The Logos URL.
 * @throws When the reference cannot be parsed.
 */
export function buildResourceUrl(resourceId: string, reference?: string): string {
  let url = `logosres:${encodeURIComponent(resourceId)}`;
  if (reference) url += `;ref=bible.${toLogosUrlRef(reference)}`;
  return url;
}

// Guides open by their display title ("Passage Guide"); internal template
// names opened blank tabs (design doc F5).
/**
 * Builds a link that opens a guide.
 * @param guideTitle - Display title, e.g. "Passage Guide".
 * @param target - Bible reference or knowledge-base ID the guide opens on.
 * @param style - Link style; defaults to `LOGOS_LINK_STYLE`.
 * @returns The Logos URL.
 * @throws When the reference cannot be parsed, or for a knowledge-base target in legacy style.
 */
export function buildGuideUrl(
  guideTitle: string,
  target: GuideTarget,
  style: LinkStyle = LOGOS_LINK_STYLE
): string {
  const title = encodeURIComponent(guideTitle);
  if (style === "legacy") {
    if (target.kind !== "bible") {
      throw new Error("Guides on a knowledge-base subject need LOGOS_LINK_STYLE=current.");
    }
    return `logos4:///Guide?t=${title}&ref=bible.${toLogosUrlRef(target.reference)}`;
  }
  const ref =
    target.kind === "bible"
      ? `bible.${toLogosUrlRef(target.reference)}`
      : encodeURIComponent(target.id);
  return `logos4:Guide;t=${title};ref=${ref}`;
}

// current: `target` is a knowledge-base ID (a plain name opens nothing, F6).
// legacy: `target` is the topic name, as before.
/**
 * Builds a link that opens a Factbook entry.
 * @param target - Knowledge-base ID (current style) or topic name (legacy style).
 * @param style - Link style; defaults to `LOGOS_LINK_STYLE`.
 * @returns The Logos URL.
 */
export function buildFactbookUrl(target: string, style: LinkStyle = LOGOS_LINK_STYLE): string {
  if (style === "legacy") return `logos4:///Factbook?ref=${encodeURIComponent(target)}`;
  return `logos4:Factbook;ref=${encodeURIComponent(target)}`;
}

// Logos 54 opens Bible Word Study but ignores any word passed in the link
// (design doc F7), so the current link opens it empty.
/**
 * Builds a link that opens Bible Word Study.
 * @param word - Word to study (ignored in current style; Logos 54 ignores it).
 * @param style - Link style; defaults to `LOGOS_LINK_STYLE`.
 * @returns The Logos URL.
 */
export function buildWordStudyUrl(word: string, style: LinkStyle = LOGOS_LINK_STYLE): string {
  if (style === "legacy") return `logos4:///WordStudy?word=${encodeURIComponent(word)}`;
  return "logos4:Guide;t=Bible%20Word%20Study";
}

// Verified on Logos 54 (design doc F19, Open Question 1): opens an All
// search with the query run. The SearchKindName/QueryText form opened Search
// without the query.
/**
 * Builds a link that opens an All search with the query run.
 * @param query - Search text.
 * @param style - Link style; defaults to `LOGOS_LINK_STYLE`.
 * @returns The Logos URL.
 */
export function buildSearchAllUrl(query: string, style: LinkStyle = LOGOS_LINK_STYLE): string {
  if (style === "legacy") return `logos4:///Search?kind=AllSearch&syntax=v2&q=${encodeURIComponent(query)}`;
  return `logos4:Search;kind=AllSearch;q=${encodeURIComponent(query)};syntax=v2`;
}
