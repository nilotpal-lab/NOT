## 2026-10-04T10:25:39Z
You are Worker 1 for Milestone M2 (Deterministic Auto-Naming & Magic-Byte Validation).
Your identity: teamwork_preview_worker
Your working directory: c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\worker_m2_1
Your parent orchestrator: orchestrator_1 (conversation ID: fb1a83fa-301b-45dd-ba05-a3edc0267f37)

MANDATORY FIRST STEP:
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\ORIGINAL_REQUEST.md in full.
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\orchestrator_1\PROJECT.md.
Read Explorer Analysis & Proposed Code:
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m2_1\proposed_naming.ts
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m2_1\analysis.md
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m2_2\proposed_magic.ts
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m2_2\analysis.md
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m2_1\analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

File Ownership:
You exclusively own and may modify or create the following files:
- src/lib/naming.ts
- src/lib/magic.ts
- tests/unit/naming.test.ts
- tests/unit/magic.test.ts

Implementation Requirements:
1. `src/lib/naming.ts`:
   - `buildFileName({ class, subject, chapterNo, title, kind, teacherName, ext, existingNames })`:
     - Target pattern: `{Chapter-Title}_Class{C}_{Subject}_Ch{NN}_{Type}.{ext}`
     - Sanitization: Normalize diacritics/accents, strip emojis/symbols, convert spaces to hyphens, collapse consecutive hyphens, trim hyphens, max 60 chars.
     - Chapter number: zero-padded to 2 digits (`Ch01`..`Ch99`).
     - Type mapping: `ncert_pdf` -> `NCERT`, `ppt` -> `PPT`, `ppt_pdf` -> `PPT_PDF` (or `PPT-Preview` alias compatible), `teacher_notes` -> `Notes_${TeacherName}`.
     - Duplicate suffix: if name exists in `existingNames`, append `-2`, `-3`, etc.
     - Invariant assertion: final output MUST match `^[A-Za-z0-9._-]+$`.
   - `formatTelegramCaption(params: { title, class, subject, ch, kind, name, sha, part, total })`:
     - Pattern: `title=...|class=...|subject=...|ch=...|kind=...|name=...|sha=...|part=n/total`.
     - Length must not exceed 1024 characters.
2. `src/lib/magic.ts`:
   - Zero-disk streaming buffer validation:
     - PDF: Check `%PDF-` at start of first chunk (offset 0..1024), and `%%EOF` near end of last chunk.
     - PPTX: Check ZIP signature `PK\x03\x04` at start of first chunk, read End of Central Directory (`PK\x05\x06`) and Central Directory in last chunk to confirm `[Content_Types].xml` with presentationml.
     - Zip-bomb safeguard: verify uncompressed size per central directory entry does not exceed 500 MB.
     - Gracefully reject renamed `.exe` files (`MZ` magic), empty buffers, and corrupted headers.
   - `validatePptxAccompaniment(files: Array<{ kind: string; fileName: string; parentFileId?: string }>)`:
     - Enforces that any PPTX (`kind === 'ppt'`) upload must be accompanied by an export PDF preview (`kind === 'ppt_pdf'`).
3. `tests/unit/naming.test.ts` & `tests/unit/magic.test.ts`:
   - Comprehensive unit test suites covering standard cases, messy titles, boundary lengths, teacher duplicates, invalid files, renamed exes, corrupt buffers, and accompaniment rules.

Verification:
- Run `npm test`
- Run `npm run lint`
Document commands and outputs in your handoff.

Output:
Write changes to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\worker_m2_1\changes.md.
Write handoff to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\worker_m2_1\handoff.md.
Notify parent (fb1a83fa-301b-45dd-ba05-a3edc0267f37) when finished.
