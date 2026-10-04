/**
 * Database Type Definitions
 * SST Chapter Library — Schema Mapping (supabase/schema.sql)
 */

export type Subject =
  | "History"
  | "Geography"
  | "Civics"
  | "Economics"
  | "SocialScience";

export type FileKind = "ncert_pdf" | "ppt" | "ppt_pdf" | "teacher_notes";

export interface Chapter {
  id: string;
  class: number;
  subject: Subject | string;
  chapter_no: number;
  title: string;
  book?: string | null;
  edition?: string | null;
  created_at?: string;
}

export type ChapterRecord = Chapter;

export interface FileRecord {
  id: string;
  chapter_id: string;
  kind: FileKind | string;
  parent_file_id?: string | null;
  file_name: string;
  teacher_name?: string | null;
  size_bytes: number;
  part_count: number;
  mime: string;
  sha256: string;
  is_published: boolean;
  created_at?: string;
  file_parts?: FilePart[];
}

export interface FilePart {
  file_id: string;
  part_no: number;
  tg_file_id: string;
  tg_file_unique_id: string;
  tg_message_id: number;
  size_bytes: number;
  sha256: string;
}

export type FilePartRecord = FilePart;

export interface ChapterWithFiles extends Chapter {
  files: FileRecord[];
}

export interface CatalogFilters {
  class?: number;
  subject?: Subject | string;
  kind?: FileKind | string;
  isPublished?: boolean;
  publishedOnly?: boolean;
  hideEmptyChapters?: boolean;
}

export interface ChapterRenameResult {
  updatedChapter: Chapter;
  updatedFilesCount: number;
}

export interface FileDeleteResult {
  deletedFileId: string;
  deletedMessageIds: number[];
}

export interface TelegramClientLike {
  deleteMessage(channelId: string | number, messageId: number): Promise<boolean>;
}

export interface DeleteFileOptions {
  removeEmptyChapter?: boolean;
}
