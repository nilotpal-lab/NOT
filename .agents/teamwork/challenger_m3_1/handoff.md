# Handoff Report — Challenger 1 (Milestone M3: Rollback Adversarial Challenger)

**Agent**: `teamwork_preview_challenger` (Challenger 1, Milestone M3)  
**Date**: 2026-10-04  
**Working Directory**: `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\challenger_m3_1`  
**Parent Orchestrator**: `orchestrator_1` (`fb1a83fa-301b-45dd-ba05-a3edc0267f37`)  
**Verdict**: **`REQUEST_CHANGES`**

---

## 1. Observation

Empirical testing was executed using an adversarial stress test harness across the four required scenarios:
- **Scenario 1**: Mid-upload failure on part 3 of 5.
- **Scenario 2**: Database failure during `/complete`.
- **Scenario 3**: Duplicate collision on `(chapter_id, sha256)`.
- **Scenario 4**: Session timeout rollback (30-minute TTL).

Execution command:
```powershell
npx tsx .agents/teamwork/challenger_m3_1/adversarial_harness.ts
```

### 1.1 Summary of Test Results
- **Scenario 1 (Part 3 of 5 failure)**:
  - Manager Level: `✓ PASS` — parts 1 & 2 deleted from Telegram (`mockTg.deletedMessageIds = [1001, 1002]`), session aborted, 0 DB rows.
  - Route Level (`POST /api/admin/upload/part`): `✓ PASS` — returned HTTP 500 (`"Telegram forward failed, rolled back uploaded parts"`), messages deleted from Telegram channel (`tgDeleted = [2001, 2002]`), session aborted, 0 DB rows.
- **Scenario 2 (Database failure on /complete)**:
  - Manager Level: `✓ PASS` — all 5 parts deleted from Telegram (`mockTg.deletedMessageIds = [1001..1005]`), session aborted, 0 DB rows.
  - Route Level (`POST /api/admin/upload/complete`): `✓ PASS` — returned HTTP 500, all uploaded parts purged from Telegram (`tgDeleted = [2003, 2004]`), session aborted, 0 DB rows.
- **Scenario 3 (Duplicate collision)**:
  - Manager Level: `✓ PASS` — rejects on collision, purges File 2 parts from Telegram, leaves original File 1 intact in DB.
  - Route Level (`POST /api/admin/upload/complete`): `✓ PASS` — returned HTTP 409 Conflict with body:
    ```json
    {
      "error": "Duplicate file: A file with identical content already exists in this chapter",
      "existingFile": {
        "id": "existing-file-uuid",
        "fileName": "Original.pdf"
      }
    }
    ```
    All newly uploaded Telegram parts purged (`tgDeleted = [2005, 2006]`), session aborted.
- **Scenario 4 (Session timeout rollback: 30-min TTL)**:
  - Subtest 4A (`cleanupExpiredSessions()`): `✗ FAIL` — default cleanup purges session from memory but does NOT delete Telegram messages (`p1Deleted: false`).
  - Subtest 4B (`getSession()` on expired session): `✗ FAIL` — deletes session from memory Map but leaves uploaded Telegram parts permanently orphaned in Telegram channel (`p1Deleted: false`).
  - Subtest 4C (`uploadPart()` on expired session): `✗ FAIL` — throws error on expired session but does NOT delete prior parts from Telegram (`p1Deleted: false`).
  - Subtest 4D (`completeUpload()` on expired session): `✗ FAIL` — throws error on expired session but does NOT delete prior parts from Telegram (`p1Deleted: false`).
  - Subtest 4E (Route `POST /api/admin/upload/part` after TTL): `✗ FAIL` — returns HTTP 404 (`"Upload session not found or expired"`), never deletes part 1 (`msgId 2007`), orphaned chunks leaked to Telegram channel.
  - Subtest 4F (Route `POST /api/admin/upload/complete` after TTL): `✗ FAIL` — returns HTTP 404 (`"Upload session not found or expired"`), never deletes parts 1..N (`sentIds [2008, 2009]`), orphaned chunks leaked to Telegram channel.

### 1.2 Verbatim Code Observations

1. **`src/lib/upload-session.ts` (lines 253–263)**:
   ```typescript
   getSession(uploadId: string): UploadSessionData | null {
     const session = this.sessions.get(uploadId);
     if (!session) return null;

     if (Date.now() - session.createdAt > this.sessionTtlMs) {
       this.sessions.delete(uploadId);
       this.locks.delete(uploadId);
       return null;
     }
     return session;
   }
   ```
   *Observation*: When `Date.now() - session.createdAt > this.sessionTtlMs`, `this.sessions.delete(uploadId)` is invoked, dropping the session from memory immediately. It does **not** call `rollbackTelegramMessages`. Any parts that were uploaded before expiration are never deleted from Telegram.

2. **`src/lib/upload-session.ts` (lines 557–577)**:
   ```typescript
   cleanupExpiredSessions(options?: {
     rollback?: boolean;
     tgClient?: TelegramClientLike;
   }): number {
     const now = Date.now();
     let cleaned = 0;

     for (const [uploadId, session] of this.sessions.entries()) {
       if (now - session.createdAt > this.sessionTtlMs) {
         if (options?.rollback && session.uploadedMessageIds.length > 0) {
           this.rollbackTelegramMessages(session.uploadedMessageIds, options.tgClient, session.channelId).catch(
             (err) => logger.warn({ uploadId, err }, "Error during cleanup rollback")
           );
         }
         this.sessions.delete(uploadId);
         this.locks.delete(uploadId);
         cleaned++;
       }
     }
     return cleaned;
   }
   ```
   *Observation*: `options?.rollback` is undefined by default. Calling `cleanupExpiredSessions()` without arguments deletes expired sessions while skipping message rollback entirely. Furthermore, `rollbackTelegramMessages` is an unawaited asynchronous call (`.catch(...)`), risking race conditions and silent unhandled failures.

3. **`src/app/api/admin/upload/part/route.ts` (lines 112–136)**:
   ```typescript
   // 5. Lookup or initialize upload session
   let session = uploadSessionManager.getSession(uploadId);
   if (!session) {
     if (partNo === 1) {
       session = uploadSessionManager.startSession(uploadId, totalParts, { ... });
     } else {
       return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });
     }
   }

   // Check TTL (30 minutes)
   const SESSION_TTL_MS = 30 * 60 * 1000;
   if (Date.now() - session.createdAt > SESSION_TTL_MS) {
     await uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId);
     uploadSessionManager.deleteSession(uploadId);
     return NextResponse.json({ error: "Upload session expired (30m TTL)" }, { status: 410 });
   }
   ```
   *Observation*: Lines 130–136 are **dead code** for any part > 1. When a session expires (> 30 minutes), line 112 (`uploadSessionManager.getSession(uploadId)`) deletes the session and returns `null`. Line 125 then executes immediately:
   `return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });`
   Lines 131–135 are unreachable, and the intended rollback (`rollbackSessionTelegram`) is never called.

4. **`src/app/api/admin/upload/complete/route.ts` (lines 77–80)**:
   ```typescript
   // 3. Retrieve Upload Session
   const session = uploadSessionManager.getSession(uploadId);
   if (!session) {
     return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });
   }
   ```
   *Observation*: If `/complete` is called after 30 minutes, `getSession(uploadId)` deletes the session and returns `null`. The route returns 404, abandoning all parts previously sent to Telegram.

5. **No background session cleanup mechanism**:
   Searching `src/` for `cleanupExpiredSessions` confirms it is never called anywhere in the application runtime. No interval or scheduled job purges expired sessions. If an upload stalls midway, parts remain on Telegram indefinitely.

---

## 2. Logic Chain

1. **Contract Invariant (R3 & Zero-Cost Architecture)**:
   - Per Requirement R3: *"In-memory session tracking (expires after 30 min)... Automatic Rollback: If any part fails or database insertion fails, delete all Telegram messages already sent for that file and write nothing to the database."*
   - In private Telegram channel storage, abandoned chunk messages that are not referenced by any database record are orphaned storage leaks.
2. **Mechanism of the Leak (Observations 1.2.1, 1.2.3, 1.2.4)**:
   - When a client uploads part 1, Telegram message $M_1$ is created.
   - If 30 minutes elapse before part 2 is uploaded (e.g. client pauses, network disruption, or client attempts complete late), the session is expired.
   - Any access to `getSession(uploadId)` deletes the session from `this.sessions` without deleting $M_1$.
   - The route handler receives `null` from `getSession` and returns HTTP 404, completely unaware of the message IDs that were previously stored.
   - The Telegram messages for parts 1..N remain orphaned in the Telegram channel forever.
3. **Flawed Cleanup Default (Observation 1.2.2)**:
   - Even if `cleanupExpiredSessions()` is manually called, it does not roll back messages unless explicitly passed `{ rollback: true, tgClient: ... }`.
   - The singleton `uploadSessionManager` (`upload-session.ts:581`) has no default Telegram client, meaning `cleanupExpiredSessions({ rollback: true })` fails to delete messages unless a client is explicitly supplied.
4. **Empirical Reproduction**:
   - The adversarial harness empirically proved that across 6 subtests in Scenario 4, zero Telegram messages were deleted upon expiration, leaking chunks across both unit and HTTP route levels.

---

## 3. Caveats

- **Scenarios 1, 2, and 3 are robustly implemented**:
  - Mid-upload Telegram failure on part 3 of 5 cleanly deletes parts 1 & 2, leaves 0 DB rows, and aborts the session.
  - Database failure during `/complete` cleanly deletes all parts 1..N from Telegram, rolls back any partial DB records, and leaves 0 DB rows.
  - Duplicate file collision on `(chapter_id, sha256)` cleanly returns HTTP 409 Conflict with a friendly error message, purges all newly uploaded parts from Telegram, and leaves the existing DB file intact.
- **Scope limitation**:
  - The failure is isolated to session expiration and TTL cleanup logic. No implementation files outside `src/lib/upload-session.ts`, `src/app/api/admin/upload/part/route.ts`, and `src/app/api/admin/upload/complete/route.ts` are affected.

---

## 4. Conclusion

**Verdict: `REQUEST_CHANGES`**

Milestone M3 cannot be approved until the session TTL rollback leak is fixed.

### Concrete Actionable Remediation Plan for Worker:

1. **Fix `getSession` in `src/lib/upload-session.ts`**:
   - Do NOT delete the session inside `getSession` if it has uploaded messages that need rolling back, OR ensure `getSession` accepts `options?: { rollback?: boolean; tgClient?: TelegramClientLike }` and triggers rollback before deletion.
   - Alternatively, add `peekSession(uploadId: string): UploadSessionData | null` or let `getSession` return the session with an `isExpired` boolean, allowing the caller (e.g. route handler with `tgClient`) to execute `rollbackSessionTelegram(uploadId, tgClient, channelId)` before deletion.
2. **Make Rollback the Default in `cleanupExpiredSessions`**:
   - In `src/lib/upload-session.ts`, `cleanupExpiredSessions` should default `rollback: true` whenever `uploadedMessageIds.length > 0`.
   - Ensure `cleanupExpiredSessions` properly awaits or tracks message deletion promises.
3. **Fix Route Handlers**:
   - In `src/app/api/admin/upload/part/route.ts`, handle expired sessions before returning 404: if a session exists but is expired, purge its Telegram messages with `rollbackSessionTelegram` and return HTTP 410 Gone.
   - In `src/app/api/admin/upload/complete/route.ts`, if the session has expired, ensure any uploaded Telegram parts are rolled back before returning HTTP 410 / 404.
4. **Register a Periodic Session Reaper**:
   - Add a lightweight background interval or hook in `uploadSessionManager` (or route invocation) that runs `cleanupExpiredSessions` with Telegram client credentials to clean up abandoned sessions when clients drop off completely.

---

## 5. Verification Method

To independently verify the fix:

1. **Execute the Adversarial Harness**:
   ```powershell
   npx tsx .agents/teamwork/challenger_m3_1/adversarial_harness.ts
   ```
   *Expected outcome after fix*:
   - Scenario 1: `PASS` (1A, 1B)
   - Scenario 2: `PASS` (2A, 2B)
   - Scenario 3: `PASS` (3A, 3B)
   - Scenario 4: `PASS` (4A, 4B, 4C, 4D, 4E, 4F)
   - Total tests: 12 passed (12), 0 failed.

2. **Run Full Test Suite**:
   ```powershell
   npm test
   ```
   *Expected outcome*: All existing test suites pass (14+ test files, 186+ tests).

3. **Linter & Typecheck**:
   ```powershell
   npm run lint
   npx tsc --noEmit
   ```
   *Expected outcome*: 0 errors, 0 warnings.
