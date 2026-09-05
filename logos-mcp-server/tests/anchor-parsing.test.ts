import { describe, it, expect } from "vitest";
import {
  parseAnchorReference,
  parseTagsJson,
  bibleRawToHuman,
} from "../src/services/sqlite-reader.js";

// Fixtures are modeled on real AnchorsJson/TagsJson values observed in
// notestool.db (NotesToolManager) on a current Logos install.
//
// Book numbers follow LOGOS numbering, where the deuterocanonical books
// occupy 40-60 and the New Testament runs 61 (Matthew) to 87 (Revelation).
// The references below marked "real" were read out of a live notestool.db and
// cross-checked against the note text anchored to them.

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

  // Regression: the book table used to be Protestant 1-66 numbering, so every
  // New Testament anchor either vanished (book > 66) or was silently renamed to
  // the wrong book (61-66 mapped onto 2 Peter..Revelation). All four of these
  // are real anchors from this install, verified against the anchored note text.
  it("maps New Testament book numbers using Logos numbering", () => {
    expect(
      parseAnchorReference('[{"reference":{"raw":"bible.68.5.11-68.5.21"}}]')
    ).toBe("2 Corinthians 5:11-21");
    expect(
      parseAnchorReference('[{"reference":{"raw":"bible.70.1.4-70.1.14"}}]')
    ).toBe("Ephesians 1:4-14");
    expect(parseAnchorReference('[{"reference":{"raw":"bible+esv.80.1.2"}}]')).toBe(
      "James 1:2"
    );
    expect(parseAnchorReference('[{"reference":{"raw":"bible+esv.64.1.1"}}]')).toBe(
      "John 1:1"
    );
  });

  it("does not read 61-66 as the Protestant books of the same number", () => {
    // bible.61 is Matthew in Logos; the old table called it "2 Peter".
    expect(parseAnchorReference('[{"reference":{"raw":"bible.61.5.3"}}]')).toBe(
      "Matthew 5:3"
    );
    expect(parseAnchorReference('[{"reference":{"raw":"bible.66.8.28"}}]')).toBe(
      "Romans 8:28"
    );
    expect(parseAnchorReference('[{"reference":{"raw":"bible.87.21.4"}}]')).toBe(
      "Revelation 21:4"
    );
  });

  it("parses book-only anchors", () => {
    // Logos writes a whole-book highlight as "bible.70" with no chapter. These
    // are real: four Ephesians highlights on this install are anchored this way.
    expect(parseAnchorReference('[{"reference":{"raw":"bible.70"}}]')).toBe("Ephesians");
    expect(parseAnchorReference('[{"reference":{"raw":"bible.18"}}]')).toBe("Job");
    expect(parseAnchorReference('[{"reference":{"raw":"bible+esv.19"}}]')).toBe("Psalms");
  });

  it("still parses chapter-only and verse anchors after book-only support", () => {
    expect(parseAnchorReference('[{"reference":{"raw":"bible.19.98"}}]')).toBe("Psalms 98");
    expect(parseAnchorReference('[{"reference":{"raw":"bible.18.42.7-18.42.9"}}]')).toBe(
      "Job 42:7-9"
    );
  });

  it("returns null for unmapped deuterocanonical book numbers", () => {
    // 40-60 are the deuterocanonicals. Their exact order is unverified here, so
    // the parser reports nothing rather than naming the wrong book.
    expect(parseAnchorReference('[{"reference":{"raw":"bible.44.3.21"}}]')).toBeNull();
    expect(parseAnchorReference('[{"reference":{"raw":"bible.50.1.1"}}]')).toBeNull();
    expect(parseAnchorReference('[{"reference":{"raw":"bible.88.1.1"}}]')).toBeNull();
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

// bibleRawToHuman is the same decoder parseAnchorReference uses, exported so
// get_study_workflows can decode its instance keys. Fixtures below are real
// Key values read out of Workflows.db.
describe("bibleRawToHuman", () => {
  it("decodes a verse range within one chapter", () => {
    expect(bibleRawToHuman("bible.70.1.4-70.1.14")).toBe("Ephesians 1:4-14");
  });

  it("decodes a range in the Logos-numbered New Testament", () => {
    expect(bibleRawToHuman("bible.68.5.11-68.5.21")).toBe(
      "2 Corinthians 5:11-21"
    );
  });

  it("decodes a chapter-only reference", () => {
    expect(bibleRawToHuman("bible.19.98")).toBe("Psalms 98");
  });

  it("returns null for a non-bible workflow key", () => {
    expect(bibleRawToHuman("bk.%goodnessOfGod")).toBeNull();
  });

  it("returns null rather than throwing on junk", () => {
    expect(bibleRawToHuman("")).toBeNull();
    expect(bibleRawToHuman("bible.")).toBeNull();
  });
});
