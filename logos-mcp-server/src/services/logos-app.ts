import { execFile } from "child_process";
import { promisify } from "util";
import { mkdirSync, writeFileSync } from "fs";
import { toLogosUrlRef } from "./reference-parser.js";
import { HELPER_CACHE_DIR, DISPATCH_HELPER, RESTORE_FOCUS } from "../config.js";
import type { LogosCommandResult } from "../types.js";

const execFileAsync = promisify(execFile);

// On Windows, Logos/Verbum brings itself to the foreground whenever its URL
// protocol is invoked, yanking focus from whatever the user is doing. This
// helper dispatches the URL, waits for that self-activation to settle, and
// then hands focus back to the window that had it. Trade-off: the app still
// flashes briefly, and keystrokes typed in that sub-second window could land
// in Logos.
const PS_DISPATCH_SOURCE = `
param([Parameter(Mandatory=$true)][string]$Url)
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class LogosMcpFocus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
$before = [LogosMcpFocus]::GetForegroundWindow()
$beforePid = 0
[void][LogosMcpFocus]::GetWindowThreadProcessId($before, [ref]$beforePid)
$beforeName = ""
try { $beforeName = (Get-Process -Id $beforePid -ErrorAction Stop).ProcessName } catch {}
Start-Process $Url
# When the user was already in Logos/Verbum (or nothing had focus), leave
# focus alone.
if ($before -ne [IntPtr]::Zero -and $beforeName -notmatch "^(Logos|Verbum)$") {
  Start-Sleep -Milliseconds 700  # restoring before self-activation settles gets overridden
  for ($i = 0; $i -lt 5; $i++) {
    if ([LogosMcpFocus]::GetForegroundWindow() -ne $before) {
      # An Alt-key tap lifts the SetForegroundWindow restriction that
      # normally stops background processes from re-assigning focus.
      [LogosMcpFocus]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
      [void][LogosMcpFocus]::SetForegroundWindow($before)
      [LogosMcpFocus]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    }
    Start-Sleep -Milliseconds 200
    if ([LogosMcpFocus]::GetForegroundWindow() -eq $before) { break }
  }
}
exit 0
`;

export async function openUrl(url: string): Promise<LogosCommandResult> {
  try {
    if (process.platform === "win32") {
      let dispatched = false;
      if (RESTORE_FOCUS) {
        try {
          // Rewritten on every dispatch (tiny file) so a stale cached copy
          // can never outlive a server upgrade.
          mkdirSync(HELPER_CACHE_DIR, { recursive: true, mode: 0o700 });
          writeFileSync(DISPATCH_HELPER, PS_DISPATCH_SOURCE);
          await execFileAsync("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy", "Bypass",
            "-File", DISPATCH_HELPER,
            "-Url", url,
          ]);
          dispatched = true;
        } catch {
          // PowerShell unavailable or helper failed — fall through and
          // dispatch without focus restore.
        }
      }
      if (!dispatched) {
        // rundll32 takes the URL as one argument, avoiding cmd.exe mangling
        // the `&` in query strings that `start` would require escaping for.
        await execFileAsync("rundll32", ["url.dll,FileProtocolHandler", url]);
      }
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
// emits ("Copy location"), with percent-encoded values: %20 for spaces,
// percent-escapes for '/', ':' and non-ASCII. The desktop parser does NOT
// form-decode '+' as a space (a t=Passage+Guide template fails to resolve),
// and silently ignores commands with literal slashes in values or with the
// slash-path/query-string forms this file used previously.

function encodeValue(s: string): string {
  return encodeURIComponent(s);
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
  return `logos4:Guide;t=${encodeValue("Bible Word Study")};lemma=${encodeValue(lemma)}`;
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
