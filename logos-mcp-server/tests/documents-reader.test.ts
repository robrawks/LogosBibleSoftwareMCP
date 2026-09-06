import { describe, it, expect } from "vitest";
import { blockText, blocksToMarkdown, parseReadSessions, flattenSermonTags, planKey, guidBlobToHex } from "../src/services/documents-reader.js";
import { bibleRawToHuman } from "../src/services/sqlite-reader.js";

describe("bibleRawToHuman — Logos book numbering", () => {
  it("maps the New Testament starting at 61", () => {
    expect(bibleRawToHuman("bible+rvr60.61.7.16")).toBe("Matthew 7:16");
    expect(bibleRawToHuman("bible.81.2.11")).toBe("1 Peter 2:11");
    expect(bibleRawToHuman("bible.87.21.1-87.21.4")).toBe("Revelation 21:1-4");
  });
  it("keeps the Old Testament at 1–39", () => {
    expect(bibleRawToHuman("bible+nasb95.9.16.1-9.16.13")).toBe("1 Samuel 16:1-13");
    expect(bibleRawToHuman("bible.19.146.1")).toBe("Psalms 146:1");
  });
});

describe("sermon block rendering", () => {
  it("decodes XAML runs and entities", () => {
    expect(blockText('<Run Text="OBJETIVO: Que salgan convencidos&#xA;" />')).toBe("OBJETIVO: Que salgan convencidos");
    expect(blockText('<Run FontItalic="True" Text="&quot;Tú qué vas a saber.&quot;" />')).toBe('"Tú qué vas a saber."');
    expect(blockText('<Run Text="Texto base: " /><Reference IsLink="True" Reference="bible.9.16.1"><Run Text="1 Samuel 16:1-13" /></Reference>')).toBe("Texto base: 1 Samuel 16:1-13");
  });
  it("renders the outline as Markdown", () => {
    const md = blocksToMarkdown([
      { kind: "heading2", indent: 0, text: "I. INTRODUCCIÓN", reference: null, source: null },
      { kind: "bullet", indent: 1, text: "Punto", reference: null, source: null },
      { kind: "number", indent: 0, text: "Uno", reference: null, source: null },
      { kind: "number", indent: 0, text: "Dos", reference: null, source: null },
      { kind: "passage", indent: 0, text: "Amados, yo os ruego", reference: "1 Peter 2:11", source: "RVR95" },
      { kind: "normal", indent: 0, text: "", reference: null, source: null },
    ]);
    expect(md).toBe("## I. INTRODUCCIÓN\n\n  - Punto\n\n1. Uno\n\n2. Dos\n\n> **1 Peter 2:11, RVR95** Amados, yo os ruego");
  });
});

describe("reading plan helpers", () => {
  it("derives the status key from a plan DocumentId", () => {
    expect(planKey("Document:ReadingPlan:79960F4FBB184593AACC55C038EEF17C")).toBe("79960f4fbb184593aacc55c038eef17c");
    expect(planKey("a7339a43-56e6-4154-990e-3880f5581531")).toBe("a7339a4356e64154990e3880f5581531");
  });
  it("converts a .NET GUID blob to the SyncId hex", () => {
    const blob = Buffer.from("f54fe5195ec2184d8704512c1615d6b4", "hex");
    expect(guidBlobToHex(blob)).toBe("19e54ff5c25e4d188704512c1615d6b4");
    expect(guidBlobToHex(Buffer.from("a54e9c009b43e5418a9054a10124cc3d", "hex"))).toBe("009c4ea5439b41e58a9054a10124cc3d");
  });
  it("expands ReadSessions ranges", () => {
    expect([...parseReadSessions("0-4")]).toEqual([0, 1, 2, 3, 4]);
    expect([...parseReadSessions("0-1, 3")]).toEqual([0, 1, 3]);
    expect(parseReadSessions(null).size).toBe(0);
  });
});

describe("sermon tags", () => {
  it("flattens Logos tag groups", () => {
    expect(flattenSermonTags('{"referenceTags":["Ro 8"],"topicTags":[{"title":"Gracia"}],"miscellaneousTags":[]}')).toEqual(["Ro 8", "Gracia"]);
    expect(flattenSermonTags(null)).toEqual([]);
  });
});
