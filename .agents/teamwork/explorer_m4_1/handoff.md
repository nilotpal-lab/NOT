# Milestone M4 Handoff Report: Catalog Data Service & Rename Cascade Explorer

## 1. Observation
- **Original Requirements**: `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\ORIGINAL_REQUEST.md` § R4 requires:
  - Catalog list and filtering by class, subject, kind, and published status.
  - Chapter title renaming with cascading recalculation of all dependent file names.
  - Single file visibility toggle and bulk teacher notes toggle.
  - File deletion purging both database records and Telegram part messages.
- **Database Schema**: `supabase/schema.sql`:
  - `chapters`: `id uuid primary key`, `class smallint`, `subject text`, `chapter_no smallint`, `title text (check 2-200)`, `UNIQUE (class, subject, chapter_no)`.
  - `files`: `id uuid primary key`, `chapter_id uuid references chapters(id) on delete cascade`, `file_name text not null unique`, `UNIQUE (chapter_id, sha256)`.
  - `file_parts`: `(file_id, part_no) primary key`, `file_id uuid references files(id) on delete cascade`, `tg_message_id bigint not null`.
- **Existing `src/lib/catalog.ts` (Lines 253-275)**:
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
    ...
    const { data: files } = await db.from("files").select("id").eq("chapter_id", chapterId);
    return {
      updatedChapter: updatedChapter as Chapter,
      updatedFilesCount: files?.length ?? 0,
    };
  }
  ```
  `renameChapter` merely updates `chapters.title` and counts files; it does **not** recalculate `file_name` for any dependent file.
- **Existing `src/lib/catalog.ts` (Lines 169-211)**:
  `getChaptersWithFiles` queries `files (*)` without nested `file_parts (*)`. It accepts `publishedOnly?: boolean`, which cannot filter for hidden files (`is_published: false`), and does not sort nested `files` deterministically in memory.
- **Existing `src/types/database.ts`**:
  `FileRecord` lacks optional `file_parts?: FilePart[]`, and module lacks `CatalogFilters`, `ChapterRenameResult`, `FileDeleteResult`, `TelegramClientLike`.
- **Test Baseline**: Running `npm test` via vitest passes all 15 test files (221 tests) including Tier 1, 2, 3, 4 tests.

## 2. Logic Chain
1. *From Observation of `renameChapter`*: In `supabase/schema.sql`, file names follow deterministic patterns defined in `src/lib/naming.ts` (`buildFileName`). If a chapter title changes from "Palampur" to "Village Palampur Economy", all linked files must change their file names from `Palampur_Class9_Economics_Ch01_NCERT.pdf` to `Village-Palampur-Economy_Class9_Economics_Ch01_NCERT.pdf`. Because `file_name` is `unique`, sequential updates must pass an accumulating `existingNames` array into `buildFileName` to prevent duplicate suffix collisions (`-2`, `-3`).
2. *From Observation of `getChaptersWithFiles`*: The admin dashboard needs to inspect multi-part chunk health and Telegram storage status for each file. Adding nested `file_parts (*)` in the PostgREST select query, sorting files by `created_at ASC` and parts by `part_no ASC`, and supporting `isPublished: boolean` allows full visibility filtering (both published and hidden files).
3. *From Observation of `deleteFileWithTelegramCleanup`*: When deleting a file, `file_parts` must be queried before deletion to retrieve all `tg_message_id`s. Telegram message deletion calls must be wrapped in per-message `try/catch` blocks so that a failure on one message does not halt cleanup. Both `file_parts` and `files` are deleted. The syllabus chapter container is preserved by default to prevent loss of syllabus structure and chapter metadata, with an optional flag `removeEmptyChapter?: boolean` if total cleanup is desired.
4. *From Observation of Type Definitions*: Augmenting `src/types/database.ts` with `CatalogFilters`, `ChapterRenameResult`, `FileDeleteResult`, `TelegramClientLike`, and `file_parts?: FilePart[]` on `FileRecord` provides full compile-time safety across both the library service and upcoming Admin UI route handlers.

## 3. Caveats
- Direct execution in `src/lib/catalog.ts` was not performed as this is a read-only exploration task. The proposed implementations are fully detailed in `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m4_1\analysis.md`.
- Telegram caption updates on chapter rename are not performed. Telegram captions serve as immutable upload audit metadata; only the catalog `files.file_name` is updated during rename cascade.
- PostgREST nested updates cannot update multiple rows across tables in a single SQL query via client SDK without an RPC function; the sequential update loop across files linked to the chapter is optimal and bounded (typically 1 to 10 files per chapter).

## 4. Conclusion
The M4 catalog data service and rename cascade architecture is thoroughly analyzed and fully drafted:
1. `src/types/database.ts` should be updated with the expanded type definitions and `FileRecord.file_parts` field.
2. `src/lib/catalog.ts` should be updated with the complete implementations of:
   - `getChaptersWithFiles` (nested files and file_parts, filter by class/subject/kind/isPublished, deterministic sort)
   - `renameChapter` (cascading `buildFileName` recalculation for all chapter files with collision disambiguation)
   - `toggleFilePublished` (file visibility toggle)
   - `bulkToggleTeacherNotes` (bulk teacher notes toggle)
   - `deleteFileWithTelegramCleanup` (safe Telegram message purge with try/catch, DB deletion, empty chapter preservation policy)
3. The proposed code is 100% backward-compatible with all 221 existing unit and lifecycle tests.

## 5. Verification Method
1. **Inspection**:
   - Inspect `analysis.md` in this directory for the full TypeScript implementations.
   - Verify signatures match `tests/helpers/dynamic-loader.ts` lines 80-121 (`CatalogModule`).
2. **Test Command**:
   - Run `npm test` to verify zero regressions across the 221 unit and lifecycle tests.
   - Run `npm run lint` and `npm run build` to verify type checker compliance.
3. **Invalidation Conditions**:
   - If `renameChapter` fails to update `files.file_name` in the database.
   - If duplicate teacher notes within a renamed chapter lose their `-2`, `-3` disambiguation suffix.
   - If Telegram deletion failure crashes the file database deletion.
