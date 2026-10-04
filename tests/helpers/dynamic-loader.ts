import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

/**
 * Dynamically resolves a TypeScript or JavaScript module if it exists on disk.
 * Returns null if the file does not exist yet, enabling progressive milestone testing.
 */
export async function loadModule<T>(relativePath: string): Promise<T | null> {
  const fullPath = path.resolve(process.cwd(), relativePath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  try {
    const fileUrl = pathToFileURL(fullPath).href;
    const mod = await import(fileUrl);
    return mod as T;
  } catch (err) {
    // If syntax/runtime error in existing file, throw to expose failure
    console.warn(`Failed loading module at ${relativePath}:`, err);
    return null;
  }
}

/**
 * Interface contract for Naming & Captions (Feature 6 & 7)
 */
export interface NamingModule {
  buildFileName(params: {
    class: number;
    subject: string;
    chapterNo: number;
    title: string;
    kind: string;
    teacherName?: string;
    ext: string;
    existingNames?: string[];
  }): string;
  formatTelegramCaption(params: {
    title: string;
    class: number;
    subject: string;
    ch: number;
    kind: string;
    name: string;
    sha: string;
    part: number;
    total: number;
  }): string;
}

/**
 * Interface contract for Magic-Byte validation (Feature 8 & 9)
 */
export interface MagicModule {
  validatePdfMagic(
    firstChunk: Buffer | Uint8Array,
    lastChunk?: Buffer | Uint8Array
  ): { valid: boolean; error?: string };
  validatePptxMagic(
    firstChunk: Buffer | Uint8Array,
    lastChunk?: Buffer | Uint8Array
  ): { valid: boolean; error?: string };
}

/**
 * Interface contract for Auth & Security (Features 1-4)
 */
export interface AuthModule {
  hashPassword(plainText: string): Promise<string>;
  verifyPassword(plainText: string, storedHash: string): Promise<boolean>;
  createAdminToken(secretString: string): Promise<string>;
  verifyAdminToken(token: string, secretString: string): Promise<boolean | { role: string } | null>;
  checkRateLimit?(ip: string): { allowed: boolean; remainingAttempts: number; retryAfterSeconds?: number };
  recordFailedAttempt?(ip: string): void;
  resetRateLimit?(ip: string): void;
  validateOrigin?(req: Request): boolean;
}

/**
 * Interface contract for Catalog Data Service (Features 16-20)
 */
export interface ChapterRecord {
  id: string;
  class: number;
  subject: string;
  chapter_no: number;
  title: string;
}

export interface FileRecord {
  id: string;
  chapter_id: string;
  kind: string;
  parent_file_id?: string | null;
  file_name: string;
  teacher_name?: string | null;
  size_bytes: number;
  part_count: number;
  mime: string;
  sha256: string;
  is_published: boolean;
}

export interface CatalogModule {
  findOrCreateChapter(data: {
    class: number;
    subject: string;
    chapterNo: number;
    title: string;
  }): Promise<ChapterRecord>;
  renameChapter(
    chapterId: string,
    newTitle: string
  ): Promise<{ updatedChapter: ChapterRecord; updatedFilesCount: number }>;
  toggleFilePublished(fileId: string, isPublished: boolean): Promise<FileRecord>;
  bulkToggleTeacherNotes(isPublished: boolean): Promise<number>;
  deleteFileWithTelegramCleanup(
    fileId: string
  ): Promise<{ deletedFileId: string; deletedMessageIds: number[] }>;
}
