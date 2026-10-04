# Handoff Report — Explorer 2 (Milestone M3 Iteration 2: Upload API Routes Expiration Rollback)

**Agent**: `teamwork_preview_explorer` (Explorer 2, Milestone M3 Iteration 2)  
**Date**: 2026-10-04  
**Working Directory**: `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m3_4`  
**Parent Orchestrator**: `orchestrator_1` (`fb1a83fa-301b-45dd-ba05-a3edc0267f37`)  
**Type**: Hard Handoff (Investigation & Route Formulation Complete)  

---

## 1. Observation

### 1.1 Direct Tool Execution & Test Results
Command executed:
```powershell
npx tsx .agents/teamwork/challenger_m3_1/adversarial_harness.ts
```
Observed verbatim test failures in Scenario 4:
```
❌ [Scenario 4] 4E: (Route POST /upload/part) Stale session part 2 upload purges part 1 and returns 410 Gone
   Failure reason: CRITICAL BUG: Stale session returned status 404 ('Upload session not found or expired') but NEVER deleted part 1 (msgId 2007) from Telegram! Orphaned parts leaked.
   Evidence: {
  "status": 404,
  "body": {
    "error": "Upload session not found or expired"
  },
  "p1Deleted": false,
  "tgDeleted": [],
  "msgId": 2007
}

❌ [Scenario 4] 4F: (Route POST /upload/complete) Stale session completion purges parts 1..N from Telegram
   Failure reason: CRITICAL BUG: Stale session completion returned status 404 ('Upload session not found or expired') but NEVER deleted parts [2008,2009] from Telegram! Orphaned parts leaked.
   Evidence: {
  "status": 404,
  "body": {
    "error": "Upload session not found or expired"
  },
  "allDeleted": false,
  "tgDeleted": [],
  "sentIds": [
    2008,
    2009
  ]
}
```

### 1.2 Exact Code Deficiencies Observed

1. **`src/app/api/admin/upload/part/route.ts` (lines 111–136)**:
   ```typescript
   111:   // 5. Lookup or initialize upload session
   112:   let session = uploadSessionManager.getSession(uploadId);
   113:   if (!session) {
   114:     if (partNo === 1) {
   115:       session = uploadSessionManager.startSession(uploadId, totalParts, {
   116:         fileName,
   117:         kind,
   118:         title,
   119:         class: classNum,
   120:         subject,
   121:         chapterNo,
   122:         channelId,
   123:       });
   124:     } else {
   125:       return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });
   126:     }
   127:   }
   128: 
   129:   // Check TTL (30 minutes)
   130:   const SESSION_TTL_MS = 30 * 60 * 1000;
   131:   if (Date.now() - session.createdAt > SESSION_TTL_MS) {
   132:     await uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId);
   133:     uploadSessionManager.deleteSession(uploadId);
   134:     return NextResponse.json({ error: "Upload session expired (30m TTL)" }, { status: 410 });
   135:   }
   ```
   - When a session has expired (`Date.now() - session.createdAt > 30 * 60 * 1000`), line 112 calls `uploadSessionManager.getSession(uploadId)`. Inside `getSession`, the session is deleted from memory and `null` is returned.
   - For `partNo > 1` (e.g. part 2), line 125 executes immediately and returns HTTP 404.
   - Lines 130–135 are unreachable dead code.
   - Because `this.sessions.delete(uploadId)` already ran inside `getSession`, the message IDs for previously uploaded parts are purged from memory, leaving those chunks leaked on Telegram forever.

2. **`src/app/api/admin/upload/complete/route.ts` (lines 76–81)**:
   ```typescript
   76:   // 3. Retrieve Upload Session
   77:   const session = uploadSessionManager.getSession(uploadId);
   78:   if (!session) {
   79:     return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });
   80:   }
   ```
   - No TTL check exists in `complete/route.ts`.
   - When `/complete` is called after 30 minutes, `getSession(uploadId)` deletes the session and returns `null`.
   - The route returns HTTP 404, never invoking `rollbackSessionTelegram`. Parts 1..N remain orphaned in the Telegram channel.

3. **Coordination with Explorer 1 (`explorer_m3_3`)**:
   - Explorer 1 has authored `.agents/teamwork/explorer_m3_3/proposed_upload-session.ts`, adding:
     - `peekSession(uploadId: string): UploadSessionData | null`
     - `isSessionExpired(uploadIdOrSession: string | UploadSessionData): boolean`
     - `getSession(uploadId, options?: { includeExpired?: boolean; rollbackOnExpire?: boolean; tgClient?: TelegramClientLike })`

---

## 2. Logic Chain

1. **Premise (Zero-Cost Telegram Storage Contract)**:
   Per Requirement R3 and `PROJECT.md`, zero unreferenced chunks may remain in the Telegram channel. If an upload fails or expires, all previously uploaded parts must be deleted via `tgClient.deleteMessage`.
2. **Failure Mechanism in Route Handlers (Observation 1.2.1 & 1.2.2)**:
   - Calling `getSession(uploadId)` before checking TTL causes `UploadSessionManager` to immediately delete the session from its internal map when expired.
   - Once deleted from the map, `session.uploadedMessageIds` is lost.
   - The route handler cannot obtain the message IDs and cannot call `rollbackSessionTelegram(uploadId, tgClient, channelId)`.
3. **Remediation Strategy**:
   - The route handler must retrieve the session **without** triggering a silent in-memory purge before rollback. This is achieved via `uploadSessionManager.peekSession(uploadId)` (or `getSession(uploadId, { includeExpired: true })`).
   - If the session exists:
     - The route checks `isExpired = uploadSessionManager.isSessionExpired(uploadId) || (Date.now() - session.createdAt > SESSION_TTL_MS)`.
     - If expired, the route calls `await uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId)`.
     - The route deletes the session from memory: `uploadSessionManager.deleteSession(uploadId)`.
     - The route returns HTTP 410 (`"Upload session expired (30m TTL)"`).
   - If the session does not exist in memory:
     - For `partNo === 1`: starts a new session via `uploadSessionManager.startSession`.
     - For `partNo > 1` or `/complete`: returns HTTP 404 (`"Upload session not found or expired"`).
4. **Resolution of Test Failures 4E & 4F**:
   - In 4E: When part 2 arrives after 31 minutes, `peekSession` retrieves the session with messageId 2007. The TTL check evaluates to `true`, calls `rollbackSessionTelegram(uploadId, tgClient, channelId)`, deletes message 2007, and returns HTTP 410. Subtest 4E passes.
   - In 4F: When `/complete` is called after 31 minutes, `peekSession` retrieves the session with messageIds 2008 & 2009. The TTL check evaluates to `true`, calls `rollbackSessionTelegram(uploadId, tgClient, channelId)`, deletes both messages, and returns HTTP 410. Subtest 4F passes.

---

## 3. Caveats

1. **Dependency on Explorer 1 / Worker Application of `upload-session.ts`**:
   The route handlers use `uploadSessionManager.peekSession` and `uploadSessionManager.isSessionExpired`. Both routes include defensive fallbacks (`typeof ... === "function"`), ensuring they function even if only `getSession(uploadId, { includeExpired: true })` or basic Date math is available. However, for full test suite passage (4A–4F), the updates to both `src/lib/upload-session.ts` (Explorer 1) and both route handlers (Explorer 2) must be applied together by the Worker.
2. **Network Timeouts on Telegram API during Rollback**:
   If Telegram's API is unresponsive during rollback, `rollbackTelegramMessages` swallows individual message deletion rejections and records warnings rather than crashing the route handler. This ensures HTTP 410 is reliably returned to the client even under degraded network conditions.

---

## 4. Conclusion

Both upload route handlers (`src/app/api/admin/upload/part/route.ts` and `src/app/api/admin/upload/complete/route.ts`) have been fully analyzed, diagnosed, and redesigned to guarantee clean Telegram rollback on session expiration.

### Concrete Actionable Files Provided:
1. **Full Replacement for `part/route.ts`**:
   `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m3_4\proposed_part_route.ts`
2. **Full Replacement for `complete/route.ts`**:
   `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m3_4\proposed_complete_route.ts`
3. **Detailed Analysis & Diff Report**:
   `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m3_4\analysis.md`

### Summary of Route Code Changes:

**In `src/app/api/admin/upload/part/route.ts` (replace lines 111–136)**:
```typescript
  // 5. Lookup existing upload session (peekSession preserves session data even if expired for Telegram rollback)
  let session = typeof uploadSessionManager.peekSession === "function"
    ? uploadSessionManager.peekSession(uploadId)
    : uploadSessionManager.getSession(uploadId, { includeExpired: true });

  const SESSION_TTL_MS = 30 * 60 * 1000;

  if (session) {
    // Session exists - check TTL expiration (30m TTL)
    const isExpired = typeof uploadSessionManager.isSessionExpired === "function"
      ? uploadSessionManager.isSessionExpired(uploadId)
      : (Date.now() - session.createdAt > SESSION_TTL_MS);

    if (isExpired) {
      logger.warn(
        { uploadId, partNo, createdAt: session.createdAt },
        "Upload session expired (30m TTL); rolling back Telegram parts"
      );
      await uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId);
      uploadSessionManager.deleteSession(uploadId);
      return NextResponse.json({ error: "Upload session expired (30m TTL)" }, { status: 410 });
    }
  } else {
    // Session does not exist in memory
    if (partNo === 1) {
      session = uploadSessionManager.startSession(uploadId, totalParts, {
        fileName,
        kind,
        title,
        class: classNum,
        subject,
        chapterNo,
        channelId,
      });
    } else {
      return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });
    }
  }
```

**In `src/app/api/admin/upload/complete/route.ts` (replace lines 76–81)**:
```typescript
  // 3. Retrieve Upload Session (peekSession retains session data if expired for Telegram rollback)
  const session = typeof uploadSessionManager.peekSession === "function"
    ? uploadSessionManager.peekSession(uploadId)
    : uploadSessionManager.getSession(uploadId, { includeExpired: true });

  if (!session) {
    return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });
  }

  // Helper for rolling back Telegram messages and clearing session
  const executeRollbackAndCleanup = async () => {
    await uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId);
    uploadSessionManager.deleteSession(uploadId);
  };

  // Check TTL (30 minutes)
  const SESSION_TTL_MS = 30 * 60 * 1000;
  const isExpired = typeof uploadSessionManager.isSessionExpired === "function"
    ? uploadSessionManager.isSessionExpired(uploadId)
    : (Date.now() - session.createdAt > SESSION_TTL_MS);

  if (isExpired) {
    logger.warn(
      { uploadId, createdAt: session.createdAt },
      "Upload session expired (30m TTL); rolling back Telegram parts on complete"
    );
    await executeRollbackAndCleanup();
    return NextResponse.json({ error: "Upload session expired (30m TTL)" }, { status: 410 });
  }
```

---

## 5. Verification Method

To independently verify the fix:

1. **Worker applies both sets of changes**:
   - `src/lib/upload-session.ts` from Explorer 1 (`.agents/teamwork/explorer_m3_3/proposed_upload-session.ts`).
   - `src/app/api/admin/upload/part/route.ts` from Explorer 2 (`.agents/teamwork/explorer_m3_4/proposed_part_route.ts`).
   - `src/app/api/admin/upload/complete/route.ts` from Explorer 2 (`.agents/teamwork/explorer_m3_4/proposed_complete_route.ts`).
2. **Execute Adversarial Stress Test Suite**:
   ```powershell
   npx tsx .agents/teamwork/challenger_m3_1/adversarial_harness.ts
   ```
   *Expected outcome*: 12/12 passed (0 failed). Subtests 4E and 4F pass with status 410 and parts purged from Telegram.
3. **Execute Vitest Suite**:
   ```powershell
   npm test
   ```
   *Expected outcome*: 186/186 passed across 14 test files.
4. **Typecheck & Linter**:
   ```powershell
   npx tsc --noEmit
   npm run lint
   ```
   *Expected outcome*: 0 errors.
