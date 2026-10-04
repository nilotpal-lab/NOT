import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getChaptersWithFiles,
  renameChapter,
  toggleFilePublished,
  bulkToggleTeacherNotes,
  deleteFileWithTelegramCleanup,
} from "@/lib/catalog";
import * as dbModule from "@/lib/db";
import { TelegramClient } from "@/lib/telegram";
import { Chapter, FileRecord, FilePart } from "@/types/database";

describe("Milestone M4: Catalog Data Service & Admin Management (tests/unit/catalog.test.ts)", () => {
  let mockChapters: Chapter[];
  let mockFiles: FileRecord[];
  let mockFileParts: FilePart[];

  let deletedTgMessages: number[];
  let mockTgClient: TelegramClient;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockChapters = [
      {
        id: "chap-econ-1",
        class: 9,
        subject: "Economics",
        chapter_no: 1,
        title: "Village Palampur",
        created_at: "2026-01-01T10:00:00Z",
      },
      {
        id: "chap-hist-1",
        class: 10,
        subject: "History",
        chapter_no: 1,
        title: "Rise of Nationalism",
        created_at: "2026-01-02T10:00:00Z",
      },
    ];

    mockFiles = [
      {
        id: "file-econ-ncert",
        chapter_id: "chap-econ-1",
        kind: "ncert_pdf",
        file_name: "Village-Palampur_Class9_Economics_Ch01_NCERT.pdf",
        size_bytes: 1024,
        part_count: 1,
        mime: "application/pdf",
        sha256: "sha_econ_ncert",
        is_published: true,
        created_at: "2026-01-01T10:05:00Z",
      },
      {
        id: "file-econ-notes-1",
        chapter_id: "chap-econ-1",
        kind: "teacher_notes",
        teacher_name: "Sharma",
        file_name: "Village-Palampur_Class9_Economics_Ch01_Notes-Sharma.pdf",
        size_bytes: 2048,
        part_count: 1,
        mime: "application/pdf",
        sha256: "sha_econ_notes_1",
        is_published: true,
        created_at: "2026-01-01T10:10:00Z",
      },
      {
        id: "file-econ-notes-2",
        chapter_id: "chap-econ-1",
        kind: "teacher_notes",
        teacher_name: "Sharma",
        file_name: "Village-Palampur_Class9_Economics_Ch01_Notes-Sharma-2.pdf",
        size_bytes: 2050,
        part_count: 1,
        mime: "application/pdf",
        sha256: "sha_econ_notes_2",
        is_published: true,
        created_at: "2026-01-01T10:15:00Z",
      },
      {
        id: "file-hist-ppt",
        chapter_id: "chap-hist-1",
        kind: "ppt",
        file_name: "Rise-of-Nationalism_Class10_History_Ch01_PPT.pptx",
        size_bytes: 4096,
        part_count: 2,
        mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        sha256: "sha_hist_ppt",
        is_published: false,
        created_at: "2026-01-02T10:05:00Z",
      },
    ];

    mockFileParts = [
      {
        file_id: "file-econ-ncert",
        part_no: 1,
        tg_file_id: "tg_1",
        tg_file_unique_id: "uniq_1",
        tg_message_id: 1001,
        size_bytes: 1024,
        sha256: "sha_econ_ncert",
      },
      {
        file_id: "file-econ-notes-1",
        part_no: 1,
        tg_file_id: "tg_2",
        tg_file_unique_id: "uniq_2",
        tg_message_id: 1002,
        size_bytes: 2048,
        sha256: "sha_econ_notes_1",
      },
      {
        file_id: "file-econ-notes-2",
        part_no: 1,
        tg_file_id: "tg_3",
        tg_file_unique_id: "uniq_3",
        tg_message_id: 1003,
        size_bytes: 2050,
        sha256: "sha_econ_notes_2",
      },
      {
        file_id: "file-hist-ppt",
        part_no: 1,
        tg_file_id: "tg_4",
        tg_file_unique_id: "uniq_4",
        tg_message_id: 2001,
        size_bytes: 2048,
        sha256: "sha_hist_ppt_p1",
      },
      {
        file_id: "file-hist-ppt",
        part_no: 2,
        tg_file_id: "tg_5",
        tg_file_unique_id: "uniq_5",
        tg_message_id: 2002,
        size_bytes: 2048,
        sha256: "sha_hist_ppt_p2",
      },
    ];

    deletedTgMessages = [];
    mockTgClient = {
      deleteMessage: vi.fn(async (_ch: string | number, msgId: number) => {
        deletedTgMessages.push(msgId);
        return true;
      }),
    } as unknown as TelegramClient;

    // Fluent mock implementation of Supabase getDb()
    const mockDb = {
      from: vi.fn((table: string) => {
        let currentClassFilter: number | null = null;
        let currentSubjectFilter: string | null = null;
        const currentEqFilters: Record<string, unknown> = {};
        const currentNeqFilters: Record<string, unknown> = {};
        let updatePayload: Record<string, unknown> | null = null;
        let isDelete = false;

        const chain: Record<string, unknown> = {
          select: vi.fn((_cols?: string, _opts?: unknown) => chain),
          order: vi.fn((_col: string, _opts?: unknown) => chain),
          eq: vi.fn((field: string, val: unknown) => {
            currentEqFilters[field] = val;
            if (field === "class") currentClassFilter = val as number;
            if (field === "subject") currentSubjectFilter = val as string;
            return chain;
          }),
          neq: vi.fn((field: string, val: unknown) => {
            currentNeqFilters[field] = val;
            return chain;
          }),
          update: vi.fn((payload: Record<string, unknown>) => {
            updatePayload = payload;
            return chain;
          }),
          delete: vi.fn(() => {
            isDelete = true;
            return chain;
          }),
          single: vi.fn(async () => {
            if (table === "chapters") {
              const targetId = currentEqFilters.id as string;
              const ch = mockChapters.find((c) => c.id === targetId);
              if (!ch) return { data: null, error: new Error("Chapter not found") };
              if (updatePayload) {
                Object.assign(ch, updatePayload);
              }
              return { data: { ...ch }, error: null };
            }
            if (table === "files") {
              const targetId = currentEqFilters.id as string;
              const f = mockFiles.find((file) => file.id === targetId);
              if (!f) return { data: null, error: new Error("File not found") };
              if (updatePayload) {
                Object.assign(f, updatePayload);
              }
              return { data: { ...f }, error: null };
            }
            return { data: null, error: null };
          }),
          maybeSingle: vi.fn(async () => {
            if (table === "chapters") {
              const targetId = currentEqFilters.id as string;
              const ch = mockChapters.find((c) => c.id === targetId);
              return { data: ch ? { ...ch } : null, error: null };
            }
            if (table === "files") {
              const targetId = currentEqFilters.id as string;
              const f = mockFiles.find((file) => file.id === targetId);
              return { data: f ? { ...f } : null, error: null };
            }
            return { data: null, error: null };
          }),
          then: (resolve: (val: unknown) => void) => {
            if (table === "chapters") {
              if (isDelete && currentEqFilters.id) {
                const idx = mockChapters.findIndex((c) => c.id === currentEqFilters.id);
                if (idx !== -1) mockChapters.splice(idx, 1);
                return Promise.resolve({ data: null, error: null }).then(resolve);
              }

              let result = [...mockChapters];
              if (currentClassFilter !== null) {
                result = result.filter((c) => c.class === currentClassFilter);
              }
              if (currentSubjectFilter !== null) {
                result = result.filter((c) => c.subject === currentSubjectFilter);
              }
              const withFiles = result.map((c) => ({
                ...c,
                files: mockFiles
                  .filter((f) => f.chapter_id === c.id)
                  .map((f) => ({
                    ...f,
                    file_parts: mockFileParts.filter((p) => p.file_id === f.id),
                  })),
              }));
              return Promise.resolve({ data: withFiles, error: null }).then(resolve);
            }

            if (table === "files") {
              if (isDelete && currentEqFilters.id) {
                const idx = mockFiles.findIndex((f) => f.id === currentEqFilters.id);
                if (idx !== -1) mockFiles.splice(idx, 1);
                return Promise.resolve({ data: null, error: null }).then(resolve);
              }

              if (updatePayload && currentEqFilters.kind) {
                const affected: Array<{ id: string }> = [];
                mockFiles.forEach((f) => {
                  if (f.kind === currentEqFilters.kind) {
                    Object.assign(f, updatePayload);
                    affected.push({ id: f.id });
                  }
                });
                return Promise.resolve({ data: affected, error: null }).then(resolve);
              }

              if (updatePayload && currentEqFilters.id) {
                const f = mockFiles.find((file) => file.id === currentEqFilters.id);
                if (f) Object.assign(f, updatePayload);
                return Promise.resolve({ data: f ? { ...f } : null, error: null }).then(resolve);
              }

              let res = [...mockFiles];
              if (currentEqFilters.chapter_id) {
                res = res.filter((f) => f.chapter_id === currentEqFilters.chapter_id);
              }
              if (currentNeqFilters.chapter_id) {
                res = res.filter((f) => f.chapter_id !== currentNeqFilters.chapter_id);
              }
              return Promise.resolve({ data: res, count: res.length, error: null }).then(resolve);
            }

            if (table === "file_parts") {
              if (isDelete && currentEqFilters.file_id) {
                mockFileParts = mockFileParts.filter((p) => p.file_id !== currentEqFilters.file_id);
                return Promise.resolve({ data: null, error: null }).then(resolve);
              }

              let res = [...mockFileParts];
              if (currentEqFilters.file_id) {
                res = res.filter((p) => p.file_id === currentEqFilters.file_id);
              }
              return Promise.resolve({ data: res, error: null }).then(resolve);
            }

            return Promise.resolve({ data: [], error: null }).then(resolve);
          },
        };

        return chain;
      }),
    };

    vi.spyOn(dbModule, "getDb").mockReturnValue(mockDb as unknown as ReturnType<typeof dbModule.getDb>);
  });

  // ==========================================================================
  // 1. getChaptersWithFiles Filtering & Sorting
  // ==========================================================================
  describe("getChaptersWithFiles", () => {
    it("retrieves all chapters with nested files and file_parts without filters", async () => {
      const res = await getChaptersWithFiles();
      expect(res.length).toBe(2);
      const econ = res.find((c) => c.subject === "Economics");
      expect(econ?.files.length).toBe(3);
      expect(econ?.files[0].file_parts?.length).toBe(1);

      const hist = res.find((c) => c.subject === "History");
      expect(hist?.files.length).toBe(1);
      expect(hist?.files[0].file_parts?.length).toBe(2);
    });

    it("filters catalog by class", async () => {
      const res = await getChaptersWithFiles({ class: 9 });
      expect(res.length).toBe(1);
      expect(res[0].class).toBe(9);
      expect(res[0].subject).toBe("Economics");
    });

    it("filters catalog by subject", async () => {
      const res = await getChaptersWithFiles({ subject: "History" });
      expect(res.length).toBe(1);
      expect(res[0].subject).toBe("History");
      expect(res[0].files[0].kind).toBe("ppt");
    });

    it("filters nested files by kind", async () => {
      const res = await getChaptersWithFiles({ kind: "ncert_pdf" });
      const econ = res.find((c) => c.id === "chap-econ-1");
      expect(econ?.files.length).toBe(1);
      expect(econ?.files[0].kind).toBe("ncert_pdf");

      const hist = res.find((c) => c.id === "chap-hist-1");
      expect(hist?.files.length).toBe(0);
    });

    it("filters nested files by publishedOnly", async () => {
      const res = await getChaptersWithFiles({ publishedOnly: true });
      const hist = res.find((c) => c.id === "chap-hist-1");
      expect(hist?.files.length).toBe(0);

      const econ = res.find((c) => c.id === "chap-econ-1");
      expect(econ?.files.length).toBe(3);
    });

    it("filters nested files by isPublished = false (hidden files)", async () => {
      const res = await getChaptersWithFiles({ isPublished: false });
      const hist = res.find((c) => c.id === "chap-hist-1");
      expect(hist?.files.length).toBe(1);
      expect(hist?.files[0].id).toBe("file-hist-ppt");

      const econ = res.find((c) => c.id === "chap-econ-1");
      expect(econ?.files.length).toBe(0);
    });

    it("supports hideEmptyChapters option", async () => {
      const res = await getChaptersWithFiles({
        isPublished: false,
        hideEmptyChapters: true,
      });
      expect(res.length).toBe(1);
      expect(res[0].id).toBe("chap-hist-1");
    });

    it("handles combined class, subject, and kind filters", async () => {
      const res = await getChaptersWithFiles({
        class: 9,
        subject: "Economics",
        kind: "teacher_notes",
      });
      expect(res.length).toBe(1);
      expect(res[0].files.length).toBe(2);
      expect(res[0].files[0].kind).toBe("teacher_notes");
    });

    it("returns empty array when filter criteria matches nothing", async () => {
      const res = await getChaptersWithFiles({ class: 6 });
      expect(res.length).toBe(0);
    });
  });

  // ==========================================================================
  // 2. renameChapter Title Update & Cascade recalculation
  // ==========================================================================
  describe("renameChapter", () => {
    it("updates chapter title and recalculates filenames for all chapter files via buildFileName", async () => {
      const newTitle = "The Story of Village Palampur";
      const { updatedChapter, updatedFilesCount } = await renameChapter(
        "chap-econ-1",
        newTitle
      );

      expect(updatedChapter.title).toBe(newTitle);
      expect(updatedFilesCount).toBe(3);

      const ncertFile = mockFiles.find((f) => f.id === "file-econ-ncert");
      expect(ncertFile?.file_name).toBe(
        "The-Story-of-Village-Palampur_Class9_Economics_Ch01_NCERT.pdf"
      );

      // Disambiguation: first teacher note gets base name, second gets -2
      const notesFile1 = mockFiles.find((f) => f.id === "file-econ-notes-1");
      expect(notesFile1?.file_name).toBe(
        "The-Story-of-Village-Palampur_Class9_Economics_Ch01_Notes-Sharma.pdf"
      );

      const notesFile2 = mockFiles.find((f) => f.id === "file-econ-notes-2");
      expect(notesFile2?.file_name).toBe(
        "The-Story-of-Village-Palampur_Class9_Economics_Ch01_Notes-Sharma-2.pdf"
      );
    });

    it("handles chapter with 0 files gracefully", async () => {
      mockChapters.push({
        id: "chap-empty",
        class: 8,
        subject: "Civics",
        chapter_no: 3,
        title: "Parliament",
        created_at: "2026-01-03T10:00:00Z",
      });

      const { updatedChapter, updatedFilesCount } = await renameChapter(
        "chap-empty",
        "The Indian Parliament"
      );

      expect(updatedChapter.title).toBe("The Indian Parliament");
      expect(updatedFilesCount).toBe(0);
    });

    it("throws when renaming with title length < 2 or > 200", async () => {
      await expect(renameChapter("chap-econ-1", " ")).rejects.toThrow(
        /between 2 and 200/
      );
      await expect(renameChapter("chap-econ-1", "a".repeat(201))).rejects.toThrow(
        /between 2 and 200/
      );
    });

    it("throws when renaming a non-existent chapter", async () => {
      await expect(
        renameChapter("non-existent-id", "Some Valid Title")
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // 3. toggleFilePublished
  // ==========================================================================
  describe("toggleFilePublished", () => {
    it("toggles published state from true to false", async () => {
      const updated = await toggleFilePublished("file-econ-ncert", false);
      expect(updated.is_published).toBe(false);

      const dbFile = mockFiles.find((f) => f.id === "file-econ-ncert");
      expect(dbFile?.is_published).toBe(false);
    });

    it("toggles published state from false to true", async () => {
      const updated = await toggleFilePublished("file-hist-ppt", true);
      expect(updated.is_published).toBe(true);

      const dbFile = mockFiles.find((f) => f.id === "file-hist-ppt");
      expect(dbFile?.is_published).toBe(true);
    });

    it("throws error when file is not found", async () => {
      await expect(
        toggleFilePublished("missing-file-id", true)
      ).rejects.toThrow();
    });
  });

  // ==========================================================================
  // 4. bulkToggleTeacherNotes
  // ==========================================================================
  describe("bulkToggleTeacherNotes", () => {
    it("bulk hides all teacher notes without touching NCERT or PPT files", async () => {
      const affectedCount = await bulkToggleTeacherNotes(false);
      expect(affectedCount).toBe(2);

      const notes1 = mockFiles.find((f) => f.id === "file-econ-notes-1");
      expect(notes1?.is_published).toBe(false);
      const notes2 = mockFiles.find((f) => f.id === "file-econ-notes-2");
      expect(notes2?.is_published).toBe(false);

      // NCERT remains published!
      const ncert = mockFiles.find((f) => f.id === "file-econ-ncert");
      expect(ncert?.is_published).toBe(true);
    });

    it("bulk publishes all teacher notes", async () => {
      mockFiles.forEach((f) => {
        if (f.kind === "teacher_notes") f.is_published = false;
      });

      const affectedCount = await bulkToggleTeacherNotes(true);
      expect(affectedCount).toBe(2);
      expect(mockFiles.find((f) => f.id === "file-econ-notes-1")?.is_published).toBe(true);
    });
  });

  // ==========================================================================
  // 5. deleteFileWithTelegramCleanup
  // ==========================================================================
  describe("deleteFileWithTelegramCleanup", () => {
    it("deletes file from database and purges all Telegram message parts", async () => {
      const targetFileId = "file-hist-ppt"; // Has 2 parts (2001, 2002)

      const result = await deleteFileWithTelegramCleanup(
        targetFileId,
        mockTgClient,
        "-1001234567890"
      );

      expect(result.deletedFileId).toBe(targetFileId);
      expect(result.deletedMessageIds).toContain(2001);
      expect(result.deletedMessageIds).toContain(2002);
      expect(deletedTgMessages).toContain(2001);
      expect(deletedTgMessages).toContain(2002);

      expect(mockFiles.find((f) => f.id === targetFileId)).toBeUndefined();
    });

    it("handles single-part file deletion cleanly", async () => {
      const targetFileId = "file-econ-ncert";

      const result = await deleteFileWithTelegramCleanup(
        targetFileId,
        mockTgClient,
        "-1001234567890"
      );

      expect(result.deletedMessageIds).toEqual([1001]);
      expect(deletedTgMessages).toContain(1001);
      expect(mockFiles.find((f) => f.id === targetFileId)).toBeUndefined();
    });

    it("handles deletion when Telegram client is omitted (offline fallback)", async () => {
      const targetFileId = "file-econ-notes-1";

      const result = await deleteFileWithTelegramCleanup(targetFileId);
      expect(result.deletedFileId).toBe(targetFileId);
      expect(result.deletedMessageIds.length).toBe(0);
      expect(mockFiles.find((f) => f.id === targetFileId)).toBeUndefined();
    });

    it("survives partial Telegram deletion network error without failing DB cleanup", async () => {
      const failingTgClient = {
        deleteMessage: vi.fn(async (_ch: string | number, msgId: number) => {
          if (msgId === 2002) throw new Error("Simulated Telegram 429 Too Many Requests");
          deletedTgMessages.push(msgId);
          return true;
        }),
      } as unknown as TelegramClient;

      const result = await deleteFileWithTelegramCleanup(
        "file-hist-ppt",
        failingTgClient,
        "-1001234567890"
      );

      expect(result.deletedFileId).toBe("file-hist-ppt");
      expect(result.deletedMessageIds).toContain(2001);
      expect(result.deletedMessageIds).not.toContain(2002);
      expect(mockFiles.find((f) => f.id === "file-hist-ppt")).toBeUndefined();
    });

    it("throws error when attempting to delete non-existent file", async () => {
      await expect(
        deleteFileWithTelegramCleanup("non-existent-id")
      ).rejects.toThrow(/not found/);
    });

    it("preserves chapter container by default", async () => {
      const econFiles = mockFiles.filter((f) => f.chapter_id === "chap-econ-1");
      for (const f of econFiles) {
        await deleteFileWithTelegramCleanup(f.id, mockTgClient, "-1001234567890");
      }

      // Chapter is still preserved
      const chapter = mockChapters.find((c) => c.id === "chap-econ-1");
      expect(chapter).toBeDefined();
    });

    it("removes empty chapter when removeEmptyChapter option is true", async () => {
      const histFile = mockFiles.find((f) => f.chapter_id === "chap-hist-1");
      if (histFile) {
        await deleteFileWithTelegramCleanup(
          histFile.id,
          mockTgClient,
          "-1001234567890",
          { removeEmptyChapter: true }
        );
      }

      const chapter = mockChapters.find((c) => c.id === "chap-hist-1");
      expect(chapter).toBeUndefined();
    });
  });
});
