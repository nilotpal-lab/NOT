# Handoff Report: Milestone M2 Adversarial Challenge (`src/lib/naming.ts`)

**Challenger**: Challenger 1 (teamwork_preview_challenger)  
**Milestone**: M2 (Deterministic Auto-Naming & Magic-Byte Validation)  
**Date**: 2026-10-04T10:43:00Z  
**Verdict**: **APPROVE**  

---

## 1. Observation

### Implementation Under Test
- Path: `src/lib/naming.ts` (Lines 1 to 268)
- Target functions inspected and tested:
  - `buildFileName(params: BuildFileNameParams): string` (Lines 111-177)
  - `sanitizeTitleSlug(rawTitle: string, maxLen?: number): string` (Lines 58-73)
  - `sanitizeTeacherSlug(rawName?: string): string` (Lines 79-91)
  - `formatTelegramCaption(params: TelegramCaptionParams): string` (Lines 187-214)
  - `parseTelegramCaption(caption: string): ParsedTelegramCaption | null` (Lines 222-267)

### Test Harness Execution
- Harness location: `.agents/teamwork/challenger_m2_1/adversarial_harness.ts`
- Command executed:
  ```powershell
  npx tsx .agents/teamwork/challenger_m2_1/adversarial_harness.ts
  ```
- Command result:
  ```
  Total Tests Run: 123
  Passed: 123
  Failed: 0
  >>> EMPIRICAL VERDICT: ALL ADVERSARIAL TESTS PASSED (100%) <<<
  Exit code: 0
  ```

### Key Specific Empirical Observations
1. **Extreme Unicode Titles (Suite 1 - 20 tests)**:
   - Pure Egyptian hieroglyphs (`"𓀀𓁐𓃀𓄿𓆓𓇋𓈖𓉐𓊝𓋹𓌢𓍯𓎛𓏤"`) cleanly returned fallback `"Chapter"`.
   - Mixed hieroglyphs (`"𓀀The 𓁐Pyramids 𓃀of 𓄿Giza𓆓"`) produced `"The-Pyramids-of-Giza"`.
   - RTL markers (`\u200E\u200F\u202A\u202B\u202C\u202D\u202E`) and full Arabic/Hebrew titles fallback safely to `"Chapter"`.
   - Bidi Trojan filename spoof (`"Harmless\u202Eexe.pdf"`) was neutralized to `"Harmlessexepdf"`.
   - Zero-width format characters (`\u200B` ZWSP, `\u200C` ZWNJ, `\u200D` ZWJ, `\u2060` WJ) were cleanly eliminated (`"ZeroWidthJoinerTestTitle"`).
   - Math equations (`"E=mc^2 & √(x_1^2 + y_1^2) = r ± 5%"`) stripped all symbols (`=`, `&`, `√`, `±`) leaving valid characters `[A-Za-z0-9-]`.
   - Compound emojis (`👨‍👩‍👧‍👦`, `🧑🏽‍💻`, `🏳️‍🌈`, `🇺🇸`) and keycaps (`1️⃣ 2️⃣`) stripped completely with no residual surrogate bytes.
   - Zalgo combining diacritics (`"T̶h̶i̶s̶ ̶i̶s̶ ̶Z̶a̶l̶g̶o̶"`) decomposed and stripped cleanly to `"This-is-Zalgo"`.

2. **Edge Boundary Lengths (Suite 2 - 25 tests)**:
   - Title length 59: returned exactly 59 characters, `startsWith("-") === false`, `endsWith("-") === false`.
   - Title length 60: returned exactly 60 characters, no dangling hyphens.
   - Title length 61: pure alphanumeric truncated to exactly 60 characters; title with hyphen or space at the 60th character boundary (`"A".repeat(59) + "-B"` and `"A".repeat(59) + " B"`) stripped trailing hyphen and produced 59 characters without trailing hyphen (`slug.endsWith("-") === false`).
   - Title length 1000: truncated to 60 characters without trailing hyphen.
   - Systematic sweep of lengths 1..150 across simple strings, boundary hyphens, and trailing hyphens verified 100% adherence to `slug.length <= 60` and zero dangling hyphens.

3. **Collision Storm (Suite 3 - 10 tests)**:
   - Exact array of 50 existing duplicate names (`[baseName.pdf, baseName-2.pdf, ..., baseName-50.pdf]`) resulted in `baseName-51.pdf`.
   - Missing slot gap test (slot `-23` missing among 50 duplicates) correctly filled the lowest available slot `-23`.
   - Shuffled 50 existing duplicate names resolved to `-51`.
   - Teacher notes 50 duplicate names resolved to `-51`.
   - Massive collision array of 200 existing duplicate names resolved cleanly to `-201`.

4. **Regex Invariant & Security (Suite 4 - 52 tests)**:
   - 10 attack payloads tested: path traversal (`../../../../etc/passwd`), Windows path traversal (`..\..\Windows\System32\cmd.exe`), XSS tags (`<script>`), SQL injection (`Robert'); DROP TABLE`), shell expansions (`$(whoami)`), null bytes (`\x00`), newlines (`\r\n`), and pipe delimiters (`|`). All produced filenames matching `^[A-Za-z0-9._-]+$` with slashes, backslashes, null bytes, and semicolons 100% eliminated.
   - Property-based fuzzing of 5,000 randomized combinations across extreme unicode, classes, chapters, kinds, teacher names, and extensions achieved 100% compliance with `^[A-Za-z0-9._-]+$`.

5. **Telegram Captions (Suite 5 - 16 tests)**:
   - Enforces length `<= 1024` under 2,000-character titles.
   - Sanitizes pipes and newlines to preserve delimiter integrity.
   - Bidirectional parsing via `parseTelegramCaption` confirms lossless roundtrip of all fields.

6. **Regression & Build Suite**:
   - `npx vitest run`: 12 test files passed, 164 unit/boundary/feature tests passed.
   - `npm run build`: Exit code 0, Turbopack compiled successfully.
   - `npm run lint`: Exit code 0, zero ESLint warnings or errors.
   - `npm run preflight`: 5/5 checks passed (PRE-1 to PRE-5 green).

---

## 2. Logic Chain

1. **Observation 1 & 4** show that `sanitizeTitleSlug` decomposes diacritics via `normalize("NFD")`, strips all non-alphanumeric/non-space/non-hyphen characters via regex `/[^a-zA-Z0-9\s-]/g`, converts whitespace to hyphens, collapses hyphens, and falls back to `"Chapter"` if empty.
2. In all extreme Unicode cases (hieroglyphs, RTL, zero-width, emojis, math symbols), any character outside ASCII alphanumeric, whitespace, and hyphens is discarded. Therefore, invalid, multi-byte, invisible, or directional characters cannot survive into the generated slug.
3. **Observation 2** shows that line 68-70 of `src/lib/naming.ts` checks `if (slug.length > maxLen) { slug = slug.substring(0, maxLen).replace(/-+$/, ""); }`. Combined with line 66's initial strip `replace(/^-+|-+$/g, "")`, any slug truncated at a boundary character that is a hyphen immediately has the trailing hyphen stripped. This guarantees that `slug.length <= 60` and `!slug.endsWith("-")` hold for all possible input lengths (tested up to 1000 characters and swept from 1 to 150).
4. **Observation 3** shows that duplicate resolution initializes `counter = 2` and searches sequentially for an unused `${baseName}-${counter}.${cleanExt}`. For an existing array containing the unnumbered base name and suffixes `-2` through `-50` (50 items), the loop iterates through existing indices and terminates at 51, yielding `${baseName}-51.${cleanExt}`.
5. **Observation 4** shows that all components of `buildFileName` (sanitized title, `Class${C}`, sanitized subject, zero-padded `Ch${NN}`, sanitized kind/teacher slug, sanitized extension, and numerical counter) consist exclusively of ASCII characters in the set `[A-Za-z0-9._-]`. Line 170 furthermore executes a strict assertion check before return.
6. Therefore, `buildFileName` completely and reliably satisfies all criteria in `ORIGINAL_REQUEST.md` § R2 and `PROJECT.md` M2 without regression or vulnerability.

---

## 3. Caveats

- **No caveats**: Every requirement and adversarial scenario requested by the orchestrator was tested empirically, and all 123 adversarial assertions passed. No production implementation changes were needed or made.

---

## 4. Conclusion

- **Verdict**: **APPROVE**
- `src/lib/naming.ts` is robust, secure, and adheres strictly to the deterministic auto-naming specifications.
- Safe to proceed to dependent milestones (M3 / Upload Engine).

---

## 5. Verification Method

To independently reproduce the empirical findings:

1. Run the dedicated 123-test adversarial harness:
   ```powershell
   npx tsx .agents/teamwork/challenger_m2_1/adversarial_harness.ts
   ```
   *Expected outcome*: 123/123 tests pass, exit code 0.

2. Run the repository vitest test suite:
   ```powershell
   npx vitest run tests/unit/naming.test.ts tests/tier1-feature/naming.test.ts tests/tier2-boundary/boundary.test.ts
   ```
   *Expected outcome*: All test suites pass.

3. Run whole-system health checks:
   ```powershell
   npm run lint
   npm run build
   npm run preflight
   ```
