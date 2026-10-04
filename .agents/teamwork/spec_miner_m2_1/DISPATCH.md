## 2026-10-04T10:02:48Z
You are Spec Miner for Milestone M2 (Naming & Validation Specifications).
Your identity: teamwork_preview_spec_miner
Your working directory: c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m2_1
Your parent orchestrator: orchestrator_1 (conversation ID: fb1a83fa-301b-45dd-ba05-a3edc0267f37)

MANDATORY FIRST STEP:
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\ORIGINAL_REQUEST.md in full.
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\orchestrator_1\PROJECT.md.

Mission & Objective:
Mine and document all precise test cases, boundary inputs, edge cases, and unit test criteria for Milestone M2:
1. `buildFileName` test cases:
   - Standard cases (Class 6-10, all 5 subjects, various kinds).
   - Messy titles: titles with emojis, accents (é, ñ, ü), punctuation (`!@#$%^&*()_+`), non-ASCII, extra spaces, multiple consecutive hyphens.
   - Long titles: titles exceeding 60 characters (must truncate cleanly without trailing hyphen).
   - Chapter numbers: single digit zero-padding (`1` -> `Ch01`, `10` -> `Ch10`).
   - Teacher names: with spaces, special characters, duplicate names (`-2`, `-3`).
   - Regex verification: every generated name must match `^[A-Za-z0-9._-]+$`.
2. Magic-byte validator test cases:
   - Valid PDF buffer (starts `%PDF-`, ends `%%EOF`).
   - Valid PPTX buffer (ZIP signature + Content_Types).
   - Renamed `.exe` file (starts `MZ`).
   - Empty buffer (0 bytes).
   - Corrupted PDF (missing EOF, corrupted header).
   - Corrupted PPTX (not a zip, missing presentationml).
3. PPTX Accompaniment test cases:
   - PPTX without accompanying PDF -> rejected.
   - PPTX with accompanying PDF -> accepted.
4. Define test specs for `tests/unit/naming.test.ts` and `tests/unit/magic.test.ts`.
5. Write your analysis to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m2_1\analysis.md.
6. Write your 5-component handoff to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m2_1\handoff.md.
7. Notify parent (fb1a83fa-301b-45dd-ba05-a3edc0267f37) when done.
