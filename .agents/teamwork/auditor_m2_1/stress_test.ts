import {
  buildFileName,
  formatTelegramCaption,
  parseTelegramCaption,
  sanitizeTitleSlug,
  sanitizeTeacherSlug,
} from "../../../src/lib/naming";
import {
  validatePdfMagic,
  validatePptxMagic,
  validatePptxAccompaniment,
  assertPptxAccompaniment,
  MAX_UNCOMPRESSED_ENTRY_BYTES,
} from "../../../src/lib/magic";
import {
  VALID_MINIMAL_PDF,
  TRUNCATED_PDF,
  FAKE_EXE_HEADER,
  createMinimalValidPptx,
  createDeterministicBuffer,
} from "../../../tests/fixtures/test-fixtures";

console.log("=== STARTING ADVERSARIAL STRESS TEST SUITE ===");

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`[FAIL] ${msg}`);
  }
}

// -------------------------------------------------------------
// 1. Stress Test buildFileName
// -------------------------------------------------------------
const regexPattern = /^[A-Za-z0-9._-]+$/;

// Extreme / adversarial inputs
const edgeTitles = [
  "",
  "   ",
  "-----",
  "!!!@@@###$$$%%%^^^&&&***",
  "✨🚀🔥📚💡",
  "A".repeat(500),
  "Word-".repeat(50),
  "C++ & C# / .NET in 2026",
  "null",
  "undefined",
  "__proto__",
  "constructor",
  "<script>alert(1)</script>",
  "../../../../etc/passwd",
  "CON.txt",
  "AUX.pdf",
  "Chapter \u0000 with null byte",
  "Äpfel, Über, Ça va, Señor, Dvořák",
];

for (const t of edgeTitles) {
  const name = buildFileName({
    class: 9,
    subject: "Social Studies",
    chapterNo: 4,
    title: t,
    kind: "ncert_pdf",
    ext: "pdf",
  });
  assert(regexPattern.test(name), `Title "${t}" generated invalid name: "${name}"`);
  assert(name.length > 0, `Title "${t}" generated empty filename`);
  assert(!name.includes(".."), `Title "${t}" contains double dots`);
  assert(!name.includes("/"), `Title "${t}" contains slash`);
  assert(!name.includes("\\"), `Title "${t}" contains backslash`);
}

// Chapter numbering edge cases
const chCases = [0, -1, -99, 1, 9, 10, 99, 100, 9999];
for (const ch of chCases) {
  const name = buildFileName({
    class: 10,
    subject: "History",
    chapterNo: ch,
    title: "Nationalism in India",
    kind: "ncert_pdf",
    ext: "pdf",
  });
  assert(regexPattern.test(name), `ch=${ch} failed regex: ${name}`);
}

// Teacher name collision filling
const collisions = [
  "Village-Palampur_Class9_Economics_Ch01_Notes-Teacher.pdf",
  "Village-Palampur_Class9_Economics_Ch01_Notes-Teacher-2.pdf",
  "Village-Palampur_Class9_Economics_Ch01_Notes-Teacher-3.pdf",
];
const cName = buildFileName({
  class: 9,
  subject: "Economics",
  chapterNo: 1,
  title: "Village Palampur",
  kind: "teacher_notes",
  ext: "pdf",
  existingNames: collisions,
});
assert(cName === "Village-Palampur_Class9_Economics_Ch01_Notes-Teacher-4.pdf", `Duplicate resolution failed: ${cName}`);

// -------------------------------------------------------------
// 2. Stress Test formatTelegramCaption & parseTelegramCaption
// -------------------------------------------------------------
const longTitle = "T".repeat(3000);
const caption = formatTelegramCaption({
  title: longTitle,
  class: 10,
  subject: "Economics",
  ch: 1,
  kind: "ncert_pdf",
  name: "Development_Class10_Economics_Ch01_NCERT.pdf",
  sha: "abcdef0123456789",
  part: 1,
  total: 5,
});

assert(caption.length <= 1024, `Caption length exceeds 1024: ${caption.length}`);
assert(caption.includes("part=1/5"), `Caption missing part info`);
assert(caption.includes("sha=abcdef01"), `Caption missing short sha`);

const parsed = parseTelegramCaption(caption);
assert(parsed !== null, "Failed to parse generated caption");
assert(parsed?.class === 10, "Parsed class mismatch");
assert(parsed?.part === 1, "Parsed part mismatch");
assert(parsed?.total === 5, "Parsed total mismatch");

// -------------------------------------------------------------
// 3. Stress Test validatePdfMagic
// -------------------------------------------------------------
// EOF far before the end (> 1024 bytes from end)
const badTrailerPdf = Buffer.concat([
  Buffer.from("%PDF-1.4\ncontent\n%%EOF\n"),
  Buffer.alloc(2000, 0x20), // 2000 bytes of trailing padding
]);
const badTrailerRes = validatePdfMagic(badTrailerPdf, badTrailerPdf);
assert(!badTrailerRes.valid, "Failed to reject %%EOF positioned > 1024 bytes before file end");

// Valid trailer within 1024 bytes of end
const goodTrailerPdf = Buffer.concat([
  Buffer.from("%PDF-1.4\ncontent\n"),
  Buffer.alloc(500, 0x20),
  Buffer.from("%%EOF\n"),
  Buffer.alloc(50, 0x20),
]);
const goodTrailerRes = validatePdfMagic(goodTrailerPdf, goodTrailerPdf);
assert(goodTrailerRes.valid, "Failed to accept %%EOF within 1024 bytes of file end");

// Disguised MZ
const mzRes = validatePdfMagic(FAKE_EXE_HEADER);
assert(!mzRes.valid, "Failed to reject MZ header disguised as PDF");

// -------------------------------------------------------------
// 4. Stress Test validatePptxMagic
// -------------------------------------------------------------
// Valid PPTX
const validPptx = createMinimalValidPptx();
const validPptxRes = validatePptxMagic(validPptx, validPptx);
assert(validPptxRes.valid, "Valid minimal PPTX was rejected");

// Zip bomb buffer test
function createBomb(size: number) {
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`;
  const xmlBuf = Buffer.from(contentTypesXml, "utf-8");
  const fileName = "[Content_Types].xml";
  const fileNameBuf = Buffer.from(fileName, "utf-8");
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  const localRecord = Buffer.concat([localHeader, fileNameBuf, xmlBuf]);
  const centralDirHeader = Buffer.alloc(46);
  centralDirHeader.writeUInt32LE(0x02014b50, 0);
  centralDirHeader.writeUInt32LE(size, 24); // uncompressed size
  centralDirHeader.writeUInt16LE(fileNameBuf.length, 28);
  const cdRecord = Buffer.concat([centralDirHeader, fileNameBuf]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt32LE(cdRecord.length, 12);
  eocd.writeUInt32LE(localRecord.length, 16);
  return Buffer.concat([localRecord, cdRecord, eocd]);
}

const bomb501MB = createBomb(501 * 1024 * 1024);
const bombRes = validatePptxMagic(bomb501MB, bomb501MB);
assert(!bombRes.valid, "Failed to detect zip-bomb entry over 500 MB");
assert(bombRes.error?.includes("Zip-bomb") || false, "Zip-bomb error message missing");

const safe50MB = createBomb(50 * 1024 * 1024);
const safeRes = validatePptxMagic(safe50MB, safe50MB);
assert(safeRes.valid, "Safe 50 MB entry was falsely rejected as zip-bomb");

// Word DOCX disguised as PPTX (has [Content_Types].xml but wordprocessingml instead of presentationml)
const docxXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
const docxBuf = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from(docxXml),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.alloc(18),
]);
const docxRes = validatePptxMagic(docxBuf, docxBuf);
assert(!docxRes.valid, "DOCX package was accepted as PPTX without presentationml");

// -------------------------------------------------------------
// 5. Stress Test validatePptxAccompaniment
// -------------------------------------------------------------
assert(!validatePptxAccompaniment({ kind: "ppt" }).valid, "Unaccompanied PPT accepted");
assert(validatePptxAccompaniment({ kind: "ppt", hasAccompanyingPdf: true }).valid, "Accompanied PPT rejected");
assert(validatePptxAccompaniment({ kind: "ppt", parentFileId: "file_123" }).valid, "PPT with parentFileId rejected");
assert(validatePptxAccompaniment({ kind: "ppt", parent_file_id: "file_123" }).valid, "PPT with parent_file_id rejected");
assert(validatePptxAccompaniment({ kind: "ncert_pdf" }).valid, "NCERT PDF rejected");
assert(validatePptxAccompaniment({ kind: "teacher_notes" }).valid, "Teacher notes rejected");

console.log(`=== STRESS TESTS COMPLETE: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
