/**
 * Adversarial Test Harness — Milestone M3 (Chunking & Concurrency Challenger)
 * Challenger 2: teamwork_preview_challenger
 * Working Directory: .agents/teamwork/challenger_m3_2/
 *
 * Scenarios tested:
 * 1. File splitting sizes: 1 byte, exactly 19 MiB (19922944 bytes), 19 MiB + 1 byte, 45 MB, 100 MB.
 * 2. Reassembly verification: byte-for-byte fidelity and identical SHA-256 across all sizes.
 * 3. Out-of-order rejection: sending part 3 before part 2 must be rejected (unit + route).
 * 4. Oversized chunk rejection: chunk of 19 MiB + 1 byte sent to /part must be rejected with 400 (unit + route).
 * 5. Concurrent uploads: 3 parallel upload sessions uploading different files concurrently must not interfere with each other.
 */

import crypto from "crypto";
import { NextRequest } from "next/server";
import { PART_SIZE_BYTES } from "@/lib/validate";
import {
  sliceBuffer,
  calculatePartCount,
  validateChunkSize,
  UploadSessionManager,
  TelegramClientLike,
} from "@/lib/upload-session";
import { createAdminToken, ADMIN_COOKIE_NAME } from "@/lib/auth";
import { POST as uploadPartRoute } from "@/app/api/admin/upload/part/route";

// ============================================================================
// ENVIRONMENT INITIALIZATION
// ============================================================================
process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
process.env.TELEGRAM_CHANNEL_ID = "-1001234567890";
process.env.SUPABASE_URL = "https://mockproject.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "eyJhGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock";
process.env.GROQ_API_KEY = "gsk_test1234567890abcdef1234567890";
process.env.ADMIN_PASSWORD_HASH = "a1b2c3d4:e5f6a7b8c9d0";
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";
process.env.SITE_URL = "http://localhost:3000";

// ============================================================================
// TEST HARNESS FRAMEWORK & REPORTING
// ============================================================================
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failureDetails: string[] = [];

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${testName}`);
  } else {
    failedTests++;
    const msg = `  [FAIL] ${testName}${detail ? ` -> ${detail}` : ""}`;
    console.error(msg);
    failureDetails.push(msg);
  }
}

function computeSha256(buf: Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function generateDeterministicBuffer(sizeBytes: number, seed = 0x42): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  let s = seed & 0xff;
  for (let i = 0; i < sizeBytes; i += 4096) {
    const end = Math.min(i + 4096, sizeBytes);
    buf.fill(s++, i, end);
    if (s > 0xfe) s = 0x10;
  }
  return buf;
}

// Minimal PDF header and trailer
const PDF_HEADER = Buffer.from("%PDF-1.4\n");
const PDF_TRAILER = Buffer.from("\n%%EOF\n");

function createPdfBuffer(sizeBytes: number, seed = 0x55): Buffer {
  if (sizeBytes < PDF_HEADER.length + PDF_TRAILER.length) {
    return generateDeterministicBuffer(sizeBytes, seed);
  }
  const buf = generateDeterministicBuffer(sizeBytes, seed);
  PDF_HEADER.copy(buf, 0);
  PDF_TRAILER.copy(buf, sizeBytes - PDF_TRAILER.length);
  return buf;
}

// ============================================================================
// MOCK TELEGRAM CLIENT
// ============================================================================
interface MockTgMessage {
  messageId: number;
  channelId: string | number;
  fileName: string;
  caption?: string;
  fileId: string;
  fileUniqueId: string;
  buffer: Buffer;
  sha256: string;
  timestamp: number;
}

class AdversarialMockTelegram implements TelegramClientLike {
  public sentMessages: MockTgMessage[] = [];
  public deletedMessageIds: number[] = [];
  public failOnPartNo: number | null = null;
  public failSessionId: string | null = null;
  private messageSeq = 5000;

  async sendDocument(
    channelId: string | number,
    fileBuffer: Buffer | Uint8Array,
    fileName: string,
    caption?: string
  ): Promise<{ messageId: number; fileId: string; fileUniqueId: string }> {
    const buf = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer);
    const msgId = ++this.messageSeq;
    const fileId = `tg_file_${msgId}`;
    const fileUniqueId = `tg_uniq_${msgId}`;

    // Check simulated failure
    const partMatch = caption?.match(/part=(\d+)\/(\d+)/);
    const currentPart = partMatch ? parseInt(partMatch[1], 10) : 1;

    if (this.failOnPartNo !== null && currentPart === this.failOnPartNo) {
      if (!this.failSessionId || (caption && caption.includes(this.failSessionId))) {
        throw new Error(`Simulated network drop on Telegram chunk ${currentPart}`);
      }
    }

    const record: MockTgMessage = {
      messageId: msgId,
      channelId,
      fileName,
      caption,
      fileId,
      fileUniqueId,
      buffer: buf,
      sha256: computeSha256(buf),
      timestamp: Date.now(),
    };

    this.sentMessages.push(record);
    return { messageId: msgId, fileId, fileUniqueId };
  }

  async deleteMessage(channelId: string | number, messageId: number): Promise<boolean> {
    this.deletedMessageIds.push(messageId);
    this.sentMessages = this.sentMessages.filter((m) => m.messageId !== messageId);
    return true;
  }
}

// ============================================================================
// SUITE 1: FILE SPLITTING SIZES & BOUNDARY CHUNK CEILINGS
// ============================================================================
async function runSuite1FileSplitting() {
  console.log("\n========================================================");
  console.log("SUITE 1: FILE SPLITTING SIZES & BOUNDARY CHUNK CEILINGS");
  console.log("========================================================");

  // S1.1: 1-byte file
  {
    const size = 1;
    const buf = generateDeterministicBuffer(size, 0x01);
    const parts = sliceBuffer(buf, PART_SIZE_BYTES);

    assert(parts.length === 1, "S1.1: 1-byte file produces exactly 1 part");
    assert(parts[0].length === 1, "S1.1: Part 1 has length 1 byte");
    assert(parts[0].length <= PART_SIZE_BYTES, "S1.1: Part 1 <= 19 MiB");
  }

  // S1.2: Exactly 19 MiB (19922944 bytes)
  {
    const size = PART_SIZE_BYTES; // 19,922,944 bytes
    const buf = generateDeterministicBuffer(size, 0x19);
    const parts = sliceBuffer(buf, PART_SIZE_BYTES);

    assert(parts.length === 1, "S1.2: Exactly 19 MiB produces exactly 1 part");
    assert(parts[0].length === PART_SIZE_BYTES, "S1.2: Part 1 is exactly 19,922,944 bytes");
    assert(parts[0].length <= PART_SIZE_BYTES, "S1.2: Part 1 <= 19 MiB ceiling");
  }

  // S1.3: 19 MiB + 1 byte (19922945 bytes)
  {
    const size = PART_SIZE_BYTES + 1; // 19,922,945 bytes
    const buf = generateDeterministicBuffer(size, 0x20);
    const parts = sliceBuffer(buf, PART_SIZE_BYTES);

    assert(parts.length === 2, "S1.3: 19 MiB + 1 byte produces exactly 2 parts");
    assert(parts[0].length === PART_SIZE_BYTES, "S1.3: Part 1 is exactly 19,922,944 bytes");
    assert(parts[1].length === 1, "S1.3: Part 2 is exactly 1 byte");
    assert(parts[0].length <= PART_SIZE_BYTES, "S1.3: Part 1 <= 19 MiB");
    assert(parts[1].length <= PART_SIZE_BYTES, "S1.3: Part 2 <= 19 MiB");
  }

  // S1.4: 45 MB (47185920 bytes)
  {
    const size = 45 * 1024 * 1024; // 47,185,920 bytes
    const buf = generateDeterministicBuffer(size, 0x45);
    const parts = sliceBuffer(buf, PART_SIZE_BYTES);

    assert(parts.length === 3, "S1.4: 45 MB produces exactly 3 parts");
    assert(parts[0].length === PART_SIZE_BYTES, "S1.4: Part 1 is 19,922,944 bytes");
    assert(parts[1].length === PART_SIZE_BYTES, "S1.4: Part 2 is 19,922,944 bytes");
    const expectedPart3 = size - 2 * PART_SIZE_BYTES; // 7,340,032 bytes
    assert(parts[2].length === expectedPart3, `S1.4: Part 3 is ${expectedPart3} bytes`);
    for (let i = 0; i < parts.length; i++) {
      assert(parts[i].length <= PART_SIZE_BYTES, `S1.4: Part ${i + 1} <= 19 MiB`);
    }
  }

  // S1.5: 100 MB (104857600 bytes)
  {
    const size = 100 * 1024 * 1024; // 104,857,600 bytes
    const buf = generateDeterministicBuffer(size, 0x99);
    const parts = sliceBuffer(buf, PART_SIZE_BYTES);

    assert(parts.length === 6, "S1.5: 100 MB produces exactly 6 parts");
    for (let i = 0; i < 5; i++) {
      assert(parts[i].length === PART_SIZE_BYTES, `S1.5: Part ${i + 1} is 19,922,944 bytes`);
      assert(parts[i].length <= PART_SIZE_BYTES, `S1.5: Part ${i + 1} <= 19 MiB`);
    }
    const expectedPart6 = size - 5 * PART_SIZE_BYTES; // 5,242,880 bytes
    assert(parts[5].length === expectedPart6, `S1.5: Part 6 is ${expectedPart6} bytes`);
    assert(parts[5].length <= PART_SIZE_BYTES, "S1.5: Part 6 <= 19 MiB");
  }

  // S1.6: Boundary Edge Cases (0 bytes, 19 MiB - 1 byte, 2 * 19 MiB, 2 * 19 MiB + 1 byte)
  {
    const emptyParts = sliceBuffer(Buffer.alloc(0), PART_SIZE_BYTES);
    assert(emptyParts.length === 0, "S1.6a: 0-byte buffer produces 0 parts");

    const under19 = sliceBuffer(Buffer.alloc(PART_SIZE_BYTES - 1), PART_SIZE_BYTES);
    assert(under19.length === 1 && under19[0].length === PART_SIZE_BYTES - 1, "S1.6b: 19 MiB - 1 byte produces 1 part");

    const exact2x = sliceBuffer(Buffer.alloc(2 * PART_SIZE_BYTES), PART_SIZE_BYTES);
    assert(exact2x.length === 2 && exact2x[0].length === PART_SIZE_BYTES && exact2x[1].length === PART_SIZE_BYTES, "S1.6c: Exactly 2 * 19 MiB produces 2 parts");

    const over2x = sliceBuffer(Buffer.alloc(2 * PART_SIZE_BYTES + 1), PART_SIZE_BYTES);
    assert(over2x.length === 3 && over2x[2].length === 1, "S1.6d: 2 * 19 MiB + 1 byte produces 3 parts");
  }

  // S1.7: Mathematical part count calculations
  {
    assert(calculatePartCount(0) === 0, "S1.7a: calculatePartCount(0) === 0");
    assert(calculatePartCount(1) === 1, "S1.7b: calculatePartCount(1) === 1");
    assert(calculatePartCount(PART_SIZE_BYTES) === 1, "S1.7c: calculatePartCount(19 MiB) === 1");
    assert(calculatePartCount(PART_SIZE_BYTES + 1) === 2, "S1.7d: calculatePartCount(19 MiB + 1) === 2");
    assert(calculatePartCount(45 * 1024 * 1024) === 3, "S1.7e: calculatePartCount(45 MB) === 3");
    assert(calculatePartCount(100 * 1024 * 1024) === 6, "S1.7f: calculatePartCount(100 MB) === 6");
    assert(calculatePartCount(200 * 1024 * 1024) === 11, "S1.7g: calculatePartCount(200 MB) === 11");
  }
}

// ============================================================================
// SUITE 2: REASSEMBLY VERIFICATION & CRYPTOGRAPHIC INVARIANTS
// ============================================================================
async function runSuite2ReassemblyVerification() {
  console.log("\n========================================================");
  console.log("SUITE 2: REASSEMBLY VERIFICATION & CRYPTOGRAPHIC INVARIANTS");
  console.log("========================================================");

  const testCases = [
    { label: "1-byte", size: 1, seed: 0x11 },
    { label: "Exactly 19 MiB", size: PART_SIZE_BYTES, seed: 0x22 },
    { label: "19 MiB + 1 byte", size: PART_SIZE_BYTES + 1, seed: 0x33 },
    { label: "45 MB", size: 45 * 1024 * 1024, seed: 0x44 },
    { label: "100 MB", size: 100 * 1024 * 1024, seed: 0x55 },
  ];

  for (const tc of testCases) {
    const original = generateDeterministicBuffer(tc.size, tc.seed);
    const originalSha = computeSha256(original);
    const parts = sliceBuffer(original, PART_SIZE_BYTES);

    // Verify reassembly byte-for-byte
    const reassembled = Buffer.concat(parts);
    assert(reassembled.length === original.length, `S2.1 [${tc.label}]: Reassembled length matches original length`);
    assert(reassembled.equals(original), `S2.2 [${tc.label}]: Reassembled buffer byte-for-byte equals original`);

    // Verify SHA-256 identical match
    const reassembledSha = computeSha256(reassembled);
    assert(reassembledSha === originalSha, `S2.3 [${tc.label}]: Reassembled SHA-256 identical to original (${originalSha.slice(0, 16)}...)`);

    // Verify incremental streaming hash matches single-shot digest
    const streamHash = crypto.createHash("sha256");
    for (const part of parts) {
      streamHash.update(part);
    }
    const streamedSha = streamHash.digest("hex");
    assert(streamedSha === originalSha, `S2.4 [${tc.label}]: Streaming incremental SHA-256 matches original digest`);
  }

  // S2.5: Negative Tamper Oracle
  {
    const size = 45 * 1024 * 1024;
    const original = generateDeterministicBuffer(size, 0x77);
    const originalSha = computeSha256(original);
    const parts = sliceBuffer(original, PART_SIZE_BYTES);

    // Corrupt a single byte in part 2
    const tamperedPart2 = Buffer.from(parts[1]);
    tamperedPart2[0] = tamperedPart2[0] ^ 0xff; // flip bits

    const tamperedReassembled = Buffer.concat([parts[0], tamperedPart2, parts[2]]);
    const tamperedSha = computeSha256(tamperedReassembled);

    assert(!tamperedReassembled.equals(original), "S2.5a: Tampered buffer does not equal original");
    assert(tamperedSha !== originalSha, "S2.5b: Single corrupted bit changes SHA-256 digest completely");
  }

  // S2.6: Swapped Parts Tamper Oracle
  {
    const size = 45 * 1024 * 1024;
    const original = generateDeterministicBuffer(size, 0x88);
    const originalSha = computeSha256(original);
    const parts = sliceBuffer(original, PART_SIZE_BYTES);

    // Swap part 1 and part 2
    const swapped = Buffer.concat([parts[1], parts[0], parts[2]]);
    const swappedSha = computeSha256(swapped);

    assert(!swapped.equals(original), "S2.6a: Out-of-order reassembly does not equal original");
    assert(swappedSha !== originalSha, "S2.6b: Swapped parts result in completely different SHA-256");
  }
}

// ============================================================================
// SUITE 3: OUT-OF-ORDER REJECTION & SEQUENCING DISCIPLINE
// ============================================================================
async function runSuite3OutOfOrderRejection() {
  console.log("\n========================================================");
  console.log("SUITE 3: OUT-OF-ORDER REJECTION & SEQUENCING DISCIPLINE");
  console.log("========================================================");

  const mockTg = new AdversarialMockTelegram();
  const manager = new UploadSessionManager(mockTg);

  // S3.1: Sending part 3 before part 2 must be rejected (unit manager)
  {
    const uploadId = "out-of-order-p3-before-p2";
    manager.startSession(uploadId, 3);

    const chunk = Buffer.alloc(1024, 0xaa);
    // Part 1 succeeds
    await manager.uploadPart(uploadId, 1, chunk, "test.pdf");

    // Part 3 attempted when part 2 is expected
    let errorCaught: Error | null = null;
    try {
      await manager.uploadPart(uploadId, 3, chunk, "test.pdf");
    } catch (err) {
      errorCaught = err as Error;
    }

    assert(errorCaught !== null, "S3.1a: Sending part 3 before part 2 throws error");
    assert(
      errorCaught?.message.includes("Out of order part: expected 2, received 3") === true,
      `S3.1b: Error message specifies expected 2, received 3 (received: "${errorCaught?.message}")`
    );

    // Verify Telegram received only 1 part
    assert(mockTg.sentMessages.length === 1, "S3.1c: Telegram only has part 1 stored; part 3 was never sent");
    manager.deleteSession(uploadId);
  }

  // S3.2: Sending part 2 before part 1 must be rejected
  {
    const uploadId = "out-of-order-p2-before-p1";
    manager.startSession(uploadId, 3);

    let errorCaught: Error | null = null;
    try {
      await manager.uploadPart(uploadId, 2, Buffer.alloc(512), "test.pdf");
    } catch (err) {
      errorCaught = err as Error;
    }

    assert(errorCaught !== null, "S3.2a: Sending part 2 before part 1 throws error");
    assert(
      errorCaught?.message.includes("Out of order part: expected 1, received 2") === true,
      `S3.2b: Error message specifies expected 1, received 2 (received: "${errorCaught?.message}")`
    );
    manager.deleteSession(uploadId);
  }

  // S3.3: Duplicate part submission (re-sending part 1)
  {
    const uploadId = "dup-part-submission";
    manager.startSession(uploadId, 3);
    const chunk = Buffer.alloc(512);
    await manager.uploadPart(uploadId, 1, chunk, "test.pdf");

    let errorCaught: Error | null = null;
    try {
      await manager.uploadPart(uploadId, 1, chunk, "test.pdf");
    } catch (err) {
      errorCaught = err as Error;
    }

    assert(errorCaught !== null, "S3.3a: Re-sending part 1 throws error");
    assert(
      errorCaught?.message.includes("Out of order part: expected 2, received 1") === true,
      `S3.3b: Duplicate part rejected with expected 2, received 1`
    );
    manager.deleteSession(uploadId);
  }

  // S3.4: Overshooting total parts (part 4 of 3)
  {
    const uploadId = "overshoot-total-parts";
    manager.startSession(uploadId, 2);
    const chunk = Buffer.alloc(512);
    await manager.uploadPart(uploadId, 1, chunk, "test.pdf");
    await manager.uploadPart(uploadId, 2, chunk, "test.pdf");

    let errorCaught: Error | null = null;
    try {
      await manager.uploadPart(uploadId, 3, chunk, "test.pdf");
    } catch (err) {
      errorCaught = err as Error;
    }

    assert(errorCaught !== null, "S3.4a: Sending part 3 on a 2-part upload throws error");
    assert(
      errorCaught?.message.includes("Out of order") || errorCaught?.message.includes("exceeds expected total parts"),
      "S3.4b: Overshoot rejected appropriately"
    );
    manager.deleteSession(uploadId);
  }

  // S3.5: Incomplete completeSession / completeUpload rejection
  {
    const uploadId = "incomplete-completion";
    manager.startSession(uploadId, 4);
    await manager.uploadPart(uploadId, 1, Buffer.alloc(512), "test.pdf");
    await manager.uploadPart(uploadId, 2, Buffer.alloc(512), "test.pdf");

    let errorCaught: Error | null = null;
    try {
      manager.completeSession(uploadId);
    } catch (err) {
      errorCaught = err as Error;
    }

    assert(errorCaught !== null, "S3.5a: completeSession on incomplete upload throws error");
    assert(
      errorCaught?.message.includes("Incomplete upload: received 2 of 4 parts") === true,
      "S3.5b: Error message specifies incomplete parts count"
    );
    manager.deleteSession(uploadId);
  }

  // S3.6: Route-level test for out-of-order rejection: sending part 3 before part 2 returns HTTP 400
  {
    const adminToken = await createAdminToken(process.env.SESSION_SECRET!);
    const uploadId = "route-out-of-order-test";

    // Step 1: Upload part 1 to initialize session
    const pdfChunk1 = createPdfBuffer(1024, 0x11);
    const req1 = new NextRequest("http://localhost:3000/api/admin/upload/part", {
      method: "POST",
      headers: {
        "x-upload-id": uploadId,
        "x-part": "1",
        "x-total": "3",
        "x-file-name": "history.pdf",
        "x-kind": "ncert_pdf",
        cookie: `${ADMIN_COOKIE_NAME}=${adminToken}`,
      },
      body: pdfChunk1,
    });

    // Intercept fetch for Telegram
    const origFetch = globalThis.fetch;
    let tgCallCount = 0;
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("api.telegram.org")) {
        tgCallCount++;
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 8881,
              document: { file_id: "tg_f1", file_unique_id: "tg_u1", file_name: "p1", file_size: 1024 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return origFetch(url, init);
    };

    try {
      const res1 = await uploadPartRoute(req1);
      assert(res1.status === 200, "S3.6a: Route accepted part 1 with HTTP 200");

      // Step 2: Now send part 3 before part 2!
      const pdfChunk3 = Buffer.alloc(1024, 0x33);
      const req3 = new NextRequest("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
        headers: {
          "x-upload-id": uploadId,
          "x-part": "3",
          "x-total": "3",
          "x-file-name": "history.pdf",
          "x-kind": "ncert_pdf",
          cookie: `${ADMIN_COOKIE_NAME}=${adminToken}`,
        },
        body: pdfChunk3,
      });

      const res3 = await uploadPartRoute(req3);
      const data3 = (await res3.json()) as { error?: string };

      assert(res3.status === 400, `S3.6b: Route rejected part 3 before part 2 with HTTP 400 (got ${res3.status})`);
      assert(
        typeof data3.error === "string" && data3.error.includes("Out of order"),
        `S3.6c: Error message explicitly notes out-of-order part (got: "${data3.error}")`
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  }
}

// ============================================================================
// SUITE 4: OVERSIZED CHUNK REJECTION
// ============================================================================
async function runSuite4OversizedChunkRejection() {
  console.log("\n========================================================");
  console.log("SUITE 4: OVERSIZED CHUNK REJECTION");
  console.log("========================================================");

  // S4.1: validateChunkSize validator function
  {
    const exact = validateChunkSize(PART_SIZE_BYTES);
    assert(exact.valid === true, "S4.1a: validateChunkSize accepts exactly 19 MiB");

    const overByOne = validateChunkSize(PART_SIZE_BYTES + 1);
    assert(overByOne.valid === false, "S4.1b: validateChunkSize rejects 19 MiB + 1 byte");
    assert(
      overByOne.error?.includes("exceeds maximum chunk size of 19 MiB") === true,
      `S4.1c: Error message mentions 19 MiB ceiling (got: "${overByOne.error}")`
    );

    const zero = validateChunkSize(0);
    assert(zero.valid === false, "S4.1d: validateChunkSize rejects 0 bytes");
    assert(zero.error?.includes("cannot be empty") === true, "S4.1e: Error message notes empty chunk");

    const massive = validateChunkSize(50 * 1024 * 1024);
    assert(massive.valid === false, "S4.1f: validateChunkSize rejects 50 MB");
  }

  // S4.2: UploadSessionManager rejects oversized chunk
  {
    const mockTg = new AdversarialMockTelegram();
    const manager = new UploadSessionManager(mockTg);
    const uploadId = "oversized-unit-test";
    manager.startSession(uploadId, 2);

    const oversizedBuffer = Buffer.alloc(PART_SIZE_BYTES + 1);
    let errorCaught: Error | null = null;
    try {
      await manager.uploadPart(uploadId, 1, oversizedBuffer, "oversized.pdf");
    } catch (err) {
      errorCaught = err as Error;
    }

    assert(errorCaught !== null, "S4.2a: manager.uploadPart rejects chunk of 19 MiB + 1 byte");
    assert(
      errorCaught?.message.includes("exceeds maximum chunk size of 19 MiB") === true,
      `S4.2b: Error message specifies chunk exceeds 19 MiB (got: "${errorCaught?.message}")`
    );
    assert(mockTg.sentMessages.length === 0, "S4.2c: Oversized chunk was never forwarded to Telegram");
    manager.deleteSession(uploadId);
  }

  // S4.3: Route-level test: chunk of 19 MiB + 1 byte sent to /part rejected with 400
  {
    const adminToken = await createAdminToken(process.env.SESSION_SECRET!);
    const uploadId = "route-oversized-rejection";
    const oversizedChunk = Buffer.alloc(PART_SIZE_BYTES + 1);

    const req = new NextRequest("http://localhost:3000/api/admin/upload/part", {
      method: "POST",
      headers: {
        "x-upload-id": uploadId,
        "x-part": "1",
        "x-total": "2",
        "x-file-name": "oversized.pdf",
        "x-kind": "ncert_pdf",
        cookie: `${ADMIN_COOKIE_NAME}=${adminToken}`,
      },
      body: oversizedChunk,
    });

    const res = await uploadPartRoute(req);
    const data = (await res.json()) as { error?: string };

    assert(res.status === 400, `S4.3a: Route rejects oversized chunk of 19 MiB + 1 byte with HTTP 400 (got ${res.status})`);
    assert(
      typeof data.error === "string" && data.error.includes("exceeds maximum chunk size of 19 MiB"),
      `S4.3b: Response JSON contains error message stating chunk exceeds 19 MiB (got: "${data.error}")`
    );
  }

  // S4.4: Route-level test with multipart/form-data payload
  {
    const adminToken = await createAdminToken(process.env.SESSION_SECRET!);
    const uploadId = "route-oversized-multipart";

    const formData = new FormData();
    formData.append("uploadId", uploadId);
    formData.append("part", "1");
    formData.append("total", "2");
    formData.append("fileName", "oversized.pdf");
    formData.append("kind", "ncert_pdf");

    // Oversized chunk blob
    const blob = new Blob([new Uint8Array(PART_SIZE_BYTES + 1)], { type: "application/pdf" });
    formData.append("chunk", blob, "chunk.pdf");

    const req = new NextRequest("http://localhost:3000/api/admin/upload/part", {
      method: "POST",
      headers: {
        cookie: `${ADMIN_COOKIE_NAME}=${adminToken}`,
      },
      body: formData,
    });

    const res = await uploadPartRoute(req);
    const data = (await res.json()) as { error?: string };

    assert(res.status === 400, `S4.4a: Multipart route rejects 19 MiB + 1 byte with HTTP 400 (got ${res.status})`);
    assert(
      typeof data.error === "string" && data.error.includes("exceeds maximum chunk size of 19 MiB"),
      `S4.4b: Multipart error states chunk exceeds 19 MiB (got: "${data.error}")`
    );
  }

  // S4.5: Route-level test: empty chunk (0 bytes) rejected with 400
  {
    const adminToken = await createAdminToken(process.env.SESSION_SECRET!);
    const uploadId = "route-empty-chunk";

    const req = new NextRequest("http://localhost:3000/api/admin/upload/part", {
      method: "POST",
      headers: {
        "x-upload-id": uploadId,
        "x-part": "1",
        "x-total": "1",
        "x-file-name": "empty.pdf",
        "x-kind": "ncert_pdf",
        cookie: `${ADMIN_COOKIE_NAME}=${adminToken}`,
      },
      body: Buffer.alloc(0),
    });

    const res = await uploadPartRoute(req);
    const data = (await res.json()) as { error?: string };

    assert(res.status === 400, `S4.5a: Route rejects 0-byte chunk with HTTP 400 (got ${res.status})`);
    assert(
      typeof data.error === "string" && data.error.includes("cannot be empty"),
      `S4.5b: Error message specifies chunk cannot be empty (got: "${data.error}")`
    );
  }
}

// ============================================================================
// SUITE 5: CONCURRENT UPLOADS & MULTI-SESSION ISOLATION
// ============================================================================
async function runSuite5ConcurrentUploads() {
  console.log("\n========================================================");
  console.log("SUITE 5: CONCURRENT UPLOADS & MULTI-SESSION ISOLATION");
  console.log("========================================================");

  // S5.1: 3 parallel upload sessions uploading different files concurrently
  {
    const mockTg = new AdversarialMockTelegram();
    const manager = new UploadSessionManager(mockTg);

    // Setup 3 distinct test files with distinct sizes, seeds, and part counts
    const fileA_size = 45 * 1024 * 1024; // 45 MB -> 3 parts
    const fileA = createPdfBuffer(fileA_size, 0xa1);
    const fileA_sha = computeSha256(fileA);
    const fileA_parts = sliceBuffer(fileA, PART_SIZE_BYTES);

    const fileB_size = PART_SIZE_BYTES + 1; // 19 MiB + 1 byte -> 2 parts
    const fileB = createPdfBuffer(fileB_size, 0xb2);
    const fileB_sha = computeSha256(fileB);
    const fileB_parts = sliceBuffer(fileB, PART_SIZE_BYTES);

    const fileC_size = 60 * 1024 * 1024; // 60 MB -> 4 parts (19 + 19 + 19 + 3)
    const fileC = createPdfBuffer(fileC_size, 0xc3);
    const fileC_sha = computeSha256(fileC);
    const fileC_parts = sliceBuffer(fileC, PART_SIZE_BYTES);

    const sessionA_id = "session-concurrent-A";
    const sessionB_id = "session-concurrent-B";
    const sessionC_id = "session-concurrent-C";

    manager.startSession(sessionA_id, fileA_parts.length, { fileName: "FileA_45MB.pdf" });
    manager.startSession(sessionB_id, fileB_parts.length, { fileName: "FileB_19MBplus1.pdf" });
    manager.startSession(sessionC_id, fileC_parts.length, { fileName: "FileC_60MB.pdf" });

    // Helper task to upload all parts of a session sequentially within that session
    async function uploadWorker(sessionId: string, fileName: string, parts: Buffer[]) {
      const uploadedResults = [];
      for (let p = 0; p < parts.length; p++) {
        // Introduce small micro-jitter to force interleaving across concurrency workers
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 5)));
        const res = await manager.uploadPart(sessionId, p + 1, parts[p], fileName);
        uploadedResults.push(res);
      }
      return uploadedResults;
    }

    // Launch all 3 upload sessions concurrently!
    const [resA, resB, resC] = await Promise.all([
      uploadWorker(sessionA_id, "FileA_45MB.pdf", fileA_parts),
      uploadWorker(sessionB_id, "FileB_19MBplus1.pdf", fileB_parts),
      uploadWorker(sessionC_id, "FileC_60MB.pdf", fileC_parts),
    ]);

    assert(resA.length === 3, "S5.1a: Session A uploaded exactly 3 parts concurrently");
    assert(resB.length === 2, "S5.1b: Session B uploaded exactly 2 parts concurrently");
    assert(resC.length === 4, "S5.1c: Session C uploaded exactly 4 parts concurrently");

    // Complete all 3 sessions and verify final SHA-256 and byte totals
    const finalA = manager.completeSession(sessionA_id);
    const finalB = manager.completeSession(sessionB_id);
    const finalC = manager.completeSession(sessionC_id);

    assert(finalA.fullSha256 === fileA_sha, `S5.2a: Session A SHA-256 matches File A (${fileA_sha.slice(0, 16)}...)`);
    assert(finalA.totalBytes === fileA_size, `S5.2b: Session A total bytes matches File A (${finalA.totalBytes})`);

    assert(finalB.fullSha256 === fileB_sha, `S5.2c: Session B SHA-256 matches File B (${fileB_sha.slice(0, 16)}...)`);
    assert(finalB.totalBytes === fileB_size, `S5.2d: Session B total bytes matches File B (${finalB.totalBytes})`);

    assert(finalC.fullSha256 === fileC_sha, `S5.2e: Session C SHA-256 matches File C (${fileC_sha.slice(0, 16)}...)`);
    assert(finalC.totalBytes === fileC_size, `S5.2f: Session C total bytes matches File C (${finalC.totalBytes})`);

    // Verify Zero Cross-Session Crosstalk
    // Check sent Telegram messages
    const msgsA = mockTg.sentMessages.filter((m) => m.fileName.includes("FileA"));
    const msgsB = mockTg.sentMessages.filter((m) => m.fileName.includes("FileB"));
    const msgsC = mockTg.sentMessages.filter((m) => m.fileName.includes("FileC"));

    assert(msgsA.length === 3, "S5.3a: Telegram received exactly 3 messages for File A");
    assert(msgsB.length === 2, "S5.3b: Telegram received exactly 2 messages for File B");
    assert(msgsC.length === 4, "S5.3c: Telegram received exactly 4 messages for File C");

    // Verify buffer content of each sent message matches the corresponding original part
    for (let i = 0; i < 3; i++) {
      assert(msgsA[i].buffer.equals(fileA_parts[i]), `S5.3d: File A message ${i + 1} content matches original part ${i + 1}`);
    }
    for (let i = 0; i < 2; i++) {
      assert(msgsB[i].buffer.equals(fileB_parts[i]), `S5.3e: File B message ${i + 1} content matches original part ${i + 1}`);
    }
    for (let i = 0; i < 4; i++) {
      assert(msgsC[i].buffer.equals(fileC_parts[i]), `S5.3f: File C message ${i + 1} content matches original part ${i + 1}`);
    }

    manager.deleteSession(sessionA_id);
    manager.deleteSession(sessionB_id);
    manager.deleteSession(sessionC_id);
  }

  // S5.4: Same-Session Concurrency Serialization & Collision Prevention
  {
    const mockTg = new AdversarialMockTelegram();
    const manager = new UploadSessionManager(mockTg);
    const sessionId = "same-session-concurrency";
    manager.startSession(sessionId, 2);

    // acquireLock lock test
    const lock1 = manager.acquireLock(sessionId);
    assert(lock1 === true, "S5.4a: First acquireLock on session succeeds");

    const lock2 = manager.acquireLock(sessionId);
    assert(lock2 === false, "S5.4b: Second concurrent acquireLock on same session is rejected (prevents race condition)");

    manager.releaseLock(sessionId);
    const lock3 = manager.acquireLock(sessionId);
    assert(lock3 === true, "S5.4c: acquireLock succeeds after release");
    manager.releaseLock(sessionId);
    manager.deleteSession(sessionId);
  }

  // S5.5: Fault Isolation under Concurrency (Blast Radius Isolation)
  // When Session 2 fails on part 2 and triggers rollback, Session 1 and Session 3 MUST NOT be affected!
  {
    const mockTg = new AdversarialMockTelegram();
    const manager = new UploadSessionManager(mockTg);

    const s1 = "session-blast-1";
    const s2 = "session-blast-2-fails";
    const s3 = "session-blast-3";

    manager.startSession(s1, 3, { fileName: "S1.pdf" });
    manager.startSession(s2, 3, { fileName: "S2.pdf" });
    manager.startSession(s3, 3, { fileName: "S3.pdf" });

    // Instruct mock Telegram to fail ONLY on part 2 of S2
    mockTg.failOnPartNo = 2;
    mockTg.failSessionId = "S2.pdf";

    const dummyChunk = Buffer.alloc(1024, 0x11);

    // Upload part 1 for all 3 sessions
    const p1_s1 = await manager.uploadPart(s1, 1, dummyChunk, "S1.pdf");
    const p1_s2 = await manager.uploadPart(s2, 1, dummyChunk, "S2.pdf");
    const p1_s3 = await manager.uploadPart(s3, 1, dummyChunk, "S3.pdf");

    // Part 2 for Session 1 succeeds
    await manager.uploadPart(s1, 2, dummyChunk, "S1.pdf");

    // Part 2 for Session 2 FAILS and triggers rollback of S2!
    let s2Failed = false;
    try {
      await manager.uploadPart(s2, 2, dummyChunk, "S2.pdf");
    } catch {
      s2Failed = true;
    }
    assert(s2Failed === true, "S5.5a: Session 2 failed on part 2 as expected");

    // Verify S2 rolled back its part 1
    assert(mockTg.deletedMessageIds.includes(p1_s2.messageId), "S5.5b: Session 2 part 1 was rolled back from Telegram");

    // Verify S1 and S3 messages were NOT deleted
    assert(!mockTg.deletedMessageIds.includes(p1_s1.messageId), "S5.5c: Session 1 message was NOT deleted (isolated)");
    assert(!mockTg.deletedMessageIds.includes(p1_s3.messageId), "S5.5d: Session 3 message was NOT deleted (isolated)");

    // Part 2 and 3 for Session 3 and Session 1 continue cleanly
    await manager.uploadPart(s3, 2, dummyChunk, "S3.pdf");
    await manager.uploadPart(s1, 3, dummyChunk, "S1.pdf");
    await manager.uploadPart(s3, 3, dummyChunk, "S3.pdf");

    const comp1 = manager.completeSession(s1);
    const comp3 = manager.completeSession(s3);

    assert(comp1.uploadedParts.length === 3, "S5.5e: Session 1 completed all 3 parts successfully despite peer failure");
    assert(comp3.uploadedParts.length === 3, "S5.5f: Session 3 completed all 3 parts successfully despite peer failure");
    assert(manager.getSession(s2) === null, "S5.5g: Failed Session 2 was cleanly purged from memory");

    manager.deleteSession(s1);
    manager.deleteSession(s3);
  }

  // S5.6: Stress Concurrency Scale (6 concurrent multi-part sessions)
  {
    const mockTg = new AdversarialMockTelegram();
    const manager = new UploadSessionManager(mockTg);
    const sessionCount = 6;
    const sessions = [];

    for (let i = 0; i < sessionCount; i++) {
      const id = `scale-sess-${i}`;
      const size = (15 + i * 5) * 1024 * 1024; // 15MB to 40MB
      const buf = createPdfBuffer(size, 0x10 + i);
      const sha = computeSha256(buf);
      const parts = sliceBuffer(buf, PART_SIZE_BYTES);
      manager.startSession(id, parts.length, { fileName: `Scale_${i}.pdf` });
      sessions.push({ id, size, sha, parts, fileName: `Scale_${i}.pdf` });
    }

    // Run all 6 sessions concurrently
    await Promise.all(
      sessions.map(async (s) => {
        for (let p = 0; p < s.parts.length; p++) {
          await manager.uploadPart(s.id, p + 1, s.parts[p], s.fileName);
        }
      })
    );

    let allCompletedAccurate = true;
    for (const s of sessions) {
      const comp = manager.completeSession(s.id);
      if (comp.fullSha256 !== s.sha || comp.totalBytes !== s.size) {
        allCompletedAccurate = false;
      }
      manager.deleteSession(s.id);
    }

    assert(allCompletedAccurate, "S5.6: All 6 high-concurrency parallel sessions verified with 100% SHA-256 fidelity");
  }
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
async function runAllSuites() {
  console.log("================================================================================");
  console.log("STARTING EMPIRICAL ADVERSARIAL HARNESS — CHUNKING & CONCURRENCY (CHALLENGER 2)");
  console.log("================================================================================");
  const startTime = Date.now();

  try {
    await runSuite1FileSplitting();
    await runSuite2ReassemblyVerification();
    await runSuite3OutOfOrderRejection();
    await runSuite4OversizedChunkRejection();
    await runSuite5ConcurrentUploads();
  } catch (uncaught) {
    console.error("FATAL UNCAUGHT HARNESS EXCEPTION:", uncaught);
    failedTests++;
    failureDetails.push(`Uncaught exception: ${uncaught}`);
  }

  const durationMs = Date.now() - startTime;
  console.log("\n================================================================================");
  console.log("HARNESS EXECUTION SUMMARY");
  console.log("================================================================================");
  console.log(`Total Scenarios / Invariants Tested : ${totalTests}`);
  console.log(`Passed                              : ${passedTests}`);
  console.log(`Failed                              : ${failedTests}`);
  console.log(`Execution Duration                  : ${(durationMs / 1000).toFixed(2)}s`);

  if (failedTests > 0) {
    console.error("\nFAILURES:");
    for (const f of failureDetails) {
      console.error(f);
    }
    console.error("\n>>> EMPIRICAL VERDICT: REQUEST_CHANGES <<<");
    process.exit(1);
  } else {
    console.log("\n>>> EMPIRICAL VERDICT: APPROVE (100% TESTS PASSED) <<<");
    process.exit(0);
  }
}

runAllSuites();
