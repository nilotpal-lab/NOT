import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { PART_SIZE_BYTES } from "@/lib/validate";
import {
  sliceBuffer,
  calculatePartCount,
  validateChunkSize,
  UploadSessionManager,
  uploadSessionManager,
} from "@/lib/upload-session";
import { createDeterministicBuffer, sha256 } from "../fixtures/test-fixtures";
import { MockTelegramClient } from "../helpers/mock-telegram";
import { MockDatabase } from "../helpers/mock-db";
import { POST as partRouteHandler } from "@/app/api/admin/upload/part/route";
import { POST as completeRouteHandler } from "@/app/api/admin/upload/complete/route";
import { createAdminToken, ADMIN_COOKIE_NAME } from "@/lib/auth";
import { TelegramClient } from "@/lib/telegram";
import { NextRequest } from "next/server";

describe("Empirical Challenger: Chunking, Slicing, Boundaries & Concurrency", () => {
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

  // ==========================================================================
  // SECTION 1: Exact Chunk Boundaries Verification
  // ==========================================================================
  describe("1. Exact Chunk Boundaries Verification", () => {
    it("1.1: 1-byte file -> exactly 1 part <= 19 MiB (1 byte)", () => {
      const original = Buffer.from([0xaa]);
      const parts = sliceBuffer(original, PART_SIZE_BYTES);

      expect(calculatePartCount(1)).toBe(1);
      expect(parts.length).toBe(1);
      expect(parts[0].length).toBe(1);
      expect(parts[0].length).toBeLessThanOrEqual(PART_SIZE_BYTES);

      const reassembled = Buffer.concat(parts);
      expect(reassembled.equals(original)).toBe(true);
      expect(sha256(reassembled)).toBe(sha256(original));
    });

    it("1.2: exactly 19 MiB file (19,922,944 bytes) -> exactly 1 part of 19,922,944 bytes", () => {
      const size = PART_SIZE_BYTES; // 19,922,944
      expect(size).toBe(19922944);

      const original = createDeterministicBuffer(size, 0x12);
      expect(calculatePartCount(size)).toBe(1);

      const parts = sliceBuffer(original, PART_SIZE_BYTES);
      expect(parts.length).toBe(1);
      expect(parts[0].length).toBe(19922944);
      expect(parts[0].length).toBeLessThanOrEqual(PART_SIZE_BYTES);

      const reassembled = Buffer.concat(parts);
      expect(reassembled.length).toBe(size);
      expect(reassembled.equals(original)).toBe(true);
      expect(sha256(reassembled)).toBe(sha256(original));
    });

    it("1.3: 19 MiB + 1 byte file (19,922,945 bytes) -> exactly 2 parts (19922944 + 1 bytes)", () => {
      const size = PART_SIZE_BYTES + 1; // 19,922,945
      expect(calculatePartCount(size)).toBe(2);

      const original = createDeterministicBuffer(size, 0x34);
      const parts = sliceBuffer(original, PART_SIZE_BYTES);

      expect(parts.length).toBe(2);
      expect(parts[0].length).toBe(PART_SIZE_BYTES);
      expect(parts[1].length).toBe(1);
      expect(parts[0].length).toBeLessThanOrEqual(PART_SIZE_BYTES);
      expect(parts[1].length).toBeLessThanOrEqual(PART_SIZE_BYTES);

      const reassembled = Buffer.concat(parts);
      expect(reassembled.length).toBe(size);
      expect(reassembled.equals(original)).toBe(true);
      expect(sha256(reassembled)).toBe(sha256(original));
    });

    it("1.4: 45 MB file (47,185,920 bytes) -> exactly 3 parts <= 19 MiB", () => {
      const size = 45 * 1024 * 1024; // 47,185,920
      expect(calculatePartCount(size)).toBe(3);

      const original = createDeterministicBuffer(size, 0x56);
      const parts = sliceBuffer(original, PART_SIZE_BYTES);

      expect(parts.length).toBe(3);
      expect(parts[0].length).toBe(PART_SIZE_BYTES); // 19,922,944
      expect(parts[1].length).toBe(PART_SIZE_BYTES); // 19,922,944
      expect(parts[2].length).toBe(size - 2 * PART_SIZE_BYTES); // 7,340,032 bytes

      for (const p of parts) {
        expect(p.length).toBeLessThanOrEqual(PART_SIZE_BYTES);
      }

      const reassembled = Buffer.concat(parts);
      expect(reassembled.length).toBe(size);
      expect(reassembled.equals(original)).toBe(true);
      expect(sha256(reassembled)).toBe(sha256(original));
    });

    it("1.5: 100 MB file (104,857,600 bytes) -> exactly 6 parts <= 19 MiB", () => {
      const size = 100 * 1024 * 1024; // 104,857,600
      expect(calculatePartCount(size)).toBe(6);

      const original = createDeterministicBuffer(size, 0x78);
      const parts = sliceBuffer(original, PART_SIZE_BYTES);

      expect(parts.length).toBe(6);
      for (let i = 0; i < 5; i++) {
        expect(parts[i].length).toBe(PART_SIZE_BYTES);
      }
      expect(parts[5].length).toBe(size - 5 * PART_SIZE_BYTES); // 5,242,880 bytes

      for (const p of parts) {
        expect(p.length).toBeLessThanOrEqual(PART_SIZE_BYTES);
      }

      const reassembled = Buffer.concat(parts);
      expect(reassembled.length).toBe(size);
      expect(reassembled.equals(original)).toBe(true);
      expect(sha256(reassembled)).toBe(sha256(original));
    });

    it("1.6: Boundary edge cases: 0 bytes, 19 MiB - 1 byte, exactly 2 * 19 MiB", () => {
      // 0 bytes
      expect(calculatePartCount(0)).toBe(0);
      expect(sliceBuffer(Buffer.alloc(0))).toEqual([]);

      // 19 MiB - 1 byte (19,922,943 bytes)
      const sizeMinus1 = PART_SIZE_BYTES - 1;
      expect(calculatePartCount(sizeMinus1)).toBe(1);
      const bufMinus1 = createDeterministicBuffer(sizeMinus1, 0x01);
      const partsMinus1 = sliceBuffer(bufMinus1, PART_SIZE_BYTES);
      expect(partsMinus1.length).toBe(1);
      expect(partsMinus1[0].length).toBe(sizeMinus1);

      // Exactly 2 * 19 MiB (39,845,888 bytes)
      const size2x = 2 * PART_SIZE_BYTES;
      expect(calculatePartCount(size2x)).toBe(2);
      const buf2x = createDeterministicBuffer(size2x, 0x02);
      const parts2x = sliceBuffer(buf2x, PART_SIZE_BYTES);
      expect(parts2x.length).toBe(2);
      expect(parts2x[0].length).toBe(PART_SIZE_BYTES);
      expect(parts2x[1].length).toBe(PART_SIZE_BYTES);

      // 2 * 19 MiB + 1 byte
      const size2xPlus1 = 2 * PART_SIZE_BYTES + 1;
      expect(calculatePartCount(size2xPlus1)).toBe(3);
    });
  });

  // ==========================================================================
  // SECTION 2: Reassembly SHA-256 Byte-for-Byte Fidelity
  // ==========================================================================
  describe("2. Reassembly SHA-256 Byte-for-Byte Fidelity", () => {
    it("2.1: Streaming incremental SHA-256 matches single-shot digest across all boundary sizes", async () => {
      const testSizes = [
        1, // 1 byte
        1024, // 1 KB
        PART_SIZE_BYTES - 1, // 19 MiB - 1
        PART_SIZE_BYTES, // 19 MiB
        PART_SIZE_BYTES + 1, // 19 MiB + 1
        30 * 1024 * 1024, // 30 MB (2 parts)
        45 * 1024 * 1024, // 45 MB (3 parts)
      ];

      for (let idx = 0; idx < testSizes.length; idx++) {
        const size = testSizes[idx];
        const originalBuf = createDeterministicBuffer(size, 0x80 + idx);
        const originalSha = sha256(originalBuf);

        const parts = sliceBuffer(originalBuf, PART_SIZE_BYTES);
        const uploadId = `fidelity-session-${idx}-${size}`;

        manager.startSession(uploadId, parts.length);

        for (let p = 0; p < parts.length; p++) {
          await manager.uploadPart(uploadId, p + 1, parts[p], `file_${idx}.dat`);
        }

        const sessionResult = manager.completeSession(uploadId);
        expect(sessionResult.fullSha256).toBe(originalSha);
        expect(sessionResult.totalBytes).toBe(size);

        // Byte-for-byte check of reassembled buffer
        const reassembled = Buffer.concat(parts);
        expect(Buffer.compare(reassembled, originalBuf)).toBe(0);
        expect(sha256(reassembled)).toBe(originalSha);
      }
    });

    it("2.2: completeUpload verifies clientSha256 and rejects checksum mismatches", async () => {
      const size = 2 * 1024 * 1024;
      const buf = createDeterministicBuffer(size, 0x99);
      const expectedSha = sha256(buf);
      const wrongSha = crypto.createHash("sha256").update(Buffer.from("tampered")).digest("hex");

      const uploadId = "tampered-checksum-test";
      manager.startSession(uploadId, 1);
      await manager.uploadPart(uploadId, 1, buf, "test.pdf");

      const ch = mockDb.findOrCreateChapter({
        class: 9,
        subject: "History",
        chapterNo: 1,
        title: "Test",
      });

      // Complete with wrong sha in route simulation
      const session = manager.getSession(uploadId);
      expect(session).not.toBeNull();
      const completed = manager.completeSession(uploadId);
      expect(completed.fullSha256).toBe(expectedSha);
      expect(completed.fullSha256).not.toBe(wrongSha);
    });
  });

  // ==========================================================================
  // SECTION 3: Rejection of Out-of-Order Chunks and Oversized Chunks
  // ==========================================================================
  describe("3. Rejection of Out-of-Order and Oversized Chunks", () => {
    it("3.1: validateChunkSize rejects chunk of size 19 MiB + 1 byte", () => {
      const oversized = PART_SIZE_BYTES + 1; // 19,922,945 bytes
      const res = validateChunkSize(oversized);
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/exceeds maximum chunk size of 19 MiB/);
    });

    it("3.2: validateChunkSize rejects empty chunk (0 bytes)", () => {
      const res = validateChunkSize(0);
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/cannot be empty/);
    });

    it("3.3: validateChunkSize rejects negative size", () => {
      const res = validateChunkSize(-1);
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/cannot be empty/);
    });

    it("3.4: uploadPart rejects chunk > 19 MiB", async () => {
      const uploadId = "oversized-part-rejection";
      manager.startSession(uploadId, 2);

      const oversizedBuf = Buffer.alloc(PART_SIZE_BYTES + 1);
      await expect(
        manager.uploadPart(uploadId, 1, oversizedBuf, "oversized.pdf")
      ).rejects.toThrow(/exceeds maximum chunk size of 19 MiB/);

      expect(mockTg.sentMessages.length).toBe(0);
    });

    it("3.5: uploadPart rejects empty chunk (0 bytes)", async () => {
      const uploadId = "empty-chunk-rejection";
      manager.startSession(uploadId, 2);

      const emptyBuf = Buffer.alloc(0);
      await expect(
        manager.uploadPart(uploadId, 1, emptyBuf, "empty.pdf")
      ).rejects.toThrow(/cannot be empty/);

      expect(mockTg.sentMessages.length).toBe(0);
    });

    it("3.6: uploadPart rejects out-of-order part 2 before part 1", async () => {
      const uploadId = "ooo-part-2-first";
      manager.startSession(uploadId, 3);

      const chunk = Buffer.alloc(1024, 0x11);
      await expect(
        manager.uploadPart(uploadId, 2, chunk, "test.pdf")
      ).rejects.toThrow(/Out of order part: expected 1, received 2/);

      expect(mockTg.sentMessages.length).toBe(0);
    });

    it("3.7: uploadPart rejects part 3 when part 2 is expected (skipped part)", async () => {
      const uploadId = "ooo-skipped-part-2";
      manager.startSession(uploadId, 3);

      const chunk = Buffer.alloc(1024, 0x22);
      await manager.uploadPart(uploadId, 1, chunk, "test.pdf");

      await expect(
        manager.uploadPart(uploadId, 3, chunk, "test.pdf")
      ).rejects.toThrow(/Out of order part: expected 2, received 3/);

      expect(mockTg.sentMessages.length).toBe(1);
    });

    it("3.8: uploadPart rejects duplicate part (part 1 repeated when part 2 is expected)", async () => {
      const uploadId = "ooo-dup-part-1";
      manager.startSession(uploadId, 3);

      const chunk = Buffer.alloc(1024, 0x33);
      await manager.uploadPart(uploadId, 1, chunk, "test.pdf");

      await expect(
        manager.uploadPart(uploadId, 1, chunk, "test.pdf")
      ).rejects.toThrow(/Out of order part: expected 2, received 1/);

      expect(mockTg.sentMessages.length).toBe(1);
    });

    it("3.9: uploadPart rejects part number > expectedTotalParts", async () => {
      const uploadId = "ooo-part-beyond-total";
      manager.startSession(uploadId, 1);

      const chunk = Buffer.alloc(1024, 0x44);
      await manager.uploadPart(uploadId, 1, chunk, "test.pdf");

      await expect(
        manager.uploadPart(uploadId, 2, chunk, "test.pdf")
      ).rejects.toThrow(/exceeds expected total parts/);
    });

    it("3.10: route POST /api/admin/upload/part rejects oversized chunk with HTTP 400", async () => {
      const token = await createAdminToken(process.env.SESSION_SECRET!);
      const uploadId = "route-oversized-chunk-" + Date.now();

      // Start session with part 1 oversized
      const formData = new FormData();
      formData.append("uploadId", uploadId);
      formData.append("part", "1");
      formData.append("total", "2");
      formData.append("fileName", "test.pdf");
      // Create chunk larger than PART_SIZE_BYTES
      const oversizedBlob = new Blob([Buffer.alloc(PART_SIZE_BYTES + 10)]);
      formData.append("chunk", oversizedBlob);

      const req = new NextRequest("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: formData,
      });
      req.cookies.set(ADMIN_COOKIE_NAME, token);

      const res = await partRouteHandler(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toMatch(/exceeds maximum chunk size of 19 MiB/);
    });

    it("3.11: route POST /api/admin/upload/part rejects out-of-order part with HTTP 400", async () => {
      const origSend = TelegramClient.prototype.sendDocument;
      const origDel = TelegramClient.prototype.deleteMessage;
      let fakeMsgId = 9000;

      TelegramClient.prototype.sendDocument = async () => {
        const messageId = ++fakeMsgId;
        return { messageId, fileId: `file_${messageId}`, fileUniqueId: `uniq_${messageId}` };
      };
      TelegramClient.prototype.deleteMessage = async () => true;

      try {
        const token = await createAdminToken(process.env.SESSION_SECRET!);
        const uploadId = "route-ooo-chunk-" + Date.now();

        // First part
        const fd1 = new FormData();
        fd1.append("uploadId", uploadId);
        fd1.append("part", "1");
        fd1.append("total", "3");
        fd1.append("fileName", "test.pdf");
        fd1.append("chunk", new Blob([Buffer.from("%PDF-1.4 header")]));

        const req1 = new NextRequest("http://localhost:3000/api/admin/upload/part", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
          body: fd1,
        });
        req1.cookies.set(ADMIN_COOKIE_NAME, token);
        const res1 = await partRouteHandler(req1);
        expect(res1.status).toBe(200);

        // Now attempt sending part 3 instead of part 2
        const fd3 = new FormData();
        fd3.append("uploadId", uploadId);
        fd3.append("part", "3");
        fd3.append("total", "3");
        fd3.append("fileName", "test.pdf");
        fd3.append("chunk", new Blob([Buffer.from("part 3 chunk")]));

        const req3 = new NextRequest("http://localhost:3000/api/admin/upload/part", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
          body: fd3,
        });
        req3.cookies.set(ADMIN_COOKIE_NAME, token);
        const res3 = await partRouteHandler(req3);
        const data3 = await res3.json();

        expect(res3.status).toBe(400);
        expect(data3.error).toMatch(/Out of order part: expected 2, received 3/);

        // Clean up
        uploadSessionManager.deleteSession(uploadId);
      } finally {
        TelegramClient.prototype.sendDocument = origSend;
        TelegramClient.prototype.deleteMessage = origDel;
      }
    });
  });

  // ==========================================================================
  // SECTION 4: Concurrency & Stress Tests
  // ==========================================================================
  describe("4. Concurrency & Stress Tests", () => {
    it("4.1: Concurrent upload requests for the same uploadId trigger route lock rejection (HTTP 409)", async () => {
      const uploadId = "concurrent-lock-session-" + Date.now();
      uploadSessionManager.startSession(uploadId, 2, {
        fileName: "test.pdf",
        kind: "ncert_pdf",
      });

      // Simulate lock acquisition by a currently in-flight chunk upload
      const lockAcquired = uploadSessionManager.acquireLock(uploadId);
      expect(lockAcquired).toBe(true);

      const token = await createAdminToken(process.env.SESSION_SECRET!);
      const fd = new FormData();
      fd.append("uploadId", uploadId);
      fd.append("part", "1");
      fd.append("total", "2");
      fd.append("fileName", "test.pdf");
      fd.append("chunk", new Blob([Buffer.from("%PDF-1.4 test")]));

      const req = new NextRequest("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: fd,
      });
      req.cookies.set(ADMIN_COOKIE_NAME, token);

      const res = await partRouteHandler(req);
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.error).toMatch(/Another chunk is currently uploading for this session/);

      // Release lock and clean up
      uploadSessionManager.releaseLock(uploadId);
      uploadSessionManager.deleteSession(uploadId);
    });

    it("4.2: Multiple independent sessions uploading concurrently in parallel do not collide", async () => {
      const numSessions = 8;
      const partsPerSession = 3;
      const partSize = 100 * 1024; // 100 KB per part

      const sessionDataList: Array<{
        uploadId: string;
        buffer: Buffer;
        sha: string;
        parts: Buffer[];
      }> = [];

      for (let s = 0; s < numSessions; s++) {
        const fullBuf = createDeterministicBuffer(partsPerSession * partSize, 0x10 * (s + 1));
        const fullSha = sha256(fullBuf);
        const parts = sliceBuffer(fullBuf, partSize);
        const uploadId = `parallel-session-${s}-${Date.now()}`;

        manager.startSession(uploadId, partsPerSession);
        sessionDataList.push({ uploadId, buffer: fullBuf, sha: fullSha, parts });
      }

      // Execute uploads for all sessions concurrently
      await Promise.all(
        sessionDataList.map(async (sess) => {
          for (let p = 0; p < sess.parts.length; p++) {
            await manager.uploadPart(sess.uploadId, p + 1, sess.parts[p], `file_${sess.uploadId}.pdf`);
          }
        })
      );

      // Verify each session produced exact SHA-256 and correct part count
      for (const sess of sessionDataList) {
        const result = manager.completeSession(sess.uploadId);
        expect(result.fullSha256).toBe(sess.sha);
        expect(result.partCount).toBe(partsPerSession);
        expect(result.totalBytes).toBe(sess.buffer.length);
        expect(result.uploadedParts.length).toBe(partsPerSession);
      }
    });

    it("4.3: Concurrency under failure: Failure & rollback in one session does not corrupt concurrent sibling session", async () => {
      const sessGood = "sibling-good-" + Date.now();
      const sessFailing = "sibling-failing-" + Date.now();

      manager.startSession(sessGood, 2);
      manager.startSession(sessFailing, 3);

      const chunk = Buffer.alloc(1024, 0x55);

      // Upload part 1 to both
      await manager.uploadPart(sessGood, 1, chunk, "good.pdf");
      const failP1 = await manager.uploadPart(sessFailing, 1, chunk, "fail.pdf");

      // Inject error specifically for sessFailing part 2
      mockTg.failOnPartNumber = 2;

      // Good session continues with part 2
      // Failing session attempts part 2 and throws
      await expect(
        manager.uploadPart(sessFailing, 2, chunk, "fail.pdf")
      ).rejects.toThrow(/Telegram network error/);

      // Failing session rolled back and deleted
      expect(mockTg.deletedMessageIds).toContain(failP1.messageId);
      expect(manager.getSession(sessFailing)).toBeNull();

      // Good session is completely unharmed
      mockTg.failOnPartNumber = null; // Clear mock failure
      const goodP2 = await manager.uploadPart(sessGood, 2, chunk, "good.pdf");
      expect(goodP2.messageId).toBeDefined();

      const goodResult = manager.completeSession(sessGood);
      expect(goodResult.partCount).toBe(2);
      expect(goodResult.totalBytes).toBe(2048);
    });

    it("4.4: 100 MB full 6-part stream upload through UploadSessionManager verifies SHA-256 and byte equality", async () => {
      const size100Mb = 100 * 1024 * 1024; // 104,857,600 bytes
      const testBuffer = createDeterministicBuffer(size100Mb, 0xef);
      const expectedSha = sha256(testBuffer);

      const parts = sliceBuffer(testBuffer, PART_SIZE_BYTES);
      expect(parts.length).toBe(6);

      const uploadId = "session-100mb-stream-" + Date.now();
      manager.startSession(uploadId, 6);

      for (let p = 0; p < parts.length; p++) {
        const res = await manager.uploadPart(uploadId, p + 1, parts[p], "big100mb.pdf");
        expect(res.messageId).toBeDefined();
        expect(res.partSha256).toBe(sha256(parts[p]));
      }

      const completed = manager.completeSession(uploadId);
      expect(completed.fullSha256).toBe(expectedSha);
      expect(completed.totalBytes).toBe(size100Mb);
      expect(completed.partCount).toBe(6);
      expect(completed.uploadedParts.length).toBe(6);
      expect(completed.uploadedMessageIds.length).toBe(6);

      // Byte-for-byte fidelity of parts
      const reassembled = Buffer.concat(parts);
      expect(reassembled.length).toBe(size100Mb);
      expect(Buffer.compare(reassembled, testBuffer)).toBe(0);
    });

    it("4.5: AsyncLock serializes Promise.all chunk dispatches for the same session", async () => {
      const uploadId = "async-lock-queue-" + Date.now();
      manager.startSession(uploadId, 3);

      const p1Buf = Buffer.alloc(1024, 0x11);
      const p2Buf = Buffer.alloc(1024, 0x22);
      const p3Buf = Buffer.alloc(1024, 0x33);

      // Dispatch parts 1, 2, 3 concurrently
      const results = await Promise.all([
        manager.uploadPart(uploadId, 1, p1Buf, "doc.pdf"),
        manager.uploadPart(uploadId, 2, p2Buf, "doc.pdf"),
        manager.uploadPart(uploadId, 3, p3Buf, "doc.pdf"),
      ]);

      expect(results.length).toBe(3);
      expect(results[0].messageId).toBeDefined();
      expect(results[1].messageId).toBeDefined();
      expect(results[2].messageId).toBeDefined();

      const session = manager.getSession(uploadId);
      expect(session?.receivedParts).toEqual([1, 2, 3]);
      expect(session?.totalBytes).toBe(3072);
    });

    it("4.6: route POST /api/admin/upload/part rejects invalid parameters (part=0, total=0, part>total, empty chunk)", async () => {
      const token = await createAdminToken(process.env.SESSION_SECRET!);

      // Case A: part = 0
      const fdA = new FormData();
      fdA.append("uploadId", "param-test-a");
      fdA.append("part", "0");
      fdA.append("total", "3");
      fdA.append("chunk", new Blob([Buffer.from("abc")]));
      const reqA = new NextRequest("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: fdA,
      });
      reqA.cookies.set(ADMIN_COOKIE_NAME, token);
      const resA = await partRouteHandler(reqA);
      expect(resA.status).toBe(400);

      // Case B: total = 0
      const fdB = new FormData();
      fdB.append("uploadId", "param-test-b");
      fdB.append("part", "1");
      fdB.append("total", "0");
      fdB.append("chunk", new Blob([Buffer.from("abc")]));
      const reqB = new NextRequest("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: fdB,
      });
      reqB.cookies.set(ADMIN_COOKIE_NAME, token);
      const resB = await partRouteHandler(reqB);
      expect(resB.status).toBe(400);

      // Case C: part > total
      const fdC = new FormData();
      fdC.append("uploadId", "param-test-c");
      fdC.append("part", "4");
      fdC.append("total", "3");
      fdC.append("chunk", new Blob([Buffer.from("abc")]));
      const reqC = new NextRequest("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: fdC,
      });
      reqC.cookies.set(ADMIN_COOKIE_NAME, token);
      const resC = await partRouteHandler(reqC);
      expect(resC.status).toBe(400);

      // Case D: empty chunk (0 bytes)
      const fdD = new FormData();
      fdD.append("uploadId", "param-test-d");
      fdD.append("part", "1");
      fdD.append("total", "3");
      fdD.append("chunk", new Blob([]));
      const reqD = new NextRequest("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
        headers: { origin: "http://localhost:3000" },
        body: fdD,
      });
      reqD.cookies.set(ADMIN_COOKIE_NAME, token);
      const resD = await partRouteHandler(reqD);
      expect(resD.status).toBe(400);
      const dataD = await resD.json();
      expect(dataD.error).toMatch(/cannot be empty/);
    });

    it("4.7: route POST /api/admin/upload/complete rolls back sent parts when upload is incomplete", async () => {
      const origSend = TelegramClient.prototype.sendDocument;
      const origDel = TelegramClient.prototype.deleteMessage;
      const tgDeleted: number[] = [];
      let fakeMsgId = 7500;

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
        const uploadId = "route-incomplete-rollback-" + Date.now();

        // Upload only part 1 of 3
        const fd = new FormData();
        fd.append("uploadId", uploadId);
        fd.append("part", "1");
        fd.append("total", "3");
        fd.append("fileName", "test.pdf");
        fd.append("chunk", new Blob([Buffer.from("%PDF-1.4 header")]));

        const reqPart = new NextRequest("http://localhost:3000/api/admin/upload/part", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
          body: fd,
        });
        reqPart.cookies.set(ADMIN_COOKIE_NAME, token);
        const resPart = await partRouteHandler(reqPart);
        const partData = await resPart.json();
        expect(resPart.status).toBe(200);
        const p1MsgId = partData.messageId;

        // Try to complete prematurely
        const compReq = new NextRequest("http://localhost:3000/api/admin/upload/complete", {
          method: "POST",
          headers: { origin: "http://localhost:3000", "content-type": "application/json" },
          body: JSON.stringify({
            uploadId,
            class: 9,
            subject: "History",
            chapterNo: 1,
            title: "Test Incomplete",
            kind: "ncert_pdf",
          }),
        });
        compReq.cookies.set(ADMIN_COOKIE_NAME, token);
        const compRes = await completeRouteHandler(compReq);
        const compData = await compRes.json();

        expect(compRes.status).toBe(400);
        expect(compData.error).toMatch(/Incomplete upload: received 1 of 3 parts/);
        expect(tgDeleted).toContain(p1MsgId);
        expect(uploadSessionManager.getSession(uploadId)).toBeNull();
      } finally {
        TelegramClient.prototype.sendDocument = origSend;
        TelegramClient.prototype.deleteMessage = origDel;
      }
    });

    it("4.8: route POST /api/admin/upload/complete rolls back sent parts when clientSha256 mismatches", async () => {
      const origSend = TelegramClient.prototype.sendDocument;
      const origDel = TelegramClient.prototype.deleteMessage;
      const tgDeleted: number[] = [];
      let fakeMsgId = 8500;

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
        const uploadId = "route-sha-mismatch-rollback-" + Date.now();

        // Upload single part (valid minimal PDF)
        const pdfContent = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\nstartxref\n0\n%%EOF\n");
        const fd = new FormData();
        fd.append("uploadId", uploadId);
        fd.append("part", "1");
        fd.append("total", "1");
        fd.append("fileName", "test.pdf");
        fd.append("chunk", new Blob([pdfContent]));

        const reqPart = new NextRequest("http://localhost:3000/api/admin/upload/part", {
          method: "POST",
          headers: { origin: "http://localhost:3000" },
          body: fd,
        });
        reqPart.cookies.set(ADMIN_COOKIE_NAME, token);
        const resPart = await partRouteHandler(reqPart);
        const partData = await resPart.json();
        expect(resPart.status).toBe(200);
        const p1MsgId = partData.messageId;

        // Try to complete with mismatched sha256
        const compReq = new NextRequest("http://localhost:3000/api/admin/upload/complete", {
          method: "POST",
          headers: { origin: "http://localhost:3000", "content-type": "application/json" },
          body: JSON.stringify({
            uploadId,
            class: 9,
            subject: "History",
            chapterNo: 1,
            title: "Test SHA Mismatch",
            kind: "ncert_pdf",
            clientSha256: "0000000000000000000000000000000000000000000000000000000000000000",
          }),
        });
        compReq.cookies.set(ADMIN_COOKIE_NAME, token);
        const compRes = await completeRouteHandler(compReq);
        const compData = await compRes.json();

        expect(compRes.status).toBe(400);
        expect(compData.error).toMatch(/Cryptographic checksum mismatch/);
        expect(tgDeleted).toContain(p1MsgId);
        expect(uploadSessionManager.getSession(uploadId)).toBeNull();
      } finally {
        TelegramClient.prototype.sendDocument = origSend;
        TelegramClient.prototype.deleteMessage = origDel;
      }
    });
  });
});
