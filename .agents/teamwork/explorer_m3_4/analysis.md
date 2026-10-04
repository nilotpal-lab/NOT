# Analysis Report: Upload API Routes Expiration Rollback

**Agent**: Explorer 2 (`explorer_m3_4`)  
**Milestone**: M3 Iteration 2 (Upload API Routes Expiration Rollback)  
**Parent Orchestrator**: `orchestrator_1` (`fb1a83fa-301b-45dd-ba05-a3edc0267f37`)  
**Target Files**:
- `src/app/api/admin/upload/part/route.ts`
- `src/app/api/admin/upload/complete/route.ts`

---

## 1. Executive Summary & Problem Diagnosis

During Milestone M3 empirical adversarial testing (`adversarial_harness.ts`), Challenger M3-1 exposed critical failure modes in Scenario 4 (Session timeout rollback, 30-min TTL):
- **Scenario 4E**: When part 2 is uploaded to `POST /api/admin/upload/part` after the 30-minute session TTL has elapsed, the handler returned HTTP 404 (`"Upload session not found or expired"`), but **failed to delete part 1 from the Telegram channel**. The orphaned chunk remained leaked in Telegram storage.
- **Scenario 4F**: When `POST /api/admin/upload/complete` was called after the 30-minute session TTL has elapsed, the handler returned HTTP 404 without deleting parts 1..N from Telegram. All uploaded chunks remained leaked in Telegram storage.

### 1.1 Root Cause in `src/app/api/admin/upload/part/route.ts`

In `part/route.ts` (lines 111–136):
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

**Why this was dead code**:
1. At line 112, `uploadSessionManager.getSession(uploadId)` inspects `Date.now() - session.createdAt > this.sessionTtlMs`.
2. When the session is expired (> 30m), `getSession` immediately deletes the session from `this.sessions` and returns `null`.
3. In `part/route.ts`, `if (!session)` triggers:
   - For `partNo > 1` (such as part 2), line 125 executes immediately:
     `return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });`
   - Lines 130–135 (`if (Date.now() - session.createdAt > SESSION_TTL_MS)`) are **unreachable dead code**.
4. Furthermore, because `getSession` already deleted the session from `this.sessions`, all stored `uploadedMessageIds` were lost from memory before any Telegram deletion could occur.

### 1.2 Root Cause in `src/app/api/admin/upload/complete/route.ts`

In `complete/route.ts` (lines 76–81):
```typescript
// 3. Retrieve Upload Session
const session = uploadSessionManager.getSession(uploadId);
if (!session) {
  return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });
}
```

**Why this leaked**:
1. `complete/route.ts` contained **no TTL expiration check whatsoever**.
2. When `/complete` was called after 30 minutes, `getSession(uploadId)` deleted the expired session from memory and returned `null`.
3. The route handler simply treated `!session` as a 404 Not Found, completely abandoning parts 1..N that were already sent to Telegram.

---

## 2. Route Fix Strategy & Interface Contract

To fix both routes cleanly while remaining decoupled from internal storage implementation details, the routes and `UploadSessionManager` must adhere to this interface contract:

### 2.1 Interface Contract with `UploadSessionManager`

Explorer 1 (`explorer_m3_3`) has formulated the corresponding updates in `src/lib/upload-session.ts`:
1. `peekSession(uploadId: string): UploadSessionData | null`:
   - Returns the in-memory session without performing a TTL purge or mutating state.
   - Allows route handlers to inspect `createdAt`, `uploadedMessageIds`, etc.
2. `isSessionExpired(uploadIdOrSession: string | UploadSessionData): boolean`:
   - Checks whether the session's elapsed time exceeds `sessionTtlMs`.
   - Allows route handlers to use the exact configured manager TTL dynamically (supporting test configurations and production defaults).
3. `rollbackSessionTelegram(uploadId: string, tgClient: TelegramClientLike, channelId?: string | number): Promise<number[]>`:
   - Deletes all recorded `uploadedMessageIds` from Telegram channel using `tgClient.deleteMessage`.
4. `deleteSession(uploadId: string): boolean`:
   - Clears the session data and concurrency lock from memory.

### 2.2 Defensive Route-Level Design

Both route handlers are updated with safe fallback guards:
```typescript
const session = typeof uploadSessionManager.peekSession === "function"
  ? uploadSessionManager.peekSession(uploadId)
  : uploadSessionManager.getSession(uploadId, { includeExpired: true });

const SESSION_TTL_MS = 30 * 60 * 1000;
const isExpired = typeof uploadSessionManager.isSessionExpired === "function"
  ? uploadSessionManager.isSessionExpired(uploadId)
  : (Date.now() - session.createdAt > SESSION_TTL_MS);
```
This guarantees:
- If `peekSession` is present, it is used. If an older or alternate implementation with `getSession(uploadId, { includeExpired: true })` is present, it works interchangeably.
- If `isSessionExpired` is present, it uses the manager's TTL (e.g. 50ms in unit tests or 30m in production). If not, it falls back to 30 minutes.

---

## 3. Concrete Code Changes

### 3.1 `src/app/api/admin/upload/part/route.ts`

#### Before:
```typescript
  // 5. Lookup or initialize upload session
  let session = uploadSessionManager.getSession(uploadId);
  if (!session) {
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

  // Check TTL (30 minutes)
  const SESSION_TTL_MS = 30 * 60 * 1000;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    await uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId);
    uploadSessionManager.deleteSession(uploadId);
    return NextResponse.json({ error: "Upload session expired (30m TTL)" }, { status: 410 });
  }
```

#### After:
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

### 3.2 `src/app/api/admin/upload/complete/route.ts`

#### Before:
```typescript
  // 3. Retrieve Upload Session
  const session = uploadSessionManager.getSession(uploadId);
  if (!session) {
    return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });
  }

  // Helper for rolling back Telegram messages and clearing session
  const executeRollbackAndCleanup = async () => {
    await uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId);
    uploadSessionManager.deleteSession(uploadId);
  };
```

#### After:
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

## 4. Edge Cases and Invariant Analysis

| Edge Case | Expected Behavior | Verification |
|---|---|---|
| Part 1 arrives, new uploadId | No session exists; session created; part 1 uploaded | Returns 200/201, `uploadSessionManager.startSession` |
| Part 2 arrives, active session (< 30m) | `isExpired = false`; forwards to Telegram; records part 2 | Returns 200/201, parts stored |
| Part 2 arrives, expired session (> 30m) | `isExpired = true`; deletes part 1 on Telegram; deletes session; returns 410 | Subtest 4E: `tgDeleted.includes(msgId)` is true, status is 410 |
| Part 1 re-sent for expired session | `session` exists and is expired; purges previous part 1; deletes session; returns 410 | Prevents orphan chunks; client starts clean with fresh uploadId |
| Part 1 re-sent for active session | `session` exists, active; fails sequential check (`part !== expectedPart`); returns 400 | Existing session preserved without corruption |
| Part 2 arrives, unknown uploadId | No session exists; `partNo !== 1`; returns 404 | Clean 404 error |
| `/complete` called on expired session | `isExpired = true`; purges all parts 1..N on Telegram; deletes session; returns 410 | Subtest 4F: `allDeleted` is true, status is 410 |
| `/complete` called on unknown uploadId | `!session`; returns 404 | Returns 404 without errors |
| Partial DB error on `/complete` | In-flight failure; rolls back Telegram parts and cleans DB rows; returns 500 | Subtest 2B: verified working |
| Duplicate file on `/complete` | Collision detected; rolls back Telegram parts; returns 409 | Subtest 3B: verified working |
| Mid-upload Telegram failure on part 3 of 5 | Catches network error; rolls back parts 1 & 2; returns 500 | Subtest 1B: verified working |

---

## 5. Artifact Delivery

Full drop-in replacement files have been generated:
1. `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m3_4\proposed_part_route.ts`
2. `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m3_4\proposed_complete_route.ts`

These files are ready for immediate application by the worker.
