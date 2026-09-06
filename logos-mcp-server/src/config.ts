import { homedir } from "os";
import { join, dirname } from "path";
import { existsSync, readdirSync, statSync } from "fs";
import { fileURLToPath } from "url";

// Load .env for development (Node 20.12+; real env vars take precedence).
// MCP clients launch the server from an arbitrary cwd, so try the working
// directory, then the package root, then the repo root (where the README
// documents .env). First file found wins.
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
for (const envPath of [
  join(process.cwd(), ".env"),
  join(PACKAGE_ROOT, ".env"),
  join(PACKAGE_ROOT, "..", ".env"),
]) {
  try {
    process.loadEnvFile(envPath);
    break;
  } catch {
    // File absent or Node predates loadEnvFile — keep trying; env may
    // legitimately come from the MCP client config instead.
  }
}

// ─── Logos Data Paths ────────────────────────────────────────────────────────

const IS_WINDOWS = process.platform === "win32";

const LOGOS_ROOT = IS_WINDOWS
  ? join(
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
      "Logos"
    )
  : join(homedir(), "Library", "Application Support", "Logos4");
const FALLBACK_PROFILE_ID = "a3wo155q.w14";

interface ProfileDir {
  name: string;
  mtimeMs: number;
}

function listProfiles(parent: string, suffix?: string): ProfileDir[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter(
        (d) =>
          d.isDirectory() && (suffix === undefined || d.name.endsWith(suffix))
      )
      .map((d) => {
        const fullPath = join(parent, d.name);
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(fullPath).mtimeMs;
        } catch {
          // Ignore stat failures and keep deterministic ordering.
        }
        return { name: d.name, mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}

// A Data/<id> dir is only useful if it actually contains the library catalog.
function hasCatalogMarker(profileName: string): boolean {
  try {
    return existsSync(
      join(LOGOS_ROOT, "Data", profileName, "LibraryCatalog", "catalog.db")
    );
  } catch {
    return false;
  }
}

function detectProfileId(): string {
  let documents = listProfiles(join(LOGOS_ROOT, "Documents"), ".w14");
  let data = listProfiles(join(LOGOS_ROOT, "Data"), ".w14");

  // Windows installs may not use the ".w14" suffix — when no matching dirs
  // exist at all, relax the filter to any directory.
  if (documents.length === 0 && data.length === 0) {
    documents = listProfiles(join(LOGOS_ROOT, "Documents"));
    data = listProfiles(join(LOGOS_ROOT, "Data"));
  }

  if (documents.length === 0 && data.length === 0) {
    return FALLBACK_PROFILE_ID;
  }

  // 1) Prefer a Data/<id> dir that actually contains LibraryCatalog/catalog.db
  const withMarker = data.filter((p) => hasCatalogMarker(p.name));
  if (withMarker.length > 0) {
    return withMarker[0].name;
  }

  // 2) Paired Documents/Data dirs
  const dataByName = new Set(data.map((p) => p.name));
  const paired = documents.filter((p) => dataByName.has(p.name));
  if (paired.length > 0) {
    return paired[0].name;
  }

  // 3) Newest-mtime dir
  return documents[0]?.name ?? data[0]?.name ?? FALLBACK_PROFILE_ID;
}

const PROFILE_ID = detectProfileId();

const LOGOS_BASE = join(LOGOS_ROOT, "Documents", PROFILE_ID);

export const LOGOS_DATA_DIR =
  process.env.LOGOS_DATA_DIR ?? LOGOS_BASE;

// Catalog DB lives under Data/ (not Documents/)
const LOGOS_CATALOG_BASE = join(LOGOS_ROOT, "Data", PROFILE_ID);

export const LOGOS_CATALOG_DIR =
  process.env.LOGOS_CATALOG_DIR ?? LOGOS_CATALOG_BASE;

export const DB_PATHS = {
  visualMarkup: join(LOGOS_DATA_DIR, "VisualMarkup", "visualmarkup.db"),
  favorites: join(LOGOS_DATA_DIR, "FavoritesManager", "favorites.db"),
  workflows: join(LOGOS_DATA_DIR, "Workflows", "Workflows.db"),
  readingLists: join(LOGOS_DATA_DIR, "ReadingLists", "ReadingLists.db"),
  shortcuts: join(LOGOS_DATA_DIR, "ShortcutsManager", "shortcuts.db"),
  guides: join(LOGOS_DATA_DIR, "Guides", "guides.db"),
  notes: join(LOGOS_DATA_DIR, "NotesToolManager", "notestool.db"),
  clippings: join(LOGOS_DATA_DIR, "Documents", "Clippings", "Clippings.db"),
  passageLists: join(LOGOS_DATA_DIR, "Documents", "PassageList", "PassageList.db"),
  sermons: join(LOGOS_DATA_DIR, "Documents", "Sermon", "Sermon.db"),
  readingPlans: join(LOGOS_DATA_DIR, "Documents", "ReadingPlan", "ReadingPlan.db"),
  catalog: join(LOGOS_CATALOG_DIR, "LibraryCatalog", "catalog.db"),
} as const;

// ─── Biblia API ──────────────────────────────────────────────────────────────

export const BIBLIA_API_KEY = process.env.BIBLIA_API_KEY ?? "";
export const BIBLIA_API_BASE = "https://api.biblia.com/v1/bible";
// Default Bible for the Biblia-backed text tools. Override with
// LOGOS_DEFAULT_BIBLE (e.g. RVR60, KJV); see get_available_bibles.
export const DEFAULT_BIBLE = (process.env.LOGOS_DEFAULT_BIBLE ?? "LEB").toUpperCase();

// ─── Logos URL Schemes ───────────────────────────────────────────────────────

export const LOGOS_URL_BASE = "logos4:";

// ─── Screenshot Capture ─────────────────────────────────────────────────────

// Private per-user cache dir (not world-writable /tmp) so a local attacker
// can't pre-plant a malicious binary or symlink at a predictable path.
export const HELPER_CACHE_DIR = join(homedir(), "Library", "Caches", "logos-mcp");
export const WINDOW_HELPER_BIN = join(HELPER_CACHE_DIR, "logos-window-helper");
export const WINDOW_HELPER_SRC = join(HELPER_CACHE_DIR, "logos-window-helper.m");
export const SCREENSHOT_TEMP_DIR = HELPER_CACHE_DIR;
export const DEFAULT_CAPTURE_WAIT_MS = 4000;
export const MAX_CAPTURE_WAIT_MS = 15000;

// ─── Server Info ─────────────────────────────────────────────────────────────

export const SERVER_NAME = "logos-bible";
export const SERVER_VERSION = "1.1.0";
