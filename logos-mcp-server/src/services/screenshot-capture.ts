/**
 * screenshot-capture.ts
 *
 * Captures screenshots of the Logos Bible Software window via the macOS
 * CGWindowList API and `screencapture` CLI. Uses a compiled Objective-C helper
 * to discover window IDs (the only reliable method — AppleScript, Python, JXA,
 * and Swift all failed for CEF-based windows).
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { readFile, unlink } from "fs/promises";
import { join } from "path";
import { toLogosUrlRef } from "./reference-parser.js";
import { isLogosRunning } from "./logos-app.js";
import { withUiLock } from "../utils/ui-lock.js";
import {
  HELPER_CACHE_DIR,
  WINDOW_HELPER_BIN,
  WINDOW_HELPER_SRC,
  SCREENSHOT_TEMP_DIR,
  DEFAULT_CAPTURE_WAIT_MS,
  MAX_CAPTURE_WAIT_MS,
} from "../config.js";
import type { LogosWindow, ScreenshotResult, CaptureToolType } from "../types.js";

const execFileAsync = promisify(execFile);

// ─── Objective-C helper source ──────────────────────────────────────────────

const OBJ_C_SOURCE = `
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        CFArrayRef windowList = CGWindowListCopyWindowInfo(
            kCGWindowListOptionAll | kCGWindowListExcludeDesktopElements,
            kCGNullWindowID
        );
        if (!windowList) {
            fprintf(stderr, "Failed to get window list (screen capture permission needed)\\n");
            return 1;
        }
        NSArray *windows = (NSArray *)windowList;
        NSMutableArray *results = [NSMutableArray array];
        for (NSDictionary *window in windows) {
            NSString *ownerName = window[@"kCGWindowOwnerName"];
            if ([ownerName containsString:@"Logos"]) {
                NSDictionary *bounds = window[@"kCGWindowBounds"];
                [results addObject:@{
                    @"owner": ownerName ?: @"",
                    @"windowID": window[@"kCGWindowNumber"] ?: @0,
                    @"x": bounds[@"X"] ?: @0,
                    @"y": bounds[@"Y"] ?: @0,
                    @"width": bounds[@"Width"] ?: @0,
                    @"height": bounds[@"Height"] ?: @0,
                    @"layer": window[@"kCGWindowLayer"] ?: @0,
                    @"name": window[@"kCGWindowName"] ?: @""
                }];
            }
        }
        CFRelease(windowList);
        NSData *jsonData = [NSJSONSerialization dataWithJSONObject:results options:0 error:nil];
        printf("%s\\n", [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding].UTF8String);
    }
    return 0;
}
`;

// ─── Helper compilation ─────────────────────────────────────────────────────

/** Compile the CGWindowList helper if missing (exported so installers can pre-build it). */
export async function ensureHelper(): Promise<void> {
  if (!existsSync(WINDOW_HELPER_BIN)) {
    mkdirSync(HELPER_CACHE_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(WINDOW_HELPER_SRC, OBJ_C_SOURCE);
    await execFileAsync("clang", [
      "-framework", "CoreGraphics",
      "-framework", "Foundation",
      "-o", WINDOW_HELPER_BIN,
      WINDOW_HELPER_SRC,
    ]);
  }
}

// ─── Window discovery ───────────────────────────────────────────────────────

export async function getLogosWindows(): Promise<LogosWindow[]> {
  await ensureHelper();
  const { stdout } = await execFileAsync(WINDOW_HELPER_BIN);
  return JSON.parse(stdout.trim()) as LogosWindow[];
}

async function getMainWindow(): Promise<LogosWindow | null> {
  const windows = await getLogosWindows();
  if (windows.length === 0) return null;

  // Prefer the window with "Logos" in its name
  const named = windows.find((w) => w.name && w.name.includes("Logos"));
  if (named) return named;

  // Fall back to largest by area
  return windows.reduce((best, w) =>
    w.width * w.height > best.width * best.height ? w : best
  );
}

/**
 * Titles (kCGWindowName) of all currently open Logos windows, for use by a
 * `get_logos_state` tool. Never throws — returns an empty array if Logos
 * isn't running or the window helper fails.
 */
export async function getLogosWindowTitles(): Promise<string[]> {
  try {
    const running = await isLogosRunning();
    if (!running) return [];
    const windows = await getLogosWindows();
    return windows.map((w) => w.name).filter((name): name is string => Boolean(name));
  } catch {
    return [];
  }
}

// ─── URL building ───────────────────────────────────────────────────────────

export interface NavigationUrl {
  url: string;
  description: string;
}

export function buildNavigationUrl(
  panelType: CaptureToolType,
  options: {
    reference?: string;
    guideType?: string;
    resourceId?: string;
  }
): NavigationUrl {
  switch (panelType) {
    case "bible": {
      if (!options.reference) {
        throw new Error("Bible panel requires a reference (e.g., 'Romans 12:1')");
      }
      const logosRef = toLogosUrlRef(options.reference);
      return {
        url: `logos4:///Bible/${logosRef}`,
        description: `Bible: ${options.reference}`,
      };
    }

    case "factbook": {
      if (!options.reference) {
        throw new Error("Factbook panel requires a reference/topic (e.g., 'Moses')");
      }
      const encoded = encodeURIComponent(options.reference);
      return {
        url: `logos4:///Factbook?ref=${encoded}`,
        description: `Factbook: ${options.reference}`,
      };
    }

    case "wordstudy": {
      if (!options.reference) {
        throw new Error("Word Study panel requires a word (e.g., 'agape')");
      }
      const encoded = encodeURIComponent(options.reference);
      return {
        url: `logos4:///WordStudy?word=${encoded}`,
        description: `Word Study: ${options.reference}`,
      };
    }

    case "guide": {
      if (!options.reference) {
        throw new Error("Guide panel requires a Bible reference");
      }
      if (!options.guideType) {
        throw new Error("Guide panel requires a guide_type (e.g., 'Exegetical Guide')");
      }
      const logosRef = toLogosUrlRef(options.reference);
      const template = encodeURIComponent(options.guideType);
      return {
        url: `logos4:///Guide?t=${template}&ref=bible.${logosRef}`,
        description: `${options.guideType}: ${options.reference}`,
      };
    }

    case "search": {
      if (!options.reference) {
        throw new Error("Search panel requires a query");
      }
      const encoded = encodeURIComponent(options.reference);
      return {
        url: `logos4:///Search?type=Bible&q=${encoded}`,
        description: `Search: ${options.reference}`,
      };
    }

    case "searchall": {
      if (!options.reference) {
        throw new Error("Search All panel requires a query");
      }
      const encoded = encodeURIComponent(options.reference);
      return {
        url: `logos4:///Search?kind=AllSearch&syntax=v2&q=${encoded}`,
        description: `Search All: ${options.reference}`,
      };
    }

    case "resource": {
      if (!options.resourceId) {
        throw new Error("Resource panel requires a resource_id");
      }
      const encodedId = encodeURIComponent(options.resourceId);
      let url = `logosres:${encodedId}`;
      let desc = `Resource: ${options.resourceId}`;
      if (options.reference) {
        const logosRef = toLogosUrlRef(options.reference);
        url += `;ref=bible.${logosRef}`;
        desc += ` at ${options.reference}`;
      }
      return { url, description: desc };
    }

    default:
      throw new Error(`Unknown panel type: ${panelType}`);
  }
}

// ─── Downscaling ─────────────────────────────────────────────────────────────

const DEFAULT_MAX_WIDTH = 1400;

/** Parses the width in pixels from `sips -g pixelWidth <path>` stdout. */
export function parseSipsPixelWidth(output: string): number | null {
  const match = output.match(/pixelWidth:\s*(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/** Whether an image of `currentWidth` needs resampling down to `maxWidth`. */
export function shouldResample(currentWidth: number, maxWidth: number): boolean {
  return currentWidth > maxWidth;
}

/** Builds the `sips` argv that resamples the image at `tempPath` to `maxWidth`. */
export function buildSipsResampleArgs(tempPath: string, maxWidth: number): string[] {
  return ["--resampleWidth", String(maxWidth), tempPath];
}

/**
 * Downscales the PNG at `tempPath` in place when it's wider than `maxWidth`.
 * Retina full-window captures are huge base64 blobs for an LLM; this bounds
 * them. If `sips` fails for any reason, the capture proceeds un-scaled.
 */
async function maybeDownscale(tempPath: string, maxWidth: number): Promise<void> {
  try {
    const { stdout } = await execFileAsync("sips", ["-g", "pixelWidth", tempPath]);
    const currentWidth = parseSipsPixelWidth(stdout);
    if (currentWidth === null || !shouldResample(currentWidth, maxWidth)) {
      return;
    }
    await execFileAsync("sips", buildSipsResampleArgs(tempPath, maxWidth));
  } catch {
    // sips unavailable or failed — proceed with the un-scaled image.
  }
}

// ─── Main capture function ──────────────────────────────────────────────────

/**
 * Captures the ENTIRE Logos window, not just the active panel. `panelType`
 * only controls which panel Logos navigates to before the screenshot is
 * taken — it does not crop the resulting image.
 */
export function captureLogosPanel(
  panelType: CaptureToolType,
  options: {
    reference?: string;
    guideType?: string;
    resourceId?: string;
    waitMs?: number;
    maxWidth?: number;
  } = {}
): Promise<ScreenshotResult> {
  return withUiLock(() => captureLogosPanelUnlocked(panelType, options));
}

async function captureLogosPanelUnlocked(
  panelType: CaptureToolType,
  options: {
    reference?: string;
    guideType?: string;
    resourceId?: string;
    waitMs?: number;
    maxWidth?: number;
  } = {}
): Promise<ScreenshotResult> {
  // Capture relies on clang/screencapture/sips — all macOS-only.
  if (process.platform !== "darwin") {
    return {
      success: false,
      error: "capture_panel_screenshot is currently macOS-only (it uses the macOS screencapture toolchain). Other Logos tools work on Windows.",
    };
  }

  // 1. Check Logos is running
  const running = await isLogosRunning();
  if (!running) {
    return {
      success: false,
      error: "Logos is not running. Please start Logos Bible Software first.",
    };
  }

  // 2. Build navigation URL
  let nav: NavigationUrl;
  try {
    nav = buildNavigationUrl(panelType, options);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }

  // 3. Open the URL to navigate Logos
  try {
    await execFileAsync("open", [nav.url]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Failed to open URL: ${msg}` };
  }

  // 4. Wait for content to render
  const waitMs = Math.min(options.waitMs ?? DEFAULT_CAPTURE_WAIT_MS, MAX_CAPTURE_WAIT_MS);
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  // 5. Find the Logos window
  let mainWindow: LogosWindow | null;
  try {
    mainWindow = await getMainWindow();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      error: `Failed to find Logos window: ${msg}. Ensure Screen Recording permission is granted.`,
    };
  }

  if (!mainWindow) {
    return {
      success: false,
      error: "No Logos window found on screen. Is Logos visible?",
    };
  }

  // 6. Capture the window
  const timestamp = Date.now();
  const tempPath = join(SCREENSHOT_TEMP_DIR, `logos-mcp-capture-${timestamp}.png`);

  try {
    await execFileAsync("screencapture", [
      "-x",
      "-l", String(mainWindow.windowID),
      tempPath,
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Screenshot capture failed: ${msg}` };
  }

  if (!existsSync(tempPath)) {
    return { success: false, error: "Screenshot file was not created" };
  }

  // 7. Downscale if oversized, read to base64, and clean up
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
  await maybeDownscale(tempPath, maxWidth);

  try {
    const imageBuffer = await readFile(tempPath);
    const imageBase64 = imageBuffer.toString("base64");

    return {
      success: true,
      imageBase64,
      description: nav.description,
      bounds: {
        x: mainWindow.x,
        y: mainWindow.y,
        width: mainWindow.width,
        height: mainWindow.height,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Failed to read screenshot: ${msg}` };
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}
