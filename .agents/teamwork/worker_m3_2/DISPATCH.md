## 2026-10-04T13:29:06Z
You are Worker 2 (replacement) for Milestone M3 (Chunked Multi-Part Telegram Upload Engine).
Your identity: teamwork_preview_worker
Your working directory: c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\worker_m3_2
Your parent orchestrator: orchestrator_1 (conversation ID: fb1a83fa-301b-45dd-ba05-a3edc0267f37)

MANDATORY FIRST STEP:
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\ORIGINAL_REQUEST.md in full.
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\orchestrator_1\PROJECT.md.
Read Explorer Analysis Reports (these contain complete drop-in implementations and specifications):
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m3_1\analysis.md
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m3_2\analysis.md
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m3_1\analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

File Ownership:
You exclusively own and may modify or create the following files:
- src/lib/telegram.ts
- src/lib/upload-session.ts
- src/types/database.ts
- src/lib/catalog.ts
- src/app/api/admin/upload/part/route.ts
- src/app/api/admin/upload/complete/route.ts
- tests/unit/chunking.test.ts
- tests/unit/rollback.test.ts

Implementation Requirements:
1. `src/lib/telegram.ts`:
   - Extend `TelegramClient` with:
     - `sendDocument(channelId: string, fileBuffer: Buffer | Uint8Array, fileName: string, caption?: string, timeoutMs?: number)`: multipart/form-data upload using fetch + FormData + Blob, default 60s timeout, handles 429 retry backoff, token redacted on error.
     - `getFile(fileId: string)`: fetches file metadata and file_path, cached in memory with 45-min TTL.
     - `downloadFile(filePath: string, timeoutMs?: number)`: downloads buffer from Telegram.
2. `src/lib/upload-session.ts`:
   - `UploadSessionManager` with:
     - In-memory session tracking, 30-min TTL.
     - Per-session async mutex/lock.
     - Chunk size validation: <= 19 MiB (`PART_SIZE_BYTES = 19922944`). Reject oversized, out-of-order, or duplicate parts.
     - Streaming incremental SHA-256 calculation.
     - Memory discipline: hold at most 1 chunk in memory per request.
     - Rollback helper: iterates over recorded `tg_message_id`s and calls `deleteMessage`.
3. `src/types/database.ts`:
   - TypeScript interfaces for `Chapter`, `FileRecord`, `FilePart`.
4. `src/lib/catalog.ts`:
   - `findOrCreateChapter`: find or insert chapter into `chapters` table.
   - `checkDuplicateFile`: check if `(chapter_id, sha256)` exists in `files`.
   - `insertFileWithParts`: insert into `files` and `file_parts`.
5. `/api/admin/upload/part/route.ts`:
   - Ingests part chunk, validates order and size <= 19 MiB, updates incremental SHA-256, immediately forwards to Telegram with machine-readable caption, records message ID, deletes previous parts on forward failure.
6. `/api/admin/upload/complete/route.ts`:
   - Validates all parts uploaded, verifies final SHA-256, enforces PPTX accompaniment rule, finds or creates chapter, checks duplicate file (triggers rollback and returns 409 Conflict), inserts into `files` and `file_parts`, triggers Telegram rollback on DB error.
7. `tests/unit/chunking.test.ts`:
   - Tests file splitting sizes: 1 byte, exactly 19 MiB, 19 MiB + 1 byte, 45 MB, 100 MB. All parts <= 19 MiB, correct part counts, identical SHA-256 upon reassembly.
8. `tests/unit/rollback.test.ts`:
   - Unit tests mocking part 3 of 5 failure (verifies parts 1 & 2 deleted via deleteMessage, 0 rows in DB), DB failure on complete (all parts deleted, 0 DB rows), and duplicate rejection rollback.

Verification:
- Run `npm test`
- Run `npm run lint`
Document commands, test counts, and outputs in your handoff report.

Output:
Write changes to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\worker_m3_2\changes.md.
Write handoff to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\worker_m3_2\handoff.md.
Notify parent (fb1a83fa-301b-45dd-ba05-a3edc0267f37) when finished.
