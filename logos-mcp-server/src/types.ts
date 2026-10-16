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

/** What a guide link points at: a Bible reference or a knowledge-base ID. */
export type GuideTarget =
  | { kind: "bible"; reference: string }
  | { kind: "kb"; id: string };

// ─── SQLite / User Data Types ────────────────────────────────────────────────

export interface HighlightResult {
  resourceId: string;
  textRange: string;
  styleName: string;
  syncDate: string | null;
  /** Human-readable title of the resource this highlight lives in (best-effort, null when the catalog is unavailable). */
  resourceTitle: string | null;
  /** Readable Bible reference(s) the highlight covers, "; "-joined (null when unknown). */
  reference: string | null;
  /** Raw Logos references behind `reference`, e.g. "bible.66.1.8-66.1.15". */
  rawReferences: string[];
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

// ─── Study Data Types ────────────────────────────────────────────────────────

export interface PlanReading {
  resourceId: string | null;
  /** Raw Logos reference, e.g. "bible+csb2.87.22" or "page.9-13". */
  rawReference: string;
  /** Readable form, e.g. "Revelation 22" or "pp 9-13" (raw when unrecognized). */
  reference: string;
}

export interface PlanSession {
  /** Position in the plan's session list (ReadSessions counts in these). */
  index: number;
  /** Scheduled date, YYYY-MM-DD. */
  date: string | null;
  readings: PlanReading[];
}

export interface ReadingPlan {
  documentId: string;
  title: string;
  resourceId: string | null;
  resourceTitle: string | null;
  startDate: string | null;
  /** The plan's Settings JSON as stored (range, frequency, timeframe…). */
  settings: Record<string, unknown> | null;
  /** Sessions that have at least one reading. */
  sessionsWithReadings: number;
  /** Sessions with readings that are marked read; null when progress is unknown. */
  sessionsRead: number | null;
  /** ReadSessions as stored when it isn't a plain non-negative integer. */
  unparsedReadSessions: string | null;
  nextReading: PlanSession | null;
  /** Days between the next reading's date and today, when positive. */
  daysBehind: number | null;
  completed: boolean;
}

/** How far the user has read in one resource, from Logos's reading tracker. */
export interface ResourceReadingProgressEntry {
  resourceId: string;
  title: string | null;
  /** Percent of the resource read, 0-100, one decimal. */
  percentRead: number;
  /** When the user last read in it (ISO, as Logos stored it). */
  lastReadDate: string | null;
}

/** The parts of a History.Bookmark string that Logos tools use. */
export interface HistoryBookmark {
  /** Text before the first "|": "Resource", "Guides", "Search", "Factbook". */
  kind: string;
  /** For resource visits, the resource ID (e.g. "LLS:LEB"). */
  resourceId: string | null;
  /** Raw Logos reference of the location, e.g. "bible+leb2.65.3.21". */
  rawReference: string | null;
}

/** One entry of the user's Logos browsing history. */
export interface HistoryVisit {
  id: string;
  /** What was opened, as Logos shows it (e.g. "LEB", "Exegetical Guide"). */
  title: string;
  /** Where in it (e.g. "John 5:1-9"); null when Logos stored none. */
  subtitle: string | null;
  /** UTC ISO timestamp. */
  lastVisited: string;
  kind: string;
  resourceId: string | null;
  rawReference: string | null;
  /** Readable form of rawReference, when it is a mapped Bible reference. */
  reference: string | null;
}

/** One passage in a saved Logos passage list. */
export interface PassageListEntry {
  /** Raw Logos reference, e.g. "bible.18.10.21-18.10.22". */
  rawReference: string;
  /** Readable form ("Job 10:21-22"), or the raw string when unmapped. */
  reference: string;
}

/** A named passage list saved in Logos. */
export interface PassageList {
  title: string | null;
  modifiedDate: string | null;
  passages: PassageListEntry[];
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
}

export interface ResourceTypeSummary {
  label: string;
  /** Raw dotted type (e.g. "text.monograph.dictionary.lexicon.greek") that best represents this label. */
  rawType: string;
  count: number;
}

export interface PassageResource {
  resourceId: string;
  title: string;
  abbreviatedTitle: string | null;
  /** Authors joined with "; " (null when the catalog lists none). */
  authors: string | null;
  series: string | null;
  /** Human type label, e.g. "Commentary", "Study Bible". */
  kind: string;
  /** Raw dotted catalog type. */
  type: string;
  /** commentary-purpose trait, e.g. "exegetical". */
  purpose: string | null;
  /** era trait, e.g. "contemporary". */
  era: string | null;
  communityRating: number | null;
  /** How often the user opened it; used for sorting, shown only in JSON. */
  useCount: number;
}

// ─── Knowledge Base Types ────────────────────────────────────────────────────

export interface KnowledgeEntry {
  /** Knowledge-base ID, e.g. "bk.#Moses", "bk.%Sabbath", "bk.to:DBT-5333". */
  id: string;
  label: string;
  /** Logos entry kind (IconKinds.IconKind), e.g. "Man", "Topic", "PreachingTheme". */
  kind: string | null;
  description: string | null;
}

export type KnowledgeResolution =
  | { status: "resolved"; entry: KnowledgeEntry }
  | { status: "ambiguous"; matches: KnowledgeEntry[] }
  | { status: "not_found" }
  | { status: "unavailable"; message: string };

export type GuideTargetResolution =
  | KnowledgeResolution
  | { status: "bible"; reference: string }
  | { status: "invalid"; message: string };

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
