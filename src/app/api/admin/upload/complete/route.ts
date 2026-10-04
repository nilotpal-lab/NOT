import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { verifyAdminToken, ADMIN_COOKIE_NAME } from "@/lib/auth";
import { getEnv } from "@/lib/validate";
import { buildFileName } from "@/lib/naming";
import { validatePptxAccompaniment } from "@/lib/magic";
import { TelegramClient } from "@/lib/telegram";
import { uploadSessionManager } from "@/lib/upload-session";
import { getDb } from "@/lib/db";
import { findOrCreateChapter, checkDuplicateFile } from "@/lib/catalog";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const completeSchema = z.object({
  uploadId: z.string().min(1, "uploadId is required"),
  class: z.coerce.number().int().min(6).max(10),
  subject: z.enum(["History", "Geography", "Civics", "Economics", "SocialScience"]),
  chapterNo: z.coerce.number().int().min(1).max(99),
  title: z.string().min(2).max(200),
  kind: z.enum(["ncert_pdf", "ppt", "ppt_pdf", "teacher_notes"]),
  teacherName: z.string().optional().nullable(),
  parentFileId: z.string().uuid().optional().nullable(),
  clientSha256: z.string().optional(),
  hasAccompanyingPdf: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;

  // 1. Session Authentication
  if (!token || !secret) {
    return NextResponse.json({ error: "Unauthorized: Admin session required" }, { status: 401 });
  }
  const isAuth = await verifyAdminToken(token, secret);
  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized: Invalid or expired admin token" }, { status: 401 });
  }

  // 2. Parse & Validate Payload
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  const parsed = completeSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const {
    uploadId,
    class: classNum,
    subject,
    chapterNo,
    title,
    kind,
    teacherName,
    parentFileId,
    clientSha256,
    hasAccompanyingPdf,
  } = parsed.data;

  const env = getEnv();
  const channelId = env.TELEGRAM_CHANNEL_ID;
  const tgClient = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
  const db = getDb();

  // 3. Retrieve Upload Session (peekSession retains session data if expired for Telegram rollback)
  const session = typeof uploadSessionManager.peekSession === "function"
    ? uploadSessionManager.peekSession(uploadId)
    : uploadSessionManager.getSession(uploadId, { includeExpired: true });

  if (!session) {
    return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });
  }

  // Helper for rolling back Telegram messages and clearing session
  const executeRollbackAndCleanup = async () => {
    await uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId);
    uploadSessionManager.deleteSession(uploadId);
  };

  // Check TTL (30 minutes)
  const SESSION_TTL_MS = 30 * 60 * 1000;
  const isExpired = typeof uploadSessionManager.isSessionExpired === "function"
    ? uploadSessionManager.isSessionExpired(uploadId)
    : (Date.now() - session.createdAt > SESSION_TTL_MS);

  if (isExpired) {
    logger.warn(
      { uploadId, createdAt: session.createdAt },
      "Upload session expired (30m TTL); rolling back Telegram parts on complete"
    );
    await executeRollbackAndCleanup();
    return NextResponse.json({ error: "Upload session expired (30m TTL)" }, { status: 410 });
  }

  // 4. Validate All Parts Uploaded
  if (session.receivedParts.length !== session.expectedTotalParts) {
    await executeRollbackAndCleanup();
    return NextResponse.json(
      {
        error: `Incomplete upload: received ${session.receivedParts.length} of ${session.expectedTotalParts} parts`,
      },
      { status: 400 }
    );
  }

  // 5. Finalize Cryptographic Reassembled SHA-256
  let fullSha256: string;
  try {
    fullSha256 = session.finalSha256 || session.hashStream.digest("hex");
    session.finalSha256 = fullSha256;
  } catch {
    fullSha256 = session.finalSha256 || "";
  }

  if (clientSha256 && clientSha256.toLowerCase() !== fullSha256.toLowerCase()) {
    logger.warn({ clientSha256, fullSha256 }, "Checksum mismatch on upload completion");
    await executeRollbackAndCleanup();
    return NextResponse.json(
      { error: "Cryptographic checksum mismatch between client and reassembled parts" },
      { status: 400 }
    );
  }

  // 6. Enforce PPTX Accompaniment Rule
  if (kind === "ppt") {
    const accompanimentCheck = validatePptxAccompaniment({
      kind,
      hasAccompanyingPdf,
      parentFileId,
    });
    if (!accompanimentCheck.valid) {
      await executeRollbackAndCleanup();
      return NextResponse.json(
        { error: accompanimentCheck.error || "PPTX files require an accompanying PDF preview export" },
        { status: 400 }
      );
    }
  }

  let createdFileId: string | null = null;

  try {
    // 7. Find or Auto-Create Chapter
    const chapter = await findOrCreateChapter({
      class: classNum,
      subject,
      chapterNo,
      title,
    });

    // 8. Check for Duplicate File in Chapter (chapter_id + sha256)
    const duplicate = await checkDuplicateFile(chapter.id, fullSha256);
    if (duplicate) {
      logger.info(
        { chapterId: chapter.id, sha256: fullSha256 },
        "Duplicate file detected in chapter; triggering rollback"
      );
      await executeRollbackAndCleanup();
      return NextResponse.json(
        {
          error: "Duplicate file: A file with identical content already exists in this chapter",
          existingFile: {
            id: duplicate.id,
            fileName: duplicate.file_name,
          },
        },
        { status: 409 }
      );
    }

    // 9. Query Existing Filenames in Chapter for Collision Disambiguation
    const { data: existingFiles } = await db
      .from("files")
      .select("file_name")
      .eq("chapter_id", chapter.id);

    const existingNames = (existingFiles || []).map((f) => f.file_name);
    const ext = kind === "ppt" ? "pptx" : "pdf";
    const mime =
      kind === "ppt"
        ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        : "application/pdf";

    // 10. Generate Deterministic Filename
    const sanitizedFileName = buildFileName({
      class: classNum,
      subject,
      chapterNo,
      title,
      kind,
      teacherName: teacherName || undefined,
      ext,
      existingNames,
    });

    // 11. Insert row into `files`
    createdFileId = crypto.randomUUID();
    const { data: insertedFile, error: fileErr } = await db
      .from("files")
      .insert({
        id: createdFileId,
        chapter_id: chapter.id,
        kind,
        parent_file_id: parentFileId || null,
        file_name: sanitizedFileName,
        teacher_name: teacherName || null,
        size_bytes: session.totalBytesReceived,
        part_count: session.expectedTotalParts,
        mime,
        sha256: fullSha256,
        is_published: true,
      })
      .select()
      .single();

    if (fileErr || !insertedFile) {
      throw fileErr || new Error("Failed to insert file record");
    }

    // 12. Insert rows into `file_parts`
    const partsPayload = session.uploadedParts.map((p) => ({
      file_id: createdFileId!,
      part_no: p.partNo,
      tg_file_id: p.tgFileId,
      tg_file_unique_id: p.tgFileUniqueId,
      tg_message_id: p.tgMessageId,
      size_bytes: p.sizeBytes,
      sha256: p.sha256,
    }));

    const { error: partsErr } = await db.from("file_parts").insert(partsPayload);
    if (partsErr) {
      throw partsErr;
    }

    // 13. Success: Clean up in-memory session
    uploadSessionManager.deleteSession(uploadId);

    return NextResponse.json(
      {
        success: true,
        file: insertedFile,
        chapter,
      },
      { status: 201 }
    );
  } catch (dbErr) {
    logger.error({ err: (dbErr as Error).message }, "Database error during upload completion; rolling back");

    // Clean up any inserted file row (cascades to file_parts)
    if (createdFileId) {
      try {
        await db.from("files").delete().eq("id", createdFileId);
      } catch (cleanupErr) {
        logger.error({ err: cleanupErr }, "Failed to remove partial DB row during rollback");
      }
    }

    // Delete all Telegram parts
    await executeRollbackAndCleanup();

    return NextResponse.json(
      {
        error: "Database insertion failure during completion, rolled back all records",
        details: (dbErr as Error).message,
      },
      { status: 500 }
    );
  }
}
