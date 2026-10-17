/** Output format a read tool can return: human-readable text or structured JSON. */
export type OutputFormat = "text" | "json";

/** Largest `limit` honored in JSON mode (design doc 2.5). */
export const MAX_JSON_LIMIT = 1000;

/**
 * The row limit a read tool should use: the caller's value or the tool's
 * default, capped at {@link MAX_JSON_LIMIT} when returning JSON. Text mode
 * keeps its old behavior (no cap).
 *
 * @param limit - The caller's requested limit, if any.
 * @param defaultLimit - The tool's default limit.
 * @param format - The requested output format.
 * @returns The limit to apply.
 */
export function resolveLimit(
  limit: number | undefined,
  defaultLimit: number,
  format: OutputFormat | undefined
): number {
  const value = limit ?? defaultLimit;
  return format === "json" ? Math.min(value, MAX_JSON_LIMIT) : value;
}

/**
 * Pretty-printed JSON for a text content block.
 *
 * @param data - Any JSON-serializable value.
 * @returns The value serialized with two-space indentation.
 */
export function toJsonText(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
