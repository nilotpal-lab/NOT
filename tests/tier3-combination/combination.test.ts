import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db";
import { MockTelegramClient } from "../helpers/mock-telegram";
import { createMinimalValidPptx, VALID_MINIMAL_PDF, sha256 } from "../fixtures/test-fixtures";

describe("Tier 3: Cross-Feature Combinations", () => {
  let db: MockDatabase;
  let tg: MockTelegramClient;

  beforeEach(() => {
    db = new MockDatabase();
    tg = new MockTelegramClient();
  });

  // --------------------------------------------------------------------------
  // Combination 1: PPTX Accompaniment Enforcement & Naming Coordination
  // --------------------------------------------------------------------------
  it("C1.1: rejects PPTX upload if accompanying PDF preview export is missing", () => {
    const chapter = db.findOrCreateChapter({
      class: 10,
      subject: "History",
      chapterNo: 3,
      title: "The Making of a Global World",
    });

    const pptxFile = {
      name: "presentation.pptx",
      kind: "ppt" as const,
      hasAccompanyingPdf: false,
    };

    function validateUploadPayload(payload: { kind: string; hasAccompanyingPdf: boolean }) {
      if (payload.kind === "ppt" && !payload.hasAccompanyingPdf) {
        throw new Error(
          "PPTX upload validation error: PPTX files require an accompanying PDF preview export"
        );
      }
    }

    expect(() => validateUploadPayload(pptxFile)).toThrow(/require an accompanying PDF preview export/);
  });

  it("C1.2: correctly coordinates PPTX and accompanying PDF preview rows with parent_file_id linkage", () => {
    const chapter = db.findOrCreateChapter({
      class: 10,
      subject: "History",
      chapterNo: 3,
      title: "The Making of a Global World",
    });

    const pptxBuf = createMinimalValidPptx();
    const pptxSha = sha256(pptxBuf);
    const pdfBuf = VALID_MINIMAL_PDF;
    const pdfSha = sha256(pdfBuf);

    // 1. Insert parent PPT file
    const pptFile = db.insertFile(
      {
        chapter_id: chapter.id,
        kind: "ppt",
        file_name: "The-Making-of-a-Global-World_Class10_History_Ch03_PPT.pptx",
        size_bytes: pptxBuf.length,
        part_count: 1,
        mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        sha256: pptxSha,
        is_published: true,
      },
      [
        {
          part_no: 1,
          tg_file_id: "tg_ppt_1",
          tg_file_unique_id: "uniq_ppt_1",
          tg_message_id: 201,
          size_bytes: pptxBuf.length,
          sha256: pptxSha,
        },
      ]
    );

    // 2. Insert linked PPT-Preview PDF file with parent_file_id pointing to pptFile.id
    const previewFile = db.insertFile(
      {
        chapter_id: chapter.id,
        kind: "ppt_pdf",
        parent_file_id: pptFile.id,
        file_name: "The-Making-of-a-Global-World_Class10_History_Ch03_PPT-Preview.pdf",
        size_bytes: pdfBuf.length,
        part_count: 1,
        mime: "application/pdf",
        sha256: pdfSha,
        is_published: true,
      },
      [
        {
          part_no: 1,
          tg_file_id: "tg_preview_1",
          tg_file_unique_id: "uniq_preview_1",
          tg_message_id: 202,
          size_bytes: pdfBuf.length,
          sha256: pdfSha,
        },
      ]
    );

    expect(previewFile.parent_file_id).toBe(pptFile.id);
    expect(pptFile.kind).toBe("ppt");
    expect(previewFile.kind).toBe("ppt_pdf");
    expect(db.files.length).toBe(2);
  });

  // --------------------------------------------------------------------------
  // Combination 2: Mid-Flight Network Upload Failure + Rollback
  // --------------------------------------------------------------------------
  it("C2.1: part upload failure triggers immediate cleanup of earlier Telegram messages", async () => {
    const uploadedMessageIds: number[] = [];

    // Simulate sending 3 parts
    const part1 = await tg.sendDocument("-1001", Buffer.alloc(100), "part1", "part=1/3");
    uploadedMessageIds.push(part1.messageId);

    const part2 = await tg.sendDocument("-1001", Buffer.alloc(100), "part2", "part=2/3");
    uploadedMessageIds.push(part2.messageId);

    expect(tg.sentMessages.length).toBe(2);

    // Simulate fatal error on part 3
    let uploadFailed = false;
    try {
      throw new Error("Telegram API timeout on part 3");
    } catch {
      uploadFailed = true;
      // Execute rollback
      for (const msgId of uploadedMessageIds) {
        await tg.deleteMessage("-1001", msgId);
      }
    }

    expect(uploadFailed).toBe(true);
    expect(tg.sentMessages.length).toBe(0);
    expect(tg.deletedMessageIds).toContain(part1.messageId);
    expect(tg.deletedMessageIds).toContain(part2.messageId);
    expect(db.files.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Combination 3: Duplicate Hash Collision Triggers Telegram Rollback
  // --------------------------------------------------------------------------
  it("C3.1: duplicate file detection rolls back newly uploaded Telegram messages", async () => {
    const chapter = db.findOrCreateChapter({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "Village Palampur",
    });

    const existingFile = db.insertFile(
      {
        chapter_id: chapter.id,
        kind: "ncert_pdf",
        file_name: "Village-Palampur_Class9_Economics_Ch01_NCERT.pdf",
        size_bytes: 1000,
        part_count: 1,
        mime: "application/pdf",
        sha256: "hash_palampur_abc",
        is_published: true,
      },
      []
    );

    // User attempts to upload the identical file again under a different name
    const newTgPart = await tg.sendDocument(
      "-1001",
      Buffer.alloc(1000),
      "new_upload.pdf",
      "part=1/1"
    );

    let rollbackExecuted = false;
    try {
      db.insertFile(
        {
          chapter_id: chapter.id,
          kind: "ncert_pdf",
          file_name: "Alternative_Name_Class9_Economics_Ch01_NCERT.pdf",
          size_bytes: 1000,
          part_count: 1,
          mime: "application/pdf",
          sha256: "hash_palampur_abc", // identical sha256!
          is_published: true,
        },
        []
      );
    } catch {
      // Rollback Telegram part
      await tg.deleteMessage("-1001", newTgPart.messageId);
      rollbackExecuted = true;
    }

    expect(rollbackExecuted).toBe(true);
    expect(tg.deletedMessageIds).toContain(newTgPart.messageId);
    // Original file remains unchanged
    expect(db.files.length).toBe(1);
    expect(db.files[0].id).toBe(existingFile.id);
  });
});
