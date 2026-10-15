import { gunzipSync } from "zlib";
import { stripXml } from "./strip-markup.js";

const HEADER_LENGTH = 5;

/**
 * Decode a Logos blob field (Clippings.db, PassageList.db). Blobs start with a
 * 5-byte header: a format byte and a little-endian uint32 payload length
 * (design doc F17).
 * Prefix 0x01 = gzip payload; 0x02 = raw UTF-8 payload, cut to the declared
 * length when it fits. Anything else is decoded best-effort as UTF-8.
 * Returns null for empty, truncated or undecodable blobs. Never throws.
 */
export function decodeLogosBlob(blob: Buffer | null): string | null {
  if (!blob || blob.length === 0) return null;

  const prefix = blob[0];
  if (prefix === 0x01 || prefix === 0x02) {
    if (blob.length < HEADER_LENGTH) return null;
    const payload = blob.subarray(HEADER_LENGTH);
    try {
      if (prefix === 0x01) {
        return gunzipSync(payload).toString("utf-8");
      }
      const declared = blob.readUInt32LE(1);
      const body = declared <= payload.length ? payload.subarray(0, declared) : payload;
      return body.toString("utf-8");
    } catch {
      return null;
    }
  }

  // Unknown format: best-effort UTF-8 decode.
  return blob.toString("utf-8");
}

/** Former name, kept for existing callers. */
export const decodeClippingBlob = decodeLogosBlob;

/**
 * Extract readable text from Logos XAML-style rich text.
 * Preserves spacing by concatenating all Run Text attributes in order.
 */
export function extractClippingText(xml: string | null): string | null {
  if (!xml) return null;

  if (!xml.includes("<Run ")) {
    return stripXml(xml);
  }

  const paragraphs = xml.split(/<\/Paragraph>\s*<Paragraph[^>]*>/i);
  const lines: string[] = [];

  for (const para of paragraphs) {
    const pieces: string[] = [];
    const regex = /Text=["']([^"']*)["']/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(para)) !== null) {
      pieces.push(match[1]);
    }

    const line = pieces.join("").trim();
    if (line.length > 0) {
      lines.push(line);
    }
  }

  if (lines.length > 0) {
    return lines.join("\n");
  }

  return stripXml(xml);
}
