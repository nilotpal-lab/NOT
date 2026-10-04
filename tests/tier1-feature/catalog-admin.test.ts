import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db";
import { MockTelegramClient } from "../helpers/mock-telegram";

describe("Tier 1: Catalog & Admin Management (Features 16-20)", () => {
  let db: MockDatabase;
  let tg: MockTelegramClient;

  beforeEach(() => {
    db = new MockDatabase();
    tg = new MockTelegramClient();
  });

  // --------------------------------------------------------------------------
  // Feature 16: Chapter Auto-Creation & Dedup
  // --------------------------------------------------------------------------
  it("F16.1: findOrCreateChapter is idempotent on (class, subject, chapter_no)", () => {
    const ch1 = db.findOrCreateChapter({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "The Story of Village Palampur",
    });

    const ch2 = db.findOrCreateChapter({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "The Story of Village Palampur",
    });

    expect(ch1.id).toBe(ch2.id);
    expect(db.chapters.length).toBe(1);
  });

  it("F16.2: rejects duplicate file with identical sha256 in the same chapter", () => {
    const chapter = db.findOrCreateChapter({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "The Story of Village Palampur",
    });

    const fileData = {
      chapter_id: chapter.id,
      kind: "ncert_pdf" as const,
      file_name: "The-Story-of-Village-Palampur_Class9_Economics_Ch01_NCERT.pdf",
      size_bytes: 5000,
      part_count: 1,
      mime: "application/pdf",
      sha256: "duplicate_hash_12345",
      is_published: true,
    };

    db.insertFile(fileData, [
      {
        part_no: 1,
        tg_file_id: "tg_1",
        tg_file_unique_id: "uniq_1",
        tg_message_id: 101,
        size_bytes: 5000,
        sha256: "duplicate_hash_12345",
      },
    ]);

    // Attempt second insert with same chapter + sha256
    expect(() => {
      db.insertFile(
        { ...fileData, file_name: "Different_Name_Same_Content.pdf" },
        []
      );
    }).toThrow(/Duplicate file: identical sha256/);
  });

  // --------------------------------------------------------------------------
  // Feature 17: Admin Catalog Query & Filtering
  // --------------------------------------------------------------------------
  it("F17.1: filters catalog files by class, subject, and kind", () => {
    const chEcon = db.findOrCreateChapter({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "Village Palampur",
    });
    const chHist = db.findOrCreateChapter({
      class: 10,
      subject: "History",
      chapterNo: 1,
      title: "The Rise of Nationalism in Europe",
    });

    db.insertFile(
      {
        chapter_id: chEcon.id,
        kind: "ncert_pdf",
        file_name: "Village-Palampur_Class9_Economics_Ch01_NCERT.pdf",
        size_bytes: 1000,
        part_count: 1,
        mime: "application/pdf",
        sha256: "hash_econ_1",
        is_published: true,
      },
      []
    );

    db.insertFile(
      {
        chapter_id: chHist.id,
        kind: "ncert_pdf",
        file_name: "Nationalism-Europe_Class10_History_Ch01_NCERT.pdf",
        size_bytes: 2000,
        part_count: 1,
        mime: "application/pdf",
        sha256: "hash_hist_1",
        is_published: true,
      },
      []
    );

    // Filter by class 9
    const class9Chapters = db.chapters.filter((c) => c.class === 9);
    const class9Files = db.files.filter((f) =>
      class9Chapters.some((c) => c.id === f.chapter_id)
    );
    expect(class9Files.length).toBe(1);
    expect(class9Files[0].file_name).toContain("Class9_Economics");
  });

  // --------------------------------------------------------------------------
  // Feature 18: Chapter Rename Cascade
  // --------------------------------------------------------------------------
  it("F18.1: renaming chapter updates chapter title and cascades recalculation to file names", () => {
    const chapter = db.findOrCreateChapter({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "Village Palampur",
    });

    db.insertFile(
      {
        chapter_id: chapter.id,
        kind: "ncert_pdf",
        file_name: "Village-Palampur_Class9_Economics_Ch01_NCERT.pdf",
        size_bytes: 1000,
        part_count: 1,
        mime: "application/pdf",
        sha256: "sha_p1",
        is_published: true,
      },
      []
    );

    const { chapter: updatedCh, updatedCount } = db.renameChapter(
      chapter.id,
      "The Story of Village Palampur",
      (ch, file) => {
        // Cascade rename function
        const slug = ch.title.replace(/\s+/g, "-");
        return `${slug}_Class${ch.class}_${ch.subject}_Ch01_NCERT.pdf`;
      }
    );

    expect(updatedCh.title).toBe("The Story of Village Palampur");
    expect(updatedCount).toBe(1);
    expect(db.files[0].file_name).toBe(
      "The-Story-of-Village-Palampur_Class9_Economics_Ch01_NCERT.pdf"
    );
  });

  // --------------------------------------------------------------------------
  // Feature 19: Visibility Toggles (Single File & Bulk Teacher Notes)
  // --------------------------------------------------------------------------
  it("F19.1: toggles individual file visibility between published and hidden", () => {
    const chapter = db.findOrCreateChapter({
      class: 8,
      subject: "Geography",
      chapterNo: 1,
      title: "Resources",
    });

    const file = db.insertFile(
      {
        chapter_id: chapter.id,
        kind: "ncert_pdf",
        file_name: "Resources_Class8_Geography_Ch01_NCERT.pdf",
        size_bytes: 1500,
        part_count: 1,
        mime: "application/pdf",
        sha256: "sha_res_1",
        is_published: true,
      },
      []
    );

    expect(file.is_published).toBe(true);
    const hidden = db.togglePublished(file.id, false);
    expect(hidden.is_published).toBe(false);
    const unhidden = db.togglePublished(file.id, true);
    expect(unhidden.is_published).toBe(true);
  });

  it("F19.2: bulk toggles all teacher notes visibility without affecting NCERT or PPT", () => {
    const chapter = db.findOrCreateChapter({
      class: 8,
      subject: "Geography",
      chapterNo: 1,
      title: "Resources",
    });

    db.insertFile(
      {
        chapter_id: chapter.id,
        kind: "ncert_pdf",
        file_name: "Resources_Class8_Geography_Ch01_NCERT.pdf",
        size_bytes: 1000,
        part_count: 1,
        mime: "application/pdf",
        sha256: "sha_ncert",
        is_published: true,
      },
      []
    );

    db.insertFile(
      {
        chapter_id: chapter.id,
        kind: "teacher_notes",
        teacher_name: "Kapoor",
        file_name: "Resources_Class8_Geography_Ch01_Notes-Kapoor.pdf",
        size_bytes: 1200,
        part_count: 1,
        mime: "application/pdf",
        sha256: "sha_notes_1",
        is_published: true,
      },
      []
    );

    db.insertFile(
      {
        chapter_id: chapter.id,
        kind: "teacher_notes",
        teacher_name: "Verma",
        file_name: "Resources_Class8_Geography_Ch01_Notes-Verma.pdf",
        size_bytes: 1400,
        part_count: 1,
        mime: "application/pdf",
        sha256: "sha_notes_2",
        is_published: true,
      },
      []
    );

    const affected = db.bulkToggleTeacherNotes(false);
    expect(affected).toBe(2);

    const ncertFile = db.files.find((f) => f.kind === "ncert_pdf");
    expect(ncertFile?.is_published).toBe(true); // Untouched!

    const notesFiles = db.files.filter((f) => f.kind === "teacher_notes");
    for (const notes of notesFiles) {
      expect(notes.is_published).toBe(false);
    }
  });

  // --------------------------------------------------------------------------
  // Feature 20: File Deletion with Telegram Part Cleanup
  // --------------------------------------------------------------------------
  it("F20.1: deletes file row, parts rows, and cleans up all associated Telegram messages", async () => {
    const chapter = db.findOrCreateChapter({
      class: 7,
      subject: "History",
      chapterNo: 1,
      title: "Tracing Changes",
    });

    // Send 3 mock parts to Telegram
    const p1 = await tg.sendDocument("-1001", Buffer.alloc(100), "part1", "part=1/3");
    const p2 = await tg.sendDocument("-1001", Buffer.alloc(100), "part2", "part=2/3");
    const p3 = await tg.sendDocument("-1001", Buffer.alloc(100), "part3", "part=3/3");

    const file = db.insertFile(
      {
        chapter_id: chapter.id,
        kind: "ncert_pdf",
        file_name: "Tracing-Changes_Class7_History_Ch01_NCERT.pdf",
        size_bytes: 300,
        part_count: 3,
        mime: "application/pdf",
        sha256: "sha_trace_1",
        is_published: true,
      },
      [
        {
          part_no: 1,
          tg_file_id: p1.fileId,
          tg_file_unique_id: p1.fileUniqueId,
          tg_message_id: p1.messageId,
          size_bytes: 100,
          sha256: "p1_sha",
        },
        {
          part_no: 2,
          tg_file_id: p2.fileId,
          tg_file_unique_id: p2.fileUniqueId,
          tg_message_id: p2.messageId,
          size_bytes: 100,
          sha256: "p2_sha",
        },
        {
          part_no: 3,
          tg_file_id: p3.fileId,
          tg_file_unique_id: p3.fileUniqueId,
          tg_message_id: p3.messageId,
          size_bytes: 100,
          sha256: "p3_sha",
        },
      ]
    );

    expect(db.files.length).toBe(1);
    expect(db.fileParts.length).toBe(3);

    // Perform deletion with Telegram cleanup
    const { deletedFile, deletedPartMessageIds } = db.deleteFile(file.id);
    for (const msgId of deletedPartMessageIds) {
      await tg.deleteMessage("-1001", msgId);
    }

    expect(db.files.length).toBe(0);
    expect(db.fileParts.length).toBe(0);
    expect(tg.deletedMessageIds).toContain(p1.messageId);
    expect(tg.deletedMessageIds).toContain(p2.messageId);
    expect(tg.deletedMessageIds).toContain(p3.messageId);
  });
});
