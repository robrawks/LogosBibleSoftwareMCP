import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { join } from "path";
import {
  makeFixtureDirs,
  createDb,
  useFixtureDirs,
  cleanupFixtureDirs,
  type FixtureDirs,
} from "./helpers/fixtures.js";
import { PASSAGE_LIST_SCHEMA, OBSERVED_PASSAGE_ITEMS_HEX } from "./helpers/schemas.js";
import { parsePassageItems } from "../src/services/study-data.js";

type StudyData = typeof import("../src/services/study-data.js");

describe("parsePassageItems", () => {
  it("decodes the observed blob into readable passages", () => {
    expect(parsePassageItems(Buffer.from(OBSERVED_PASSAGE_ITEMS_HEX, "hex"))).toEqual([
      { rawReference: "bible.18.10.21-18.10.22", reference: "Job 10:21-22" },
      { rawReference: "bible.21.9.10", reference: "Ecclesiastes 9:10" },
      { rawReference: "bible.23.5.14", reference: "Isaiah 5:14" },
    ]);
  });

  it("keeps unmapped references raw and skips entries without a ref", () => {
    const json = '[{"ref":"bible.44.1.1"},{"other":1}]';
    const blob = Buffer.concat([Buffer.from([0x02, json.length, 0, 0, 0]), Buffer.from(json)]);
    expect(parsePassageItems(blob)).toEqual([{ rawReference: "bible.44.1.1", reference: "bible.44.1.1" }]);
  });

  it("returns an empty list for undecodable blobs", () => {
    expect(parsePassageItems(null)).toEqual([]);
    expect(parsePassageItems(Buffer.from([0x02, 0xff]))).toEqual([]);
    expect(parsePassageItems(Buffer.from("not json"))).toEqual([]);
  });
});

describe("getPassageLists with PassageList.db", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(
      join(dirs.dataDir, "Documents", "PassageList", "PassageList.db"),
      `${PASSAGE_LIST_SCHEMA}
       INSERT INTO PassageLists (DocumentGuid, Title, CompressedItems, ModifiedDate, IsDeleted) VALUES
         (X'00', 'Factbook | Sheol — Key Passages', X'${OBSERVED_PASSAGE_ITEMS_HEX}', '2024-07-20T00:11:38-04:00', 0),
         (X'01', 'Broken list', X'02FF', '2023-01-01T00:00:00Z', 0),
         (X'02', 'Deleted list', X'${OBSERVED_PASSAGE_ITEMS_HEX}', '2025-01-01T00:00:00Z', 1);`
    );
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("lists non-deleted lists newest first with their passages", () => {
    const lists = studyData.getPassageLists();
    expect(lists?.map((l) => l.title)).toEqual(["Factbook | Sheol — Key Passages", "Broken list"]);
    expect(lists?.[0].passages.map((p) => p.reference)).toEqual(["Job 10:21-22", "Ecclesiastes 9:10", "Isaiah 5:14"]);
    expect(lists?.[0].modifiedDate).toBe("2024-07-20T00:11:38-04:00");
    expect(lists?.[1].passages).toEqual([]);
  });
});

describe("getPassageLists without PassageList.db", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    useFixtureDirs(dirs);
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => cleanupFixtureDirs(dirs));

  it("returns null", () => {
    expect(studyData.getPassageLists()).toBeNull();
  });
});

describe("getPassageLists when the table check throws", () => {
  let dirs: FixtureDirs;
  let studyData: StudyData;
  const opened: import("better-sqlite3").Database[] = [];

  beforeAll(async () => {
    dirs = makeFixtureDirs();
    createDb(join(dirs.dataDir, "Documents", "PassageList", "PassageList.db"), PASSAGE_LIST_SCHEMA);
    useFixtureDirs(dirs);
    // A corrupt or locked file fails on the first query, not on open.
    vi.doMock("../src/services/db.js", async (importOriginal) => {
      const real = await importOriginal<typeof import("../src/services/db.js")>();
      return {
        ...real,
        openDb: (path: string) => {
          const db = real.openDb(path);
          opened.push(db);
          return db;
        },
        hasTable: () => {
          throw new Error("file is not a database");
        },
      };
    });
    studyData = await import("../src/services/study-data.js");
  });
  afterAll(() => {
    vi.doUnmock("../src/services/db.js");
    cleanupFixtureDirs(dirs);
  });

  it("returns null and closes the handle", () => {
    expect(studyData.getPassageLists()).toBeNull();
    expect(opened).toHaveLength(1);
    expect(opened[0].open).toBe(false);
  });
});
