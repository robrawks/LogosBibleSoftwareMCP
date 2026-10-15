import { describe, it, expect } from "vitest";
import { gzipSync } from "zlib";
import {
  decodeLogosBlob,
  decodeClippingBlob,
  extractClippingText,
} from "../src/utils/clippings.js";

// Logos blobs start with a 5-byte header: a format byte (0x01 gzip, 0x02 raw
// UTF-8) and a little-endian uint32 payload length (design doc F17).
function withHeader(prefix: number, payload: Buffer, declaredLength = payload.length): Buffer {
  const header = Buffer.alloc(5);
  header[0] = prefix;
  header.writeUInt32LE(declaredLength, 1);
  return Buffer.concat([header, payload]);
}

function makeGzipBlob(text: string): Buffer {
  return withHeader(0x01, gzipSync(Buffer.from(text, "utf-8")));
}

function makeRawBlob(text: string): Buffer {
  return withHeader(0x02, Buffer.from(text, "utf-8"));
}

describe("decodeLogosBlob", () => {
  it("decodes gzip-prefixed blobs", () => {
    const xml = "<Span><Run Text='Grace'/></Span>";
    expect(decodeLogosBlob(makeGzipBlob(xml))).toBe(xml);
  });

  it("decodes raw-prefixed blobs after the 5-byte header", () => {
    const xml = "<Span><Run Text='Peace'/></Span>";
    expect(decodeLogosBlob(makeRawBlob(xml))).toBe(xml);
  });

  it("decodes the passage-list blob observed on Logos 54", () => {
    // PassageLists.CompressedItems from a real install (synthetic-safe: it
    // holds only Bible references).
    const blob = Buffer.from(
      "02530000005B7B22726566223A226269626C652E31382E31302E32312D31382E31302E3232227D2C7B22726566223A226269626C652E32312E392E3130227D2C7B22726566223A226269626C652E32332E352E3134227D5D",
      "hex"
    );
    expect(decodeLogosBlob(blob)).toBe(
      '[{"ref":"bible.18.10.21-18.10.22"},{"ref":"bible.21.9.10"},{"ref":"bible.23.5.14"}]'
    );
  });

  it("uses only the declared length when trailing bytes follow the payload", () => {
    const blob = withHeader(0x02, Buffer.from("[1,2]garbage", "utf-8"), 5);
    expect(decodeLogosBlob(blob)).toBe("[1,2]");
  });

  it("falls back to everything after the header when the declared length is too long", () => {
    const blob = withHeader(0x02, Buffer.from("[1,2]", "utf-8"), 999);
    expect(decodeLogosBlob(blob)).toBe("[1,2]");
  });

  it("decodes an unknown prefix byte best-effort as UTF-8, header included", () => {
    const blob = withHeader(0x07, Buffer.from("abc", "utf-8"), 3);
    expect(decodeLogosBlob(blob)).toBe(blob.toString("utf-8"));
    expect(decodeLogosBlob(blob)?.endsWith("abc")).toBe(true);
  });

  it("returns null for a blob shorter than its header", () => {
    expect(decodeLogosBlob(Buffer.from([0x02, 0x05, 0x00]))).toBeNull();
  });

  it("returns null for an empty blob", () => {
    expect(decodeLogosBlob(Buffer.alloc(0))).toBeNull();
    expect(decodeLogosBlob(null)).toBeNull();
  });

  it("keeps decodeClippingBlob as an alias", () => {
    expect(decodeClippingBlob).toBe(decodeLogosBlob);
  });
});

describe("extractClippingText", () => {
  it("preserves spacing from segmented Run nodes", () => {
    const xml = `
      <Paragraph>
        <Run Text="In"/><Run Text=" "/><Run Text="the"/><Run Text=" "/><Run Text="beginning"/>
      </Paragraph>
    `;
    expect(extractClippingText(xml)).toBe("In the beginning");
  });

  it("joins paragraphs with newlines", () => {
    const xml = `
      <Paragraph><Run Text="First line"/></Paragraph>
      <Paragraph><Run Text="Second line"/></Paragraph>
    `;
    expect(extractClippingText(xml)).toBe("First line\nSecond line");
  });
});
