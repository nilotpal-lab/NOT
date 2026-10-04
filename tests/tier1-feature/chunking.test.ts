import { describe, it, expect, beforeEach } from "vitest";
import { PART_SIZE_BYTES } from "@/lib/validate";
import { sha256, createDeterministicBuffer } from "../fixtures/test-fixtures";
import { MockTelegramClient } from "../helpers/mock-telegram";
import { MockDatabase } from "../helpers/mock-db";
import crypto from "crypto";

/**
 * Pure slicing simulator matching client/server contract
 */
function sliceBuffer(buffer: Buffer, partSizeBytes: number = PART_SIZE_BYTES): Buffer[] {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const end = Math.min(offset + partSizeBytes, buffer.length);
    parts.push(buffer.subarray(offset, end));
    offset = end;
  }
  return parts;
}

/**
 * Upload Session Manager simulator implementing R3 contract:
 * - sequential part validation
 * - 19 MiB ceiling
 * - incremental streaming SHA-256
 * - Telegram auto-rollback on failure
 * - DB rollback on insertion error
 */
class UploadSessionManager {
  private sessions = new Map<
    string,
    {
      expectedTotalParts: number;
      receivedParts: number[];
      hashStream: crypto.Hash;
      uploadedMessageIds: number[];
      createdAt: number;
    }
  >();

  constructor(
    private tg: MockTelegramClient,
    private db: MockDatabase,
    private sessionTtlMs = 30 * 60 * 1000
  ) {}

  startSession(uploadId: string, expectedTotalParts: number) {
    this.sessions.set(uploadId, {
      expectedTotalParts,
      receivedParts: [],
      hashStream: crypto.createHash("sha256"),
      uploadedMessageIds: [],
      createdAt: Date.now(),
    });
  }

  async uploadPart(
    uploadId: string,
    partNo: number,
    partBuffer: Buffer,
    fileName: string
  ): Promise<{ messageId: number; fileId: string }> {
    const session = this.sessions.get(uploadId);
    if (!session) {
      throw new Error("Upload session not found or expired");
    }

    // Check session TTL
    if (Date.now() - session.createdAt > this.sessionTtlMs) {
      this.sessions.delete(uploadId);
      throw new Error("Upload session expired (30m TTL)");
    }

    // Rule: Part size cannot exceed PART_SIZE_BYTES
    if (partBuffer.length > PART_SIZE_BYTES) {
      throw new Error(`Part ${partNo} exceeds maximum chunk size of 19 MiB (${partBuffer.length} > ${PART_SIZE_BYTES})`);
    }

    // Rule: Parts must be strictly sequential (in-order)
    const expectedPart = session.receivedParts.length + 1;
    if (partNo !== expectedPart) {
      throw new Error(`Out of order part: expected ${expectedPart}, received ${partNo}`);
    }

    // Forward part to Telegram
    try {
      const caption = `name=${fileName}|part=${partNo}/${session.expectedTotalParts}`;
      const { messageId, fileId, fileUniqueId } = await this.tg.sendDocument(
        "-1001234567890",
        partBuffer,
        fileName,
        caption
      );

      session.receivedParts.push(partNo);
      session.uploadedMessageIds.push(messageId);
      session.hashStream.update(partBuffer);

      return { messageId, fileId };
    } catch (err) {
      // Automatic Rollback: delete all previously sent parts
      await this.rollbackTelegramMessages(session.uploadedMessageIds);
      this.sessions.delete(uploadId);
      throw err;
    }
  }

  async completeUpload(
    uploadId: string,
    fileMetadata: {
      chapterId: string;
      kind: "ncert_pdf" | "ppt" | "ppt_pdf" | "teacher_notes";
      fileName: string;
      sizeBytes: number;
    }
  ) {
    const session = this.sessions.get(uploadId);
    if (!session) throw new Error("Upload session not found");

    if (session.receivedParts.length !== session.expectedTotalParts) {
      throw new Error(
        `Incomplete upload: received ${session.receivedParts.length} of ${session.expectedTotalParts} parts`
      );
    }

    const fullSha256 = session.hashStream.digest("hex");

    try {
      if (this.tg.failOnDbInsert) {
        throw new Error("Simulated database constraint failure during completeUpload");
      }

      const file = this.db.insertFile(
        {
          chapter_id: fileMetadata.chapterId,
          kind: fileMetadata.kind,
          file_name: fileMetadata.fileName,
          size_bytes: fileMetadata.sizeBytes,
          part_count: session.expectedTotalParts,
          mime: "application/pdf",
          sha256: fullSha256,
          is_published: true,
        },
        session.uploadedMessageIds.map((msgId, idx) => ({
          part_no: idx + 1,
          tg_file_id: `file_${msgId}`,
          tg_file_unique_id: `uniq_${msgId}`,
          tg_message_id: msgId,
          size_bytes: 1000,
          sha256: "mock_part_sha",
        }))
      );

      this.sessions.delete(uploadId);
      return file;
    } catch (err) {
      // Rollback Telegram messages on database insertion failure
      await this.rollbackTelegramMessages(session.uploadedMessageIds);
      this.sessions.delete(uploadId);
      throw err;
    }
  }

  private async rollbackTelegramMessages(messageIds: number[]) {
    for (const msgId of messageIds) {
      await this.tg.deleteMessage("-1001234567890", msgId);
    }
  }
}

describe("Tier 1: Chunking, Slicing & Rollback Engine (Features 11-15)", () => {
  let mockTg: MockTelegramClient;
  let mockDb: MockDatabase;
  let uploadManager: UploadSessionManager;

  beforeEach(() => {
    mockTg = new MockTelegramClient();
    mockDb = new MockDatabase();
    uploadManager = new UploadSessionManager(mockTg, mockDb);
  });

  // --------------------------------------------------------------------------
  // Feature 12: Slicing & Part Validation
  // --------------------------------------------------------------------------
  it("F12.1: slices file into parts strictly <= 19 MiB", () => {
    const fileBytes = 40 * 1024 * 1024; // 40 MB
    const fileBuffer = createDeterministicBuffer(fileBytes);
    const parts = sliceBuffer(fileBuffer, PART_SIZE_BYTES);

    expect(parts.length).toBe(3); // 19 + 19 + 2
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(PART_SIZE_BYTES);
    }
    expect(parts[0].length).toBe(PART_SIZE_BYTES);
    expect(parts[1].length).toBe(PART_SIZE_BYTES);
    expect(parts[2].length).toBe(fileBytes - 2 * PART_SIZE_BYTES);
  });

  it("F12.2: rejects oversized part exceeding 19 MiB", async () => {
    const uploadId = "session-oversized-part";
    uploadManager.startSession(uploadId, 2);

    const oversizedPart = Buffer.alloc(PART_SIZE_BYTES + 1);
    await expect(
      uploadManager.uploadPart(uploadId, 1, oversizedPart, "test.pdf")
    ).rejects.toThrow(/exceeds maximum chunk size/);
  });

  // --------------------------------------------------------------------------
  // Feature 13: Incremental Streaming SHA-256
  // --------------------------------------------------------------------------
  it("F13.1: incremental stream SHA-256 matches full file hash", async () => {
    const totalBytes = 25 * 1024 * 1024;
    const testBuffer = createDeterministicBuffer(totalBytes);
    const expectedSha = sha256(testBuffer);

    const parts = sliceBuffer(testBuffer, PART_SIZE_BYTES);
    const uploadId = "session-stream-sha";
    uploadManager.startSession(uploadId, parts.length);

    for (let i = 0; i < parts.length; i++) {
      await uploadManager.uploadPart(uploadId, i + 1, parts[i], "test.pdf");
    }

    const chapter = mockDb.findOrCreateChapter({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "Village Palampur",
    });

    const file = await uploadManager.completeUpload(uploadId, {
      chapterId: chapter.id,
      kind: "ncert_pdf",
      fileName: "Village-Palampur_Class9_Economics_Ch01_NCERT.pdf",
      sizeBytes: totalBytes,
    });

    expect(file.sha256).toBe(expectedSha);
  });

  // --------------------------------------------------------------------------
  // Feature 14: Sequential Forwarding & Out-of-Order Rejection
  // --------------------------------------------------------------------------
  it("F14.1: rejects out-of-order part uploads", async () => {
    const uploadId = "session-out-of-order";
    uploadManager.startSession(uploadId, 3);

    const partBuffer = Buffer.alloc(1024);
    // Attempt uploading part 2 first
    await expect(
      uploadManager.uploadPart(uploadId, 2, partBuffer, "test.pdf")
    ).rejects.toThrow(/Out of order part: expected 1, received 2/);
  });

  it("F14.2: rejects duplicate part upload attempt", async () => {
    const uploadId = "session-dup-part";
    uploadManager.startSession(uploadId, 3);

    const partBuffer = Buffer.alloc(1024);
    await uploadManager.uploadPart(uploadId, 1, partBuffer, "test.pdf");

    // Re-upload part 1
    await expect(
      uploadManager.uploadPart(uploadId, 1, partBuffer, "test.pdf")
    ).rejects.toThrow(/Out of order part: expected 2, received 1/);
  });

  // --------------------------------------------------------------------------
  // Feature 15: Telegram & DB Rollback on Error
  // --------------------------------------------------------------------------
  it("F15.1: failure on part 3 of 5 deletes parts 1 and 2 and leaves 0 DB rows", async () => {
    const uploadId = "session-rollback-part-3";
    uploadManager.startSession(uploadId, 5);

    // Simulate failure when part 3 is sent
    mockTg.failOnPartNumber = 3;

    const dummyPart = Buffer.alloc(1024);
    const res1 = await uploadManager.uploadPart(uploadId, 1, dummyPart, "test.pdf");
    const res2 = await uploadManager.uploadPart(uploadId, 2, dummyPart, "test.pdf");

    expect(mockTg.sentMessages.length).toBe(2);

    // Part 3 should throw and trigger rollback
    await expect(
      uploadManager.uploadPart(uploadId, 3, dummyPart, "test.pdf")
    ).rejects.toThrow(/Telegram network error simulated on part 3/);

    // Verify parts 1 and 2 were deleted via Telegram deleteMessage
    expect(mockTg.deletedMessageIds).toContain(res1.messageId);
    expect(mockTg.deletedMessageIds).toContain(res2.messageId);
    expect(mockDb.files.length).toBe(0);
    expect(mockDb.fileParts.length).toBe(0);
  });

  it("F15.2: DB insertion failure on completeUpload cleans up all Telegram parts", async () => {
    const uploadId = "session-rollback-db-fail";
    uploadManager.startSession(uploadId, 2);

    const dummyPart = Buffer.alloc(1024);
    const p1 = await uploadManager.uploadPart(uploadId, 1, dummyPart, "test.pdf");
    const p2 = await uploadManager.uploadPart(uploadId, 2, dummyPart, "test.pdf");

    mockTg.failOnDbInsert = true;

    await expect(
      uploadManager.completeUpload(uploadId, {
        chapterId: "test-chapter-uuid",
        kind: "ncert_pdf",
        fileName: "test_file.pdf",
        sizeBytes: 2048,
      })
    ).rejects.toThrow(/database constraint failure/);

    // All parts must be deleted from Telegram
    expect(mockTg.deletedMessageIds).toContain(p1.messageId);
    expect(mockTg.deletedMessageIds).toContain(p2.messageId);
    expect(mockDb.files.length).toBe(0);
  });

  it("F15.3: expired upload session (> 30 min TTL) rejects new parts", async () => {
    const uploadId = "session-ttl-test";
    const shortTtlManager = new UploadSessionManager(mockTg, mockDb, -1000); // already expired
    shortTtlManager.startSession(uploadId, 2);

    const part = Buffer.alloc(500);
    await expect(
      shortTtlManager.uploadPart(uploadId, 1, part, "test.pdf")
    ).rejects.toThrow(/Upload session expired/);
  });
});
