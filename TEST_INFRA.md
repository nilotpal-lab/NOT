# SST Chapter Library — Test Infrastructure & Feature Coverage Matrix (`TEST_INFRA.md`)

## 1. Test Philosophy

### 1.1 Opaque-Box & Requirement-Driven Architecture
The test suite for SST Chapter Library operates under an **opaque-box, requirement-driven** philosophy:
- **Specification Authority**: Expected inputs, behaviors, and outputs are strictly derived from `ORIGINAL_REQUEST.md` (R1-R4, AC) and `PROJECT.md` (Interface Contracts and Architecture).
- **Behavior over Implementation**: Tests evaluate observable outputs (HTTP status codes, response payloads, cryptographic signatures, sanitized file strings, Telegram Bot API payload structures, database row states) rather than private function internals.
- **Contract Fidelity**: Public and internal contracts defined in `PROJECT.md` are treated as binding interface agreements. If an implementation violates the contract or schema, the test fails.
- **Adversarial & Boundary Rigor**: The test suite actively injects malformed inputs, edge byte lengths (e.g. exactly 19 MiB vs 19 MiB + 1 byte), corrupted magic headers, zip-bombs, unicode accents, rate-limit thresholds, and mid-stream network dropouts to verify defensive integrity.

### 1.2 Progressive Testability
During milestone-driven delivery (M1: Auth, M2: Naming & Validation, M3: Upload Engine, M4: Admin Library Dashboard):
- Test suites are organized to execute against implemented modules while dynamically discovering and verifying modules as they are delivered.
- Tests provide detailed, informative assertions and actionable failure reports that guide implementing agents directly to contract gaps.
- When all milestones are complete, the entire 4-tier suite runs in Vitest with 100% pass rate.

### 1.3 State Isolation & Determinism
- **Self-Contained Execution**: Every test case initializes its own isolated state, avoids global state bleed-through, and resets any mocks or in-memory caches between runs.
- **Deterministic Assertions**: Fixed seeds, standardized test vectors, and exact cryptographic digests (e.g. SHA-256 of test buffers) eliminate test flakiness.
- **Sanitized Cleanup**: Any mock Telegram messages or database rows generated during test execution are tracked and purged during teardown.

---

## 2. Feature Inventory & Coverage Mapping (23 Features)

All 23 features identified in `PROJECT.md` are mapped across the 4 test tiers and verification tooling:

| # | Feature | Milestone | Primary Tier | Test File / Harness | Test Strategy |
|---|---------|-----------|--------------|---------------------|---------------|
| 1 | Scrypt Constant-Time Login | M1 (Auth) | Tier 1, Tier 2 | `tests/tier1-feature/auth.test.ts` | Unit/Contract test with timing & scrypt hash checks |
| 2 | JWT Session Cookie | M1 (Auth) | Tier 1, Tier 3 | `tests/tier1-feature/auth.test.ts` | JWT HS256 validation, 12h expiration, cookie flags check |
| 3 | IP Rate Limiting | M1 (Auth) | Tier 1, Tier 2 | `tests/tier1-feature/auth.test.ts` | Sliding/fixed window simulation (5 allowed, 6th HTTP 429) |
| 4 | Origin & Middleware Protection | M1 (Auth) | Tier 1, Tier 3 | `tests/tier1-feature/auth.test.ts` | Request origin inspection on mutating routes, 401 on unauthenticated /admin |
| 5 | Admin Login UI | M1 (Auth) | Tier 1, Tier 4 | `tests/tier1-feature/auth.test.ts`, Playwright | Login form submit, credential feedback, session redirect |
| 6 | Deterministic `buildFileName` | M2 (Naming) | Tier 1, Tier 2 | `tests/tier1-feature/naming.test.ts` | Pure function test: `{Title}_Class{C}_{Subject}_Ch{NN}_{Type}.{ext}` |
| 7 | Telegram Caption Formatter | M2 (Naming) | Tier 1, Tier 2 | `tests/tier1-feature/naming.test.ts` | Key-value caption formatting (`title=...\|part=n/total`), <= 1024 chars |
| 8 | PDF Magic-Byte Stream Validation | M2 (Magic) | Tier 1, Tier 2 | `tests/tier1-feature/magic.test.ts` | `%PDF-` at start of chunk 1, `%%EOF` near end of final chunk |
| 9 | PPTX Magic-Byte Stream Validation | M2 (Magic) | Tier 1, Tier 2 | `tests/tier1-feature/magic.test.ts` | ZIP `PK\x03\x04` header, central directory, `[Content_Types].xml` verification |
| 10 | PPTX Accompaniment Enforcement | M2 (Naming/Upload) | Tier 1, Tier 3 | `tests/tier3-combination/combination.test.ts` | Rejection of PPTX without linked PDF preview export |
| 11 | Telegram Client Expansion | M3 (Upload) | Tier 1, CLI | `tests/tier1-feature/chunking.test.ts`, `smoke-telegram.ts` | `sendDocument`, `getFile`, `downloadFile`, `deleteMessage` contracts |
| 12 | Slicing & Part Validation | M3 (Upload) | Tier 1, Tier 2 | `tests/tier1-feature/chunking.test.ts`, `tests/tier2-boundary/boundary.test.ts` | Strict <= 19 MiB (`19922944` bytes) slice enforcement |
| 13 | Upload Session Management | M3 (Upload) | Tier 1, Tier 2 | `tests/tier1-feature/chunking.test.ts` | In-memory session tracking, 30m TTL, streaming incremental SHA-256 |
| 14 | Sequential Telegram Forwarding | M3 (Upload) | Tier 1, Tier 3 | `tests/tier1-feature/chunking.test.ts`, `tests/tier3-combination/combination.test.ts` | Out-of-order rejection, single-part memory hold, global upload lock |
| 15 | Telegram & DB Rollback | M3 (Upload) | Tier 1, Tier 3 | `tests/tier1-feature/chunking.test.ts`, `tests/tier3-combination/combination.test.ts` | Part failure (e.g. part 3 of 5) triggers Telegram deletion of parts 1 & 2, 0 DB rows |
| 16 | Chapter Auto-Creation & Dedup | M3 (Upload) | Tier 1, Tier 3 | `tests/tier1-feature/catalog-admin.test.ts`, `tests/tier3-combination/combination.test.ts` | Idempotent chapter creation; reject duplicate `(chapter_id, sha256)` |
| 17 | Admin Library UI | M4 (Catalog) | Tier 1, Tier 4 | `tests/tier1-feature/catalog-admin.test.ts`, `tests/tier4-lifecycle/lifecycle.test.ts` | Filtering by class, subject, kind, published state |
| 18 | Chapter Rename Cascade | M4 (Catalog) | Tier 1, Tier 4 | `tests/tier1-feature/catalog-admin.test.ts`, `tests/tier4-lifecycle/lifecycle.test.ts` | Rename chapter title -> recalculate all dependent `file_name`s |
| 19 | File Visibility Toggles | M4 (Catalog) | Tier 1, Tier 4 | `tests/tier1-feature/catalog-admin.test.ts`, `tests/tier4-lifecycle/lifecycle.test.ts` | Single file `is_published` toggle + bulk toggle for teacher notes |
| 20 | File Deletion & Telegram Cleanup | M4 (Catalog) | Tier 1, Tier 4 | `tests/tier1-feature/catalog-admin.test.ts`, `tests/tier4-lifecycle/lifecycle.test.ts` | Cascade delete file row, part rows, and call `deleteMessage` on all Telegram parts |
| 21 | E2E Testing Suite (Tiers 1-4) | M-E2E | Tiers 1-4 | `tests/**/*.test.ts` | Comprehensive test suites encompassing all tiers |
| 22 | Telegram Smoke Test Script | M-E2E | Live CLI | `scripts/smoke-telegram.ts` | Real Telegram roundtrip: tiny PDF + `--big` 45 MB 3-part roundtrip |
| 23 | Phase 1 Final Verification | M-FINAL | All | Full test run, preflight 5/5, secret scan, `docs/verification/phase-1.md` | Verification harness |

---

## 3. Test Architecture

### 3.1 Test Frameworks & Tools
- **Test Runner**: Vitest (`v3.0+`) running in Node.js environment (`vitest.config.ts`), with `@/` path alias pointing to `src/`.
- **Assertion Library**: Vitest built-in Chai-compatible assertions (`expect()`).
- **HTTP / Service Mocks**: Self-contained Mock Telegram Server and Mock Supabase Database Client in `tests/helpers/` for deterministic offline execution.
- **Browser Automation**: Playwright (`@playwright/test`) configured in `playwright.config.ts` for end-to-end browser workflows against `/admin` and `/admin/login`.
- **Live Smoke Runner**: TypeScript execution via `tsx scripts/smoke-telegram.ts`.

### 3.2 Directory Structure
```
tests/
├── fixtures/
│   └── test-fixtures.ts           # Pre-computed valid PDF, corrupted PDF, ZIP/PPTX, mock parts
├── helpers/
│   ├── dynamic-loader.ts          # Progressive module resolver & stub adapters
│   ├── mock-telegram.ts           # In-memory Telegram Bot API mock with spy recording
│   └── mock-db.ts                 # In-memory Supabase schema & table mock (chapters, files, file_parts)
├── unit/
│   └── env.test.ts                # Phase 0 environment schema & crypto unit tests
├── tier1-feature/
│   ├── auth.test.ts               # Tier 1: Auth & Session Security (Features 1-5, >=5 cases)
│   ├── naming.test.ts             # Tier 1: Auto-Naming & Telegram Captions (Features 6-7, >=5 cases)
│   ├── magic.test.ts              # Tier 1: Magic-Byte Stream Validation (Features 8-9, >=5 cases)
│   ├── chunking.test.ts           # Tier 1: Chunking, Slicing & Rollback (Features 11-15, >=5 cases)
│   └── catalog-admin.test.ts      # Tier 1: Catalog, Renaming & Cleanup (Features 16-20, >=5 cases)
├── tier2-boundary/
│   └── boundary.test.ts           # Tier 2: Boundary & Corner Cases (0B, 1B, 19MiB, 19MiB+1, 45MB, 100MB, accents, bad magic)
├── tier3-combination/
│   └── combination.test.ts        # Tier 3: Cross-Feature Combinations (auth+upload, PPTX accompaniment, mid-flight rollback)
└── tier4-lifecycle/
    └── lifecycle.test.ts          # Tier 4: Real-World Scenarios (Full admin upload -> rename cascade -> delete lifecycle)
```

---

## 4. Test Tiers & Coverage Thresholds

### Tier 1: Feature Coverage (Unit & Interface Contracts)
- **Minimum Requirement**: $\ge 5$ test cases per core feature module:
  1. **Auth & Security** ($\ge 5$ cases):
     - Correct password hash verification via constant-time scrypt.
     - Wrong password rejection with constant-time scrypt.
     - 12h signed JWT session issuance with `role: admin`.
     - Tampered / expired JWT rejection.
     - In-memory rate limiting: 5 failed attempts allowed, 6th attempt returns HTTP 429.
     - Rate limit reset on valid login.
     - Origin header validation on mutating requests.
  2. **Auto-Naming & Captions** ($\ge 5$ cases):
     - Standard naming pattern: `{Title}_Class{C}_{Subject}_Ch{NN}_{Type}.{ext}`.
     - Title sanitization: spaces to hyphens, alphanumeric only, max 60 chars.
     - Zero-padding for single-digit chapter numbers (`Ch02`).
     - Notes type formatting with teacher name: `Notes-{TeacherName}`.
     - Duplicate teacher name collision resolution (`-2`, `-3`).
     - Telegram caption formatting with machine-readable pipe-delimited tags, $\le 1024$ chars.
  3. **Magic-Byte Stream Validation** ($\ge 5$ cases):
     - Valid PDF accepted (`%PDF-` at byte 0, `%%EOF` at end).
     - Truncated PDF rejected (missing `%%EOF`).
     - Fake PDF (e.g. `.exe` renamed to `.pdf`) rejected.
     - Valid PPTX accepted (ZIP `PK\x03\x04` header and `[Content_Types].xml`).
     - Corrupted / non-ZIP PPTX rejected.
     - Empty byte array rejected.
  4. **Chunked Upload & Slicing** ($\ge 5$ cases):
     - File slicing into parts $\le 19\text{ MiB}$ (`19922944` bytes).
     - Streaming incremental SHA-256 computation across sequential chunks.
     - Out-of-order part rejection.
     - Oversized part rejection (> 19 MiB).
     - In-memory upload session timeout (30 min TTL).
     - Telegram & DB rollback on part failure.
  5. **Catalog & Admin Management** ($\ge 5$ cases):
     - Find or create chapter idempotency.
     - Duplicate file rejection for identical `(chapter_id, sha256)`.
     - File visibility toggle (`is_published`).
     - Bulk teacher notes visibility toggle.
     - Chapter rename with cascading `file_name` recalculation.
     - File deletion with cascade to `file_parts` and Telegram message cleanup.

### Tier 2: Boundary & Corner Cases
- Strict validation of extreme inputs:
  - Empty files (0 bytes) rejected with validation error.
  - 1-byte file slicing produces exactly 1 part of 1 byte.
  - Exactly 19 MiB (`19922944` bytes) produces exactly 1 part.
  - Exactly 19 MiB + 1 byte (`19922945` bytes) produces exactly 2 parts (19 MiB + 1 byte).
  - 45 MB file splits into 3 parts (19 MiB, 19 MiB, ~7 MiB) and reassembles with identical SHA-256.
  - 100 MB file (`MAX_FILE_MB`) splits into 6 parts without exceeding 19 MiB per part.
  - File exceeding `MAX_FILE_MB` (> 100 MB or > 200 MB hard cap) rejected.
  - Messy chapter titles: unicode accents (e.g. `Éléphant`), emojis, path traversal symbols (`../`), special punctuation.
  - 200-character long chapter titles correctly truncated / sanitized to 60-character slug.

### Tier 3: Cross-Feature Combinations
- Multi-component interaction & edge conditions:
  - **Auth + Upload**: Unauthenticated multipart upload rejected at gateway/route.
  - **PPTX Accompaniment + Naming**: PPTX upload without accompanying PDF preview export is rejected; with valid PDF preview export, both files are created with parent-child linkage (`parent_file_id`).
  - **Upload Mid-Flight Failure + Rollback**: Upload of 5 parts where Part 3 fails simulates Telegram Bot API error; parts 1 and 2 messages are purged via `deleteMessage`, and 0 rows exist in `files` or `file_parts`.
  - **Duplicate Prevention + Rollback**: Attempting to complete an upload with an existing `(chapter_id, sha256)` rolls back the newly uploaded Telegram parts and leaves the original file intact.

### Tier 4: Real-World Scenarios (End-to-End Lifecycle)
- Full lifecycle walkthrough simulating an admin's complete session:
  1. Admin authenticates via `/api/admin/login` -> receives 12h JWT session cookie.
  2. Admin initiates multipart upload for Class 9 Economics Chapter 1 (`The Story of Village Palampur`).
  3. Chapter is auto-created in `chapters` table.
  4. 3-part file is streamed, validated, hashed, and stored in Telegram.
  5. Admin views catalog via `/api/admin/library` -> file appears with correct deterministic name.
  6. Admin toggles visibility to hidden (`is_published: false`) -> public catalog query excludes file, admin query includes it.
  7. Admin renames chapter title to `Village Palampur Economy` -> cascade updates `chapters.title` and recalculates `files.file_name`.
  8. Admin deletes file -> database cascades delete to `files` and `file_parts`, and all 3 Telegram messages are deleted via Telegram Bot API.

---

## 5. Live Telegram Smoke Test (`scripts/smoke-telegram.ts`)

Adheres strictly to acceptance criteria 1.6 & 1.10:
- **Standard Mode (`npm run smoke:telegram`)**:
  - Generates a valid minimal PDF buffer with valid header `%PDF-` and `%%EOF`.
  - Computes expected SHA-256 hash.
  - Uploads document to private Telegram channel using Bot API `sendDocument`.
  - Calls `getFile` and downloads the stored file.
  - Verifies downloaded bytes match expected SHA-256 hash.
  - Immediately calls `deleteMessage` to prevent channel clutter.
  - Outputs `PASS` with timing metrics.
- **Big-File Mode (`npm run smoke:telegram -- --big`)**:
  - Generates a ~45 MB random pseudo-binary buffer.
  - Computes global SHA-256 hash.
  - Slices buffer into 3 parts: Part 1 (19 MiB), Part 2 (19 MiB), Part 3 (~7.14 MiB).
  - Sequentially uploads each part to Telegram channel with part captions.
  - Reads back each part via `getFile` and streams downloads into a reassembled buffer.
  - Verifies concatenated SHA-256 matches the original 45 MB file.
  - Sequentially calls `deleteMessage` on all 3 Telegram messages.
  - Outputs `PASS` with throughput metrics.

---

## 6. Execution Commands & Quality Gates

```bash
# Run full Vitest suite (all tiers)
npm run test

# Run specific tier
npx vitest run tests/tier1-feature/
npx vitest run tests/tier2-boundary/
npx vitest run tests/tier3-combination/
npx vitest run tests/tier4-lifecycle/

# Run Telegram live smoke tests
npm run smoke:telegram
npm run smoke:telegram -- --big

# Run lint and typecheck
npm run lint
```
