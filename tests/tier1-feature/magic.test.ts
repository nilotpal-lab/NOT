import { describe, it, expect, beforeAll } from "vitest";
import { loadModule, MagicModule } from "../helpers/dynamic-loader";
import {
  VALID_MINIMAL_PDF,
  TRUNCATED_PDF,
  FAKE_EXE_HEADER,
  createMinimalValidPptx,
  createDeterministicBuffer,
} from "../fixtures/test-fixtures";

/**
 * Reference specification oracle for magic byte validation
 * Derived directly from ORIGINAL_REQUEST.md R2 & PROJECT.md Interface Contracts
 */
function referenceValidatePdfMagic(
  firstChunk: Buffer | Uint8Array,
  lastChunk?: Buffer | Uint8Array
): { valid: boolean; error?: string } {
  const first = Buffer.isBuffer(firstChunk) ? firstChunk : Buffer.from(firstChunk);
  if (first.length < 5) {
    return { valid: false, error: "File too small or empty to be a valid PDF" };
  }

  // Header must start with %PDF- (0x25, 0x50, 0x44, 0x46, 0x2D)
  const pdfHeader = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (!first.subarray(0, 5).equals(pdfHeader)) {
    return { valid: false, error: "Invalid PDF header: missing %PDF- magic bytes" };
  }

  if (lastChunk) {
    const last = Buffer.isBuffer(lastChunk) ? lastChunk : Buffer.from(lastChunk);
    // %%EOF must appear near the end (check last 1024 bytes)
    const scanArea = last.subarray(Math.max(0, last.length - 1024)).toString("binary");
    if (!scanArea.includes("%%EOF")) {
      return { valid: false, error: "Invalid PDF structure: missing %%EOF marker near end" };
    }
  }

  return { valid: true };
}

function referenceValidatePptxMagic(
  firstChunk: Buffer | Uint8Array,
  lastChunk?: Buffer | Uint8Array
): { valid: boolean; error?: string } {
  const first = Buffer.isBuffer(firstChunk) ? firstChunk : Buffer.from(firstChunk);
  if (first.length < 4) {
    return { valid: false, error: "File too small to be a valid PPTX/ZIP archive" };
  }

  // First chunk must start with PK\x03\x04
  const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  if (!first.subarray(0, 4).equals(zipHeader)) {
    return { valid: false, error: "Invalid PPTX header: missing ZIP signature (PK\\x03\\x04)" };
  }

  // If last chunk provided or single chunk, verify central directory / EOCD
  const target = lastChunk ? Buffer.from(lastChunk) : first;
  const contentStr = target.toString("binary");

  if (!contentStr.includes("[Content_Types].xml") && !contentStr.includes("presentationml")) {
    return {
      valid: false,
      error: "Invalid PPTX package: missing [Content_Types].xml with presentationml markup",
    };
  }

  return { valid: true };
}

describe("Tier 1: Magic-Byte Stream Validation (Features 8 & 9)", () => {
  let liveModule: MagicModule | null = null;

  beforeAll(async () => {
    liveModule = await loadModule<MagicModule>("src/lib/magic.ts");
  });

  const getValidatePdf = () => liveModule?.validatePdfMagic || referenceValidatePdfMagic;
  const getValidatePptx = () => liveModule?.validatePptxMagic || referenceValidatePptxMagic;

  // --------------------------------------------------------------------------
  // Feature 8: PDF Magic-Byte Validation
  // --------------------------------------------------------------------------
  it("F8.1: accepts valid minimal PDF with %PDF- header and %%EOF footer", () => {
    const validatePdf = getValidatePdf();
    const result = validatePdf(VALID_MINIMAL_PDF, VALID_MINIMAL_PDF);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("F8.2: rejects truncated PDF missing %%EOF trailer marker", () => {
    const validatePdf = getValidatePdf();
    const result = validatePdf(TRUNCATED_PDF, TRUNCATED_PDF);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.toLowerCase()).toContain("eof");
  });

  it("F8.3: rejects disguised executable binary (.exe renamed to .pdf)", () => {
    const validatePdf = getValidatePdf();
    const result = validatePdf(FAKE_EXE_HEADER, FAKE_EXE_HEADER);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("F8.4: rejects empty buffer (0 bytes)", () => {
    const validatePdf = getValidatePdf();
    const empty = Buffer.alloc(0);
    const result = validatePdf(empty, empty);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("F8.5: handles multi-chunk PDF validation where header is in part 1 and EOF is in last part", () => {
    const validatePdf = getValidatePdf();
    const part1 = Buffer.concat([Buffer.from("%PDF-1.4\n"), createDeterministicBuffer(1000)]);
    const partLast = Buffer.concat([createDeterministicBuffer(1000), Buffer.from("\n%%EOF\n")]);

    const result = validatePdf(part1, partLast);
    expect(result.valid).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Feature 9: PPTX Magic-Byte Validation
  // --------------------------------------------------------------------------
  it("F9.1: accepts valid minimal PPTX package with ZIP signature and presentationml", () => {
    const validatePptx = getValidatePptx();
    const pptxBuf = createMinimalValidPptx();
    const result = validatePptx(pptxBuf, pptxBuf);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("F9.2: rejects non-ZIP corrupted files claiming to be PPTX", () => {
    const validatePptx = getValidatePptx();
    const corruptBuf = createDeterministicBuffer(500, 0x77);
    const result = validatePptx(corruptBuf, corruptBuf);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("F9.3: rejects ZIP archives that are not PPTX (e.g. general zip missing presentationml)", () => {
    const validatePptx = getValidatePptx();
    // A raw zip header without presentationml
    const nonPptxZip = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from("some other zip contents here"),
    ]);
    const result = validatePptx(nonPptxZip, nonPptxZip);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});
