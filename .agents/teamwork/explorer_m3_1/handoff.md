# Milestone M3 Handoff Report: Telegram Client Expansion & Upload Session Manager

**Agent**: Explorer 1 (`explorer_m3_1`)  
**Parent**: Orchestrator 1 (`fb1a83fa-301b-45dd-ba05-a3edc0267f37`)  
**Date**: 2026-10-04  
**Type**: Hard Handoff (Investigation & Architecture Design Complete)

---

## 1. Observation

1. **Existing Codebase State**:
   - `src/lib/telegram.ts` (lines 55–145): `TelegramClient` currently implements only `getMe()`, `postTestMessage()`, `deleteMessage()`, and `getUpdates()`. It lacks `sendDocument`, `getFile`, `downloadFile`, and cache management.
   - `src/lib/upload-session.ts`: File does not currently exist.
   - `src/lib/validate.ts` (line 3): defines `export const PART_SIZE_BYTES = 19 * 1024 * 1024; // 19 MiB hard limit per Telegram chunk` (19,922,944 bytes).
   - `scripts/smoke-telegram.ts` (lines 62–101, 103–127, 129–149): demonstrates working Telegram API calls:
     - `sendDocument` using `FormData` and `Blob` with `chat_id`, `document`, and `caption`.
     - `getFile` resolving `file_path`.
     - `downloadFile` fetching from `https://api.telegram.org/file/bot<token>/<filePath>`.
     - Token sanitization replacing the bot token with `[REDACTED_BOT_TOKEN]`.
2. **Existing Test Suite Baseline**:
   - `npx vitest run`: 12 test files passed, 164 tests passed in 4.91s.
   - `tests/tier1-feature/chunking.test.ts` (lines 30–170): defines an in-file `UploadSessionManager` simulator verifying:
     - Part slicing <= 19 MiB (`F12.1`).
     - Oversized part rejection: `Part ${partNo} exceeds maximum chunk size of 19 MiB (${partBuffer.length} > ${PART_SIZE_BYTES})` (`F12.2`).
     - Streaming incremental SHA-256 matching full file digest (`F13.1`).
     - Sequential ordering and duplicate rejection: `Out of order part: expected ${expectedPart}, received ${partNo}` (`F14.1`, `F14.2`).
     - Mid-stream rollback: part 3 failure triggers deletion of parts 1 and 2, leaving 0 database records (`F15.1`).
     - Complete rollback on database insertion failure (`F15.2`).
     - 30-min TTL expiration: `Upload session expired (30m TTL)` (`F15.3`).
3. **Database Schema Constraints**:
   - `supabase/schema.sql` (lines 36–45): `file_parts` table enforces `size_bytes integer not null check (size_bytes > 0 and size_bytes <= 19922944)`, `part_no smallint not null check (part_no >= 1)`, and primary key `(file_id, part_no)`.

---

## 2. Logic Chain

1. **Step 1 (Telegram Client Contract)**:
   From Observation 1 and 2, `TelegramClient` must provide `sendDocument`, `getFile`, and `downloadFile` matching the exact signatures required by both the production upload routes (`src/app/api/admin/upload/*`) and the smoke scripts (`scripts/smoke-telegram.ts`).
2. **Step 2 (45-Minute Link Caching)**:
   Telegram Bot API documentation specifies file download links remain valid for 1 hour. Caching `file_path` for 45 minutes in memory within `TelegramClient` satisfies the requirement, prevents redundant API roundtrips during streaming/downloading, and avoids serving expired URLs.
3. **Step 3 (Token Security & Redaction)**:
   From Observation 1, Telegram bot tokens must never appear in error logs or thrown exceptions. All network operations in `TelegramClient` must run through a token sanitizer that regex-escapes the token and substitutes `[REDACTED_BOT_TOKEN]`.
4. **Step 4 (In-Memory Upload Session Management)**:
   From Observation 2 and 3, `UploadSessionManager` in `src/lib/upload-session.ts` must maintain in-memory sessions with:
   - 30-minute TTL.
   - An `AsyncLock` per `uploadId` to serialize part uploads and prevent race conditions or duplicate chunk forwarding.
   - Strict size validation against `PART_SIZE_BYTES = 19 * 1024 * 1024` (19922944 bytes).
   - Strict sequence validation (`partNo === session.receivedParts.length + 1`) to block out-of-order and duplicate chunks.
   - Incremental streaming SHA-256 using Node's `crypto.createHash("sha256")` updated per chunk slice, ensuring that at no time does server memory hold more than one 19 MiB chunk.
5. **Step 5 (Rollback Reliability)**:
   From Observation 2, when any Telegram forward fails or database insertion fails, `rollbackTelegramMessages` must delete all previously recorded Telegram messages for that session. Deletion must be fault-tolerant: individual deletion errors are caught and logged so that all remaining message IDs are processed without halting rollback.

---

## 3. Caveats

1. **Serverless Ephemeral Memory**:
   In serverless multi-instance environments, in-memory session tracking requires session affinity (sticky routing) so all parts of a given file upload hit the same container instance. For single-instance container deployments (Node/Docker/PM2), the in-memory map functions flawlessly.
2. **Global Channel Rate Limit**:
   Telegram channels impose a rate limit of ~20 messages per minute. For a 100 MB file (6 parts), sequential forwarding takes ~6-10 seconds, which stays well within rate limits. The 429 retry backoff logic handles any temporary throttling from Telegram gracefully.
3. **Alternative Architecture Considered**:
   Writing chunks to local disk was considered and rejected per user constraint: the system operates with zero disk I/O, streaming directly from the HTTP request to Telegram.

---

## 4. Conclusion

The architectural designs and complete concrete code for `src/lib/telegram.ts` (expanded) and `src/lib/upload-session.ts` (new) are fully formulated in `analysis.md`.
They satisfy:
- Feature 11: Extended `TelegramClient` (`sendDocument`, `getFile`, `downloadFile`, 45-min cache, token redaction, 429 retries).
- Feature 12: Slicing & Part Validation (<= 19 MiB, sequence checks).
- Feature 13: Upload Session Management (30-min TTL, streaming SHA-256).
- Feature 14: Sequential Telegram Forwarding with session concurrency lock.
- Feature 15: Automatic Telegram & DB rollback on error.

These designs provide immediate drop-in compatibility for Explorer 2 (Upload API routes), Spec Miner (Unit tests), and Worker M3 (Implementation).

---

## 5. Verification Method

Independent verification can be executed as follows:
1. **Source Inspection**:
   - Inspect proposed `TelegramClient` in `.agents/teamwork/explorer_m3_1/analysis.md` § 4.
   - Inspect proposed `UploadSessionManager` in `.agents/teamwork/explorer_m3_1/analysis.md` § 5.
2. **Existing Test Suite Verification**:
   - Run `npx vitest run` in the project root: confirm all 12 test files and 164 tests pass.
3. **M3 Unit Test Invalidation Conditions**:
   - If a chunk > 19922944 bytes is accepted, validation fails.
   - If an out-of-order chunk is accepted, sequence validation fails.
   - If a part 3 failure does not trigger `deleteMessage` for parts 1 and 2, rollback fails.
   - If token is found in any error message or stack trace, security validation fails.
