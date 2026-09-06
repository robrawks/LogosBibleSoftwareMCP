// Shared types for Logos MCP Server

// ─── Bible Reference Types ───────────────────────────────────────────────────

export interface ParsedReference {
  book: string;
  chapter: number;
  verse?: number;
  endChapter?: number;
  endVerse?: number;
}

export interface ReferenceFormats {
  logos: string;     // e.g., "Ge1.1"
  biblia: string;    // e.g., "Genesis1.1"
  human: string;     // e.g., "Genesis 1:1"
}

// ─── Biblia API Types ────────────────────────────────────────────────────────

export interface BibleTextResult {
  passage: string;
  text: string;
  bible: string;
}

export interface BibleSearchResult {
  query: string;
  resultCount: number;
  results: BibleSearchHit[];
}

export interface BibleSearchHit {
  title: string;
  preview: string;
}

export interface BibliaParseResult {
  passage: string;
  passages: string[];
}

// ─── Logos App Types ─────────────────────────────────────────────────────────

export interface LogosCommandResult {
  success: boolean;
  command: string;
  error?: string;
}

// ─── SQLite / User Data Types ────────────────────────────────────────────────

export interface HighlightResult {
  resourceId: string;
  textRange: string;
  styleName: string;
  syncDate: string | null;
  /** Human-readable title of the resource this highlight lives in (best-effort, null when the catalog is unavailable). */
  resourceTitle: string | null;
}

export interface FavoriteResult {
  id: string;
  title: string;
  appCommand: string;
  resourceId: string | null;
  rank: number;
}

export interface FavoriteFolder {
  id: string;
  title: string;
  rank: number;
  parentId: string | null;
  children: (FavoriteResult | FavoriteFolder)[];
}

export interface WorkflowTemplate {
  templateId: number;
  externalId: string;
  title: string;
  author: string | null;
  templateJson: Record<string, unknown> | null;
  createdDate: string;
}

export interface WorkflowInstance {
  instanceId: number;
  externalId: string;
  templateId: string;
  key: string;
  title: string;
  currentStep: string | null;
  completedSteps: string[];
  skippedSteps: string[];
  createdDate: string;
  completedDate: string | null;
  modifiedDate: string | null;
}

export interface ReadingListItem {
  itemId: string;
  readingListPath: string;
  isRead: boolean;
  modifiedDate: string | null;
}

export interface ReadingListStatus {
  title: string;
  author: string;
  path: string;
  status: number;
  /** Human-readable label for `status` (1 = Active, 2 = Completed). */
  statusLabel: string;
  modifiedDate: string | null;
}

export interface ReadingProgress {
  statuses: ReadingListStatus[];
  items: ReadingListItem[];
  totalItems: number;
  completedItems: number;
  percentComplete: number;
}

export interface ClippingResult {
  rowId: number;
  resourceId: string;
  createdDate: string;
  collectionTitle: string | null;
  title: string | null;
  content: string | null;
  notes: string | null;
  tags: string | null;
}

// ─── Catalog Types ──────────────────────────────────────────────────────────

export interface CatalogResource {
  resourceId: string;
  title: string;
  abbreviatedTitle: string | null;
  type: string;
  authors: string | null;
  subjects: string | null;
  description: string | null;
  publicationDate: string | null;
  /** ISO language codes as stored by Logos, e.g. "es" or "en grc" */
  languages: string | null;
  /** true when the catalog marks the resource as licensed/downloaded (Availability = 2) */
  licensed: boolean;
  /** Publisher(s) as stored by Logos, e.g. "Eerdmans" */
  publishers: string | null;
}

export interface ResourceTypeSummary {
  label: string;
  /** Raw dotted type (e.g. "text.monograph.dictionary.lexicon.greek") that best represents this label. */
  rawType: string;
  count: number;
}

// ─── Biblia Scan / Compare / Find Types ─────────────────────────────────────

export interface ScanResult {
  passage: string;
}

export interface CompareResult {
  equal: boolean;
  intersects: boolean;
  subset: boolean;
  superset: boolean;
  before: boolean;
  after: boolean;
}

export interface BibleInfo {
  bible: string;
  title: string;
  abbreviatedTitle: string;
  languages: string[];
  publishers: string[];
}

// ─── Screenshot / Window Types ───────────────────────────────────────────────

export interface LogosWindow {
  windowID: number;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  owner: string;
  layer: number;
}

export interface ScreenshotResult {
  success: boolean;
  imageBase64?: string;
  description?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  error?: string;
}

export type CaptureToolType =
  | "bible"
  | "factbook"
  | "wordstudy"
  | "guide"
  | "search"
  | "searchall"
  | "resource";

// ─── MCP Tool Types ──────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
}

// ─── User Documents (Sermon Builder, Reading Plans, Passage Lists) ──────────

export interface SermonSummary {
  id: number;
  title: string;
  series: string | null;
  seriesNumber: number | null;
  language: string | null;
  occasions: Array<{ date?: string; venue?: string; service?: string }>;
  tags: string[];
  audience: string[];
  description: string | null;
  modifiedDate: string;
  blockCount: number;
}

export interface SermonBlock {
  kind: string;
  indent: number;
  text: string;
  /** Human-readable Bible reference for passage blocks */
  reference: string | null;
  /** Source resource title for passage/clipping blocks */
  source: string | null;
}

export interface SermonDocument extends SermonSummary {
  blocks: SermonBlock[];
  markdown: string;
}

export interface ReadingPlanSummary {
  id: number;
  title: string;
  resourceId: string | null;
  resourceTitle: string | null;
  startDate: string | null;
  frequency: string | null;
  totalSessions: number;
  readSessions: number;
  firstDate: string | null;
  lastDate: string | null;
  nextUnread: { date: string; reading: string } | null;
  isArchived: boolean;
  modifiedDate: string | null;
}

export interface PassageListSummary {
  id: number;
  title: string;
  itemCount: number;
  modifiedDate: string | null;
  references: string[];
}
