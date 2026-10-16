// Logos's own Bible book numbers, as used in raw references such as
// "bible.64.5.1" (= John 5:1). Verified on Logos 54 (design doc F1): Old
// Testament 1–39, deuterocanon 40–60, New Testament 61–87. 40–60 are
// deliberately unmapped (their order was not verified); callers show the raw
// reference string instead. Names match reference-parser's canonical names.
const LOGOS_BOOKS: Record<number, string> = {
  1: "Genesis", 2: "Exodus", 3: "Leviticus", 4: "Numbers", 5: "Deuteronomy",
  6: "Joshua", 7: "Judges", 8: "Ruth", 9: "1 Samuel", 10: "2 Samuel",
  11: "1 Kings", 12: "2 Kings", 13: "1 Chronicles", 14: "2 Chronicles",
  15: "Ezra", 16: "Nehemiah", 17: "Esther", 18: "Job", 19: "Psalms",
  20: "Proverbs", 21: "Ecclesiastes", 22: "Song of Solomon", 23: "Isaiah",
  24: "Jeremiah", 25: "Lamentations", 26: "Ezekiel", 27: "Daniel",
  28: "Hosea", 29: "Joel", 30: "Amos", 31: "Obadiah", 32: "Jonah",
  33: "Micah", 34: "Nahum", 35: "Habakkuk", 36: "Zephaniah", 37: "Haggai",
  38: "Zechariah", 39: "Malachi",
  61: "Matthew", 62: "Mark", 63: "Luke", 64: "John", 65: "Acts",
  66: "Romans", 67: "1 Corinthians", 68: "2 Corinthians", 69: "Galatians",
  70: "Ephesians", 71: "Philippians", 72: "Colossians",
  73: "1 Thessalonians", 74: "2 Thessalonians", 75: "1 Timothy",
  76: "2 Timothy", 77: "Titus", 78: "Philemon", 79: "Hebrews", 80: "James",
  81: "1 Peter", 82: "2 Peter", 83: "1 John", 84: "2 John", 85: "3 John",
  86: "Jude", 87: "Revelation",
};

const NUMBER_BY_BOOK: Map<string, number> = new Map(
  Object.entries(LOGOS_BOOKS).map(([n, name]) => [name, Number(n)])
);

/**
 * Canonical book name for a Logos book number.
 *
 * @param n - Logos book number (1–39 Old Testament, 61–87 New Testament).
 * @returns The book name, or `null` for unmapped numbers (0, 40–60, above 87).
 */
export function logosBookName(n: number): string | null {
  return LOGOS_BOOKS[n] ?? null;
}

/**
 * Logos book number for a canonical book name, as returned by `parseReference`.
 *
 * @param name - Canonical book name such as "Psalms" or "1 John" (case-sensitive).
 * @returns The Logos number, or `null` when the name is not mapped.
 */
export function logosBookNumber(name: string): number | null {
  return NUMBER_BY_BOOK.get(name) ?? null;
}

/** One end of a Logos Bible reference; chapter and verse are optional. */
export interface LogosRefPoint {
  book: number;
  chapter?: number;
  verse?: number;
}

/** Structured form of a raw Logos Bible reference. */
export interface LogosBibleRange {
  start: LogosRefPoint;
  /** Null for a single reference such as "bible.64.5.1". */
  end: LogosRefPoint | null;
}

// bible[+edition].B[.C[.V]][-B[.C[.V]]], e.g. "bible.64.5.1",
// "bible+leb2.65.3.21", "bible.66.1.8-66.1.15", "bible+csb2.61-87".
const LOGOS_BIBLE_RE =
  /^bible(?:\+[a-z0-9]*)?\.(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-(\d+)(?:\.(\d+))?(?:\.(\d+))?)?$/i;

function optionalInt(s: string | undefined): number | undefined {
  return s === undefined ? undefined : parseInt(s, 10);
}

/**
 * Parse a raw Logos Bible reference into its structured form. Best-effort:
 * never throws.
 *
 * @param raw - Raw reference such as "bible+leb2.66.1.8-66.1.15".
 * @returns The parsed range, or `null` for anything else (e.g. "page.9-13").
 */
export function parseLogosBibleRef(raw: string): LogosBibleRange | null {
  const m = raw.trim().match(LOGOS_BIBLE_RE);
  if (!m) return null;
  const start: LogosRefPoint = {
    book: parseInt(m[1], 10),
    chapter: optionalInt(m[2]),
    verse: optionalInt(m[3]),
  };
  const end: LogosRefPoint | null =
    m[4] === undefined
      ? null
      : { book: parseInt(m[4], 10), chapter: optionalInt(m[5]), verse: optionalInt(m[6]) };
  return { start, end };
}

function formatPoint(name: string, p: LogosRefPoint): string {
  if (p.chapter === undefined) return name;
  return p.verse === undefined ? `${name} ${p.chapter}` : `${name} ${p.chapter}:${p.verse}`;
}

/**
 * Readable form of a raw Logos Bible reference ("bible.66.1.8-66.1.15" becomes
 * "Romans 1:8-15"). Best-effort: never throws.
 *
 * @param raw - Raw Logos reference string.
 * @returns The readable reference, or `null` when the input is not a Bible
 *   reference or names an unmapped book (callers then show the raw string).
 */
export function logosRawToHuman(raw: string): string | null {
  const parsed = parseLogosBibleRef(raw);
  if (!parsed) return null;
  const { start, end } = parsed;
  const startName = logosBookName(start.book);
  if (!startName) return null;
  const result = formatPoint(startName, start);
  if (!end) return result;

  const endName = logosBookName(end.book);
  if (!endName) return null;
  if (end.book !== start.book) return `${result}-${formatPoint(endName, end)}`;
  if (end.chapter === undefined) return result;
  if (end.verse === undefined) {
    return end.chapter === start.chapter ? result : `${result}-${end.chapter}`;
  }
  if (start.verse !== undefined && end.chapter === start.chapter) {
    return `${result}-${end.verse}`;
  }
  return `${result}-${end.chapter}:${end.verse}`;
}
