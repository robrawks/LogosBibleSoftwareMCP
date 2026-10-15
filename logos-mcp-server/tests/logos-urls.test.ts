import { describe, it, expect, afterEach, vi } from "vitest";
import {
  buildPassageUrl,
  buildResourceUrl,
  buildGuideUrl,
  buildFactbookUrl,
  buildWordStudyUrl,
  buildSearchAllUrl,
} from "../src/services/logos-urls.js";

// "current" strings are the formats verified on Logos 54 (design doc F1, F5,
// F6); "legacy" strings must equal the URLs the server built before.

describe("buildPassageUrl", () => {
  it("opens the passage in a Bible resource (current)", () => {
    expect(buildPassageUrl("John 5:1", "LLS:LEB", "current")).toBe("logosres:LLS%3ALEB;ref=bible.Jn5.1");
    expect(buildPassageUrl("Romans 8:28-30", "LLS:CSB", "current")).toBe("logosres:LLS%3ACSB;ref=bible.Ro8.28-8.30");
  });

  it("keeps the old Bible URL (legacy)", () => {
    expect(buildPassageUrl("John 5:1", "LLS:LEB", "legacy")).toBe("logos4:///Bible/Jn5.1");
  });

  it("throws for an unparseable reference", () => {
    expect(() => buildPassageUrl("not a ref", "LLS:LEB", "current")).toThrow("Cannot parse reference");
  });
});

describe("buildResourceUrl", () => {
  it("builds one link form, since it takes no style parameter", () => {
    expect(buildResourceUrl("LLS:29.48.20", "John 5:14")).toBe("logosres:LLS%3A29.48.20;ref=bible.Jn5.14");
    expect(buildResourceUrl("LLS:29.48.20")).toBe("logosres:LLS%3A29.48.20");
  });
});

describe("buildGuideUrl", () => {
  it("uses semicolon links with the display title (current)", () => {
    expect(buildGuideUrl("Passage Guide", { kind: "bible", reference: "John 5:1" }, "current")).toBe(
      "logos4:Guide;t=Passage%20Guide;ref=bible.Jn5.1"
    );
    expect(buildGuideUrl("Exegetical Guide", { kind: "bible", reference: "John 5:14" }, "current")).toBe(
      "logos4:Guide;t=Exegetical%20Guide;ref=bible.Jn5.14"
    );
  });

  it("passes a knowledge-base subject as an encoded ref (current)", () => {
    expect(buildGuideUrl("Topic Guide", { kind: "kb", id: "bk.%Sabbath" }, "current")).toBe(
      "logos4:Guide;t=Topic%20Guide;ref=bk.%25Sabbath"
    );
    expect(buildGuideUrl("Sermon Starter Guide", { kind: "kb", id: "bk.to:DBT-5333" }, "current")).toBe(
      "logos4:Guide;t=Sermon%20Starter%20Guide;ref=bk.to%3ADBT-5333"
    );
  });

  it("keeps the old query-string URL (legacy)", () => {
    expect(buildGuideUrl("Exegetical Guide", { kind: "bible", reference: "Romans 12:1" }, "legacy")).toBe(
      "logos4:///Guide?t=Exegetical%20Guide&ref=bible.Ro12.1"
    );
  });

  it("refuses knowledge-base subjects in legacy style", () => {
    expect(() => buildGuideUrl("Topic Guide", { kind: "kb", id: "bk.%Sabbath" }, "legacy")).toThrow(
      /LOGOS_LINK_STYLE=current/
    );
  });
});

describe("buildFactbookUrl", () => {
  it("opens a knowledge-base ID (current)", () => {
    expect(buildFactbookUrl("bk.#Moses", "current")).toBe("logos4:Factbook;ref=bk.%23Moses");
    expect(buildFactbookUrl("bk.%Sabbath", "current")).toBe("logos4:Factbook;ref=bk.%25Sabbath");
  });

  it("keeps the old topic URL (legacy)", () => {
    expect(buildFactbookUrl("Sea of Galilee", "legacy")).toBe("logos4:///Factbook?ref=Sea%20of%20Galilee");
  });
});

describe("buildWordStudyUrl", () => {
  it("opens an empty Bible Word Study (current)", () => {
    expect(buildWordStudyUrl("agape", "current")).toBe("logos4:Guide;t=Bible%20Word%20Study");
  });

  it("keeps the old word URL (legacy)", () => {
    expect(buildWordStudyUrl("agape", "legacy")).toBe("logos4:///WordStudy?word=agape");
  });
});

describe("buildSearchAllUrl", () => {
  it("opens an All search with the query (current)", () => {
    expect(buildSearchAllUrl("justification by faith", "current")).toBe(
      "logos4:Search;kind=AllSearch;q=justification%20by%20faith;syntax=v2"
    );
  });

  it("keeps the old search URL (legacy)", () => {
    expect(buildSearchAllUrl("justification by faith", "legacy")).toBe(
      "logos4:///Search?kind=AllSearch&syntax=v2&q=justification%20by%20faith"
    );
  });
});

describe("LOGOS_LINK_STYLE", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function loadStyle(value: string | undefined) {
    vi.stubEnv("LOGOS_LINK_STYLE", value);
    vi.resetModules();
    return (await import("../src/config.js")).LOGOS_LINK_STYLE;
  }

  it("defaults to current", async () => {
    expect(await loadStyle(undefined)).toBe("current");
  });

  it("accepts legacy in any case", async () => {
    expect(await loadStyle("Legacy")).toBe("legacy");
  });

  it("treats unknown values as current", async () => {
    expect(await loadStyle("bogus")).toBe("current");
  });
});
