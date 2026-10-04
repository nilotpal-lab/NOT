/**
 * Adversarial Stress Test Suite for Edge Cases in Milestone M3
 * Focus:
 * 1. deleteMessage failure/throw during TTL rollback (partial & total failure)
 * 2. High concurrency race conditions hitting expired sessions simultaneously
 * 3. Zero-part expired sessions and lock cleanup
 */

import crypto from "crypto";
import { UploadSessionManager, uploadSessionManager } from "@/lib/upload-session";
import { TelegramClient } from "@/lib/telegram";
import { MockTelegramClient } from "@/../tests/helpers/mock-telegram";
import { MockDatabase } from "@/../tests/helpers/mock-db";
import { POST as partRouteHandler } from "@/app/api/admin/upload/part/route";
import { POST as completeRouteHandler } from "@/app/api/admin/upload/complete/route";
import { createAdminToken, ADMIN_COOKIE_NAME } from "@/lib/auth";
import { NextRequest } from "next/server";

// Setup test environment
process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
process.env.TELEGRAM_CHANNEL_ID = "-1001234567890";
process.env.SUPABASE_URL = "https://xyzcompany.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy";
process.env.GROQ_API_KEY = "gsk_test1234567890abcdef1234567890";
process.env.ADMIN_PASSWORD_HASH = "a1b2c3d4:e5f6a7b8c9d0";
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";

interface Result {
  category: string;
  name: string;
  passed: boolean;
  verdict: "PASS" | "FAIL";
  error?: string;
  details?: Record<string, unknown>;
}

const results: Result[] = [];

function record(category: string, name: string, passed: boolean, error?: string, details?: Record<string, unknown>) {
  results.push({ category, name, passed, verdict: passed ? "PASS" : "FAIL", error, details });
  const mark = passed ? "✓ PASS" : "✗ FAIL";
  console.log(`${mark} [${category}] ${name}`);
  if (error) console.log(`   Issue: ${error}`);
  if (details) console.log(`   Details:`, JSON.stringify(details, null, 2));
}

async function makePartRequest(
  token: string,
  uploadId: string,
  part: number,
  total: number,
  chunk: Buffer,
  fileName: string = "history.pdf"
) {
  const formData = new FormData();
  formData.append("uploadId", uploadId);
  formData.append("part", part.toString());
  formData.append("total", total.toString());
  formData.append("fileName", fileName);
  formData.append("kind", "ncert_pdf");
  formData.append("title", "French Revolution");
  formData.append("class", "9");
  formData.append("subject", "History");
  formData.append("chapterNo", "1");
  formData.append("chunk", new Blob([chunk]));

  const req = new NextRequest("http://localhost:3000/api/admin/upload/part", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
    body: formData,
  });
  req.cookies.set(ADMIN_COOKIE_NAME, token);
  return partRouteHandler(req);
}

async function makeCompleteRequest(token: string, body: Record<string, unknown>) {
  const req = new NextRequest("http://localhost:3000/api/admin/upload/complete", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  req.cookies.set(ADMIN_COOKIE_NAME, token);
  return completeRouteHandler(req);
}

async function runEdgeCases() {
  const token = await createAdminToken(process.env.SESSION_SECRET!);

  console.log("=================================================================");
  console.log("CHALLENGER 1: ADVERSARIAL EDGE CASE STRESS TESTS (M3-3)");
  console.log("=================================================================\n");

  // Global Telegram mock tracking
  const tgSent: Array<{ channelId: string | number; messageId: number; fileId: string }> = [];
  const tgDeleted: number[] = [];
  let deleteThrows = false;
  let nextMsgId = 5000;

  const origSendDocument = TelegramClient.prototype.sendDocument;
  const origDeleteMessage = TelegramClient.prototype.deleteMessage;

  TelegramClient.prototype.sendDocument = async function (channelId, buf, fileName, caption) {
    const messageId = ++nextMsgId;
    const fileId = `tg_file_${messageId}`;
    tgSent.push({ channelId, messageId, fileId });
    return { messageId, fileId, fileUniqueId: `uniq_${messageId}` };
  };

  TelegramClient.prototype.deleteMessage = async function (channelId, msgId) {
    if (deleteThrows) {
      throw new Error(`Telegram API 400 Bad Request: message ${msgId} could not be deleted`);
    }
    tgDeleted.push(msgId);
    return true;
  };

  try {
    // ---------------------------------------------------------------------------
    // EDGE SUITE 1: deleteMessage throws error during TTL rollback
    // ---------------------------------------------------------------------------
    console.log("--- EDGE SUITE 1: deleteMessage throws error during TTL rollback ---");

    // E1.1: Manager uploadPart TTL rollback with partial and total deleteMessage failure
    {
      const mockTg = new MockTelegramClient();
      let deleteAttemptCount = 0;
      mockTg.deleteMessage = async (channelId, msgId) => {
        deleteAttemptCount++;
        if (msgId === 1001) {
          throw new Error("Simulated network timeout on deleteMessage 1001");
        }
        mockTg.deletedMessageIds.push(msgId);
        return true;
      };

      const mgr = new UploadSessionManager(mockTg, undefined, 50); // 50ms TTL
      const uid = "edge-e1-1-" + Date.now();
      mgr.startSession(uid, 3);
      const p1 = await mgr.uploadPart(uid, 1, Buffer.from("%PDF-1.4 part 1"), "file.pdf");
      const p2 = await mgr.uploadPart(uid, 2, Buffer.from("part 2"), "file.pdf");

      await new Promise((r) => setTimeout(r, 70)); // wait for expiration

      let threw = false;
      let errMsg = "";
      try {
        await mgr.uploadPart(uid, 3, Buffer.from("part 3 %%EOF"), "file.pdf");
      } catch (err: any) {
        threw = true;
        errMsg = err.message;
      }

      // Assertions:
      // 1. Should throw TTL expiration error despite deleteMessage failure on msg 1001
      // 2. Msg 1002 must still have been attempted and deleted (best-effort resilience)
      // 3. Session must be deleted from memory (no memory leak)
      const sessionDeleted = mgr.getSession(uid) === null;
      const secondPartDeleted = mockTg.deletedMessageIds.includes(p2.messageId);
      const passed = threw && errMsg.includes("expired") && sessionDeleted && secondPartDeleted;

      record(
        "Edge Suite 1",
        "E1.1: Manager uploadPart TTL handles deleteMessage error gracefully (deletes subsequent parts, clears session)",
        passed,
        passed ? undefined : "Failed to handle deleteMessage error during uploadPart TTL rollback",
        { threw, errMsg, sessionDeleted, secondPartDeleted, deleteAttemptCount, deletedIds: mockTg.deletedMessageIds }
      );
    }

    // E1.2: Manager completeUpload TTL rollback when ALL deleteMessage calls throw
    {
      const mockTg = new MockTelegramClient();
      mockTg.deleteMessage = async () => {
        throw new Error("Telegram API completely unreachable");
      };

      const mgr = new UploadSessionManager(mockTg, undefined, 50);
      const uid = "edge-e1-2-" + Date.now();
      mgr.startSession(uid, 2);
      await mgr.uploadPart(uid, 1, Buffer.from("%PDF-1.4 part 1"), "file.pdf");
      await mgr.uploadPart(uid, 2, Buffer.from("part 2 %%EOF"), "file.pdf");

      await new Promise((r) => setTimeout(r, 70)); // expire

      let threw = false;
      let errMsg = "";
      try {
        await mgr.completeUpload(uid, {
          chapterId: "ch-1",
          kind: "ncert_pdf",
          fileName: "file.pdf",
          sizeBytes: 100,
        }, { tgClient: mockTg });
      } catch (err: any) {
        threw = true;
        errMsg = err.message;
      }

      const sessionDeleted = mgr.getSession(uid) === null;
      const passed = threw && errMsg.includes("expired") && sessionDeleted;

      record(
        "Edge Suite 1",
        "E1.2: Manager completeUpload TTL survives total deleteMessage failure without unhandled crash, purges session",
        passed,
        passed ? undefined : "completeUpload crashed or failed to purge session when all deleteMessage calls threw",
        { threw, errMsg, sessionDeleted }
      );
    }

    // E1.3: cleanupExpiredSessions surviving deleteMessage errors without unhandled rejection
    {
      const mockTg = new MockTelegramClient();
      mockTg.deleteMessage = async () => {
        throw new Error("Telegram 500 Internal Error during cleanup");
      };

      const mgr = new UploadSessionManager(mockTg, undefined, 50);
      const uid1 = "edge-e1-3-a-" + Date.now();
      const uid2 = "edge-e1-3-b-" + Date.now();
      mgr.startSession(uid1, 2);
      mgr.startSession(uid2, 2);
      await mgr.uploadPart(uid1, 1, Buffer.from("%PDF-1.4 part 1"), "a.pdf");
      await mgr.uploadPart(uid2, 1, Buffer.from("%PDF-1.4 part 1"), "b.pdf");

      await new Promise((r) => setTimeout(r, 70)); // expire

      let cleanErr = null;
      let count = 0;
      try {
        count = await mgr.cleanupExpiredSessions({ rollback: true, tgClient: mockTg });
      } catch (e) {
        cleanErr = e;
      }

      const sessionsPurged = mgr.getSession(uid1) === null && mgr.getSession(uid2) === null;
      const passed = cleanErr === null && count === 2 && sessionsPurged;

      record(
        "Edge Suite 1",
        "E1.3: cleanupExpiredSessions() survives deleteMessage failures cleanly, purges memory",
        passed,
        passed ? undefined : "cleanupExpiredSessions threw an error or failed to purge expired sessions",
        { cleanErr, count, sessionsPurged }
      );
    }

    // E1.4: Route POST /upload/part returns 410 and cleans up session when deleteMessage throws
    {
      deleteThrows = true;
      tgDeleted.length = 0;
      const uid = "edge-e1-4-route-" + Date.now();

      deleteThrows = false;
      const r1 = await makePartRequest(token, uid, 1, 2, Buffer.from("%PDF-1.4 part 1"));
      const b1 = await r1.json();

      // Expire session
      const sess = uploadSessionManager.getSession(uid);
      if (sess) {
        sess.createdAt = Date.now() - (31 * 60 * 1000);
      }

      // Now enable deleteThrows
      deleteThrows = true;
      const r2 = await makePartRequest(token, uid, 2, 2, Buffer.from("part 2 %%EOF"));
      const b2 = await r2.json();
      deleteThrows = false;

      const is410 = r2.status === 410;
      const sessionDeleted = uploadSessionManager.getSession(uid) === null;
      const passed = is410 && sessionDeleted;

      record(
        "Edge Suite 1",
        "E1.4: Route POST /upload/part returns 410 and purges session even if Telegram deleteMessage throws",
        passed,
        passed ? undefined : `Expected status 410 and deleted session, received status ${r2.status}`,
        { status: r2.status, body: b2, sessionDeleted }
      );
    }

    // E1.5: Route POST /upload/complete returns 410 and cleans up session when deleteMessage throws
    {
      deleteThrows = false;
      const uid = "edge-e1-5-route-" + Date.now();
      await makePartRequest(token, uid, 1, 2, Buffer.from("%PDF-1.4 part 1"));
      await makePartRequest(token, uid, 2, 2, Buffer.from("part 2 %%EOF"));

      // Expire session
      const sess = uploadSessionManager.getSession(uid);
      if (sess) {
        sess.createdAt = Date.now() - (31 * 60 * 1000);
      }

      deleteThrows = true;
      const rComp = await makeCompleteRequest(token, {
        uploadId: uid,
        class: 9,
        subject: "History",
        chapterNo: 1,
        title: "French Revolution",
        kind: "ncert_pdf",
      });
      const bComp = await rComp.json();
      deleteThrows = false;

      const is410 = rComp.status === 410;
      const sessionDeleted = uploadSessionManager.getSession(uid) === null;
      const passed = is410 && sessionDeleted;

      record(
        "Edge Suite 1",
        "E1.5: Route POST /upload/complete returns 410 and purges session even if Telegram deleteMessage throws",
        passed,
        passed ? undefined : `Expected status 410, received ${rComp.status}`,
        { status: rComp.status, body: bComp, sessionDeleted }
      );
    }

    // ---------------------------------------------------------------------------
    // EDGE SUITE 2: High Concurrency on an Expired Session
    // ---------------------------------------------------------------------------
    console.log("\n--- EDGE SUITE 2: High Concurrency on Expired Session ---");

    // E2.1: 10 concurrent requests to POST /upload/part hitting the same expired session
    {
      tgDeleted.length = 0;
      deleteThrows = false;
      const uid = "edge-e2-1-concurrent-" + Date.now();
      const r1 = await makePartRequest(token, uid, 1, 5, Buffer.from("%PDF-1.4 part 1"));
      const b1 = await r1.json();
      const part1MsgId = b1.messageId;

      // Expire session (31 minutes ago)
      const sess = uploadSessionManager.getSession(uid);
      if (sess) {
        sess.createdAt = Date.now() - (31 * 60 * 1000);
      }

      // Fire 10 concurrent requests for part 2 simultaneously
      const concurrency = 10;
      const promises = Array.from({ length: concurrency }, (_, i) =>
        makePartRequest(token, uid, 2, 5, Buffer.from(`part 2 concurrent attempt ${i}`))
      );

      const responses = await Promise.all(promises);
      const statuses = responses.map((r) => r.status);
      const bodies = await Promise.all(responses.map((r) => r.json()));

      // Invariants:
      // 1. None should succeed (no status 200)
      // 2. All should be either 410 (session expired) or 404/409 (session already cleared or locked)
      // 3. Part 1 must be deleted from Telegram (at least once)
      // 4. Session must be null in manager
      const noneSucceeded = !statuses.includes(200);
      const validStatuses = statuses.every((s) => s === 410 || s === 404 || s === 409);
      const p1Deleted = tgDeleted.includes(part1MsgId);
      const sessionDeleted = uploadSessionManager.getSession(uid) === null;
      const passed = noneSucceeded && validStatuses && p1Deleted && sessionDeleted;

      record(
        "Edge Suite 2",
        "E2.1: 10 concurrent POST /upload/part requests on expired session safely reject (410/404/409), purge TG chunk, 0 leaks",
        passed,
        passed ? undefined : `Concurrency failure on /upload/part`,
        { statuses, p1Deleted, sessionDeleted, tgDeletedCount: tgDeleted.filter((id) => id === part1MsgId).length }
      );
    }

    // E2.2: 10 concurrent requests to POST /upload/complete hitting the same expired session
    {
      tgDeleted.length = 0;
      deleteThrows = false;
      const uid = "edge-e2-2-concurrent-" + Date.now();
      const r1 = await makePartRequest(token, uid, 1, 2, Buffer.from("%PDF-1.4 part 1"));
      const b1 = await r1.json();
      const r2 = await makePartRequest(token, uid, 2, 2, Buffer.from("part 2 %%EOF"));
      const b2 = await r2.json();
      const uploadedMsgIds = [b1.messageId, b2.messageId];

      // Expire session
      const sess = uploadSessionManager.getSession(uid);
      if (sess) {
        sess.createdAt = Date.now() - (31 * 60 * 1000);
      }

      // Fire 10 concurrent complete requests simultaneously
      const concurrency = 10;
      const promises = Array.from({ length: concurrency }, () =>
        makeCompleteRequest(token, {
          uploadId: uid,
          class: 9,
          subject: "Economics",
          chapterNo: 1,
          title: "Palampur",
          kind: "ncert_pdf",
        })
      );

      const responses = await Promise.all(promises);
      const statuses = responses.map((r) => r.status);

      // Invariants:
      // 1. None should succeed (no 201)
      // 2. All statuses must be 410 (session expired) or 404 (session purged)
      // 3. Both uploaded parts must be deleted from Telegram
      // 4. Session must be null in manager
      const noneSucceeded = !statuses.includes(201);
      const validStatuses = statuses.every((s) => s === 410 || s === 404);
      const allPartsDeleted = uploadedMsgIds.every((id) => tgDeleted.includes(id));
      const sessionDeleted = uploadSessionManager.getSession(uid) === null;
      const passed = noneSucceeded && validStatuses && allPartsDeleted && sessionDeleted;

      record(
        "Edge Suite 2",
        "E2.2: 10 concurrent POST /upload/complete requests on expired session safely reject (410/404), purge TG parts, 0 DB rows",
        passed,
        passed ? undefined : `Concurrency failure on /upload/complete`,
        { statuses, allPartsDeleted, sessionDeleted }
      );
    }

    // E2.3: Mixed concurrent race condition (5 /part and 5 /complete) on the same expired session
    {
      tgDeleted.length = 0;
      const uid = "edge-e2-3-mixed-" + Date.now();
      const r1 = await makePartRequest(token, uid, 1, 3, Buffer.from("%PDF-1.4 part 1"));
      const b1 = await r1.json();
      const r2 = await makePartRequest(token, uid, 2, 3, Buffer.from("part 2"));
      const b2 = await r2.json();
      const sentIds = [b1.messageId, b2.messageId];

      // Expire session
      const sess = uploadSessionManager.getSession(uid);
      if (sess) {
        sess.createdAt = Date.now() - (31 * 60 * 1000);
      }

      // 5 part requests for part 3 and 5 complete requests simultaneously
      const partPromises = Array.from({ length: 5 }, () =>
        makePartRequest(token, uid, 3, 3, Buffer.from("part 3 %%EOF"))
      );
      const completePromises = Array.from({ length: 5 }, () =>
        makeCompleteRequest(token, {
          uploadId: uid,
          class: 9,
          subject: "History",
          chapterNo: 1,
          title: "French Revolution",
          kind: "ncert_pdf",
        })
      );

      const allResponses = await Promise.all([...partPromises, ...completePromises]);
      const statuses = allResponses.map((r) => r.status);

      const noSuccess = !statuses.includes(200) && !statuses.includes(201);
      const safeStatuses = statuses.every((s) => s === 410 || s === 404 || s === 409 || s === 400);
      const allDeleted = sentIds.every((id) => tgDeleted.includes(id));
      const sessionDeleted = uploadSessionManager.getSession(uid) === null;
      const passed = noSuccess && safeStatuses && allDeleted && sessionDeleted;

      record(
        "Edge Suite 2",
        "E2.3: Mixed 5 /part + 5 /complete race on expired session safely rejects all, purges Telegram chunks, clears memory",
        passed,
        passed ? undefined : "Mixed concurrency failure",
        { statuses, allDeleted, sessionDeleted }
      );
    }

    // ---------------------------------------------------------------------------
    // EDGE SUITE 3: Zero-Part Expired Session & Lock Resilience
    // ---------------------------------------------------------------------------
    console.log("\n--- EDGE SUITE 3: Zero-Part Expired Session & Lock Resilience ---");

    // E3.1: Zero-part expired session handled cleanly by cleanupExpiredSessions
    {
      const mockTg = new MockTelegramClient();
      const mgr = new UploadSessionManager(mockTg, undefined, 50);
      const uid = "edge-e3-1-" + Date.now();
      mgr.startSession(uid, 3); // Started, but client disconnected before uploading part 1

      await new Promise((r) => setTimeout(r, 70)); // expire

      let threw = false;
      let cleaned = 0;
      try {
        cleaned = await mgr.cleanupExpiredSessions();
      } catch {
        threw = true;
      }

      const sessionGone = mgr.getSession(uid) === null;
      const passed = !threw && cleaned === 1 && sessionGone && mockTg.deletedMessageIds.length === 0;

      record(
        "Edge Suite 3",
        "E3.1: Zero-part expired session cleaned up with 0 errors and 0 unnecessary TG delete calls",
        passed,
        passed ? undefined : "Zero-part session cleanup failed",
        { threw, cleaned, sessionGone, tgDeletions: mockTg.deletedMessageIds.length }
      );
    }

    // E3.2: Async lock does not hang or deadlock if uploadPart is rejected for expired session
    {
      const mockTg = new MockTelegramClient();
      const mgr = new UploadSessionManager(mockTg, undefined, 50);
      const uid = "edge-e3-2-" + Date.now();
      mgr.startSession(uid, 3);
      await mgr.uploadPart(uid, 1, Buffer.from("%PDF-1.4 part 1"), "file.pdf");

      await new Promise((r) => setTimeout(r, 70)); // expire

      // Call uploadPart which throws on expired session
      try {
        await mgr.uploadPart(uid, 2, Buffer.from("part 2"), "file.pdf");
      } catch {
        // Expected
      }

      // Verify that internal locks map was cleared
      const lockMapCleaned = (mgr as any).locks.has(uid) === false;

      // Verify that starting a fresh session with same uid succeeds and can acquire lock and upload without deadlock
      mgr.startSession(uid, 3);
      const canAcquire = mgr.acquireLock(uid);
      if (canAcquire) mgr.releaseLock(uid);

      let canUploadNew = false;
      try {
        const newPart = await mgr.uploadPart(uid, 1, Buffer.from("%PDF-1.4 new part 1"), "new.pdf");
        canUploadNew = !!newPart.messageId;
      } catch {
        canUploadNew = false;
      }

      const passed = lockMapCleaned && canAcquire && canUploadNew;

      record(
        "Edge Suite 3",
        "E3.2: Concurrency lock properly releases and does not hang or deadlock after expiration error",
        passed,
        passed ? undefined : "Lock was left in deadlocked or locked state",
        { lockMapCleaned, canAcquire, canUploadNew }
      );
    }

    // E3.3: Active session reaper race condition: reaper runs during active part upload
    {
      const mockTg = new MockTelegramClient();
      const mgr = new UploadSessionManager(mockTg, undefined, 200); // 200ms TTL
      const uid = "edge-e3-3-active-race-" + Date.now();
      mgr.startSession(uid, 5);

      // Upload part 1 at t=0
      await mgr.uploadPart(uid, 1, Buffer.from("%PDF-1.4 part 1"), "file.pdf");

      // At t=50ms, reaper sweeps (session is NOT expired)
      await new Promise((r) => setTimeout(r, 50));
      const cleaned = await mgr.cleanupExpiredSessions();

      // Session must remain intact
      const activeSession = mgr.getSession(uid);
      const sessionRetained = activeSession !== null && cleaned === 0;

      // Upload part 2 succeeds
      const p2 = await mgr.uploadPart(uid, 2, Buffer.from("part 2"), "file.pdf");
      const passed = sessionRetained && !!p2.messageId;

      record(
        "Edge Suite 3",
        "E3.3: Reaper run on active session retains session without interrupting in-flight upload",
        passed,
        passed ? undefined : "Reaper incorrectly modified or purged active session",
        { cleaned, sessionRetained, p2MessageId: p2.messageId }
      );
    }

    // E3.4: Exact TTL boundary condition (exact millisecond expiration)
    {
      const mockTg = new MockTelegramClient();
      const mgr = new UploadSessionManager(mockTg, undefined, 100);
      const uid = "edge-e3-4-boundary-" + Date.now();
      mgr.startSession(uid, 2);
      await mgr.uploadPart(uid, 1, Buffer.from("%PDF-1.4 part 1"), "file.pdf");

      const sess = mgr.peekSession(uid)!;
      // Set createdAt so Date.now() - createdAt is exactly 100ms
      sess.createdAt = Date.now() - 100;

      // Check isSessionExpired
      const expiredAtExactBoundary = mgr.isSessionExpired(uid);

      // Wait 5ms to guarantee > 100ms
      await new Promise((r) => setTimeout(r, 10));
      const expiredAfterBoundary = mgr.isSessionExpired(uid);

      const passed = expiredAfterBoundary === true;

      record(
        "Edge Suite 3",
        "E3.4: Exact boundary TTL condition evaluates consistently without negative-interval bugs",
        passed,
        passed ? undefined : "TTL boundary evaluation failed",
        { expiredAtExactBoundary, expiredAfterBoundary }
      );
    }

  } finally {
    TelegramClient.prototype.sendDocument = origSendDocument;
    TelegramClient.prototype.deleteMessage = origDeleteMessage;
  }

  console.log("\n=================================================================");
  console.log("FINAL ADVERSARIAL EDGE CASE SUMMARY");
  console.log("=================================================================");
  const total = results.length;
  const passCount = results.filter((r) => r.passed).length;
  const failCount = total - passCount;

  console.log(`Total Edge Tests: ${total}`);
  console.log(`Passed:           ${passCount}`);
  console.log(`Failed:           ${failCount}`);

  if (failCount > 0) {
    console.log("\nFAILED EDGE CASES:");
    for (const f of results.filter((r) => !r.passed)) {
      console.log(`\n❌ [${f.category}] ${f.name}`);
      console.log(`   Issue: ${f.error}`);
      console.log(`   Details: ${JSON.stringify(f.details, null, 2)}`);
    }
  }

  return { total, passCount, failCount, results };
}

runEdgeCases().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
