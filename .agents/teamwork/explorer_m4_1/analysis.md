# Technical Analysis: Milestone M4 (Catalog Data Service & Rename Cascade)

## 1. Executive Summary

Milestone M4 establishes the catalog management layer for the SST Chapter Library. It bridges the database catalog (`chapters`, `files`, `file_parts`), the deterministic naming engine (`src/lib/naming.ts`), and the Telegram storage layer (`src/lib/telegram.ts`).

This analysis investigates the current state of `src/lib/catalog.ts` and `src/types/database.ts`, identifies critical gaps in the existing implementation (specifically the missing filename recalculation in `renameChapter`, missing nested `file_parts` in queries, and incomplete publish filter states), and provides concrete, battle-tested TypeScript designs and implementations for all 5 core catalog operations.

---

## 2. Evidence-Based Observations of Codebase State

### 2.1 Database Schema (`supabase/schema.sql`)
1. **`chapters` table**:
   - Primary key `id uuid default gen_random_uuid()`.
   - Natural unique key `UNIQUE (class, subject, chapter_no)`.
   - Constraints: `class` between 6 and 10; `subject` in `('History','Geography','Civics','Economics','SocialScience')`; `chapter_no` between 1 and 99; `title` length between 2 and 200.
2. **`files` table**:
   - Primary key `id uuid default gen_random_uuid()`.
   - Foreign key `chapter_id uuid references chapters(id) on delete cascade`.
   - Global unique constraint `file_name text not null unique`.
   - Content unique constraint `UNIQUE (chapter_id, sha256)` preventing duplicate uploads in the same chapter.
   - Enums: `kind` in `('ncert_pdf','ppt','ppt_pdf','teacher_notes')`.
   - Status: `is_published boolean not null default true`.
3. **`file_parts` table**:
   - Composite primary key `(file_id, part_no)`.
   - Foreign key `file_id uuid references files(id) on delete cascade`.
   - Telegram message tracking `tg_message_id bigint not null`.

### 2.2 Gaps Identified in Existing `src/lib/catalog.ts`
1. **Missing Rename Cascade in `renameChapter`**:
   - Lines 253-275 in `src/lib/catalog.ts` only update the chapter title and select file counts (`select("id").eq("chapter_id", chapterId)`). It does **NOT** recalculate `file_name` for any linked files.
   - This violates requirement R4 / Feature 18 ("Rename chapter title with cascade recalculation of dependent `file_name`s").
2. **Missing `file_parts` in `getChaptersWithFiles`**:
   - Line 176 currently selects `*, files (*)`. It does not nest `file_parts (*)`.
   - Without `file_parts`, client callers and admin dashboards cannot inspect part counts, part sizes, or Telegram references.
3. **Incomplete Published State Filtering**:
   - Line 173 defines `publishedOnly?: boolean`. This only allows filtering for published files (`is_published: true`). Admin dashboards require filtering hidden files (`is_published: false`) as well.
4. **Ordering Guarantees**:
   - `files` were not deterministically sorted by `created_at` in application memory, which can lead to nondeterministic list ordering depending on Supabase query cache.
5. **Empty Chapter Lifecycle Handling in `deleteFileWithTelegramCleanup`**:
   - Existing deletion code does not check if the deleted file was the last file in the chapter, leaving no clear policy on chapter lifecycle.

---

## 3. Design & Architecture for Core Operations

### 3.1 `getChaptersWithFiles(filters?: CatalogFilters)`
- **Query Strategy**:
  PostgREST relational query:
  ```ts
  db.from("chapters").select(`
    *,
    files (
      *,
      file_parts (*)
    )
  `)
  .order("class", { ascending: true })
  .order("subject", { ascending: true })
  .order("chapter_no", { ascending: true })
  ```
- **Filter Evaluation**:
  - `class` (number) and `subject` (string) filtered at the database level (`query.eq(...)`).
  - `kind` (string) and `isPublished` (boolean) filtered in application code on embedded `files` array.
  - Backwards compatibility: supports `publishedOnly: boolean` (aliased to `isPublished: true`).
  - Optional `hideEmptyChapters: boolean` allows dropping chapters with 0 matching files if requested.
- **Sorting Guarantee**:
  - Chapters: sorted by `class ASC, subject ASC, chapter_no ASC`.
  - Files: sorted by `created_at ASC` (with secondary sort by `file_name ASC`).
  - File parts: sorted by `part_no ASC`.

### 3.2 `renameChapter(chapterId: string, newTitle: string)`
- **Workflow**:
  1. Validate `newTitle`: trim and assert length between 2 and 200 characters.
  2. Query chapter to ensure existence and retrieve `class`, `subject`, `chapter_no`.
  3. Update `chapters.title` with `newTitle`.
  4. Query all files for this chapter ordered by `created_at ASC`.
  5. Fetch existing file names across other chapters in the database to prevent global collisions.
  6. Iterate through each file:
     - Determine extension: `.pptx` for PPT presentation MIME, or parse existing extension, fallback to `.pdf`.
     - Call `buildFileName({ class, subject, chapterNo, title: newTitle, kind, teacherName, ext, existingNames })`.
     - Append generated name to `existingNames` so subsequent files in the same batch (e.g. second teacher notes by the same teacher) get disambiguated with `-2`, `-3`.
     - Update `files.file_name` in Supabase.
  7. Return `{ updatedChapter, updatedFilesCount }`.

### 3.3 `toggleFilePublished(fileId: string, isPublished: boolean)`
- **Workflow**:
  1. Update `is_published: isPublished` in `files` where `id = fileId`.
  2. Return updated `FileRecord`.
  3. Throw informative error if file ID does not exist.

### 3.4 `bulkToggleTeacherNotes(isPublished: boolean)`
- **Workflow**:
  1. Update `is_published: isPublished` where `kind = 'teacher_notes'`.
  2. Return count of modified rows (`data?.length ?? 0`).

### 3.5 `deleteFileWithTelegramCleanup(fileId: string, tgClient?: TelegramClientLike, channelId?: string | number, options?: DeleteFileOptions)`
- **Workflow**:
  1. Fetch `files` row for `fileId` to retrieve `chapter_id`.
  2. Fetch all `file_parts` for `fileId` to retrieve `tg_message_id` values.
  3. Telegram Purge:
     - Auto-instantiate `TelegramClient` from `process.env.TELEGRAM_BOT_TOKEN` if not provided.
     - Fallback `channelId` to `process.env.TELEGRAM_CHANNEL_ID` if not provided.
     - Iterate through `tg_message_id`s, calling `tgClient.deleteMessage(...)` wrapped in individual `try/catch` blocks.
     - Record successfully deleted message IDs in `deletedMessageIds`.
  4. Database Deletion:
     - Delete `file_parts` for `fileId`.
     - Delete `files` for `fileId`.
  5. Empty Chapter Decision:
     - **Default Policy**: Retain empty chapters. In curriculum systems, the chapter entity represents syllabus structure (e.g., Chapter 1 to 15). Deleting a notes file must not delete syllabus metadata.
     - **Configurable Pruning**: If `options?.removeEmptyChapter === true`, check if `files.count === 0` for `chapter_id`, and if 0, delete the chapter record.
  6. Return `{ deletedFileId, deletedMessageIds }`.

---

## 4. Concrete Proposed Code

### 4.1 `src/types/database.ts`
```typescript
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
```

### 4.2 `src/lib/catalog.ts`
```typescript
import crypto from "crypto";
import { getDb } from "./db";
import {
  Chapter,
  FileRecord,
  FilePart,
  ChapterWithFiles,
  CatalogFilters,
  ChapterRenameResult,
  FileDeleteResult,
  TelegramClientLike,
} from "@/types/database";
import { TelegramClient } from "./telegram";
import { buildFileName } from "./naming";
import { logger } from "./logger";

export interface FindOrCreateChapterParams {
  class: number;
  subject: string;
  chapterNo: number;
  title: string;
  book?: string | null;
  edition?: string | null;
}

/**
 * Finds an existing chapter by (class, subject, chapter_no) or inserts a new one.
 * Handles concurrent insert race conditions (Postgres unique constraint 23505).
 */
export async function findOrCreateChapter(data: FindOrCreateChapterParams): Promise<Chapter> {
  const db = getDb();

  // 1. Query existing chapter
  const { data: existing, error: selectErr } = await db
    .from("chapters")
    .select("*")
    .eq("class", data.class)
    .eq("subject", data.subject)
    .eq("chapter_no", data.chapterNo)
    .maybeSingle();

  if (selectErr && selectErr.code !== "PGRST116") {
    logger.error({ selectErr }, "Error querying chapter in findOrCreateChapter");
    throw selectErr;
  }

  if (existing) {
    return existing as Chapter;
  }

  // 2. Insert new chapter if absent
  const { data: created, error: insertErr } = await db
    .from("chapters")
    .insert({
      class: data.class,
      subject: data.subject,
      chapter_no: data.chapterNo,
      title: data.title,
      book: data.book || null,
      edition: data.edition || null,
    })
    .select()
    .single();

  if (insertErr) {
    // Concurrency race condition: if duplicate key violated, re-fetch
    if (insertErr.code === "23505") {
      const { data: retry, error: retryErr } = await db
        .from("chapters")
        .select("*")
        .eq("class", data.class)
        .eq("subject", data.subject)
        .eq("chapter_no", data.chapterNo)
        .single();
      if (retry) return retry as Chapter;
      if (retryErr) throw retryErr;
    }
    logger.error({ insertErr }, "Failed to find or create chapter");
    throw insertErr;
  }

  return created as Chapter;
}

/**
 * Checks if a file with identical sha256 already exists in the given chapter.
 * Returns the conflicting file details if found, or null otherwise.
 */
export async function checkDuplicateFile(
  chapterId: string,
  sha256: string
): Promise<{ id: string; file_name: string } | null> {
  const db = getDb();
  const { data, error } = await db
    .from("files")
    .select("id, file_name")
    .eq("chapter_id", chapterId)
    .eq("sha256", sha256)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    logger.error({ error, chapterId, sha256 }, "Error querying duplicate file check");
    throw error;
  }

  return data ? { id: data.id, file_name: data.file_name } : null;
}

/**
 * Boolean wrapper for checkDuplicateFile.
 */
export async function checkFileDuplicate(chapterId: string, sha256: string): Promise<boolean> {
  const dup = await checkDuplicateFile(chapterId, sha256);
  return dup !== null;
}

/**
 * Inserts a file row and its associated file_parts rows atomically.
 * Automatically rolls back the inserted file record if parts insertion fails.
 */
export async function insertFileWithParts(
  fileData: Omit<FileRecord, "id" | "created_at"> & { id?: string },
  parts: Array<Omit<FilePart, "file_id">>
): Promise<FileRecord> {
  const db = getDb();
  const fileId = fileData.id || crypto.randomUUID();

  // 1. Insert file row
  const { data: insertedFile, error: fileErr } = await db
    .from("files")
    .insert({
      id: fileId,
      chapter_id: fileData.chapter_id,
      kind: fileData.kind,
      parent_file_id: fileData.parent_file_id ?? null,
      file_name: fileData.file_name,
      teacher_name: fileData.teacher_name ?? null,
      size_bytes: fileData.size_bytes,
      part_count: fileData.part_count,
      mime: fileData.mime,
      sha256: fileData.sha256,
      is_published: fileData.is_published ?? true,
    })
    .select()
    .single();

  if (fileErr || !insertedFile) {
    logger.error({ fileErr }, "Failed to insert file record");
    throw fileErr || new Error("Failed to insert file record");
  }

  // 2. Insert file parts rows
  if (parts.length > 0) {
    const partsPayload = parts.map((p) => ({
      file_id: fileId,
      part_no: p.part_no,
      tg_file_id: p.tg_file_id,
      tg_file_unique_id: p.tg_file_unique_id,
      tg_message_id: p.tg_message_id,
      size_bytes: p.size_bytes,
      sha256: p.sha256,
    }));

    const { error: partsErr } = await db.from("file_parts").insert(partsPayload);
    if (partsErr) {
      logger.error({ partsErr, fileId }, "Failed to insert file_parts rows; rolling back file row");
      // Clean up file row on parts failure
      await db.from("files").delete().eq("id", fileId);
      throw partsErr;
    }
  }

  return insertedFile as FileRecord;
}

/**
 * Retrieves chapters with nested files and file_parts matching optional filters.
 *
 * Orders:
 * - Chapters: class ASC, subject ASC, chapter_no ASC
 * - Files: created_at ASC
 * - File Parts: part_no ASC
 */
export async function getChaptersWithFiles(
  filters?: CatalogFilters
): Promise<ChapterWithFiles[]> {
  const db = getDb();
  let query = db
    .from("chapters")
    .select(`
      *,
      files (
        *,
        file_parts (*)
      )
    `)
    .order("class", { ascending: true })
    .order("subject", { ascending: true })
    .order("chapter_no", { ascending: true });

  if (typeof filters?.class === "number") {
    query = query.eq("class", filters.class);
  }
  if (filters?.subject) {
    query = query.eq("subject", filters.subject);
  }

  const { data, error } = await query;
  if (error) {
    logger.error({ error, filters }, "Failed to query chapters with files");
    throw error;
  }

  let chapters = (data || []) as ChapterWithFiles[];

  // Determine effective isPublished filter
  const effectivePublished =
    filters?.isPublished !== undefined
      ? filters.isPublished
      : filters?.publishedOnly !== undefined
        ? filters.publishedOnly
        : undefined;

  // Filter nested files if kind or published filter is active
  if (filters?.kind !== undefined || effectivePublished !== undefined) {
    chapters = chapters.map((c) => ({
      ...c,
      files: (c.files || []).filter((f) => {
        if (filters?.kind && f.kind !== filters.kind) return false;
        if (effectivePublished !== undefined && f.is_published !== effectivePublished) return false;
        return true;
      }),
    }));
  }

  // Filter out empty chapters if requested
  if (filters?.hideEmptyChapters) {
    chapters = chapters.filter((c) => (c.files?.length ?? 0) > 0);
  }

  // Deterministically sort files by created_at, and file_parts by part_no
  for (const chapter of chapters) {
    if (Array.isArray(chapter.files)) {
      chapter.files.sort((a, b) => {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (timeA !== timeB) return timeA - timeB;
        return (a.file_name || "").localeCompare(b.file_name || "");
      });

      for (const file of chapter.files) {
        if (Array.isArray(file.file_parts)) {
          file.file_parts.sort((a, b) => a.part_no - b.part_no);
        }
      }
    }
  }

  return chapters;
}

/**
 * Toggles visibility of a specific file.
 */
export async function toggleFilePublished(fileId: string, isPublished: boolean): Promise<FileRecord> {
  const db = getDb();
  const { data, error } = await db
    .from("files")
    .update({ is_published: isPublished })
    .eq("id", fileId)
    .select()
    .single();

  if (error || !data) {
    logger.error({ error, fileId, isPublished }, "Failed to toggle file visibility");
    throw error || new Error(`File ${fileId} not found`);
  }
  return data as FileRecord;
}

/**
 * Bulk toggles visibility of all teacher notes.
 */
export async function bulkToggleTeacherNotes(isPublished: boolean): Promise<number> {
  const db = getDb();
  const { data, error } = await db
    .from("files")
    .update({ is_published: isPublished })
    .eq("kind", "teacher_notes")
    .select("id");

  if (error) {
    logger.error({ error, isPublished }, "Failed to bulk toggle teacher notes visibility");
    throw error;
  }
  return data?.length ?? 0;
}

/**
 * Renames chapter title with cascading recalculation of all dependent file_names.
 *
 * 1. Updates chapter title in `chapters`.
 * 2. Fetches all files linked to this chapter, ordered by created_at.
 * 3. For each file, recalculates file_name via buildFileName using new title.
 * 4. Updates each file's file_name in `files`.
 * 5. Returns { updatedChapter, updatedFilesCount }.
 */
export async function renameChapter(
  chapterId: string,
  newTitle: string
): Promise<ChapterRenameResult> {
  const db = getDb();
  const trimmedTitle = (newTitle || "").trim();
  if (trimmedTitle.length < 2 || trimmedTitle.length > 200) {
    throw new Error("Chapter title must be between 2 and 200 characters");
  }

  // 1. Fetch current chapter
  const { data: currentChapter, error: fetchErr } = await db
    .from("chapters")
    .select("*")
    .eq("id", chapterId)
    .single();

  if (fetchErr || !currentChapter) {
    logger.error({ fetchErr, chapterId }, "Failed to find chapter for renaming");
    throw fetchErr || new Error(`Chapter ${chapterId} not found`);
  }

  // 2. Update chapter title
  const { data: updatedChapter, error: updateChapterErr } = await db
    .from("chapters")
    .update({ title: trimmedTitle })
    .eq("id", chapterId)
    .select()
    .single();

  if (updateChapterErr || !updatedChapter) {
    logger.error({ updateChapterErr, chapterId }, "Failed to update chapter title");
    throw updateChapterErr || new Error(`Failed to update chapter ${chapterId}`);
  }

  // 3. Fetch all dependent files
  const { data: files, error: filesErr } = await db
    .from("files")
    .select("*")
    .eq("chapter_id", chapterId)
    .order("created_at", { ascending: true });

  if (filesErr) {
    logger.error({ filesErr, chapterId }, "Failed to fetch files for rename cascade");
    throw filesErr;
  }

  const chapterFiles = (files || []) as FileRecord[];
  if (chapterFiles.length === 0) {
    return {
      updatedChapter: updatedChapter as Chapter,
      updatedFilesCount: 0,
    };
  }

  // 4. Query other existing file names across DB to prevent global collision
  const { data: otherFiles } = await db
    .from("files")
    .select("file_name")
    .neq("chapter_id", chapterId);

  const existingNames: string[] = (otherFiles || []).map((f) => f.file_name);

  // 5. Cascade recalculate file_name for each file
  let updatedFilesCount = 0;
  for (const file of chapterFiles) {
    const ext =
      file.file_name.split(".").pop() ||
      (file.kind === "ppt" || file.mime.includes("presentation") ? "pptx" : "pdf");

    const newFileName = buildFileName({
      class: updatedChapter.class,
      subject: updatedChapter.subject,
      chapterNo: updatedChapter.chapter_no,
      title: trimmedTitle,
      kind: file.kind,
      teacherName: file.teacher_name || undefined,
      ext,
      existingNames,
    });

    // Register candidate in existingNames for collision resolution on subsequent files in this batch
    existingNames.push(newFileName);

    if (newFileName !== file.file_name) {
      const { error: fileUpdateErr } = await db
        .from("files")
        .update({ file_name: newFileName })
        .eq("id", file.id);

      if (fileUpdateErr) {
        logger.error(
          { fileUpdateErr, fileId: file.id, oldName: file.file_name, newFileName },
          "Failed to cascade update file_name"
        );
        throw fileUpdateErr;
      }
    }
    updatedFilesCount++;
  }

  return {
    updatedChapter: updatedChapter as Chapter,
    updatedFilesCount,
  };
}

export interface DeleteFileOptions {
  removeEmptyChapter?: boolean;
}

/**
 * Deletes a file record from the database and purges all associated Telegram part messages.
 *
 * 1. Fetches all file_parts for fileId to get their tg_message_id values.
 * 2. Deletes Telegram messages via tgClient.deleteMessage (try/catch per message).
 * 3. Deletes file_parts and files rows from Supabase.
 * 4. Checks if this was the last file in the chapter; keeps empty chapter by default,
 *    or removes empty chapter if options.removeEmptyChapter is true.
 * 5. Returns { deletedFileId, deletedMessageIds }.
 */
export async function deleteFileWithTelegramCleanup(
  fileId: string,
  tgClient?: TelegramClientLike,
  channelId?: string | number,
  options?: DeleteFileOptions
): Promise<FileDeleteResult> {
  const db = getDb();

  // 1. Fetch file record to check chapter_id
  const { data: file, error: fileFetchErr } = await db
    .from("files")
    .select("id, chapter_id, file_name")
    .eq("id", fileId)
    .maybeSingle();

  if (fileFetchErr) {
    logger.error({ fileFetchErr, fileId }, "Error querying file for deletion");
    throw fileFetchErr;
  }
  if (!file) {
    throw new Error(`File not found: ${fileId}`);
  }

  const chapterId = file.chapter_id;

  // 2. Fetch all file_parts to get tg_message_ids
  const { data: parts, error: partsFetchErr } = await db
    .from("file_parts")
    .select("tg_message_id")
    .eq("file_id", fileId);

  if (partsFetchErr) {
    logger.error({ partsFetchErr, fileId }, "Error querying file_parts for deletion");
    throw partsFetchErr;
  }

  const messageIds = (parts || [])
    .map((p) => Number(p.tg_message_id))
    .filter((id) => !isNaN(id) && id > 0);

  // 3. Purge Telegram messages
  let client = tgClient;
  if (!client && process.env.TELEGRAM_BOT_TOKEN) {
    try {
      client = new TelegramClient(process.env.TELEGRAM_BOT_TOKEN);
    } catch (clientInitErr) {
      logger.warn({ clientInitErr }, "Could not initialize TelegramClient for cleanup");
    }
  }

  const targetChannelId = channelId || process.env.TELEGRAM_CHANNEL_ID;
  const deletedMessageIds: number[] = [];

  if (client && targetChannelId && messageIds.length > 0) {
    for (const msgId of messageIds) {
      try {
        const ok = await client.deleteMessage(targetChannelId, msgId);
        if (ok) {
          deletedMessageIds.push(msgId);
        }
      } catch (tgErr) {
        logger.warn({ msgId, tgErr }, "Failed to delete Telegram message during file cleanup");
      }
    }
  }

  // 4. Delete file_parts and files records from database
  const { error: partsDelErr } = await db
    .from("file_parts")
    .delete()
    .eq("file_id", fileId);

  if (partsDelErr) {
    logger.warn({ partsDelErr, fileId }, "Warning during explicit file_parts deletion");
  }

  const { error: fileDelErr } = await db
    .from("files")
    .delete()
    .eq("id", fileId);

  if (fileDelErr) {
    logger.error({ fileDelErr, fileId }, "Failed to delete file from database");
    throw fileDelErr;
  }

  // 5. Empty chapter handling
  if (options?.removeEmptyChapter) {
    const { count, error: countErr } = await db
      .from("files")
      .select("id", { count: "exact", head: true })
      .eq("chapter_id", chapterId);

    if (!countErr && count === 0) {
      const { error: chDelErr } = await db
        .from("chapters")
        .delete()
        .eq("id", chapterId);

      if (chDelErr) {
        logger.warn({ chDelErr, chapterId }, "Failed to delete empty chapter after file removal");
      } else {
        logger.info({ chapterId }, "Removed empty chapter after last file deletion");
      }
    }
  }

  return {
    deletedFileId: fileId,
    deletedMessageIds,
  };
}
```
