import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { verifyAdminToken, ADMIN_COOKIE_NAME } from "@/lib/auth";
import { PART_SIZE_BYTES, getEnv } from "@/lib/validate";
import { formatTelegramCaption } from "@/lib/naming";
import { validatePdfMagic, validatePptxMagic } from "@/lib/magic";
import { TelegramClient } from "@/lib/telegram";
import { uploadSessionManager, UploadPartMeta } from "@/lib/upload-session";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // 2 minutes for large chunk transmission

/**
 * Handles sequential multipart chunk uploads.
 * Holds at most ONE chunk in memory at any given time.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;

  // 1. Verify admin session token
  if (!token || !secret) {
    return NextResponse.json({ error: "Unauthorized: Admin session required" }, { status: 401 });
  }
  const isAuth = await verifyAdminToken(token, secret);
  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized: Invalid or expired admin token" }, { status: 401 });
  }

  const env = getEnv();
  const channelId = env.TELEGRAM_CHANNEL_ID;
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const tgClient = new TelegramClient(botToken);

  let uploadId = "";
  let partNo = 0;
  let totalParts = 0;
  let fileName = "";
  let kind = "ncert_pdf";
  let title = "Chapter";
  let classNum = 9;
  let subject = "SocialScience";
  let chapterNo = 1;
  let chunkBuffer: Buffer | null = null;

  const contentType = req.headers.get("content-type") || "";

  // 2. Parse request based on Content-Type
  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      uploadId = (formData.get("uploadId") as string) || "";
      partNo = Number(formData.get("part") || formData.get("partNo") || 0);
      totalParts = Number(formData.get("total") || formData.get("totalParts") || 0);
      fileName = (formData.get("fileName") as string) || "file.pdf";
      if (formData.has("kind")) kind = formData.get("kind") as string;
      if (formData.has("title")) title = formData.get("title") as string;
      if (formData.has("class")) classNum = Number(formData.get("class"));
      if (formData.has("subject")) subject = formData.get("subject") as string;
      if (formData.has("chapterNo")) chapterNo = Number(formData.get("chapterNo"));

      const fileField = formData.get("chunk") || formData.get("file");
      if (!fileField || typeof fileField === "string") {
        return NextResponse.json({ error: "Missing chunk binary file in multipart form" }, { status: 400 });
      }
      const arrayBuffer = await (fileField as Blob).arrayBuffer();
      chunkBuffer = Buffer.from(arrayBuffer);
    } else {
      // Octet-stream or custom client
      uploadId = req.headers.get("x-upload-id") || "";
      partNo = Number(req.headers.get("x-part-number") || req.headers.get("x-part") || 0);
      totalParts = Number(req.headers.get("x-total-parts") || req.headers.get("x-total") || 0);
      fileName = req.headers.get("x-file-name") || "file.pdf";
      if (req.headers.has("x-kind")) kind = req.headers.get("x-kind")!;
      if (req.headers.has("x-title")) title = req.headers.get("x-title")!;
      if (req.headers.has("x-class")) classNum = Number(req.headers.get("x-class"));
      if (req.headers.has("x-subject")) subject = req.headers.get("x-subject")!;
      if (req.headers.has("x-chapter-no")) chapterNo = Number(req.headers.get("x-chapter-no"));

      const arrayBuffer = await req.arrayBuffer();
      chunkBuffer = Buffer.from(arrayBuffer);
    }
  } catch (err) {
    logger.error({ err }, "Failed to parse upload part request body");
    return NextResponse.json({ error: "Invalid multipart payload" }, { status: 400 });
  }

  // 3. Validate fundamental parameters
  if (!uploadId || partNo < 1 || totalParts < 1 || partNo > totalParts) {
    return NextResponse.json(
      { error: "Missing or invalid upload parameters (uploadId, part, total)" },
      { status: 400 }
    );
  }

  if (!chunkBuffer || chunkBuffer.length === 0) {
    return NextResponse.json({ error: "Part chunk cannot be empty (0 bytes)" }, { status: 400 });
  }

  // 4. Validate chunk size ceiling (19 MiB)
  if (chunkBuffer.length > PART_SIZE_BYTES) {
    return NextResponse.json(
      {
        error: `Part ${partNo} exceeds maximum chunk size of 19 MiB (${chunkBuffer.length} > ${PART_SIZE_BYTES})`,
      },
      { status: 400 }
    );
  }

  // 5. Lookup existing upload session (peekSession preserves session data even if expired for Telegram rollback)
  let session = typeof uploadSessionManager.peekSession === "function"
    ? uploadSessionManager.peekSession(uploadId)
    : uploadSessionManager.getSession(uploadId, { includeExpired: true });

  const SESSION_TTL_MS = 30 * 60 * 1000;

  if (session) {
    // Session exists - check TTL expiration (30m TTL)
    const isExpired = typeof uploadSessionManager.isSessionExpired === "function"
      ? uploadSessionManager.isSessionExpired(uploadId)
      : (Date.now() - session.createdAt > SESSION_TTL_MS);

    if (isExpired) {
      logger.warn(
        { uploadId, partNo, createdAt: session.createdAt },
        "Upload session expired (30m TTL); rolling back Telegram parts"
      );
      await uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId);
      uploadSessionManager.deleteSession(uploadId);
      return NextResponse.json({ error: "Upload session expired (30m TTL)" }, { status: 410 });
    }
  } else {
    // Session does not exist in memory
    if (partNo === 1) {
      session = uploadSessionManager.startSession(uploadId, totalParts, {
        fileName,
        kind,
        title,
        class: classNum,
        subject,
        chapterNo,
        channelId,
      });
    } else {
      return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });
    }
  }

  // 6. Concurrency serialization lock
  if (!uploadSessionManager.acquireLock(uploadId)) {
    return NextResponse.json(
      { error: "Another chunk is currently uploading for this session" },
      { status: 409 }
    );
  }

  try {
    // 7. Verify strict part ordering
    const expectedPart = session.receivedParts.length + 1;
    if (partNo !== expectedPart) {
      return NextResponse.json(
        { error: `Out of order part: expected ${expectedPart}, received ${partNo}` },
        { status: 400 }
      );
    }

    // 8. Stream Magic-Byte Validation
    const effectiveKind = session.kind || kind;
    const effectiveFileName = session.fileName || fileName;
    const isPdf =
      effectiveKind === "ncert_pdf" ||
      effectiveKind === "teacher_notes" ||
      effectiveKind === "ppt_pdf" ||
      effectiveFileName.endsWith(".pdf");
    const isPptx = effectiveKind === "ppt" || effectiveFileName.endsWith(".pptx");

    if (partNo === 1) {
      if (isPdf) {
        const magicRes = validatePdfMagic(chunkBuffer);
        if (!magicRes.valid) {
          return NextResponse.json({ error: magicRes.error }, { status: 400 });
        }
      } else if (isPptx) {
        const magicRes = validatePptxMagic(chunkBuffer);
        if (!magicRes.valid) {
          return NextResponse.json({ error: magicRes.error }, { status: 400 });
        }
      }
      // Cache first 1024 bytes for trailer check on final part
      session.firstChunkHeader = Buffer.from(chunkBuffer.subarray(0, 1024));
    }

    if (partNo === totalParts) {
      if (isPdf) {
        const header = session.firstChunkHeader || chunkBuffer;
        const magicRes = validatePdfMagic(header, chunkBuffer);
        if (!magicRes.valid) {
          return NextResponse.json({ error: magicRes.error }, { status: 400 });
        }
      } else if (isPptx) {
        const header = session.firstChunkHeader || chunkBuffer;
        const magicRes = validatePptxMagic(header, chunkBuffer);
        if (!magicRes.valid) {
          return NextResponse.json({ error: magicRes.error }, { status: 400 });
        }
      }
    }

    // 9. Compute Part SHA-256 and update incremental stream hash
    const partSha = crypto.createHash("sha256").update(chunkBuffer).digest("hex");
    session.hashStream.update(chunkBuffer);

    // 10. Format Telegram Caption
    const caption = formatTelegramCaption({
      title: session.title || title,
      class: session.class || classNum,
      subject: session.subject || subject,
      ch: session.chapterNo || chapterNo,
      kind: session.kind || kind,
      name: session.fileName || fileName,
      sha: partSha,
      part: partNo,
      total: totalParts,
    });

    // 11. Forward immediately to Telegram storage channel
    const partFileName = `${session.fileName || fileName}.part${partNo}`;
    let tgRes;
    try {
      tgRes = await tgClient.sendDocument(channelId, chunkBuffer, partFileName, caption, 60000);
    } catch (tgErr) {
      logger.error(
        { err: (tgErr as Error).message, partNo, uploadId },
        "Telegram forwarding failed; initiating rollback"
      );
      // Automatic Rollback of all previously uploaded parts
      await uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId);
      uploadSessionManager.deleteSession(uploadId);
      return NextResponse.json(
        { error: "Telegram forward failed, rolled back uploaded parts", details: (tgErr as Error).message },
        { status: 500 }
      );
    }

    // 12. Record part metadata in session
    const partRecord: UploadPartMeta = {
      partNo,
      tgFileId: tgRes.fileId,
      tgFileUniqueId: tgRes.fileUniqueId,
      tgMessageId: tgRes.messageId,
      sizeBytes: chunkBuffer.length,
      sha256: partSha,
      uploadedAt: Date.now(),
    };

    session.receivedParts.push(partNo);
    session.uploadedMessageIds.push(tgRes.messageId);
    session.uploadedParts.push(partRecord);
    session.totalBytes += chunkBuffer.length;
    session.totalBytesReceived += chunkBuffer.length;
    session.updatedAt = Date.now();
    session.lastActivityAt = Date.now();

    // 13. Dereference chunkBuffer for GC (holds at most 1 chunk in memory)
    chunkBuffer = null;

    return NextResponse.json({
      success: true,
      uploadId,
      part: partNo,
      total: totalParts,
      messageId: tgRes.messageId,
      fileId: tgRes.fileId,
    });
  } finally {
    uploadSessionManager.releaseLock(uploadId);
  }
}
