import { describe, it, expect } from "vitest";
import { MockDatabase } from "../helpers/mock-db";
import { MockTelegramClient } from "../helpers/mock-telegram";
import {
  hashPassword,
  verifyPassword,
  createAdminToken,
  verifyAdminToken,
} from "@/lib/auth";
import { PART_SIZE_BYTES } from "@/lib/validate";
import { sha256, createDeterministicBuffer } from "../fixtures/test-fixtures";

describe("Tier 4: Real-World Scenarios (End-to-End Lifecycle)", () => {
  it("executes complete admin lifecycle: login -> chapter creation -> multipart upload -> visibility toggle -> cascade rename -> delete & tg cleanup", async () => {
    const db = new MockDatabase();
    const tg = new MockTelegramClient();

    // ------------------------------------------------------------------------
    // Step 1: Admin Login
    // ------------------------------------------------------------------------
    const adminPassword = "SuperSecureTeacherPassword2026!";
    const storedHash = await hashPassword(adminPassword);
    const sessionSecret = "long-session-secret-at-least-32-chars-ok";

    // Admin submits credentials
    const credentialsMatch = await verifyPassword(adminPassword, storedHash);
    expect(credentialsMatch).toBe(true);

    // Issue JWT session cookie
    const adminToken = await createAdminToken(sessionSecret);
    expect(typeof adminToken).toBe("string");

    // ------------------------------------------------------------------------
    // Step 2: Session Verification on Protected Route
    // ------------------------------------------------------------------------
    const isSessionValid = await verifyAdminToken(adminToken, sessionSecret);
    expect(isSessionValid).toBeTruthy();

    // ------------------------------------------------------------------------
    // Step 3: Chapter Creation & Multipart Upload
    // ------------------------------------------------------------------------
    // Find or create chapter for Class 9 Economics Chapter 1
    const chapter = db.findOrCreateChapter({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "The Story of Village Palampur",
    });
    expect(chapter.id).toBeDefined();

    // Generate ~40 MB mock educational PDF
    const fileSize = 40 * 1024 * 1024; // 40 MB
    const fileBuffer = createDeterministicBuffer(fileSize, 0x88);
    const originalFileSha = sha256(fileBuffer);

    // Slice file into parts <= 19 MiB
    const parts: Buffer[] = [];
    let offset = 0;
    while (offset < fileBuffer.length) {
      const end = Math.min(offset + PART_SIZE_BYTES, fileBuffer.length);
      parts.push(fileBuffer.subarray(offset, end));
      offset = end;
    }
    expect(parts.length).toBe(3); // 19 MiB + 19 MiB + 2 MiB

    // Forward each part sequentially to Telegram
    const uploadedPartMeta: Array<{
      partNo: number;
      tgFileId: string;
      tgFileUniqueId: string;
      tgMessageId: number;
      sizeBytes: number;
      sha256: string;
    }> = [];

    const standardFileName =
      "The-Story-of-Village-Palampur_Class9_Economics_Ch01_NCERT.pdf";

    for (let i = 0; i < parts.length; i++) {
      const partNo = i + 1;
      const partSlice = parts[i];
      const partSha = sha256(partSlice);
      const caption = `name=${standardFileName}|part=${partNo}/${parts.length}`;

      const { messageId, fileId, fileUniqueId } = await tg.sendDocument(
        "-1001234567890",
        partSlice,
        `${standardFileName}.part${partNo}`,
        caption
      );

      uploadedPartMeta.push({
        partNo,
        tgFileId: fileId,
        tgFileUniqueId: fileUniqueId,
        tgMessageId: messageId,
        sizeBytes: partSlice.length,
        sha256: partSha,
      });
    }

    expect(tg.sentMessages.length).toBe(3);

    // Write database record in Supabase
    const fileRecord = db.insertFile(
      {
        chapter_id: chapter.id,
        kind: "ncert_pdf",
        file_name: standardFileName,
        size_bytes: fileSize,
        part_count: parts.length,
        mime: "application/pdf",
        sha256: originalFileSha,
        is_published: true,
      },
      uploadedPartMeta.map((p) => ({
        part_no: p.partNo,
        tg_file_id: p.tgFileId,
        tg_file_unique_id: p.tgFileUniqueId,
        tg_message_id: p.tgMessageId,
        size_bytes: p.sizeBytes,
        sha256: p.sha256,
      }))
    );

    expect(db.files.length).toBe(1);
    expect(db.fileParts.length).toBe(3);
    expect(fileRecord.sha256).toBe(originalFileSha);

    // ------------------------------------------------------------------------
    // Step 4: Catalog Visibility Toggle
    // ------------------------------------------------------------------------
    // Verify file is currently published
    expect(fileRecord.is_published).toBe(true);

    // Admin toggles visibility to hidden
    const hiddenFile = db.togglePublished(fileRecord.id, false);
    expect(hiddenFile.is_published).toBe(false);

    // Verify public query (publishedOnly = true) excludes file
    const publicFiles = db.files.filter((f) => f.is_published);
    expect(publicFiles.length).toBe(0);

    // Admin unhides file
    const unhiddenFile = db.togglePublished(fileRecord.id, true);
    expect(unhiddenFile.is_published).toBe(true);
    expect(db.files.filter((f) => f.is_published).length).toBe(1);

    // ------------------------------------------------------------------------
    // Step 5: Chapter Rename Cascade
    // ------------------------------------------------------------------------
    const newChapterTitle = "Village Palampur Economy";
    const { chapter: renamedChapter, updatedCount } = db.renameChapter(
      chapter.id,
      newChapterTitle,
      (ch, file) => {
        // Cascade rename file_name
        const slug = ch.title.replace(/\s+/g, "-");
        return `${slug}_Class${ch.class}_${ch.subject}_Ch01_NCERT.pdf`;
      }
    );

    expect(renamedChapter.title).toBe(newChapterTitle);
    expect(updatedCount).toBe(1);
    expect(db.files[0].file_name).toBe(
      "Village-Palampur-Economy_Class9_Economics_Ch01_NCERT.pdf"
    );

    // ------------------------------------------------------------------------
    // Step 6: File Deletion & Telegram Cleanup
    // ------------------------------------------------------------------------
    const { deletedFile, deletedPartMessageIds } = db.deleteFile(fileRecord.id);
    expect(deletedFile.id).toBe(fileRecord.id);

    // Purge all Telegram parts
    for (const msgId of deletedPartMessageIds) {
      await tg.deleteMessage("-1001234567890", msgId);
    }

    // Verify complete cleanup: 0 files, 0 parts in DB, all Telegram parts deleted
    expect(db.files.length).toBe(0);
    expect(db.fileParts.length).toBe(0);
    for (const part of uploadedPartMeta) {
      expect(tg.deletedMessageIds).toContain(part.tgMessageId);
    }
  });
});
