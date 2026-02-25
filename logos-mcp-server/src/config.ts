import { homedir } from "os";
import { join } from "path";

// ─── Logos Data Paths ────────────────────────────────────────────────────────

const LOGOS_BASE = join(
  homedir(),
  "Library",
  "Application Support",
  "Logos4",
  "Documents",
  "a3wo155q.w14"
);

export const LOGOS_DATA_DIR =
  process.env.LOGOS_DATA_DIR ?? LOGOS_BASE;

// Catalog DB lives under Data/ (not Documents/)
const LOGOS_CATALOG_BASE = join(
  homedir(),
  "Library",
  "Application Support",
  "Logos4",
  "Data",
  "a3wo155q.w14"
);

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
  catalog: join(LOGOS_CATALOG_DIR, "LibraryCatalog", "catalog.db"),
} as const;

// ─── Biblia API ──────────────────────────────────────────────────────────────

export const BIBLIA_API_KEY = process.env.BIBLIA_API_KEY ?? "";
export const BIBLIA_API_BASE = "https://api.biblia.com/v1/bible";
export const DEFAULT_BIBLE = "LEB";

// ─── Logos URL Schemes ───────────────────────────────────────────────────────

export const LOGOS_URL_BASE = "logos4:";

// ─── Server Info ─────────────────────────────────────────────────────────────

export const SERVER_NAME = "logos-bible";
export const SERVER_VERSION = "1.0.0";
