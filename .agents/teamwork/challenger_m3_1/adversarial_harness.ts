/**
 * Full Adversarial Stress Test Suite for Milestone M3
 * Tests both Manager level and Next.js Route Handler level across all 4 scenarios.
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
import * as dbModule from "@/lib/db";
import * as catalogModule from "@/lib/catalog";

// Setup mock environment
process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
process.env.TELEGRAM_CHANNEL_ID = "-1001234567890";
process.env.SUPABASE_URL = "https://xyzcompany.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy";
process.env.GROQ_API_KEY = "gsk_test1234567890abcdef1234567890";
process.env.ADMIN_PASSWORD_HASH = "a1b2c3d4:e5f6a7b8c9d0";
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";

interface Result {
  scenario: string;
  name: string;
  passed: boolean;
  verdict: "PASS" | "FAIL";
  error?: string;
  details?: Record<string, unknown>;
}

const results: Result[] = [];

function record(scenario: string, name: string, passed: boolean, error?: string, details?: Record<string, unknown>) {
  results.push({ scenario, name, passed, verdict: passed ? "PASS" : "FAIL", error, details });
  const mark = passed ? "✓ PASS" : "✗ FAIL";
  console.log(`${mark} [${scenario}] ${name}`);
  if (error) console.log(`   Issue: ${error}`);
  if (details) console.log(`   Details:`, JSON.stringify(details, null, 2));
}

// Helper to make authenticated requests with binary form
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
    headers: {
      origin: "http://localhost:3000",
    },
    body: formData,
  });
  req.cookies.set(ADMIN_COOKIE_NAME, token);
  return partRouteHandler(req);
}

// Helper to make authenticated complete requests
async function makeCompleteRequest(token: string, body: Record<string, unknown>) {
  const req = new NextRequest("http://localhost:3000/api/admin/upload/complete", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  req.cookies.set(ADMIN_COOKIE_NAME, token);
  return completeRouteHandler(req);
}

async function runAdversarialSuite() {
  const token = await createAdminToken(process.env.SESSION_SECRET!);

  console.log("=================================================================");
  console.log("CHALLENGER 1: EMPIRICAL ADVERSARIAL STRESS TEST SUITE (M3)");
  console.log("=================================================================\n");

  // Track all telegram calls made through real TelegramClient during route tests
  const tgSent: Array<{ channelId: string | number; messageId: number; fileId: string }> = [];
  const tgDeleted: number[] = [];
  let tgFailOnPart: number | null = null;
  let nextMsgId = 2000;

  // Spy on TelegramClient prototype
  const origSendDocument = TelegramClient.prototype.sendDocument;
  const origDeleteMessage = TelegramClient.prototype.deleteMessage;

  TelegramClient.prototype.sendDocument = async function (channelId, buf, fileName, caption) {
    const partMatch = caption?.match(/part=(\d+)\/(\d+)/);
    const partNo = partMatch ? parseInt(partMatch[1], 10) : 1;
    if (tgFailOnPart !== null && partNo === tgFailOnPart) {
      throw new Error(`Simulated Telegram error on part ${partNo}`);
    }
    const messageId = ++nextMsgId;
    const fileId = `tg_file_${messageId}`;
    const record = { channelId, messageId, fileId };
    tgSent.push(record);
    return { messageId, fileId, fileUniqueId: `uniq_${messageId}` };
  };

  TelegramClient.prototype.deleteMessage = async function (channelId, msgId) {
    tgDeleted.push(msgId);
    return true;
  };

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Failure on part 3 of 5
  // ---------------------------------------------------------------------------
  console.log("--- SCENARIO 1: Failure on part 3 of 5 ---");
  // 1A: Manager level
  {
    const mockTg = new MockTelegramClient();
    const mockDb = new MockDatabase();
    const mgr = new UploadSessionManager(mockTg, mockDb);
    const uid = "adv-scen1-mgr";
    mgr.startSession(uid, 5);
    const chunk = Buffer.from("%PDF-1.4 dummy valid PDF chunk");
    const p1 = await mgr.uploadPart(uid, 1, chunk, "test.pdf");
    const p2 = await mgr.uploadPart(uid, 2, chunk, "test.pdf");

    mockTg.failOnPartNumber = 3;
    let threw = false;
    try {
      await mgr.uploadPart(uid, 3, chunk, "test.pdf");
    } catch {
      threw = true;
    }

    const msgsDeleted =
      mockTg.deletedMessageIds.includes(p1.messageId) &&
      mockTg.deletedMessageIds.includes(p2.messageId);
    const sessionAborted = mgr.getSession(uid) === null;
    const dbZero = mockDb.files.length === 0 && mockDb.fileParts.length === 0;

    record(
      "Scenario 1",
      "1A: (Manager) Part 3 of 5 fails -> deletes parts 1 & 2, aborts session, 0 DB rows",
      threw && msgsDeleted && sessionAborted && dbZero,
      undefined,
      { threw, msgsDeleted, sessionAborted, dbZero, deletedIds: mockTg.deletedMessageIds }
    );
  }

  // 1B: Route level
  {
    tgSent.length = 0;
    tgDeleted.length = 0;
    tgFailOnPart = null;
    const uid = "adv-scen1-route-" + Date.now();

    const pdfChunk1 = Buffer.from("%PDF-1.4 start of pdf content part 1");
    const pdfChunk2 = Buffer.from("middle of pdf content part 2");
    const pdfChunk3 = Buffer.from("failing part 3");

    const res1 = await makePartRequest(token, uid, 1, 5, pdfChunk1);
    const body1 = await res1.json();
    const msg1Id = body1.messageId;

    const res2 = await makePartRequest(token, uid, 2, 5, pdfChunk2);
    const body2 = await res2.json();
    const msg2Id = body2.messageId;

    // Now induce failure on part 3
    tgFailOnPart = 3;
    const res3 = await makePartRequest(token, uid, 3, 5, pdfChunk3);
    const body3 = await res3.json();

    const is500 = res3.status === 500;
    const msgsDeleted = tgDeleted.includes(msg1Id) && tgDeleted.includes(msg2Id);
    const sessionGone = uploadSessionManager.getSession(uid) === null;

    record(
      "Scenario 1",
      "1B: (Route POST /upload/part) Part 3 of 5 fails -> HTTP 500, deletes parts 1 & 2, aborts session",
      is500 && msgsDeleted && sessionGone,
      undefined,
      { status: res3.status, body: body3, msgsDeleted, sessionGone, tgDeleted }
    );
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Failure during DB insert on /complete
  // ---------------------------------------------------------------------------
  console.log("\n--- SCENARIO 2: Failure during DB insert on /complete ---");
  // 2A: Manager level
  {
    const mockTg = new MockTelegramClient();
    const mockDb = new MockDatabase();
    const mgr = new UploadSessionManager(mockTg, mockDb);
    const uid = "adv-scen2-mgr";
    mgr.startSession(uid, 5);
    const chunk = Buffer.from("%PDF-1.4 dummy");
    const uploadedIds: number[] = [];
    for (let i = 1; i <= 5; i++) {
      const p = await mgr.uploadPart(uid, i, chunk, "test.pdf");
      uploadedIds.push(p.messageId);
    }

    const failingDb = {
      insertFile: () => {
        throw new Error("Simulated Postgres insertion crash");
      },
    };

    let threw = false;
    try {
      await mgr.completeUpload(
        uid,
        {
          chapterId: "some-uuid",
          kind: "ncert_pdf",
          fileName: "test.pdf",
          sizeBytes: 5 * chunk.length,
        },
        { db: failingDb, tgClient: mockTg }
      );
    } catch {
      threw = true;
    }

    const allDeleted = uploadedIds.every((id) => mockTg.deletedMessageIds.includes(id));
    const sessionGone = mgr.getSession(uid) === null;
    const dbZero = mockDb.files.length === 0;

    record(
      "Scenario 2",
      "2A: (Manager) completeUpload DB crash -> deletes all 5 parts, aborts session, 0 DB rows",
      threw && allDeleted && sessionGone && dbZero,
      undefined,
      { threw, allDeleted, sessionGone, dbZero, deletedIds: mockTg.deletedMessageIds }
    );
  }

  // 2B: Route level
  {
    tgSent.length = 0;
    tgDeleted.length = 0;
    tgFailOnPart = null;
    const uid = "adv-scen2-route-" + Date.now();

    const pdfChunk1 = Buffer.from("%PDF-1.4 start part 1");
    const pdfChunk2 = Buffer.from("end part 2 %%EOF");

    const r1 = await makePartRequest(token, uid, 1, 2, pdfChunk1);
    const b1 = await r1.json();
    const r2 = await makePartRequest(token, uid, 2, 2, pdfChunk2);
    const b2 = await r2.json();

    const sentIds = [b1.messageId, b2.messageId];

    // Mock DB failure by stubbing findOrCreateChapter or insertFile
    const origFindOrCreate = catalogModule.findOrCreateChapter;
    (catalogModule as any).findOrCreateChapter = async () => {
      throw new Error("Simulated Supabase DB down");
    };

    let completeRes;
    try {
      completeRes = await makeCompleteRequest(token, {
        uploadId: uid,
        class: 9,
        subject: "History",
        chapterNo: 1,
        title: "French Revolution",
        kind: "ncert_pdf",
      });
    } finally {
      (catalogModule as any).findOrCreateChapter = origFindOrCreate;
    }

    const is500 = completeRes.status === 500;
    const allDeleted = sentIds.every((id) => tgDeleted.includes(id));
    const sessionGone = uploadSessionManager.getSession(uid) === null;

    record(
      "Scenario 2",
      "2B: (Route POST /upload/complete) DB failure -> HTTP 500, deletes parts 1..N, aborts session",
      is500 && allDeleted && sessionGone,
      undefined,
      { status: completeRes.status, allDeleted, sessionGone, tgDeleted, sentIds }
    );
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Duplicate collision (chapter_id, sha256)
  // ---------------------------------------------------------------------------
  console.log("\n--- SCENARIO 3: Duplicate collision (chapter_id, sha256) ---");
  // 3A: Manager level
  {
    const mockTg = new MockTelegramClient();
    const mockDb = new MockDatabase();
    const mgr = new UploadSessionManager(mockTg, mockDb);

    const ch = mockDb.findOrCreateChapter({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "Village Palampur",
    });

    const file1Uid = "adv-scen3-mgr-f1";
    mgr.startSession(file1Uid, 2);
    const chunk1 = Buffer.from("%PDF-1.4 file 1 chunk 1");
    const chunk2 = Buffer.from("file 1 chunk 2 %%EOF");
    await mgr.uploadPart(file1Uid, 1, chunk1, "f1.pdf");
    await mgr.uploadPart(file1Uid, 2, chunk2, "f1.pdf");
    const f1 = await mgr.completeUpload(file1Uid, {
      chapterId: ch.id,
      kind: "ncert_pdf",
      fileName: "f1.pdf",
      sizeBytes: chunk1.length + chunk2.length,
    });

    // File 2 identical content
    const file2Uid = "adv-scen3-mgr-f2";
    mgr.startSession(file2Uid, 2);
    const f2p1 = await mgr.uploadPart(file2Uid, 1, chunk1, "f2.pdf");
    const f2p2 = await mgr.uploadPart(file2Uid, 2, chunk2, "f2.pdf");

    let threw = false;
    try {
      await mgr.completeUpload(file2Uid, {
        chapterId: ch.id,
        kind: "ncert_pdf",
        fileName: "f2.pdf",
        sizeBytes: chunk1.length + chunk2.length,
      });
    } catch {
      threw = true;
    }

    const f2Purged =
      mockTg.deletedMessageIds.includes(f2p1.messageId) &&
      mockTg.deletedMessageIds.includes(f2p2.messageId);
    const dbHasOnly1 = mockDb.files.length === 1;

    record(
      "Scenario 3",
      "3A: (Manager) Duplicate file collision rejects, purges File 2 parts, leaves File 1 intact",
      threw && f2Purged && dbHasOnly1,
      undefined,
      { threw, f2Purged, dbHasOnly1, dbFiles: mockDb.files.length }
    );
  }

  // 3B: Route level
  {
    tgSent.length = 0;
    const origFetch = globalThis.fetch;
    const origGetDb = dbModule.getDb;

    globalThis.fetch = async (input: any, init?: any): Promise<Response> => {
      const urlStr = typeof input === "string" ? input : input?.url || "";
      // Intercept Supabase REST calls
      if (urlStr.includes("/rest/v1/chapters")) {
        return new Response(JSON.stringify([{
          id: "chapter-fixed-uuid",
          class: 9,
          subject: "Economics",
          chapter_no: 1,
          title: "Village Palampur",
        }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (urlStr.includes("/rest/v1/files")) {
        // Return existing duplicate file
        return new Response(JSON.stringify([{
          id: "existing-file-uuid",
          file_name: "Original.pdf",
          chapter_id: "chapter-fixed-uuid",
          sha256: "colliding_sha",
        }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return origFetch(input, init);
    };

    const uid = "adv-scen3-route-dup-" + Date.now();
    const pdf1 = Buffer.from("%PDF-1.4 chunk 1");
    const pdf2 = Buffer.from("chunk 2 %%EOF");

    const r1 = await makePartRequest(token, uid, 1, 2, pdf1);
    const b1 = await r1.json();
    const r2 = await makePartRequest(token, uid, 2, 2, pdf2);
    const b2 = await r2.json();
    const sentIds = [b1.messageId, b2.messageId];

    let compRes;
    try {
      compRes = await makeCompleteRequest(token, {
        uploadId: uid,
        class: 9,
        subject: "Economics",
        chapterNo: 1,
        title: "Village Palampur",
        kind: "ncert_pdf",
      });
    } finally {
      globalThis.fetch = origFetch;
    }

    const compBody = await compRes.json();
    const is409 = compRes.status === 409;
    const friendlyMsg = compBody.error?.includes("Duplicate file") && compBody.existingFile?.id === "existing-file-uuid";
    const allPurged = sentIds.every((id) => tgDeleted.includes(id));
    const sessionGone = uploadSessionManager.getSession(uid) === null;

    record(
      "Scenario 3",
      "3B: (Route POST /upload/complete) Duplicate collision returns 409 Conflict, friendly msg, purges Telegram parts",
      is409 && friendlyMsg && allPurged && sessionGone,
      is409 ? undefined : `Status was ${compRes.status} instead of 409 (${JSON.stringify(compBody)})`,
      { status: compRes.status, compBody, allPurged, sessionGone, tgDeleted, sentIds }
    );
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Session timeout rollback (30-min TTL)
  // ---------------------------------------------------------------------------
  console.log("\n--- SCENARIO 4: Session timeout rollback (30-min TTL) ---");

  // 4A: Default cleanupExpiredSessions()
  {
    const mockTg = new MockTelegramClient();
    const mockDb = new MockDatabase();
    const mgr = new UploadSessionManager(mockTg, mockDb, 50); // 50ms TTL
    const uid = "adv-scen4-cleanup-default";
    mgr.startSession(uid, 2);
    const p1 = await mgr.uploadPart(uid, 1, Buffer.from("%PDF-1.4 part 1"), "file.pdf");

    await new Promise((r) => setTimeout(r, 70)); // wait for expiration

    const cleaned = mgr.cleanupExpiredSessions();
    await new Promise((r) => setTimeout(r, 30));

    const p1Deleted = mockTg.deletedMessageIds.includes(p1.messageId);

    record(
      "Scenario 4",
      "4A: Default cleanupExpiredSessions() purges stale session AND deletes orphaned Telegram parts",
      p1Deleted,
      p1Deleted ? undefined : "BUG: cleanupExpiredSessions() defaults to NOT deleting Telegram parts (options.rollback is not true)",
      { cleaned, p1Deleted, deletedIds: mockTg.deletedMessageIds, msgId: p1.messageId }
    );
  }

  // 4B: getSession() on expired session with uploaded parts
  {
    const mockTg = new MockTelegramClient();
    const mockDb = new MockDatabase();
    const mgr = new UploadSessionManager(mockTg, mockDb, 50);
    const uid = "adv-scen4-getsession-leak";
    mgr.startSession(uid, 3);
    const p1 = await mgr.uploadPart(uid, 1, Buffer.from("%PDF-1.4 part 1"), "file.pdf");

    await new Promise((r) => setTimeout(r, 70)); // expire

    const session = mgr.getSession(uid);
    await new Promise((r) => setTimeout(r, 30));

    const isNull = session === null;
    const p1Deleted = mockTg.deletedMessageIds.includes(p1.messageId);

    record(
      "Scenario 4",
      "4B: getSession() on expired session deletes orphaned Telegram parts",
      isNull && p1Deleted,
      p1Deleted ? undefined : "CRITICAL BUG: getSession() deletes session from Map but leaves uploaded Telegram parts orphaned!",
      { isNull, p1Deleted, deletedIds: mockTg.deletedMessageIds, msgId: p1.messageId }
    );
  }

  // 4C: uploadPart() on expired session
  {
    const mockTg = new MockTelegramClient();
    const mockDb = new MockDatabase();
    const mgr = new UploadSessionManager(mockTg, mockDb, 50);
    const uid = "adv-scen4-uploadpart-expired";
    mgr.startSession(uid, 3);
    const p1 = await mgr.uploadPart(uid, 1, Buffer.from("%PDF-1.4 part 1"), "file.pdf");

    await new Promise((r) => setTimeout(r, 70)); // expire

    let threw = false;
    try {
      await mgr.uploadPart(uid, 2, Buffer.from("part 2"), "file.pdf");
    } catch {
      threw = true;
    }
    await new Promise((r) => setTimeout(r, 30));

    const p1Deleted = mockTg.deletedMessageIds.includes(p1.messageId);

    record(
      "Scenario 4",
      "4C: uploadPart() on expired session deletes prior uploaded Telegram parts",
      threw && p1Deleted,
      p1Deleted ? undefined : "CRITICAL BUG: uploadPart() throws on expired session but does not delete prior parts from Telegram!",
      { threw, p1Deleted, deletedIds: mockTg.deletedMessageIds, msgId: p1.messageId }
    );
  }

  // 4D: completeUpload() on expired session
  {
    const mockTg = new MockTelegramClient();
    const mockDb = new MockDatabase();
    const mgr = new UploadSessionManager(mockTg, mockDb, 50);
    const uid = "adv-scen4-complete-expired";
    mgr.startSession(uid, 1);
    const p1 = await mgr.uploadPart(uid, 1, Buffer.from("%PDF-1.4 file %%EOF"), "file.pdf");

    await new Promise((r) => setTimeout(r, 70)); // expire

    let threw = false;
    try {
      await mgr.completeUpload(uid, {
        chapterId: "ch-1",
        kind: "ncert_pdf",
        fileName: "file.pdf",
        sizeBytes: 20,
      }, { tgClient: mockTg, db: mockDb });
    } catch {
      threw = true;
    }
    await new Promise((r) => setTimeout(r, 30));

    const p1Deleted = mockTg.deletedMessageIds.includes(p1.messageId);

    record(
      "Scenario 4",
      "4D: completeUpload() on expired session deletes prior uploaded Telegram parts",
      threw && p1Deleted,
      p1Deleted ? undefined : "CRITICAL BUG: completeUpload() throws on expired session but does not delete prior parts from Telegram!",
      { threw, p1Deleted, deletedIds: mockTg.deletedMessageIds, msgId: p1.messageId }
    );
  }

  // 4E: Route level POST /upload/part after TTL
  {
    tgSent.length = 0;
    tgDeleted.length = 0;
    tgFailOnPart = null;

    const uid = "adv-scen4-route-part-ttl-" + Date.now();
    const pdf1 = Buffer.from("%PDF-1.4 chunk 1");
    const r1 = await makePartRequest(token, uid, 1, 3, pdf1);
    const b1 = await r1.json();
    const msgId = b1.messageId;

    // Simulate 31 minutes elapsed on session
    const sess = uploadSessionManager.getSession(uid);
    if (sess) {
      // Set createdAt to 31 minutes ago
      sess.createdAt = Date.now() - (31 * 60 * 1000);
    }

    // Now send part 2
    const pdf2 = Buffer.from("chunk 2");
    const r2 = await makePartRequest(token, uid, 2, 3, pdf2);
    const b2 = await r2.json();

    const p1Deleted = tgDeleted.includes(msgId);
    const is410OrExpected = r2.status === 410; // line 134 intended to return 410!

    record(
      "Scenario 4",
      "4E: (Route POST /upload/part) Stale session part 2 upload purges part 1 and returns 410 Gone",
      p1Deleted && is410OrExpected,
      !p1Deleted
        ? `CRITICAL BUG: Stale session returned status ${r2.status} ('${b2.error}') but NEVER deleted part 1 (msgId ${msgId}) from Telegram! Orphaned parts leaked.`
        : `Status was ${r2.status} instead of 410`,
      { status: r2.status, body: b2, p1Deleted, tgDeleted, msgId }
    );
  }

  // 4F: Route level POST /upload/complete after TTL
  {
    tgSent.length = 0;
    tgDeleted.length = 0;
    tgFailOnPart = null;

    const uid = "adv-scen4-route-comp-ttl-" + Date.now();
    const pdf1 = Buffer.from("%PDF-1.4 chunk 1");
    const pdf2 = Buffer.from("chunk 2 %%EOF");
    const r1 = await makePartRequest(token, uid, 1, 2, pdf1);
    const b1 = await r1.json();
    const r2 = await makePartRequest(token, uid, 2, 2, pdf2);
    const b2 = await r2.json();
    const sentIds = [b1.messageId, b2.messageId];

    // Simulate 31 minutes elapsed on session
    const sess = uploadSessionManager.getSession(uid);
    if (sess) {
      sess.createdAt = Date.now() - (31 * 60 * 1000);
    }

    // Now call /complete
    const rComp = await makeCompleteRequest(token, {
      uploadId: uid,
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "Village Palampur",
      kind: "ncert_pdf",
    });
    const bComp = await rComp.json();

    const allDeleted = sentIds.every((id) => tgDeleted.includes(id));

    record(
      "Scenario 4",
      "4F: (Route POST /upload/complete) Stale session completion purges parts 1..N from Telegram",
      allDeleted,
      allDeleted ? undefined : `CRITICAL BUG: Stale session completion returned status ${rComp.status} ('${bComp.error}') but NEVER deleted parts ${JSON.stringify(sentIds)} from Telegram! Orphaned parts leaked.`,
      { status: rComp.status, body: bComp, allDeleted, tgDeleted, sentIds }
    );
  }

  // Cleanup prototypes
  TelegramClient.prototype.sendDocument = origSendDocument;
  TelegramClient.prototype.deleteMessage = origDeleteMessage;

  console.log("\n=================================================================");
  console.log("FINAL ADVERSARIAL STRESS TEST SUMMARY");
  console.log("=================================================================");
  const total = results.length;
  const passCount = results.filter((r) => r.passed).length;
  const failCount = total - passCount;

  console.log(`Total Scenarios / Tests: ${total}`);
  console.log(`Passed:                  ${passCount}`);
  console.log(`Failed:                  ${failCount}`);

  if (failCount > 0) {
    console.log("\nDETAILED BUG REPORT:");
    for (const f of results.filter((r) => !r.passed)) {
      console.log(`\n❌ [${f.scenario}] ${f.name}`);
      console.log(`   Failure reason: ${f.error}`);
      console.log(`   Evidence: ${JSON.stringify(f.details, null, 2)}`);
    }
  }

  return { total, passCount, failCount, results };
}

runAdversarialSuite().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
