import { describe, it, expect, beforeEach } from "vitest";
import { UploadSessionManager, uploadSessionManager } from "@/lib/upload-session";
import { MockTelegramClient } from "../helpers/mock-telegram";
import { MockDatabase } from "../helpers/mock-db";
import { validatePptxAccompaniment } from "@/lib/magic";
import { TelegramClient } from "@/lib/telegram";
import { POST as partRouteHandler } from "@/app/api/admin/upload/part/route";
import { POST as completeRouteHandler } from "@/app/api/admin/upload/complete/route";
import { createAdminToken, ADMIN_COOKIE_NAME } from "@/lib/auth";
import { NextRequest } from "next/server";

describe("Unit: Rollback Engine, Upload Sequencing & Dedup", () => {
  let mockTg: MockTelegramClient;
  let mockDb: MockDatabase;
  let manager: UploadSessionManager;

  beforeEach(() => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || "0123456789abcdef0123456789abcdef";
    process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
    process.env.TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || "-1001234567890";
    process.env.ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "a1b2c3d4:e5f6a7b8c9d0";
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://xyzcompany.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy";
    process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || "gsk_test1234567890abcdef1234567890";
    mockTg = new MockTelegramClient();
    mockDb = new MockDatabase();
    manager = new UploadSessionManager(mockTg, mockDb);
  });

  // --------------------------------------------------------------------------
  // R1.1: Part 3 of 5 Network Failure Rollback (Mandatory Dispatch Test)
  // --------------------------------------------------------------------------
  it("R1.1: failure on part 3 of 5 deletes parts 1 & 2 and leaves 0 DB rows", async () => {
    const uploadId = "rollback-part-3-of-5";
    manager.startSession(uploadId, 5);

    mockTg.failOnPartNumber = 3;

    const dummyChunk = Buffer.alloc(1024, 0xaa);
    const p1 = await manager.uploadPart(uploadId, 1, dummyChunk, "history.pdf");
    const p2 = await manager.uploadPart(uploadId, 2, dummyChunk, "history.pdf");

    expect(mockTg.sentMessages.length).toBe(2);

    // Part 3 failure triggers rollback of parts 1 and 2
    await expect(
      manager.uploadPart(uploadId, 3, dummyChunk, "history.pdf")
    ).rejects.toThrow(/Telegram network error simulated on part 3/);

    expect(mockTg.deletedMessageIds).toContain(p1.messageId);
    expect(mockTg.deletedMessageIds).toContain(p2.messageId);
    expect(mockTg.sentMessages.length).toBe(0);

    // Session cleared
    expect(manager.getSession(uploadId)).toBeNull();

    // Zero DB rows
    expect(mockDb.files.length).toBe(0);
    expect(mockDb.fileParts.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // R1.2: Complete Endpoint Database Error Rollback (Mandatory Dispatch Test)
  // --------------------------------------------------------------------------
  it("R1.2: DB insertion failure on completeUpload deletes all parts and leaves 0 DB rows", async () => {
    const uploadId = "rollback-db-complete-fail";
    manager.startSession(uploadId, 5);

    const dummyChunk = Buffer.alloc(1024, 0xbb);
    const uploadedIds: number[] = [];

    for (let i = 1; i <= 5; i++) {
      const res = await manager.uploadPart(uploadId, i, dummyChunk, "civics.pdf");
      uploadedIds.push(res.messageId);
    }
    expect(mockTg.sentMessages.length).toBe(5);

    // Mock database failure on complete
    mockTg.failOnDbInsert = true;

    // Custom database with simulated insertion error
    const failingDb = {
      insertFile: () => {
        throw new Error("Simulated PostgreSQL connection drop during insertFile");
      },
    };

    await expect(
      manager.completeUpload(
        uploadId,
        {
          chapterId: "test-chapter-uuid",
          kind: "ncert_pdf",
          fileName: "Civics_Ch01.pdf",
          sizeBytes: 5 * 1024,
        },
        { db: failingDb, tgClient: mockTg }
      )
    ).rejects.toThrow(/PostgreSQL connection drop/);

    // Verify all 5 messages deleted
    for (const id of uploadedIds) {
      expect(mockTg.deletedMessageIds).toContain(id);
    }
    expect(mockTg.sentMessages.length).toBe(0);

    // Session cleared
    expect(manager.getSession(uploadId)).toBeNull();
    expect(mockDb.files.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // R1.3: Failure on Part 1 of 5 (Zero Prior Telegram Messages)
  // --------------------------------------------------------------------------
  it("R1.3: failure on part 1 of 5 deletes zero prior messages and clears session", async () => {
    const uploadId = "rollback-part-1-fail";
    manager.startSession(uploadId, 5);

    mockTg.failOnPartNumber = 1;

    const dummyChunk = Buffer.alloc(1024);
    await expect(
      manager.uploadPart(uploadId, 1, dummyChunk, "geography.pdf")
    ).rejects.toThrow(/Telegram network error simulated on part 1/);

    expect(mockTg.deletedMessageIds.length).toBe(0);
    expect(mockTg.sentMessages.length).toBe(0);
    expect(manager.getSession(uploadId)).toBeNull();
    expect(mockDb.files.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // R1.4: Failure on Final Part (Part 5 of 5)
  // --------------------------------------------------------------------------
  it("R1.4: failure on part 5 of 5 deletes parts 1, 2, 3, 4 and leaves 0 DB rows", async () => {
    const uploadId = "rollback-part-5-fail";
    manager.startSession(uploadId, 5);

    mockTg.failOnPartNumber = 5;

    const dummyChunk = Buffer.alloc(1024);
    const sentIds: number[] = [];

    for (let i = 1; i <= 4; i++) {
      const res = await manager.uploadPart(uploadId, i, dummyChunk, "economics.pdf");
      sentIds.push(res.messageId);
    }
    expect(mockTg.sentMessages.length).toBe(4);

    await expect(
      manager.uploadPart(uploadId, 5, dummyChunk, "economics.pdf")
    ).rejects.toThrow(/Telegram network error simulated on part 5/);

    for (const id of sentIds) {
      expect(mockTg.deletedMessageIds).toContain(id);
    }
    expect(mockTg.sentMessages.length).toBe(0);
    expect(manager.getSession(uploadId)).toBeNull();
    expect(mockDb.files.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // R1.5: Out-of-Order Part Rejection
  // --------------------------------------------------------------------------
  it("R1.5: rejects out-of-order part 2 before part 1 without sending to Telegram", async () => {
    const uploadId = "out-of-order-test";
    manager.startSession(uploadId, 3);

    const chunk = Buffer.alloc(512);
    await expect(
      manager.uploadPart(uploadId, 2, chunk, "test.pdf")
    ).rejects.toThrow(/Out of order part: expected 1, received 2/);

    expect(mockTg.sentMessages.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // R1.6: Duplicate Part Submission Rejection
  // --------------------------------------------------------------------------
  it("R1.6: rejects duplicate submission of part 1 when part 2 is expected", async () => {
    const uploadId = "duplicate-part-test";
    manager.startSession(uploadId, 3);

    const chunk = Buffer.alloc(512);
    const res1 = await manager.uploadPart(uploadId, 1, chunk, "test.pdf");
    expect(res1.messageId).toBeDefined();

    // Re-sending part 1
    await expect(
      manager.uploadPart(uploadId, 1, chunk, "test.pdf")
    ).rejects.toThrow(/Out of order part: expected 2, received 1/);

    // Existing part 1 remains recorded in session
    const session = manager.getSession(uploadId);
    expect(session?.receivedParts).toEqual([1]);
  });

  // --------------------------------------------------------------------------
  // R1.7: Expired Upload Session Rejection (30-minute TTL)
  // --------------------------------------------------------------------------
  it("R1.7: rejects upload on expired session (> 30 min TTL)", async () => {
    const uploadId = "expired-session-test";
    const expiredManager = new UploadSessionManager(mockTg, mockDb, -100);
    expiredManager.startSession(uploadId, 2);

    const chunk = Buffer.alloc(512);
    await expect(
      expiredManager.uploadPart(uploadId, 1, chunk, "test.pdf")
    ).rejects.toThrow(/Upload session expired/);
  });

  // --------------------------------------------------------------------------
  // R1.8: Incomplete Upload Completion Rejection
  // --------------------------------------------------------------------------
  it("R1.8: rejects completeUpload when only 1 of 3 parts uploaded and cleans up Telegram", async () => {
    const uploadId = "incomplete-upload-test";
    manager.startSession(uploadId, 3);

    const chunk = Buffer.alloc(512);
    const p1 = await manager.uploadPart(uploadId, 1, chunk, "test.pdf");

    await expect(
      manager.completeUpload(uploadId, {
        chapterId: "some-chap",
        kind: "ncert_pdf",
        fileName: "test.pdf",
        sizeBytes: 512,
      })
    ).rejects.toThrow(/Incomplete upload: received 1 of 3 parts/);

    expect(mockTg.deletedMessageIds).toContain(p1.messageId);
    expect(manager.getSession(uploadId)).toBeNull();
    expect(mockDb.files.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Chapter Auto-Creation & Dedup Rollback
  // --------------------------------------------------------------------------
  it("D1.1: auto-creates chapter on first upload", () => {
    const ch = mockDb.findOrCreateChapter({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "The Story of Village Palampur",
    });

    expect(ch.id).toBeDefined();
    expect(ch.class).toBe(9);
    expect(ch.title).toBe("The Story of Village Palampur");
    expect(mockDb.chapters.length).toBe(1);
  });

  it("D1.2: reuses existing chapter on subsequent uploads without duplication", () => {
    const ch1 = mockDb.findOrCreateChapter({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "The Story of Village Palampur",
    });

    const ch2 = mockDb.findOrCreateChapter({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "The Story of Village Palampur (Duplicate Call)",
    });

    expect(ch2.id).toBe(ch1.id);
    expect(mockDb.chapters.length).toBe(1);
  });

  it("D1.3: duplicate file in same chapter throws and triggers Telegram rollback", async () => {
    const ch = mockDb.findOrCreateChapter({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "Village Palampur",
    });

    const existingFile = mockDb.insertFile(
      {
        chapter_id: ch.id,
        kind: "ncert_pdf",
        file_name: "Original_File.pdf",
        size_bytes: 1024,
        part_count: 1,
        mime: "application/pdf",
        sha256: "duplicate_content_sha_123",
        is_published: true,
      },
      []
    );

    // Simulate uploading identical content
    const uploadId = "dup-upload-test";
    manager.startSession(uploadId, 1);
    const p1 = await manager.uploadPart(uploadId, 1, Buffer.alloc(1024), "Second_File.pdf");

    // Attempting insertion of colliding (chapter_id, sha256) throws
    let failed = false;
    try {
      mockDb.insertFile(
        {
          chapter_id: ch.id,
          kind: "ncert_pdf",
          file_name: "Second_File.pdf",
          size_bytes: 1024,
          part_count: 1,
          mime: "application/pdf",
          sha256: "duplicate_content_sha_123", // Collision!
          is_published: true,
        },
        []
      );
    } catch {
      failed = true;
      // Trigger rollback
      await manager.rollbackTelegramMessages([p1.messageId], mockTg);
      manager.deleteSession(uploadId);
    }

    expect(failed).toBe(true);
    expect(mockTg.deletedMessageIds).toContain(p1.messageId);
    expect(mockDb.files.length).toBe(1);
    expect(mockDb.files[0].id).toBe(existingFile.id);
  });

  it("D1.4: identical SHA-256 in different chapters is permitted", () => {
    const ch1 = mockDb.findOrCreateChapter({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "Village Palampur",
    });

    const ch2 = mockDb.findOrCreateChapter({
      class: 10,
      subject: "Economics",
      chapterNo: 1,
      title: "Development",
    });

    const f1 = mockDb.insertFile(
      {
        chapter_id: ch1.id,
        kind: "ncert_pdf",
        file_name: "Ch1_Resource.pdf",
        size_bytes: 2048,
        part_count: 1,
        mime: "application/pdf",
        sha256: "shared_reference_hash_456",
        is_published: true,
      },
      []
    );

    const f2 = mockDb.insertFile(
      {
        chapter_id: ch2.id,
        kind: "ncert_pdf",
        file_name: "Ch2_Resource.pdf",
        size_bytes: 2048,
        part_count: 1,
        mime: "application/pdf",
        sha256: "shared_reference_hash_456", // same sha256, different chapter
        is_published: true,
      },
      []
    );

    expect(f1.id).not.toBe(f2.id);
    expect(mockDb.files.length).toBe(2);
  });

  it("D1.5: PPTX accompaniment rule rejects PPT without PDF preview", () => {
    const accompanimentCheck = validatePptxAccompaniment({
      kind: "ppt",
      hasAccompanyingPdf: false,
    });

    expect(accompanimentCheck.valid).toBe(false);
    expect(accompanimentCheck.error).toMatch(/require an accompanying PDF preview export/);
  });

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

    const cleanedCount = await expiredManager.cleanupExpiredSessions();
    expect(cleanedCount).toBe(1);

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
      const session = uploadSessionManager.getSession(uploadId, { allowExpired: true, includeExpired: true });
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
      const session = uploadSessionManager.getSession(uploadId, { allowExpired: true, includeExpired: true });
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

  it("R1.7g: cleanupExpiredSessions() handles zero-part expired session gracefully without error", async () => {
    const expiredManager = new UploadSessionManager(mockTg, mockDb, -100);
    expiredManager.startSession("empty-expired-session", 2);

    const cleaned = await expiredManager.cleanupExpiredSessions();
    expect(cleaned).toBe(1);

    expect(mockTg.deletedMessageIds.length).toBe(0);
    expect(expiredManager.getSession("empty-expired-session")).toBeNull();
  });

  it("R1.7h: active session within TTL is preserved by cleanupExpiredSessions()", async () => {
    const activeManager = new UploadSessionManager(mockTg, mockDb, 60000); // 1 minute TTL
    const uploadId = "active-session-id";
    activeManager.startSession(uploadId, 2);

    const chunk = Buffer.alloc(512);
    const p1 = await activeManager.uploadPart(uploadId, 1, chunk, "test.pdf");

    const cleaned = await activeManager.cleanupExpiredSessions();
    expect(cleaned).toBe(0);
    expect(mockTg.deletedMessageIds.length).toBe(0);
    expect(activeManager.getSession(uploadId)).not.toBeNull();
  });
});
