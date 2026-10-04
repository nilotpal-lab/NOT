# Changes Summary — Milestone M4 (Admin Library Management Dashboard)

## Overview
Worker 1 implemented the complete Milestone M4 scope for the SST Chapter Library:
1. Extended database types (`src/types/database.ts`).
2. Enhanced catalog data service (`src/lib/catalog.ts`) with deterministic cascade renaming via `buildFileName`, multi-faceted filtering, nested `file_parts`, visibility toggling, bulk teacher notes toggling, and resilient Telegram storage purge on delete.
3. Implemented 5 Admin API routes under `src/app/api/admin/library/*` adhering strictly to Next.js 16 asynchronous dynamic parameter requirements (`await context.params`), edge middleware defense-in-depth, and CSRF Origin validation.
4. Built the Admin Library Management Dashboard at `src/app/admin/page.tsx` using Tailwind CSS v4 and inline SVGs with multi-faceted filtering, summary stats, bulk toggles, chapter accordion cards, files table, rename modal, delete confirmation modal, and toast alerts.
5. Authored comprehensive unit test suite in `tests/unit/catalog.test.ts` covering 25 test cases across all catalog functions, cascade renames with disambiguation (`-2`, `-3`), and error-resilient Telegram deletions.

---

## Files Created / Modified

### 1. `src/types/database.ts` (Modified)
- Added `file_parts?: FilePart[]` to `FileRecord` for chunk inspection.
- Added `CatalogFilters` interface supporting `class`, `subject`, `kind`, `isPublished`, `publishedOnly`, and `hideEmptyChapters`.
- Added `ChapterRenameResult` interface (`{ updatedChapter: Chapter; updatedFilesCount: number }`).
- Added `FileDeleteResult` interface (`{ deletedFileId: string; deletedMessageIds: number[] }`).
- Added `TelegramClientLike` and `DeleteFileOptions` interfaces for decoupled testability.

### 2. `src/lib/catalog.ts` (Modified)
- `getChaptersWithFiles`:
  - Relational PostgREST query nesting `files (*, file_parts (*))`.
  - Filters by `class` and `subject` at database level.
  - Filters nested files by `kind`, `isPublished`, and `publishedOnly`.
  - Supports `hideEmptyChapters`.
  - Sorts chapters by `class ASC, subject ASC, chapter_no ASC`.
  - Deterministically sorts nested files by `created_at ASC` and file parts by `part_no ASC`.
- `renameChapter`:
  - Validates `newTitle` length (2 to 200 chars).
  - Updates chapter title in PostgreSQL `chapters` table.
  - Queries all files for the chapter ordered by `created_at ASC`.
  - Queries other existing file names across the database to prevent global collisions.
  - Recalculates each file's standardized name via `buildFileName` from `src/lib/naming.ts`.
  - Resolves duplicate teacher notes with `-2`, `-3` via accumulating `existingNames`.
  - Updates each file's `file_name` in Supabase `files` table.
  - Returns `{ updatedChapter, updatedFilesCount }`.
- `toggleFilePublished`:
  - Sets `is_published: isPublished` in `files` table and returns updated `FileRecord`.
- `bulkToggleTeacherNotes`:
  - Sets `is_published: isPublished` for all rows where `kind = 'teacher_notes'` and returns affected count.
- `deleteFileWithTelegramCleanup`:
  - Retrieves all `tg_message_id`s from `file_parts`.
  - Calls `tgClient.deleteMessage(channelId, msgId)` with individual per-message try/catch handling so network failures on individual messages do not crash database cleanup.
  - Deletes `file_parts` and `files` rows from Supabase.
  - Preserves syllabus chapter metadata by default (or removes empty chapter if `options.removeEmptyChapter === true`).
  - Returns `{ deletedFileId, deletedMessageIds }`.

### 3. `src/app/api/admin/library/route.ts` (Created)
- `GET /api/admin/library`:
  - Verifies admin session token (`verifyAdminToken`).
  - Parses query parameters (`class`, `subject`, `kind`, `isPublished`, `publishedOnly`).
  - Validates query params using Zod schema.
  - Calls `getChaptersWithFiles` and returns `{ chapters: ChapterWithFiles[] }`.

### 4. `src/app/api/admin/library/[id]/route.ts` (Created)
- `PATCH /api/admin/library/[id]`:
  - Validates Origin header via `validateOrigin(req)` (CSRF protection).
  - Verifies admin session token.
  - Next.js 16 compliant: strictly awaits `await context.params` to resolve `id`.
  - Validates body containing `is_published` / `isPublished` boolean.
  - Calls `toggleFilePublished` and returns updated file record.
- `DELETE /api/admin/library/[id]`:
  - Validates Origin header and admin session.
  - Next.js 16 compliant: `await context.params`.
  - Calls `deleteFileWithTelegramCleanup` with configured `TelegramClient` and `TELEGRAM_CHANNEL_ID`.
  - Returns `{ success: true, deletedFileId, deletedMessageIds }`.

### 5. `src/app/api/admin/library/chapter/[id]/route.ts` (Created)
- `PATCH /api/admin/library/chapter/[id]`:
  - Validates Origin header and admin session.
  - Next.js 16 compliant: `await context.params`.
  - Validates `title` (trimmed string, 1 to 200 chars).
  - Calls `renameChapter(id, title)`.
  - Returns `{ success: true, updatedChapter, chapter, updatedFilesCount }`.

### 6. `src/app/api/admin/library/bulk-toggle/route.ts` (Created)
- `POST /api/admin/library/bulk-toggle`:
  - Validates Origin header and admin session.
  - Validates `is_published` / `isPublished` boolean.
  - Calls `bulkToggleTeacherNotes(isPublished)`.
  - Returns `{ success: true, count, updatedCount, is_published, isPublished }`.

### 7. `src/app/admin/page.tsx` (Created)
- Complete Client Component dashboard built with Tailwind CSS v4 and inline SVGs:
  - Header with session badge, student catalog link, and logout button.
  - Library statistics grid (total chapters, total files, published/hidden counts, total MB).
  - Bulk actions bar (Publish all notes, Hide all notes, Refresh).
  - Multi-faceted filter bar (Class 6-10, Subject, Kind, Status, Title/Filename search, Reset filters button).
  - Collapsible chapter accordion cards with subject color tags and file counts.
  - Chapter files table (Mono filename, Kind badge, Size in KB/MB, Part count, instant optimistic publish/hide toggle switch, Delete button).
  - Rename chapter modal with cascade warning and recalculation feedback.
  - Permanent delete modal with warning about Telegram chunk deletion.
  - Floating auto-dismissing toast notification stack.
  - Loading skeleton, empty state, and error banner with retry.

### 8. `tests/unit/catalog.test.ts` (Created)
- 25 comprehensive unit tests verifying:
  - Catalog filtering by class, subject, kind, publishedOnly, and isPublished (false).
  - Empty results and `hideEmptyChapters` flag.
  - `renameChapter` updating chapter title and triggering `buildFileName` with correct arguments, preserving extensions, and disambiguating duplicate teacher names (`-2`, `-3`).
  - Graceful handling of chapters with 0 files and error throwing for invalid lengths or missing IDs.
  - `toggleFilePublished` changing state between true and false.
  - `bulkToggleTeacherNotes` hiding/publishing only teacher notes and preserving NCERT and PPT files.
  - `deleteFileWithTelegramCleanup` calling `deleteMessage` on Telegram for all part message IDs and deleting database rows.
  - Error resilience when individual Telegram message deletions fail.
  - Chapter preservation by default and optional deletion when `removeEmptyChapter === true`.

---

## Verification Results
- `npm test`: 16/16 test files passed, 246/246 tests passed (0 failures).
- `npm run lint`: 0 errors, 0 warnings across all directories.
- `npx tsc --noEmit`: 0 TypeScript errors.
- `npm run build`: Next.js 16.3.8 Turbopack build succeeded in 2.1s, generating all static and dynamic pages (`/admin`, `/api/admin/library/*`).
- `npm run preflight`: 5/5 checks passed (PRE-1 to PRE-5 green).
