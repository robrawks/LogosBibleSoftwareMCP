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
  modifiedDate: string | null;
}

export interface ReadingProgress {
  statuses: ReadingListStatus[];
  items: ReadingListItem[];
  totalItems: number;
  completedItems: number;
  percentComplete: number;
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

// ─── MCP Tool Types ──────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
}
