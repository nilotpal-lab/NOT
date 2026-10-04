# Milestone M4: Spec Miner Handoff Report

## 1. Observation

1. **Existing Codebase State**:
   - `src/app/admin/`: Contains only `login/page.tsx` (`file:///c:/Users/nilot/OneDrive/Desktop/BTECH-CSE/VIBE%20CODING/NOTSY/src/app/admin/login/page.tsx`). No `src/app/admin/page.tsx` exists yet.
   - `src/app/api/admin/`: Contains `login/`, `logout/`, `session/`, and `upload/` (`part/` and `complete/`). No `library/` endpoints exist yet (`file:///c:/Users/nilot/OneDrive/Desktop/BTECH-CSE/VIBE%20CODING/NOTSY/src/app/api/admin`).
   - `src/lib/catalog.ts` (`lines 253-275`):
     ```typescript
     export async function renameChapter(
       chapterId: string,
       newTitle: string
     ): Promise<{ updatedChapter: Chapter; updatedFilesCount: number }> {
       const db = getDb();
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
       const { data: files } = await db.from("files").select("id").eq("chapter_id", chapterId);
       return {
         updatedChapter: updatedChapter as Chapter,
         updatedFilesCount: files?.length ?? 0,
       };
     }
     ```
     `src/lib/catalog.ts` does **not** call `buildFileName` or update `files.file_name` during `renameChapter`.
   - `src/lib/naming.ts` (`lines 111-177`): Pure function `buildFileName({ class, subject, chapterNo, title, kind, teacherName, ext, existingNames })` is already fully implemented, tested (`tests/unit/naming.test.ts`), and exports regex pattern `^[A-Za-z0-9._-]+$`.
   - `tests/unit/`: Contains 7 unit test files (`auth.test.ts`, `naming.test.ts`, `magic.test.ts`, `chunking.test.ts`, `rollback.test.ts`, `challenger-chunking-concurrency.test.ts`, `env.test.ts`). All 161 unit tests pass (`npx vitest run tests/unit/`, 161/161 passed in 4.94s). `tests/unit/catalog.test.ts` does not exist yet.
   - `tests/tier1-feature/catalog-admin.test.ts` tests mock database class `MockDatabase`, not the actual `src/lib/catalog.ts` Supabase queries.
   - `package.json` (`lines 24-34`): Does not include `lucide-react` or Radix UI; relies purely on standard React 19, Next.js 16.3.8, and Tailwind CSS v4.

2. **Requirements from `ORIGINAL_REQUEST.md` and Dispatch Prompt**:
   - R4 Admin Dashboard: List and filter published/hidden files by class, subject, kind; rename chapter title with cascade update; toggle visibility; delete file with Telegram part message cleanup.
   - Dispatch Mission:
     - `src/app/admin/page.tsx`: Admin Library Management Dashboard with Tailwind CSS v4, session info, logout button, filter bar, bulk action bar, chapter cards/accordion, files table, rename modal, delete modal, upload quick trigger, loading/empty/error states.
     - `tests/unit/catalog.test.ts`: Mocking Supabase `getDb()` and Telegram client to verify `getChaptersWithFiles`, `renameChapter` (verifying title update and `buildFileName` called for every file, updating `file_name` in DB), `toggleFilePublished`, `bulkToggleTeacherNotes`, and `deleteFileWithTelegramCleanup`.

## 2. Logic Chain

1. **Step 1: Gap in `src/lib/catalog.ts`**:
   - *Observation*: `renameChapter` in `src/lib/catalog.ts` only updates `chapters.title` and counts files (`files.length`).
   - *Requirement*: Feature 18, R4, and the dispatch prompt demand that renaming a chapter cascades to recalculate each file's standardized `file_name` via `buildFileName` and persists that update to Supabase.
   - *Deduction*: `src/lib/catalog.ts` must be updated to import `buildFileName` from `@/lib/naming`, query `files` by `chapter_id`, compute new filenames using the new chapter title, and execute `db.from("files").update({ file_name }).eq("id", file.id)` for each file.

2. **Step 2: API Route Layer**:
   - *Observation*: The admin browser client (`src/app/admin/page.tsx`) communicates with backend services via HTTP routes. Next.js edge middleware (`src/middleware.ts`) protects all `/api/admin/*` routes with session verification and mutating origin validation.
   - *Deduction*: Five route handlers must be established:
     - `GET /api/admin/library/route.ts` -> calls `getChaptersWithFiles` with query params.
     - `PATCH /api/admin/library/[id]/route.ts` -> calls `toggleFilePublished(id, is_published)`.
     - `DELETE /api/admin/library/[id]/route.ts` -> calls `deleteFileWithTelegramCleanup(id, tgClient, channelId)`.
     - `PATCH /api/admin/library/chapter/[id]/route.ts` -> calls `renameChapter(id, title)`.
     - `POST /api/admin/library/bulk-toggle/route.ts` -> calls `bulkToggleTeacherNotes(is_published)`.

3. **Step 3: Admin UI Component (`src/app/admin/page.tsx`)**:
   - *Observation*: Tailwind CSS v4 is used with CSS variables (`var(--accent)`, `var(--card-bg)`, `var(--foreground)`, `var(--border-color)`). No Lucide icons are installed.
   - *Deduction*: The dashboard must be a `"use client"` component containing inline SVGs for pencil (rename), trash (delete), chevron (accordion), and checkmark (toast).
   - *Interaction Design*:
     - Optimistic toggle with auto-revert on failure ensures immediate tactile response.
     - Floating toast notification system notifies administrators of visibility toggles, cascade rename counts, and purged Telegram message counts.
     - Confirmation modals prevent accidental permanent deletion of Telegram storage chunks or uncoordinated title changes.

4. **Step 4: Unit Test Suite (`tests/unit/catalog.test.ts`)**:
   - *Observation*: `tests/tier1-feature/catalog-admin.test.ts` only tested the in-memory `MockDatabase` helper. The dispatch mandates testing `src/lib/catalog.ts` directly by mocking Supabase `getDb()`.
   - *Deduction*: `tests/unit/catalog.test.ts` must mock `getDb` via `vi.spyOn(dbModule, "getDb")` with a fluent Supabase query builder mock that simulates `.from()`, `.select()`, `.eq()`, `.order()`, `.update()`, `.delete()`, `.single()`, and `.maybeSingle()`. It must verify all 5 functions across typical use cases and edge cases (e.g. 0-file chapters, missing files, partial Telegram network errors).

## 3. Caveats

1. **Role Scope**: As Spec Miner, I have formulated the full technical specifications, interface contracts, edge case tables, and proposed code implementations in `analysis.md`. I have not modified production application files in `src/` directly.
2. **Supabase In-Memory Mocking**: The proposed unit test suite in `tests/unit/catalog.test.ts` mocks the Supabase query builder in memory. In a live environment with PostgreSQL, constraints like foreign key cascades (`ON DELETE CASCADE`) are enforced by Postgres; the test mock correctly mirrors this schema behavior.
3. **Telegram Environment Variables**: In `DELETE /api/admin/library/[id]`, if `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHANNEL_ID` is not configured, the function gracefully falls back to deleting the database record and returns an empty list of deleted Telegram IDs without failing the request.

## 4. Conclusion

1. The specifications for `src/app/admin/page.tsx`, `src/lib/catalog.ts` (cascade rename fix), `src/app/api/admin/library/...` endpoints, and `tests/unit/catalog.test.ts` are 100% complete and documented in:
   - `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m4_1\analysis.md`
2. Complete, copy-paste ready code has been provided for:
   - `src/app/admin/page.tsx` (Admin Library Dashboard)
   - `src/lib/catalog.ts` (`renameChapter` enhancement)
   - `src/app/api/admin/library/route.ts`
   - `src/app/api/admin/library/[id]/route.ts`
   - `src/app/api/admin/library/chapter/[id]/route.ts`
   - `src/app/api/admin/library/bulk-toggle/route.ts`
   - `tests/unit/catalog.test.ts` (Unit test suite)

## 5. Verification Method

Once implemented by the builder agent, verify independently with:
1. **Unit Tests**:
   ```bash
   npx vitest run tests/unit/catalog.test.ts
   ```
   *Expected*: All tests pass (filters, rename cascade with `buildFileName`, visibility toggle, bulk notes toggle, Telegram cleanup).
2. **Full Unit Suite Regression**:
   ```bash
   npx vitest run tests/unit/
   ```
   *Expected*: All 8 test files pass (161+ tests, 0 failures).
3. **Lint & Build Verification**:
   ```bash
   npm run lint
   npm run build
   ```
   *Expected*: Zero lint warnings/errors, clean Next.js build compilation with `/admin` statically or dynamically generated.
4. **Invalidation Conditions**:
   - If `renameChapter` does not update `file_name` in the database, `tests/unit/catalog.test.ts` will fail on `F18.1`.
   - If mutating routes do not validate Origin headers, `tests/unit/auth.test.ts` or middleware tests will fail.
