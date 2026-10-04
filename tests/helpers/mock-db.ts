import crypto from "crypto";

export interface MockChapter {
  id: string;
  class: number;
  subject: string;
  chapter_no: number;
  title: string;
  book?: string | null;
  edition?: string | null;
  created_at: string;
}

export interface MockFile {
  id: string;
  chapter_id: string;
  kind: "ncert_pdf" | "ppt" | "ppt_pdf" | "teacher_notes";
  parent_file_id?: string | null;
  file_name: string;
  teacher_name?: string | null;
  size_bytes: number;
  part_count: number;
  mime: string;
  sha256: string;
  is_published: boolean;
  created_at: string;
}

export interface MockFilePart {
  file_id: string;
  part_no: number;
  tg_file_id: string;
  tg_file_unique_id: string;
  tg_message_id: number;
  size_bytes: number;
  sha256: string;
}

export class MockDatabase {
  public chapters: MockChapter[] = [];
  public files: MockFile[] = [];
  public fileParts: MockFilePart[] = [];

  reset() {
    this.chapters = [];
    this.files = [];
    this.fileParts = [];
  }

  findOrCreateChapter(data: {
    class: number;
    subject: string;
    chapterNo: number;
    title: string;
  }): MockChapter {
    const existing = this.chapters.find(
      (c) =>
        c.class === data.class &&
        c.subject === data.subject &&
        c.chapter_no === data.chapterNo
    );
    if (existing) {
      return existing;
    }

    const newChapter: MockChapter = {
      id: crypto.randomUUID(),
      class: data.class,
      subject: data.subject,
      chapter_no: data.chapterNo,
      title: data.title,
      created_at: new Date().toISOString(),
    };
    this.chapters.push(newChapter);
    return newChapter;
  }

  insertFile(
    fileData: Omit<MockFile, "id" | "created_at">,
    parts: Omit<MockFilePart, "file_id">[]
  ): MockFile {
    // Unique constraint: (chapter_id, sha256)
    const duplicate = this.files.find(
      (f) => f.chapter_id === fileData.chapter_id && f.sha256 === fileData.sha256
    );
    if (duplicate) {
      throw new Error(`Duplicate file: identical sha256 already exists in this chapter`);
    }

    // Unique constraint: file_name
    const nameConflict = this.files.find((f) => f.file_name === fileData.file_name);
    if (nameConflict) {
      throw new Error(`Duplicate file_name: '${fileData.file_name}' already exists`);
    }

    const fileId = crypto.randomUUID();
    const newFile: MockFile = {
      ...fileData,
      id: fileId,
      created_at: new Date().toISOString(),
    };

    this.files.push(newFile);

    for (const part of parts) {
      this.fileParts.push({
        ...part,
        file_id: fileId,
      });
    }

    return newFile;
  }

  deleteFile(fileId: string): { deletedFile: MockFile; deletedPartMessageIds: number[] } {
    const fileIndex = this.files.findIndex((f) => f.id === fileId);
    if (fileIndex === -1) {
      throw new Error(`File not found: ${fileId}`);
    }
    const deletedFile = this.files[fileIndex];
    this.files.splice(fileIndex, 1);

    const relatedParts = this.fileParts.filter((p) => p.file_id === fileId);
    const deletedPartMessageIds = relatedParts.map((p) => p.tg_message_id);
    this.fileParts = this.fileParts.filter((p) => p.file_id !== fileId);

    return { deletedFile, deletedPartMessageIds };
  }

  renameChapter(
    chapterId: string,
    newTitle: string,
    fileNameBuilder?: (chapter: MockChapter, file: MockFile) => string
  ): { chapter: MockChapter; updatedCount: number } {
    const chapter = this.chapters.find((c) => c.id === chapterId);
    if (!chapter) {
      throw new Error(`Chapter not found: ${chapterId}`);
    }
    chapter.title = newTitle;

    const filesToUpdate = this.files.filter((f) => f.chapter_id === chapterId);
    if (fileNameBuilder) {
      for (const file of filesToUpdate) {
        file.file_name = fileNameBuilder(chapter, file);
      }
    }

    return { chapter, updatedCount: filesToUpdate.length };
  }

  togglePublished(fileId: string, isPublished: boolean): MockFile {
    const file = this.files.find((f) => f.id === fileId);
    if (!file) throw new Error(`File not found: ${fileId}`);
    file.is_published = isPublished;
    return file;
  }

  bulkToggleTeacherNotes(isPublished: boolean): number {
    let count = 0;
    for (const file of this.files) {
      if (file.kind === "teacher_notes") {
        file.is_published = isPublished;
        count++;
      }
    }
    return count;
  }
}
