import type { CaptureToolType, HistoryConfirmation, HistoryVisit, KnowledgeEntry } from "../types.js";

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

// "PNTC Jn at John 5:14" for a resource; "Exegetical Guide (John 5:14)" for a
// guide, Factbook entry or search, whose subtitle is not always a place.
function visitName(visit: HistoryVisit): string {
  if (!visit.subtitle) return visit.title;
  return visit.kind === "Resource" ? `${visit.title} at ${visit.subtitle}` : `${visit.title} (${visit.subtitle})`;
}

/**
 * Reply for a link once Logos's history has been checked. Without a history
 * store the reply is the plain dispatch message used before PR 3.
 *
 * @param confirmation - The outcome from `waitForHistoryVisit`.
 * @param what - Names the target, e.g. "resource `LLS:29.48.20` at John 5:14".
 * @param panelType - The panel kind, for the UI follow-up hint.
 * @param platform - Defaults to the current platform.
 * @returns The reply text for the tool result.
 */
export function openConfirmationText(
  confirmation: HistoryConfirmation,
  what: string,
  panelType: CaptureToolType,
  platform: NodeJS.Platform = process.platform
): string {
  if (confirmation.status === "confirmed") {
    return `Opened ${visitName(confirmation.visit)} in Logos. ${DISPATCHED_NOTE}`;
  }
  if (confirmation.status === "already_open") {
    return `Logos is already showing ${visitName(confirmation.visit)}. ${DISPATCHED_NOTE}`;
  }
  if (confirmation.status === "unconfirmed") {
    return `Sent ${what} to Logos, but Logos did not confirm opening it — Logos may be busy; try again once it responds.`;
  }
  return `Dispatched to Logos: ${what}. ${DISPATCHED_NOTE}${uiFollowUpHint(panelType, platform)}`;
}
