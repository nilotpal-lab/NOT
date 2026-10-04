# Handoff Report: Telegram & Chunking Storage Survey

**Agent**: Explorer 2 (teamwork_preview_explorer)  
**Recipient**: orchestrator_1 (`fb1a83fa-301b-45dd-ba05-a3edc0267f37`)  
**Timestamp**: 2026-10-04T09:51:00Z  
**Type**: Hard Handoff (Investigation Complete)  

---

## 1. Observation

1. **Telegram Client (`src/lib/telegram.ts`)**:
   - `TelegramClient` exists in `src/lib/telegram.ts:55-145`.
   - Lines 106–144 define only four API methods: `getMe()`, `postTestMessage()`, `deleteMessage()`, and `getUpdates()`.
   - `sendDocument` and `getFile` methods are **not present** anywhere in `src/lib/telegram.ts` or the repository.
   - Line 76 configures a hardcoded timeout: `const timeoutMs = 15000;`.
   - Lines 86–91 implement HTTP 429 extraction of `parameters.retry_after`.
   - Lines 67–72 implement token sanitization replacing `this.token` with `[REDACTED_BOT_TOKEN]`.

2. **Smoke Test Script Status (`package.json` & `scripts/`)**:
   - `package.json:17` defines `"smoke:telegram": "tsx scripts/smoke-telegram.ts"`.
   - `scripts/smoke-telegram.ts` does **not exist** on the filesystem.
   - Existing scripts in `scripts/` are: `db-check.ts`, `find-channel-id.ts`, `hash-password.ts`, and `preflight.ts`.
   - `SST-Library-FINAL-Antigravity-Prompt.md:174` and `ORIGINAL_REQUEST.md:61-62` mandate two smoke test modes:
     - Standard: upload tiny PDF, read back with `getFile`, compare SHA-256, delete message, print PASS.
     - Big-file (`--big` flag): generate ~45 MB random test file, upload as 3 parts, read back with `getFile`, concatenate, compare SHA-256, delete all 3 messages, print PASS.

3. **Storage & Chunking Constants & Schema Constraints**:
   - `src/lib/validate.ts:3`: `export const PART_SIZE_BYTES = 19 * 1024 * 1024; // 19 MiB hard limit per Telegram chunk`.
   - `supabase/schema.sql:42`: `size_bytes integer not null check (size_bytes > 0 and size_bytes <= 19922944)`.
   - `supabase/schema.sql:24`: `size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 209715200)` (200 MiB file cap).
   - `tests/unit/env.test.ts:61-66` verifies `PART_SIZE_BYTES === 19922944` and `PART_SIZE_BYTES < 20 * 1024 * 1024`.

4. **Environment Configuration & Preflight Health**:
   - `.env.example:1-3` defines `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNEL_ID`.
   - `.env.local` contains active credentials.
   - `npm run preflight` exits with code 0:
     - `PRE-3 Telegram Bot Verification (getMe)` -> `[PASS] Connected to bot @sst_library_nilot_bot (ID: 8603258167)`
     - `PRE-4 Telegram Channel Posting & Deletion Permissions` -> `[PASS] Successfully posted and deleted test message in the private storage channel.`
   - `npm run test` executes `vitest run` with 7/7 passing unit tests.

5. **Upload Endpoints & Session Management**:
   - `src/app/api/` currently only contains `api/health/route.ts`.
   - No upload endpoints exist (`/api/admin/upload/part`, `/api/admin/upload/complete` are yet to be implemented).
   - No in-memory upload session tracker exists yet.

---

## 2. Logic Chain

1. **Why 19 MiB chunking is physically necessary**:
   - Official Telegram Bot API hosted servers restrict file downloads via `getFile` to a strict 20 MB ceiling (20,971,520 bytes).
   - Any single file part exceeding 20 MB cannot be retrieved via `getFile`, which would permanently break file downloads.
   - Defining `PART_SIZE_BYTES = 19 * 1024 * 1024` (19,922,944 bytes) safely sits below 20 MB with ~1 MB safety margin.
   - The PostgreSQL constraint `size_bytes <= 19922944` on `file_parts` strictly guards database integrity.

2. **Why `TelegramClient` must be expanded before smoke testing and uploads**:
   - `package.json` specifies `"smoke:telegram": "tsx scripts/smoke-telegram.ts"`.
   - Neither `scripts/smoke-telegram.ts` nor the underlying `sendDocument` / `getFile` methods in `src/lib/telegram.ts` exist yet.
   - Therefore, the prerequisite for implementing `scripts/smoke-telegram.ts` and the upload routes is adding `sendDocument`, `getFile`, and `downloadFile` to `TelegramClient`.

3. **Why network timeout in `TelegramClient` must be adjusted**:
   - In `src/lib/telegram.ts:76`, `timeoutMs` is fixed at 15 seconds.
   - Uploading or downloading a 19 MiB chunk across 15 seconds requires > 10.6 Mbps sustained network transfer rate.
   - Real-world network jitter would trigger spurious `AbortError` exceptions.
   - Therefore, `sendDocument` and chunk downloads must support a timeout parameter of at least 60–120 seconds.

4. **Why in-memory session tracking and rollback are required**:
   - Files up to 100 MB require up to 6 parts (or up to 11 parts for 200 MB).
   - Holding multiple parts in server memory would exhaust RAM under concurrency.
   - By holding at most one part in memory per request, computing SHA-256 incrementally, and storing Telegram message IDs in an in-memory session object (with 30-min TTL), memory usage is minimized.
   - If an error occurs on part K or during DB insert, the server must iterate through recorded `tg_message_id`s and delete them from the channel, ensuring zero orphaned messages and zero partial rows.

---

## 3. Caveats

1. **No Source Code Changes Made**: This survey strictly adhered to read-only exploration. No source files were modified or created except `.agents/teamwork/explorer_survey_2/*` workspace logs and reports.
2. **Telegram Hosted Server vs Local Bot API Server**: The 20 MB `getFile` limit applies to Telegram's cloud hosted Bot API (`api.telegram.org`). A local Telegram Bot API server supports up to 2 GB, but the project specification explicitly targets the free zero-cost hosted Telegram Bot API.
3. **Database Insertion During Smoke Tests**: The standard smoke test script (`npm run smoke:telegram`) tests Telegram channel upload, read-back, SHA-256 comparison, and message deletion directly without necessarily polluting Supabase `files` or `file_parts` tables, whereas full integration tests may test database row creation and cascade rollbacks.

---

## 4. Conclusion

1. **Readiness**: Phase 0 foundational credentials and channel connectivity are verified and fully operational (5/5 green in `preflight.ts`).
2. **Missing Components for Phase 1 Storage**:
   - `src/lib/telegram.ts`: Needs `sendDocument`, `getFile`, `downloadFile`, 45-min path cache, and configurable timeouts.
   - `scripts/smoke-telegram.ts`: Needs to be created to implement `npm run smoke:telegram` and `npm run smoke:telegram -- --big`.
   - `src/lib/upload-session.ts`: Needs in-memory upload session manager with 30-min TTL, incremental SHA-256, and auto-rollback.
   - `src/app/api/admin/upload/`: Needs `/api/admin/upload/part` and `/api/admin/upload/complete`.
3. **Architecture Verification**: The design with `PART_SIZE_BYTES = 19 MiB`, database check constraints, and rollback on failure is sound, fully aligned with all requirements in `ORIGINAL_REQUEST.md` and `SST-Library-FINAL-Antigravity-Prompt.md`.

---

## 5. Verification Method

To independently verify the observations and conclusions in this report:

1. **Verify Existing Preflight & Telegram Channel Health**:
   ```powershell
   npm run preflight
   ```
   *Expected*: All 5 checks PASS, including PRE-3 and PRE-4.

2. **Verify Existing Unit Tests & Constants**:
   ```powershell
   npm run test
   ```
   *Expected*: 7/7 tests pass, confirming `PART_SIZE_BYTES = 19922944`.

3. **Verify Database Schema Constraints**:
   ```powershell
   npm run db:check
   ```
   *Expected*: Passes checks for `files` (200 MiB cap) and `file_parts` (19 MiB cap).

4. **Verify Missing Files**:
   - Inspect `scripts/smoke-telegram.ts` (does not exist).
   - Inspect `src/lib/telegram.ts` (lines 106–144 show lack of `sendDocument` and `getFile`).

---
*Report filed by Explorer 2 to orchestrator_1.*
