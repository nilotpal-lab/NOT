# Milestone M4 Analysis: Admin Library API Routes Architecture & Implementation

## 1. Executive Summary & Problem Boundary

Milestone M4 establishes the administrative control plane for the SST Chapter Library. While M1 delivered authentication security, M2 deterministic auto-naming, and M3 the chunked upload engine, M4 equips the admin portal (`/admin`) with complete CRUD and governance capabilities over chapters and uploaded files.

This analysis formulates the concrete Next.js App Router (v16.3.8) API route handlers for Milestone M4:
1. `GET /api/admin/library` — Multi-facet catalog query with filtering by class, subject, kind, and published status.
2. `PATCH /api/admin/library/[id]` — Individual file visibility toggle (`is_published`).
3. `DELETE /api/admin/library/[id]` — Atomic file deletion purging database records and all associated Telegram part messages.
4. `PATCH /api/admin/library/chapter/[id]` — Chapter title rename with cascading deterministic file rename recalculation.
5. `POST /api/admin/library/bulk-toggle` — Mass visibility toggle for all `teacher_notes` without affecting NCERT or PPT files.

### Critical Next.js 16 Constraint (AGENTS.md Compliance)
In Next.js 16 (App Router), `params` in dynamic route handlers is an **asynchronous Promise**:
```ts
// Next.js 16 breaking change: params must be awaited
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  ...
}
```
Synchronous access to `params.id` without `await params` causes runtime warnings/errors in Next.js 16. All proposed route handlers strictly await `params`.

---

## 2. Route Architecture & File Mapping

In the Next.js App Router filesystem hierarchy, literal segment names take precedence over dynamic parameters (`[id]`). Therefore, colocating `[id]`, `chapter/[id]`, and `bulk-toggle` under `src/app/api/admin/library/` resolves without route collisions.

```
src/app/api/admin/library/
├── route.ts                     # Handles GET /api/admin/library
├── [id]/
│   └── route.ts                 # Handles PATCH and DELETE /api/admin/library/[id]
├── chapter/
│   └── [id]/
│       └── route.ts             # Handles PATCH /api/admin/library/chapter/[id]
└── bulk-toggle/
    └── route.ts                 # Handles POST /api/admin/library/bulk-toggle
```

| Route URL | HTTP Method | Target File Path | Primary Function |
|---|---|---|---|
| `/api/admin/library` | `GET` | `src/app/api/admin/library/route.ts` | List catalog chapters & files with filters |
| `/api/admin/library/[id]` | `PATCH` | `src/app/api/admin/library/[id]/route.ts` | Toggle single file `is_published` |
| `/api/admin/library/[id]` | `DELETE` | `src/app/api/admin/library/[id]/route.ts` | Purge Telegram parts + delete file from DB |
| `/api/admin/library/chapter/[id]` | `PATCH` | `src/app/api/admin/library/chapter/[id]/route.ts` | Rename chapter title & cascade filename updates |
| `/api/admin/library/bulk-toggle` | `POST` | `src/app/api/admin/library/bulk-toggle/route.ts` | Bulk toggle `teacher_notes` published status |

---

## 3. Detailed Endpoint Specifications

### 3.1. `GET /api/admin/library`
* **Purpose**: Query catalog hierarchy with nested files.
* **Authentication**: Edge middleware verifies `admin_session`; route handler executes defense-in-depth token verification (`verifyAdminToken`).
* **Query Parameters**:
  - `class`: Optional integer (e.g. `6` through `10`, or `"all"` for no filter).
  - `subject`: Optional enum string (`"History"`, `"Geography"`, `"Civics"`, `"Economics"`, `"SocialScience"`, or `"all"`).
  - `kind`: Optional enum string (`"ncert_pdf"`, `"ppt"`, `"ppt_pdf"`, `"teacher_notes"`, or `"all"`).
  - `isPublished`: Optional boolean (`"true"` / `"false"` / `"all"`). Also accepts `publishedOnly="true"`.
* **Validation**:
  - Validates `class` between 6 and 10 when present.
  - Normalizes `"all"` and empty strings to `undefined`.
* **Behavior**:
  - Calls `getChaptersWithFiles({ class, subject, kind, publishedOnly, isPublished })`.
  - Ensures file list per chapter is strictly filtered by `is_published` even when requesting hidden files (`isPublished=false`).
* **Response**:
  - HTTP 200: JSON list of chapters with nested files (`ChapterWithFiles[]`).
  - HTTP 400: Validation error on query parameters.
  - HTTP 401: Unauthorized if session cookie is absent or invalid.
  - HTTP 500: Database failure.

### 3.2. `PATCH /api/admin/library/[id]`
* **Purpose**: Toggle file published status between visible (`true`) and hidden (`false`).
* **Authentication & CSRF**:
  - Verified admin session token (`verifyAdminToken`).
  - Origin header validation (`validateOrigin`) against CSRF attacks.
* **Path Parameters**:
  - `id`: File ID (UUID string).
* **Request Body**:
  ```json
  {
    "isPublished": false
  }
  ```
* **Validation**:
  - Zod schema asserting `isPublished` is a strict boolean.
* **Behavior**:
  - Calls `toggleFilePublished(fileId, isPublished)` from `src/lib/catalog.ts`.
* **Response**:
  - HTTP 200: Updated file JSON (`FileRecord`).
  - HTTP 400: Invalid payload (non-boolean `isPublished`).
  - HTTP 401: Unauthorized.
  - HTTP 403: Forbidden (Origin check failed).
  - HTTP 404: File not found in database.
  - HTTP 500: Database error.

### 3.3. `DELETE /api/admin/library/[id]`
* **Purpose**: Permanently delete a file row and cleanly delete all associated Telegram message parts from the storage channel.
* **Authentication & CSRF**:
  - Verified admin session token (`verifyAdminToken`).
  - Origin header validation (`validateOrigin`).
* **Path Parameters**:
  - `id`: File ID (UUID string).
* **Behavior**:
  - Resolves Telegram client and storage channel ID (`TELEGRAM_CHANNEL_ID`).
  - Calls `deleteFileWithTelegramCleanup(fileId, getTelegramClient(), channelId)`.
  - Queries `file_parts` for all `tg_message_id`s.
  - Deletes database rows from `files` (cascading to `file_parts`).
  - Iterates through Telegram message IDs calling `tgClient.deleteMessage(channelId, msgId)`, trapping errors per message so failure of one does not block others.
* **Response**:
  - HTTP 200:
    ```json
    {
      "success": true,
      "deletedFileId": "b1a2c3d4-...",
      "deletedMessageIds": [101, 102, 103]
    }
    ```
  - HTTP 401: Unauthorized.
  - HTTP 403: Forbidden (Origin check failed).
  - HTTP 500: Internal error during deletion.

### 3.4. `PATCH /api/admin/library/chapter/[id]`
* **Purpose**: Rename a chapter title and recalculate all dependent file names using deterministic naming rules (`buildFileName`).
* **Authentication & CSRF**:
  - Verified admin session token (`verifyAdminToken`).
  - Origin header validation (`validateOrigin`).
* **Path Parameters**:
  - `id`: Chapter ID (UUID string).
* **Request Body**:
  ```json
  {
    "title": "The Story of Village Palampur"
  }
  ```
* **Validation**:
  - `title`: Required non-empty string, trimmed, min 1 char, max 200 chars.
* **Behavior**:
  - Calls `renameChapter(chapterId, title)` from `src/lib/catalog.ts`.
  - Updates chapter record in `chapters`.
  - Queries all files under `chapterId`, recalculates each `file_name` via `buildFileName`, and updates them in `files`.
* **Response**:
  - HTTP 200:
    ```json
    {
      "updatedChapter": {
        "id": "c1-...",
        "class": 9,
        "subject": "Economics",
        "chapter_no": 1,
        "title": "The Story of Village Palampur"
      },
      "updatedFilesCount": 3
    }
    ```
  - HTTP 400: Invalid payload (empty or missing title).
  - HTTP 401: Unauthorized.
  - HTTP 403: Forbidden (Origin check failed).
  - HTTP 404: Chapter not found.
  - HTTP 500: Database failure.

### 3.5. `POST /api/admin/library/bulk-toggle`
* **Purpose**: Bulk toggle published status of all `teacher_notes` files without altering NCERT or PPT visibility.
* **Authentication & CSRF**:
  - Verified admin session token (`verifyAdminToken`).
  - Origin header validation (`validateOrigin`).
* **Request Body**:
  ```json
  {
    "isPublished": false
  }
  ```
* **Validation**:
  - `isPublished`: Required strict boolean.
* **Behavior**:
  - Calls `bulkToggleTeacherNotes(isPublished)` from `src/lib/catalog.ts`.
  - Updates all files where `kind = 'teacher_notes'`.
* **Response**:
  - HTTP 200:
    ```json
    {
      "updatedCount": 8
    }
    ```
  - HTTP 400: Validation error.
  - HTTP 401: Unauthorized.
  - HTTP 403: Forbidden (Origin check failed).
  - HTTP 500: Database failure.

---

## 4. Security & Access Control Model

### Layer 1: Next.js Edge Middleware (`src/middleware.ts`)
- Matches `/api/admin/:path*`.
- Enforces `validateOrigin(req)` on mutating methods (`POST`, `PUT`, `DELETE`, `PATCH`), rejecting invalid or cross-origin requests with `HTTP 403 Forbidden`.
- Verifies `admin_session` cookie; returns `HTTP 401 Unauthorized` JSON if missing or invalid.

### Layer 2: Route Handler Defense-in-Depth
- Every route handler explicitly checks `req.cookies.get(ADMIN_COOKIE_NAME)?.value` and validates using `verifyAdminToken(token, secret)`.
- Mutating endpoints (`PATCH`, `DELETE`, `POST`) re-verify `validateOrigin(req)`.
- All routes export `export const dynamic = "force-dynamic"` to guarantee dynamic evaluation and eliminate risk of caching authenticated data.

---

## 5. Service Interoperability & Telegram Integration

### 5.1. Telegram Client Instantiation
In `DELETE /api/admin/library/[id]`, Telegram cleanup requires access to `TelegramClient`:
```ts
function getTelegramClient(): TelegramClient | undefined {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return undefined;
  return new TelegramClient(token);
}
```
If `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHANNEL_ID` is unset (e.g. during offline unit tests), `deleteFileWithTelegramCleanup` executes database cleanup and safely skips Telegram network deletion without throwing.

### 5.2. Cascading File Renames
When `renameChapter(chapterId, newTitle)` is invoked:
1. Chapter row is updated in PostgreSQL.
2. Linked `files` rows are retrieved.
3. For each file, `buildFileName` in `src/lib/naming.ts` is called with:
   - `class: chapter.class`
   - `subject: chapter.subject`
   - `chapterNo: chapter.chapter_no`
   - `title: newTitle`
   - `kind: file.kind`
   - `teacherName: file.teacher_name || undefined`
   - `ext: file.file_name.split('.').pop() || 'pdf'`
   - `existingNames: ...`
4. Recalculated file names are updated in Supabase.
5. The number of updated files is returned alongside the chapter record.

---

## 6. Proposed Code Implementations

### 6.1. `src/app/api/admin/library/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminToken, ADMIN_COOKIE_NAME } from "@/lib/auth";
import { getChaptersWithFiles } from "@/lib/catalog";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  class: z.coerce.number().int().min(6).max(10).optional(),
  subject: z.enum(["History", "Geography", "Civics", "Economics", "SocialScience"]).optional(),
  kind: z.enum(["ncert_pdf", "ppt", "ppt_pdf", "teacher_notes"]).optional(),
  isPublished: z.preprocess((val) => {
    if (val === "true" || val === true) return true;
    if (val === "false" || val === false) return false;
    return undefined;
  }, z.boolean().optional()),
});

/**
 * GET /api/admin/library
 * Retrieves catalog chapters with nested files matching optional filters:
 * - class: 6, 7, 8, 9, 10
 * - subject: History, Geography, Civics, Economics, SocialScience
 * - kind: ncert_pdf, ppt, ppt_pdf, teacher_notes
 * - isPublished: true, false (also supports publishedOnly=true)
 */
export async function GET(req: NextRequest) {
  // 1. Session Authentication (defense-in-depth)
  const secret = process.env.SESSION_SECRET;
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;

  if (!token || !secret) {
    return NextResponse.json({ error: "Unauthorized: Admin session required" }, { status: 401 });
  }
  const isAuth = await verifyAdminToken(token, secret);
  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized: Invalid or expired admin token" }, { status: 401 });
  }

  // 2. Parse & Validate Query Parameters
  const { searchParams } = req.nextUrl;
  const rawClass = searchParams.get("class");
  const rawSubject = searchParams.get("subject");
  const rawKind = searchParams.get("kind");
  const rawIsPublished = searchParams.get("isPublished") ?? searchParams.get("publishedOnly");

  const queryParams: Record<string, unknown> = {};
  if (rawClass && rawClass !== "all") queryParams.class = rawClass;
  if (rawSubject && rawSubject !== "all") queryParams.subject = rawSubject;
  if (rawKind && rawKind !== "all") queryParams.kind = rawKind;
  if (rawIsPublished !== null && rawIsPublished !== undefined && rawIsPublished !== "all") {
    queryParams.isPublished = rawIsPublished;
  }

  const parsed = querySchema.safeParse(queryParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const {
    class: classFilter,
    subject: subjectFilter,
    kind: kindFilter,
    isPublished: isPublishedFilter,
  } = parsed.data;

  try {
    // 3. Query catalog from database service
    const chapters = await getChaptersWithFiles({
      class: classFilter,
      subject: subjectFilter,
      kind: kindFilter,
      publishedOnly: isPublishedFilter === true ? true : undefined,
    });

    // 4. Strictly filter nested files if isPublished is specified (handles false / hidden files)
    let filteredChapters = chapters;
    if (isPublishedFilter !== undefined) {
      filteredChapters = chapters.map((chapter) => ({
        ...chapter,
        files: (chapter.files || []).filter((file) => file.is_published === isPublishedFilter),
      }));
    }

    // 5. Return JSON list of chapters with files
    return NextResponse.json(filteredChapters, { status: 200 });
  } catch (err) {
    logger.error({ err, queryParams }, "Failed to query catalog in GET /api/admin/library");
    return NextResponse.json(
      { error: "Failed to fetch catalog chapters", details: (err as Error).message },
      { status: 500 }
    );
  }
}
```

---

### 6.2. `src/app/api/admin/library/[id]/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminToken, validateOrigin, ADMIN_COOKIE_NAME } from "@/lib/auth";
import { toggleFilePublished, deleteFileWithTelegramCleanup } from "@/lib/catalog";
import { TelegramClient } from "@/lib/telegram";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const patchFileSchema = z.object({
  isPublished: z.boolean({
    required_error: "isPublished is required and must be a boolean",
    invalid_type_error: "isPublished must be a boolean",
  }),
});

function getTelegramClient(): TelegramClient | undefined {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return undefined;
  return new TelegramClient(token);
}

/**
 * PATCH /api/admin/library/[id]
 * Toggles a file's visibility (is_published).
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // 1. CSRF Protection
  if (!validateOrigin(req)) {
    return NextResponse.json(
      { error: "Forbidden: Invalid or missing Origin header" },
      { status: 403 }
    );
  }

  // 2. Authentication
  const secret = process.env.SESSION_SECRET;
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!token || !secret) {
    return NextResponse.json({ error: "Unauthorized: Admin session required" }, { status: 401 });
  }
  const isAuth = await verifyAdminToken(token, secret);
  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized: Invalid or expired admin token" }, { status: 401 });
  }

  // 3. Await dynamic parameter (Next.js 16 breaking change)
  const { id: fileId } = await context.params;
  if (!fileId || typeof fileId !== "string" || fileId.trim().length === 0) {
    return NextResponse.json({ error: "Invalid file ID parameter" }, { status: 400 });
  }

  // 4. Parse request body
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  const parsed = patchFileSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    // 5. Update visibility
    const updatedFile = await toggleFilePublished(fileId.trim(), parsed.data.isPublished);
    return NextResponse.json(updatedFile, { status: 200 });
  } catch (err) {
    const message = (err as Error).message || "";
    if (message.includes("not found")) {
      return NextResponse.json({ error: `File ${fileId} not found` }, { status: 404 });
    }
    logger.error({ err, fileId }, "Failed to toggle file visibility");
    return NextResponse.json(
      { error: "Failed to update file visibility", details: message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/library/[id]
 * Deletes a file record from DB and purges all Telegram chunk messages from channel.
 * Returns: { success: true, deletedFileId, deletedMessageIds }
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // 1. CSRF Protection
  if (!validateOrigin(req)) {
    return NextResponse.json(
      { error: "Forbidden: Invalid or missing Origin header" },
      { status: 403 }
    );
  }

  // 2. Authentication
  const secret = process.env.SESSION_SECRET;
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!token || !secret) {
    return NextResponse.json({ error: "Unauthorized: Admin session required" }, { status: 401 });
  }
  const isAuth = await verifyAdminToken(token, secret);
  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized: Invalid or expired admin token" }, { status: 401 });
  }

  // 3. Await dynamic parameter (Next.js 16 breaking change)
  const { id: fileId } = await context.params;
  if (!fileId || typeof fileId !== "string" || fileId.trim().length === 0) {
    return NextResponse.json({ error: "Invalid file ID parameter" }, { status: 400 });
  }

  try {
    // 4. Execute deletion with Telegram purge
    const channelId = process.env.TELEGRAM_CHANNEL_ID;
    const tgClient = getTelegramClient();
    const result = await deleteFileWithTelegramCleanup(fileId.trim(), tgClient, channelId);

    return NextResponse.json(
      {
        success: true,
        deletedFileId: result.deletedFileId,
        deletedMessageIds: result.deletedMessageIds,
      },
      { status: 200 }
    );
  } catch (err) {
    const message = (err as Error).message || "";
    logger.error({ err, fileId }, "Failed to delete file and Telegram messages");
    return NextResponse.json(
      { error: "Failed to delete file", details: message },
      { status: 500 }
    );
  }
}
```

---

### 6.3. `src/app/api/admin/library/chapter/[id]/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminToken, validateOrigin, ADMIN_COOKIE_NAME } from "@/lib/auth";
import { renameChapter } from "@/lib/catalog";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const renameChapterSchema = z.object({
  title: z
    .string({ required_error: "title is required" })
    .trim()
    .min(1, "title must be a non-empty string")
    .max(200, "title cannot exceed 200 characters"),
});

/**
 * PATCH /api/admin/library/chapter/[id]
 * Renames chapter title and triggers cascading filename recalculations.
 * Returns: { updatedChapter, updatedFilesCount }
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // 1. CSRF Protection
  if (!validateOrigin(req)) {
    return NextResponse.json(
      { error: "Forbidden: Invalid or missing Origin header" },
      { status: 403 }
    );
  }

  // 2. Authentication
  const secret = process.env.SESSION_SECRET;
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!token || !secret) {
    return NextResponse.json({ error: "Unauthorized: Admin session required" }, { status: 401 });
  }
  const isAuth = await verifyAdminToken(token, secret);
  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized: Invalid or expired admin token" }, { status: 401 });
  }

  // 3. Await dynamic parameter (Next.js 16 breaking change)
  const { id: chapterId } = await context.params;
  if (!chapterId || typeof chapterId !== "string" || chapterId.trim().length === 0) {
    return NextResponse.json({ error: "Invalid chapter ID parameter" }, { status: 400 });
  }

  // 4. Parse request body
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  const parsed = renameChapterSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    // 5. Execute rename with cascade
    const result = await renameChapter(chapterId.trim(), parsed.data.title);
    return NextResponse.json(
      {
        updatedChapter: result.updatedChapter,
        updatedFilesCount: result.updatedFilesCount,
      },
      { status: 200 }
    );
  } catch (err) {
    const message = (err as Error).message || "";
    if (message.includes("not found")) {
      return NextResponse.json({ error: `Chapter ${chapterId} not found` }, { status: 404 });
    }
    logger.error({ err, chapterId }, "Failed to rename chapter");
    return NextResponse.json(
      { error: "Failed to rename chapter", details: message },
      { status: 500 }
    );
  }
}
```

---

### 6.4. `src/app/api/admin/library/bulk-toggle/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminToken, validateOrigin, ADMIN_COOKIE_NAME } from "@/lib/auth";
import { bulkToggleTeacherNotes } from "@/lib/catalog";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const bulkToggleSchema = z.object({
  isPublished: z.boolean({
    required_error: "isPublished is required and must be a boolean",
    invalid_type_error: "isPublished must be a boolean",
  }),
});

/**
 * POST /api/admin/library/bulk-toggle
 * Bulk toggles published status of all teacher notes files.
 * Returns: { updatedCount }
 */
export async function POST(req: NextRequest) {
  // 1. CSRF Protection
  if (!validateOrigin(req)) {
    return NextResponse.json(
      { error: "Forbidden: Invalid or missing Origin header" },
      { status: 403 }
    );
  }

  // 2. Authentication
  const secret = process.env.SESSION_SECRET;
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!token || !secret) {
    return NextResponse.json({ error: "Unauthorized: Admin session required" }, { status: 401 });
  }
  const isAuth = await verifyAdminToken(token, secret);
  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized: Invalid or expired admin token" }, { status: 401 });
  }

  // 3. Parse request body
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  const parsed = bulkToggleSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    // 4. Execute bulk toggle
    const updatedCount = await bulkToggleTeacherNotes(parsed.data.isPublished);
    return NextResponse.json({ updatedCount }, { status: 200 });
  } catch (err) {
    logger.error({ err }, "Failed to bulk toggle teacher notes");
    return NextResponse.json(
      { error: "Failed to bulk toggle teacher notes", details: (err as Error).message },
      { status: 500 }
    );
  }
}
```

---

## 7. Client Consumption & UI Defense Patterns

To guarantee resilient integration between the Admin UI (`src/app/admin/page.tsx`) and these endpoints:

1. **Catalog List Fetching**:
   ```ts
   const res = await fetch(`/api/admin/library?class=${classFilter}&subject=${subjectFilter}&kind=${kindFilter}&isPublished=${pubFilter}`);
   if (res.ok) {
     const data = await res.json();
     const chaptersList: ChapterWithFiles[] = Array.isArray(data) ? data : (data.chapters || []);
     setChapters(chaptersList);
   }
   ```
2. **File Visibility Toggle**:
   ```ts
   const res = await fetch(`/api/admin/library/${fileId}`, {
     method: "PATCH",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ isPublished: nextState }),
   });
   ```
3. **File Deletion**:
   ```ts
   const res = await fetch(`/api/admin/library/${fileId}`, {
     method: "DELETE",
   });
   const data = await res.json(); // { success: true, deletedFileId, deletedMessageIds }
   ```
4. **Chapter Rename**:
   ```ts
   const res = await fetch(`/api/admin/library/chapter/${chapterId}`, {
     method: "PATCH",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ title: newTitle }),
   });
   const data = await res.json(); // { updatedChapter, updatedFilesCount }
   ```
5. **Bulk Toggle Teacher Notes**:
   ```ts
   const res = await fetch("/api/admin/library/bulk-toggle", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ isPublished: targetVisibility }),
   });
   const data = await res.json(); // { updatedCount }
   ```

---

## 8. Integration Testing Plan (`tests/unit/admin-library-routes.test.ts`)

A dedicated unit test suite should test these route handlers across:
1. **Security & Authentication**:
   - `401 Unauthorized` when cookie is missing, tampered, or expired.
   - `403 Forbidden` on `PATCH`, `DELETE`, `POST` when Origin header does not match `SITE_URL`.
2. **GET `/api/admin/library`**:
   - Correctly passes parsed query parameters (`class: 9`, `subject: "Economics"`, `kind: "ncert_pdf"`).
   - Strict filtering of files by `is_published` (`true` vs `false`).
   - Ignores `"all"` filter options.
   - Returns 400 on invalid query params (e.g. `class=99`).
3. **PATCH `/api/admin/library/[id]`**:
   - Successfully updates file visibility and returns updated file record.
   - Returns 400 when `isPublished` is missing or not a boolean.
   - Returns 404 when file does not exist.
4. **DELETE `/api/admin/library/[id]`**:
   - Deletes file from DB and calls `deleteMessage` on Telegram client for all part messages.
   - Returns `{ success: true, deletedFileId, deletedMessageIds }`.
5. **PATCH `/api/admin/library/chapter/[id]`**:
   - Renames chapter title and cascades recalculation to file names.
   - Returns 400 on empty string or whitespace title.
   - Returns `{ updatedChapter, updatedFilesCount }`.
6. **POST `/api/admin/library/bulk-toggle`**:
   - Bulk toggles all teacher notes and returns `{ updatedCount }`.
   - Returns 400 when `isPublished` is non-boolean.
