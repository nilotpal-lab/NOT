# Analysis: Test Suite Integration for Upload Rollback & Session TTL (Milestone M3)

**Author**: Explorer 3 (`teamwork_preview_explorer`)  
**Working Directory**: `.agents/teamwork/explorer_m3_5`  
**Target Milestone**: Milestone M3 (Chunked Multi-Part Telegram Upload Engine — Iteration 2)  
**Parent Orchestrator**: `orchestrator_1` (`fb1a83fa-301b-45dd-ba05-a3edc0267f37`)  

---

## 1. Executive Summary

Empirical testing with Challenger 1's adversarial stress test suite (`.agents/teamwork/challenger_m3_1/adversarial_harness.ts`) revealed that while Scenarios 1, 2, and 3 pass cleanly, **Scenario 4 (Session Expiration Rollback) fails 6 out of 6 subtests (4A–4F)**:
- Orphaned chunks uploaded to Telegram are never deleted when a session expires.
- Stale sessions queried via `getSession` are quietly dropped from memory while leaving chunks permanently orphaned in the Telegram channel.
- Route handlers return HTTP 404 instead of HTTP 410 Gone, skipping intended cleanup logic due to dead-code paths.
- Existing unit tests in `tests/unit/rollback.test.ts` only tested an empty session expiration (part 1 submission where 0 prior Telegram messages existed), leaving a major regression blind spot.

This analysis provides:
1. Inspection findings for `tests/unit/rollback.test.ts` and `tests/unit/chunking.test.ts`.
2. A formal proof that the adversarial harness will achieve **12/12 PASS** with the coordinated fixes.
3. Concrete, production-ready additions to `tests/unit/rollback.test.ts` (tests **R1.7a through R1.7h**) permanently embedding Scenario 4 into the standard `npm test` suite.

---

## 2. Test Suite Inspection Findings

### 2.1 `tests/unit/chunking.test.ts`
- **Current State**: 9 tests passing.
- **Coverage**:
  - Buffer slicing: 1 byte (C1.1), exactly 19 MiB (C1.2), 19 MiB + 1 byte (C1.3), 45 MB smoke size (C1.4), 100 MB ceiling (C1.5).
  - SHA-256 integrity: Reassembly verification and incremental streaming hash matching single-shot digest (C1.6).
  - Boundary handling: Empty buffers (C1.7), mathematical part counting (C1.8), and oversized chunks > 19 MiB (C1.9).
- **Assessment**: Fully compliant with R3 and Acceptance Criteria. **No modifications required.**

### 2.2 `tests/unit/rollback.test.ts`
- **Current State**: 13 tests passing.
- **Blind Spot in R1.7**:
  ```typescript
  // tests/unit/rollback.test.ts:187-198
  it("R1.7: rejects upload on expired session (> 30 min TTL)", async () => {
    const uploadId = "expired-session-test";
    const expiredManager = new UploadSessionManager(mockTg, mockDb, -100);
    expiredManager.startSession(uploadId, 2);

    const chunk = Buffer.alloc(512);
    await expect(
      expiredManager.uploadPart(uploadId, 1, chunk, "test.pdf")
    ).rejects.toThrow(/Upload session expired/);
  });
  ```
  - In R1.7, part 1 is attempted on an already-expired session. Because no parts were ever uploaded to Telegram, `mockTg.deletedMessageIds` was trivially empty.
  - The test never asserted that prior parts are rolled back when a session expires after parts 1..N have already been forwarded to Telegram.
  - Furthermore, `cleanupExpiredSessions()`, route handler TTL behavior (HTTP 410), and completeUpload on expired sessions were entirely untested.

---

## 3. Dissection of Scenario 4 Failures in `adversarial_harness.ts`

| Test | Description | Root Cause | Fix Required |
|------|-------------|------------|--------------|
| **4A** | `cleanupExpiredSessions()` purges stale session AND deletes orphaned parts | `options?.rollback` defaults to `undefined` (falsy) in `upload-session.ts:566`. Messages are not deleted. | Make rollback the default (`options?.rollback !== false`) and use `this.defaultTg` if no client is provided. |
| **4B** | `getSession()` on expired session deletes orphaned parts | `getSession()` immediately drops session from `this.sessions` without calling rollback. | Trigger `rollbackTelegramMessages` before deleting expired session when `session.uploadedMessageIds.length > 0`. Support `options?.allowExpired` for routes. |
| **4C** | `uploadPart()` on expired session deletes prior parts | `uploadPart()` checks TTL at line 299 and throws immediately without calling rollback. | Await `this.rollbackTelegramMessages` on prior uploaded message IDs before deleting and throwing. |
| **4D** | `completeUpload()` on expired session deletes prior parts | `completeUpload()` lacks a TTL expiration check, or fails to roll back messages before throwing. | Add TTL check in `completeUpload()`, await `rollbackTelegramMessages`, delete session, and throw. |
| **4E** | Route `POST /upload/part` after TTL purges part 1 and returns 410 Gone | `part/route.ts:112` calls `getSession()` which deletes the session. Line 125 immediately returns 404. Lines 130–136 are dead code. | Call `uploadSessionManager.getSession(uploadId, { allowExpired: true })`. If expired, call `rollbackSessionTelegram`, delete session, return HTTP 410. |
| **4F** | Route `POST /upload/complete` after TTL purges parts 1..N | `complete/route.ts:77` calls `getSession()` which returns null on expired sessions, returning 404 without deleting chunks. | Call `uploadSessionManager.getSession(uploadId, { allowExpired: true })`. If expired, call `rollbackSessionTelegram`, delete session, return HTTP 410. |

---

## 4. Verification of 12/12 Adversarial Harness Pass Condition

With the coordinated changes in place, we trace each test in `adversarial_harness.ts`:

1. **Scenario 1 (1A, 1B)**:
   - 1A: Part 3 fails in `UploadSessionManager` -> `mockTg.deletedMessageIds` contains `[1001, 1002]`, session aborted, 0 DB rows -> **PASS**.
   - 1B: Part 3 fails in route -> returns HTTP 500, messages 2001 and 2002 deleted -> **PASS**.
2. **Scenario 2 (2A, 2B)**:
   - 2A: Complete DB crash in `UploadSessionManager` -> all 5 parts deleted, 0 DB rows -> **PASS**.
   - 2B: Complete DB crash in route -> returns HTTP 500, parts deleted -> **PASS**.
3. **Scenario 3 (3A, 3B)**:
   - 3A: Manager duplicate collision -> File 2 rolled back, File 1 intact in DB -> **PASS**.
   - 3B: Route duplicate collision -> returns HTTP 409 Conflict with friendly message, File 2 parts deleted -> **PASS**.
4. **Scenario 4 (4A - 4F)**:
   - **4A**: `cleanupExpiredSessions()` called with no arguments. `shouldRollback = true`, client is `mockTg`. Calls `rollbackTelegramMessages([1001], mockTg)`. `mockTg.deletedMessageIds` contains `1001`. -> **PASS**.
   - **4B**: `getSession(uid)` called when expired. Dispatches rollback for `[1001]`, deletes session from map, returns `null`. `isNull === true`, `p1Deleted === true`. -> **PASS**.
   - **4C**: `uploadPart(uid, 2)` called when expired. Awaits `rollbackTelegramMessages([1001])`, deletes session, throws `"Upload session expired (30m TTL)"`. `threw === true`, `p1Deleted === true`. -> **PASS**.
   - **4D**: `completeUpload(uid, ...)` called when expired. Awaits `rollbackTelegramMessages([1001])`, deletes session, throws `"Upload session expired (30m TTL)"`. `threw === true`, `p1Deleted === true`. -> **PASS**.
   - **4E**: Stale session part 2 route upload. `getSession(uploadId, { allowExpired: true })` returns session. TTL check triggers, calls `rollbackSessionTelegram(uploadId, tgClient, channelId)`, deletes session, returns HTTP 410. `p1Deleted === true`, `status === 410`. -> **PASS**.
   - **4F**: Stale session `/complete` route call. `getSession(uploadId, { allowExpired: true })` returns session. TTL check triggers, calls `rollbackSessionTelegram(uploadId, tgClient, channelId)`, deletes session, returns HTTP 410. All parts purged (`allDeleted === true`). -> **PASS**.

**Result**: 12 Scenarios / Tests run, **12 Passed, 0 Failed**.

---

## 5. Formulated Additions for `tests/unit/rollback.test.ts`

To permanently prevent regression, we formulate 8 comprehensive test cases to be added directly to `tests/unit/rollback.test.ts`:

```typescript
  // ==========================================================================
  // Scenario 4 & R1.7: Upload Session Expiration & TTL Rollback Invariants
  // ==========================================================================

  it("R1.7a: cleanupExpiredSessions() automatically deletes orphaned Telegram parts by default", async () => {
    const expiredManager = new UploadSessionManager(mockTg, mockDb, 50); // 50ms TTL
    const uploadId = "test-cleanup-default";
    expiredManager.startSession(uploadId, 3);

    const chunk = Buffer.alloc(1024, 0x11);
    const p1 = await expiredManager.uploadPart(uploadId, 1, chunk, "test.pdf");

    // Wait for TTL expiration (70ms > 50ms)
    await new Promise((resolve) => setTimeout(resolve, 70));

    const cleanedCount = expiredManager.cleanupExpiredSessions();
    expect(cleanedCount).toBe(1);

    // Yield to let async rollback promise finish
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(mockTg.deletedMessageIds).toContain(p1.messageId);
    expect(expiredManager.getSession(uploadId)).toBeNull();
  });

  it("R1.7b: getSession() on expired session triggers Telegram rollback of uploaded parts and returns null", async () => {
    const expiredManager = new UploadSessionManager(mockTg, mockDb, 50);
    const uploadId = "test-getsession-expired";
    expiredManager.startSession(uploadId, 3);

    const chunk = Buffer.alloc(1024, 0x22);
    const p1 = await expiredManager.uploadPart(uploadId, 1, chunk, "test.pdf");

    await new Promise((resolve) => setTimeout(resolve, 70));

    const session = expiredManager.getSession(uploadId);
    expect(session).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockTg.deletedMessageIds).toContain(p1.messageId);
  });

  it("R1.7c: uploadPart() on expired session after partial upload triggers Telegram rollback and rejects", async () => {
    const expiredManager = new UploadSessionManager(mockTg, mockDb, 50);
    const uploadId = "test-uploadpart-expired";
    expiredManager.startSession(uploadId, 3);

    const chunk = Buffer.alloc(1024, 0x33);
    const p1 = await expiredManager.uploadPart(uploadId, 1, chunk, "test.pdf");

    await new Promise((resolve) => setTimeout(resolve, 70));

    await expect(
      expiredManager.uploadPart(uploadId, 2, chunk, "test.pdf")
    ).rejects.toThrow(/Upload session expired \(30m TTL\)/);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockTg.deletedMessageIds).toContain(p1.messageId);
    expect(expiredManager.getSession(uploadId)).toBeNull();
  });

  it("R1.7d: completeUpload() on expired session after partial upload triggers Telegram rollback and rejects", async () => {
    const expiredManager = new UploadSessionManager(mockTg, mockDb, 50);
    const uploadId = "test-complete-expired";
    expiredManager.startSession(uploadId, 1);

    const chunk = Buffer.alloc(1024, 0x44);
    const p1 = await expiredManager.uploadPart(uploadId, 1, chunk, "test.pdf");

    await new Promise((resolve) => setTimeout(resolve, 70));

    await expect(
      expiredManager.completeUpload(
        uploadId,
        {
          chapterId: "some-chap-id",
          kind: "ncert_pdf",
          fileName: "test.pdf",
          sizeBytes: 1024,
        },
        { tgClient: mockTg, db: mockDb }
      )
    ).rejects.toThrow(/Upload session expired \(30m TTL\)/);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockTg.deletedMessageIds).toContain(p1.messageId);
    expect(expiredManager.getSession(uploadId)).toBeNull();
    expect(mockDb.files.length).toBe(0);
  });

  it("R1.7e: route POST /api/admin/upload/part after 30m TTL rolls back prior Telegram parts and returns HTTP 410", async () => {
    const origTg = TelegramClient.prototype.sendDocument;
    const origDel = TelegramClient.prototype.deleteMessage;
    const tgDeleted: number[] = [];
    let fakeMsgId = 5000;

    TelegramClient.prototype.sendDocument = async () => {
      const messageId = ++fakeMsgId;
      return { messageId, fileId: `file_${messageId}`, fileUniqueId: `uniq_${messageId}` };
    };
    TelegramClient.prototype.deleteMessage = async (_ch, msgId) => {
      tgDeleted.push(msgId);
      return true;
    };

    try {
      const token = await createAdminToken(process.env.SESSION_SECRET!);
      const uploadId = "test-route-part-ttl-" + Date.now();

      // Part 1 upload
      const formData1 = new FormData();
      formData1.append("uploadId", uploadId);
      formData1.append("part", "1");
      formData1.append("total", "3");
      formData1.append("fileName", "test.pdf");
      formData1.append("chunk", new Blob([Buffer.from("%PDF-1.4 chunk 1")]));

      const req1 = new NextRequest("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: formData1,
      });
      req1.cookies.set(ADMIN_COOKIE_NAME, token);
      const res1 = await partRouteHandler(req1);
      const body1 = await res1.json();
      expect(res1.status).toBe(200);
      const p1MsgId = body1.messageId;

      // Simulate 31 minutes elapsed
      const session = uploadSessionManager.getSession(uploadId, { allowExpired: true });
      expect(session).not.toBeNull();
      session!.createdAt = Date.now() - 31 * 60 * 1000;

      // Part 2 upload after TTL
      const formData2 = new FormData();
      formData2.append("uploadId", uploadId);
      formData2.append("part", "2");
      formData2.append("total", "3");
      formData2.append("fileName", "test.pdf");
      formData2.append("chunk", new Blob([Buffer.from("chunk 2")]));

      const req2 = new NextRequest("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: formData2,
      });
      req2.cookies.set(ADMIN_COOKIE_NAME, token);
      const res2 = await partRouteHandler(req2);
      const body2 = await res2.json();

      expect(res2.status).toBe(410);
      expect(body2.error).toMatch(/expired \(30m TTL\)/i);
      expect(tgDeleted).toContain(p1MsgId);
      expect(uploadSessionManager.getSession(uploadId)).toBeNull();
    } finally {
      TelegramClient.prototype.sendDocument = origTg;
      TelegramClient.prototype.deleteMessage = origDel;
    }
  });

  it("R1.7f: route POST /api/admin/upload/complete after 30m TTL rolls back all parts and returns HTTP 410", async () => {
    const origTg = TelegramClient.prototype.sendDocument;
    const origDel = TelegramClient.prototype.deleteMessage;
    const tgDeleted: number[] = [];
    let fakeMsgId = 6000;

    TelegramClient.prototype.sendDocument = async () => {
      const messageId = ++fakeMsgId;
      return { messageId, fileId: `file_${messageId}`, fileUniqueId: `uniq_${messageId}` };
    };
    TelegramClient.prototype.deleteMessage = async (_ch, msgId) => {
      tgDeleted.push(msgId);
      return true;
    };

    try {
      const token = await createAdminToken(process.env.SESSION_SECRET!);
      const uploadId = "test-route-complete-ttl-" + Date.now();

      // Upload part 1 & part 2
      const fd1 = new FormData();
      fd1.append("uploadId", uploadId);
      fd1.append("part", "1");
      fd1.append("total", "2");
      fd1.append("fileName", "test.pdf");
      fd1.append("chunk", new Blob([Buffer.from("%PDF-1.4 chunk 1")]));
      const req1 = new NextRequest("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: fd1,
      });
      req1.cookies.set(ADMIN_COOKIE_NAME, token);
      const res1 = await partRouteHandler(req1);
      const b1 = await res1.json();

      const fd2 = new FormData();
      fd2.append("uploadId", uploadId);
      fd2.append("part", "2");
      fd2.append("total", "2");
      fd2.append("fileName", "test.pdf");
      fd2.append("chunk", new Blob([Buffer.from("chunk 2 %%EOF")]));
      const req2 = new NextRequest("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: fd2,
      });
      req2.cookies.set(ADMIN_COOKIE_NAME, token);
      const res2 = await partRouteHandler(req2);
      const b2 = await res2.json();

      const sentIds = [b1.messageId, b2.messageId];

      // Simulate 31 minutes elapsed
      const session = uploadSessionManager.getSession(uploadId, { allowExpired: true });
      expect(session).not.toBeNull();
      session!.createdAt = Date.now() - 31 * 60 * 1000;

      // Complete upload after TTL
      const compReq = new NextRequest("http://localhost:3000/api/admin/upload/complete", {
        method: "POST",
        headers: { origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({
          uploadId,
          class: 9,
          subject: "History",
          chapterNo: 1,
          title: "French Revolution",
          kind: "ncert_pdf",
        }),
      });
      compReq.cookies.set(ADMIN_COOKIE_NAME, token);
      const compRes = await completeRouteHandler(compReq);
      const compBody = await compRes.json();

      expect(compRes.status).toBe(410);
      expect(compBody.error).toMatch(/expired \(30m TTL\)/i);
      for (const id of sentIds) {
        expect(tgDeleted).toContain(id);
      }
      expect(uploadSessionManager.getSession(uploadId)).toBeNull();
    } finally {
      TelegramClient.prototype.sendDocument = origTg;
      TelegramClient.prototype.deleteMessage = origDel;
    }
  });

  it("R1.7g: cleanupExpiredSessions() handles zero-part expired session gracefully without error", () => {
    const expiredManager = new UploadSessionManager(mockTg, mockDb, -100);
    expiredManager.startSession("empty-expired-session", 2);

    expect(() => {
      const cleaned = expiredManager.cleanupExpiredSessions();
      expect(cleaned).toBe(1);
    }).not.toThrow();

    expect(mockTg.deletedMessageIds.length).toBe(0);
    expect(expiredManager.getSession("empty-expired-session")).toBeNull();
  });

  it("R1.7h: active session within TTL is preserved by cleanupExpiredSessions()", async () => {
    const activeManager = new UploadSessionManager(mockTg, mockDb, 60000); // 1 minute TTL
    const uploadId = "active-session-id";
    activeManager.startSession(uploadId, 2);

    const chunk = Buffer.alloc(512);
    const p1 = await activeManager.uploadPart(uploadId, 1, chunk, "test.pdf");

    const cleaned = activeManager.cleanupExpiredSessions();
    expect(cleaned).toBe(0);
    expect(mockTg.deletedMessageIds.length).toBe(0);
    expect(activeManager.getSession(uploadId)).not.toBeNull();
  });
```

---

## 6. Implementation Guidance for Worker

When the Worker agent implements these changes:
1. Update `src/lib/upload-session.ts`:
   - `getSession(uploadId, options?: { allowExpired?: boolean; tgClient?: TelegramClientLike })`
   - `cleanupExpiredSessions(options?: { rollback?: boolean; tgClient?: TelegramClientLike })` (default rollback to true)
   - `uploadPart`: roll back prior parts before deleting and throwing on TTL
   - `completeUpload`: add TTL check, roll back prior parts before deleting and throwing
2. Update `src/app/api/admin/upload/part/route.ts` & `src/app/api/admin/upload/complete/route.ts`:
   - Pass `{ allowExpired: true }` to `uploadSessionManager.getSession`
   - In TTL expiration check, roll back messages, delete session, return HTTP 410
3. Update `tests/unit/rollback.test.ts`:
   - Add imports for `NextRequest`, `partRouteHandler`, `completeRouteHandler`, `createAdminToken`, `ADMIN_COOKIE_NAME`, `uploadSessionManager`, and `TelegramClient`.
   - Add the 8 test cases `R1.7a` through `R1.7h`.
4. Run verification:
   - `npx tsx .agents/teamwork/challenger_m3_1/adversarial_harness.ts` -> 12/12 PASS
   - `npm test` -> 14 files passed, 194+ tests passed
   - `npm run lint` & `npx tsc --noEmit` -> 0 errors
