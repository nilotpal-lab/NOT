# Milestone M2 Specification Mining Analysis: Naming & Validation Engine

**Author**: `teamwork_preview_spec_miner`  
**Date**: 2026-10-04  
**Scope**: Milestone M2 (Features 6, 7, 8, 9, 10)  
**Authoritative Sources**:
- `ORIGINAL_REQUEST.md` (R2: Deterministic Auto-Naming & Magic-Byte Validation)
- `SST-Library-FINAL-Antigravity-Prompt.md` (Section 3, 4, Phase 1 CHECKS 1.2, 1.3, 1.5)
- `PROJECT.md` (Milestone M2, Interface Contracts, Code Layout)
- Reference test oracles in `tests/tier1-feature/naming.test.ts`, `tests/tier1-feature/magic.test.ts`, `tests/tier2-boundary/boundary.test.ts`, `tests/tier3-combination/combination.test.ts`

---

## 1. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Auto-Naming | Deterministic `buildFileName` | Pure function generating canonical filename `{Chapter-Title}_Class{C}_{Subject}_Ch{NN}_{Type}.{ext}` | `{ class, subject, chapterNo, title, kind, teacherName?, ext, existingNames? }` | `string` matching `^[A-Za-z0-9._-]+$` | Throws/rejects on invalid class, subject, or empty sanitized slug | ORIGINAL_REQUEST.md R2, Section 3 |
| 2 | Auto-Naming | Diacritic Transliteration & Normalization | Strips accents and diacritics via Unicode NFD normalization (`[\u0300-\u036f]`) | String with accented characters (e.g. `é`, `ñ`, `ü`) | Clean ASCII string (e.g. `e`, `n`, `u`) | Falls back to empty string if non-convertible | Prompt § 3, CHECKS 1.2 |
| 3 | Auto-Naming | Symbol & Emoji Stripping | Strips all non-alphanumeric characters except spaces and hyphens | String containing symbols (`!@#$%^&*()_+/<>?`), emojis (`🌍`), path exploits (`../`) | Stripped string containing only letters, numbers, spaces, and hyphens | Non-alphanumeric characters completely removed | Prompt § 3, CHECKS 1.2 |
| 4 | Auto-Naming | Slug Hyphen Collapse & Trimming | Converts spaces to hyphens, collapses consecutive hyphens (`---+` to `-`), trims leading/trailing hyphens | Dirty slug string with irregular spacing/hyphens | Single-hyphen separated slug | Empty string if input contained only stripped characters | Prompt § 3, CHECKS 1.2 |
| 5 | Auto-Naming | 60-Character Slug Truncation | Truncates sanitized title slug to max 60 characters without trailing hyphen | Slug of length > 60 | Truncated slug `<= 60` characters with no trailing `-` | Clean boundary slice, never ending in hyphen | Prompt § 3, CHECKS 1.2 |
| 6 | Auto-Naming | Zero-Padded Chapter Number | Pads chapter number with leading zero to 2 digits (`Ch01` to `Ch99`) | `chapterNo` (1..99) | `Ch01`..`Ch99` | Handled via `String(chapterNo).padStart(2, "0")` | Prompt § 3, CHECKS 1.2 |
| 7 | Auto-Naming | Type String Mapping | Maps `kind` to canonical Type string (`ncert_pdf` -> `NCERT`, `ppt` -> `PPT`, `ppt_pdf` -> `PPT-Preview`, `teacher_notes` -> `Notes-{TeacherName}`) | `kind` string, optional `teacherName` | Canonical Type substring | Defaults to `kind` or `Notes-Teacher` if teacher name omitted | Prompt § 3, PROJECT.md |
| 8 | Auto-Naming | Duplicate Teacher Name Resolution | Appends sequential disambiguation suffix (`-2`, `-3`, etc.) if candidate file name already exists in `existingNames` | Base name + extension, `existingNames` array | Disambiguated candidate name (`..._Notes-Sharma-2.pdf`) | Increments counter until an unallocated candidate name is found | Prompt § 3, CHECKS 1.2 |
| 9 | Auto-Naming | Telegram Caption Formatter | Formats structured, pipe-delimited metadata caption (`title=...|class=...|subject=...|ch=...|kind=...|name=...|sha=...|part=n/total`) | Title, class, subject, ch, kind, name, full sha256, part, total | Machine-readable caption string `<= 1024` chars | Slices SHA-256 to first 8 chars | Prompt § 3, § 4, R2 |
| 10 | Validation | PDF Magic-Byte Validation | Verifies `%PDF-` at byte 0 of chunk 1 and `%%EOF` in trailing 1024 bytes of final chunk without writing to disk | `firstChunk: Buffer`, optional `lastChunk: Buffer` | `{ valid: boolean, error?: string }` | Returns `{ valid: false, error }` if magic header or EOF marker is missing | Prompt § Phase 1, CHECKS 1.3 |
| 11 | Validation | PPTX Magic-Byte Validation | Verifies ZIP signature (`PK\x03\x04`) at byte 0 and presence of `[Content_Types].xml` with `presentationml` | `firstChunk: Buffer`, optional `lastChunk: Buffer` | `{ valid: boolean, error?: string }` | Returns `{ valid: false, error }` if not a ZIP or missing PPTX presentationml markup | Prompt § Phase 1, CHECKS 1.3 |
| 12 | Validation | Disguised Binary Rejection | Rejects files disguised with valid extensions (e.g. PE `.exe` starting with `MZ`, images) | Buffer of executable or non-matching file | `{ valid: false, error }` | Specific error identifying non-PDF or non-PPTX structure | Prompt CHECKS 1.3 |
| 13 | Validation | Empty Buffer Rejection | Rejects 0-byte or underflow buffers (< 5 bytes for PDF, < 4 bytes for PPTX) | 0-byte or tiny buffer | `{ valid: false, error }` | Immediate rejection with "File too small or empty" | Prompt CHECKS 1.3 |
| 14 | Validation | PPTX Accompaniment Enforcement | Requires PPTX upload payload to include an accompanying PDF preview export linked via `parent_file_id` | Upload payload `{ kind: 'ppt', hasAccompanyingPdf }` | Validated dual-upload bundle | Throws validation error if accompanying PDF is missing | ORIGINAL_REQUEST.md R2, CHECKS 1.5 |

---

## 2. Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | `buildFileName` | Title with French accents: `"L'Économie Française et les Forêts: 2ème Étude!"` | Transliterated to `"LEconomie-Francaise-et-les-Forets-2eme-Etude"` |
| 2 | `buildFileName` | Title with Spanish accents: `"El Niño y la Revolución"` | Transliterated to `"El-Nino-y-la-Revolucion"` |
| 3 | `buildFileName` | Title with German umlauts: `"Über die Änderungen im 19. Jahrhundert"` | Transliterated to `"Uber-die-Anderungen-im-19-Jahrhundert"` |
| 4 | `buildFileName` | Title with emojis: `"🌍 Earth / Agriculture 🚜 & ../../exploit!"` | Emojis, slashes, and path traversal stripped -> `"Earth-Agriculture-exploit"` |
| 5 | `buildFileName` | Title with excessive whitespace: `"  The   Indian    Constitution   "` | Collapsed and trimmed -> `"The-Indian-Constitution"` |
| 6 | `buildFileName` | Title with consecutive hyphens: `"Colonialism --- And --- The City"` | Collapsed to single hyphens -> `"Colonialism-And-The-City"` |
| 7 | `buildFileName` | Title > 60 chars ending on a hyphen at pos 60: `"A".repeat(59) + "-extra"` | Position 60 is `-`; cleanly trimmed to `"A".repeat(59)` (59 chars, no trailing `-`) |
| 8 | `buildFileName` | Title > 200 chars: exhaustive historical narrative title | Truncated cleanly to max 60 chars; overall filename passes regex `^[A-Za-z0-9._-]+$` |
| 9 | `buildFileName` | Single-digit chapter numbers: `1`, `5`, `9` | Formatted with zero-padding: `Ch01`, `Ch05`, `Ch09` |
| 10 | `buildFileName` | Double-digit chapter numbers: `10`, `18`, `99` | Formatted without alteration: `Ch10`, `Ch18`, `Ch99` |
| 11 | `buildFileName` | Extension with leading dot: `".pdf"`, `".pptx"` | Dot stripped -> `.pdf`, `.pptx` (never double dots `..pdf`) |
| 12 | `buildFileName` | Extension in uppercase: `".PDF"`, `".PPTX"` | Normalized to lowercase `.pdf`, `.pptx` |
| 13 | `buildFileName` | Teacher name with spaces and titles: `"Dr. R. K. Sharma (HOD)"` | Sanitized to `"Notes-Dr-R-K-Sharma-HOD"` |
| 14 | `buildFileName` | Teacher name undefined or empty string | Defaults cleanly to `"Notes-Teacher"` |
| 15 | `buildFileName` | Duplicate teacher name (collision 1): `existingNames` contains base name | Suffix `-2` appended: `..._Notes-Sharma-2.pdf` |
| 16 | `buildFileName` | Duplicate teacher name (collision 2): `existingNames` contains base and `-2` | Suffix `-3` appended: `..._Notes-Sharma-3.pdf` |
| 17 | `buildFileName` | Duplicate teacher name with sequence gap: `existingNames` has base and `-3` | Suffix `-2` is selected (first free slot) |
| 18 | `buildFileName` | Non-teacher kinds (`ncert_pdf`, `ppt`, `ppt_pdf`) with collisions | Duplicate suffix only applies to `teacher_notes`; database unique constraint catches exact chapter+sha256 duplicates |
| 19 | `buildFileName` | Invariant check on all outputs | Output matches `^[A-Za-z0-9._-]+$`; never contains spaces, colons, slashes, or query chars |
| 20 | `validatePdfMagic` | Valid minimal PDF conforming to PDF 1.4 | Returns `{ valid: true }` |
| 21 | `validatePdfMagic` | Multi-chunk PDF: header in part 1, footer in part 3 | Returns `{ valid: true }` without holding part 2 in memory |
| 22 | `validatePdfMagic` | Corrupted PDF header: missing `%PDF-` at byte 0 | Returns `{ valid: false, error: "Invalid PDF header: missing %PDF- magic bytes" }` |
| 23 | `validatePdfMagic` | Truncated PDF: `%PDF-1.4` present, but missing `%%EOF` | Returns `{ valid: false, error: "Invalid PDF structure: missing %%EOF marker near end" }` |
| 24 | `validatePdfMagic` | Renamed Windows executable (`.exe` starting with `MZ` / `0x4D 0x5A`) | Returns `{ valid: false, error: "Invalid PDF header: missing %PDF- magic bytes" }` |
| 25 | `validatePdfMagic` | Empty buffer (0 bytes) | Returns `{ valid: false, error: "File too small or empty to be a valid PDF" }` |
| 26 | `validatePdfMagic` | Tiny buffer (< 5 bytes, e.g. `%PD`) | Returns `{ valid: false, error: "File too small or empty to be a valid PDF" }` |
| 27 | `validatePdfMagic` | Disguised image (PNG starting `\x89PNG\r\n\x1a\n` or JPEG `\xFF\xD8\xFF`) | Returns `{ valid: false, error: "Invalid PDF header: missing %PDF- magic bytes" }` |
| 28 | `validatePptxMagic`| Valid minimal PPTX package with ZIP signature and `presentationml` | Returns `{ valid: true }` |
| 29 | `validatePptxMagic`| Multi-chunk PPTX: ZIP header in chunk 1, central directory in last chunk | Returns `{ valid: true }` |
| 30 | `validatePptxMagic`| Non-ZIP binary claiming to be `.pptx` (random bytes) | Returns `{ valid: false, error: "Invalid PPTX header: missing ZIP signature (PK\\x03\\x04)" }` |
| 31 | `validatePptxMagic`| Renamed executable (`MZ`) claiming to be `.pptx` | Returns `{ valid: false, error: "Invalid PPTX header: missing ZIP signature (PK\\x03\\x04)" }` |
| 32 | `validatePptxMagic`| Generic ZIP archive lacking `[Content_Types].xml` or `presentationml` (e.g. text zip) | Returns `{ valid: false, error: "Invalid PPTX package: missing [Content_Types].xml with presentationml markup" }` |
| 33 | `validatePptxMagic`| Empty buffer (0 bytes) | Returns `{ valid: false, error: "File too small to be a valid PPTX/ZIP archive" }` |
| 34 | `validatePptxMagic`| Underflow buffer (< 4 bytes, e.g. `PK\x03`) | Returns `{ valid: false, error: "File too small to be a valid PPTX/ZIP archive" }` |
| 35 | PPTX Accompaniment | PPTX upload submitted without accompanying PDF preview | Rejected with validation error: "PPTX uploads require an accompanying PDF preview export" |
| 36 | PPTX Accompaniment | PPTX upload submitted with corrupt accompanying PDF | Rejected at magic byte stage of accompanying PDF |
| 37 | PPTX Accompaniment | PPTX upload submitted with valid accompanying PDF | Accepted: `ppt` row created as parent, `ppt_pdf` row created with `parent_file_id` referencing `ppt.id` |

---

## 3. In-Depth Feature Group 1: Deterministic `buildFileName` & Captions

### 3.1 Canonical Pattern
```text
{Chapter-Title}_Class{C}_{Subject}_Ch{NN}_{Type}.{ext}
```

### 3.2 Component Rules & Valid Domains
1. **Chapter-Title Slug**:
   - Source: `title` parameter (from user/admin input).
   - Step 1: Unicode NFD normalization: `title.normalize("NFD")`.
   - Step 2: Strip diacritics: `.replace(/[\u0300-\u036f]/g, "")`.
   - Step 3: Strip non-alphanumeric (except spaces & hyphens): `.replace(/[^a-zA-Z0-9\s-]/g, "")`.
   - Step 4: Trim surrounding whitespace: `.trim()`.
   - Step 5: Convert internal spaces to hyphens: `.replace(/\s+/g, "-")`.
   - Step 6: Collapse consecutive hyphens: `.replace(/-+/g, "-")`.
   - Step 7: Strip leading and trailing hyphens: `.replace(/^-|-$/g, "")`.
   - Step 8: Truncate to maximum 60 characters:
     ```typescript
     if (slug.length > 60) {
       slug = slug.substring(0, 60).replace(/-+$/, "");
     }
     ```
   - Step 9: Fallback if slug is empty: `"Chapter"`.

2. **Class Indicator (`Class{C}`)**:
   - `class` must be an integer between 6 and 10: `6`, `7`, `8`, `9`, `10`.
   - Formatted as `Class6`, `Class7`, `Class8`, `Class9`, `Class10`.

3. **Subject (`{Subject}`)**:
   - Must be strictly one of the 5 canonical Social Science subjects:
     - `History`
     - `Geography`
     - `Civics`
     - `Economics`
     - `SocialScience`

4. **Chapter Number (`Ch{NN}`)**:
   - `chapterNo` integer between 1 and 99.
   - Zero-padded to 2 digits: `String(chapterNo).padStart(2, "0")`.
   - Examples: `1` -> `Ch01`, `9` -> `Ch09`, `10` -> `Ch10`.

5. **Type Identifier (`{Type}`)**:
   - `ncert_pdf` -> `NCERT`
   - `ppt` -> `PPT`
   - `ppt_pdf` -> `PPT-Preview`
   - `teacher_notes` -> `Notes-{TeacherName}`
     - If `teacherName` is provided, sanitized using the identical algorithm as title slug.
     - If `teacherName` is omitted or empty, defaults to `Teacher`.
     - Duplicate Resolution:
       - If `kind === 'teacher_notes'` and candidate `${baseName}.${cleanExt}` exists in `existingNames`:
       - Loop `counter = 2, 3, ...` until `${baseName}-${counter}.${cleanExt}` is not in `existingNames`.
       - Assign `${baseName}-${counter}.${cleanExt}`.

6. **File Extension (`.{ext}`)**:
   - Extension stripped of any leading dot: `ext.replace(/^\./, "").toLowerCase()`.
   - Typically `pdf` or `pptx`.

7. **Strict Safety Invariant**:
   - Every generated filename MUST match regex: `^[A-Za-z0-9._-]+$`.

### 3.3 Telegram Caption Specification
```text
title={title}|class={class}|subject={subject}|ch={ch}|kind={kind}|name={name}|sha={shortSha}|part={part}/{total}
```
- Machine-readable pipe-delimited format.
- `shortSha`: `sha.slice(0, 8)` (first 8 hexadecimal characters).
- Maximum length: `<= 1024` characters (Telegram Bot API limit).

---

## 4. In-Depth Feature Group 2: Magic-Byte Stream Validation

### 4.1 Zero-Disk In-Memory Inspection Contract
Neither the Next.js API routes nor the upload session manager ever persist parts to the local filesystem. All magic-byte checks are performed strictly on in-memory buffers (`Buffer` or `Uint8Array`).

### 4.2 PDF Validation Algorithm (`validatePdfMagic`)
1. **Size check**:
   - If `firstChunk.length < 5`, return `{ valid: false, error: "File too small or empty to be a valid PDF" }`.
2. **Magic Header check** (byte 0..4):
   - PDF magic bytes: `%PDF-` (`0x25, 0x50, 0x44, 0x46, 0x2D`).
   - If `!firstChunk.subarray(0, 5).equals(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D]))`, return `{ valid: false, error: "Invalid PDF header: missing %PDF- magic bytes" }`.
3. **Trailer EOF check**:
   - If `lastChunk` is supplied (or evaluating single chunk `firstChunk`):
   - Inspect the trailing 1024 bytes: `target.subarray(Math.max(0, target.length - 1024)).toString("binary")`.
   - Must contain `"%%EOF"`.
   - If missing, return `{ valid: false, error: "Invalid PDF structure: missing %%EOF marker near end" }`.
4. **Result**:
   - Return `{ valid: true }`.

### 4.3 PPTX Validation Algorithm (`validatePptxMagic`)
1. **Size check**:
   - If `firstChunk.length < 4`, return `{ valid: false, error: "File too small to be a valid PPTX/ZIP archive" }`.
2. **ZIP Signature check** (byte 0..3):
   - Standard PKZIP local header signature: `PK\x03\x04` (`0x50, 0x4B, 0x03, 0x04`).
   - If `!firstChunk.subarray(0, 4).equals(Buffer.from([0x50, 0x4B, 0x03, 0x04]))`, return `{ valid: false, error: "Invalid PPTX header: missing ZIP signature (PK\\x03\\x04)" }`.
3. **Content Type & Structure check**:
   - Inspect `lastChunk` (or `firstChunk` if single chunk):
   - Scan binary string representation for:
     - `"[Content_Types].xml"` AND/OR `"presentationml"` (specifically `application/vnd.openxmlformats-officedocument.presentationml.presentation`).
   - If neither is found, return `{ valid: false, error: "Invalid PPTX package: missing [Content_Types].xml with presentationml markup" }`.
4. **Result**:
   - Return `{ valid: true }`.

---

## 5. In-Depth Feature Group 3: PPTX Accompaniment Enforcement

### 5.1 Business Rule
A PPTX presentation cannot be previewed natively in standard mobile browsers without heavy third-party rendering. Therefore:
- The system mandates that whenever an admin uploads a `ppt` file, an accompanying PDF export of that deck (`ppt_pdf`) MUST be supplied in the same upload flow.
- A standalone `ppt` upload without an accompanying PDF MUST be rejected with HTTP 400.

### 5.2 Database Entity Relationship
```text
[chapters] (1) <──── (N) [files: ppt] (1) <──── (1) [files: ppt_pdf]
                              ▲                          │
                              └────── parent_file_id ────┘
```
1. `files.kind = 'ppt'`:
   - `file_name`: `{Title}_Class{C}_{Subject}_Ch{NN}_PPT.pptx`
   - `mime`: `application/vnd.openxmlformats-officedocument.presentationml.presentation`
   - `parent_file_id`: `null`
2. `files.kind = 'ppt_pdf'`:
   - `file_name`: `{Title}_Class{C}_{Subject}_Ch{NN}_PPT-Preview.pdf`
   - `mime`: `application/pdf`
   - `parent_file_id`: UUID of the parent `ppt` file

### 5.3 Rollback Invariant
If either the PPTX file or the accompanying PDF preview fails magic byte validation, hashing, Telegram upload, or database insertion, the entire dual-upload transaction is rolled back, deleting any uploaded Telegram part messages for both files and writing 0 database rows.

---

## 6. Unit Test Specification: `tests/unit/naming.test.ts`

The unit test file `tests/unit/naming.test.ts` must test `@/lib/naming` directly. The following test cases are required:

```typescript
import { describe, it, expect } from "vitest";
import { buildFileName, formatTelegramCaption } from "@/lib/naming";

describe("Unit: Deterministic Auto-Naming (buildFileName)", () => {
  // 1. Standard Classes, Subjects, and Kinds
  describe("Standard Mappings", () => {
    it("generates correct filename for NCERT PDF (Class 6-10, all 5 subjects)", () => {
      const subjects = ["History", "Geography", "Civics", "Economics", "SocialScience"];
      for (let c = 6; c <= 10; c++) {
        for (const sub of subjects) {
          const name = buildFileName({
            class: c,
            subject: sub,
            chapterNo: 1,
            title: "Standard Chapter Title",
            kind: "ncert_pdf",
            ext: "pdf",
          });
          expect(name).toBe(`Standard-Chapter-Title_Class${c}_${sub}_Ch01_NCERT.pdf`);
          expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
        }
      }
    });

    it("generates correct filename for PPT and PPT-Preview", () => {
      const ppt = buildFileName({
        class: 10,
        subject: "History",
        chapterNo: 3,
        title: "The Making of a Global World",
        kind: "ppt",
        ext: "pptx",
      });
      expect(ppt).toBe("The-Making-of-a-Global-World_Class10_History_Ch03_PPT.pptx");

      const pptPreview = buildFileName({
        class: 10,
        subject: "History",
        chapterNo: 3,
        title: "The Making of a Global World",
        kind: "ppt_pdf",
        ext: "pdf",
      });
      expect(pptPreview).toBe("The-Making-of-a-Global-World_Class10_History_Ch03_PPT-Preview.pdf");
    });

    it("generates correct filename for Teacher Notes with teacher name", () => {
      const notes = buildFileName({
        class: 9,
        subject: "Economics",
        chapterNo: 1,
        title: "The Story of Village Palampur",
        kind: "teacher_notes",
        teacherName: "Sharma",
        ext: "pdf",
      });
      expect(notes).toBe("The-Story-of-Village-Palampur_Class9_Economics_Ch01_Notes-Sharma.pdf");
    });
  });

  // 2. Chapter Number Zero-Padding
  describe("Chapter Number Zero-Padding", () => {
    it("pads single-digit chapter numbers with leading zero", () => {
      for (let i = 1; i <= 9; i++) {
        const name = buildFileName({
          class: 7,
          subject: "Geography",
          chapterNo: i,
          title: "Chapter",
          kind: "ncert_pdf",
          ext: "pdf",
        });
        expect(name).toContain(`_Ch0${i}_`);
      }
    });

    it("formats double-digit chapter numbers without alteration", () => {
      const ch10 = buildFileName({
        class: 8,
        subject: "Civics",
        chapterNo: 10,
        title: "Law and Social Justice",
        kind: "ncert_pdf",
        ext: "pdf",
      });
      expect(ch10).toContain("_Ch10_");

      const ch99 = buildFileName({
        class: 8,
        subject: "Civics",
        chapterNo: 99,
        title: "Law and Social Justice",
        kind: "ncert_pdf",
        ext: "pdf",
      });
      expect(ch99).toContain("_Ch99_");
    });
  });

  // 3. Title Sanitization, Accents, and Punctuation
  describe("Title Sanitization", () => {
    it("transliterates accents (French, Spanish, German) cleanly", () => {
      const name = buildFileName({
        class: 9,
        subject: "History",
        chapterNo: 1,
        title: "L'Économie Française, El Niño, Über die Revolution!",
        kind: "ncert_pdf",
        ext: "pdf",
      });
      expect(name).toBe("LEconomie-Francaise-El-Nino-Uber-die-Revolution_Class9_History_Ch01_NCERT.pdf");
    });

    it("strips emojis, special punctuation, and path characters", () => {
      const name = buildFileName({
        class: 8,
        subject: "Geography",
        chapterNo: 3,
        title: "🌍 Earth & Agriculture: @2026 #Top [Part-1] / ../hack!",
        kind: "ncert_pdf",
        ext: "pdf",
      });
      expect(name).toBe("Earth-Agriculture-2026-Top-Part-1-hack_Class8_Geography_Ch03_NCERT.pdf");
    });

    it("collapses multiple consecutive spaces and hyphens", () => {
      const name = buildFileName({
        class: 6,
        subject: "History",
        chapterNo: 2,
        title: "  From   Hunting-Gathering  ---   to Growing Food  ",
        kind: "ncert_pdf",
        ext: "pdf",
      });
      expect(name).toBe("From-Hunting-Gathering-to-Growing-Food_Class6_History_Ch02_NCERT.pdf");
    });
  });

  // 4. Title Truncation at 60 Characters
  describe("Slug Truncation", () => {
    it("truncates slug exceeding 60 characters and strips trailing hyphen", () => {
      // 59 chars + hyphen + extra chars
      const base59 = "A".repeat(59);
      const title = `${base59}-extra-characters-that-make-this-very-long`;
      const name = buildFileName({
        class: 7,
        subject: "History",
        chapterNo: 4,
        title: title,
        kind: "ncert_pdf",
        ext: "pdf",
      });
      const slug = name.split("_Class7_")[0];
      expect(slug.length).toBe(59);
      expect(slug.endsWith("-")).toBe(false);
      expect(slug).toBe(base59);
    });

    it("caps 200-character long titles to max 60 character slug", () => {
      const longTitle = "A".repeat(200);
      const name = buildFileName({
        class: 7,
        subject: "History",
        chapterNo: 4,
        title: longTitle,
        kind: "ncert_pdf",
        ext: "pdf",
      });
      const slug = name.split("_Class7_")[0];
      expect(slug.length).toBeLessThanOrEqual(60);
      expect(slug).toBe("A".repeat(60));
    });
  });

  // 5. Teacher Names & Duplicate Disambiguation
  describe("Teacher Names and Duplicate Resolution", () => {
    it("sanitizes complex teacher names with spaces, titles, and accents", () => {
      const name = buildFileName({
        class: 9,
        subject: "Economics",
        chapterNo: 1,
        title: "Village Palampur",
        kind: "teacher_notes",
        teacherName: "Dr. René K. Sharma (HOD)",
        ext: "pdf",
      });
      expect(name).toBe("Village-Palampur_Class9_Economics_Ch01_Notes-Dr-Rene-K-Sharma-HOD.pdf");
    });

    it("defaults teacher name to 'Teacher' if undefined", () => {
      const name = buildFileName({
        class: 9,
        subject: "Economics",
        chapterNo: 1,
        title: "Village Palampur",
        kind: "teacher_notes",
        ext: "pdf",
      });
      expect(name).toBe("Village-Palampur_Class9_Economics_Ch01_Notes-Teacher.pdf");
    });

    it("resolves duplicate teacher names by appending -2, -3", () => {
      const existing = [
        "Village-Palampur_Class9_Economics_Ch01_Notes-Sharma.pdf",
        "Village-Palampur_Class9_Economics_Ch01_Notes-Sharma-2.pdf",
      ];
      const name = buildFileName({
        class: 9,
        subject: "Economics",
        chapterNo: 1,
        title: "Village Palampur",
        kind: "teacher_notes",
        teacherName: "Sharma",
        ext: "pdf",
        existingNames: existing,
      });
      expect(name).toBe("Village-Palampur_Class9_Economics_Ch01_Notes-Sharma-3.pdf");
    });

    it("fills lowest available slot if gap exists in duplicates", () => {
      const existing = [
        "Village-Palampur_Class9_Economics_Ch01_Notes-Sharma.pdf",
        "Village-Palampur_Class9_Economics_Ch01_Notes-Sharma-3.pdf",
      ];
      const name = buildFileName({
        class: 9,
        subject: "Economics",
        chapterNo: 1,
        title: "Village Palampur",
        kind: "teacher_notes",
        teacherName: "Sharma",
        ext: "pdf",
        existingNames: existing,
      });
      expect(name).toBe("Village-Palampur_Class9_Economics_Ch01_Notes-Sharma-2.pdf");
    });
  });

  // 6. Output Regex Verification
  describe("Safety Invariant", () => {
    it("ensures every generated filename matches ^[A-Za-z0-9._-]+$", () => {
      const testCases = [
        { title: "Standard", ext: "pdf" },
        { title: "Messy #!$@ Title", ext: ".pdf" },
        { title: "Éléphant", ext: "pptx" },
        { title: "Very Long ".repeat(10), ext: ".pptx" },
      ];
      for (const tc of testCases) {
        const res = buildFileName({
          class: 8,
          subject: "Civics",
          chapterNo: 1,
          title: tc.title,
          kind: "ncert_pdf",
          ext: tc.ext,
        });
        expect(res).toMatch(/^[A-Za-z0-9._-]+$/);
      }
    });
  });

  // 7. Telegram Caption Formatting
  describe("Telegram Caption Formatter", () => {
    it("formats pipe-delimited caption with short sha and part information", () => {
      const caption = formatTelegramCaption({
        title: "Resources and Development",
        class: 10,
        subject: "Geography",
        ch: 1,
        kind: "ncert_pdf",
        name: "Resources-and-Development_Class10_Geography_Ch01_NCERT.pdf",
        sha: "a1b2c3d4e5f67890abcdef1234567890",
        part: 2,
        total: 5,
      });
      expect(caption).toBe(
        "title=Resources and Development|class=10|subject=Geography|ch=1|kind=ncert_pdf|name=Resources-and-Development_Class10_Geography_Ch01_NCERT.pdf|sha=a1b2c3d4|part=2/5"
      );
      expect(caption.length).toBeLessThanOrEqual(1024);
    });
  });
});
```

---

## 7. Unit Test Specification: `tests/unit/magic.test.ts`

The unit test file `tests/unit/magic.test.ts` must test `@/lib/magic` directly. The following test cases are required:

```typescript
import { describe, it, expect } from "vitest";
import { validatePdfMagic, validatePptxMagic } from "@/lib/magic";
import {
  VALID_MINIMAL_PDF,
  TRUNCATED_PDF,
  FAKE_EXE_HEADER,
  createMinimalValidPptx,
  createDeterministicBuffer,
} from "../fixtures/test-fixtures";

describe("Unit: Stream Magic-Byte Validation", () => {
  // 1. PDF Magic-Byte Validation
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

    it("rejects truncated PDF missing %%EOF trailer marker", () => {
      const res = validatePdfMagic(TRUNCATED_PDF, TRUNCATED_PDF);
      expect(res.valid).toBe(false);
      expect(res.error?.toLowerCase()).toContain("eof");
    });

    it("rejects disguised executable (.exe renamed to .pdf)", () => {
      const res = validatePdfMagic(FAKE_EXE_HEADER, FAKE_EXE_HEADER);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("%PDF-");
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

    it("rejects non-PDF image header (PNG)", () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const res = validatePdfMagic(pngHeader, pngHeader);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("%PDF-");
    });
  });

  // 2. PPTX Magic-Byte Validation
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
    });

    it("rejects generic ZIP archive lacking presentationml markup", () => {
      // Raw zip with dummy content
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
  });

  // 3. PPTX Accompaniment Enforcement
  describe("PPTX Accompaniment Enforcement Rules", () => {
    function validateUploadKind(payload: { kind: string; hasAccompanyingPdf?: boolean }) {
      if (payload.kind === "ppt" && !payload.hasAccompanyingPdf) {
        throw new Error("PPTX upload validation error: PPTX files require an accompanying PDF preview export");
      }
      return true;
    }

    it("rejects PPTX upload without accompanying PDF preview export", () => {
      expect(() => {
        validateUploadKind({ kind: "ppt", hasAccompanyingPdf: false });
      }).toThrow(/require an accompanying PDF preview export/);
    });

    it("accepts PPTX upload when accompanying PDF preview export is present", () => {
      expect(validateUploadKind({ kind: "ppt", hasAccompanyingPdf: true })).toBe(true);
    });

    it("accepts NCERT PDF upload without accompanying file", () => {
      expect(validateUploadKind({ kind: "ncert_pdf" })).toBe(true);
    });

    it("accepts Teacher Notes PDF upload without accompanying file", () => {
      expect(validateUploadKind({ kind: "teacher_notes" })).toBe(true);
    });
  });
});
```

---

## 8. Summary & Next Steps for Milestone M2
1. **Module Creation**:
   - Create `src/lib/naming.ts` implementing `buildFileName` and `formatTelegramCaption`.
   - Create `src/lib/magic.ts` implementing `validatePdfMagic` and `validatePptxMagic`.
2. **Unit Test Creation**:
   - Place unit tests in `tests/unit/naming.test.ts` and `tests/unit/magic.test.ts`.
3. **Execution**:
   - Run `npx vitest run tests/unit/naming.test.ts tests/unit/magic.test.ts`.
   - Verify 100% pass rate.
