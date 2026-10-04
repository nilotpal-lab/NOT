# Milestone M3 Handoff Report: Specification Mining

## 1. Observation
- **Dispatch Assignment**:
  - `DISPATCH.md` instructs the agent:
    > "Mine and document all precise requirements, edge cases, and unit test criteria for Milestone M3:
    > 1. File splitting & SHA-256 tests (`tests/unit/chunking.test.ts`):
    >    - Sizes to verify: 1 byte (1 part), exactly 19 MiB (1 part), 19 MiB + 1 byte (2 parts), 45 MB (3 parts), 100 MB (6 parts).
    >    - Invariant: each part <= 19 * 1024 * 1024 bytes (19922944 bytes).
    >    - Invariant: reassembly of parts yields byte-identical buffer and matching SHA-256.
    > 2. Mocked upload rollback tests (`tests/unit/rollback.test.ts`):
    >    - Upload session with 5 parts. Parts 1 and 2 succeed (mock Telegram messages created).
    >    - Part 3 simulated network or Telegram failure.
    >    - Assert: `deleteMessage` called for part 1 and part 2 message IDs.
    >    - Assert: session state cleared, zero records inserted into database.
    >    - Complete failure on complete endpoint (database error simulation): all 5 parts deleted from Telegram, zero partial records.
    > 3. Chapter auto-creation & duplicate detection tests.
    > 4. Write analysis to `spec_miner_m3_1/analysis.md`.
    > 5. Write 5-component handoff to `spec_miner_m3_1/handoff.md`."
- **Authoritative Requirements in `ORIGINAL_REQUEST.md`**:
  - Lines 28–37 (§ R3):
    > "- Slicing: Client slices files into parts of at most 19 MiB (`PART_SIZE_BYTES = 19 * 1024 * 1024`).
    > - Sequential upload API (`/api/admin/upload/part` and `/api/admin/upload/complete`):
    >   - In-memory session tracking (expires after 30 min).
    >   - Out-of-order, duplicate, or oversized parts (> 19 MiB) rejected.
    >   - Incremental SHA-256 computation across stream.
    >   - Forward parts sequentially to Telegram channel; hold at most one part in memory per request; global upload lock.
    > - Automatic Rollback: If any part fails or database insertion fails, delete all Telegram messages already sent for that file and write nothing to the database.
    > - Chapter auto-creation in `chapters` table if not already present. Duplicate files (same chapter + sha256) rejected with friendly message."
  - Lines 58–63 (§ AC):
    > "- Mocked upload unit tests verify that a failure on part 3 of 5 deletes parts 1 and 2 and leaves no database rows.
    > - File splitting unit tests verify sizes (1 byte, exactly 19 MiB, 19 MiB + 1, 45 MB, 100 MB) produce correct part counts <= 19 MiB and reassemble to identical SHA-256."
- **Database Constraints in `supabase/schema.sql`**:
  - Lines 4–13: `chapters` table has `unique (class, subject, chapter_no)`, `class smallint check (class between 6 and 10)`, `chapter_no smallint check (chapter_no between 1 and 99)`, `title text check (length(title) between 2 and 200)`.
  - Lines 17–31: `files` table has `unique (chapter_id, sha256)`, `unique (file_name)`, `size_bytes bigint check (size_bytes > 0 and size_bytes <= 209715200)`.
  - Lines 36–45: `file_parts` table has `primary key (file_id, part_no)`, `size_bytes integer check (size_bytes > 0 and size_bytes <= 19922944)`.
- **Existing Test Suites & Mocks**:
  - `tests/tier1-feature/chunking.test.ts` (lines 1–334): Implements simulator test cases for slicing and rollback.
  - `tests/tier2-boundary/boundary.test.ts` (lines 101–185): Implements exact boundary splitting tests for 1B, 19MiB, 19MiB+1, 45MB, and 100MB.
  - `tests/helpers/mock-telegram.ts` (lines 1–98): Contains `MockTelegramClient` with `sendDocument`, `getFile`, `downloadFile`, `deleteMessage`, and test hooks `failOnPartNumber` and `failOnDbInsert`.
  - `tests/helpers/mock-db.ts` (lines 1–169): Contains `MockDatabase` with `findOrCreateChapter`, `insertFile`, and `unique (chapter_id, sha256)` enforcement.
  - Tool execution `npm test`: Exited with code 0; 12 test files passed, 164 tests passed. Neither `tests/unit/chunking.test.ts` nor `tests/unit/rollback.test.ts` exists yet in `tests/unit/`.

## 2. Logic Chain
1. From `ORIGINAL_REQUEST.md` § R3 and `PROJECT.md` Feature 12, files must be partitioned into chunks no larger than $19\text{ MiB} = 19 \times 1024 \times 1024 = 19,922,944\text{ bytes}$ (`PART_SIZE_BYTES`).
2. Slicing an $N$-byte buffer produces $\lceil N / \text{PART\_SIZE\_BYTES} \rceil$ chunks.
   - For 1 byte: $\lceil 1 / 19922944 \rceil = 1$ part of 1 byte.
   - For exactly 19 MiB (`19922944` bytes): $\lceil 19922944 / 19922944 \rceil = 1$ part of $19,922,944$ bytes.
   - For 19 MiB + 1 byte (`19922945` bytes): $\lceil 19922945 / 19922944 \rceil = 2$ parts (Part 1 = $19,922,944$ bytes, Part 2 = $1$ byte).
   - For 45 MB ($47,185,920$ bytes): $\lceil 47185920 / 19922944 \rceil = 3$ parts (Parts 1 & 2 = $19,922,944$ bytes, Part 3 = $7,340,032$ bytes).
   - For 100 MB ($104,857,600$ bytes): $\lceil 104857600 / 19922944 \rceil = 6$ parts (Parts 1–5 = $19,922,944$ bytes, Part 6 = $5,242,880$ bytes).
3. The cryptographic and reassembly invariants require:
   - Every chunk must satisfy `chunk.length <= 19922944`.
   - `Buffer.concat(parts)` must be byte-identical to the original buffer (`equals()` is true).
   - `sha256(Buffer.concat(parts))` must strictly equal `sha256(originalBuffer)`.
   - Streaming hash (`crypto.createHash("sha256").update(part)` for each part) must produce the identical digest upon finalization as single-shot hashing.
4. From `ORIGINAL_REQUEST.md` § R3 and `PROJECT.md` Feature 15:
   - An upload session maintaining 5 parts where Part 3 fails simulates a network disconnect or Telegram API rejection.
   - Because Parts 1 and 2 succeeded and generated Telegram `messageId`s in the storage channel, failing to delete them would leak orphaned documents into private Telegram storage.
   - Therefore, the catch block must invoke `deleteMessage` on Parts 1 and 2, purge session state, and abort database insertion (leaving 0 records in `files` and `file_parts`).
   - Similarly, if all 5 parts succeed in Telegram but the database insertion fails (due to constraint error, connection timeout, or duplicate hash collision), all 5 Telegram messages must be deleted via `deleteMessage` and zero partial rows written to the database.
5. From `ORIGINAL_REQUEST.md` § R3 and `supabase/schema.sql`:
   - Chapter auto-creation must query by `(class, subject, chapter_no)`. If present, reuse existing chapter; if absent, create a new record.
   - Duplicate prevention enforces uniqueness on `(chapter_id, sha256)`. If a collision occurs, reject with a user-friendly error and rollback all newly uploaded Telegram parts.

## 3. Caveats
- No implementation code was written in `src/` or `tests/unit/` (in strict accordance with the read-only mandate for Specification Miners).
- Real Telegram network latency is simulated in unit tests using `MockTelegramClient`; live Telegram execution is tested separately via `scripts/smoke-telegram.ts`.
- `MAX_FILE_MB` defaults to 100 MB per `src/lib/validate.ts`, while the database schema permits up to 200 MiB (`209715200` bytes). Unit tests cover up to 100 MB.

## 4. Conclusion
All requirements, mathematical boundary test vectors, rollback failure modes, and database constraints for Milestone M3 have been fully analyzed and documented in:
`c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m3_1\analysis.md`.

The implementation team can now directly construct:
1. `tests/unit/chunking.test.ts` (9 test cases covering 1B, 19MiB, 19MiB+1, 45MB, 100MB, streaming SHA-256, and ceiling validation).
2. `tests/unit/rollback.test.ts` (8 test cases covering mid-flight Part 3 failure, DB insert failure, final part failure, out-of-order rejection, session TTL, and duplicate collision rollback).
3. `src/lib/chunking.ts` (pure slicing utility).
4. `src/lib/telegram.ts` (expanded client with `sendDocument`, `getFile`, `downloadFile`).
5. `src/lib/upload-session.ts` (session manager with rollback and streaming SHA-256).
6. `src/lib/catalog.ts` (chapter find/create and duplicate check).
7. `src/app/api/admin/upload/part/route.ts` and `src/app/api/admin/upload/complete/route.ts`.

## 5. Verification Method
- Inspect specification document:
  `view_file` on `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m3_1\analysis.md`.
- Validate test execution commands for implementing coder:
  - Run all unit tests: `npm test`
  - Run specific chunking tests: `npx vitest run tests/unit/chunking.test.ts`
  - Run specific rollback tests: `npx vitest run tests/unit/rollback.test.ts`
  - Run tier tests: `npx vitest run tests/tier1-feature/chunking.test.ts tests/tier2-boundary/boundary.test.ts tests/tier3-combination/combination.test.ts`
- Invalidation Conditions:
  - If any test size produces a chunk $> 19,922,944$ bytes.
  - If reassembled buffer SHA-256 does not match original single-shot digest.
  - If a part failure leaves orphaned Telegram messages or partial database rows.
