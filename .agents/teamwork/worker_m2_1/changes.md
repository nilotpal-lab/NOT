# Milestone M2 Code Changes Summary

**Worker**: `teamwork_preview_worker` (Worker 1 - Milestone M2)  
**Date**: 2026-10-04  
**Scope**: Deterministic Auto-Naming Engine & Stream Magic-Byte Validation (Features 6–10)

---

## 1. Files Created & Modified

### 1.1 `src/lib/naming.ts` (New Module)
- **`sanitizeTitleSlug(rawTitle: string, maxLen = 60): string`**
  - Unicode NFD decomposition + diacritic stripping (`[\u0300-\u036f]`).
  - Strips non-alphanumeric characters except spaces and hyphens.
  - Converts whitespace sequences to hyphens, collapses consecutive hyphens (`-+` to `-`), trims edge hyphens.
  - Truncates to max 60 characters without trailing hyphens.
  - Safe fallback to `"Chapter"` if slug is empty or composed exclusively of stripped symbols.
- **`sanitizeTeacherSlug(rawName?: string): string`**
  - Follows title slug sanitization pipeline, falling back to `"Teacher"`.
- **`buildFileName(params: BuildFileNameParams): string`**
  - Implements canonical format: `{Chapter-Title}_Class{C}_{Subject}_Ch{NN}_{Type}.{ext}`.
  - Pads chapter number with leading zeros (`Ch01`..`Ch99`).
  - Maps file kinds:
    - `ncert_pdf` / `NCERT` -> `NCERT`
    - `ppt` / `PPT` -> `PPT`
    - `ppt_pdf` / `PPT-Preview` / `PPT_PDF` -> `PPT-Preview`
    - `teacher_notes` -> `Notes-${TeacherName}` (e.g. `Notes-Sharma`)
  - Duplicate resolution: appends `-2`, `-3`, etc. when candidate filename exists in `existingNames`.
  - Invariant assertion: strictly validates final filename against `^[A-Za-z0-9._-]+$`, throwing if violated.
- **`formatTelegramCaption(params: TelegramCaptionParams): string`**
  - Formats pipe-delimited machine-readable metadata: `title=...|class=...|subject=...|ch=...|kind=...|name=...|sha=...|part=n/total`.
  - Slices SHA-256 to first 8 characters (`shortSha`).
  - Sanitizes pipes and newlines in titles to preserve delimiter integrity and normalizes spaces.
  - Strictly enforces Telegram Bot API limit (`<= 1024` UTF-8 characters) by dynamically trimming excessive title length.
- **`parseTelegramCaption(caption: string): ParsedTelegramCaption | null`**
  - Structured reverse parser recovering metadata directly from Telegram caption strings.

### 1.2 `src/lib/magic.ts` (New Module)
- **`validatePdfMagic(firstChunk, lastChunk?): ValidationResult`**
  - Zero-disk streaming buffer validation.
  - Rejects empty and tiny buffers (< 5 bytes).
  - Explicitly traps and rejects disguised executables (`MZ` / `0x4D, 0x5A`).
  - Scans for `%PDF-` magic bytes within first 1024 bytes (supporting byte 0 and leading comments/BOM).
  - When `lastChunk` is provided, verifies `%%EOF` marker in trailing 1024 bytes.
- **`validatePptxMagic(firstChunk, lastChunk?): ValidationResult`**
  - Rejects buffers under 4 bytes and disguised executables (`MZ`).
  - Verifies ZIP local file header signature `PK\x03\x04` (`0x50, 0x4B, 0x03, 0x04`) at byte 0.
  - Scans backwards for End of Central Directory (`PK\x05\x06`, `0x06054b50` LE).
  - Iterates Central Directory headers (`PK\x01\x02`):
    - Reads entry uncompressed size at offset 24 without decompressing.
    - Zip-bomb safeguard: rejects any entry exceeding 500 MB (`MAX_UNCOMPRESSED_ENTRY_BYTES = 500 * 1024 * 1024`).
    - Collects entry paths (e.g. `[Content_Types].xml`, `ppt/presentation.xml`).
  - Validates presence of `[Content_Types].xml` and `presentationml` markup across headers and buffers.
  - Rejects generic non-PPTX ZIP archives.
- **`validatePptxAccompaniment(input): ValidationResult` & `assertPptxAccompaniment(input): void`**
  - Supports both batch files array (`Array<{ kind, fileName, parentFileId }`) and single upload payload (`{ kind, hasAccompanyingPdf, parentFileId }`).
  - Enforces that PowerPoint presentations (`kind: 'ppt'`) MUST have an accompanying PDF preview export (`kind: 'ppt_pdf'`).
  - Yields descriptive error: `"PPTX upload validation error: PPTX files require an accompanying PDF preview export"`.

### 1.3 `tests/unit/naming.test.ts` (New Test Suite)
- 25 comprehensive unit tests covering:
  - Standard mappings for Class 6–10 across all 5 SST subjects (`History`, `Geography`, `Civics`, `Economics`, `SocialScience`).
  - PPT and PPT-Preview formatting and alias handling.
  - Teacher notes naming with teacher name.
  - Single-digit zero-padding (`Ch01`..`Ch09`) and double-digit preservation (`Ch10`, `Ch18`, `Ch99`).
  - Multilingual accent transliteration (French, Spanish, German).
  - Emojis, punctuation, path traversal (`../`) stripping.
  - Slug truncation at 60 characters with trailing hyphen cleanup.
  - Extension sanitization (stripping leading dots, lowercase normalization).
  - Teacher name default (`Teacher`) and duplicate disambiguation (`-2`, `-3`, `-4`, sequence gaps).
  - Safety invariant assertion (`^[A-Za-z0-9._-]+$`).
  - Telegram caption formatting, pipe/newline protection, 1024-char boundary enforcement, and roundtrip parsing.

### 1.4 `tests/unit/magic.test.ts` (New Test Suite)
- 27 comprehensive unit tests covering:
  - Valid minimal PDF and multi-chunk PDF streaming.
  - Header offset tolerance (comments/BOM preceding `%PDF-` within 1024 bytes).
  - Rejection of truncated PDF (missing `%%EOF`).
  - Rejection of disguised executable binary (`.exe` renamed to `.pdf`).
  - Rejection of empty (0-byte) and tiny (< 5 byte) buffers.
  - Rejection of non-PDF image headers (PNG, JPEG).
  - Valid minimal PPTX and multi-chunk PPTX.
  - Rejection of corrupted non-ZIP binary and disguised `.exe` binary.
  - Rejection of generic non-PPTX ZIP archives lacking presentationml markup.
  - Rejection of empty (0-byte) and tiny (< 4 byte) buffers.
  - Zip-bomb safeguard rejecting entries with uncompressed size > 500 MB.
  - Acceptance of valid entries within size limits (e.g. 50 MB).
  - PPTX accompaniment enforcement across single payload and batch file arrays.
  - Assertion wrapper error throwing behavior.

---

## 2. Test & Verification Results

- `npm test`: **164/164 tests passed across 12 test files** (100% pass rate).
- `npm run lint`: **0 errors, 0 warnings**.
- `npx tsc --noEmit`: Clean compilation with **0 type errors**.
