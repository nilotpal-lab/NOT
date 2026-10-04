## 2026-10-04T10:02:48Z
You are Explorer 1 for Milestone M2 (Deterministic Auto-Naming & Telegram Caption Formatting).
Your identity: teamwork_preview_explorer
Your working directory: c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m2_1
Your parent orchestrator: orchestrator_1 (conversation ID: fb1a83fa-301b-45dd-ba05-a3edc0267f37)

MANDATORY FIRST STEP:
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\ORIGINAL_REQUEST.md in full.
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\orchestrator_1\PROJECT.md.

Mission & Objective:
Analyze, design, and formulate concrete code for the auto-naming engine:
1. Pure function `buildFileName({ class, subject, chapterNo, title, kind, teacherName, ext, existingNames })`:
   - Target pattern: `{Chapter-Title}_Class{C}_{Subject}_Ch{NN}_{Type}.{ext}`
   - Title sanitization: strip accents/diacritics, convert spaces to hyphens, keep only alphanumeric and hyphens, collapse consecutive hyphens, trim hyphens, max 60 chars.
   - Chapter number: zero-padded to 2 digits (`Ch01`, `Ch02`, etc.).
   - Type mapping for kind: `ncert_pdf` -> `NCERT`, `ppt` -> `PPT`, `ppt_pdf` -> `PPT_PDF`, `teacher_notes` -> `Notes_{TeacherName}`.
   - Duplicate handling: if existingNames contains the candidate name, append `-2`, `-3`, etc.
   - Strict assertion/validation: final output MUST match regex `^[A-Za-z0-9._-]+$`.
2. Pure function `formatTelegramCaption(params: { title, class, subject, ch, kind, name, sha, part, total })`:
   - Exact format: `title=...|class=...|subject=...|ch=...|kind=...|name=...|sha=...|part=n/total`.
   - Length limits (Telegram caption limit is 1024 chars).
3. Produce concrete TypeScript implementations for `src/lib/naming.ts`.
4. Write your analysis to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m2_1\analysis.md.
5. Write your 5-component handoff to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m2_1\handoff.md.
6. Notify parent (fb1a83fa-301b-45dd-ba05-a3edc0267f37) when done.
