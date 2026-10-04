/**
 * Adversarial Test Harness for src/lib/naming.ts
 * Challenger: challenger_m2_1
 * Milestone: M2 (Naming Adversarial Challenger)
 */

import {
  buildFileName,
  formatTelegramCaption,
  parseTelegramCaption,
  sanitizeTitleSlug,
  sanitizeTeacherSlug,
  BuildFileNameParams,
  TelegramCaptionParams,
} from "../../../src/lib/naming";

// Color utilities for terminal output
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, testName: string, failureDetails?: string): void {
  if (condition) {
    results.push({ name: testName, passed: true });
  } else {
    results.push({
      name: testName,
      passed: false,
      error: failureDetails || "Assertion failed",
    });
  }
}

console.log(`${BOLD}${CYAN}====================================================${RESET}`);
console.log(`${BOLD}${CYAN}   M2 ADVERSARIAL STRESS-TEST HARNESS: NAMING.TS    ${RESET}`);
console.log(`${BOLD}${CYAN}====================================================${RESET}\n`);

// ============================================================================
// SUITE 1: Extreme Unicode Titles
// ============================================================================
console.log(`${BOLD}--- Suite 1: Extreme Unicode Titles ---${RESET}`);

// 1.1 Egyptian Hieroglyphs
{
  const pureHieroglyphs = "𓀀𓁐𓃀𓄿𓆓𓇋𓈖𓉐𓊝𓋹𓌢𓍯𓎛𓏤";
  const slug1 = sanitizeTitleSlug(pureHieroglyphs);
  assert(slug1 === "Chapter", "1.1.1 Pure Egyptian Hieroglyphs falls back to 'Chapter'", `Got: "${slug1}"`);

  const mixedHieroglyphs = "𓀀The 𓁐Pyramids 𓃀of 𓄿Giza𓆓";
  const slug2 = sanitizeTitleSlug(mixedHieroglyphs);
  assert(slug2 === "The-Pyramids-of-Giza", "1.1.2 Mixed Hieroglyphs sanitized to ASCII letters", `Got: "${slug2}"`);

  const fileHiero = buildFileName({
    class: 6,
    subject: "History",
    chapterNo: 3,
    title: mixedHieroglyphs,
    kind: "ncert_pdf",
    ext: "pdf",
  });
  assert(fileHiero === "The-Pyramids-of-Giza_Class6_History_Ch03_NCERT.pdf", "1.1.3 buildFileName with hieroglyphs", `Got: ${fileHiero}`);
}

// 1.2 RTL Markers & Bidirectional Unicode
{
  const pureRTLMarkers = "\u200E\u200F\u202A\u202B\u202C\u202D\u202E";
  const slugRTL = sanitizeTitleSlug(pureRTLMarkers);
  assert(slugRTL === "Chapter", "1.2.1 Pure RTL formatting markers fallback to 'Chapter'", `Got: "${slugRTL}"`);

  const arabicTitle = "التاريخ والجغرافيا للصف العاشر";
  const slugArabic = sanitizeTitleSlug(arabicTitle);
  assert(slugArabic === "Chapter", "1.2.2 Pure Arabic title falls back to 'Chapter'", `Got: "${slugArabic}"`);

  const hebrewTitle = "היסטוריה ואזרחות לכיתה י";
  const slugHebrew = sanitizeTitleSlug(hebrewTitle);
  assert(slugHebrew === "Chapter", "1.2.3 Pure Hebrew title falls back to 'Chapter'", `Got: "${slugHebrew}"`);

  const mixedBidi = "Chapter 1 \u202Ereversed\u202C \u200Etest\u200F text";
  const slugMixedBidi = sanitizeTitleSlug(mixedBidi);
  assert(slugMixedBidi === "Chapter-1-reversed-test-text", "1.2.4 Mixed Bidi strips markers preserving words", `Got: "${slugMixedBidi}"`);

  // Bidi Trojan attack: attempts filename extension spoofing
  const trojanTitle = "Harmless\u202Eexe.pdf";
  const slugTrojan = sanitizeTitleSlug(trojanTitle);
  assert(!slugTrojan.includes("\u202E") && slugTrojan === "Harmlessexepdf", "1.2.5 Bidi Trojan extension spoof stripped", `Got: "${slugTrojan}"`);
}

// 1.3 Zero-Width Spaces & Invisible Characters
{
  const invisibles = "\u200B\u200C\u200D\uFEFF\u2060\u200E\u200F";
  const slugInvis = sanitizeTitleSlug(invisibles);
  assert(slugInvis === "Chapter", "1.3.1 Pure zero-width characters fallback to 'Chapter'", `Got: "${slugInvis}"`);

  // ZWSP (\u200B), ZWNJ (\u200C), ZWJ (\u200D), Word Joiner (\u2060)
  const titleWithZW = "Zero\u200BWidth\u200CJoiner\u200DTest\u2060Title";
  const slugZW = sanitizeTitleSlug(titleWithZW);
  assert(slugZW === "ZeroWidthJoinerTestTitle", "1.3.2 Zero-width characters dropped without inserting hyphens", `Got: "${slugZW}"`);

  // BOM (\uFEFF) is defined as ECMAScript WhiteSpace (\s), so between words it replaces with hyphen
  const titleWithBOM = "Title\uFEFFWith\uFEFFBOM";
  const slugBOM = sanitizeTitleSlug(titleWithBOM);
  assert(slugBOM === "Title-With-BOM", "1.3.3 ECMAScript whitespace U+FEFF (BOM) converts to hyphen", `Got: "${slugBOM}"`);

  const titleWithNBSP = "Non\u00A0Breaking\u202FSpace\u3000Ideographic";
  const slugNBSP = sanitizeTitleSlug(titleWithNBSP);
  assert(slugNBSP === "Non-Breaking-Space-Ideographic", "1.3.4 Various Unicode spaces converted to hyphens", `Got: "${slugNBSP}"`);
}

// 1.4 Mathematical & Scientific Symbols
{
  const pureMath = "∑ ∏ √ ∫ ≈ ≠ ≤ ≥ ± ∞ π ∂ ∆ ∇ ∩ ∪ ⊂ ⊃ ⊕ ⊗";
  const slugMath = sanitizeTitleSlug(pureMath);
  assert(slugMath === "Chapter", "1.4.1 Pure math symbols fallback to 'Chapter'", `Got: "${slugMath}"`);

  const mathEquation = "E=mc^2 & √(x_1^2 + y_1^2) = r ± 5% [alpha=α, beta=β]";
  const slugEq = sanitizeTitleSlug(mathEquation);
  assert(/^[A-Za-z0-9-]+$/.test(slugEq), "1.4.2 Math equation stripped to valid slug characters", `Got: "${slugEq}"`);
  assert(!slugEq.includes("="), "1.4.3 Equals signs removed from math equation");
  assert(!slugEq.includes("&"), "1.4.4 Ampersand removed from math equation");
}

// 1.5 Multi-Byte Emojis & Complex Sequences
{
  const pureEmojis = "🔥✨🎉🚀💯";
  const slugPureEmoji = sanitizeTitleSlug(pureEmojis);
  assert(slugPureEmoji === "Chapter", "1.5.1 Pure emojis fallback to 'Chapter'", `Got: "${slugPureEmoji}"`);

  // Family emoji (4 code points + 3 ZWJ): 👨‍👩‍👧‍👦
  const familyEmoji = "👨‍👩‍👧‍👦 Family Social Studies 🧑🏽‍💻 Tech 🏳️‍🌈 History 🇺🇸";
  const slugFamily = sanitizeTitleSlug(familyEmoji);
  assert(slugFamily === "Family-Social-Studies-Tech-History", "1.5.2 Complex compound emojis completely stripped", `Got: "${slugFamily}"`);

  // Keycap sequence: 1️⃣ 2️⃣
  const keycaps = "1️⃣ Chapter One and 2️⃣ Chapter Two";
  const slugKeycaps = sanitizeTitleSlug(keycaps);
  assert(slugKeycaps === "1-Chapter-One-and-2-Chapter-Two", "1.5.3 Keycap number emojis sanitized cleanly", `Got: "${slugKeycaps}"`);
}

// 1.6 Zalgo & Extreme Combining Diacritics
{
  const zalgoText = "T̶h̶i̶s̶ ̶i̶s̶ ̶Z̶a̶l̶g̶o̶ ̶T̶i̶t̶l̶e̶";
  const slugZalgo = sanitizeTitleSlug(zalgoText);
  assert(slugZalgo === "This-is-Zalgo-Title", "1.6.1 Stifling Zalgo combining diacritics stripped cleanly", `Got: "${slugZalgo}"`);

  const frenchGermanAccents = "L'Économie Française, El Niño, Über die Revolution!";
  const slugAccents = sanitizeTitleSlug(frenchGermanAccents);
  assert(slugAccents === "LEconomie-Francaise-El-Nino-Uber-die-Revolution", "1.6.2 Standard diacritics NFD decomposed and preserved as ASCII", `Got: "${slugAccents}"`);
}


// ============================================================================
// SUITE 2: Edge Boundary Lengths
// ============================================================================
console.log(`\n${BOLD}--- Suite 2: Edge Boundary Lengths ---${RESET}`);

// 2.1 Length 59 characters
{
  const title59 = "A".repeat(59);
  const slug59 = sanitizeTitleSlug(title59);
  assert(slug59.length === 59, "2.1.1 59-char alphanumeric title preserved at length 59", `Got length ${slug59.length}`);
  assert(!slug59.endsWith("-"), "2.1.2 59-char slug does not end with hyphen");
  assert(!slug59.startsWith("-"), "2.1.3 59-char slug does not start with hyphen");

  // 59 chars ending in hyphen in raw title: e.g. "A"*58 + "-"
  const title58Hyphen = "A".repeat(58) + "-";
  const slug58 = sanitizeTitleSlug(title58Hyphen);
  assert(slug58.length === 58, "2.1.4 59-char title ending in hyphen trimmed to 58", `Got length ${slug58.length}`);
  assert(!slug58.endsWith("-"), "2.1.5 Trailing hyphen trimmed at 58 length");
}

// 2.2 Length 60 characters
{
  const title60 = "A".repeat(60);
  const slug60 = sanitizeTitleSlug(title60);
  assert(slug60.length === 60, "2.2.1 60-char alphanumeric title preserved at length 60", `Got length ${slug60.length}`);
  assert(!slug60.endsWith("-"), "2.2.2 60-char slug does not end with hyphen");
  assert(slug60 === title60, "2.2.3 60-char slug matches raw title exactly");

  // 59 chars + hyphen = 60 chars raw title
  const title59Hyphen = "A".repeat(59) + "-";
  const slug59From60 = sanitizeTitleSlug(title59Hyphen);
  assert(slug59From60.length === 59, "2.2.4 60-char raw title with trailing hyphen trimmed to 59", `Got length ${slug59From60.length}`);
  assert(!slug59From60.endsWith("-"), "2.2.5 60-char raw title with trailing hyphen has no trailing hyphen");
}

// 2.3 Length 61 characters
{
  const title61 = "A".repeat(61);
  const slug61 = sanitizeTitleSlug(title61);
  assert(slug61.length === 60, "2.3.1 61-char alphanumeric title truncated to exactly 60", `Got length ${slug61.length}`);
  assert(!slug61.endsWith("-"), "2.3.2 61-char truncated slug does not end with hyphen");

  // Adversarial: 59 'A's + "-B" (length 61). Substring(0, 60) would be 59 'A's + "-".
  // Sanitizer MUST strip the trailing hyphen and result in 59 chars.
  const title61WithHyphenAtBoundary = "A".repeat(59) + "-B";
  const slugHyphenBoundary = sanitizeTitleSlug(title61WithHyphenAtBoundary);
  assert(slugHyphenBoundary.length === 59, "2.3.3 61-char title with hyphen at 60th char truncates to 59", `Got length ${slugHyphenBoundary.length}`);
  assert(slugHyphenBoundary === "A".repeat(59), "2.3.4 Trailing hyphen stripped when truncating at boundary");
  assert(!slugHyphenBoundary.endsWith("-"), "2.3.5 Truncated slug verified clean without dangling hyphen");

  // 59 'A's + " B" (space becomes hyphen -> length 61).
  const title61WithSpaceAtBoundary = "A".repeat(59) + " B";
  const slugSpaceBoundary = sanitizeTitleSlug(title61WithSpaceAtBoundary);
  assert(slugSpaceBoundary.length === 59, "2.3.6 61-char title with space at 60th char truncates cleanly to 59", `Got length ${slugSpaceBoundary.length}`);
  assert(!slugSpaceBoundary.endsWith("-"), "2.3.7 Trailing hyphen stripped from converted space at boundary");
}

// 2.4 Length 1000 characters
{
  const title1000Alpha = "A".repeat(1000);
  const slug1000Alpha = sanitizeTitleSlug(title1000Alpha);
  assert(slug1000Alpha.length === 60, "2.4.1 1000-char alphanumeric truncated to 60", `Got length ${slug1000Alpha.length}`);
  assert(!slug1000Alpha.endsWith("-"), "2.4.2 1000-char alphanumeric has no trailing hyphen");

  // 1000 characters of alternating words and hyphens
  const title1000Alternating = "abc-".repeat(250); // 1000 chars
  const slug1000Alt = sanitizeTitleSlug(title1000Alternating);
  assert(slug1000Alt.length <= 60, "2.4.3 1000-char alternating title truncated to <= 60", `Got length ${slug1000Alt.length}`);
  assert(!slug1000Alt.endsWith("-"), "2.4.4 1000-char alternating title does not end with hyphen");
  assert(!slug1000Alt.startsWith("-"), "2.4.5 1000-char alternating title does not start with hyphen");

  // 1000 characters of spaces and symbols only
  const title1000Garbage = " !@#$%^&*()-= \t\n".repeat(60);
  const slug1000Garbage = sanitizeTitleSlug(title1000Garbage);
  assert(slug1000Garbage === "Chapter", "2.4.6 1000-char symbols/whitespace falls back to 'Chapter'", `Got: "${slug1000Garbage}"`);
}

// 2.5 Systematic Sweep: Lengths 1 to 150
{
  let sweepPassed = true;
  let sweepFailureMsg = "";

  for (let len = 1; len <= 150; len++) {
    // Test 1: Simple string
    const s1 = sanitizeTitleSlug("X".repeat(len));
    if (s1.length > 60 || s1.endsWith("-") || s1.startsWith("-")) {
      sweepPassed = false;
      sweepFailureMsg = `Sweep failed for simple string len ${len}: "${s1}"`;
      break;
    }

    // Test 2: String with hyphen near boundary
    const s2 = sanitizeTitleSlug("X".repeat(Math.max(1, len - 2)) + "-Z");
    if (s2.length > 60 || s2.endsWith("-") || s2.startsWith("-")) {
      sweepPassed = false;
      sweepFailureMsg = `Sweep failed for boundary hyphen len ${len}: "${s2}"`;
      break;
    }

    // Test 3: String with trailing hyphen before trim
    const s3 = sanitizeTitleSlug("X".repeat(len) + "-");
    if (s3.length > 60 || s3.endsWith("-") || s3.startsWith("-")) {
      sweepPassed = false;
      sweepFailureMsg = `Sweep failed for trailing hyphen len ${len}: "${s3}"`;
      break;
    }
  }

  assert(sweepPassed, "2.5.1 Systematic sweep of lengths 1..150 guarantees <= 60 and no trailing hyphens", sweepFailureMsg);
}


// ============================================================================
// SUITE 3: Collision Storm
// ============================================================================
console.log(`\n${BOLD}--- Suite 3: Collision Storm ---${RESET}`);

// 3.1 Exactly 50 existing duplicate names (baseName + baseName-2 .. baseName-50)
{
  const baseParams: BuildFileNameParams = {
    class: 10,
    subject: "History",
    chapterNo: 1,
    title: "The Rise of Nationalism in Europe",
    kind: "ncert_pdf",
    ext: "pdf",
  };

  const baseFileName = buildFileName(baseParams); // "The-Rise-of-Nationalism-in-Europe_Class10_History_Ch01_NCERT.pdf"
  const basePrefix = baseFileName.replace(/\.pdf$/, "");

  // Build exact array of 50 existing names:
  // 1. baseFileName (1st file)
  // 2. basePrefix-2.pdf (2nd file)
  // ...
  // 50. basePrefix-50.pdf (50th file)
  const existing50: string[] = [baseFileName];
  for (let i = 2; i <= 50; i++) {
    existing50.push(`${basePrefix}-${i}.pdf`);
  }

  assert(existing50.length === 50, "3.1.1 Created array of exactly 50 existing duplicate names");

  const name51 = buildFileName({
    ...baseParams,
    existingNames: existing50,
  });

  const expected51 = `${basePrefix}-51.pdf`;
  assert(name51 === expected51, "3.1.2 50 existing duplicate names properly receives suffix '-51'", `Expected: ${expected51}, Got: ${name51}`);
  assert(/^[A-Za-z0-9._-]+$/.test(name51), "3.1.3 '-51' name satisfies regex invariant");
}

// 3.2 Sequence Gap in Collisions
{
  const baseParams: BuildFileNameParams = {
    class: 9,
    subject: "Civics",
    chapterNo: 2,
    title: "Constitutional Design",
    kind: "ncert_pdf",
    ext: "pdf",
  };

  const baseFileName = buildFileName(baseParams);
  const basePrefix = baseFileName.replace(/\.pdf$/, "");

  // 50 existing names, BUT slot '-23' is missing
  const existingWithGap: string[] = [baseFileName];
  for (let i = 2; i <= 51; i++) {
    if (i !== 23) {
      existingWithGap.push(`${basePrefix}-${i}.pdf`);
    }
  }

  assert(existingWithGap.length === 50, "3.2.1 Created array of 50 existing names with slot -23 missing");

  const nameGap = buildFileName({
    ...baseParams,
    existingNames: existingWithGap,
  });

  assert(nameGap === `${basePrefix}-23.pdf`, "3.2.2 Sequence gap fills lowest available slot '-23'", `Got: ${nameGap}`);
}

// 3.3 Shuffled / Permuted Collision Array
{
  const baseParams: BuildFileNameParams = {
    class: 8,
    subject: "Geography",
    chapterNo: 4,
    title: "Agriculture",
    kind: "ncert_pdf",
    ext: "pdf",
  };

  const baseFileName = buildFileName(baseParams);
  const basePrefix = baseFileName.replace(/\.pdf$/, "");

  const existingList: string[] = [baseFileName];
  for (let i = 2; i <= 50; i++) {
    existingList.push(`${basePrefix}-${i}.pdf`);
  }

  // Fisher-Yates shuffle
  const shuffled = [...existingList];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const nameShuffled = buildFileName({
    ...baseParams,
    existingNames: shuffled,
  });

  assert(nameShuffled === `${basePrefix}-51.pdf`, "3.3.1 Shuffled 50 existing duplicates correctly resolves to '-51'", `Got: ${nameShuffled}`);
}

// 3.4 Teacher Notes Collision Storm
{
  const teacherParams: BuildFileNameParams = {
    class: 9,
    subject: "Economics",
    chapterNo: 1,
    title: "Village Palampur",
    kind: "teacher_notes",
    teacherName: "Sharma",
    ext: "pdf",
  };

  const teacherBase = buildFileName(teacherParams); // "Village-Palampur_Class9_Economics_Ch01_Notes-Sharma.pdf"
  const teacherPrefix = teacherBase.replace(/\.pdf$/, "");

  const teacherExisting50: string[] = [teacherBase];
  for (let i = 2; i <= 50; i++) {
    teacherExisting50.push(`${teacherPrefix}-${i}.pdf`);
  }

  const teacher51 = buildFileName({
    ...teacherParams,
    existingNames: teacherExisting50,
  });

  assert(teacher51 === `${teacherPrefix}-51.pdf`, "3.4.1 Teacher notes with 50 duplicates resolves to '-51'", `Got: ${teacher51}`);
}

// 3.5 Massive Collision: 200 Existing Duplicates
{
  const baseParams: BuildFileNameParams = {
    class: 10,
    subject: "History",
    chapterNo: 5,
    title: "Print Culture",
    kind: "ncert_pdf",
    ext: "pdf",
  };

  const base = buildFileName(baseParams);
  const prefix = base.replace(/\.pdf$/, "");

  const existing200: string[] = [base];
  for (let i = 2; i <= 200; i++) {
    existing200.push(`${prefix}-${i}.pdf`);
  }

  const name201 = buildFileName({
    ...baseParams,
    existingNames: existing200,
  });

  assert(name201 === `${prefix}-201.pdf`, "3.5.1 Massive 200 existing duplicates resolves to '-201'", `Got: ${name201}`);
}


// ============================================================================
// SUITE 4: Regex Invariant Assertions & Security
// ============================================================================
console.log(`\n${BOLD}--- Suite 4: Regex Invariant & Security ---${RESET}`);

const REGEX_INVARIANT = /^[A-Za-z0-9._-]+$/;

// 4.1 Path Traversal & Injection Attacks
{
  const attacks = [
    "../../../../etc/passwd",
    "..\\..\\Windows\\System32\\cmd.exe",
    "<script>alert('xss')</script>",
    "Robert'); DROP TABLE chapters;--",
    "`id` and $(whoami)",
    "title\x00nullbyte.pdf",
    "newline\r\ninjection",
    "pipe|delimiter|test",
    "quotes\"and'single`backticks",
    "slashes/and\\backslashes",
  ];

  for (let i = 0; i < attacks.length; i++) {
    const atk = attacks[i];
    const res = buildFileName({
      class: 10,
      subject: atk,
      chapterNo: 1,
      title: atk,
      kind: atk,
      teacherName: atk,
      ext: atk,
    });

    assert(REGEX_INVARIANT.test(res), `4.1.${i + 1} Attack payload "${atk.slice(0, 20)}..." satisfies regex invariant`);
    assert(!res.includes("/"), `4.1.${i + 1}b Slashes stripped`);
    assert(!res.includes("\\"), `4.1.${i + 1}c Backslashes stripped`);
    assert(!res.includes("\x00"), `4.1.${i + 1}d Null bytes stripped`);
    assert(!res.includes(";"), `4.1.${i + 1}e Semicolons stripped`);
  }
}

// 4.2 Property-Based Fuzzing (5,000 randomized test cases)
{
  const fuzzTitles = [
    "",
    "   ",
    "-",
    "--",
    "---",
    "A",
    "A-",
    "-A",
    "-A-",
    "A".repeat(59),
    "A".repeat(60),
    "A".repeat(61),
    "A".repeat(120),
    "A-B-C-D-E-F-G",
    "  Multiple   Spaces   Here  ",
    "L'Étranger & Les Misérables",
    "𓀀 Egyptian 𓁐",
    "🔥 Fire 🚀 Rocket",
    "\u200B\u200C\u200D Hidden",
    "Math ∑ + ∫ = π",
    "Arabic التاريخ",
    "Hindi संसाधन",
    "Russian История",
    "CJK 日本語 中国",
  ];

  const fuzzSubjects = [
    "History",
    "Geography",
    "Civics",
    "Social Studies",
    "Math & Science",
    "   ",
    "",
    "!@#$%",
    "Subject-With-Hyphens",
    "Subject_With_Underscores",
  ];

  const fuzzClasses = [6, 7, 8, 9, 10, 0, -1, 12, 100, 999];
  const fuzzChapters = [0, 1, 9, 10, 99, 100, 999, -5];
  const fuzzKinds = ["ncert_pdf", "NCERT", "ppt", "PPT", "ppt_pdf", "PPT-Preview", "teacher_notes", "custom_kind", "weird@kind#"];
  const fuzzExts = ["pdf", ".pdf", "..pdf", "PPTX", ".pptx", "txt", "tar.gz", "", "!@#$"];

  let fuzzPassed = true;
  let fuzzFailureMsg = "";
  const TOTAL_FUZZ = 5000;

  for (let i = 0; i < TOTAL_FUZZ; i++) {
    const title = fuzzTitles[Math.floor(Math.random() * fuzzTitles.length)];
    const subject = fuzzSubjects[Math.floor(Math.random() * fuzzSubjects.length)];
    const cls = fuzzClasses[Math.floor(Math.random() * fuzzClasses.length)];
    const ch = fuzzChapters[Math.floor(Math.random() * fuzzChapters.length)];
    const kind = fuzzKinds[Math.floor(Math.random() * fuzzKinds.length)];
    const ext = fuzzExts[Math.floor(Math.random() * fuzzExts.length)];
    const teacher = Math.random() > 0.5 ? "Dr. Sharma" : undefined;

    try {
      const output = buildFileName({
        class: cls,
        subject,
        chapterNo: ch,
        title,
        kind,
        teacherName: teacher,
        ext,
      });

      if (!REGEX_INVARIANT.test(output)) {
        fuzzPassed = false;
        fuzzFailureMsg = `Fuzz run #${i} output "${output}" violated regex invariant! Inputs: title="${title}", subject="${subject}"`;
        break;
      }
    } catch (err) {
      fuzzPassed = false;
      fuzzFailureMsg = `Fuzz run #${i} threw error: ${err}`;
      break;
    }
  }

  assert(fuzzPassed, `4.2.1 Property-based fuzzing (${TOTAL_FUZZ} iterations) 100% compliant with ^[A-Za-z0-9._-]+$`, fuzzFailureMsg);
}


// ============================================================================
// SUITE 5: Telegram Caption Formatter & Parser
// ============================================================================
console.log(`\n${BOLD}--- Suite 5: Telegram Caption Formatter & Parser ---${RESET}`);

{
  const captionParams: TelegramCaptionParams = {
    title: "Nationalism in India",
    class: 10,
    subject: "History",
    ch: 2,
    kind: "ncert_pdf",
    name: "Nationalism-in-India_Class10_History_Ch02_NCERT.pdf",
    sha: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    part: 1,
    total: 3,
  };

  const caption = formatTelegramCaption(captionParams);
  assert(caption.length <= 1024, "5.1.1 Telegram caption length <= 1024 characters");
  assert(caption.includes("sha=e3b0c442"), "5.1.2 SHA correctly truncated to short 8-char hex");
  assert(caption.includes("part=1/3"), "5.1.3 Part notation matches part=1/3");

  // Roundtrip parse test
  const parsed = parseTelegramCaption(caption);
  assert(parsed !== null, "5.1.4 Caption parses successfully with parseTelegramCaption");
  assert(parsed?.title === "Nationalism in India", "5.1.5 Parsed title matches original");
  assert(parsed?.class === 10, "5.1.6 Parsed class matches original");
  assert(parsed?.subject === "History", "5.1.7 Parsed subject matches original");
  assert(parsed?.ch === 2, "5.1.8 Parsed ch matches original");
  assert(parsed?.kind === "ncert_pdf", "5.1.9 Parsed kind matches original");
  assert(parsed?.name === captionParams.name, "5.1.10 Parsed name matches original");
  assert(parsed?.sha === "e3b0c442", "5.1.11 Parsed sha matches short sha");
  assert(parsed?.part === 1, "5.1.12 Parsed part matches 1");
  assert(parsed?.total === 3, "5.1.13 Parsed total matches 3");

  // Adversarial: Title containing pipes, newlines, and carriage returns
  const messyCaption = formatTelegramCaption({
    ...captionParams,
    title: "Title | With | Pipes \n Newlines \r Carriage",
  });
  assert(!messyCaption.includes("Title | With"), "5.2.1 Pipes in caption title sanitized to prevent delimiter injection");
  assert(!messyCaption.includes("\n"), "5.2.2 Newlines in caption stripped");
  const parsedMessy = parseTelegramCaption(messyCaption);
  assert(parsedMessy !== null, "5.2.3 Sanitized messy caption parses without delimiter corruption");

  // Adversarial: Massive title of 2000 characters
  const massiveCaption = formatTelegramCaption({
    ...captionParams,
    title: "A".repeat(2000),
  });
  assert(massiveCaption.length <= 1024, "5.3.1 2000-char title truncated to guarantee caption <= 1024", `Length: ${massiveCaption.length}`);
  assert(massiveCaption.endsWith("|part=1/3"), "5.3.2 Truncated caption preserves trailer and metadata");
  const parsedMassive = parseTelegramCaption(massiveCaption);
  assert(parsedMassive !== null, "5.3.3 Massive truncated caption remains valid parseable format");
}

// ============================================================================
// FINAL SUMMARY
// ============================================================================
console.log(`\n${BOLD}${CYAN}====================================================${RESET}`);
console.log(`${BOLD}${CYAN}                TEST SUMMARY RESULTS                ${RESET}`);
console.log(`${BOLD}${CYAN}====================================================${RESET}`);

const totalTests = results.length;
const passedTests = results.filter((r) => r.passed).length;
const failedTests = results.filter((r) => !r.passed).length;

for (const res of results) {
  if (res.passed) {
    console.log(`  ${GREEN}✓${RESET} ${res.name}`);
  } else {
    console.log(`  ${RED}✗ FAIL: ${res.name}${RESET}`);
    if (res.error) {
      console.log(`    ${YELLOW}${res.error}${RESET}`);
    }
  }
}

console.log(`\n${BOLD}Total Tests Run: ${totalTests}${RESET}`);
console.log(`${GREEN}Passed: ${passedTests}${RESET}`);
console.log(`${failedTests === 0 ? GREEN : RED}Failed: ${failedTests}${RESET}`);

if (failedTests === 0) {
  console.log(`\n${BOLD}${GREEN}>>> EMPIRICAL VERDICT: ALL ADVERSARIAL TESTS PASSED (100%) <<<${RESET}\n`);
  process.exit(0);
} else {
  console.log(`\n${BOLD}${RED}>>> EMPIRICAL VERDICT: FAILURES DETECTED <<<${RESET}\n`);
  process.exit(1);
}
