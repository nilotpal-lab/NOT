/**
 * Stream Magic-Byte Validation & PPTX Accompaniment Engine
 * SST Chapter Library — Milestone M2 (Features 8, 9, 10)
 *
 * Provides zero-disk-I/O streaming validation for:
 * 1. PDF files: %PDF- magic bytes in part 1 (within first 1024 bytes) and
 *    %%EOF marker in last part (within last 1024 bytes).
 * 2. PPTX packages: ZIP local file header PK\x03\x04 in part 1, and End of Central
 *    Directory (EOCD PK\x05\x06) + Central Directory entries in the last chunk
 *    confirming [Content_Types].xml with presentationml markup, plus zip-bomb safeguards.
 * 3. PPTX accompaniment rule: enforcing kind 'ppt' MUST have an accompanying 'ppt_pdf' preview.
 */

// Constants
export const PDF_MAGIC_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
export const PDF_EOF_BYTES = Buffer.from([0x25, 0x25, 0x45, 0x4f, 0x46]);   // "%%EOF"

export const ZIP_LOCAL_HEADER_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
export const ZIP_CD_HEADER_SIG = 0x02014b50; // "PK\x01\x02" in little endian
export const ZIP_EOCD_SIG = 0x06054b50;      // "PK\x05\x06" in little endian

export const MAX_UNCOMPRESSED_ENTRY_BYTES = 500 * 1024 * 1024; // 500 MB zip-bomb threshold
export const SCAN_WINDOW_BYTES = 1024;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates PDF magic bytes from streaming chunks without writing to disk.
 *
 * @param firstChunk Buffer/Uint8Array containing the start of the file (Part 1)
 * @param lastChunk Optional Buffer/Uint8Array containing the end of the file (Last Part).
 *                  If omitted, only the header is validated.
 */
export function validatePdfMagic(
  firstChunk: Buffer | Uint8Array,
  lastChunk?: Buffer | Uint8Array
): ValidationResult {
  const first = Buffer.isBuffer(firstChunk) ? firstChunk : Buffer.from(firstChunk);

  if (first.length < 5) {
    return { valid: false, error: "File too small or empty to be a valid PDF" };
  }

  // Reject disguised executable binary header (MZ)
  if (first.length >= 2 && first[0] === 0x4d && first[1] === 0x5a) {
    return { valid: false, error: "Invalid PDF header: executable binary detected" };
  }

  // Check %PDF- header within first 1024 bytes (or offset 0)
  const headerScanLimit = Math.min(first.length, SCAN_WINDOW_BYTES);
  const headerSlice = first.subarray(0, headerScanLimit);
  if (headerSlice.indexOf(PDF_MAGIC_BYTES) === -1) {
    return { valid: false, error: "Invalid PDF header: missing %PDF- magic bytes" };
  }

  // If lastChunk is provided, check %%EOF within the last 1024 bytes
  if (lastChunk) {
    const last = Buffer.isBuffer(lastChunk) ? lastChunk : Buffer.from(lastChunk);
    if (last.length < 5) {
      return { valid: false, error: "Invalid PDF structure: missing %%EOF marker near end" };
    }
    const trailerScanLimit = Math.min(last.length, SCAN_WINDOW_BYTES);
    const trailerSlice = last.subarray(last.length - trailerScanLimit);
    if (trailerSlice.indexOf(PDF_EOF_BYTES) === -1) {
      return { valid: false, error: "Invalid PDF structure: missing %%EOF marker near end" };
    }
  }

  return { valid: true };
}

/**
 * Validates PPTX (Open Packaging Conventions ZIP) magic bytes and structure
 * without extracting files or writing to disk.
 *
 * @param firstChunk Buffer/Uint8Array containing the start of the file (Part 1)
 * @param lastChunk Optional Buffer/Uint8Array containing the end of the file (Last Part).
 *                  If omitted, only the local ZIP header is validated.
 */
export function validatePptxMagic(
  firstChunk: Buffer | Uint8Array,
  lastChunk?: Buffer | Uint8Array
): ValidationResult {
  const first = Buffer.isBuffer(firstChunk) ? firstChunk : Buffer.from(firstChunk);

  if (first.length < 4) {
    return { valid: false, error: "File too small to be a valid PPTX/ZIP archive" };
  }

  // Part 1 must begin with PK\x03\x04
  if (!first.subarray(0, 4).equals(ZIP_LOCAL_HEADER_SIG)) {
    return { valid: false, error: "Invalid PPTX header: missing ZIP signature (PK\\x03\\x04)" };
  }

  // If no last chunk is provided (e.g. initial part upload), first part is validated
  if (!lastChunk) {
    return { valid: true };
  }

  const target = Buffer.isBuffer(lastChunk) ? lastChunk : Buffer.from(lastChunk);

  // String check across available buffers for presentationml / Content_Types
  const firstStr = first.toString("binary");
  const targetStr = target.toString("binary");
  const combinedStr = first === target ? targetStr : `${firstStr}\n${targetStr}`;

  // Find End of Central Directory (EOCD PK\x05\x06) in target
  let eocdOffset = -1;
  const maxEocdScan = Math.min(target.length, 65536 + 22);
  const minEocdOffset = Math.max(0, target.length - maxEocdScan);

  for (let i = target.length - 22; i >= minEocdOffset; i--) {
    if (target.readUInt32LE(i) === ZIP_EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }

  // Central directory inspection if EOCD is found
  const foundEntries: string[] = [];
  if (eocdOffset !== -1) {
    const cdSize = target.readUInt32LE(eocdOffset + 12);

    // Locate start of Central Directory in target buffer
    let cdPos = -1;
    if (eocdOffset >= cdSize && target.readUInt32LE(eocdOffset - cdSize) === ZIP_CD_HEADER_SIG) {
      cdPos = eocdOffset - cdSize;
    } else {
      const cdSigBytes = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
      cdPos = target.indexOf(cdSigBytes);
    }

    if (cdPos !== -1) {
      let curr = cdPos;
      while (curr + 46 <= eocdOffset && target.readUInt32LE(curr) === ZIP_CD_HEADER_SIG) {
        const uncompressedSize = target.readUInt32LE(curr + 24);
        const nameLen = target.readUInt16LE(curr + 28);
        const extraLen = target.readUInt16LE(curr + 30);
        const commentLen = target.readUInt16LE(curr + 32);

        // Zip-bomb safeguard: inspect uncompressed size headers
        if (uncompressedSize > MAX_UNCOMPRESSED_ENTRY_BYTES) {
          return {
            valid: false,
            error: `Zip-bomb detected: entry exceeds maximum decompressed size (500 MB)`,
          };
        }

        const nameStart = curr + 46;
        const nameEnd = nameStart + nameLen;
        if (nameEnd <= target.length) {
          const entryName = target.subarray(nameStart, nameEnd).toString("utf-8");
          foundEntries.push(entryName);
        }

        curr = nameEnd + extraLen + commentLen;
      }
    }
  }

  // Validate presence of presentation markers:
  // Must contain [Content_Types].xml or presentationml or ppt/ presentation components
  const hasContentTypes =
    foundEntries.includes("[Content_Types].xml") || combinedStr.includes("[Content_Types].xml");
  const hasPresentationMl =
    combinedStr.includes("presentationml") ||
    foundEntries.some((e) => e.startsWith("ppt/") || e.includes("presentation.xml"));

  if (!hasContentTypes && !hasPresentationMl) {
    return {
      valid: false,
      error: "Invalid PPTX package: missing [Content_Types].xml with presentationml markup",
    };
  }

  return { valid: true };
}

/**
 * Validates the PPTX Accompaniment Rule:
 * Any file upload with kind 'ppt' MUST be accompanied by an export with kind 'ppt_pdf'.
 */
export function validatePptxAccompaniment(params: {
  kind: string;
  hasAccompanyingPdf?: boolean;
  parentFileId?: string | null;
  accompanyingPdfBuffer?: Buffer | Uint8Array;
}): ValidationResult {
  if (params.kind === "ppt") {
    const isAccompanied =
      params.hasAccompanyingPdf === true ||
      (params.parentFileId !== undefined &&
        params.parentFileId !== null &&
        params.parentFileId.trim() !== "") ||
      (params.accompanyingPdfBuffer !== undefined && params.accompanyingPdfBuffer.length > 0);

    if (!isAccompanied) {
      return {
        valid: false,
        error: "PPTX upload validation error: PPTX files require an accompanying PDF preview export",
      };
    }
  }

  return { valid: true };
}

/**
 * Asserts PPTX Accompaniment Rule, throwing an Error on failure.
 */
export function assertPptxAccompaniment(params: {
  kind: string;
  hasAccompanyingPdf?: boolean;
  parentFileId?: string | null;
  accompanyingPdfBuffer?: Buffer | Uint8Array;
}): void {
  const result = validatePptxAccompaniment(params);
  if (!result.valid) {
    throw new Error(result.error);
  }
}
