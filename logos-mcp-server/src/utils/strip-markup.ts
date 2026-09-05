/**
 * Shared markup stripping utilities for cleaning MCP tool responses.
 */

/**
 * Decode the XML entities Logos actually emits, including numeric ones.
 *
 * `&amp;` is decoded last: doing it first would let a literal "&amp;gt;"
 * collapse all the way to ">" instead of stopping at "&gt;".
 */
export function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/**
 * Remove XML/HTML tags and decode common entities.
 * Returns null if input is null or result is empty.
 *
 * Tags are stripped before entities are decoded, so an escaped "&lt;b&gt;"
 * survives as literal text instead of being mistaken for a tag.
 */
export function stripXml(text: string | null): string | null {
  if (!text) return null;
  const result = decodeEntities(text.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
  return result.length > 0 ? result : null;
}

/**
 * Extract plain text from Logos XAML RichText content.
 * Handles <Run Text="..."/> elements across <Paragraph> blocks.
 * Falls back to generic stripXml for non-XAML content.
 */
export function stripRichText(text: string | null): string | null {
  if (!text) return null;

  // Check if this looks like Logos XAML (has Run elements with Text attributes)
  if (!text.includes("<Run ")) {
    return stripXml(text);
  }

  // Split by paragraph boundaries
  const paragraphs = text.split(/<\/Paragraph>\s*<Paragraph[^>]*>/i);

  const lines: string[] = [];
  for (const para of paragraphs) {
    // Extract all Text="..." or Text='...' attribute values. The value must be
    // matched against its OWN opening quote: a single pattern of [^"']* stops
    // at the first apostrophe, truncating "He's worked salvation" to "He".
    const texts: string[] = [];
    const regex = /Text=(?:"([^"]*)"|'([^']*)')/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(para)) !== null) {
      const raw = match[1] ?? match[2] ?? "";
      if (raw.trim()) {
        texts.push(decodeEntities(raw));
      }
    }
    if (texts.length > 0) {
      lines.push(texts.join(" "));
    }
  }

  const result = lines.join("\n").trim();
  return result.length > 0 ? result : null;
}
