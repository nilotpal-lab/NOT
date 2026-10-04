# Milestone M3: Specification Mining Analysis
**Chunking, Upload Session, Rollback & Unit Test Specifications**

## 1. Executive Summary & Authoritative Specification Sources
This specification defines the exact requirements, mathematical boundary invariants, interface contracts, error handling mechanisms, and unit test criteria for **Milestone M3 (Chunked Multi-Part Telegram Upload Engine)** of the SST Chapter Library.

### Authoritative Specification Sources:
1. **`ORIGINAL_REQUEST.md` § R3 & Acceptance Criteria**:
   - Client/server chunk slicing ceiling: $\le 19\text{ MiB}$ (`PART_SIZE_BYTES = 19 * 1024 * 1024 = 19922944` bytes).
   - Sequential upload API (`/api/admin/upload/part` & `/api/admin/upload/complete`).
   - In-memory session tracking with 30-minute TTL.
   - Out-of-order, duplicate, or oversized parts (> 19 MiB) rejected.
   - Streaming incremental SHA-256 computation across sequential chunks.
   - Forward parts sequentially to Telegram channel; hold at most one part in memory per request; global upload lock.
   - Automatic Rollback: If any part fails or database insertion fails, delete all Telegram messages already sent for that file and write nothing to the database.
   - Chapter auto-creation in `chapters` table if not already present.
   - Duplicate files (same chapter + sha256) rejected with friendly message.
   - Acceptance Criteria: File splitting unit tests verify sizes (1 byte, exactly 19 MiB, 19 MiB + 1 byte, 45 MB, 100 MB) produce correct part counts $\le 19\text{ MiB}$ and reassemble to identical SHA-256; Mocked upload unit tests verify that failure on part 3 of 5 deletes parts 1 and 2 and leaves no database rows.
2. **`PROJECT.md` § Architecture, Feature Inventory & Interface Contracts**:
   - Features 11–16: Telegram Client Expansion, Slicing & Part Validation, Upload Session Management, Sequential Telegram Forwarding, Telegram & DB Rollback, Chapter Auto-Creation & Dedup.
   - Unit test files: `tests/unit/chunking.test.ts` and `tests/unit/rollback.test.ts`.
3. **Database Schema (`supabase/schema.sql`)**:
   - `chapters` table constraints: `class smallint check (class between 6 and 10)`, `subject text check in ('History','Geography','Civics','Economics','SocialScience')`, `chapter_no smallint check (chapter_no between 1 and 99)`, `title text check (length(title) between 2 and 200)`, `unique (class, subject, chapter_no)`.
   - `files` table constraints: `unique (chapter_id, sha256)`, `unique (file_name)`, `size_bytes bigint check (size_bytes > 0 and size_bytes <= 209715200)`.
   - `file_parts` table constraints: `primary key (file_id, part_no)`, `size_bytes integer check (size_bytes > 0 and size_bytes <= 19922944)`.
4. **Existing Test Framework**:
   - `tests/tier1-feature/chunking.test.ts`
   - `tests/tier2-boundary/boundary.test.ts`
   - `tests/tier3-combination/combination.test.ts`
   - `tests/helpers/mock-telegram.ts`
   - `tests/helpers/mock-db.ts`

---

## Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Slicing & Chunking | Pure Slicing (`sliceBuffer`) | Slices an arbitrary byte buffer into chunks strictly $\le 19\text{ MiB}$ (`19922944` bytes) | `buffer: Buffer`, `partSizeBytes?: number` | `Buffer[]` (array of chunk buffers) | Throws on negative chunk size; returns `[]` on 0-byte input | `ORIGINAL_REQUEST.md` R3, `tests/tier1-feature/chunking.test.ts` |
| 2 | Slicing & Chunking | Part Count Calculation | Calculates exact number of parts: `Math.ceil(totalBytes / PART_SIZE_BYTES)` | `totalBytes: number`, `partSizeBytes?: number` | `number` (integer part count) | Throws if `totalBytes <= 0` or `totalBytes > 200 MiB` | `ORIGINAL_REQUEST.md` R3, `supabase/schema.sql` |
| 3 | Slicing & Chunking | Chunk Ceiling Enforcement | Validates individual uploaded chunk does not exceed `19922944` bytes | `chunk: Buffer \| Uint8Array` | `boolean` (valid) | Throws `Part X exceeds maximum chunk size of 19 MiB` | `ORIGINAL_REQUEST.md` R3, `tests/tier1-feature/chunking.test.ts` |
| 4 | Slicing & Chunking | Byte-Identical Reassembly | Reassembling ordered chunks reproduces the original buffer byte-for-byte | `parts: Buffer[]` | `Buffer` (concatenated buffer) | Invariant: `Buffer.concat(parts).equals(original)` | `ORIGINAL_REQUEST.md` AC, `tests/tier2-boundary/boundary.test.ts` |
| 5 | Slicing & Chunking | Cryptographic SHA-256 Fidelity | Hash of reassembled parts matches original file single-shot SHA-256 | `parts: Buffer[]`, `originalSha: string` | `boolean` | Invariant: `sha256(concat(parts)) === originalSha` | `ORIGINAL_REQUEST.md` AC, `tests/tier2-boundary/boundary.test.ts` |
| 6 | Slicing & Chunking | Incremental Streaming SHA-256 | Computes global SHA-256 iteratively chunk-by-chunk using `crypto.createHash("sha256").update(part)` without loading full file into memory | `part: Buffer` fed into `hash.update(part)` | Hex digest string on complete | Invariant: final digest matches single-shot digest of unchunked file | `ORIGINAL_REQUEST.md` R3, `tests/tier1-feature/chunking.test.ts` |
| 7 | Session Tracking | Upload Session Lifecycle | Tracks in-memory state: `uploadId`, `expectedTotalParts`, `receivedParts`, `hashStream`, `uploadedMessages`, `createdAt` | `uploadId: string`, `expectedTotalParts: number` | `UploadSession` object | Throws if duplicate `uploadId` or invalid part count ($< 1$) | `ORIGINAL_REQUEST.md` R3, `PROJECT.md` § Feature 13 |
| 8 | Session Tracking | Session Expiration (30m TTL) | Rejects part uploads and completion if elapsed time exceeds 30 minutes ($1,800,000\text{ ms}$) | `uploadId: string`, current time | Error thrown, session pruned | Throws `Upload session expired (30m TTL)` | `ORIGINAL_REQUEST.md` R3, `tests/tier1-feature/chunking.test.ts` |
| 9 | Sequential Forwarding | Strict Part In-Order Validation | Enforces parts arrive sequentially: `partNo === receivedParts.length + 1` | `partNo: number`, current session | Validates part order | Throws `Out of order part: expected X, received Y` | `ORIGINAL_REQUEST.md` R3, `tests/tier1-feature/chunking.test.ts` |
| 10 | Sequential Forwarding | Duplicate Part Rejection | Rejects re-submission of an already-received part number | `partNo: number` (already in `receivedParts`) | Error thrown | Throws `Out of order part: expected X, received Y` | `ORIGINAL_REQUEST.md` R3, `tests/tier1-feature/chunking.test.ts` |
| 11 | Telegram Integration | Telegram `sendDocument` | Multipart POST to `api.telegram.org/bot<token>/sendDocument` with custom caption and extended 120s timeout | `channelId`, `buffer`, `fileName`, `caption?`, `timeoutMs?` | `{ messageId, fileId, fileUniqueId }` | Catches network/API error, sanitizes token from error string | `PROJECT.md` § Feature 11, `scripts/smoke-telegram.ts` |
| 12 | Telegram Integration | Telegram `getFile` & `downloadFile` | Resolves file path from `file_id` and streams back file bytes | `fileId: string`, `filePath: string` | `{ filePath, fileSize }`, `Buffer` | Throws sanitized error if Telegram returns not-found or HTTP error | `PROJECT.md` § Feature 11, `scripts/smoke-telegram.ts` |
| 13 | Telegram Integration | Telegram `deleteMessage` | Sends POST to `deleteMessage` to delete a specific message ID in storage channel | `channelId`, `messageId: number` | `boolean` (success) | Returns `false` or handles error without crashing caller | `PROJECT.md` § Feature 11, `src/lib/telegram.ts` |
| 14 | Rollback Engine | Mid-Flight Part Failure Rollback | If Telegram send fails on part $K$ ($K > 1$), automatically invokes `deleteMessage` on parts $1 \dots K-1$ and purges session | Part failure event (e.g. part 3 of 5) | All previously uploaded Telegram messages deleted | Throws original error; session cleared; 0 DB rows inserted | `ORIGINAL_REQUEST.md` R3 & AC, `tests/tier1-feature/chunking.test.ts` |
| 15 | Rollback Engine | Database Failure Rollback | If database insert fails during `completeUpload`, automatically invokes `deleteMessage` on all uploaded parts and purges session | DB error during `completeUpload` | All $N$ Telegram messages deleted | Throws DB error; session cleared; 0 partial DB rows left | `ORIGINAL_REQUEST.md` R3, `tests/tier1-feature/chunking.test.ts` |
| 16 | Rollback Engine | Duplicate Hash Rollback | If file SHA-256 collides with existing file in chapter (`(chapter_id, sha256)`), newly uploaded Telegram parts are deleted | Complete payload with colliding hash | All newly uploaded Telegram messages deleted | Throws friendly error: `Duplicate file: identical sha256 already exists in this chapter` | `ORIGINAL_REQUEST.md` R3, `tests/tier3-combination/combination.test.ts` |
| 17 | Rollback Engine | Incomplete Upload Rollback | If `completeUpload` called before all parts are uploaded (`receivedParts.length !== expectedTotalParts`), cleans up sent parts | Premature `completeUpload` call | Telegram parts deleted, session purged | Throws `Incomplete upload: received X of Y parts` | `ORIGINAL_REQUEST.md` R3, `tests/tier1-feature/chunking.test.ts` |
| 18 | Chapter Auto-Creation | Idempotent Chapter Find/Create | Looks up existing chapter by `(class, subject, chapter_no)`; if absent, creates new chapter row | `class: number`, `subject: string`, `chapterNo: number`, `title: string` | `Chapter` object | Throws validation error if class $< 6$ or $> 10$, invalid subject, or title length $< 2$ | `ORIGINAL_REQUEST.md` R3, `supabase/schema.sql`, `tests/helpers/mock-db.ts` |
| 19 | Duplicate Detection | Chapter + Hash Uniqueness Check | Enforces database uniqueness on `(chapter_id, sha256)` per `supabase/schema.sql` | `chapter_id: string`, `sha256: string` | `boolean` | Rejects duplicate file upload with user-friendly error message | `ORIGINAL_REQUEST.md` R3, `supabase/schema.sql` |
| 20 | Concurrency Control | Single-Part Memory Hold & Lock | Holds at most one chunk buffer in Node.js process memory per request; serialize part uploads per session | Single chunk buffer in request | Buffer garbage-collected after Telegram forwarding | Prevents memory exhaustion or out-of-order race conditions | `ORIGINAL_REQUEST.md` R3, `PROJECT.md` § Feature 14 |
| 21 | PPTX Accompaniment | Accompaniment Validation during Complete | Validates PPTX upload has accompanying PDF preview export (`parent_file_id` link) | `kind: "ppt"`, preview metadata | Validation result | Rejects with validation error and rolls back Telegram parts if preview missing | `ORIGINAL_REQUEST.md` R2, `tests/tier3-combination/combination.test.ts` |
| 22 | Telegram Caption | Machine-Readable Caption Formatting | Formats pipe-delimited caption: `title=...\|class=...\|subject=...\|ch=...\|kind=...\|name=...\|sha=...\|part=n/total` | Metadata object | Caption string $\le 1024$ chars | Truncates or formats strictly according to `formatTelegramCaption` | `ORIGINAL_REQUEST.md` R2, `src/lib/naming.ts` |

---

## Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | Slicing & Chunking | 1 byte buffer (`Buffer.from([0x7f])`) | Slices into exactly 1 part of length 1 byte; part $\le 19\text{ MiB}$; reassembled length 1 byte; SHA-256 matches original |
| 2 | Slicing & Chunking | Exactly 19 MiB buffer (`19922944` bytes) | Slices into exactly 1 part of length `19922944` bytes; part $\le 19\text{ MiB}$; reassembles to exact buffer and identical SHA-256 |
| 3 | Slicing & Chunking | Exactly 19 MiB + 1 byte (`19922945` bytes) | Slices into exactly 2 parts: Part 1 = `19922944` bytes, Part 2 = `1` byte; each part $\le 19\text{ MiB}$; reassembles with identical SHA-256 |
| 4 | Slicing & Chunking | Exactly 45 MB buffer (`45 * 1024 * 1024 = 47185920` bytes) | Slices into exactly 3 parts: Part 1 = `19922944` bytes, Part 2 = `19922944` bytes, Part 3 = `7340032` bytes; reassembles with identical SHA-256 |
| 5 | Slicing & Chunking | Exactly 100 MB buffer (`100 * 1024 * 1024 = 104857600` bytes) | Slices into exactly 6 parts: Parts 1–5 = `19922944` bytes each, Part 6 = `5242880` bytes; all $\le 19\text{ MiB}$; reassembles with identical SHA-256 |
| 6 | Slicing & Chunking | Empty buffer (0 bytes) | `sliceBuffer` returns empty array `[]`; upload session creation or uploadPart with 0 bytes is rejected with validation error |
| 7 | Slicing & Chunking | Oversized chunk (`19922945` bytes passed to `uploadPart`) | Rejected immediately with error `Part X exceeds maximum chunk size of 19 MiB (19922945 > 19922944)` without sending to Telegram |
| 8 | Slicing & Chunking | File exceeding MAX_FILE_MB (> 100 MB or > 200 MB hard limit) | Rejected with error indicating file exceeds maximum permitted upload limit (200 MiB DB constraint) |
| 9 | Upload Ordering | Out-of-order part: Part 2 submitted before Part 1 | Rejected immediately with `Out of order part: expected 1, received 2`; no message sent to Telegram |
| 10 | Upload Ordering | Duplicate part submission: Part 1 submitted twice | First submission succeeds (stored message ID); second submission rejected with `Out of order part: expected 2, received 1` |
| 11 | Upload Ordering | Skipped part: Part 1 succeeds, Part 3 submitted | Rejected with `Out of order part: expected 2, received 3` |
| 12 | Session Lifecycle | Part upload submitted at 30 minutes + 1 second | Rejected with `Upload session expired (30m TTL)`; session deleted from memory; rollback triggered if dangling messages |
| 13 | Session Lifecycle | Unknown / non-existent `uploadId` | Rejected with `Upload session not found or expired` |
| 14 | Rollback Engine | Failure on Part 1 of 5 (Telegram network timeout) | No messages were successfully created; rollback handler runs without error; 0 messages deleted; session cleared; 0 DB rows |
| 15 | Rollback Engine | Failure on Part 3 of 5 (Parts 1 & 2 succeeded) | Part 3 throws error; rollback calls `deleteMessage` for part 1 ID and part 2 ID; session cleared; 0 DB rows in `files` or `file_parts` |
| 16 | Rollback Engine | Failure on Part 5 of 5 (Parts 1–4 succeeded) | Part 5 throws error; rollback calls `deleteMessage` for parts 1, 2, 3, 4 IDs; session cleared; 0 DB rows |
| 17 | Rollback Engine | Database error on `completeUpload` (all 5 parts sent) | DB insert throws error; rollback calls `deleteMessage` on all 5 part IDs; session cleared; 0 rows remain in database |
| 18 | Rollback Engine | Duplicate hash collision on `completeUpload` | DB find or constraint detects identical `(chapter_id, sha256)`; rollback deletes all newly sent Telegram parts; existing DB row unchanged; 0 new rows |
| 19 | Rollback Engine | Premature `completeUpload` call (only 2 of 5 parts sent) | Throws `Incomplete upload: received 2 of 5 parts`; rolls back parts 1 and 2; session deleted |
| 20 | Chapter Auto-Create | New chapter: Class 9, Economics, Chapter 1 ("Village Palampur") | No matching row exists; creates new row in `chapters` with generated UUID and returns it |
| 21 | Chapter Auto-Create | Existing chapter: Class 9, Economics, Chapter 1 | Matching row already exists; returns existing chapter row without creating duplicate |
| 22 | Chapter Auto-Create | Invalid class number (Class 5 or Class 11) | Rejected by check constraint `class between 6 and 10` |
| 23 | Chapter Auto-Create | Invalid subject ('Physics' or 'Math') | Rejected by check constraint `subject in ('History','Geography','Civics','Economics','SocialScience')` |
| 24 | Chapter Auto-Create | Invalid chapter number (0 or 100) | Rejected by check constraint `chapter_no between 1 and 99` |
| 25 | Chapter Auto-Create | Title too short (< 2 chars) or too long (> 200 chars) | Rejected by check constraint `length(title) between 2 and 200` |
| 26 | Duplicate Detection | Same file uploaded twice to same chapter | Second upload rejected with friendly error `Duplicate file: identical sha256 already exists in this chapter`; second upload Telegram parts deleted |
| 27 | Duplicate Detection | Same file uploaded to two different chapters | Allowed: `(chapter_id, sha256)` is unique per chapter, so different chapter permits identical file |
| 28 | PPTX Accompaniment | PPTX upload completed without linked `ppt_pdf` row | Rejected with `PPTX files require an accompanying PDF preview export`; all uploaded PPTX Telegram parts rolled back |

---

## 3. Unit Test Specifications

### 3.1 `tests/unit/chunking.test.ts` Specification
File path: `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\tests\unit\chunking.test.ts`
Purpose: Exhaustively verify the file splitting engine, chunk sizing rules, cryptographic SHA-256 fidelity, and stream hashing.

#### Required Test Cases:
1. **Test C1.1: 1-Byte File Slicing**
   - **Input**: `Buffer.from([0x42])` (length = 1)
   - **Assertions**:
     - `parts.length === 1`
     - `parts[0].length === 1`
     - `parts[0].length <= PART_SIZE_BYTES` (`19922944`)
     - `Buffer.concat(parts).equals(original)`
     - `sha256(Buffer.concat(parts)) === sha256(original)`
2. **Test C1.2: Exactly 19 MiB File Slicing**
   - **Input**: Deterministic buffer of size `19 * 1024 * 1024` bytes (`19922944` bytes)
   - **Assertions**:
     - `parts.length === 1`
     - `parts[0].length === 19922944`
     - `parts[0].length <= PART_SIZE_BYTES`
     - `Buffer.concat(parts).equals(original)`
     - `sha256(Buffer.concat(parts)) === sha256(original)`
3. **Test C1.3: Exactly 19 MiB + 1 Byte File Slicing**
   - **Input**: Deterministic buffer of size `19 * 1024 * 1024 + 1` bytes (`19922945` bytes)
   - **Assertions**:
     - `parts.length === 2`
     - `parts[0].length === 19922944`
     - `parts[1].length === 1`
     - `parts[0].length <= PART_SIZE_BYTES`
     - `parts[1].length <= PART_SIZE_BYTES`
     - `Buffer.concat(parts).equals(original)`
     - `sha256(Buffer.concat(parts)) === sha256(original)`
4. **Test C1.4: 45 MB File Slicing (Smoke Test Size)**
   - **Input**: Deterministic buffer of size `45 * 1024 * 1024` bytes (`47185920` bytes)
   - **Assertions**:
     - `parts.length === 3`
     - `parts[0].length === 19922944`
     - `parts[1].length === 19922944`
     - `parts[2].length === 47185920 - 2 * 19922944` (`7340032` bytes)
     - For every part $p \in \text{parts}$, `p.length <= PART_SIZE_BYTES`
     - `Buffer.concat(parts).equals(original)`
     - `sha256(Buffer.concat(parts)) === sha256(original)`
5. **Test C1.5: 100 MB File Slicing (`MAX_FILE_MB` Default Ceiling)**
   - **Input**: Deterministic buffer of size `100 * 1024 * 1024` bytes (`104857600` bytes)
   - **Assertions**:
     - `parts.length === 6`
     - `parts[0..4]` each have length `19922944`
     - `parts[5].length === 104857600 - 5 * 19922944` (`5242880` bytes)
     - For every part $p \in \text{parts}$, `p.length <= PART_SIZE_BYTES`
     - `Buffer.concat(parts).equals(original)`
     - `sha256(Buffer.concat(parts)) === sha256(original)`
6. **Test C1.6: Streaming Incremental SHA-256 vs Single-Shot Digest**
   - **Input**: Multi-part file (e.g. 25 MB = 2 parts: 19 MiB + 6 MiB)
   - **Execution**: Create `crypto.createHash("sha256")`. For each slice, call `hash.update(slice)`. Finally, call `hash.digest("hex")`.
   - **Assertion**: Streaming digest equals single-shot `crypto.createHash("sha256").update(fullBuffer).digest("hex")`.
7. **Test C1.7: Empty Buffer (0 Bytes) Edge Case**
   - **Input**: `Buffer.alloc(0)`
   - **Assertion**: `sliceBuffer(Buffer.alloc(0))` returns `[]`.
8. **Test C1.8: Part Ceiling Calculation Function**
   - **Input**: Various sizes (`1`, `19922944`, `19922945`, `47185920`, `104857600`)
   - **Assertion**: Returns exact expected part counts (`1, 1, 2, 3, 6`).
9. **Test C1.9: Oversized Part Validation Rejection**
   - **Input**: Chunk of `19922945` bytes (`PART_SIZE_BYTES + 1`)
   - **Assertion**: Throws descriptive error `exceeds maximum chunk size of 19 MiB`.

---

### 3.2 `tests/unit/rollback.test.ts` Specification
File path: `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\tests\unit\rollback.test.ts`
Purpose: Exhaustively test the upload rollback mechanism using mocked Telegram client and mock database.

#### Required Test Cases:
1. **Test R1.1: Part 3 of 5 Network Failure Rollback (Mandatory Dispatch Test)**
   - **Setup**:
     - Create upload session with `expectedTotalParts = 5`.
     - Configure `MockTelegramClient` with `failOnPartNumber = 3`.
     - Send Part 1: succeeds, returns `messageId: 1001`.
     - Send Part 2: succeeds, returns `messageId: 1002`.
     - Send Part 3: throws simulated Telegram network error.
   - **Assertions**:
     - Exception thrown by `uploadPart`.
     - `mockTg.deleteMessage` was called for Part 1 (`messageId: 1001`).
     - `mockTg.deleteMessage` was called for Part 2 (`messageId: 1002`).
     - `mockTg.deletedMessageIds` contains `[1001, 1002]`.
     - Session state is cleared from memory.
     - Zero records in database (`mockDb.files.length === 0`, `mockDb.fileParts.length === 0`).
2. **Test R1.2: Complete Endpoint Database Error Rollback (Mandatory Dispatch Test)**
   - **Setup**:
     - Create upload session with `expectedTotalParts = 5`.
     - Upload Part 1 through Part 5 successfully (`messageIds: 1001, 1002, 1003, 1004, 1005`).
     - Configure `mockTg.failOnDbInsert = true` (or simulate DB constraint/network failure during `completeUpload`).
     - Invoke `completeUpload`.
   - **Assertions**:
     - Exception thrown by `completeUpload`.
     - `mockTg.deleteMessage` was called for ALL 5 parts (`[1001, 1002, 1003, 1004, 1005]`).
     - Session state is cleared from memory.
     - Zero partial records in database (`mockDb.files.length === 0`, `mockDb.fileParts.length === 0`).
3. **Test R1.3: Failure on Part 1 of 5 (Zero Prior Telegram Messages)**
   - **Setup**:
     - Session with 5 parts.
     - Configure `mockTg.failOnPartNumber = 1`.
     - Send Part 1: fails immediately.
   - **Assertions**:
     - Exception thrown.
     - `mockTg.deletedMessageIds.length === 0` (no prior messages existed to delete).
     - Session state cleared.
     - Zero database records.
4. **Test R1.4: Failure on Final Part (Part 5 of 5)**
   - **Setup**:
     - Session with 5 parts.
     - Parts 1, 2, 3, 4 succeed (`messageIds: 1001..1004`).
     - Part 5 fails.
   - **Assertions**:
     - Exception thrown.
     - Messages `1001, 1002, 1003, 1004` are deleted via `deleteMessage`.
     - Session state cleared.
     - Zero database records.
5. **Test R1.5: Out-of-Order Part Rejection & State Preservation**
   - **Setup**:
     - Session with 3 parts.
     - Part 2 uploaded before Part 1.
   - **Assertions**:
     - Throws `Out of order part: expected 1, received 2`.
     - No Telegram document sent (`mockTg.sentMessages.length === 0`).
6. **Test R1.6: Duplicate Part Submission Rejection**
   - **Setup**:
     - Session with 3 parts.
     - Part 1 uploaded successfully (`messageId: 1001`).
     - Part 1 re-uploaded.
   - **Assertions**:
     - Throws `Out of order part: expected 2, received 1`.
     - Existing Part 1 remains valid in session.
7. **Test R1.7: Expired Upload Session Rejection (30-minute TTL)**
   - **Setup**:
     - Session initialized with creation timestamp $> 30$ minutes in the past (`createdAt = Date.now() - 31 * 60 * 1000`).
     - Attempt to upload part.
   - **Assertions**:
     - Throws `Upload session expired (30m TTL)`.
     - Session purged from memory.
8. **Test R1.8: Incomplete Upload Completion Rejection**
   - **Setup**:
     - Session created with 3 parts.
     - Only Part 1 uploaded (`messageId: 1001`).
     - Attempt to call `completeUpload`.
   - **Assertions**:
     - Throws `Incomplete upload: received 1 of 3 parts`.
     - Rollback deletes Part 1 (`messageId: 1001`).
     - Session purged from memory.
     - Zero database records.

---

### 3.3 Chapter Auto-Creation & Duplicate Detection Specification
File path: Can be integrated in `tests/unit/rollback.test.ts` or co-located in `tests/unit/catalog.test.ts`.

#### Required Test Cases:
1. **Test D1.1: Chapter Auto-Creation on First Upload**
   - Given a file upload for Class 9, Economics, Chapter 1 ("The Story of Village Palampur").
   - When `findOrCreateChapter` is called:
   - If no chapter exists, a new chapter row is created with a new UUID and correct fields (`class: 9, subject: "Economics", chapter_no: 1, title: "The Story of Village Palampur"`).
   - Chapter count increases from 0 to 1.
2. **Test D1.2: Chapter Reuse (Idempotency) on Subsequent Uploads**
   - Given a chapter already exists for Class 9, Economics, Chapter 1.
   - When another file (e.g. Teacher Notes) is uploaded for the same chapter:
   - `findOrCreateChapter` returns the existing chapter ID.
   - Chapter count remains 1 (no duplicate chapter created).
3. **Test D1.3: Duplicate File Detection in Same Chapter Triggers Rollback**
   - Given a file `F1` already inserted for Chapter `C1` with `sha256 = "hash_palampur_abc"`.
   - When a user uploads another file `F2` to Chapter `C1` that produces the same SHA-256 (`"hash_palampur_abc"`):
   - At `completeUpload` (or duplicate check), system detects duplicate `(chapter_id, sha256)`.
   - System throws friendly error: `Duplicate file: identical sha256 already exists in this chapter`.
   - Newly uploaded Telegram parts for `F2` are rolled back via `deleteMessage`.
   - Database retains only original `F1`; `files.length === 1`.
4. **Test D1.4: Identical SHA-256 in Different Chapters is Permitted**
   - Given Chapter 1 (Class 9 Economics) has file with `sha256 = "common_reference_hash"`.
   - When Chapter 2 (Class 10 Economics) uploads a file with the identical hash:
   - Both files are accepted and inserted because `(chapter_id, sha256)` is distinct.
   - `mockDb.files.length === 2`.
5. **Test D1.5: PPTX Accompaniment Enforcement & Rollback**
   - Attempting to complete a PPTX (`kind: "ppt"`) upload without an accompanying PDF preview (`parent_file_id` link):
   - Throws validation error: `PPTX files require an accompanying PDF preview export`.
   - Any uploaded PPTX parts in Telegram are rolled back via `deleteMessage`.

---

## 4. Architectural Interfaces & Implementation Contracts

### 4.1 Chunking Utility Contract (`src/lib/chunking.ts` or `src/lib/upload-session.ts`)
```typescript
import { PART_SIZE_BYTES } from "@/lib/validate";

/**
 * Pure function: slices buffer into parts <= 19 MiB
 */
export function sliceBuffer(buffer: Buffer, partSizeBytes: number = PART_SIZE_BYTES): Buffer[];

/**
 * Pure function: calculates expected total parts
 */
export function calculatePartCount(totalBytes: number, partSizeBytes: number = PART_SIZE_BYTES): number;

/**
 * Validates whether a chunk size is valid
 */
export function validateChunkSize(chunkSizeBytes: number): { valid: boolean; error?: string };
```

### 4.2 Telegram Client Expanded Contract (`src/lib/telegram.ts`)
```typescript
export interface TelegramSendDocumentResult {
  messageId: number;
  fileId: string;
  fileUniqueId: string;
}

export interface TelegramFileResult {
  filePath: string;
  fileSize: number;
}

export class TelegramClient {
  constructor(token: string);

  // Existing methods:
  getMe(): Promise<TelegramUser>;
  postTestMessage(channelId: string | number): Promise<number>;
  deleteMessage(channelId: string | number, messageId: number): Promise<boolean>;
  getUpdates(): Promise<TelegramUpdatesResponse>;

  // Milestone M3 Extended Methods:
  sendDocument(
    channelId: string | number,
    fileBuffer: Buffer | Uint8Array,
    fileName: string,
    caption?: string,
    timeoutMs?: number // default 120,000 ms
  ): Promise<TelegramSendDocumentResult>;

  getFile(
    fileId: string,
    timeoutMs?: number // default 30,000 ms
  ): Promise<TelegramFileResult>;

  downloadFile(
    filePath: string,
    timeoutMs?: number // default 120,000 ms
  ): Promise<Buffer>;
}
```

### 4.3 Upload Session Manager Contract (`src/lib/upload-session.ts`)
```typescript
export interface UploadSessionState {
  uploadId: string;
  expectedTotalParts: number;
  receivedParts: number[];
  hashStream: crypto.Hash;
  uploadedMessages: Array<{
    partNo: number;
    messageId: number;
    fileId: string;
    fileUniqueId: string;
    sizeBytes: number;
    sha256: string;
  }>;
  createdAt: number;
  lastActivityAt: number;
  metadata?: {
    chapterId: string;
    kind: "ncert_pdf" | "ppt" | "ppt_pdf" | "teacher_notes";
    fileName: string;
    sizeBytes: number;
    teacherName?: string;
  };
}

export class UploadSessionManager {
  startSession(uploadId: string, expectedTotalParts: number, metadata?: unknown): void;
  getSession(uploadId: string): UploadSessionState | undefined;
  uploadPart(
    uploadId: string,
    partNo: number,
    partBuffer: Buffer,
    fileName: string
  ): Promise<{ messageId: number; fileId: string }>;
  completeUpload(
    uploadId: string,
    fileMetadata: {
      chapterId: string;
      kind: "ncert_pdf" | "ppt" | "ppt_pdf" | "teacher_notes";
      fileName: string;
      sizeBytes: number;
      teacherName?: string;
      parentFileId?: string;
    }
  ): Promise<FileRecord>;
  rollbackTelegramMessages(messageIds: number[]): Promise<void>;
  cancelSession(uploadId: string): Promise<void>;
}
```

### 4.4 Catalog Service Contract (`src/lib/catalog.ts`)
```typescript
export interface ChapterRecord {
  id: string;
  class: number;
  subject: string;
  chapter_no: number;
  title: string;
  book?: string | null;
  edition?: string | null;
  created_at: string;
}

export interface FileRecord {
  id: string;
  chapter_id: string;
  kind: "ncert_pdf" | "ppt" | "ppt_pdf" | "teacher_notes";
  parent_file_id?: string | null;
  file_name: string;
  teacher_name?: string | null;
  size_bytes: number;
  part_count: number;
  mime: string;
  sha256: string;
  is_published: boolean;
  created_at: string;
}

export function findOrCreateChapter(data: {
  class: number;
  subject: string;
  chapterNo: number;
  title: string;
  book?: string;
  edition?: string;
}): Promise<ChapterRecord>;

export function checkFileDuplicate(
  chapterId: string,
  sha256: string
): Promise<boolean>;

export function insertFileWithParts(
  fileData: Omit<FileRecord, "id" | "created_at">,
  parts: Array<{
    part_no: number;
    tg_file_id: string;
    tg_file_unique_id: string;
    tg_message_id: number;
    size_bytes: number;
    sha256: string;
  }>
): Promise<FileRecord>;
```

---

## 5. Summary of Deliverables & Next Steps for Coder Agent
When implementing Milestone M3:
1. Implement `tests/unit/chunking.test.ts` covering all 9 test cases in Section 3.1.
2. Implement `tests/unit/rollback.test.ts` covering all 8 rollback test cases in Section 3.2 and the chapter dedup tests in Section 3.3.
3. Implement `src/lib/telegram.ts` extended methods (`sendDocument`, `getFile`, `downloadFile`).
4. Implement `src/lib/upload-session.ts` and pure slicing function `src/lib/chunking.ts`.
5. Implement `src/lib/catalog.ts` for database interactions with chapter auto-creation and duplicate detection.
6. Implement API routes `/api/admin/upload/part/route.ts` and `/api/admin/upload/complete/route.ts`.
7. Verify all unit tests and tier tests pass via `npm test`.
