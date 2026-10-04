# Milestone M2 Analysis: Deterministic Auto-Naming Engine & Telegram Caption Formatting

**Agent**: Explorer 1 (`teamwork_preview_explorer`)  
**Working Directory**: `.agents/teamwork/explorer_m2_1`  
**Timestamp**: 2026-10-04T10:04:00Z  
**Target Module**: `src/lib/naming.ts`

---

## 1. Executive Summary

Milestone M2 establishes the naming foundation for the SST Chapter Library. In a zero-cost architecture utilizing Telegram channels as chunked blob storage and Supabase PostgreSQL as catalog metadata, filenames and Telegram captions act as primary deterministic keys, cross-system linkages, and disaster-recovery indices.

This analysis provides the rigorous technical design, discrepancy reconciliation, edge-case hardening, and concrete TypeScript implementation for:
1. `buildFileName(params: BuildFileNameParams): string`
2. `formatTelegramCaption(params: TelegramCaptionParams): string`
3. `parseTelegramCaption(caption: string): ParsedTelegramCaption | null`

All algorithms have been verified against the existing Vitest test suites (`tests/tier1-feature/naming.test.ts`, `tests/tier2-boundary/boundary.test.ts`, `tests/tier3-combination/combination.test.ts`, and `tests/tier4-lifecycle/lifecycle.test.ts`).

---

## 2. Specification Reconciliation & Discrepancies Resolved

During thorough inspection of the repository specifications, two minor naming discrepancy nuances between the dispatch summary and the underlying test oracle / specification prompt were identified and resolved:

### A. PPT Preview Type Token: `PPT-Preview` vs `PPT_PDF`
- **Dispatch Note**: *"Type mapping for kind: `ncert_pdf` -> `NCERT`, `ppt` -> `PPT`, `ppt_pdf` -> `PPT_PDF`"*
- **Authoritative Sources**:
  - `SST-Library-FINAL-Antigravity-Prompt.md` § 3 (line 109):  
    `Type: NCERT | PPT | PPT-Preview | Notes-{TeacherName}`
  - `tests/tier1-feature/naming.test.ts` (test F6.4, line 182):  
    `expect(pptPdf).toBe("The-Making-of-a-Global-World_Class10_History_Ch03_PPT-Preview.pdf")`
  - `tests/tier3-combination/combination.test.ts` (line 86):  
    `file_name: "The-Making-of-a-Global-World_Class10_History_Ch03_PPT-Preview.pdf"`
- **Resolution**:  
  When `kind === "ppt_pdf"`, the type token MUST map to `PPT-Preview`. Mapping to `PPT_PDF` would break both Tier 1 and Tier 3 test suites. To be robust, our implementation treats `"ppt_pdf"`, `"PPT-Preview"`, and `"PPT_PDF"` identically, returning `"PPT-Preview"`.

### B. Teacher Notes Delimiter: `Notes-{TeacherName}` vs `Notes_{TeacherName}`
- **Dispatch Note**: *"teacher_notes -> Notes_{TeacherName}"*
- **Authoritative Sources**:
  - `SST-Library-FINAL-Antigravity-Prompt.md` § 3 (line 110):  
    `Example-Chapter-Title_Class9_Economics_Ch01_Notes-Sharma.pdf`
  - `tests/tier1-feature/naming.test.ts` (test F6.2, line 129):  
    `expect(result).toBe("Example-Chapter-Title_Class9_Economics_Ch01_Notes-Sharma.pdf")`
- **Resolution**:  
  The type token uses a hyphen between `Notes` and the sanitized teacher slug: `Notes-${tSlug}` (e.g. `Notes-Sharma`). This matches the test oracle and prevents breaking token parsing on underscore (`_`).

---

## 3. Deep-Dive Design: `buildFileName`

### 3.1 Target Pattern Definition
```
{Chapter-Title}_Class{C}_{Subject}_Ch{NN}_{Type}.{ext}
```

Components:
1. `{Chapter-Title}`: Sanitized title slug, max 60 characters.
2. `Class{C}`: Student grade/class number (e.g. `Class6`, `Class9`, `Class10`).
3. `{Subject}`: Clean SST subject (e.g. `History`, `Geography`, `Civics`, `Economics`, `SocialScience`).
4. `Ch{NN}`: Chapter number zero-padded to at least 2 digits (`Ch01` - `Ch99`).
5. `{Type}`: One of `NCERT`, `PPT`, `PPT-Preview`, or `Notes-{TeacherName}`.
6. `.{ext}`: Clean lowercase extension without leading dots (e.g. `pdf`, `pptx`).

### 3.2 Title Sanitization Pipeline (`sanitizeTitleSlug`)
Titles in educational settings contain diverse typographical marks: French/Sanskrit diacritics, ampersands, colons, slashes, double dashes, and emojis. The sanitization pipeline executes:

```
Raw Title
  │
  ▼
1. Unicode Normalization Form KD (NFD): Decomposes accented characters into base letters + combining marks
  │  (e.g., "É" → "E" + "\u0301", "ç" → "c" + "\u0327", "ô" → "o" + "\u0302")
  ▼
2. Strip Combining Marks: replace(/[\u0300-\u036f]/g, "")
  │  (Removes accents while preserving base ASCII Latin letters)
  ▼
3. Strip Non-Alphanumerics (except space & hyphen): replace(/[^a-zA-Z0-9\s-]/g, "")
  │  (Drops emojis, slashes, apostrophes, quotes, colons, punctuation)
  ▼
4. Trim Whitespace: trim()
  ▼
5. Convert Spaces to Hyphens: replace(/\s+/g, "-")
  ▼
6. Collapse Repeated Hyphens: replace(/-+/g, "-")
  ▼
7. Trim Edge Hyphens: replace(/^-+|-+$/g, "")
  ▼
8. Length Ceiling (60 chars): if length > 60, substring(0, 60).replace(/-+$/, "")
  │  (Ensures trailing hyphens introduced by cutting words are cleanly stripped)
  ▼
9. Non-empty Guarantee: fallback to "Chapter" if input title was empty or all-symbols
```

#### Example Validations:
| Input Title | Output Slug | Rationale |
|---|---|---|
| `"Example Chapter Title"` | `Example-Chapter-Title` | Normal whitespace conversion |
| `"  Éléphant & Révolution: Chapter / 1 -- Part * 2!!  "` | `Elephant-Revolution-Chapter-1-Part-2` | Diacritics normalized, symbols stripped, hyphens collapsed |
| `"L'Économie Française et les Forêts: 2ème Étude!"` | `LEconomie-Francaise-et-les-Forets-2eme-Etude` | French cedilla & accents decomposed, apostrophe dropped |
| `"🌍 Earth / Agriculture & ../../root-exploit!"` | `Earth-Agriculture-root-exploit` | Emojis & path traversal markers eradicated |
| `"A".repeat(100)` | `"A".repeat(60)` | Capped at 60 characters |
| `""` or `"💡✨"` | `Chapter` | Safe fallback ensures no leading underscore in file name |

### 3.3 Teacher Name Sanitization (`sanitizeTeacherSlug`)
Follows identical rules to `sanitizeTitleSlug`, falling back to `"Teacher"` when `teacherName` is undefined or contains only invalid characters:
- `"Sharma"` → `"Sharma"` → `Notes-Sharma`
- `"Dr. R. K. Singh"` → `"Dr-R-K-Singh"` → `Notes-Dr-R-K-Singh`
- `undefined` → `"Teacher"` → `Notes-Teacher`

### 3.4 Duplicate Resolution Logic
When uploading multiple supplementary notes for the same teacher or when files already exist in `existingNames`:
- Base filename: `${slug}_Class${C}_${Subject}_Ch${NN}_${Type}.${ext}`
- If `existingNames` contains candidate:
  - Iteratively probe `-2`, `-3`, `-4`, etc. immediately before the extension.
  - Formula: `${baseName}-${counter}.${cleanExt}`
- Example:
  - 1st upload: `Village-Palampur_Class9_Economics_Ch01_Notes-Sharma.pdf`
  - 2nd upload: `Village-Palampur_Class9_Economics_Ch01_Notes-Sharma-2.pdf`
  - 3rd upload: `Village-Palampur_Class9_Economics_Ch01_Notes-Sharma-3.pdf`
  - 4th upload: `Village-Palampur_Class9_Economics_Ch01_Notes-Sharma-4.pdf`

### 3.5 Strict Regular Expression Assertion
Before returning, the generated filename is verified against:
```regex
^[A-Za-z0-9._-]+$
```
If any unhandled character somehow bypassed the sanitizers, an explicit error is thrown. This prevents directory traversal (`/`, `\`), shell injection, or non-ASCII characters from ever reaching the Telegram API or Supabase database.

---

## 4. Deep-Dive Design: `formatTelegramCaption`

### 4.1 Specification & Delimiter Contract
Telegram caption format:
```
title={title}|class={class}|subject={subject}|ch={ch}|kind={kind}|name={name}|sha={shortSha}|part={part}/{total}
```

Key rules:
1. `sha`: Hexadecimal SHA-256 string, sliced to the first 8 characters (`sha.slice(0, 8)`).
2. `part`: Expressed as `{part}/{total}` (e.g. `1/1`, `3/5`).
3. Machine-readable: Pipe-delimited key=value pairs enable instant metadata recovery directly from Telegram messages even without database access.
4. Delimiter integrity: Pipe characters (`|`) and newlines (`\r\n`) within `title` are converted to spaces to avoid corrupting the pipe-delimited parser.

### 4.2 Length Limit Enforcement (1024 Chars)
Telegram Bot API imposes a strict ceiling of **1024 UTF-8 characters** on document captions.
- Fixed metadata overhead (`class`, `subject`, `ch`, `kind`, `name`, `sha`, `part`, keys, delimiters) consumes ~120–180 characters.
- If a chapter title is unusually verbose causing total length > 1024 characters:
  - Dynamic truncation calculates: `excess = caption.length - 1024`
  - Title is truncated to: `allowedTitleLen = title.length - excess`
  - Caption is rebuilt, guaranteeing length <= 1024 characters.

### 4.3 Companion Function: `parseTelegramCaption`
To support disaster recovery, integrity checking, and upload verification, a typed parser `parseTelegramCaption(caption: string): ParsedTelegramCaption | null` is provided:
- Parses all key-value pairs split by `|`.
- Validates that all 8 mandatory fields are present.
- Extracts `part` and `total` integers from `part=n/total`.
- Parses `class` and `ch` into numbers.
- Returns structured `ParsedTelegramCaption` object or `null` if malformed.

---

## 5. Security & Filesystem Compatibility Assessment

1. **Path Traversal Protection**:  
   Slashes (`/`), backslashes (`\`), and dots (`..`) are eradicated during title slug generation. Filenames cannot escape directories when saved locally or served via `Content-Disposition`.
2. **Safe Header Encoding**:  
   Because all filenames match `^[A-Za-z0-9._-]+$`, they do not require percent-encoding or RFC 5987 `filename*=UTF-8''` headers in HTTP download responses; standard `filename="..."` headers work across all browsers and operating systems.
3. **Pure Function Invariants**:  
   Both functions are completely side-effect free, synchronous, and allocate minimal heap objects, making them safe for concurrent server execution in edge middleware, route handlers, and client-side browsers.

---

## 6. Concrete Proposed Source Code

The full implementation is saved at:  
`.agents/teamwork/explorer_m2_1/proposed_naming.ts`

For implementation into `src/lib/naming.ts`, see the ready-to-commit code in `proposed_naming.ts`.
