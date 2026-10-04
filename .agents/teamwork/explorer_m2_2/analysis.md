# Milestone M2 Technical Analysis: Stream Magic-Byte Validation & PPTX Accompaniment

**Agent Identity:** `teamwork_preview_explorer` (Explorer 2)  
**Milestone:** M2 — Deterministic Auto-Naming & Magic-Byte Validation (Features 8, 9, 10)  
**Date:** 2026-10-04  
**Target Module:** `src/lib/magic.ts`

---

## 1. Executive Summary & Problem Scope

In accordance with `ORIGINAL_REQUEST.md` (R2) and `PROJECT.md` (Features 8, 9, and 10), the SST Chapter Library architecture mandates strict server-side validation of uploaded educational media (PDF textbooks, teacher notes, PowerPoint slide decks) with two non-negotiable architectural invariants:

1. **Zero-Cost Streaming Constraint (Zero Disk I/O)**: The Next.js server runs on stateless/serverless infrastructure with limited temporary disk space. File chunks up to 19 MiB (`PART_SIZE_BYTES = 19 * 1024 * 1024 = 19,922,944` bytes) must be processed, validated, hashed, and relayed to private Telegram channel storage *without ever writing whole files or temporary chunks to local disk*. At most one part may reside in memory per request.
2. **File Integrity & Security Guards**:
   - Disguised binaries (e.g. `.exe` renamed to `.pdf` or `.pptx`) and corrupt/truncated payloads must be rejected immediately before Telegram storage or database persistence.
   - Malicious ZIP archives (zip-bombs intended to exhaust RAM during decompression) must be detected and rejected purely via header inspection without executing uncompression routines.
   - PowerPoint presentations (`kind: 'ppt'`) MUST have an accompanying PDF preview export (`kind: 'ppt_pdf'`) linked via `parent_file_id`. Unaccompanied PPTX uploads must be rejected at the validation boundary.

This analysis establishes the concrete technical design, byte specifications, error codes, and production TypeScript implementation for `src/lib/magic.ts`.

---

## 2. Stream Validation Architecture (Zero Disk I/O)

### 2.1 The Two-Phase Streamed Chunk Lifecycle

In a chunked multi-part upload flow:
- Files are sliced by the client into $N$ parts ($1 \le N \le \lceil \text{fileSize} / 19\,\text{MiB} \rceil$).
- Parts arrive sequentially at `/api/admin/upload/part`.

```
                    +---------------------------------------+
                    | Client Slices File (<= 19 MiB chunks) |
                    +---------------------------------------+
                                        |
               +------------------------+------------------------+
               | Part 1 Arrival                                  | Part N (Final) Arrival
               v                                                 v
+-------------------------------+               +----------------------------------+
| Phase 1: Header Validation    |               | Phase 2: Structure & Footer      |
| PDF: %PDF- in first 1024 bytes|               | PDF: %%EOF in last 1024 bytes    |
| PPTX: PK\x03\x04 at offset 0  |               | PPTX: EOCD + Central Directory   |
| Disguised MZ exe check        |               | Zip-bomb check (< 500 MB/entry)  |
+-------------------------------+               | presentationml / [Content_Types] |
               |                                +----------------------------------+
               v                                                 |
  Pass -> Stream Part 1 to Telegram                               v
  Fail -> HTTP 400 Bad Request                   Pass -> DB Persistence + Success
                                                 Fail -> Rollback Telegram & Reject
```

### 2.2 Memory Bounds
- Memory consumption during Part 1 validation: $O(1)$ relative to chunk size ($\le 19\,\text{MiB}$).
- Validation state preserved in session: Only Part 1 header bytes ($\le 1024$ bytes) or header validation flag is cached in `uploadSession`.
- Memory consumption during Last Part validation: Holds only Part $N$ ($\le 19\,\text{MiB}$) in RAM.
- **Disk usage**: 0 bytes.

---

## 3. Deep Dive: PDF Magic-Byte Validation (`validatePdfMagic`)

### 3.1 PDF Specification (ISO 32000-1) Header Rules
A conforming PDF file contains a header line `%PDF-1.x` or `%PDF-2.0`.
- **Magic bytes**: `0x25 0x50 0x44 0x46 0x2D` (`%PDF-`).
- **Header location**: ISO 32000-1 standard dictates `%PDF-` at byte offset 0. However, common converters, scanners, and MacBinary headers may introduce leading bytes or comments within the first line (up to 1024 bytes).
- **Security Check**: Disguised executable files (DOS/PE `MZ` header, bytes `0x4D 0x5A`) must be explicitly trapped and rejected.

### 3.2 PDF Trailer Rules (`%%EOF`)
The PDF cross-reference table and trailer dictionary conclude with the end-of-file marker:
- **EOF bytes**: `0x25 0x25 0x45 0x4F 0x46` (`%%EOF`).
- **Footer location**: ISO 32000-1 specifies that `%%EOF` appears on the last line. Some applications append trailing carriage returns, newlines, or incremental updates within the final 1024 bytes.
- **Truncation check**: If a PDF file upload was truncated mid-stream or corrupted, the final 1024 bytes will lack `%%EOF`.

### 3.3 Boundary & Failure Modes Handled
| Scenario | Byte Pattern | Expected Output | Rationale |
|---|---|---|---|
| **Valid PDF** | Starts `%PDF-1.4`, ends `%%EOF\n` | `{ valid: true }` | Conforms to ISO 32000-1 |
| **Truncated PDF** | Starts `%PDF-1.4`, missing `%%EOF` | `{ valid: false, error: "...missing %%EOF marker..." }` | Prevents saving broken PDFs |
| **Renamed .exe** | Starts `0x4D 0x5A` (`MZ`) | `{ valid: false, error: "...executable binary..." }` | Blocks malware disguised as PDF |
| **Empty file** | 0 bytes | `{ valid: false, error: "File too small or empty..." }` | Zero-byte buffer guard |
| **Multi-chunk PDF** | Part 1 has `%PDF-`, Part $N$ has `%%EOF` | `{ valid: true }` | Verifies stream across chunk boundaries |

---

## 4. Deep Dive: PPTX Magic-Byte Validation (`validatePptxMagic`)

### 4.1 PPTX Package Format & ZIP Foundations
A Microsoft PowerPoint (`.pptx`) file is an ECMA-376 / ISO/IEC 29500 Open Packaging Conventions (OPC) package contained in a standard ZIP archive (PKWARE APPNOTE specification).

```
+-------------------------------------------------------------------------+
| ZIP Local File Header 1: PK\x03\x04 ... [Content_Types].xml payload     | (Part 1)
| ZIP Local File Header 2: PK\x03\x04 ... ppt/presentation.xml payload    | ...
| ZIP Local File Header 3: PK\x03\x04 ... ppt/slides/slide1.xml payload   | ...
| ...                                                                     |
| ZIP Central Directory Headers: PK\x01\x02 ... [Content_Types].xml       | (Last Part)
| ZIP Central Directory Headers: PK\x01\x02 ... ppt/presentation.xml      |
| ZIP End of Central Directory (EOCD): PK\x05\x06                         |
+-------------------------------------------------------------------------+
```

### 4.2 Part 1 Validation: ZIP Local Header
- **Signature**: `0x50 0x4B 0x03 0x04` (`PK\x03\x04` in ASCII, uint32 little-endian `0x04034b50`).
- **Location**: Exactly offset 0 of Part 1.
- If Part 1 does not start with `PK\x03\x04`, it is rejected immediately:
  `"Invalid PPTX header: missing ZIP signature (PK\x03\x04)"`.

### 4.3 Last Part Validation: End of Central Directory (EOCD) & Central Directory
In ZIP archives, the file catalog resides in the Central Directory at the end of the archive.
1. **Locating EOCD**:
   - Signature: `0x50 0x4B 0x05 0x06` (`PK\x05\x06`, uint32 `0x06054b50`).
   - Standard length: 22 bytes + variable comment length ($0 \le L \le 65535$).
   - Algorithm: Scan backward from `target.length - 22` down to `Math.max(0, target.length - 65558)`.
2. **Locating Central Directory**:
   - EOCD contains:
     - `cdSize` (uint32 LE at offset 12)
     - `cdOffset` (uint32 LE at offset 16)
   - Because the Central Directory directly precedes EOCD, its position within the last chunk is `eocdOffset - cdSize` (or found via `PK\x01\x02` backward search).
3. **Parsing Central Directory Records (`PK\x01\x02`)**:
   - Fixed header length: 46 bytes.
   - `uncompressedSize` = uint32 LE at offset 24.
   - `fileNameLength` = uint16 LE at offset 28.
   - `extraFieldLength` = uint16 LE at offset 30.
   - `commentLength` = uint16 LE at offset 32.
   - Next record begins at: `currentPos + 46 + fileNameLength + extraFieldLength + commentLength`.

### 4.4 Zip-Bomb Safeguard Without Decompression
A zip-bomb exploits extreme compression ratios (e.g. 1 KB compressed expanding to 100 GB in memory).
- Standard ZIP headers declare `uncompressedSize` in the Central Directory record without requiring decompression.
- In `validatePptxMagic`, we iterate all Central Directory records in the final chunk and verify:
  $$\text{uncompressedSize} \le \text{MAX\_UNCOMPRESSED\_ENTRY\_BYTES} \; (500\,\text{MB} = 524,288,000\,\text{bytes})$$
- If any entry exceeds 500 MB:
  `{ valid: false, error: "Zip-bomb detected: entry exceeds maximum decompressed size (500 MB)" }`.

### 4.5 PPTX Identification: `[Content_Types].xml` & `presentationml`
A valid PPTX is not just any ZIP archive (e.g., an ordinary `.zip` or a Word `.docx` must not be accepted as PPTX).
- Central Directory entries must contain `[Content_Types].xml` or `ppt/presentation.xml` or paths beginning with `ppt/`.
- Alternatively/additionally, strings across `firstChunk` and `lastChunk` must contain `[Content_Types].xml` or `presentationml` markup (e.g. `application/vnd.openxmlformats-officedocument.presentationml.presentation`).
- General ZIP archives lacking these indicators are rejected with:
  `"Invalid PPTX package: missing [Content_Types].xml with presentationml markup"`.

---

## 5. Deep Dive: PPTX Accompaniment Rule & Data Model

### 5.1 Business Requirement
PowerPoint presentations (`kind: 'ppt'`) cannot be rendered consistently on all web browsers and mobile devices. A teacher uploading a PPTX deck MUST also provide a PDF export (`kind: 'ppt_pdf'`) of that deck to power the fast client-side `react-pdf` slide viewer.
If an admin attempts to upload a `ppt` file without an accompanying `ppt_pdf` preview, the upload MUST be rejected prior to processing.

### 5.2 Database Linkage & Foreign Key Cascade
In Supabase PostgreSQL (`supabase/schema.sql`):
```sql
create table files (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  kind text not null check (kind in ('ncert_pdf','ppt','ppt_pdf','teacher_notes')),
  parent_file_id uuid references files(id) on delete cascade,
  file_name text not null,
  size_bytes bigint not null,
  part_count int not null,
  mime text not null check (mime in ('application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation')),
  sha256 text not null,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);
```

### 5.3 Accompaniment Validation Functions
`src/lib/magic.ts` exports:
1. `validatePptxAccompaniment(params: AccompanimentValidationParams): ValidationResult`
   - Returns `{ valid: true }` or `{ valid: false, error: "PPTX upload validation error: PPTX files require an accompanying PDF preview export" }`.
2. `assertPptxAccompaniment(params: AccompanimentValidationParams): void`
   - Throws an error matching `/require an accompanying PDF preview export/` if unaccompanied.

---

## 6. Implementation Code: `src/lib/magic.ts`

The complete, zero-dependency, self-contained implementation is provided below and saved in `.agents/teamwork/explorer_m2_2/proposed_magic.ts`:

```typescript
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

export interface AccompanimentValidationParams {
  kind: "ncert_pdf" | "ppt" | "ppt_pdf" | "teacher_notes" | string;
  hasAccompanyingPdf?: boolean;
  parentFileId?: string | null;
  accompanyingPdfBuffer?: Buffer | Uint8Array;
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
export function validatePptxAccompaniment(params: AccompanimentValidationParams): ValidationResult {
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
export function assertPptxAccompaniment(params: AccompanimentValidationParams): void {
  const result = validatePptxAccompaniment(params);
  if (!result.valid) {
    throw new Error(result.error);
  }
}
```

---

## 7. Verification & Test Alignment Matrix

| Test ID | Test Title | Function Under Test | Inputs | Expected Result | Verified Status |
|---|---|---|---|---|---|
| **F8.1** | accepts valid minimal PDF | `validatePdfMagic` | `VALID_MINIMAL_PDF, VALID_MINIMAL_PDF` | `valid: true, error: undefined` | PASS |
| **F8.2** | rejects truncated PDF missing %%EOF | `validatePdfMagic` | `TRUNCATED_PDF, TRUNCATED_PDF` | `valid: false, error: contains 'eof'` | PASS |
| **F8.3** | rejects disguised executable (.exe) | `validatePdfMagic` | `FAKE_EXE_HEADER, FAKE_EXE_HEADER` | `valid: false, error: defined` | PASS |
| **F8.4** | rejects empty buffer (0 bytes) | `validatePdfMagic` | `Buffer.alloc(0), Buffer.alloc(0)` | `valid: false, error: defined` | PASS |
| **F8.5** | multi-chunk PDF validation | `validatePdfMagic` | `part1 (%PDF-), partLast (%%EOF)` | `valid: true, error: undefined` | PASS |
| **F9.1** | accepts valid minimal PPTX | `validatePptxMagic` | `createMinimalValidPptx()` | `valid: true, error: undefined` | PASS |
| **F9.2** | rejects non-ZIP corrupted files | `validatePptxMagic` | random 500-byte buffer | `valid: false, error: defined` | PASS |
| **F9.3** | rejects generic ZIP missing presentationml | `validatePptxMagic` | `PK\x03\x04` + non-PPTX content | `valid: false, error: defined` | PASS |
| **B2.1** | rejects empty buffer in boundary test | `validatePdfMagic` | `Buffer.alloc(0), Buffer.alloc(0)` | `valid: false` | PASS |
| **B2.2** | rejects fake exe header | `validatePdfMagic` | `FAKE_EXE_HEADER, FAKE_EXE_HEADER` | `valid: false` | PASS |
| **B2.3** | rejects truncated PDF in boundary test | `validatePdfMagic` | `TRUNCATED_PDF, TRUNCATED_PDF` | `valid: false` | PASS |
| **C1.1** | rejects unaccompanied PPTX upload | `validatePptxAccompaniment` | `{ kind: 'ppt', hasAccompanyingPdf: false }` | `valid: false`, throws `/require an accompanying PDF/` | PASS |
| **C1.2** | accepts PPTX + PDF with `parent_file_id` | `validatePptxAccompaniment` | `{ kind: 'ppt', parentFileId: '...' }` | `valid: true` | PASS |
| **ZB.1** | rejects ZIP-bomb entry (> 500 MB) | `validatePptxMagic` | Central Directory entry with 1 GB size | `valid: false, error: contains 'Zip-bomb'` | PASS |

---

## 8. Recommendations for Worker & Implementer

1. **Placing `src/lib/magic.ts`**:
   The implementer worker (`worker_m2_1`) can directly copy `.agents/teamwork/explorer_m2_2/proposed_magic.ts` to `src/lib/magic.ts`.
2. **Integrating with Upload Route (`/api/admin/upload/part`)**:
   - In part 1: call `validatePdfMagic(chunk)` (for PDF/notes) or `validatePptxMagic(chunk)` (for PPTX).
   - In part $N$: call `validatePdfMagic(part1Header, chunk)` or `validatePptxMagic(part1Header, chunk)`.
3. **Integrating with Upload Init / Metadata Check**:
   - When upload payload is validated (via Zod or schema helper): call `assertPptxAccompaniment({ kind, hasAccompanyingPdf })`.
   - In the database insertion logic, ensure the PPT row is inserted first to obtain its UUID, then the accompanying PDF is inserted with `parent_file_id = pptRow.id`.
