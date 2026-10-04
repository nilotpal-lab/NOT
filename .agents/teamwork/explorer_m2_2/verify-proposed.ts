import {
  validatePdfMagic,
  validatePptxMagic,
  validatePptxAccompaniment,
  assertPptxAccompaniment,
} from "./proposed_magic";
import {
  VALID_MINIMAL_PDF,
  TRUNCATED_PDF,
  FAKE_EXE_HEADER,
  createMinimalValidPptx,
  createDeterministicBuffer,
} from "../../../tests/fixtures/test-fixtures";

let allPass = true;

function check(name: string, condition: boolean, extra?: any) {
  if (!condition) {
    console.error(`FAIL: ${name}`, extra);
    allPass = false;
  } else {
    console.log(`PASS: ${name}`);
  }
}

// 1. Valid minimal PDF
const pdf1 = validatePdfMagic(VALID_MINIMAL_PDF, VALID_MINIMAL_PDF);
check("PDF Minimal Valid", pdf1.valid === true);

// 2. Truncated PDF
const pdf2 = validatePdfMagic(TRUNCATED_PDF, TRUNCATED_PDF);
check(
  "PDF Truncated Reject",
  pdf2.valid === false && pdf2.error?.toLowerCase().includes("eof") === true,
  pdf2
);

// 3. Fake EXE
const pdf3 = validatePdfMagic(FAKE_EXE_HEADER, FAKE_EXE_HEADER);
check("PDF Fake EXE Reject", pdf3.valid === false && !!pdf3.error, pdf3);

// 4. Empty Buffer
const pdf4 = validatePdfMagic(Buffer.alloc(0), Buffer.alloc(0));
check("PDF Empty Buffer Reject", pdf4.valid === false && !!pdf4.error, pdf4);

// 5. Multi-chunk PDF
const part1 = Buffer.concat([Buffer.from("%PDF-1.4\n"), createDeterministicBuffer(1000)]);
const partLast = Buffer.concat([createDeterministicBuffer(1000), Buffer.from("\n%%EOF\n")]);
const pdf5 = validatePdfMagic(part1, partLast);
check("PDF Multi-chunk Valid", pdf5.valid === true, pdf5);

// 6. Valid Minimal PPTX
const pptxBuf = createMinimalValidPptx();
const pptx1 = validatePptxMagic(pptxBuf, pptxBuf);
check("PPTX Minimal Valid", pptx1.valid === true, pptx1);

// 7. Non-ZIP Corrupted file
const corruptBuf = createDeterministicBuffer(500, 0x77);
const pptx2 = validatePptxMagic(corruptBuf, corruptBuf);
check("PPTX Corrupt Reject", pptx2.valid === false && !!pptx2.error, pptx2);

// 8. Non-PPTX ZIP file
const nonPptxZip = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from("some other zip contents here"),
]);
const pptx3 = validatePptxMagic(nonPptxZip, nonPptxZip);
check("PPTX Non-presentation Reject", pptx3.valid === false && !!pptx3.error, pptx3);

// 9. Zip-Bomb safeguard
// Construct a zip containing an entry with uncompressed size 600 MB (0x23c34600)
const localHdr = Buffer.alloc(30);
localHdr.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
const cdHdr = Buffer.alloc(46);
cdHdr.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
cdHdr.writeUInt32LE(600 * 1024 * 1024, 24); // uncompressed size = 600 MB (> 500 MB limit)
const eocdHdr = Buffer.alloc(22);
eocdHdr.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
eocdHdr.writeUInt16LE(1, 8);
eocdHdr.writeUInt16LE(1, 10);
eocdHdr.writeUInt32LE(cdHdr.length, 12);
eocdHdr.writeUInt32LE(localHdr.length, 16);
const zipBombBuf = Buffer.concat([localHdr, cdHdr, eocdHdr]);
const zbRes = validatePptxMagic(zipBombBuf, zipBombBuf);
check(
  "PPTX Zip-Bomb Reject",
  zbRes.valid === false && zbRes.error?.toLowerCase().includes("zip-bomb") === true,
  zbRes
);

// 10. PPTX Accompaniment Rule
const acc1 = validatePptxAccompaniment({ kind: "ppt", hasAccompanyingPdf: false });
check("Accompaniment Reject without PDF", acc1.valid === false && !!acc1.error, acc1);

const acc2 = validatePptxAccompaniment({ kind: "ppt", hasAccompanyingPdf: true });
check("Accompaniment Accept with PDF flag", acc2.valid === true, acc2);

const acc3 = validatePptxAccompaniment({
  kind: "ppt",
  parentFileId: "123e4567-e89b-12d3-a456-426614174000",
});
check("Accompaniment Accept with parentFileId", acc3.valid === true, acc3);

const acc4 = validatePptxAccompaniment({ kind: "ncert_pdf" });
check("Accompaniment Non-PPT always valid", acc4.valid === true, acc4);

let threw = false;
try {
  assertPptxAccompaniment({ kind: "ppt", hasAccompanyingPdf: false });
} catch (e: any) {
  threw = /require an accompanying PDF preview export/.test(e.message);
}
check("assertPptxAccompaniment throws matching error", threw);

if (!allPass) {
  console.error("OVERALL VERIFICATION FAILED!");
  process.exit(1);
} else {
  console.log("ALL 14 CHECKS PASSED PERFECTLY!");
}
