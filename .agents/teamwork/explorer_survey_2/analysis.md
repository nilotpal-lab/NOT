# Telegram & Chunking Storage Survey: Phase 1 Architectural Analysis

**Explorer**: Explorer 2 (Telegram & Chunking Storage Survey)  
**Date**: 2026-10-04  
**Working Directory**: `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY`  
**Status**: COMPLETE (Read-Only Investigation)  

---

## Executive Summary

This survey provides an authoritative technical audit of the Telegram Bot API integration, chunked multi-part storage mechanism, environment configuration, rate limiting, and smoke testing infrastructure for Phase 1 of the "SST Chapter Library" project.

Key findings:
1. **Telegram Client (`src/lib/telegram.ts`)**: Currently implements `getMe`, `postTestMessage`, `deleteMessage`, and `getUpdates` with token redacting and 429 backoff handling. It **lacks** `sendDocument`, `getFile`, `downloadFile`, file path caching (45-min TTL), and configurable timeouts for large uploads.
2. **Smoke Test Scripts**: `package.json` defines `"smoke:telegram": "tsx scripts/smoke-telegram.ts"`, but `scripts/smoke-telegram.ts` **does not yet exist**. Both the standard tiny PDF test and the `--big` 45 MB 3-part test must be implemented in this file.
3. **Chunking & Upload Infrastructure**: No upload endpoints or session tracking exist yet under `src/app/api/admin/upload/`. The constant `PART_SIZE_BYTES = 19 * 1024 * 1024` (19 MiB = 19,922,944 bytes) is defined in `src/lib/validate.ts:3` and strictly enforced by the database check constraint in `supabase/schema.sql:42`.
4. **Environment Variables**: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNEL_ID` are defined in `.env.example`, validated via `zod` in `src/lib/validate.ts`, redacted in `src/lib/logger.ts`, and verified 5/5 green in `scripts/preflight.ts`.
5. **Limits & Timeouts**: The hosted Telegram Bot API enforces a **20 MB download limit** per `getFile`, making 19 MiB chunking mandatory. The existing 15-second timeout in `TelegramClient.request` is inadequate for 19 MiB transfers and must be made configurable (e.g. 60-120s for uploads).

---

## 1. Existing Telegram Client & Integration Survey

### 1.1 Source File Inspection: `src/lib/telegram.ts`

The current implementation in `src/lib/telegram.ts` (146 lines) contains:

| Item | Location | Status | Details |
| :--- | :--- | :--- | :--- |
| `TelegramUser` interface | Lines 3–8 | Implemented | Bot user details (`id`, `is_bot`, `first_name`, `username`). |
| `TelegramMessageResponse` | Lines 10–27 | Implemented | Standard response with `result.message_id`, `chat.id`, `parameters.retry_after`. |
| `TelegramUpdatesResponse` | Lines 29–53 | Implemented | Updates response for channel posts and messages. |
| `TelegramClient` class | Lines 55–145 | Implemented | Core client initialized with `token`. Sets `baseUrl = https://api.telegram.org/bot${token}`. |
| `sanitizeError()` | Lines 67–72 | Implemented | Regex replacement to prevent leaking `this.token` in error messages. |
| `request<T>()` | Lines 74–104 | Implemented | Wrapper around `fetch()` with 15s `AbortController` timeout and HTTP 429 retry-after extraction. |
| `getMe()` | Lines 106–112 | Implemented | Calls Telegram `getMe` endpoint. |
| `postTestMessage()` | Lines 114–128 | Implemented | Calls `sendMessage` with test text, returns `message_id`. |
| `deleteMessage()` | Lines 130–140 | Implemented | Calls `deleteMessage` with `chat_id` and `message_id`. |
| `getUpdates()` | Lines 142–144 | Implemented | Calls `getUpdates` endpoint. |

### 1.2 Missing Telegram Bot API Methods Required for Phase 1

To fulfill Phase 1 requirements (R2, R3, Acceptance Criteria 1.5, 1.6, 1.10), `src/lib/telegram.ts` must be extended with:

1. **`sendDocument(options)`**:
   - **Endpoint**: `POST https://api.telegram.org/bot<token>/sendDocument`
   - **Content-Type**: `multipart/form-data` (using Node/Fetch `FormData`).
   - **Parameters**:
     - `chat_id`: string | number
     - `document`: `Blob` or `Buffer` with filename (e.g., standard file name or chunk label)
     - `caption`: Formatted caption string (≤ 1024 characters):
       `title=...|class=...|subject=...|ch=...|kind=...|name=...|sha=...|part=n/total`
   - **Returns**: `{ messageId: number; fileId: string; fileUniqueId: string; fileSize: number }`
   - **Timeout**: Must override default 15s timeout with 60–120s for 19 MiB payload transfers.

2. **`getFile(fileId: string)`**:
   - **Endpoint**: `POST https://api.telegram.org/bot<token>/getFile`
   - **Parameters**: `{ file_id: fileId }`
   - **Returns**: `{ file_id: string; file_unique_id: string; file_size: number; file_path: string }`
   - **Path Caching**: Cache `file_path` keyed by `tg_file_id` for 45 minutes in an in-memory TTL map (`Map<string, { filePath: string; cachedAt: number }>`).
   - **Stale Path Recovery**: If download against cached path returns HTTP 404 or 400, evict cache and call `getFile` once more.

3. **`downloadFile(filePath: string)` / Streaming helper**:
   - **Endpoint**: `GET https://api.telegram.org/file/bot<token>/<filePath>`
   - **Security**: NEVER expose bot token or `api.telegram.org/file/bot...` to the client. Server fetches bytes directly.
   - **Returns**: `Buffer` (or `ReadableStream`).
   - **Verification**: Verifies SHA-256 of downloaded chunk against expected `sha256`.

4. **Multi-Message Deletion Helper**:
   - `deleteMessages(channelId: string | number, messageIds: number[])`:
   - Iterates through or calls Telegram `deleteMessages` (if supported) to roll back parts reliably during failure cleanup.

5. **Global Upload Concurrency Lock**:
   - Specification requirement: "Upload one file at a time; global upload lock; hold at most one part in memory per request".
   - In-memory mutex or semaphore to ensure only one upload pipeline executes simultaneously on the server.

---

## 2. Smoke Test Scripts Survey

### 2.1 Package Configuration: `package.json`

Line 17 of `package.json`:
```json
"smoke:telegram": "tsx scripts/smoke-telegram.ts",
```

### 2.2 Script Status: `scripts/smoke-telegram.ts`

- **Status**: **NOT FOUND / DOES NOT EXIST YET**.
- **Existing scripts in `scripts/`**:
  - `scripts/db-check.ts` (Comprehensive schema & constraint verification)
  - `scripts/find-channel-id.ts` (Resolves channel ID via `getUpdates`)
  - `scripts/hash-password.ts` (Generates scrypt password hash)
  - `scripts/preflight.ts` (5/5 preflight health check)

### 2.3 Detailed Specification for `scripts/smoke-telegram.ts`

The script must support two modes based on command line flags:

#### Mode A: Standard Smoke Test (`npm run smoke:telegram`)
- **CLI invocation**: `npm run smoke:telegram` (no `--big` flag).
- **Execution steps**:
  1. Load environment from `.env.local` using `dotenv`. Ensure `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHANNEL_ID` are present.
  2. Instantiate `TelegramClient`.
  3. Generate a tiny valid in-memory PDF buffer (e.g. ~300 bytes containing valid header `%PDF-1.4`, objects, xref table, and `%%EOF`).
  4. Compute SHA-256 of the generated PDF buffer.
  5. Post document to channel via `sendDocument` with caption:
     `title=Smoke Test|class=6|subject=History|ch=1|kind=ncert_pdf|name=Smoke-Test_Class6_History_Ch01_NCERT.pdf|sha=<8-char-prefix>|part=1/1`
  6. Call `getFile(fileId)` to retrieve Telegram `file_path`.
  7. Download the file from `https://api.telegram.org/file/bot<token>/<file_path>`.
  8. Compute SHA-256 of downloaded buffer.
  9. Compare `downloaded_sha256 === original_sha256`. Assert exact match.
  10. Call `deleteMessage(channelId, messageId)` to delete the uploaded message from the channel.
  11. Print structured verification table and exit 0 with `"PASS"`.

#### Mode B: Big-File Smoke Test (`npm run smoke:telegram -- --big`)
- **CLI invocation**: `npm run smoke:telegram -- --big`. Detect via `process.argv.includes("--big")`.
- **Execution steps**:
  1. Generate a ~45 MB pseudo-random test buffer (`45 * 1024 * 1024` = 47,185,920 bytes).
  2. Compute whole-file original SHA-256.
  3. Split the 45 MB buffer into 3 sequential parts:
     - Part 1: exactly 19 MiB (`19 * 1024 * 1024` = 19,922,944 bytes)
     - Part 2: exactly 19 MiB (`19 * 1024 * 1024` = 19,922,944 bytes)
     - Part 3: remainder 7,340,032 bytes (~7 MiB)
     - Assert all parts ≤ 19 MiB (19,922,944 bytes).
  4. Upload Part 1, Part 2, and Part 3 sequentially to Telegram channel via `sendDocument`:
     - Caption includes `|part=1/3`, `|part=2/3`, `|part=3/3`.
     - Record `message_id` and `file_id` for each part.
  5. Read every part back using `getFile`:
     - Download Part 1 bytes, verify part SHA-256.
     - Download Part 2 bytes, verify part SHA-256.
     - Download Part 3 bytes, verify part SHA-256.
  6. Concatenate downloaded Part 1, Part 2, and Part 3 into a single 45 MB buffer.
  7. Compute SHA-256 of joined buffer; assert match with original whole-file SHA-256.
  8. Delete all 3 part messages from Telegram channel (`deleteMessage` for each recorded message ID).
  9. If database rows were created, ensure cleanup (or run pure channel storage smoke test without dirtying database).
  10. Print structured verification table and exit 0 with `"PASS"`.

---

## 3. Storage Architecture, Chunking, Streaming, & Multipart Handling

### 3.1 Hard Limits & Database Constraints

From `supabase/schema.sql`:
- **`files.size_bytes`**:
  ```sql
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 209715200)
  ```
  Hard maximum file size: 200 MiB (209,715,200 bytes). Configured default in `MAX_FILE_MB`: 100 MB.
- **`file_parts.size_bytes`**:
  ```sql
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 19922944)
  ```
  Hard maximum part size: **19,922,944 bytes** (`19 * 1024 * 1024` = 19 MiB).
- **`file_parts` primary key & schema**:
  ```sql
  create table if not exists file_parts (
    file_id uuid not null references files(id) on delete cascade,
    part_no smallint not null check (part_no >= 1),
    tg_file_id text not null,
    tg_file_unique_id text not null,
    tg_message_id bigint not null,
    size_bytes integer not null check (size_bytes > 0 and size_bytes <= 19922944),
    sha256 text not null,
    primary key (file_id, part_no)
  );
  ```

### 3.2 Constants Definition

In `src/lib/validate.ts:3`:
```ts
export const PART_SIZE_BYTES = 19 * 1024 * 1024; // 19 MiB hard limit per Telegram chunk
```
Verified in unit tests (`tests/unit/env.test.ts:61-66`):
```ts
it("verifies PART_SIZE_BYTES is exactly 19 MiB", () => {
  expect(PART_SIZE_BYTES).toBe(19 * 1024 * 1024);
  expect(PART_SIZE_BYTES).toBe(19922944);
  expect(PART_SIZE_BYTES).toBeLessThan(20 * 1024 * 1024);
});
```

### 3.3 Part Calculation Matrix

| File Size | Total Bytes | Part Count | Part Breakdown |
| :--- | :--- | :--- | :--- |
| **1 byte** | 1 | 1 | Part 1: 1 byte |
| **10 MB** | 10,485,760 | 1 | Part 1: 10,485,760 bytes |
| **19 MiB (Exact limit)** | 19,922,944 | 1 | Part 1: 19,922,944 bytes |
| **19 MiB + 1 byte** | 19,922,945 | 2 | Part 1: 19,922,944 bytes; Part 2: 1 byte |
| **45 MB** | 47,185,920 | 3 | Part 1: 19,922,944; Part 2: 19,922,944; Part 3: 7,340,032 |
| **100 MB** | 104,857,600 | 6 | 5 parts of 19,922,944; Part 6: 5,242,880 |
| **200 MB (Hard cap)** | 209,715,200 | 11 | 10 parts of 19,922,944; Part 11: 10,485,760 |

### 3.4 Upload Workflow & Session Management Architecture

To meet R3 and Section 4 of the project specifications:

1. **Client-side slicing**:
   - Browser uses standard `File.slice(start, end)` to create slices of `PART_SIZE_BYTES`.
   - Sends parts sequentially: `POST /api/admin/upload/part`.
   - Payload: `FormData` with fields: `uploadId`, `partNo`, `totalParts`, `chunk`, file metadata.
   - Retries up to 3 times on client side if a part fails.

2. **Server-side Session Tracker (`src/lib/upload-session.ts` to be built)**:
   - In-memory map of active sessions: `Map<string, UploadSession>`.
   - Session fields:
     - `uploadId`: string (UUID)
     - `fileMetadata`: `{ class, subject, chapterNo, title, kind, teacherName, mime, expectedTotalBytes, totalParts }`
     - `receivedParts`: number
     - `incrementalHasher`: `crypto.Hash` (SHA-256 updating as parts arrive)
     - `uploadedTgParts`: `Array<{ partNo: number; tgFileId: string; tgFileUniqueId: string; tgMessageId: number; sizeBytes: number; sha256: string }>`
     - `createdAt`: number
     - `lastActive`: number (expires after 30 minutes)
   - Expiration cleaner: `setInterval` runs every 5 minutes; cleans up abandoned sessions older than 30 minutes AND automatically deletes any orphan Telegram messages already sent for that session.

3. **Validation & Memory Discipline**:
   - Out-of-order check: `partNo` must equal `session.receivedParts + 1`. If not, reject with 400.
   - Size check: `chunk.length <= PART_SIZE_BYTES`. If oversized, reject with 400.
   - Memory discipline: Server holds at most ONE chunk in memory at a time; immediately forwards it to Telegram `sendDocument`, updates incremental hash, then releases chunk buffer.
   - Never writes any chunk to local disk.

4. **Magic Byte Validation**:
   - **Part 1**:
     - PDF: Verify first bytes start with `%PDF-` (`0x25 0x50 0x44 0x46 0x2D`).
     - PPTX: Verify first 4 bytes match ZIP local file header `PK\x03\x04` (`0x50 0x4B 0x03 0x04`).
   - **Final Part**:
     - PDF: Scan backwards within last 1024 bytes of the final part to locate `%%EOF`.
     - PPTX: Scan backwards for ZIP End of Central Directory (`PK\x05\x06`), verify Central Directory entries confirm presence of `[Content_Types].xml` and `ppt/presentation.xml`, and assert uncompressed entry sizes do not exceed safe thresholds (zip-bomb guard).

5. **Completion & Database Commit**:
   - Client calls `POST /api/admin/upload/complete`.
   - Validates that `session.receivedParts === session.totalParts`.
   - Computes final whole-file SHA-256 from `incrementalHasher`.
   - Verifies duplicate file does not already exist: `(chapter_id, sha256)` in `files`.
   - Auto-creates chapter in `chapters` table if not exists.
   - Inserts record into `files`, then inserts records into `file_parts`.
   - If database insertion throws an error: Trigger **Rollback** (see Section 5.3).

---

## 4. Environment Variables Survey

### 4.1 Required Telegram Environment Variables

Defined in `src/lib/validate.ts`:
```ts
TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
TELEGRAM_CHANNEL_ID: z.string().min(1, "TELEGRAM_CHANNEL_ID is required"),
MAX_FILE_MB: z.coerce.number().int().min(1).max(200).default(100),
```

### 4.2 Security & Protection Status

1. **`.env.local` status**:
   - Present on local filesystem.
   - Ignored by git in `.gitignore:21`: `.env*.local`.
   - Verified that `.env.example` has blank placeholders.
2. **Secret Redaction**:
   - `src/lib/logger.ts` redacts `TELEGRAM_BOT_TOKEN`, `*.TELEGRAM_BOT_TOKEN`, `*.token`.
   - `src/lib/telegram.ts` replaces bot token occurrences in errors with `[REDACTED_BOT_TOKEN]`.
   - Health route (`src/app/api/health/route.ts`) exposes only `status` and `bot.username`, never credentials.
3. **Preflight Status**:
   - Running `npm run preflight` executes cleanly with exit code 0.
   - Verified live bot: `@sst_library_nilot_bot` (ID: `8603258167`).
   - Verified live channel permissions: Post and Delete test messages succeed.

---

## 5. Rate Limits, Size Limits, Network Timeouts, & Rollback Architecture

### 5.1 Telegram Bot API Rate Limits & Mitigation

| Endpoint / Operation | Telegram Limit | Library Strategy |
| :--- | :--- | :--- |
| **Channel posting** | ~20 messages/min (~1 msg/sec) | Global upload lock prevents concurrent file uploads. Parts are sent sequentially. |
| **Global bot limit** | 30 requests/second | Well within limits for single-admin architecture. |
| **HTTP 429 response** | Returns `parameters.retry_after` | `TelegramClient.request` detects 429, extracts `retry_after`, logs warning, and throws. Upper layer should sleep `retry_after * 1000 ms` and retry. |

### 5.2 Network Timeout Considerations

- **Current Implementation**:
  `src/lib/telegram.ts:76`:
  ```ts
  const timeoutMs = 15000; // 15 seconds
  const controller = new AbortController();
  ```
- **Risk Analysis**:
  - Uploading a 19 MiB part over 15 seconds requires an upload speed of at least 1.33 MB/s (10.6 Mbps).
  - If the server has a slower uplink or Telegram API experiences temporary latency, a 15-second timeout will cause false failures.
  - Downloading a 19 MiB part from `api.telegram.org` over 15 seconds also risks timeouts on congested networks.
- **Recommendation**:
  - Parameterize `request(endpoint, options, timeoutMs = 15000)`.
  - For `sendDocument` and file downloads, increase `timeoutMs` to **60,000 ms – 120,000 ms** (1–2 minutes).

### 5.3 Rollback & Cleanup Mechanisms

Rollback is critical to maintain consistency between Telegram storage and Supabase database records.

```
       [ Client Upload Process ]
                 |
        Part 1, 2, ... N Upload
                 |
      [ Error on Part K / Abort / Oversized ]
                 |
                 v
   ==============================
   TRIGGER AUTOMATIC ROLLBACK:
   1. Fetch all tg_message_id for current session
   2. Call deleteMessage(channelId, id) for all parts
   3. Evict session from memory
   4. Return error to client
   ==============================
```

```
       [ All N Parts Uploaded OK ]
                 |
                 v
       [ Database Insert Step ]
                 |
      [ DB Failure / Constraint Error ]
                 |
                 v
   ==============================
   TRIGGER DATABASE ROLLBACK:
   1. Roll back DB transaction / delete any inserted rows
   2. Call deleteMessage(channelId, id) for all N parts
   3. Evict session from memory
   4. Return error to client
   ==============================
```

```
       [ Admin Deletes File in Library ]
                 |
                 v
   ==============================
   TRIGGER DELETION WORKFLOW:
   1. Query file_parts for file_id -> retrieve all tg_message_id
   2. For each message_id: call deleteMessage(channelId, id)
   3. Delete files row (CASCADE deletes file_parts)
   4. Return success
   ==============================
```

---

## 6. Implementation Checklist for Subsequent Work

To implement Phase 1 Telegram & Chunking Storage:

1. **Extend `src/lib/telegram.ts`**:
   - Add `sendDocument(channelId, buffer, filename, caption, mime, timeoutMs?)`.
   - Add `getFile(fileId)`.
   - Add in-memory 45-min cache for `file_path`.
   - Add `downloadFile(filePath, timeoutMs?)`.
   - Implement global upload lock (e.g. mutex).
2. **Create `scripts/smoke-telegram.ts`**:
   - Handle both `npm run smoke:telegram` (tiny PDF roundtrip) and `npm run smoke:telegram -- --big` (45 MB 3-part roundtrip).
   - Use deterministic cleanup so no orphaned messages remain in the channel.
3. **Build Upload Session Tracker (`src/lib/upload-session.ts`)**:
   - Session store with 30-min TTL and automatic Telegram message cleanup on eviction.
   - Part validation (out-of-order, size <= 19 MiB).
   - Magic byte verification on Part 1 and final part.
4. **Implement Admin Upload Endpoints**:
   - `POST /api/admin/upload/part`
   - `POST /api/admin/upload/complete`
5. **Implement Admin File Deletion Endpoint**:
   - `DELETE /api/admin/files/[id]` (deletes Telegram messages and database rows).

---
*Report prepared by Explorer 2 (Telegram & Chunking Storage Survey).*
