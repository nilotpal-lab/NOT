# Changes Summary — Milestone M3 (Chunked Multi-Part Telegram Upload Engine)

**Worker**: `teamwork_preview_worker` (Worker 2 replacement for Milestone M3)  
**Date**: 2026-10-04  
**Scope**: Features 11–16 of SST Chapter Library Phase 1

---

## 1. Files Modified and Created

### 1. `src/lib/telegram.ts` (Modified)
- **Extended `TelegramClient`**:
  - `sendDocument(channelId, fileBuffer, fileName, caption?, timeoutMs = 60000)`: Multipart/form-data upload using global `fetch`, `FormData`, and `Blob`. Handles HTTP 429 rate limits with automatic exponential backoff based on `parameters.retry_after`. Redacts bot token from all errors using regex-escaped token substitution.
  - `getFile(fileId, timeoutMs = 30000)`: Fetches file metadata and Telegram `file_path`. Implements in-memory 45-minute TTL cache (`FILE_PATH_CACHE_TTL_MS = 45 * 60 * 1000`) to eliminate redundant API roundtrips while preventing expired link leakage (Telegram links expire in 1 hour).
  - `downloadFile(filePath, timeoutMs = 60000)`: Downloads binary buffers directly from Telegram File API endpoint.
  - Cache management helpers: `clearFilePathCache()` and `getCachedFilePath(fileId)`.
  - Retained all existing methods: `getMe()`, `postTestMessage()`, `deleteMessage()`, `getUpdates()`.

### 2. `src/lib/upload-session.ts` (Created)
- **Pure Slicing & Validation Utilities**:
  - `sliceBuffer(buffer, partSizeBytes = 19922944)`: Slices buffers into parts strictly $\le 19\text{ MiB}$. Returns `[]` for 0-byte input.
  - `calculatePartCount(totalBytes, partSizeBytes)`: Calculates mathematical part count.
  - `validateChunkSize(chunkSizeBytes)`: Enforces $0 < \text{chunkSizeBytes} \le 19\text{ MiB}$.
- **`UploadSessionManager` Engine**:
  - In-memory session tracking with 30-minute TTL (`sessionTtlMs = 1800000`).
  - Per-session async mutex lock (`AsyncLock`) preventing concurrent chunk race conditions.
  - Strict chunk size validation: rejects chunks $> 19\text{ MiB}$ or $0$ bytes.
  - Strict ordering validation: enforces `partNo === receivedParts.length + 1`. Rejects out-of-order or duplicate submissions.
  - Incremental streaming SHA-256 calculation: feeds incoming chunks to `hashStream.update(chunkBuffer)` without holding full files in memory.
  - Memory discipline: holds at most 1 chunk in memory per request.
  - Rollback engine: `rollbackTelegramMessages`, `rollbackSession`, and `rollbackSessionTelegram` iterate over recorded `tg_message_id`s and call `deleteMessage`.
  - `completeSession`: Validates all parts uploaded, computes final SHA-256.
  - `completeUpload`: Complete transaction helper for tests and orchestration.
  - Exported global singleton `uploadSessionManager`.

### 3. `src/types/database.ts` (Created)
- TypeScript relational types matching `supabase/schema.sql`:
  - `Subject`: `"History" | "Geography" | "Civics" | "Economics" | "SocialScience" | string`
  - `FileKind`: `"ncert_pdf" | "ppt" | "ppt_pdf" | "teacher_notes" | string`
  - `Chapter` / `ChapterRecord`: Relational shape for `chapters` table.
  - `FileRecord`: Relational shape for `files` table.
  - `FilePart` / `FilePartRecord`: Relational shape for `file_parts` table.
  - `ChapterWithFiles`: Composite type for library queries.

### 4. `src/lib/catalog.ts` (Created)
- **Supabase Data Service Operations**:
  - `findOrCreateChapter`: Finds existing chapter by `(class, subject, chapter_no)` or inserts new row. Handles PostgreSQL unique constraint race condition (`code: "23505"`).
  - `checkDuplicateFile`: Checks if `(chapter_id, sha256)` exists in `files` table. Returns existing file details if collision occurs, or `null`.
  - `checkFileDuplicate`: Boolean convenience wrapper for duplicate checking.
  - `insertFileWithParts`: Inserts record into `files` and parts into `file_parts`. Implements automatic database rollback: deletes inserted file record if parts insertion fails.
  - Library management operations: `getChaptersWithFiles`, `toggleFilePublished`, `bulkToggleTeacherNotes`, `renameChapter`, `deleteFileWithTelegramCleanup`.

### 5. `src/app/api/admin/upload/part/route.ts` (Created)
- **POST Chunk Upload Endpoint**:
  - Verifies admin session token (`admin_session`) with `verifyAdminToken`.
  - Ingests both `multipart/form-data` and `application/octet-stream` payloads.
  - Validates chunk ceiling $\le 19\text{ MiB}$ (`PART_SIZE_BYTES = 19922944`).
  - Auto-starts session on part 1; enforces 30-minute session TTL.
  - Acquires per-session concurrency lock to serialize chunk processing.
  - Validates strict in-order sequencing (`partNo === session.receivedParts.length + 1`).
  - Executes stream magic-byte validation (`validatePdfMagic` / `validatePptxMagic`) on part 1 and final part.
  - Computes part SHA-256 and updates incremental `hashStream`.
  - Formats pipe-delimited machine-readable Telegram caption (`formatTelegramCaption`).
  - Forwards chunk immediately to Telegram channel via `TelegramClient.sendDocument`.
  - Automatic Rollback: If forwarding fails, immediately deletes all previously uploaded parts for this session via `deleteMessage` and purges the session.
  - Memory discipline: Dereferences `chunkBuffer = null` immediately after forward.

### 6. `src/app/api/admin/upload/complete/route.ts` (Created)
- **POST Upload Completion Endpoint**:
  - Verifies admin session token (`admin_session`).
  - Validates payload via Zod schema (`uploadId`, `class`, `subject`, `chapterNo`, `title`, `kind`, etc.).
  - Verifies all expected parts have arrived; triggers Telegram rollback if incomplete.
  - Finalizes cryptographic reassembled SHA-256 and verifies match with client checksum if provided.
  - Enforces PPTX accompaniment rule (`validatePptxAccompaniment`).
  - Finds or auto-creates chapter via `findOrCreateChapter`.
  - Checks for duplicate file in chapter (`(chapter_id, sha256)`). If collision detected, triggers Telegram rollback, deletes session, and returns HTTP 409 Conflict.
  - Generates deterministic filename via `buildFileName` disambiguated against existing names in the chapter.
  - Atomically inserts rows into `files` and `file_parts`.
  - If database insertion fails, removes partial DB records, deletes all Telegram parts via `deleteMessage`, and purges session.
  - Cleans up session and returns HTTP 201 Created.

### 7. `tests/unit/chunking.test.ts` (Created)
- Unit tests covering:
  - C1.1: 1-byte file slicing ($\le 19\text{ MiB}$, identical reassembly SHA-256).
  - C1.2: Exactly 19 MiB file slicing (exactly 1 part of 19,922,944 bytes).
  - C1.3: 19 MiB + 1 byte slicing (2 parts: 19,922,944 + 1 bytes).
  - C1.4: 45 MB smoke-test file slicing (3 parts $\le 19\text{ MiB}$, identical reassembly SHA-256).
  - C1.5: 100 MB default max file slicing (6 parts $\le 19\text{ MiB}$, identical reassembly SHA-256).
  - C1.6: Streaming incremental SHA-256 vs single-shot digest across parts.
  - C1.7: Empty buffer edge case (returns `[]`).
  - C1.8: Part count calculation function across various sizes.
  - C1.9: Oversized part validation rejection ($> 19\text{ MiB}$).

### 8. `tests/unit/rollback.test.ts` (Created)
- Unit tests covering:
  - R1.1: Failure on part 3 of 5 deletes parts 1 and 2 via `deleteMessage`, clears session, leaves 0 DB rows.
  - R1.2: DB insertion failure on `completeUpload` deletes all 5 parts via `deleteMessage`, clears session, leaves 0 DB rows.
  - R1.3: Failure on part 1 of 5 deletes 0 prior messages and clears session.
  - R1.4: Failure on final part (5 of 5) deletes parts 1–4 and clears session.
  - R1.5: Out-of-order part 2 before part 1 rejected without sending to Telegram.
  - R1.6: Duplicate part 1 rejected without modifying existing part.
  - R1.7: Expired upload session (> 30 min TTL) rejected.
  - R1.8: Incomplete upload completion call rejected and rolls back uploaded parts.
  - D1.1: Chapter auto-creation on first upload.
  - D1.2: Chapter reuse (idempotency) on subsequent uploads.
  - D1.3: Duplicate file in same chapter rejected and rolls back Telegram parts.
  - D1.4: Identical SHA-256 in different chapters permitted.
  - D1.5: PPTX accompaniment rule rejects PPT without preview PDF.

---

## 2. Verification Summary
- `npm test`: **14 test files passed, 186 tests passed** (0 failures).
- `npm run lint`: **0 errors, 0 warnings**.
- `npx tsc --noEmit`: **0 type errors**.
- `npm run build`: **Next.js 16.3.8 Turbopack build succeeded**, routes bundled.
