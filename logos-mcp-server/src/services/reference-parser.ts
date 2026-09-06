import type { ParsedReference } from "../types.js";

// ─── Book Mapping Table ──────────────────────────────────────────────────────
// Maps canonical full book name to Logos abbreviation

const BOOK_TO_LOGOS: Record<string, string> = {
  "Genesis": "Ge",
  "Exodus": "Ex",
  "Leviticus": "Le",
  "Numbers": "Nu",
  "Deuteronomy": "Dt",
  "Joshua": "Jos",
  "Judges": "Jdg",
  "Ruth": "Ru",
  "1 Samuel": "1Sa",
  "2 Samuel": "2Sa",
  "1 Kings": "1Ki",
  "2 Kings": "2Ki",
  "1 Chronicles": "1Ch",
  "2 Chronicles": "2Ch",
  "Ezra": "Ezr",
  "Nehemiah": "Ne",
  "Esther": "Es",
  "Job": "Job",
  "Psalms": "Ps",
  "Proverbs": "Pr",
  "Ecclesiastes": "Ec",
  "Song of Solomon": "So",
  "Isaiah": "Is",
  "Jeremiah": "Je",
  "Lamentations": "La",
  "Ezekiel": "Eze",
  "Daniel": "Da",
  "Hosea": "Ho",
  "Joel": "Joe",
  "Amos": "Am",
  "Obadiah": "Ob",
  "Jonah": "Jon",
  "Micah": "Mic",
  "Nahum": "Na",
  "Habakkuk": "Hab",
  "Zephaniah": "Zep",
  "Haggai": "Hag",
  "Zechariah": "Zec",
  "Malachi": "Mal",
  "Matthew": "Mt",
  "Mark": "Mk",
  "Luke": "Lk",
  "John": "Jn",
  "Acts": "Ac",
  "Romans": "Ro",
  "1 Corinthians": "1Co",
  "2 Corinthians": "2Co",
  "Galatians": "Ga",
  "Ephesians": "Eph",
  "Philippians": "Php",
  "Colossians": "Col",
  "1 Thessalonians": "1Th",
  "2 Thessalonians": "2Th",
  "1 Timothy": "1Ti",
  "2 Timothy": "2Ti",
  "Titus": "Tt",
  "Philemon": "Phm",
  "Hebrews": "Heb",
  "James": "Jas",
  "1 Peter": "1Pe",
  "2 Peter": "2Pe",
  "1 John": "1Jn",
  "2 John": "2Jn",
  "3 John": "3Jn",
  "Jude": "Jud",
  "Revelation": "Re",
};

// Reverse mapping: Logos abbreviation -> canonical full name
const LOGOS_TO_BOOK: Record<string, string> = {};
for (const [full, abbr] of Object.entries(BOOK_TO_LOGOS)) {
  LOGOS_TO_BOOK[abbr] = full;
}

// Common abbreviation aliases -> canonical full name
const ALIAS_TO_BOOK: Record<string, string> = {
  "Gen": "Genesis",
  "Exod": "Exodus",
  "Lev": "Leviticus",
  "Num": "Numbers",
  "Deut": "Deuteronomy",
  "Josh": "Joshua",
  "Judg": "Judges",
  "1Sam": "1 Samuel",
  "2Sam": "2 Samuel",
  "1Kgs": "1 Kings",
  "2Kgs": "2 Kings",
  "1Chr": "1 Chronicles",
  "2Chr": "2 Chronicles",
  "Neh": "Nehemiah",
  "Esth": "Esther",
  "Psa": "Psalms",
  "Psalm": "Psalms",
  "Prov": "Proverbs",
  "Eccl": "Ecclesiastes",
  "Song": "Song of Solomon",
  "Isa": "Isaiah",
  "Jer": "Jeremiah",
  "Lam": "Lamentations",
  "Ezek": "Ezekiel",
  "Dan": "Daniel",
  "Hos": "Hosea",
  "Amo": "Amos",
  "Obad": "Obadiah",
  "Mic": "Micah",
  "Nah": "Nahum",
  "Hab": "Habakkuk",
  "Zeph": "Zephaniah",
  "Hag": "Haggai",
  "Zech": "Zechariah",
  "Mal": "Malachi",
  "Matt": "Matthew",
  "Mrk": "Mark",
  "Luk": "Luke",
  "Joh": "John",
  "Rom": "Romans",
  "1Cor": "1 Corinthians",
  "2Cor": "2 Corinthians",
  "Gal": "Galatians",
  "Phil": "Philippians",
  "1Thess": "1 Thessalonians",
  "2Thess": "2 Thessalonians",
  "1Tim": "1 Timothy",
  "2Tim": "2 Timothy",
  "Tit": "Titus",
  "Phlm": "Philemon",
  "Jas": "James",
  "1Pet": "1 Peter",
  "2Pet": "2 Peter",
  "Rev": "Revelation",
};


// Spanish book names and common abbreviations (Reina-Valera usage) ->
// canonical English name. Accents are optional at lookup time (see
// normalizeName), so "Génesis" and "Genesis" both resolve.
const SPANISH_TO_BOOK: Record<string, string> = {
  "Génesis": "Genesis", "Gn": "Genesis", "Gén": "Genesis",
  "Éxodo": "Exodus", "Éx": "Exodus", "Exo": "Exodus",
  "Levítico": "Leviticus", "Lv": "Leviticus",
  "Números": "Numbers", "Nm": "Numbers", "Núm": "Numbers",
  "Deuteronomio": "Deuteronomy", "Dt": "Deuteronomy",
  "Josué": "Joshua", "Jos": "Joshua",
  "Jueces": "Judges", "Jue": "Judges",
  "Rut": "Ruth", "Rt": "Ruth",
  "1 Samuel": "1 Samuel", "1 S": "1 Samuel", "1S": "1 Samuel",
  "2 Samuel": "2 Samuel", "2 S": "2 Samuel", "2S": "2 Samuel",
  "1 Reyes": "1 Kings", "1 R": "1 Kings", "1R": "1 Kings",
  "2 Reyes": "2 Kings", "2 R": "2 Kings", "2R": "2 Kings",
  "1 Crónicas": "1 Chronicles", "1 Cr": "1 Chronicles", "1Cr": "1 Chronicles",
  "2 Crónicas": "2 Chronicles", "2 Cr": "2 Chronicles", "2Cr": "2 Chronicles",
  "Esdras": "Ezra", "Esd": "Ezra",
  "Nehemías": "Nehemiah", "Neh": "Nehemiah",
  "Ester": "Esther", "Est": "Esther",
  "Job": "Job",
  "Salmos": "Psalms", "Salmo": "Psalms", "Sal": "Psalms",
  "Proverbios": "Proverbs", "Pr": "Proverbs", "Prov": "Proverbs",
  "Eclesiastés": "Ecclesiastes", "Ec": "Ecclesiastes", "Ecl": "Ecclesiastes",
  "Cantares": "Song of Solomon", "Cantar de los Cantares": "Song of Solomon", "Cnt": "Song of Solomon", "Cant": "Song of Solomon",
  "Isaías": "Isaiah", "Is": "Isaiah",
  "Jeremías": "Jeremiah", "Jer": "Jeremiah",
  "Lamentaciones": "Lamentations", "Lm": "Lamentations", "Lam": "Lamentations",
  "Ezequiel": "Ezekiel", "Ez": "Ezekiel", "Eze": "Ezekiel",
  "Daniel": "Daniel", "Dn": "Daniel",
  "Oseas": "Hosea", "Os": "Hosea",
  "Joel": "Joel", "Jl": "Joel",
  "Amós": "Amos", "Am": "Amos",
  "Abdías": "Obadiah", "Abd": "Obadiah",
  "Jonás": "Jonah", "Jon": "Jonah",
  "Miqueas": "Micah", "Mi": "Micah", "Miq": "Micah",
  "Nahúm": "Nahum", "Nah": "Nahum",
  "Habacuc": "Habakkuk", "Hab": "Habakkuk",
  "Sofonías": "Zephaniah", "Sof": "Zephaniah",
  "Hageo": "Haggai", "Hag": "Haggai",
  "Zacarías": "Zechariah", "Zac": "Zechariah",
  "Malaquías": "Malachi", "Mal": "Malachi",
  "Mateo": "Matthew", "Mt": "Matthew",
  "Marcos": "Mark", "Mr": "Mark", "Mc": "Mark",
  "Lucas": "Luke", "Lc": "Luke",
  "Juan": "John", "Jn": "John",
  "Hechos": "Acts", "Hch": "Acts", "Hech": "Acts",
  "Romanos": "Romans", "Ro": "Romans", "Rom": "Romans",
  "1 Corintios": "1 Corinthians", "1 Co": "1 Corinthians", "1Co": "1 Corinthians", "1 Cor": "1 Corinthians",
  "2 Corintios": "2 Corinthians", "2 Co": "2 Corinthians", "2Co": "2 Corinthians", "2 Cor": "2 Corinthians",
  "Gálatas": "Galatians", "Gá": "Galatians", "Gal": "Galatians",
  "Efesios": "Ephesians", "Ef": "Ephesians",
  "Filipenses": "Philippians", "Fil": "Philippians", "Flp": "Philippians",
  "Colosenses": "Colossians", "Col": "Colossians",
  "1 Tesalonicenses": "1 Thessalonians", "1 Ts": "1 Thessalonians", "1Ts": "1 Thessalonians", "1 Tes": "1 Thessalonians",
  "2 Tesalonicenses": "2 Thessalonians", "2 Ts": "2 Thessalonians", "2Ts": "2 Thessalonians", "2 Tes": "2 Thessalonians",
  "1 Timoteo": "1 Timothy", "1 Ti": "1 Timothy", "1Ti": "1 Timothy", "1 Tim": "1 Timothy",
  "2 Timoteo": "2 Timothy", "2 Ti": "2 Timothy", "2Ti": "2 Timothy", "2 Tim": "2 Timothy",
  "Tito": "Titus", "Tit": "Titus",
  "Filemón": "Philemon", "Flm": "Philemon", "Film": "Philemon",
  "Hebreos": "Hebrews", "He": "Hebrews", "Heb": "Hebrews",
  "Santiago": "James", "Stg": "James", "Sant": "James",
  "1 Pedro": "1 Peter", "1 P": "1 Peter", "1P": "1 Peter", "1 Pe": "1 Peter",
  "2 Pedro": "2 Peter", "2 P": "2 Peter", "2P": "2 Peter", "2 Pe": "2 Peter",
  "1 Juan": "1 John", "1 Jn": "1 John", "1Jn": "1 John",
  "2 Juan": "2 John", "2 Jn": "2 John", "2Jn": "2 John",
  "3 Juan": "3 John", "3 Jn": "3 John", "3Jn": "3 John",
  "Judas": "Jude", "Jud": "Jude",
  "Apocalipsis": "Revelation", "Ap": "Revelation", "Apoc": "Revelation",
};

/** Lower-case, strip accents and trailing period, collapse spaces. */
function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\.$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Build a case-insensitive lookup combining all name forms -> canonical name
const NAME_LOOKUP: Map<string, string> = new Map();

// Add canonical full names
for (const name of Object.keys(BOOK_TO_LOGOS)) {
  NAME_LOOKUP.set(normalizeName(name), name);
}

// Add common aliases
for (const [alias, canonical] of Object.entries(ALIAS_TO_BOOK)) {
  NAME_LOOKUP.set(normalizeName(alias), canonical);
}

// Add Spanish names and abbreviations (added after English aliases so a
// genuine collision — none known — would favour the Spanish form only when
// the English one is absent)
for (const [alias, canonical] of Object.entries(SPANISH_TO_BOOK)) {
  if (!NAME_LOOKUP.has(normalizeName(alias))) NAME_LOOKUP.set(normalizeName(alias), canonical);
}

// Add Logos abbreviations as aliases too
for (const [abbr, canonical] of Object.entries(LOGOS_TO_BOOK)) {
  if (!NAME_LOOKUP.has(normalizeName(abbr))) NAME_LOOKUP.set(normalizeName(abbr), canonical);
}

// Single-chapter books: when user writes "Jude 4", it means chapter 1 verse 4
const SINGLE_CHAPTER_BOOKS = new Set([
  "Obadiah",
  "Philemon",
  "2 John",
  "3 John",
  "Jude",
]);

// ─── Helper: resolve book name ──────────────────────────────────────────────

export function resolveBookName(input: string): string | null {
  const trimmed = input.trim();
  // Try exact match first (case-insensitive)
  const direct = NAME_LOOKUP.get(normalizeName(trimmed));
  if (direct) return direct;
  return null;
}

// ─── parseReference ─────────────────────────────────────────────────────────

export function parseReference(input: string): ParsedReference {
  const trimmed = input.trim();

  // Regex to capture book name (optionally with leading number) and the rest
  // Book name: optional leading digit+space, then letters (and possibly spaces for multi-word books)
  // After book name: chapter, optional :verse, optional range
  const match = trimmed.match(
    /^(\d?\s*[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]*?)\.?\s+(\d+)(?::(\d+))?(?:\s*[-–]\s*(\d+)(?::(\d+))?)?$/
  );

  if (!match) {
    throw new Error(
      `Cannot parse reference: "${input}". Expected formats like "John 3:16", "1 Cor 13:4-7", "Ps 23", "Romanos 8:28", "1 Co 1:4" (book name or common abbreviation, chapter[:verse[-endVerse]]).`
    );
  }

  const rawBook = match[1].trim();
  const num1 = parseInt(match[2], 10);
  const num2 = match[3] ? parseInt(match[3], 10) : undefined;
  const num3 = match[4] ? parseInt(match[4], 10) : undefined;
  const num4 = match[5] ? parseInt(match[5], 10) : undefined;

  const book = resolveBookName(rawBook);
  if (!book) {
    throw new Error(`Unknown book: "${rawBook}"`);
  }

  const isSingleChapter = SINGLE_CHAPTER_BOOKS.has(book);

  // Parse based on what was captured
  if (isSingleChapter) {
    // For single-chapter books: "Jude 4" = ch1 v4, "Jude 4-6" = ch1 v4-6
    if (num2 === undefined && num3 === undefined) {
      // "Jude 4" -> chapter 1, verse 4
      return { book, chapter: 1, verse: num1 };
    } else if (num2 !== undefined && num3 === undefined) {
      // "Jude 1:4" -> chapter 1, verse 4
      return { book, chapter: num1, verse: num2 };
    } else if (num2 === undefined && num3 !== undefined) {
      // "Jude 4-6" -> chapter 1, verse 4, endVerse 6
      return { book, chapter: 1, verse: num1, endChapter: 1, endVerse: num3 };
    } else {
      // "Jude 1:4-6" or "Jude 1:4-2:3" (unlikely for single chapter)
      if (num4 !== undefined) {
        return { book, chapter: num1, verse: num2, endChapter: num3, endVerse: num4 };
      } else {
        return { book, chapter: num1, verse: num2, endChapter: num1, endVerse: num3 };
      }
    }
  }

  // Multi-chapter books
  if (num2 === undefined && num3 === undefined) {
    // "Genesis 1" -> just chapter
    return { book, chapter: num1 };
  } else if (num2 !== undefined && num3 === undefined) {
    // "Genesis 1:1" -> chapter and verse
    return { book, chapter: num1, verse: num2 };
  } else if (num2 === undefined && num3 !== undefined) {
    // "Genesis 1-3" -> chapter range (no verses)
    return { book, chapter: num1, endChapter: num3 };
  } else if (num2 !== undefined && num3 !== undefined && num4 === undefined) {
    // "Genesis 1:1-3" -> same chapter, verse range
    return { book, chapter: num1, verse: num2, endChapter: num1, endVerse: num3 };
  } else {
    // "Genesis 1:1-2:3" -> cross-chapter range
    return { book, chapter: num1, verse: num2, endChapter: num3, endVerse: num4 };
  }
}

// ─── toLogosUrlRef ──────────────────────────────────────────────────────────

export function toLogosUrlRef(input: string): string {
  const ref = parseReference(input);
  const abbr = BOOK_TO_LOGOS[ref.book];
  if (!abbr) throw new Error(`No Logos abbreviation for: "${ref.book}"`);

  let result = `${abbr}${ref.chapter}`;

  if (ref.verse !== undefined) {
    result += `.${ref.verse}`;
  }

  if (ref.endChapter !== undefined) {
    result += `-${ref.endChapter}`;
    if (ref.endVerse !== undefined) {
      result += `.${ref.endVerse}`;
    }
  }

  return result;
}

// ─── toBibliaRef ────────────────────────────────────────────────────────────

export function toBibliaRef(input: string): string {
  const ref = parseReference(input);

  let result = ref.book.replace(/ /g, "+");
  result += `+${ref.chapter}`;

  if (ref.verse !== undefined) {
    result += `:${ref.verse}`;
  }

  if (ref.endChapter !== undefined && ref.endVerse !== undefined) {
    if (ref.endChapter !== ref.chapter) {
      result += `-${ref.endChapter}:${ref.endVerse}`;
    } else {
      result += `-${ref.endVerse}`;
    }
  } else if (ref.endChapter !== undefined) {
    result += `-${ref.endChapter}`;
  }

  return result;
}

// ─── toHumanReadable ────────────────────────────────────────────────────────

export function toHumanReadable(logosRef: string): string {
  const trimmed = logosRef.trim();

  // Match: optional number prefix, abbreviation letters, then chapter.verse[-endChapter.endVerse]
  const match = trimmed.match(
    /^(\d?)([A-Za-z]+)(\d+)(?:\.(\d+))?(?:-(\d+)(?:\.(\d+))?)?$/
  );

  if (!match) {
    throw new Error(`Cannot parse Logos reference: "${logosRef}"`);
  }

  const numPrefix = match[1] || "";
  const abbrLetters = match[2];
  const abbr = numPrefix + abbrLetters;

  const book = LOGOS_TO_BOOK[abbr];
  if (!book) {
    throw new Error(`Unknown Logos abbreviation: "${abbr}"`);
  }

  const chapter = match[3];
  const verse = match[4];
  const endChapter = match[5];
  const endVerse = match[6];

  let result = `${book} ${chapter}`;

  if (verse !== undefined) {
    result += `:${verse}`;
  }

  if (endChapter !== undefined) {
    if (endVerse !== undefined) {
      if (endChapter !== chapter) {
        result += `-${endChapter}:${endVerse}`;
      } else {
        result += `-${endVerse}`;
      }
    } else {
      result += `-${endChapter}`;
    }
  }

  return result;
}

// ─── expandRange ────────────────────────────────────────────────────────────

export function expandRange(input: string, contextVerses: number = 5): string {
  const ref = parseReference(input);

  if (ref.verse === undefined) {
    // If no verse specified, return as-is
    return input;
  }

  const startVerse = Math.max(1, ref.verse - contextVerses);
  const endVerse = (ref.endVerse ?? ref.verse) + contextVerses;

  const endChapter = ref.endChapter ?? ref.chapter;

  return `${ref.book} ${ref.chapter}:${startVerse}-${endChapter === ref.chapter ? "" : `${endChapter}:`}${endVerse}`;
}
