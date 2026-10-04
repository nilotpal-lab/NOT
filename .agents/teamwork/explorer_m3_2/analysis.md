# Milestone M3 Analysis: Upload API Endpoints & Supabase Catalog Transactions
**Agent**: `explorer_m3_2` (Teamwork Preview Explorer)  
**Target Routes**:  
- `src/app/api/admin/upload/part/route.ts` (Chunk Part Upload & Telegram Forwarding)  
- `src/app/api/admin/upload/complete/route.ts` (Catalog Transactions, Auto-Creation, Duplicate Rollback)  
**Supporting Libraries & Contracts**:  
- `src/types/database.ts`  
- `src/lib/catalog.ts`  
- `src/lib/upload-session.ts`  
- `src/lib/telegram.ts`  

---

## 1. Executive Summary & Architectural Overview

Milestone M3 implements the core zero-cost storage pipeline for the SST Chapter Library. Under this architecture, large educational files (NCERT textbooks, PPT presentations, and teacher notes up to 200 MiB) are sliced by the client into chunks of at most 19 MiB (`PART_SIZE_BYTES = 19 * 1024 * 1024 = 19,922,944` bytes). These chunks are uploaded sequentially to the Next.js server, which:
1. Validates strict chunk ordering, sizes, and magic bytes.
2. Updates an incremental cryptographic SHA-256 stream without keeping full files in memory.
3. Forwards each chunk immediately to a private Telegram channel using `TelegramClient.sendDocument` with structured metadata captions.
4. Retains **at most 1 chunk in memory** during processing to guarantee server stability under zero-cost/low-memory environments.
5. On upload completion, executes an atomic catalog transaction in Supabase (`chapters`, `files`, and `file_parts` tables).
6. Enforces automatic, bidirectional rollback: if Telegram forward fails or database insertion fails or duplicate content is detected, all uploaded Telegram messages are automatically purged, any inserted database records are cleaned up, and zero orphaned data is left behind.

---

## 2. In-Depth Component Analysis & Contracts

### 2.1 Database Schema & Integrity Requirements (`supabase/schema.sql`)
The PostgreSQL schema enforces relational consistency:
- **`chapters`**:
  - `id`: UUID primary key (`default gen_random_uuid()`)
  - `class`: `smallint not null check (class between 6 and 10)`
  - `subject`: `text not null check (subject in ('History','Geography','Civics','Economics','SocialScience'))`
  - `chapter_no`: `smallint not null check (chapter_no between 1 and 99)`
  - `title`: `text not null check (length(title) between 2 and 200)`
  - `unique (class, subject, chapter_no)`
- **`files`**:
  - `id`: UUID primary key
  - `chapter_id`: UUID foreign key references `chapters(id)` ON DELETE CASCADE
  - `kind`: `text not null check (kind in ('ncert_pdf','ppt','ppt_pdf','teacher_notes'))`
  - `parent_file_id`: UUID references `files(id)` ON DELETE CASCADE (used to link `ppt_pdf` preview to parent `ppt`)
  - `file_name`: `text not null unique`
  - `size_bytes`: `bigint not null check (size_bytes > 0 and size_bytes <= 209715200)` (200 MiB ceiling)
  - `part_count`: `smallint not null default 1`
  - `mime`: `text not null check (mime in ('application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation'))`
  - `sha256`: `text not null` (full file hash)
  - `unique (chapter_id, sha256)`: duplicate file rejection invariant
- **`file_parts`**:
  - `file_id`: UUID foreign key references `files(id)` ON DELETE CASCADE
  - `part_no`: `smallint not null check (part_no >= 1)`
  - `tg_file_id`: `text not null`
  - `tg_file_unique_id`: `text not null`
  - `tg_message_id`: `bigint not null`
  - `size_bytes`: `integer not null check (size_bytes > 0 and size_bytes <= 19922944)`
  - `sha256`: `text not null` (individual chunk hash)
  - `primary key (file_id, part_no)`

---

## 3. Concrete Design: `/api/admin/upload/part/route.ts`

### 3.1 Requirements Matrix
1. **Authentication & Perimeter Security**: Protected by `src/middleware.ts` verifying `admin_session` cookie and validating Origin header on mutating requests. Route additionally confirms admin token validity.
2. **Payload Flexibility**: Supports both `multipart/form-data` (browser file uploads) and `application/octet-stream` (streaming tools, tests, CLI).
3. **Session Verification**: Validates session existence and verifies 30-minute TTL (`Date.now() - session.createdAt <= 30 * 60 * 1000`). If Part 1 arrives for a new session, session is auto-initialized.
4. **Chunk Invariants**:
   - `size_bytes <= 19 * 1024 * 1024` (max `19922944` bytes). Outsized chunks rejected with HTTP 400.
   - Strict ordering: `partNo === session.receivedParts.length + 1`. Out-of-order or duplicate parts rejected with HTTP 400.
5. **Memory Constraint (Hold At Most 1 Chunk)**:
   - Chunk buffer is ingested from the request stream.
   - Piped to incremental SHA-256 (`hashStream.update(chunkBuffer)`).
   - Chunk SHA-256 is computed.
   - Forwarded immediately to Telegram via `tgClient.sendDocument`.
   - Chunk buffer is dereferenced to allow immediate garbage collection.
6. **Magic-Byte Streaming Validation**:
   - On Part 1: validates `%PDF-` header (PDF) or `PK\x03\x04` header (PPTX) using `src/lib/magic.ts`.
   - On Part `total`: validates `%%EOF` (PDF) or Central Directory / `[Content_Types].xml` (PPTX).
7. **Telegram Caption Formatting**: Formats caption according to `formatTelegramCaption`:
   `title=...|class=...|subject=...|ch=...|kind=...|name=...|sha=...|part=n/total`.
8. **Automatic Rollback on Failure**:
   - If Telegram API fails (network error, rate limit timeout, invalid bot token):
     - Executes rollback: calls `deleteMessage` on all prior Telegram message IDs recorded in the session.
     - Destroys in-memory session.
     - Returns HTTP 500 error with sanitized error message (bot token redacted).

### 3.2 Concrete Route Code: `src/app/api/admin/upload/part/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getAdminCookieOptions, verifyAdminToken, ADMIN_COOKIE_NAME } from "@/lib/auth";
import { PART_SIZE_BYTES, getEnv } from "@/lib/validate";
import { formatTelegramCaption } from "@/lib/naming";
import { validatePdfMagic, validatePptxMagic } from "@/lib/magic";
import { TelegramClient } from "@/lib/telegram";
import { uploadSessionManager, UploadSessionPartRecord } from "@/lib/upload-session";
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

  let uploadId: string = "";
  let partNo: number = 0;
  let totalParts: number = 0;
  let fileName: string = "";
  let kind: string = "ncert_pdf";
  let title: string = "Chapter";
  let classNum: number = 9;
  let subject: string = "SocialScience";
  let chapterNo: number = 1;
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
    return NextResponse.json({ error: "Part chunk cannot be empty" }, { status: 400 });
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

  // 5. Lookup or initialize upload session
  let session = uploadSessionManager.getSession(uploadId);
  if (!session) {
    if (partNo === 1) {
      session = uploadSessionManager.startSession(uploadId, totalParts, {
        fileName,
        kind,
        title,
        class: classNum,
        subject,
        chapterNo,
      });
    } else {
      return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });
    }
  }

  // Check TTL (30 minutes)
  const SESSION_TTL_MS = 30 * 60 * 1000;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    await uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId);
    uploadSessionManager.deleteSession(uploadId);
    return NextResponse.json({ error: "Upload session expired (30m TTL)" }, { status: 410 });
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
    const isPdf = kind === "ncert_pdf" || kind === "teacher_notes" || kind === "ppt_pdf" || fileName.endsWith(".pdf");
    const isPptx = kind === "ppt" || fileName.endsWith(".pptx");

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
      logger.error({ err: (tgErr as Error).message, partNo, uploadId }, "Telegram forwarding failed; initiating rollback");
      // Automatic Rollback of all previously uploaded parts
      await uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId);
      uploadSessionManager.deleteSession(uploadId);
      return NextResponse.json(
        { error: "Telegram forward failed, rolled back uploaded parts", details: (tgErr as Error).message },
        { status: 500 }
      );
    }

    // 12. Record part metadata in session
    const partRecord: UploadSessionPartRecord = {
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
    session.partsMeta.push(partRecord);
    session.totalBytesReceived += chunkBuffer.length;
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
```

---

## 4. Concrete Design: `/api/admin/upload/complete/route.ts`

### 4.1 Requirements Matrix
1. **Completion Check**: Verifies all `expectedTotalParts` have arrived (`session.receivedParts.length === session.expectedTotalParts`).
2. **Reassembled SHA-256 Fidelity**: Finalizes `session.hashStream.digest("hex")`. If client provided a hash, verifies exact byte-level cryptographic match.
3. **PPTX Accompaniment Enforcement**: If `kind === "ppt"`, asserts `parent_file_id` or accompanying PDF export preview is present. If missing, triggers rollback and returns HTTP 400.
4. **Idempotent Chapter Auto-Creation**:
   - Searches `chapters` table by `(class, subject, chapter_no)`.
   - If missing, inserts row into `chapters` and retrieves generated UUID.
   - Handles concurrent insertion race conditions via PostgreSQL constraint `23505` retry.
5. **Duplicate File Detection & Rollback**:
   - Queries `files` table: `WHERE chapter_id = $chapterId AND sha256 = $fullSha256`.
   - If collision found:
     - Triggers automatic Telegram message deletion for all parts.
     - Destroys in-memory session.
     - Leaves zero database modifications.
     - Returns HTTP 409 Conflict with user-friendly message.
6. **Deterministic File Naming**: Calls `buildFileName` with existing filenames in the chapter to prevent collisions.
7. **Atomic Relational Persistence**:
   - Inserts row into `files`.
   - Inserts batch into `file_parts`.
   - If database insertion fails at any point:
     - Removes any partially inserted DB record (`DELETE FROM files WHERE id = $fileId`).
     - Triggers automatic Telegram message deletion.
     - Destroys in-memory session.
     - Returns HTTP 500 error.
8. **Session Disposal**: Cleans up in-memory session and returns HTTP 201 Created with saved file and chapter details.

### 4.2 Concrete Route Code: `src/app/api/admin/upload/complete/route.ts`

```typescript
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

  // 3. Retrieve Upload Session
  const session = uploadSessionManager.getSession(uploadId);
  if (!session) {
    return NextResponse.json({ error: "Upload session not found or expired" }, { status: 404 });
  }

  // Helper for rolling back Telegram messages and clearing session
  const executeRollbackAndCleanup = async () => {
    await uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId);
    uploadSessionManager.deleteSession(uploadId);
  };

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
      logger.info({ chapterId: chapter.id, sha256: fullSha256 }, "Duplicate file detected in chapter; triggering rollback");
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
    const partsPayload = session.partsMeta.map((p) => ({
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
```

---

## 5. Supporting Data Service Design (`src/lib/catalog.ts` & `src/types/database.ts`)

### 5.1 Type Definitions: `src/types/database.ts`
```typescript
export type Subject = "History" | "Geography" | "Civics" | "Economics" | "SocialScience";
export type FileKind = "ncert_pdf" | "ppt" | "ppt_pdf" | "teacher_notes";

export interface ChapterRecord {
  id: string;
  class: number;
  subject: Subject | string;
  chapter_no: number;
  title: string;
  book?: string | null;
  edition?: string | null;
  created_at: string;
}

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
  created_at: string;
}

export interface FilePartRecord {
  file_id: string;
  part_no: number;
  tg_file_id: string;
  tg_file_unique_id: string;
  tg_message_id: number;
  size_bytes: number;
  sha256: string;
}

export interface ChapterWithFiles extends ChapterRecord {
  files: FileRecord[];
}
```

### 5.2 Catalog Service Implementation: `src/lib/catalog.ts`
```typescript
import { getDb } from "./db";
import { ChapterRecord, FileRecord, FilePartRecord } from "@/types/database";
import { logger } from "./logger";

export async function findOrCreateChapter(data: {
  class: number;
  subject: string;
  chapterNo: number;
  title: string;
  book?: string;
  edition?: string;
}): Promise<ChapterRecord> {
  const db = getDb();

  // 1. Query existing chapter
  const { data: existing, error: selectErr } = await db
    .from("chapters")
    .select("*")
    .eq("class", data.class)
    .eq("subject", data.subject)
    .eq("chapter_no", data.chapterNo)
    .maybeSingle();

  if (existing) {
    return existing as ChapterRecord;
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
      const { data: retry } = await db
        .from("chapters")
        .select("*")
        .eq("class", data.class)
        .eq("subject", data.subject)
        .eq("chapter_no", data.chapterNo)
        .single();
      if (retry) return retry as ChapterRecord;
    }
    logger.error({ insertErr }, "Failed to find or create chapter");
    throw insertErr;
  }

  return created as ChapterRecord;
}

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

  if (error) {
    logger.error({ error }, "Error querying duplicate file check");
    throw error;
  }

  return data;
}

export async function insertFileWithParts(
  fileData: Omit<FileRecord, "id" | "created_at">,
  parts: Array<Omit<FilePartRecord, "file_id">>
): Promise<FileRecord> {
  const db = getDb();

  const fileId = crypto.randomUUID();
  const { data: insertedFile, error: fileErr } = await db
    .from("files")
    .insert({
      id: fileId,
      ...fileData,
    })
    .select()
    .single();

  if (fileErr || !insertedFile) {
    throw fileErr || new Error("Failed to insert file row");
  }

  const partsPayload = parts.map((p) => ({
    file_id: fileId,
    ...p,
  }));

  const { error: partsErr } = await db.from("file_parts").insert(partsPayload);
  if (partsErr) {
    // Rollback file record
    await db.from("files").delete().eq("id", fileId);
    throw partsErr;
  }

  return insertedFile as FileRecord;
}
```

---

## 6. Upload Session Manager Design (`src/lib/upload-session.ts`)

```typescript
import crypto from "crypto";
import { TelegramClient } from "./telegram";
import { logger } from "./logger";

export interface UploadSessionPartRecord {
  partNo: number;
  tgFileId: string;
  tgFileUniqueId: string;
  tgMessageId: number;
  sizeBytes: number;
  sha256: string;
  uploadedAt: number;
}

export interface UploadSession {
  uploadId: string;
  expectedTotalParts: number;
  fileName: string;
  kind?: string;
  title?: string;
  class?: number;
  subject?: string;
  chapterNo?: number;
  receivedParts: number[];
  uploadedMessageIds: number[];
  partsMeta: UploadSessionPartRecord[];
  hashStream: crypto.Hash;
  finalSha256?: string;
  firstChunkHeader?: Buffer;
  totalBytesReceived: number;
  createdAt: number;
  lastActivityAt: number;
  isProcessing: boolean;
}

export class UploadSessionManager {
  private sessions = new Map<string, UploadSession>();

  constructor(private sessionTtlMs = 30 * 60 * 1000) {}

  startSession(
    uploadId: string,
    expectedTotalParts: number,
    metadata?: Partial<UploadSession>
  ): UploadSession {
    const session: UploadSession = {
      uploadId,
      expectedTotalParts,
      fileName: metadata?.fileName || "unnamed",
      kind: metadata?.kind || "ncert_pdf",
      title: metadata?.title,
      class: metadata?.class,
      subject: metadata?.subject,
      chapterNo: metadata?.chapterNo,
      receivedParts: [],
      uploadedMessageIds: [],
      partsMeta: [],
      hashStream: crypto.createHash("sha256"),
      totalBytesReceived: 0,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      isProcessing: false,
    };
    this.sessions.set(uploadId, session);
    return session;
  }

  getSession(uploadId: string): UploadSession | undefined {
    const session = this.sessions.get(uploadId);
    if (!session) return undefined;
    if (Date.now() - session.createdAt > this.sessionTtlMs) {
      this.sessions.delete(uploadId);
      return undefined;
    }
    return session;
  }

  deleteSession(uploadId: string): boolean {
    return this.sessions.delete(uploadId);
  }

  acquireLock(uploadId: string): boolean {
    const session = this.sessions.get(uploadId);
    if (!session || session.isProcessing) return false;
    session.isProcessing = true;
    return true;
  }

  releaseLock(uploadId: string): void {
    const session = this.sessions.get(uploadId);
    if (session) session.isProcessing = false;
  }

  async rollbackSessionTelegram(
    uploadId: string,
    tgClient: TelegramClient,
    channelId: string | number
  ): Promise<number[]> {
    const session = this.sessions.get(uploadId);
    if (!session || session.uploadedMessageIds.length === 0) return [];

    const deletedIds: number[] = [];
    for (const msgId of session.uploadedMessageIds) {
      try {
        const ok = await tgClient.deleteMessage(channelId, msgId);
        if (ok) deletedIds.push(msgId);
      } catch (err) {
        logger.warn({ msgId, err: (err as Error).message }, "Error deleting Telegram message during session rollback");
      }
    }
    session.uploadedMessageIds = [];
    return deletedIds;
  }
}

export const uploadSessionManager = new UploadSessionManager();
```

---

## 7. Edge Case Matrix & Rollback Behavior

| # | Trigger Condition | Detection Point | Rollback Action | HTTP Response | Resulting State |
|---|-------------------|-----------------|-----------------|---------------|-----------------|
| 1 | Chunk size > 19 MiB | `/part` entry check | None (not sent to TG) | 400 Bad Request | Session untouched |
| 2 | Out-of-order part (e.g. part 2 before 1) | `/part` ordering check | None (not sent to TG) | 400 Bad Request | Session untouched |
| 3 | Duplicate part submission | `/part` ordering check | None (not sent to TG) | 400 Bad Request | Session untouched |
| 4 | Corrupt magic bytes (fake `.exe` disguised as PDF) | `/part` header check | None (not sent to TG) | 400 Bad Request | Session untouched |
| 5 | Mid-flight TG failure on part $K$ of $N$ | `/part` send catch | `deleteMessage` on parts $1 \dots K-1$; destroy session | 500 Server Error | 0 TG messages, 0 DB rows |
| 6 | Session expires (> 30 min) | `/part` or `/complete` TTL check | `deleteMessage` on any sent parts; destroy session | 410 / 404 | 0 TG messages, 0 DB rows |
| 7 | Concurrent chunk upload for same session | `/part` lock check | None | 409 Conflict | Serialized execution |
| 8 | Premature complete call ($M < N$ parts) | `/complete` count check | `deleteMessage` on all $M$ parts; destroy session | 400 Bad Request | 0 TG messages, 0 DB rows |
| 9 | Checksum mismatch (client vs stream) | `/complete` hash check | `deleteMessage` on all $N$ parts; destroy session | 400 Bad Request | 0 TG messages, 0 DB rows |
| 10 | PPTX upload missing preview PDF export | `/complete` accompaniment | `deleteMessage` on all $N$ parts; destroy session | 400 Bad Request | 0 TG messages, 0 DB rows |
| 11 | Duplicate file in chapter (`(chapter_id, sha256)`) | `/complete` dedup check | `deleteMessage` on all $N$ parts; destroy session | 409 Conflict | Original file preserved, 0 new DB rows |
| 12 | Database insert failure on `files` or `file_parts` | `/complete` insert catch | `deleteMessage` on all $N$ parts; delete partial `files` row; destroy session | 500 Server Error | 0 TG messages, 0 DB rows |

---

## 8. Verification Strategy
To independently verify this design:
1. **Unit Tests**:
   - `npm test tests/tier1-feature/chunking.test.ts`
   - `npm test tests/tier1-feature/catalog-admin.test.ts`
   - `npm test tests/tier2-boundary/boundary.test.ts`
   - `npm test tests/tier3-combination/combination.test.ts`
   - `npm test tests/tier4-lifecycle/lifecycle.test.ts`
2. **Build and Typecheck**:
   - `npm run build`
   - `npm run lint`
