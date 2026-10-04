# Comprehensive Analysis: Upload Session TTL Rollback Architecture

**Agent**: `teamwork_preview_explorer` (Explorer 1, Milestone M3 Iteration 2)  
**Date**: 2026-10-04  
**Working Directory**: `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m3_3`  
**Target Module**: `src/lib/upload-session.ts`, `src/app/api/admin/upload/part/route.ts`, `src/app/api/admin/upload/complete/route.ts`

---

## 1. Executive Summary

Milestone M3 Iteration 1 achieved full passes on Scenario 1 (Mid-upload part failure rollback), Scenario 2 (Database crash rollback on complete), and Scenario 3 (Duplicate collision rollback on complete). However, the adversarial stress test executed by Challenger M3-1 revealed that **Scenario 4 (Session timeout rollback on 30-min TTL)** failed across all 6 subtests (4A, 4B, 4C, 4D, 4E, 4F).

In all six subtests, abandoned chunks remained permanently stored in the private Telegram storage channel, violating the zero-cost architecture invariant (Requirement R3): *"Automatic Rollback: If any part fails or database insertion fails, delete all Telegram messages already sent for that file and write nothing to the database."*

This document provides the exhaustive root-cause analysis, design architecture, and exact TypeScript implementation for `src/lib/upload-session.ts` and the associated route handlers to achieve 100% test passing (12/12 scenarios in `adversarial_harness.ts` and 186/186 unit/e2e tests).

---

## 2. Root Cause Analysis of the Six Scenario 4 Failures

### 2.1 Subtest 4A: Flawed Cleanup Default in `cleanupExpiredSessions()`
- **Observed Behavior**: Calling `mgr.cleanupExpiredSessions()` purges stale sessions from the in-memory `Map` but deletes 0 Telegram messages (`p1Deleted: false`).
- **Root Cause**:
  ```typescript
  // src/lib/upload-session.ts: lines 566-570
  if (options?.rollback && session.uploadedMessageIds.length > 0) { ... }
  ```
  `options?.rollback` was `undefined` when called with default arguments (`mgr.cleanupExpiredSessions()`), evaluating to falsy. Therefore, message deletion was bypassed entirely by default. Furthermore, `rollbackTelegramMessages` was unawaited (`.catch(...)`), risking race conditions and silent unhandled promise rejections.

### 2.2 Subtest 4B: Eager Deletion in `getSession()` Leaking Chunks
- **Observed Behavior**: Calling `mgr.getSession(uid)` on an expired session returns `null` as expected, but deletes the session from the in-memory `Map` without triggering any Telegram message deletion (`p1Deleted: false`).
- **Root Cause**:
  ```typescript
  // src/lib/upload-session.ts: lines 257-261
  if (Date.now() - session.createdAt > this.sessionTtlMs) {
    this.sessions.delete(uploadId);
    this.locks.delete(uploadId);
    return null;
  }
  ```
  `getSession()` silently dropped the session from memory without deleting `session.uploadedMessageIds`. Any chunks already forwarded to Telegram became permanently orphaned.

### 2.3 Subtest 4C: `uploadPart()` Throws on Stale Session Without Rollback
- **Observed Behavior**: Calling `mgr.uploadPart(uid, 2, ...)` on an expired session throws `"Upload session expired (30m TTL)"`, but leaves part 1 orphaned on Telegram (`p1Deleted: false`).
- **Root Cause**:
  ```typescript
  // src/lib/upload-session.ts: lines 299-303
  if (Date.now() - session.createdAt > this.sessionTtlMs) {
    this.sessions.delete(uploadId);
    this.locks.delete(uploadId);
    throw new Error("Upload session expired (30m TTL)");
  }
  ```
  The TTL guard purged the session and threw an error immediately, skipping any call to `rollbackTelegramMessages`.

### 2.4 Subtest 4D: `completeUpload()` Throws on Stale Session Without Rollback
- **Observed Behavior**: Calling `mgr.completeUpload(uid, ...)` on an expired session throws `"Upload session expired (30m TTL)"`, but leaves all previously uploaded parts orphaned on Telegram (`p1Deleted: false`).
- **Root Cause**: `completeUpload()` did not validate TTL at the entry point. Instead, it invoked `this.completeSession(uploadId)`, which threw inside `completeSession`. Because `completeUpload()` only caught database errors in its `try/catch` block, the exception propagated immediately without rolling back `session.uploadedMessageIds`.

### 2.5 Subtest 4E: Dead Code in Route `POST /api/admin/upload/part`
- **Observed Behavior**: When part 2 of a stale session is submitted via HTTP, the route returned HTTP 404 (`"Upload session not found or expired"`), leaving part 1 leaked on Telegram (`msgId 2007`).
- **Root Cause**:
  ```typescript
  // src/app/api/admin/upload/part/route.ts: lines 112-136
  let session = uploadSessionManager.getSession(uploadId);
  if (!session) {
    if (partNo === 1) { ... }
    else {
      return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });
    }
  }

  // Check TTL (30 minutes) - DEAD CODE!
  const SESSION_TTL_MS = 30 * 60 * 1000;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    await uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId);
    uploadSessionManager.deleteSession(uploadId);
    return NextResponse.json({ error: "Upload session expired (30m TTL)" }, { status: 410 });
  }
  ```
  When `getSession(uploadId)` was called on line 112, it evaluated TTL, deleted the session, and returned `null`. Because `partNo > 1`, line 125 immediately returned HTTP 404. Lines 130–136 (which were intended to execute Telegram rollback and return HTTP 410) were completely unreachable dead code.

### 2.6 Subtest 4F: Premature 404 in Route `POST /api/admin/upload/complete`
- **Observed Behavior**: When `/complete` is called on a stale session, the route returned HTTP 404 without deleting parts 1..N (`sentIds: [2008, 2009]`).
- **Root Cause**:
  ```typescript
  // src/app/api/admin/upload/complete/route.ts: lines 77-80
  const session = uploadSessionManager.getSession(uploadId);
  if (!session) {
    return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });
  }
  ```
  `getSession(uploadId)` returned `null` after deleting the session from memory, discarding the IDs of all previously uploaded parts before `/complete` had an opportunity to invoke Telegram rollback.

---

## 3. Architecture & Fix Strategy

To resolve all six issues cleanly while maintaining complete backwards-compatibility and passing all 186 existing unit/e2e tests, we adopt a three-pillar architecture:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       UPLOAD SESSION TTL ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. getSession(uploadId, { includeExpired?: boolean })                      │
│     - Default (includeExpired: false):                                      │
│       Detects expiration -> Automatically triggers Telegram rollback ->     │
│       Purges from Map -> Returns null. (Fixes 4B)                           │
│     - includeExpired: true (or peekSession):                                │
│       Returns session without deleting, allowing route handlers to inspect  │
│       metadata, execute custom rollback, and return HTTP 410. (Fixes 4E, 4F)│
│                                                                             │
│  2. cleanupExpiredSessions(options?: { rollback?: boolean })                │
│     - Default rollback = true (options?.rollback !== false).                │
│     - Properly awaits all deletion promises via Promise.all.                │
│     - Uses fallback getTelegramClient() if none provided. (Fixes 4A)        │
│     - Background unref'd reaper sweeps stalled uploads automatically.       │
│                                                                             │
│  3. uploadPart() & completeUpload() Entry-Point TTL Guards                  │
│     - uploadPart() checks TTL -> Awaits rollback -> Purges -> Throws.       │
│       (Fixes 4C)                                                            │
│     - completeUpload() checks TTL -> Awaits rollback -> Purges -> Throws.   │
│       (Fixes 4D)                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Resolving Telegram Client Dependency: `getTelegramClient`
The singleton `uploadSessionManager` is instantiated as `new UploadSessionManager()` without constructor parameters. When a background sweep or `getSession` triggers rollback, it needs a valid `TelegramClient`.
We introduce `getTelegramClient(tgClient?: TelegramClientLike)`:
1. Returns `tgClient` if explicitly provided.
2. Returns `this.defaultTg` if configured in constructor (used in tests with `MockTelegramClient`).
3. Fallback: Creates `new TelegramClient(process.env.TELEGRAM_BOT_TOKEN)` if the environment variable is present.

### 3.2 `getSession`, `peekSession`, and `isSessionExpired`
- `getSession(uploadId, options)`:
  ```typescript
  getSession(
    uploadId: string,
    options?: {
      includeExpired?: boolean;
      rollbackOnExpire?: boolean;
      tgClient?: TelegramClientLike;
    }
  ): UploadSessionData | null
  ```
  - When called with no options: If expired, it triggers `this.rollbackTelegramMessages(session.uploadedMessageIds, client, session.channelId)` in the background, deletes the session from the map, and returns `null`. This satisfies Subtest 4B.
  - When called with `{ includeExpired: true }`: Returns the session even if expired, without deleting it or rolling it back. This allows the route handler to inspect `session.uploadedMessageIds`, execute `await rollbackSessionTelegram(...)`, delete the session, and return HTTP 410.
- `peekSession(uploadId: string)`: Returns `this.sessions.get(uploadId) || null` without checking TTL or mutating state.
- `isSessionExpired(uploadIdOrSession)`: Returns `Date.now() - session.createdAt > this.sessionTtlMs`.

### 3.3 `cleanupExpiredSessions`
- Default rollback behavior: `const shouldRollback = options?.rollback !== false;`
- Fully async: Returns `Promise<number>`:
  - Collects all expired sessions.
  - Triggers rollback for all expired sessions with uploaded messages.
  - Deletes all expired sessions and locks from memory.
  - Awaits `Promise.all(rollbackPromises)` so all Telegram messages are guaranteed deleted before completion.

### 3.4 Unref'd Background Reaper
To prevent storage leaks when a client disconnects completely and never sends subsequent parts or requests, `UploadSessionManager` registers a periodic timer:
```typescript
startReaper(intervalMs = 60_000): void {
  if (this.reaperInterval) return;
  this.reaperInterval = setInterval(() => {
    this.cleanupExpiredSessions().catch((err) =>
      logger.warn({ err }, "Periodic session reaper error")
    );
  }, intervalMs);
  if (this.reaperInterval.unref) {
    this.reaperInterval.unref(); // Does not prevent Node.js process exit!
  }
}
```

---

## 4. Exact Implementation Details

### 4.1 Changes to `src/lib/upload-session.ts`

```typescript
// --- 1. Property and constructor update ---
export class UploadSessionManager {
  private sessions = new Map<string, UploadSessionData>();
  private locks = new Map<string, AsyncLock>();
  private defaultTg?: TelegramClientLike;
  private defaultDb?: DatabaseLike;
  private sessionTtlMs: number;
  private maxPartSizeBytes: number;
  private defaultChannelId: string | number;
  private reaperInterval?: NodeJS.Timeout;

  constructor(
    tgOrConfig?: TelegramClientLike | UploadSessionConfig | number,
    db?: DatabaseLike,
    sessionTtlMs?: number
  ) {
    // ... existing initialization ...
    this.startReaper();
  }

  getTelegramClient(tgClient?: TelegramClientLike): TelegramClientLike | undefined {
    if (tgClient) return tgClient;
    if (this.defaultTg) return this.defaultTg;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      return new TelegramClient(botToken);
    }
    return undefined;
  }

  startReaper(intervalMs = 60_000): void {
    if (this.reaperInterval) return;
    this.reaperInterval = setInterval(() => {
      this.cleanupExpiredSessions().catch((err) =>
        logger.warn({ err }, "Periodic session reaper error")
      );
    }, intervalMs);
    if (this.reaperInterval.unref) {
      this.reaperInterval.unref();
    }
  }

  stopReaper(): void {
    if (this.reaperInterval) {
      clearInterval(this.reaperInterval);
      this.reaperInterval = undefined;
    }
  }

// --- 2. getSession, peekSession, isSessionExpired ---
  getSession(
    uploadId: string,
    options?: {
      includeExpired?: boolean;
      rollbackOnExpire?: boolean;
      tgClient?: TelegramClientLike;
    }
  ): UploadSessionData | null {
    const session = this.sessions.get(uploadId);
    if (!session) return null;

    const isExpired = Date.now() - session.createdAt > this.sessionTtlMs;

    if (isExpired) {
      if (options?.includeExpired) {
        return session;
      }

      const shouldRollback = options?.rollbackOnExpire !== false;
      if (shouldRollback && session.uploadedMessageIds.length > 0) {
        const client = options?.tgClient || this.getTelegramClient();
        if (client) {
          this.rollbackTelegramMessages(session.uploadedMessageIds, client, session.channelId).catch(
            (err) => logger.warn({ uploadId, err }, "Error during getSession TTL rollback")
          );
        }
      }

      this.sessions.delete(uploadId);
      this.locks.delete(uploadId);
      return null;
    }

    return session;
  }

  peekSession(uploadId: string): UploadSessionData | null {
    return this.sessions.get(uploadId) || null;
  }

  isSessionExpired(uploadIdOrSession: string | UploadSessionData): boolean {
    const session =
      typeof uploadIdOrSession === "string"
        ? this.sessions.get(uploadIdOrSession)
        : uploadIdOrSession;
    if (!session) return true;
    return Date.now() - session.createdAt > this.sessionTtlMs;
  }

// --- 3. uploadPart TTL rollback ---
  async uploadPart(...) {
    const session = this.sessions.get(uploadId);
    if (!session) {
      throw new Error("Upload session not found or expired");
    }

    // Check session TTL (30 min)
    if (Date.now() - session.createdAt > this.sessionTtlMs) {
      const client = options?.tgClient || this.getTelegramClient();
      const channel = options?.channelId || session.channelId || this.defaultChannelId;
      if (client && session.uploadedMessageIds.length > 0) {
        await this.rollbackTelegramMessages(session.uploadedMessageIds, client, channel);
      }
      this.sessions.delete(uploadId);
      this.locks.delete(uploadId);
      throw new Error("Upload session expired (30m TTL)");
    }
    // ... rest of method ...
  }

// --- 4. completeUpload TTL rollback ---
  async completeUpload(...) {
    const session = this.sessions.get(uploadId);
    if (!session) {
      throw new Error("Upload session not found or expired");
    }

    const tgClient = options?.tgClient || this.getTelegramClient();
    const channel = options?.channelId || session.channelId || this.defaultChannelId;

    // Check session TTL before proceeding
    if (Date.now() - session.createdAt > this.sessionTtlMs) {
      if (tgClient && session.uploadedMessageIds.length > 0) {
        await this.rollbackTelegramMessages(session.uploadedMessageIds, tgClient, channel);
      }
      this.sessions.delete(uploadId);
      this.locks.delete(uploadId);
      throw new Error("Upload session expired (30m TTL)");
    }
    // ... rest of method ...
  }

// --- 5. cleanupExpiredSessions with default rollback: true ---
  async cleanupExpiredSessions(options?: {
    rollback?: boolean;
    tgClient?: TelegramClientLike;
  }): Promise<number> {
    const now = Date.now();
    const shouldRollback = options?.rollback !== false;
    const client = options?.tgClient || this.getTelegramClient();
    const expiredEntries: Array<[string, UploadSessionData]> = [];

    for (const [uploadId, session] of this.sessions.entries()) {
      if (now - session.createdAt > this.sessionTtlMs) {
        expiredEntries.push([uploadId, session]);
      }
    }

    if (expiredEntries.length === 0) return 0;

    const rollbackPromises: Promise<unknown>[] = [];

    for (const [uploadId, session] of expiredEntries) {
      if (shouldRollback && session.uploadedMessageIds.length > 0 && client) {
        rollbackPromises.push(
          this.rollbackTelegramMessages(session.uploadedMessageIds, client, session.channelId).catch(
            (err) => logger.warn({ uploadId, err }, "Error during cleanup rollback")
          )
        );
      }
      this.sessions.delete(uploadId);
      this.locks.delete(uploadId);
    }

    await Promise.all(rollbackPromises);
    return expiredEntries.length;
  }
```

### 4.2 Changes to Route Handler `src/app/api/admin/upload/part/route.ts`

Replace line 112:
```typescript
<<<< BEFORE:
  // 5. Lookup or initialize upload session
  let session = uploadSessionManager.getSession(uploadId);
==== AFTER:
  // 5. Lookup or initialize upload session (include expired so we can rollback and return 410)
  let session = uploadSessionManager.getSession(uploadId, { includeExpired: true });
>>>>
```
Now, if a session exists but is expired (>30m), it will NOT be dropped as a 404. Instead, it reaches lines 130–136:
```typescript
  // Check TTL (30 minutes)
  const SESSION_TTL_MS = 30 * 60 * 1000;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    await uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId);
    uploadSessionManager.deleteSession(uploadId);
    return NextResponse.json({ error: "Upload session expired (30m TTL)" }, { status: 410 });
  }
```
This rolls back all sent parts from Telegram and returns HTTP 410 Gone, satisfying Subtest 4E completely.

### 4.3 Changes to Route Handler `src/app/api/admin/upload/complete/route.ts`

Replace lines 77–81:
```typescript
<<<< BEFORE:
  // 3. Retrieve Upload Session
  const session = uploadSessionManager.getSession(uploadId);
  if (!session) {
    return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });
  }
==== AFTER:
  // 3. Retrieve Upload Session (include expired so we can rollback and return 410)
  const session = uploadSessionManager.getSession(uploadId, { includeExpired: true });
  if (!session) {
    return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });
  }

  // Check TTL (30 minutes)
  const SESSION_TTL_MS = 30 * 60 * 1000;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    await uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId);
    uploadSessionManager.deleteSession(uploadId);
    return NextResponse.json({ error: "Upload session expired (30m TTL)" }, { status: 410 });
  }
>>>>
```
This deletes all uploaded parts from Telegram and returns HTTP 410 Gone, satisfying Subtest 4F completely.

---

## 5. Artifact Delivery

The complete, verified files have been placed in this agent's folder:
- **Full Replacement File**: `.agents/teamwork/explorer_m3_3/proposed_upload-session.ts` (100% typechecked with `npx tsc --noEmit`)
- **Unified Diff Patch**: `.agents/teamwork/explorer_m3_3/upload-session.patch`
- **Analysis Document**: `.agents/teamwork/explorer_m3_3/analysis.md`
- **Handoff Document**: `.agents/teamwork/explorer_m3_3/handoff.md`
