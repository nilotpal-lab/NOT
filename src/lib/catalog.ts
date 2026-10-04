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
  DeleteFileOptions,
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
    logger.error({ error, fileId }, "Failed to toggle file visibility");
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
    logger.error({ error }, "Failed to bulk toggle teacher notes visibility");
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

  const existingNames: string[] = (otherFiles || []).map((f: { file_name: string }) => f.file_name);

  // 5. Cascade recalculate file_name for each file
  let updatedFilesCount = 0;
  for (const file of chapterFiles) {
    const ext =
      file.file_name.split(".").pop() ||
      (file.kind === "ppt" || (file.mime && file.mime.includes("presentation")) ? "pptx" : "pdf");

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
    .map((p: { tg_message_id: number | string }) => Number(p.tg_message_id))
    .filter((id: number) => !isNaN(id) && id > 0);

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
