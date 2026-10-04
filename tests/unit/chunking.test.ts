import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { PART_SIZE_BYTES } from "@/lib/validate";
import {
  sliceBuffer,
  calculatePartCount,
  validateChunkSize,
  UploadSessionManager,
} from "@/lib/upload-session";
import { createDeterministicBuffer, sha256 } from "../fixtures/test-fixtures";
import { MockTelegramClient } from "../helpers/mock-telegram";
import { MockDatabase } from "../helpers/mock-db";

describe("Unit: File Splitting, Chunk Sizing & Streaming SHA-256", () => {
  // --------------------------------------------------------------------------
  // C1.1: 1-Byte File Slicing
  // --------------------------------------------------------------------------
  it("C1.1: splits 1-byte file into exactly 1 part <= 19 MiB and reassembles identically", () => {
    const original = Buffer.from([0x42]);
    const originalSha = sha256(original);
    const parts = sliceBuffer(original, PART_SIZE_BYTES);

    expect(parts.length).toBe(1);
    expect(parts[0].length).toBe(1);
    expect(parts[0].length).toBeLessThanOrEqual(PART_SIZE_BYTES);

    const reassembled = Buffer.concat(parts);
    expect(reassembled.equals(original)).toBe(true);
    expect(sha256(reassembled)).toBe(originalSha);
  });

  // --------------------------------------------------------------------------
  // C1.2: Exactly 19 MiB File Slicing
  // --------------------------------------------------------------------------
  it("C1.2: splits exactly 19 MiB file into exactly 1 part of 19922944 bytes", () => {
    const size = PART_SIZE_BYTES; // 19,922,944 bytes
    const original = createDeterministicBuffer(size, 0x11);
    const originalSha = sha256(original);
    const parts = sliceBuffer(original, PART_SIZE_BYTES);

    expect(parts.length).toBe(1);
    expect(parts[0].length).toBe(PART_SIZE_BYTES);
    expect(parts[0].length).toBeLessThanOrEqual(PART_SIZE_BYTES);

    const reassembled = Buffer.concat(parts);
    expect(reassembled.equals(original)).toBe(true);
    expect(sha256(reassembled)).toBe(originalSha);
  });

  // --------------------------------------------------------------------------
  // C1.3: Exactly 19 MiB + 1 Byte File Slicing
  // --------------------------------------------------------------------------
  it("C1.3: splits 19 MiB + 1 byte file into exactly 2 parts (19922944 + 1 bytes)", () => {
    const size = PART_SIZE_BYTES + 1; // 19,922,945 bytes
    const original = createDeterministicBuffer(size, 0x22);
    const originalSha = sha256(original);
    const parts = sliceBuffer(original, PART_SIZE_BYTES);

    expect(parts.length).toBe(2);
    expect(parts[0].length).toBe(PART_SIZE_BYTES);
    expect(parts[1].length).toBe(1);
    expect(parts[0].length).toBeLessThanOrEqual(PART_SIZE_BYTES);
    expect(parts[1].length).toBeLessThanOrEqual(PART_SIZE_BYTES);

    const reassembled = Buffer.concat(parts);
    expect(reassembled.length).toBe(size);
    expect(reassembled.equals(original)).toBe(true);
    expect(sha256(reassembled)).toBe(originalSha);
  });

  // --------------------------------------------------------------------------
  // C1.4: 45 MB File Slicing (Smoke Test Size)
  // --------------------------------------------------------------------------
  it("C1.4: splits 45 MB file into exactly 3 parts <= 19 MiB and reassembles identically", () => {
    const size = 45 * 1024 * 1024; // 47,185,920 bytes
    const original = createDeterministicBuffer(size, 0x33);
    const originalSha = sha256(original);
    const parts = sliceBuffer(original, PART_SIZE_BYTES);

    expect(parts.length).toBe(3);
    expect(parts[0].length).toBe(PART_SIZE_BYTES);
    expect(parts[1].length).toBe(PART_SIZE_BYTES);
    expect(parts[2].length).toBe(size - 2 * PART_SIZE_BYTES); // 7,340,032 bytes

    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(PART_SIZE_BYTES);
    }

    const reassembled = Buffer.concat(parts);
    expect(reassembled.length).toBe(size);
    expect(reassembled.equals(original)).toBe(true);
    expect(sha256(reassembled)).toBe(originalSha);
  });

  // --------------------------------------------------------------------------
  // C1.5: 100 MB File Slicing (MAX_FILE_MB Default Ceiling)
  // --------------------------------------------------------------------------
  it("C1.5: splits 100 MB file into exactly 6 parts <= 19 MiB and reassembles identically", () => {
    const size = 100 * 1024 * 1024; // 104,857,600 bytes
    const original = createDeterministicBuffer(size, 0x44);
    const originalSha = sha256(original);
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
    expect(sha256(reassembled)).toBe(originalSha);
  });

  // --------------------------------------------------------------------------
  // C1.6: Streaming Incremental SHA-256 vs Single-Shot Digest
  // --------------------------------------------------------------------------
  it("C1.6: incremental streaming SHA-256 matches single-shot digest across parts", () => {
    const size = 25 * 1024 * 1024; // 25 MB (2 parts: 19 MiB + ~6 MiB)
    const testBuffer = createDeterministicBuffer(size, 0x55);
    const singleShotSha = sha256(testBuffer);

    const parts = sliceBuffer(testBuffer, PART_SIZE_BYTES);
    const incrementalHash = crypto.createHash("sha256");

    for (const part of parts) {
      incrementalHash.update(part);
    }

    const streamingSha = incrementalHash.digest("hex");
    expect(streamingSha).toBe(singleShotSha);
  });

  // --------------------------------------------------------------------------
  // C1.7: Empty Buffer Edge Case
  // --------------------------------------------------------------------------
  it("C1.7: empty buffer returns empty array without errors", () => {
    const emptyBuf = Buffer.alloc(0);
    const parts = sliceBuffer(emptyBuf, PART_SIZE_BYTES);
    expect(parts).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // C1.8: Part Count Calculation Function
  // --------------------------------------------------------------------------
  it("C1.8: calculatePartCount returns exact mathematical part counts", () => {
    expect(calculatePartCount(0)).toBe(0);
    expect(calculatePartCount(1)).toBe(1);
    expect(calculatePartCount(PART_SIZE_BYTES)).toBe(1);
    expect(calculatePartCount(PART_SIZE_BYTES + 1)).toBe(2);
    expect(calculatePartCount(45 * 1024 * 1024)).toBe(3);
    expect(calculatePartCount(100 * 1024 * 1024)).toBe(6);
  });

  // --------------------------------------------------------------------------
  // C1.9: Oversized Part Validation Rejection
  // --------------------------------------------------------------------------
  it("C1.9: validateChunkSize and uploadPart reject chunks exceeding 19 MiB", async () => {
    const oversizedSize = PART_SIZE_BYTES + 1;
    const check = validateChunkSize(oversizedSize);
    expect(check.valid).toBe(false);
    expect(check.error).toMatch(/exceeds maximum chunk size of 19 MiB/);

    const zeroCheck = validateChunkSize(0);
    expect(zeroCheck.valid).toBe(false);
    expect(zeroCheck.error).toMatch(/cannot be empty/);

    const mockTg = new MockTelegramClient();
    const mockDb = new MockDatabase();
    const manager = new UploadSessionManager(mockTg, mockDb);

    manager.startSession("session-oversized-check", 2);
    const oversizedBuffer = Buffer.alloc(PART_SIZE_BYTES + 1);

    await expect(
      manager.uploadPart("session-oversized-check", 1, oversizedBuffer, "oversized.pdf")
    ).rejects.toThrow(/exceeds maximum chunk size of 19 MiB/);
  });
});
