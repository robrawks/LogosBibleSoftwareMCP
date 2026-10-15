import { execFile } from "child_process";
import { promisify } from "util";
import type { LogosCommandResult } from "../types.js";

const execFileAsync = promisify(execFile);

// Launching and "is Logos running" checks only; links are built in
// logos-urls.ts.

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

// Build a link and hand it to the OS. A builder error (e.g. an unparseable
// reference) comes back as a failed result, the same as a launch failure.
export async function launchLogosUrl(build: () => string): Promise<LogosCommandResult> {
  let url: string;
  try {
    url = build();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, command: "", error: msg };
  }
  return openUrl(url);
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
