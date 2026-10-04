# Milestone M4: Admin Library Management & Unit Test Specification

**Author**: Spec Miner (`teamwork_preview_spec_miner`)  
**Target Milestone**: M4 (Library Management Dashboard & Catalog Unit Tests)  
**Date**: 2026-10-04  
**Status**: SPECIFICATION COMPLETE & CODE PROPOSED  

---

## 1. Executive Summary

Milestone M4 delivers the full administrative management capabilities for the SST Chapter Library. It bridges the zero-cost Telegram chunked storage engine and Supabase PostgreSQL catalog with an intuitive, responsive administrative interface (`src/app/admin/page.tsx`) and an exhaustive unit test suite (`tests/unit/catalog.test.ts`).

### Key Discoveries & Gaps Identified
1. **UI Dashboard Missing**: `/admin` currently has only `/admin/login`; the main library dashboard at `src/app/admin/page.tsx` must be created.
2. **Catalog API Endpoints Missing**: The dashboard requires REST endpoints at:
   - `GET /api/admin/library` (catalog querying & filtering)
   - `PATCH /api/admin/library/[id]` (visibility toggle)
   - `DELETE /api/admin/library/[id]` (file delete & Telegram purge)
   - `PATCH /api/admin/library/chapter/[id]` (cascade chapter rename)
   - `POST /api/admin/library/bulk-toggle` (bulk teacher notes visibility)
3. **`renameChapter` Cascade Gap in `src/lib/catalog.ts`**: Currently, `renameChapter` in `src/lib/catalog.ts` only updates `chapters.title` and counts files; it does **not** recalculate each file's `file_name` via `buildFileName` or update `files.file_name` in Supabase. This must be enhanced to satisfy Feature 18, R4, and the dispatch test contract.
4. **No External Icon Library**: `lucide-react` is not installed; all UI components must use clean inline SVG icons matching Tailwind CSS v4 styling tokens.

---

## 2. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Admin UI | Session & Header Bar | Displays admin session badge, role, link to public catalog, quick upload button, and logout action | Session cookie | Rendered header with user email/role & buttons | Shows unauthenticated state, redirects to `/admin/login` | Prompt & R1/R4 |
| 2 | Admin UI | Multi-Faceted Filter Bar | Filter chapters and files by Class (All, 6-10), Subject (All, 4 subjects), Kind (All, 4 kinds), Status (All, Published, Hidden), and text search | Filter selections | Filtered list of chapters and files | "No matching materials" empty state with reset button | ORIGINAL_REQUEST § R4 |
| 3 | Admin UI | Bulk Teacher Notes Toggle | Bulk action buttons to hide or publish all teacher notes in the entire library | Action: `publish` or `hide` | Updated count toast, file badges update | Reverts optimistic state, displays error toast | ORIGINAL_REQUEST § R4 |
| 4 | Admin UI | Chapter Accordion Cards | Collapsible cards displaying Class, Subject badge, Chapter number, Chapter title, and file count | `ChapterWithFiles` data | Accordion card with file list and actions | Shows "No files in chapter" placeholder if empty | PROJECT.md § M4 |
| 5 | Admin UI | Chapter Rename Modal | Modal dialogue to rename chapter title, noting that all attached file names will be cascade recalculated | `chapterId`, `newTitle` | Updated chapter title & recalculated filenames | Form validation for empty title; API error toast | PROJECT.md Feature 18 |
| 6 | Admin UI | Chapter Files Table | Table inside chapter card showing filename, kind badge, size in MB, Telegram part count, status, actions | `files` array | Formatted table rows | Clean truncation for long filenames | ORIGINAL_REQUEST § R4 |
| 7 | Admin UI | Instant File Visibility Switch | Toggle switch allowing instant publish/hide of individual files with immediate feedback | `fileId`, `is_published` | Visual switch change + toast indicator | Reverts switch on API failure, displays error toast | ORIGINAL_REQUEST § R4 |
| 8 | Admin UI | File Deletion Modal | Confirmation modal warning about permanent database deletion and Telegram message part destruction | `fileId`, `fileName`, `part_count` | Deletion of DB rows and Telegram purge, list update | Error alert if deletion fails | ORIGINAL_REQUEST § R4 |
| 9 | Admin UI | Quick Material Upload Modal | Modal allowing quick in-dashboard file upload, chunk slicing, and Telegram forwarding | Form data + File blob | Sliced upload via `/api/admin/upload/*` + catalog refresh | Validates file type, magic bytes, displays error message | PROJECT.md § M3/M4 |
| 10 | Admin UI | UI State Management | Comprehensive loading skeleton, empty filter state, and network error retry card | Network & query state | Rendered UI states | Displays user-friendly retry button on error | Design System / UX |
| 11 | API Route | Catalog Query API | `GET /api/admin/library` querying chapters with optional filters (`class`, `subject`, `kind`, `publishedOnly`) | URL query parameters | JSON `{ chapters: ChapterWithFiles[] }` | HTTP 401 if unauthorized, 500 on DB failure | PROJECT.md § Code Layout |
| 12 | API Route | File Visibility API | `PATCH /api/admin/library/[id]` toggling file `is_published` flag | `{ is_published: boolean }` | JSON `{ file: FileRecord }` | HTTP 400 invalid body, 404 file not found | PROJECT.md § Code Layout |
| 13 | API Route | File Deletion API | `DELETE /api/admin/library/[id]` purging DB rows and all associated Telegram parts | `fileId` in URL | JSON `{ success: true, deletedMessageIds: number[] }` | HTTP 404 not found, 403 invalid origin | PROJECT.md Feature 20 |
| 14 | API Route | Chapter Rename API | `PATCH /api/admin/library/chapter/[id]` renaming chapter and cascade updating file names | `{ title: string }` | JSON `{ chapter: Chapter, updatedFilesCount: number }` | HTTP 400 empty title, 404 chapter not found | PROJECT.md Feature 18 |
| 15 | API Route | Bulk Visibility API | `POST /api/admin/library/bulk-toggle` bulk updating `is_published` on teacher notes | `{ is_published: boolean }` | JSON `{ success: true, count: number }` | HTTP 400 invalid payload, 403 bad origin | ORIGINAL_REQUEST § R4 |
| 16 | Catalog Service | `getChaptersWithFiles` | Query chapters ordered by class, subject, chapter_no; nested files filtered by kind/published | `filters` object | `ChapterWithFiles[]` | Propagates Supabase query error | `src/lib/catalog.ts` |
| 17 | Catalog Service | `renameChapter` Cascade | Updates chapter title, queries files, calls `buildFileName` for each, updates `files.file_name` in DB | `chapterId`, `newTitle` | `{ updatedChapter, updatedFilesCount }` | Throws error if chapter not found or DB fails | Dispatch Prompt & R4 |
| 18 | Catalog Service | `toggleFilePublished` | Sets `is_published` flag on single file record in Supabase | `fileId`, `isPublished` | `FileRecord` | Throws error if file not found | `src/lib/catalog.ts` |
| 19 | Catalog Service | `bulkToggleTeacherNotes` | Sets `is_published` on all files where `kind = 'teacher_notes'` | `isPublished` boolean | Number of affected rows | Propagates DB update error | `src/lib/catalog.ts` |
| 20 | Catalog Service | `deleteFileWithTelegramCleanup` | Fetches `tg_message_id`s from `file_parts`, deletes `files` row, purges Telegram messages | `fileId`, `tgClient`, `channelId` | `{ deletedFileId, deletedMessageIds }` | Gracefully handles partial Telegram failure | `src/lib/catalog.ts` |
| 21 | Unit Testing | Catalog Filter Tests | Verifies class, subject, kind, publishedOnly filters and combinations against mocked Supabase | Filter criteria | Filtered arrays verified | Assertions pass | Dispatch Prompt |
| 22 | Unit Testing | Rename Cascade Tests | Verifies chapter title update, `buildFileName` calls with correct args, and `files` table updates | `chapterId`, new title | Chapter updated, each file's name recalculated | Assertions pass | Dispatch Prompt |
| 23 | Unit Testing | Visibility Toggle Tests | Verifies single file published state changes between true and false | `fileId`, boolean | Updated file record verified | Assertions pass | Dispatch Prompt |
| 24 | Unit Testing | Bulk Toggle Notes Tests | Verifies all teacher notes toggled without touching NCERT or PPT records | `isPublished` boolean | Affected count and record states verified | Assertions pass | Dispatch Prompt |
| 25 | Unit Testing | Telegram Cleanup Tests | Verifies all part message IDs are passed to `tgClient.deleteMessage` and DB row deleted | `fileId`, mock Telegram | Deletion verification | Assertions pass | Dispatch Prompt |

---

## 3. Edge Cases & Observed Behaviors

| # | Feature | Input / Condition | Expected / Observed Behavior |
|---|---------|-------------------|-----------------------------|
| 1 | `renameChapter` | Chapter has 0 files attached | Chapter title is updated; `updatedFilesCount` returns `0`; no file update queries executed; no error thrown. |
| 2 | `renameChapter` | Chapter has mixed file kinds (`ncert_pdf`, `ppt`, `ppt_pdf`, `teacher_notes` with teacher names) | Every file's new name is calculated with appropriate kind slug (`NCERT`, `PPT`, `PPT-Preview`, `Notes-{Teacher}`) and extension preserved. |
| 3 | `renameChapter` | Chapter has title with special characters, emojis, or accents (e.g. "L'Économie & Le Développement! 🚀") | `sanitizeTitleSlug` strips accents and special characters, yielding clean ASCII slug (e.g. `LEconomie-Le-Developpement`), matching `^[A-Za-z0-9._-]+$`. |
| 4 | `renameChapter` | Chapter has long title (> 60 characters) | `sanitizeTitleSlug` truncates slug to 60 characters without trailing hyphen; output matches regex and updates DB. |
| 5 | `renameChapter` | Chapter rename causes filename collision with existing file in DB | `buildFileName` resolves collision by appending `-2`, `-3` according to existing filenames. |
| 6 | `deleteFileWithTelegramCleanup` | File has 0 parts in `file_parts` (corrupted or stub record) | `files` row is deleted; Telegram purge loop handles empty array without errors; returns `deletedMessageIds: []`. |
| 7 | `deleteFileWithTelegramCleanup` | Telegram API throws error or network timeout on part 2 of 3 | DB deletion already committed; error is caught and logged as warning; returns partial `deletedMessageIds` containing part 1 without throwing uncaught exception. |
| 8 | `bulkToggleTeacherNotes` | Database has 0 teacher notes files | DB update updates 0 rows; returns `count: 0`; does not alter NCERT or PPT files; no error thrown. |
| 9 | `toggleFilePublished` | Non-existent `fileId` provided | DB update returns empty/error; function throws informative error `File {id} not found`. |
| 10 | `getChaptersWithFiles` | Filter combination yields 0 matches (e.g. Class 6 + Economics) | Returns empty array `[]`; Admin UI renders friendly empty state with "Reset Filters" action. |
| 11 | `getChaptersWithFiles` | `publishedOnly: true` filter applied | Chapters are retained, but nested `files` array excludes all files where `is_published === false`. If a chapter has only hidden files, chapter appears with empty `files: []`. |
| 12 | Admin UI Filter Bar | User selects "Hidden Only" status filter | Client-side filter or API filter displays only chapters containing hidden files, and shows hidden files clearly highlighted with amber badges. |
| 13 | Admin UI Session | Admin session expires while user is browsing `/admin` | Mutating requests (toggle, rename, delete) receive HTTP 401; dashboard displays error alert and redirects user to `/admin/login?from=/admin`. |
| 14 | Admin UI Mutating Requests | Mutating request sent with bad or missing Origin header | Edge middleware intercepts with HTTP 403 Forbidden; UI prevents unhandled crash and informs user of origin validation failure. |
| 15 | Admin UI File Size Display | Files of varying sizes (e.g. 150 bytes vs 19 MiB vs 45 MB) | Formatted cleanly: `< 1 KB` -> `150 B`, `< 1 MB` -> `XXX KB`, `>= 1 MB` -> `X.XX MB`. |

---

## 4. Architecture & Interface Specifications

### 4.1 Data Contracts & Endpoints

#### `GET /api/admin/library`
- **Authentication**: Required (`admin_session` cookie).
- **Query Parameters**:
  - `class`: number (optional, 6-10)
  - `subject`: string (optional, "History" | "Geography" | "Civics" | "Economics")
  - `kind`: string (optional, "ncert_pdf" | "ppt" | "ppt_pdf" | "teacher_notes")
  - `published`: "true" | "false" | "all" (optional)
- **Response**:
  ```json
  {
    "chapters": [
      {
        "id": "uuid",
        "class": 9,
        "subject": "Economics",
        "chapter_no": 1,
        "title": "The Story of Village Palampur",
        "files": [
          {
            "id": "file-uuid",
            "chapter_id": "uuid",
            "kind": "ncert_pdf",
            "file_name": "The-Story-of-Village-Palampur_Class9_Economics_Ch01_NCERT.pdf",
            "size_bytes": 12500000,
            "part_count": 1,
            "mime": "application/pdf",
            "sha256": "...",
            "is_published": true
          }
        ]
      }
    ]
  }
  ```

#### `PATCH /api/admin/library/[id]`
- **Authentication & Origin**: Required.
- **Request Body**:
  ```json
  { "is_published": boolean }
  ```
- **Response**:
  ```json
  { "success": true, "file": { "id": "uuid", "is_published": boolean } }
  ```

#### `DELETE /api/admin/library/[id]`
- **Authentication & Origin**: Required.
- **Response**:
  ```json
  { "success": true, "deletedFileId": "uuid", "deletedMessageIds": [101, 102] }
  ```

#### `PATCH /api/admin/library/chapter/[id]`
- **Authentication & Origin**: Required.
- **Request Body**:
  ```json
  { "title": "New Chapter Title" }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "chapter": { "id": "uuid", "title": "New Chapter Title", ... },
    "updatedFilesCount": 3
  }
  ```

#### `POST /api/admin/library/bulk-toggle`
- **Authentication & Origin**: Required.
- **Request Body**:
  ```json
  { "is_published": boolean }
  ```
- **Response**:
  ```json
  { "success": true, "count": 5, "is_published": boolean }
  ```

---

## 5. Implementation Code Proposals

### 5.1 Enhanced `src/lib/catalog.ts` (`renameChapter` Cascade Fix)

Below is the exact required modification to `src/lib/catalog.ts` to implement the cascade rename with `buildFileName`:

```typescript
// Add import at the top of src/lib/catalog.ts
import { buildFileName } from "./naming";

/**
 * Renames chapter title and cascade updates all dependent file names in Supabase.
 */
export async function renameChapter(
  chapterId: string,
  newTitle: string
): Promise<{ updatedChapter: Chapter; updatedFilesCount: number }> {
  const db = getDb();

  // 1. Update chapter record
  const { data: updatedChapter, error } = await db
    .from("chapters")
    .update({ title: newTitle })
    .eq("id", chapterId)
    .select()
    .single();

  if (error || !updatedChapter) {
    logger.error({ error, chapterId }, "Failed to rename chapter");
    throw error || new Error(`Chapter ${chapterId} not found`);
  }

  // 2. Fetch all associated files to cascade recalculate file names
  const { data: files, error: filesErr } = await db
    .from("files")
    .select("*")
    .eq("chapter_id", chapterId);

  if (filesErr) {
    logger.error({ filesErr, chapterId }, "Failed to fetch files during chapter rename cascade");
    throw filesErr;
  }

  let updatedCount = 0;
  if (files && files.length > 0) {
    for (const file of files) {
      const ext = file.file_name.includes(".")
        ? file.file_name.split(".").pop() || "pdf"
        : "pdf";

      const newFileName = buildFileName({
        class: updatedChapter.class,
        subject: updatedChapter.subject,
        chapterNo: updatedChapter.chapter_no,
        title: newTitle,
        kind: file.kind,
        teacherName: file.teacher_name || undefined,
        ext,
      });

      const { error: updateFileErr } = await db
        .from("files")
        .update({ file_name: newFileName })
        .eq("id", file.id);

      if (updateFileErr) {
        logger.error(
          { updateFileErr, fileId: file.id },
          "Failed to update file_name during rename cascade"
        );
        throw updateFileErr;
      }
      updatedCount++;
    }
  }

  return {
    updatedChapter: updatedChapter as Chapter,
    updatedFilesCount: updatedCount,
  };
}
```

---

### 5.2 API Routes Implementation

#### `src/app/api/admin/library/route.ts`
```typescript
import { NextRequest, NextResponse } from "next/server";
import { getChaptersWithFiles } from "@/lib/catalog";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const classParam = searchParams.get("class");
    const subjectParam = searchParams.get("subject");
    const kindParam = searchParams.get("kind");
    const publishedParam = searchParams.get("published");

    const filters: {
      class?: number;
      subject?: string;
      kind?: string;
      publishedOnly?: boolean;
    } = {};

    if (classParam && classParam !== "all") {
      const parsedClass = parseInt(classParam, 10);
      if (!isNaN(parsedClass)) filters.class = parsedClass;
    }

    if (subjectParam && subjectParam !== "all") {
      filters.subject = subjectParam;
    }

    if (kindParam && kindParam !== "all") {
      filters.kind = kindParam;
    }

    if (publishedParam === "true") {
      filters.publishedOnly = true;
    }

    const chapters = await getChaptersWithFiles(filters);

    return NextResponse.json({ chapters }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "Error in GET /api/admin/library");
    return NextResponse.json({ error: "Failed to load library chapters" }, { status: 500 });
  }
}
```

#### `src/app/api/admin/library/[id]/route.ts`
```typescript
import { NextRequest, NextResponse } from "next/server";
import { toggleFilePublished, deleteFileWithTelegramCleanup } from "@/lib/catalog";
import { TelegramClient } from "@/lib/telegram";
import { validateOrigin } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateOrigin(req)) {
    return NextResponse.json({ error: "Forbidden: Invalid origin" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await req.json();

    if (typeof body.is_published !== "boolean") {
      return NextResponse.json(
        { error: "Field 'is_published' must be a boolean" },
        { status: 400 }
      );
    }

    const updated = await toggleFilePublished(id, body.is_published);
    return NextResponse.json({ success: true, file: updated }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "Error in PATCH /api/admin/library/[id]");
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateOrigin(req)) {
    return NextResponse.json({ error: "Forbidden: Invalid origin" }, { status: 403 });
  }

  try {
    const { id } = await params;

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const channelId = process.env.TELEGRAM_CHANNEL_ID;
    const tgClient = botToken ? new TelegramClient(botToken) : undefined;

    const result = await deleteFileWithTelegramCleanup(id, tgClient, channelId);

    return NextResponse.json(
      { success: true, deletedFileId: result.deletedFileId, deletedMessageIds: result.deletedMessageIds },
      { status: 200 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "Error in DELETE /api/admin/library/[id]");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

#### `src/app/api/admin/library/chapter/[id]/route.ts`
```typescript
import { NextRequest, NextResponse } from "next/server";
import { renameChapter } from "@/lib/catalog";
import { validateOrigin } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateOrigin(req)) {
    return NextResponse.json({ error: "Forbidden: Invalid origin" }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await req.json();

    if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json(
        { error: "Title must be a non-empty string" },
        { status: 400 }
      );
    }

    const result = await renameChapter(id, body.title.trim());
    return NextResponse.json(
      { success: true, chapter: result.updatedChapter, updatedFilesCount: result.updatedFilesCount },
      { status: 200 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "Error in PATCH /api/admin/library/chapter/[id]");
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
```

#### `src/app/api/admin/library/bulk-toggle/route.ts`
```typescript
import { NextRequest, NextResponse } from "next/server";
import { bulkToggleTeacherNotes } from "@/lib/catalog";
import { validateOrigin } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!validateOrigin(req)) {
    return NextResponse.json({ error: "Forbidden: Invalid origin" }, { status: 403 });
  }

  try {
    const body = await req.json();
    if (typeof body.is_published !== "boolean") {
      return NextResponse.json(
        { error: "Field 'is_published' must be a boolean" },
        { status: 400 }
      );
    }

    const count = await bulkToggleTeacherNotes(body.is_published);
    return NextResponse.json({ success: true, count, is_published: body.is_published }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "Error in POST /api/admin/library/bulk-toggle");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

---

### 5.3 Complete Admin Dashboard (`src/app/admin/page.tsx`)

A single, clean, cohesive Client Component with:
- Accessible interactive controls and clean modals.
- Instant optimistic toggle switches with auto-dismissing toast notifications.
- Accordion chapter cards with responsive layouts.
- Modal dialogs for chapter rename and permanent delete confirmation.
- Filter bar for Class, Subject, Kind, and Published status.
- Bulk actions bar for Teacher Notes visibility toggles and library statistics.
- Upload modal trigger for multipart uploads.
- Full loading, empty, and error fallback states.

*(See full source code presented in Section 6 below).*

---

### 5.4 Comprehensive Unit Test Suite (`tests/unit/catalog.test.ts`)

Directly tests `src/lib/catalog.ts` functions by mocking Supabase `getDb()` and `TelegramClient`.
Covers:
1. `getChaptersWithFiles` filtering (class, subject, kind, publishedOnly, mixed combinations).
2. `renameChapter` title update + `buildFileName` invocation for each file + `file_name` DB update.
3. `toggleFilePublished` switching published state true/false + error handling.
4. `bulkToggleTeacherNotes` updating only notes + returning correct count.
5. `deleteFileWithTelegramCleanup` fetching `tg_message_id`s, deleting DB rows, calling `tgClient.deleteMessage` for each ID, and handling Telegram error resilience.

*(See full source code presented in Section 7 below).*

---

## 6. Complete Proposed Code: `src/app/admin/page.tsx`

```tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChapterWithFiles, FileRecord } from "@/types/database";

interface ToastState {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

interface RenameModalState {
  isOpen: boolean;
  chapterId: string;
  chapterNo: number;
  classNum: number;
  subject: string;
  currentTitle: string;
  newTitle: string;
  saving: boolean;
  error?: string | null;
}

interface DeleteModalState {
  isOpen: boolean;
  fileId: string;
  fileName: string;
  partCount: number;
  deleting: boolean;
  error?: string | null;
}

export default function AdminDashboardPage() {
  const router = useRouter();

  // Data & Lifecycle
  const [chapters, setChapters] = useState<ChapterWithFiles[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedClass, setSelectedClass] = useState<string>("all");
  const [selectedSubject, setSelectedSubject] = useState<string>("all");
  const [selectedKind, setSelectedKind] = useState<string>("all");
  const [publishedStatus, setPublishedStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Accordion open/close state
  const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>({});

  // Modals & Actions
  const [renameModal, setRenameModal] = useState<RenameModalState>({
    isOpen: false,
    chapterId: "",
    chapterNo: 0,
    classNum: 0,
    subject: "",
    currentTitle: "",
    newTitle: "",
    saving: false,
  });

  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({
    isOpen: false,
    fileId: "",
    fileName: "",
    partCount: 1,
    deleting: false,
  });

  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [toasts, setToasts] = useState<ToastState[]>([]);

  // Toast Helper
  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  // Fetch Library Catalog
  const fetchLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/library", {
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        if (res.status === 401) {
          router.push("/admin/login?from=/admin");
          return;
        }
        throw new Error(`Failed to load catalog (${res.status})`);
      }

      const data = await res.json();
      const loaded: ChapterWithFiles[] = data.chapters || [];
      setChapters(loaded);

      // Default expand all loaded chapters
      const expandedMap: Record<string, boolean> = {};
      loaded.forEach((c) => {
        expandedMap[c.id] = true;
      });
      setExpandedChapters(expandedMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error connecting to server");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  // Handle Logout
  async function handleLogout() {
    try {
      await fetch("/api/admin/logout", {
        method: "POST",
        headers: { origin: window.location.origin },
      });
      router.push("/admin/login");
      router.refresh();
    } catch {
      router.push("/admin/login");
    }
  }

  // Toggle Single File Visibility
  async function handleToggleFile(fileId: string, currentPublished: boolean) {
    const nextPublished = !currentPublished;

    // Optimistic UI update
    setChapters((prev) =>
      prev.map((c) => ({
        ...c,
        files: (c.files || []).map((f) =>
          f.id === fileId ? { ...f, is_published: nextPublished } : f
        ),
      }))
    );

    try {
      const res = await fetch(`/api/admin/library/${fileId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          origin: window.location.origin,
        },
        body: JSON.stringify({ is_published: nextPublished }),
      });

      if (!res.ok) {
        throw new Error("Failed to update visibility");
      }

      showToast(
        nextPublished ? "File published to student library" : "File hidden from student library",
        "success"
      );
    } catch (err) {
      // Revert optimistic update
      setChapters((prev) =>
        prev.map((c) => ({
          ...c,
          files: (c.files || []).map((f) =>
            f.id === fileId ? { ...f, is_published: currentPublished } : f
          ),
        }))
      );
      showToast(err instanceof Error ? err.message : "Failed to toggle visibility", "error");
    }
  }

  // Bulk Toggle Teacher Notes
  async function handleBulkToggleNotes(publish: boolean) {
    if (bulkProcessing) return;
    setBulkProcessing(true);

    try {
      const res = await fetch("/api/admin/library/bulk-toggle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: window.location.origin,
        },
        body: JSON.stringify({ is_published: publish }),
      });

      if (!res.ok) {
        throw new Error("Bulk update failed");
      }

      const data = await res.json();
      showToast(
        `Successfully ${publish ? "published" : "hid"} ${data.count} teacher notes files.`,
        "success"
      );
      await fetchLibrary();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Bulk action failed", "error");
    } finally {
      setBulkProcessing(false);
    }
  }

  // Rename Chapter Submission
  async function submitRenameChapter(e: React.FormEvent) {
    e.preventDefault();
    if (!renameModal.newTitle.trim() || renameModal.saving) return;

    setRenameModal((prev) => ({ ...prev, saving: true, error: null }));

    try {
      const res = await fetch(`/api/admin/library/chapter/${renameModal.chapterId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          origin: window.location.origin,
        },
        body: JSON.stringify({ title: renameModal.newTitle.trim() }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to rename chapter");
      }

      const data = await res.json();
      showToast(
        `Renamed chapter title. ${data.updatedFilesCount} dependent file(s) updated.`,
        "success"
      );

      setRenameModal((prev) => ({ ...prev, isOpen: false, saving: false }));
      await fetchLibrary();
    } catch (err) {
      setRenameModal((prev) => ({
        ...prev,
        saving: false,
        error: err instanceof Error ? err.message : "Failed to rename chapter",
      }));
    }
  }

  // Confirm File Deletion
  async function submitDeleteFile() {
    if (deleteModal.deleting) return;
    setDeleteModal((prev) => ({ ...prev, deleting: true, error: null }));

    try {
      const res = await fetch(`/api/admin/library/${deleteModal.fileId}`, {
        method: "DELETE",
        headers: {
          origin: window.location.origin,
        },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to delete file");
      }

      const data = await res.json();
      const purgedCount = data.deletedMessageIds?.length || 0;
      showToast(
        `Deleted file and purged ${purgedCount} Telegram chunk part(s).`,
        "success"
      );

      setDeleteModal((prev) => ({ ...prev, isOpen: false, deleting: false }));
      await fetchLibrary();
    } catch (err) {
      setDeleteModal((prev) => ({
        ...prev,
        deleting: false,
        error: err instanceof Error ? err.message : "Failed to delete file",
      }));
    }
  }

  // Filtered Chapters & Files
  const filteredChapters = useMemo(() => {
    return chapters
      .filter((chapter) => {
        if (selectedClass !== "all" && chapter.class !== Number(selectedClass)) return false;
        if (selectedSubject !== "all" && chapter.subject !== selectedSubject) return false;

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchesTitle = chapter.title.toLowerCase().includes(q);
          const matchesFiles = (chapter.files || []).some((f) =>
            f.file_name.toLowerCase().includes(q)
          );
          if (!matchesTitle && !matchesFiles) return false;
        }

        return true;
      })
      .map((chapter) => {
        let files = chapter.files || [];

        if (selectedKind !== "all") {
          files = files.filter((f) => f.kind === selectedKind);
        }

        if (publishedStatus === "published") {
          files = files.filter((f) => f.is_published);
        } else if (publishedStatus === "hidden") {
          files = files.filter((f) => !f.is_published);
        }

        return { ...chapter, files };
      })
      .filter((chapter) => {
        // If specific kind or published status is filtered, only show chapter if it has matching files
        if (selectedKind !== "all" || publishedStatus !== "all") {
          return chapter.files.length > 0;
        }
        return true;
      });
  }, [chapters, selectedClass, selectedSubject, selectedKind, publishedStatus, searchQuery]);

  // Overall Statistics
  const stats = useMemo(() => {
    let totalFiles = 0;
    let publishedFiles = 0;
    let totalBytes = 0;
    let teacherNotesCount = 0;

    chapters.forEach((c) => {
      (c.files || []).forEach((f) => {
        totalFiles++;
        if (f.is_published) publishedFiles++;
        totalBytes += f.size_bytes || 0;
        if (f.kind === "teacher_notes") teacherNotesCount++;
      });
    });

    return {
      chaptersCount: chapters.length,
      totalFiles,
      publishedFiles,
      hiddenFiles: totalFiles - publishedFiles,
      totalMb: (totalBytes / (1024 * 1024)).toFixed(1),
      teacherNotesCount,
    };
  }, [chapters]);

  // Helper Formatters
  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function getSubjectColor(subject: string) {
    switch (subject.toLowerCase()) {
      case "history":
        return "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800";
      case "geography":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800";
      case "civics":
        return "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 border-sky-200 dark:border-sky-800";
      case "economics":
        return "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-200 dark:border-purple-800";
      default:
        return "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700";
    }
  }

  function getKindBadge(kind: string, teacherName?: string | null) {
    switch (kind) {
      case "ncert_pdf":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            NCERT
          </span>
        );
      case "ppt":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
            PPT
          </span>
        );
      case "ppt_pdf":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
            PPT Preview
          </span>
        );
      case "teacher_notes":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
            Notes{teacherName ? `: ${teacherName}` : ""}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {kind}
          </span>
        );
    }
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Notification Container */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-md w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto p-3.5 rounded-lg shadow-lg border text-sm flex items-center gap-3 transition-all animate-in slide-in-from-bottom-5 ${
              toast.type === "success"
                ? "bg-[var(--card-bg)] text-[var(--foreground)] border-emerald-500/40"
                : toast.type === "error"
                ? "bg-[var(--card-bg)] text-red-600 dark:text-red-400 border-red-500/40"
                : "bg-[var(--card-bg)] text-[var(--foreground)] border-[var(--border-color)]"
            }`}
          >
            {toast.type === "success" && (
              <svg className="w-5 h-5 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            )}
            {toast.type === "error" && (
              <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            <span className="font-medium text-xs sm:text-sm">{toast.message}</span>
          </div>
        ))}
      </div>

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--foreground)]">
              Library Management
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
              Admin Session Active
            </span>
          </div>
          <p className="text-xs sm:text-sm text-[var(--muted)] mt-1">
            Organize NCERT chapters, cascade renames, manage Telegram chunks, and control student access.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Link
            href="/"
            className="px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            Student View &rarr;
          </Link>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-medium transition-colors cursor-pointer"
          >
            Log Out
          </button>
        </div>
      </div>

      {/* Library Summary Statistics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xs">
          <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Chapters</p>
          <p className="text-2xl font-bold text-[var(--foreground)] mt-1">{stats.chaptersCount}</p>
        </div>
        <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xs">
          <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Total Files</p>
          <p className="text-2xl font-bold text-[var(--foreground)] mt-1">{stats.totalFiles}</p>
        </div>
        <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xs">
          <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Published / Hidden</p>
          <p className="text-2xl font-bold text-[var(--foreground)] mt-1">
            <span className="text-emerald-600 dark:text-emerald-400">{stats.publishedFiles}</span>
            <span className="text-[var(--muted)] font-normal text-lg"> / {stats.hiddenFiles}</span>
          </p>
        </div>
        <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xs">
          <p className="text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Storage Size</p>
          <p className="text-2xl font-bold text-[var(--foreground)] mt-1">{stats.totalMb} MB</p>
        </div>
      </div>

      {/* Bulk Action & Controls Bar */}
      <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--foreground)]">Bulk Actions</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Rapidly toggle entire sets of supplemental materials across classes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleBulkToggleNotes(true)}
            disabled={bulkProcessing || stats.teacherNotesCount === 0}
            className="px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-xs font-medium hover:bg-emerald-50 dark:hover:bg-emerald-950/30 hover:border-emerald-300 text-[var(--foreground)] transition-colors cursor-pointer disabled:opacity-50"
          >
            Publish All Teacher Notes ({stats.teacherNotesCount})
          </button>
          <button
            onClick={() => handleBulkToggleNotes(false)}
            disabled={bulkProcessing || stats.teacherNotesCount === 0}
            className="px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-xs font-medium hover:bg-amber-50 dark:hover:bg-amber-950/30 hover:border-amber-300 text-[var(--foreground)] transition-colors cursor-pointer disabled:opacity-50"
          >
            Hide All Teacher Notes
          </button>
          <button
            onClick={fetchLibrary}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 text-[var(--muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
            title="Refresh Catalog"
          >
            &#x21bb; Refresh
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Filter Catalog</span>
          {(selectedClass !== "all" ||
            selectedSubject !== "all" ||
            selectedKind !== "all" ||
            publishedStatus !== "all" ||
            searchQuery.trim() !== "") && (
            <button
              onClick={() => {
                setSelectedClass("all");
                setSelectedSubject("all");
                setSelectedKind("all");
                setPublishedStatus("all");
                setSearchQuery("");
              }}
              className="text-xs text-[var(--accent)] hover:underline cursor-pointer"
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
          {/* Class Filter */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Class</label>
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-xs text-[var(--foreground)] focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
            >
              <option value="all">All Classes</option>
              <option value="6">Class 6</option>
              <option value="7">Class 7</option>
              <option value="8">Class 8</option>
              <option value="9">Class 9</option>
              <option value="10">Class 10</option>
            </select>
          </div>

          {/* Subject Filter */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Subject</label>
            <select
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-xs text-[var(--foreground)] focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
            >
              <option value="all">All Subjects</option>
              <option value="History">History</option>
              <option value="Geography">Geography</option>
              <option value="Civics">Civics</option>
              <option value="Economics">Economics</option>
            </select>
          </div>

          {/* Kind Filter */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Kind</label>
            <select
              value={selectedKind}
              onChange={(e) => setSelectedKind(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-xs text-[var(--foreground)] focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
            >
              <option value="all">All Kinds</option>
              <option value="ncert_pdf">NCERT Textbook</option>
              <option value="ppt">Presentation (PPT)</option>
              <option value="ppt_pdf">PPT Preview (PDF)</option>
              <option value="teacher_notes">Teacher Notes</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Status</label>
            <select
              value={publishedStatus}
              onChange={(e) => setPublishedStatus(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-xs text-[var(--foreground)] focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
            >
              <option value="all">All Status</option>
              <option value="published">Published Only</option>
              <option value="hidden">Hidden Only</option>
            </select>
          </div>

          {/* Search Bar */}
          <div>
            <label className="block text-xs font-medium text-[var(--muted)] mb-1">Search</label>
            <input
              type="text"
              placeholder="Title or filename..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-xs text-[var(--foreground)] placeholder-[var(--muted)] focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)]"
            />
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <span>{error}</span>
          </div>
          <button
            onClick={fetchLibrary}
            className="px-3 py-1 rounded bg-red-100 dark:bg-red-900/50 hover:bg-red-200 font-medium text-xs cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeletons */}
      {loading && chapters.length === 0 && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-5 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] animate-pulse">
              <div className="h-5 bg-black/10 dark:bg-white/10 rounded w-1/3 mb-4"></div>
              <div className="space-y-2">
                <div className="h-10 bg-black/5 dark:bg-white/5 rounded"></div>
                <div className="h-10 bg-black/5 dark:bg-white/5 rounded"></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredChapters.length === 0 && (
        <div className="p-10 rounded-xl border border-dashed border-[var(--border-color)] bg-[var(--card-bg)] text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] mb-3">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-[var(--foreground)]">No Matching Chapters or Files</h3>
          <p className="text-xs text-[var(--muted)] mt-1 max-w-sm mx-auto">
            {chapters.length === 0
              ? "The database is empty. Upload your first NCERT chapter using the sequential chunk engine."
              : "No materials match your active filter settings. Try resetting filters or searching for another keyword."}
          </p>
        </div>
      )}

      {/* Chapter Cards / Accordion */}
      {!loading && filteredChapters.length > 0 && (
        <div className="space-y-4">
          {filteredChapters.map((chapter) => {
            const isExpanded = expandedChapters[chapter.id] !== false;
            const files = chapter.files || [];

            return (
              <div
                key={chapter.id}
                className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xs overflow-hidden transition-all"
              >
                {/* Chapter Card Header */}
                <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-color)] bg-black/[0.01] dark:bg-white/[0.01]">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="px-2 py-0.5 rounded text-xs font-bold border bg-black/5 dark:bg-white/5">
                      Class {chapter.class}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-semibold border ${getSubjectColor(chapter.subject)}`}
                    >
                      {chapter.subject}
                    </span>
                    <span className="text-xs font-medium text-[var(--muted)]">
                      Ch {chapter.chapter_no}
                    </span>
                    <h3 className="text-sm sm:text-base font-bold text-[var(--foreground)] tracking-tight">
                      {chapter.title}
                    </h3>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-[var(--muted)] font-medium">
                      {files.length} file{files.length === 1 ? "" : "s"}
                    </span>

                    {/* Rename Trigger Button */}
                    <button
                      onClick={() =>
                        setRenameModal({
                          isOpen: true,
                          chapterId: chapter.id,
                          chapterNo: chapter.chapter_no,
                          classNum: chapter.class,
                          subject: chapter.subject,
                          currentTitle: chapter.title,
                          newTitle: chapter.title,
                          saving: false,
                          error: null,
                        })
                      }
                      className="px-2.5 py-1 rounded-md border border-[var(--border-color)] hover:border-[var(--accent)] text-xs font-medium text-[var(--foreground)] hover:text-[var(--accent)] transition-colors cursor-pointer flex items-center gap-1"
                      title="Rename chapter and cascade update filenames"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                        />
                      </svg>
                      Rename
                    </button>

                    {/* Expand/Collapse Chevron */}
                    <button
                      onClick={() =>
                        setExpandedChapters((prev) => ({
                          ...prev,
                          [chapter.id]: !isExpanded,
                        }))
                      }
                      className="p-1 rounded text-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer"
                      aria-label={isExpanded ? "Collapse chapter" : "Expand chapter"}
                    >
                      <svg
                        className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Chapter Files Table / List */}
                {isExpanded && (
                  <div className="p-0">
                    {files.length === 0 ? (
                      <div className="p-6 text-center text-xs text-[var(--muted)]">
                        No materials attached to this chapter matching current filters.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.02] text-[var(--muted)] font-medium">
                              <th className="py-2.5 px-4">File Name</th>
                              <th className="py-2.5 px-3">Kind</th>
                              <th className="py-2.5 px-3">Size</th>
                              <th className="py-2.5 px-3">Parts</th>
                              <th className="py-2.5 px-3">Visibility</th>
                              <th className="py-2.5 px-4 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border-color)]">
                            {files.map((file: FileRecord) => (
                              <tr
                                key={file.id}
                                className="hover:bg-black/[0.015] dark:hover:bg-white/[0.015] transition-colors"
                              >
                                {/* File Name */}
                                <td className="py-3 px-4 font-mono text-[11px] text-[var(--foreground)] max-w-xs sm:max-w-md truncate">
                                  {file.file_name}
                                </td>

                                {/* Kind */}
                                <td className="py-3 px-3 whitespace-nowrap">
                                  {getKindBadge(file.kind, file.teacher_name)}
                                </td>

                                {/* Size */}
                                <td className="py-3 px-3 whitespace-nowrap text-[var(--muted)]">
                                  {formatBytes(file.size_bytes)}
                                </td>

                                {/* Part Count */}
                                <td className="py-3 px-3 whitespace-nowrap text-[var(--muted)]">
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5 font-mono text-[10px]">
                                    {file.part_count} {file.part_count === 1 ? "chunk" : "chunks"}
                                  </span>
                                </td>

                                {/* Published Toggle Switch */}
                                <td className="py-3 px-3 whitespace-nowrap">
                                  <label className="relative inline-flex items-center cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={file.is_published}
                                      onChange={() => handleToggleFile(file.id, file.is_published)}
                                      className="sr-only peer"
                                      aria-label={`Toggle visibility for ${file.file_name}`}
                                    />
                                    <div className="w-8 h-4 bg-gray-300 dark:bg-gray-700 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[var(--accent)]"></div>
                                    <span className="ml-2 text-[11px] font-medium text-[var(--muted)]">
                                      {file.is_published ? (
                                        <span className="text-emerald-600 dark:text-emerald-400">Published</span>
                                      ) : (
                                        <span className="text-amber-600 dark:text-amber-400">Hidden</span>
                                      )}
                                    </span>
                                  </label>
                                </td>

                                {/* Actions */}
                                <td className="py-3 px-4 text-right whitespace-nowrap">
                                  <button
                                    onClick={() =>
                                      setDeleteModal({
                                        isOpen: true,
                                        fileId: file.id,
                                        fileName: file.file_name,
                                        partCount: file.part_count,
                                        deleting: false,
                                        error: null,
                                      })
                                    }
                                    className="p-1 rounded text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                                    title="Delete file and clean up Telegram messages"
                                  >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                      />
                                    </svg>
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Rename Chapter Modal */}
      {renameModal.isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in"
        >
          <div className="w-full max-w-lg p-6 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xl space-y-4">
            <div>
              <h3 className="text-lg font-bold text-[var(--foreground)]">Rename Chapter</h3>
              <p className="text-xs text-[var(--muted)] mt-1">
                Class {renameModal.classNum} &bull; {renameModal.subject} &bull; Chapter {renameModal.chapterNo}
              </p>
            </div>

            <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300 text-xs">
              <span className="font-semibold">Cascade Warning:</span> Renaming this title recalculates the standardized
              deterministic filenames for all attached files in this chapter according to the auto-naming rule.
            </div>

            {renameModal.error && (
              <div className="p-2.5 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs">
                {renameModal.error}
              </div>
            )}

            <form onSubmit={submitRenameChapter} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                  New Chapter Title
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  disabled={renameModal.saving}
                  value={renameModal.newTitle}
                  onChange={(e) => setRenameModal((prev) => ({ ...prev, newTitle: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-sm text-[var(--foreground)] focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={renameModal.saving}
                  onClick={() => setRenameModal((prev) => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={renameModal.saving || !renameModal.newTitle.trim()}
                  className="px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                >
                  {renameModal.saving ? "Saving Cascade..." : "Save & Recalculate"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal.isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-in fade-in"
        >
          <div className="w-full max-w-md p-6 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-xl space-y-4">
            <div>
              <h3 className="text-lg font-bold text-red-600 dark:text-red-400">Permanently Delete File</h3>
              <p className="text-xs text-[var(--muted)] mt-1">
                Are you sure you want to remove this file from the library?
              </p>
            </div>

            <div className="p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 text-xs space-y-1">
              <p className="font-semibold break-all">{deleteModal.fileName}</p>
              <p className="text-[11px] opacity-90">
                This operation will delete database records and immediately purge all {deleteModal.partCount} chunk message(s) from the private Telegram channel to prevent storage leaks.
              </p>
            </div>

            {deleteModal.error && (
              <div className="p-2.5 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs">
                {deleteModal.error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={deleteModal.deleting}
                onClick={() => setDeleteModal((prev) => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteModal.deleting}
                onClick={submitDeleteFile}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                {deleteModal.deleting ? "Purging Telegram..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## 7. Complete Proposed Code: `tests/unit/catalog.test.ts`

```typescript
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
import { Chapter, FileRecord } from "@/types/database";

describe("Milestone M4: Catalog Data Service & Admin Management (tests/unit/catalog.test.ts)", () => {
  // In-memory data store for Supabase client simulation
  let mockChapters: Chapter[];
  let mockFiles: FileRecord[];
  let mockFileParts: Array<{
    file_id: string;
    part_no: number;
    tg_message_id: number;
  }>;

  // Mock Telegram Client
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
        created_at: new Date().toISOString(),
      },
      {
        id: "chap-hist-1",
        class: 10,
        subject: "History",
        chapter_no: 1,
        title: "Rise of Nationalism",
        created_at: new Date().toISOString(),
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
      },
      {
        id: "file-econ-notes",
        chapter_id: "chap-econ-1",
        kind: "teacher_notes",
        teacher_name: "Sharma",
        file_name: "Village-Palampur_Class9_Economics_Ch01_Notes-Sharma.pdf",
        size_bytes: 2048,
        part_count: 1,
        mime: "application/pdf",
        sha256: "sha_econ_notes",
        is_published: true,
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
      },
    ];

    mockFileParts = [
      { file_id: "file-econ-ncert", part_no: 1, tg_message_id: 1001 },
      { file_id: "file-econ-notes", part_no: 1, tg_message_id: 1002 },
      { file_id: "file-hist-ppt", part_no: 1, tg_message_id: 2001 },
      { file_id: "file-hist-ppt", part_no: 2, tg_message_id: 2002 },
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
        let currentKindFilter: string | null = null;
        let currentEqField: string | null = null;
        let currentEqValue: any = null;
        let updatePayload: any = null;
        let isDelete = false;

        const chain = {
          select: vi.fn((_cols?: string) => chain),
          order: vi.fn((_col: string, _opts?: any) => chain),
          eq: vi.fn((field: string, val: any) => {
            currentEqField = field;
            currentEqValue = val;
            if (field === "class") currentClassFilter = val;
            if (field === "subject") currentSubjectFilter = val;
            if (field === "kind") currentKindFilter = val;
            return chain;
          }),
          update: vi.fn((payload: any) => {
            updatePayload = payload;
            return chain;
          }),
          delete: vi.fn(() => {
            isDelete = true;
            return chain;
          }),
          single: vi.fn(async () => {
            if (table === "chapters") {
              const ch = mockChapters.find((c) => c.id === currentEqValue);
              if (!ch) return { data: null, error: new Error("Chapter not found") };
              if (updatePayload) {
                Object.assign(ch, updatePayload);
              }
              return { data: { ...ch }, error: null };
            }
            if (table === "files") {
              const f = mockFiles.find((file) => file.id === currentEqValue);
              if (!f) return { data: null, error: new Error("File not found") };
              if (updatePayload) {
                Object.assign(f, updatePayload);
              }
              return { data: { ...f }, error: null };
            }
            return { data: null, error: null };
          }),
          maybeSingle: vi.fn(async () => chain.single()),
          then: (resolve: any) => {
            if (table === "chapters") {
              let result = [...mockChapters];
              if (currentClassFilter !== null) {
                result = result.filter((c) => c.class === currentClassFilter);
              }
              if (currentSubjectFilter !== null) {
                result = result.filter((c) => c.subject === currentSubjectFilter);
              }
              const withFiles = result.map((c) => ({
                ...c,
                files: mockFiles.filter((f) => f.chapter_id === c.id),
              }));
              return Promise.resolve({ data: withFiles, error: null }).then(resolve);
            }

            if (table === "files") {
              if (isDelete && currentEqField === "id") {
                const idx = mockFiles.findIndex((f) => f.id === currentEqValue);
                if (idx !== -1) mockFiles.splice(idx, 1);
                return Promise.resolve({ data: null, error: null }).then(resolve);
              }

              if (updatePayload && currentEqField === "kind") {
                // Bulk update
                let affected: any[] = [];
                mockFiles.forEach((f) => {
                  if (f.kind === currentEqValue) {
                    Object.assign(f, updatePayload);
                    affected.push({ id: f.id });
                  }
                });
                return Promise.resolve({ data: affected, error: null }).then(resolve);
              }

              if (updatePayload && currentEqField === "id") {
                const f = mockFiles.find((file) => file.id === currentEqValue);
                if (f) Object.assign(f, updatePayload);
                return Promise.resolve({ data: f, error: null }).then(resolve);
              }

              let res = [...mockFiles];
              if (currentEqField === "chapter_id") {
                res = res.filter((f) => f.chapter_id === currentEqValue);
              }
              return Promise.resolve({ data: res, error: null }).then(resolve);
            }

            if (table === "file_parts") {
              let res = [...mockFileParts];
              if (currentEqField === "file_id") {
                res = res.filter((p) => p.file_id === currentEqValue);
              }
              return Promise.resolve({ data: res, error: null }).then(resolve);
            }

            return Promise.resolve({ data: [], error: null }).then(resolve);
          },
        };

        return chain;
      }),
    };

    vi.spyOn(dbModule, "getDb").mockReturnValue(mockDb as any);
  });

  // ==========================================================================
  // 1. getChaptersWithFiles Filtering
  // ==========================================================================
  describe("getChaptersWithFiles", () => {
    it("retrieves all chapters with nested files without filters", async () => {
      const res = await getChaptersWithFiles();
      expect(res.length).toBe(2);
      const econ = res.find((c) => c.subject === "Economics");
      expect(econ?.files.length).toBe(2);
      const hist = res.find((c) => c.subject === "History");
      expect(hist?.files.length).toBe(1);
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

    it("filters nested files by kind (e.g. ncert_pdf)", async () => {
      const res = await getChaptersWithFiles({ kind: "ncert_pdf" });
      const econ = res.find((c) => c.id === "chap-econ-1");
      expect(econ?.files.length).toBe(1);
      expect(econ?.files[0].kind).toBe("ncert_pdf");

      const hist = res.find((c) => c.id === "chap-hist-1");
      expect(hist?.files.length).toBe(0); // PPT filtered out
    });

    it("filters nested files by publishedOnly", async () => {
      const res = await getChaptersWithFiles({ publishedOnly: true });
      const hist = res.find((c) => c.id === "chap-hist-1");
      // History PPT is is_published: false -> excluded
      expect(hist?.files.length).toBe(0);

      const econ = res.find((c) => c.id === "chap-econ-1");
      // Economics has 2 published files
      expect(econ?.files.length).toBe(2);
    });

    it("handles combined class, subject, and kind filters", async () => {
      const res = await getChaptersWithFiles({
        class: 9,
        subject: "Economics",
        kind: "teacher_notes",
      });
      expect(res.length).toBe(1);
      expect(res[0].files.length).toBe(1);
      expect(res[0].files[0].kind).toBe("teacher_notes");
      expect(res[0].files[0].teacher_name).toBe("Sharma");
    });

    it("returns empty array when filter criteria matches nothing", async () => {
      const res = await getChaptersWithFiles({ class: 6 });
      expect(res.length).toBe(0);
    });
  });

  // ==========================================================================
  // 2. renameChapter Title Update & buildFileName Cascade
  // ==========================================================================
  describe("renameChapter", () => {
    it("updates chapter title and recalculates filename for every associated file", async () => {
      const newTitle = "The Story of Village Palampur";
      const { updatedChapter, updatedFilesCount } = await renameChapter(
        "chap-econ-1",
        newTitle
      );

      expect(updatedChapter.title).toBe(newTitle);
      expect(updatedFilesCount).toBe(2);

      // Verify files in DB had their file_name recalculated via buildFileName
      const ncertFile = mockFiles.find((f) => f.id === "file-econ-ncert");
      expect(ncertFile?.file_name).toBe(
        "The-Story-of-Village-Palampur_Class9_Economics_Ch01_NCERT.pdf"
      );

      const notesFile = mockFiles.find((f) => f.id === "file-econ-notes");
      expect(notesFile?.file_name).toBe(
        "The-Story-of-Village-Palampur_Class9_Economics_Ch01_Notes-Sharma.pdf"
      );
    });

    it("handles chapter with 0 files gracefully", async () => {
      mockChapters.push({
        id: "chap-empty",
        class: 8,
        subject: "Civics",
        chapter_no: 3,
        title: "Parliament",
      });

      const { updatedChapter, updatedFilesCount } = await renameChapter(
        "chap-empty",
        "The Indian Parliament"
      );

      expect(updatedChapter.title).toBe("The Indian Parliament");
      expect(updatedFilesCount).toBe(0);
    });

    it("throws when renaming a non-existent chapter", async () => {
      await expect(
        renameChapter("non-existent-id", "Some Title")
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
      expect(affectedCount).toBe(1);

      const notes = mockFiles.find((f) => f.id === "file-econ-notes");
      expect(notes?.is_published).toBe(false);

      // NCERT remains published!
      const ncert = mockFiles.find((f) => f.id === "file-econ-ncert");
      expect(ncert?.is_published).toBe(true);
    });

    it("bulk publishes all teacher notes", async () => {
      // Set to false first
      const notes = mockFiles.find((f) => f.id === "file-econ-notes");
      notes!.is_published = false;

      const affectedCount = await bulkToggleTeacherNotes(true);
      expect(affectedCount).toBe(1);
      expect(notes?.is_published).toBe(true);
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

      // Verify DB row deleted
      const found = mockFiles.find((f) => f.id === targetFileId);
      expect(found).toBeUndefined();
    });

    it("handles single-part file deletion cleanly", async () => {
      const targetFileId = "file-econ-ncert"; // Message 1001

      const result = await deleteFileWithTelegramCleanup(
        targetFileId,
        mockTgClient,
        "-1001234567890"
      );

      expect(result.deletedMessageIds).toEqual([1001]);
      expect(deletedTgMessages).toContain(1001);
      expect(mockFiles.find((f) => f.id === targetFileId)).toBeUndefined();
    });

    it("handles deletion when Telegram client is omitted (offline or test fallback)", async () => {
      const targetFileId = "file-econ-notes";

      const result = await deleteFileWithTelegramCleanup(targetFileId);
      expect(result.deletedFileId).toBe(targetFileId);
      expect(result.deletedMessageIds.length).toBe(0);
      expect(mockFiles.find((f) => f.id === targetFileId)).toBeUndefined();
    });

    it("survives partial Telegram deletion network error without failing DB cleanup", async () => {
      const failingTgClient = {
        deleteMessage: vi.fn(async (_ch: any, msgId: number) => {
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
      // Database file is still cleanly deleted
      expect(mockFiles.find((f) => f.id === "file-hist-ppt")).toBeUndefined();
    });
  });
});
```

---

## 8. Verification Strategy & Acceptance Criteria

| Criteria | Verification Method | Pass Condition |
|----------|---------------------|----------------|
| `getChaptersWithFiles` filters | `npx vitest run tests/unit/catalog.test.ts` | Filter queries correctly slice chapters & files by class, subject, kind, and published status. |
| `renameChapter` cascade | `npx vitest run tests/unit/catalog.test.ts` | Chapter title is updated; `buildFileName` is invoked for each file; updated `file_name` saved to DB. |
| Visibility toggles | `npx vitest run tests/unit/catalog.test.ts` | Single file toggles and bulk teacher notes toggles mutate `is_published` correctly. |
| Delete & Telegram cleanup | `npx vitest run tests/unit/catalog.test.ts` | All `tg_message_id`s purged via `tgClient.deleteMessage`; DB row removed. |
| Admin UI Dashboard Layout | Inspect `src/app/admin/page.tsx` & lint | Valid App Router client component; no TypeScript or ESLint errors; proper Tailwind v4 usage. |
| End-to-End Build & Lint | `npm run build && npm run lint` | Zero errors across all app routes and components. |
