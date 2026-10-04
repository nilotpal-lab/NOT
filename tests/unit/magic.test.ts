import { describe, it, expect } from "vitest";
import {
  validatePdfMagic,
  validatePptxMagic,
  validatePptxAccompaniment,
  assertPptxAccompaniment,
  MAX_UNCOMPRESSED_ENTRY_BYTES,
} from "@/lib/magic";
import {
  VALID_MINIMAL_PDF,
  TRUNCATED_PDF,
  FAKE_EXE_HEADER,
  createMinimalValidPptx,
  createDeterministicBuffer,
} from "../fixtures/test-fixtures";

/**
 * Creates a mock PPTX buffer containing a Central Directory record
 * with a specified uncompressed size to test zip-bomb safeguards.
 */
function createPptxWithEntrySize(uncompressedSizeBytes: number): Buffer {
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`;
  const xmlBuf = Buffer.from(contentTypesXml, "utf-8");
  const fileName = "[Content_Types].xml";
  const fileNameBuf = Buffer.from(fileName, "utf-8");

  // Local file header (30 bytes + name + content)
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0); // PK\x03\x04 signature
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt32LE(xmlBuf.length, 18);
  localHeader.writeUInt32LE(xmlBuf.length, 22);
  localHeader.writeUInt16LE(fileNameBuf.length, 26);

  const localFileRecord = Buffer.concat([localHeader, fileNameBuf, xmlBuf]);

  // Central directory header (46 bytes + name)
  const centralDirHeader = Buffer.alloc(46);
  centralDirHeader.writeUInt32LE(0x02014b50, 0); // PK\x01\x02 signature
  centralDirHeader.writeUInt16LE(20, 4);
  centralDirHeader.writeUInt16LE(20, 6);
  centralDirHeader.writeUInt32LE(xmlBuf.length, 20); // compressed size
  centralDirHeader.writeUInt32LE(uncompressedSizeBytes, 24); // uncompressed size under test
  centralDirHeader.writeUInt16LE(fileNameBuf.length, 28); // file name length
  centralDirHeader.writeUInt32LE(0, 42); // relative offset

  const centralDirRecord = Buffer.concat([centralDirHeader, fileNameBuf]);

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06 signature
  eocd.writeUInt16LE(1, 8); // records on disk
  eocd.writeUInt16LE(1, 10); // total records
  eocd.writeUInt32LE(centralDirRecord.length, 12); // central dir size
  eocd.writeUInt32LE(localFileRecord.length, 16); // offset of central dir

  return Buffer.concat([localFileRecord, centralDirRecord, eocd]);
}

describe("Unit: Stream Magic-Byte Validation (src/lib/magic.ts)", () => {
  // --------------------------------------------------------------------------
  // 1. PDF Magic-Byte Validation
  // --------------------------------------------------------------------------
  describe("validatePdfMagic", () => {
    it("accepts valid minimal PDF with %PDF- header and %%EOF trailer", () => {
      const res = validatePdfMagic(VALID_MINIMAL_PDF, VALID_MINIMAL_PDF);
      expect(res.valid).toBe(true);
      expect(res.error).toBeUndefined();
    });

    it("accepts multi-chunk PDF where part 1 has header and last part has EOF", () => {
      const part1 = Buffer.concat([Buffer.from("%PDF-1.4\n"), createDeterministicBuffer(2000)]);
      const partLast = Buffer.concat([createDeterministicBuffer(2000), Buffer.from("\n%%EOF\n")]);
      const res = validatePdfMagic(part1, partLast);
      expect(res.valid).toBe(true);
      expect(res.error).toBeUndefined();
    });

    it("accepts PDF where %PDF- appears within the first 1024 bytes (e.g. comment or BOM)", () => {
      const headerWithPrefix = Buffer.concat([
        Buffer.from("%!PS-Adobe\n"),
        Buffer.from("%PDF-1.7\ncontent\n"),
      ]);
      const trailer = Buffer.from("\n%%EOF\n");
      const res = validatePdfMagic(headerWithPrefix, trailer);
      expect(res.valid).toBe(true);
    });

    it("rejects truncated PDF missing %%EOF trailer marker near the end", () => {
      const res = validatePdfMagic(TRUNCATED_PDF, TRUNCATED_PDF);
      expect(res.valid).toBe(false);
      expect(res.error?.toLowerCase()).toContain("eof");
    });

    it("rejects disguised executable binary (.exe renamed to .pdf)", () => {
      const res = validatePdfMagic(FAKE_EXE_HEADER, FAKE_EXE_HEADER);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("%PDF-");
      expect(res.error).toContain("executable binary");
    });

    it("rejects empty buffer (0 bytes)", () => {
      const empty = Buffer.alloc(0);
      const res = validatePdfMagic(empty, empty);
      expect(res.valid).toBe(false);
      expect(res.error?.toLowerCase()).toContain("too small or empty");
    });

    it("rejects tiny buffer under 5 bytes", () => {
      const tiny = Buffer.from("%PD");
      const res = validatePdfMagic(tiny, tiny);
      expect(res.valid).toBe(false);
      expect(res.error?.toLowerCase()).toContain("too small or empty");
    });

    it("rejects non-PDF image headers (PNG and JPEG)", () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const resPng = validatePdfMagic(pngHeader, pngHeader);
      expect(resPng.valid).toBe(false);
      expect(resPng.error).toContain("%PDF-");

      const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const resJpeg = validatePdfMagic(jpegHeader, jpegHeader);
      expect(resJpeg.valid).toBe(false);
      expect(resJpeg.error).toContain("%PDF-");
    });
  });

  // --------------------------------------------------------------------------
  // 2. PPTX Magic-Byte Validation
  // --------------------------------------------------------------------------
  describe("validatePptxMagic", () => {
    it("accepts valid minimal PPTX with ZIP signature and presentationml", () => {
      const pptx = createMinimalValidPptx();
      const res = validatePptxMagic(pptx, pptx);
      expect(res.valid).toBe(true);
      expect(res.error).toBeUndefined();
    });

    it("accepts multi-chunk PPTX where part 1 has ZIP header and last part has central directory", () => {
      const pptx = createMinimalValidPptx();
      const half = Math.floor(pptx.length / 2);
      const part1 = pptx.subarray(0, half);
      const partLast = pptx.subarray(half);
      const res = validatePptxMagic(part1, partLast);
      expect(res.valid).toBe(true);
    });

    it("rejects non-ZIP corrupted binary claiming to be PPTX", () => {
      const corrupt = createDeterministicBuffer(500, 0x99);
      const res = validatePptxMagic(corrupt, corrupt);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("ZIP signature");
    });

    it("rejects disguised executable binary (.exe renamed to .pptx)", () => {
      const res = validatePptxMagic(FAKE_EXE_HEADER, FAKE_EXE_HEADER);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("ZIP signature");
      expect(res.error).toContain("executable binary");
    });

    it("rejects generic ZIP archive lacking presentationml markup", () => {
      const genericZip = Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from("non-pptx-generic-zip-data"),
      ]);
      const res = validatePptxMagic(genericZip, genericZip);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("presentationml");
    });

    it("rejects empty buffer (0 bytes)", () => {
      const empty = Buffer.alloc(0);
      const res = validatePptxMagic(empty, empty);
      expect(res.valid).toBe(false);
      expect(res.error?.toLowerCase()).toContain("too small");
    });

    it("rejects buffer under 4 bytes", () => {
      const tiny = Buffer.from("PK\x03");
      const res = validatePptxMagic(tiny, tiny);
      expect(res.valid).toBe(false);
      expect(res.error?.toLowerCase()).toContain("too small");
    });

    it("detects and rejects zip-bomb entry exceeding 500 MB without decompressing", () => {
      const oversizedBytes = MAX_UNCOMPRESSED_ENTRY_BYTES + 1024; // > 500 MB
      const zipBomb = createPptxWithEntrySize(oversizedBytes);
      const res = validatePptxMagic(zipBomb, zipBomb);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("Zip-bomb");
      expect(res.error).toContain("500 MB");
    });

    it("accepts PPTX entry within uncompressed size limit (e.g. 50 MB)", () => {
      const safeBytes = 50 * 1024 * 1024; // 50 MB <= 500 MB
      const safePptx = createPptxWithEntrySize(safeBytes);
      const res = validatePptxMagic(safePptx, safePptx);
      expect(res.valid).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 3. PPTX Accompaniment Enforcement
  // --------------------------------------------------------------------------
  describe("PPTX Accompaniment Enforcement Rules", () => {
    describe("Single Upload Payload Checks", () => {
      it("rejects PPTX upload without accompanying PDF preview export", () => {
        const res = validatePptxAccompaniment({
          kind: "ppt",
          hasAccompanyingPdf: false,
        });
        expect(res.valid).toBe(false);
        expect(res.error).toContain("require an accompanying PDF preview export");
      });

      it("throws when using assertPptxAccompaniment on unaccompanied PPTX", () => {
        expect(() => {
          assertPptxAccompaniment({ kind: "ppt", hasAccompanyingPdf: false });
        }).toThrow(/require an accompanying PDF preview export/);
      });

      it("accepts PPTX upload when accompanying PDF preview export is indicated", () => {
        const res = validatePptxAccompaniment({
          kind: "ppt",
          hasAccompanyingPdf: true,
        });
        expect(res.valid).toBe(true);
      });

      it("accepts PPTX upload linked via parentFileId / parent_file_id", () => {
        const res = validatePptxAccompaniment({
          kind: "ppt",
          parentFileId: "123e4567-e89b-12d3-a456-426614174000",
        });
        expect(res.valid).toBe(true);
      });

      it("accepts PPTX upload when accompanying PDF buffer is supplied", () => {
        const res = validatePptxAccompaniment({
          kind: "ppt",
          accompanyingPdfBuffer: VALID_MINIMAL_PDF,
        });
        expect(res.valid).toBe(true);
      });

      it("accepts NCERT PDF upload without accompanying file", () => {
        const res = validatePptxAccompaniment({ kind: "ncert_pdf" });
        expect(res.valid).toBe(true);
      });

      it("accepts Teacher Notes PDF upload without accompanying file", () => {
        const res = validatePptxAccompaniment({ kind: "teacher_notes" });
        expect(res.valid).toBe(true);
      });
    });

    describe("Batch / Array Upload Files Checks", () => {
      it("rejects files array where PPT is present without PPT-Preview", () => {
        const files = [
          { kind: "ppt", fileName: "deck.pptx" },
          { kind: "ncert_pdf", fileName: "book.pdf" },
        ];
        const res = validatePptxAccompaniment(files);
        expect(res.valid).toBe(false);
        expect(res.error).toContain("require an accompanying PDF preview export");
      });

      it("accepts files array where PPT is accompanied by PPT-Preview", () => {
        const files = [
          { kind: "ppt", fileName: "deck.pptx" },
          { kind: "ppt_pdf", fileName: "deck_preview.pdf" },
        ];
        const res = validatePptxAccompaniment(files);
        expect(res.valid).toBe(true);
      });

      it("accepts files array without any PPT files", () => {
        const files = [
          { kind: "ncert_pdf", fileName: "book.pdf" },
          { kind: "teacher_notes", fileName: "notes.pdf" },
        ];
        const res = validatePptxAccompaniment(files);
        expect(res.valid).toBe(true);
      });
    });
  });
});
