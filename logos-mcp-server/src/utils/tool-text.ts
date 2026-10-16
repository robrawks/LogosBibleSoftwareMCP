import type { CaptureToolType, KnowledgeEntry } from "../types.js";

// Window titles and screenshots come from a compiled macOS helper (design doc
// F15). Elsewhere there is nothing to confirm with, so messages must not
// suggest those tools.

/**
 * Whether window titles (and so confirming or capturing the UI) are available.
 *
 * @param platform - Platform to decide for; defaults to the running one.
 * @returns True only on macOS.
 */
export function windowTitlesAvailable(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin";
}

/** Appended to every UI-dispatch result so the assistant knows nothing was returned. */
export const DISPATCHED_NOTE = "This only opens the Logos UI on the user's screen — no data is returned to you.";

/**
 * Follow-up suggestion for a UI-dispatch result.
 *
 * @param panelType - The panel the dispatch opened.
 * @param platform - Platform to decide for; defaults to the running one.
 * @returns A sentence with a leading space on macOS, otherwise an empty string.
 */
export function uiFollowUpHint(
  panelType: CaptureToolType,
  platform: NodeJS.Platform = process.platform
): string {
  if (!windowTitlesAvailable(platform)) return "";
  return ` Call get_logos_state to confirm what Logos is showing, or capture_panel_screenshot (panel_type: '${panelType}') to see the results.`;
}

/**
 * Text for `get_logos_state` when Logos is running.
 *
 * @param titles - Window titles (only meaningful on macOS).
 * @param platform - Platform to decide for; defaults to the running one.
 * @returns A status message that does not imply no windows are open off macOS.
 */
export function logosStateText(
  titles: string[],
  platform: NodeJS.Platform = process.platform
): string {
  if (!windowTitlesAvailable(platform)) {
    const where = platform === "win32" ? "Windows" : "this platform";
    return `Logos is running. Window titles are not available on ${where}.`;
  }
  const lines = titles.length > 0 ? titles.map((t) => `- ${t}`) : ["- (no named windows found)"];
  return `Logos is running. Window titles:\n${lines.join("\n")}`;
}

/**
 * One line per knowledge-base entry, for asking which of several matches the
 * assistant means.
 *
 * @param matches - Ambiguous knowledge-base entries.
 * @returns A markdown bullet list.
 */
export function formatKnowledgeChoices(matches: KnowledgeEntry[]): string {
  return matches
    .map((m) => {
      const kind = m.kind ? ` (${m.kind})` : "";
      const description = m.description ? `: ${m.description}` : "";
      return `- \`${m.id}\` — ${m.label}${kind}${description}`;
    })
    .join("\n");
}
