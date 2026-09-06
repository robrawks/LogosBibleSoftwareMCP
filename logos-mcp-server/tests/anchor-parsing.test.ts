import { describe, it, expect } from "vitest";
import {
  parseAnchorReference,
  parseTagsJson,
} from "../src/services/sqlite-reader.js";

// Fixtures are modeled on real AnchorsJson/TagsJson values observed in
// notestool.db (NotesToolManager) on a current Logos install. Book numbers
// follow Logos' scheme: OT 1–39, deuterocanon 40–60, NT 61–87.

describe("parseAnchorReference", () => {
  it("parses a simple bible reference anchor", () => {
    expect(parseAnchorReference('[{"reference":{"raw":"bible.65.3.21"}}]')).toBe(
      "Acts 3:21"
    );
  });

  it("parses a verse range within one chapter", () => {
    expect(
      parseAnchorReference('[{"reference":{"raw":"bible.65.3.21-65.3.23"}}]')
    ).toBe("Acts 3:21-23");
  });

  it("parses a cross-chapter range", () => {
    expect(
      parseAnchorReference('[{"reference":{"raw":"bible.65.3.21-65.4.5"}}]')
    ).toBe("Acts 3:21-4:5");
  });

  it("parses a cross-book range without dropping the end book", () => {
    expect(
      parseAnchorReference('[{"reference":{"raw":"bible.65.3.21-66.4.5"}}]')
    ).toBe("Acts 3:21-Romans 4:5");
  });

  it("parses a chapter-only reference", () => {
    expect(parseAnchorReference('[{"reference":{"raw":"bible.19.23"}}]')).toBe(
      "Psalms 23"
    );
  });

  it("ignores the version qualifier in the raw reference", () => {
    expect(parseAnchorReference('[{"reference":{"raw":"bible+kjv.6.1.8"}}]')).toBe(
      "Joshua 1:8"
    );
    expect(
      parseAnchorReference('[{"reference":{"raw":"bible+leb2.12.5.13"}}]')
    ).toBe("2 Kings 5:13");
  });

  it("returns the first bible reference when multiple anchors exist", () => {
    const json =
      '[{"workflow":{"templateId":"WORKFLOW:BASIC-BIBLICAL-TOPIC-STUDY","workflowKey":"bk.%GiftsOfTheHolySpirit","responseId":"08C0D3E2B51D93DBF5AD1F399A38967B"}},{"reference":{"raw":"bible.65.3.21-65.3.23"}}]';
    expect(parseAnchorReference(json)).toBe("Acts 3:21-23");
  });

  it("returns null for textRange-only anchors (no reference key)", () => {
    const json =
      '[{"textRange":{"resourceId":"LLS:CATCATHCHRCHITL","version":"2016-08-18T23:01:31Z","offset":1391022,"length":138}}]';
    expect(parseAnchorReference(json)).toBeNull();
  });

  it("returns null for non-bible reference schemes", () => {
    expect(
      parseAnchorReference('[{"reference":{"raw":"bk.%GiftsOfTheHolySpirit"}}]')
    ).toBeNull();
  });

  it("returns null for out-of-range book numbers", () => {
    expect(parseAnchorReference('[{"reference":{"raw":"bible.88.1.18"}}]')).toBeNull();
    expect(parseAnchorReference('[{"reference":{"raw":"bible.0.1.3"}}]')).toBeNull();
  });

  it("labels deuterocanonical books instead of dropping them", () => {
    expect(parseAnchorReference('[{"reference":{"raw":"bible.44.1.1"}}]')).toBe("Sirach 1:1");
  });

  it("returns null for null/empty/malformed JSON", () => {
    expect(parseAnchorReference(null)).toBeNull();
    expect(parseAnchorReference("")).toBeNull();
    expect(parseAnchorReference("not json")).toBeNull();
    expect(parseAnchorReference('{"not":"an array"}')).toBeNull();
    expect(parseAnchorReference("[42]")).toBeNull();
  });

  it("returns null when the reference object lacks a raw string", () => {
    expect(parseAnchorReference('[{"reference":{"passage":"John 3:16"}}]')).toBeNull();
    expect(parseAnchorReference('[{"reference":null}]')).toBeNull();
  });
});

describe("parseTagsJson", () => {
  it("parses a single plain-text tag", () => {
    expect(parseTagsJson('[{"plain":{"text":"faith"}}]')).toEqual(["faith"]);
  });

  it("parses multiple tags in order", () => {
    expect(
      parseTagsJson('[{"plain":{"text":"depression"}},{"plain":{"text":"acedia"}}]')
    ).toEqual(["depression", "acedia"]);
  });

  it("handles plain string entries", () => {
    expect(parseTagsJson('["grace","works"]')).toEqual(["grace", "works"]);
  });

  it("skips non-string tag values", () => {
    expect(parseTagsJson('[{"plain":{"text":42}},{"plain":{"text":"ok"}}]')).toEqual([
      "ok",
    ]);
  });

  it("returns empty array for null/empty/malformed JSON", () => {
    expect(parseTagsJson(null)).toEqual([]);
    expect(parseTagsJson("")).toEqual([]);
    expect(parseTagsJson("not json")).toEqual([]);
    expect(parseTagsJson('{"not":"an array"}')).toEqual([]);
  });
});
