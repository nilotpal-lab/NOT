# Database Schema, Supabase Integration & Catalog Survey

**Author**: Explorer 3 (Database Schema & Catalog Survey)  
**Date**: 2026-10-04  
**Integrity Mode**: Development / Read-Only Survey  
**Target Repository**: `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY`

---

## 1. Executive Summary

This survey provides an authoritative assessment of the Supabase Postgres integration, database schema, constraints, indexes, catalog architecture, and interaction patterns in the SST Chapter Library repository.

Key findings:
- **Database Connection**: `src/lib/db.ts` exports `getDb()` which instantiates a singleton `@supabase/supabase-js` client using `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. There is **no client-side Supabase client** or `NEXT_PUBLIC_*` credential; the database is accessed strictly server-side, upholding zero-cost isolation.
- **Database Schema**: Fully defined in `supabase/schema.sql` (50 lines) with three core tables: `chapters`, `files`, and `file_parts`.
- **Active State**: The live Supabase instance is active and connected. All 3 tables exist, RLS is enabled on all tables with zero public policies (relying on server-side `service_role` key bypass), and currently all tables contain 0 rows (clean slate ready for Phase 1 upload and catalog management).
- **Constraints & Integrity**: Strict Postgres `CHECK` constraints enforce valid classes (6–10), subjects (5 exact enums), chapter numbers (1–99), title length (2–200), file sizes (<= 200 MiB), part sizes (<= 19 MiB), MIME types, and kinds. Cascade deletes (`ON DELETE CASCADE`) are present on all foreign keys (`files.chapter_id`, `files.parent_file_id`, and `file_parts.file_id`).
- **Phase 1 Readiness**: The schema directly supports all requirements R1–R4 (chapter auto-creation, content duplicate rejection via `UNIQUE(chapter_id, sha256)`, parent-child linking for PPTX preview PDFs via `parent_file_id`, visibility toggle via `is_published`, and multi-part Telegram chunk mapping). Application-level repository helpers and TypeScript types must now be implemented in Phase 1.

---

## 2. Database Connection Architecture

### 2.1 Connection Implementation
- **File**: `src/lib/db.ts` (lines 1–28)
- **Function**: `getDb(url?: string, serviceKey?: string): SupabaseClient`
- **Client Configuration**:
  ```typescript
  // src/lib/db.ts:14-25
  const client = createClient(finalUrl, finalKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  ```
- **Singleton Caching**: If called without arguments, `getDb()` caches the initialized client in `supabaseClient` (line 21–23) and reuses it across server invocations.

### 2.2 Environment Variables & Key Usage
- **Validation Schema**: `src/lib/validate.ts` (lines 8–9):
  - `SUPABASE_URL`: `z.string().url("SUPABASE_URL must be a valid URL")`
  - `SUPABASE_SERVICE_KEY`: `z.string().min(1, "SUPABASE_SERVICE_KEY is required")`
- **Environment Example**: `.env.example` lines 5–7 defines `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
- **Security & Key Scope**:
  - `SUPABASE_SERVICE_KEY` is the Postgres `service_role` secret key.
  - There is **no `anon` key** configured in `.env.example` or `src/lib/validate.ts`.
  - There are **no `NEXT_PUBLIC_SUPABASE_*`** keys.
  - The browser is completely isolated from Supabase. All database queries occur inside Node.js API routes or server actions.

### 2.3 Existing Verification Utilities
- **`checkDatabaseSchema(client?: SupabaseClient): Promise<DbCheckStatus>`** in `src/lib/db.ts` (lines 42–101):
  - Probes table existence on `chapters`, `files`, and `file_parts` using direct `.select("*").limit(0)` query.
  - Verifies RLS status.
- **`scripts/preflight.ts`** (lines 46–87):
  - Runs preflight check `PRE-2` verifying Supabase connectivity and RLS status.
- **`scripts/db-check.ts`** (lines 1–254):
  - Performs 11 automated runtime checks validating:
    - Table existence and RLS flags on all 3 tables
    - `chapters.class` check constraint (6 to 10)
    - `chapters.subject` check constraint (5 valid subjects)
    - `chapters.chapter_no` check constraint (1 to 99)
    - `chapters.title` check constraint (length 2 to 200)
    - `files.kind` check constraint (`ncert_pdf`, `ppt`, `ppt_pdf`, `teacher_notes`)
    - `files.size_bytes` check constraint (> 0 and <= 200 MiB)
    - `files.mime` check constraint (`application/pdf`, PPTX mime)
    - `file_parts.part_no` check constraint (>= 1)
    - `file_parts.size_bytes` check constraint (<= 19 MiB / 19922944 bytes)
    - `chapters` unique constraint on `(class, subject, chapter_no)`
    - `chapters_title_trgm` GIN trigram index operation via ILIKE

---

## 3. Migration & Schema Definition Survey

### 3.1 SQL Definition File
- **File**: `supabase/schema.sql` (50 lines total)
- **Migration Directory**: Supabase CLI migration directory (e.g. `supabase/migrations/`) does not exist; the single authoritative schema definition is `supabase/schema.sql`.

### 3.2 Postgres Extensions
- `create extension if not exists pg_trgm;` (`supabase/schema.sql:1`): Enables trigram matching for fuzzy search on chapter titles and file names.
- `create extension if not exists pgcrypto;` (`supabase/schema.sql:2`): Enables cryptographic utilities and UUID generation (`gen_random_uuid()`).

### 3.3 Row Level Security (RLS) Policy Design
- `supabase/schema.sql` lines 47–49:
  ```sql
  alter table chapters enable row level security;
  alter table files enable row level security;
  alter table file_parts enable row level security;
  ```
- **Policy Observation**: **Zero RLS policies exist.**
- **Architectural Rationale**: By enabling RLS without any `CREATE POLICY` statements, PostgREST denies all access to the `anon` and `authenticated` roles by default. Only the server-side `service_role` key (which automatically bypasses RLS) can execute queries. This creates an impermeable security boundary preventing any external Supabase client abuse if the project URL were ever discovered.

---

## 4. Comprehensive Table & Constraint Inventory

### 4.1 Table: `chapters`
Source: `supabase/schema.sql:4-15`

| Column | Data Type | Nullable | Default | Constraints & Rules |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary Key |
| `class` | `smallint` | NO | None | `check (class between 6 and 10)` |
| `subject` | `text` | NO | None | `check (subject in ('History','Geography','Civics','Economics','SocialScience'))` |
| `chapter_no` | `smallint` | NO | None | `check (chapter_no between 1 and 99)` |
| `title` | `text` | NO | None | `check (length(title) between 2 and 200)` |
| `book` | `text` | YES | `NULL` | Optional textbook series name |
| `edition` | `text` | YES | `NULL` | Optional NCERT edition / academic year |
| `created_at` | `timestamptz` | NO | `now()` | Timestamp with time zone |

**Indexes & Constraints**:
- `UNIQUE (class, subject, chapter_no)`: Prevents duplicate chapter numbers within the same class and subject.
- `chapters_title_trgm`: GIN index on `title gin_trgm_ops` for fast fuzzy trigram matching (`supabase/schema.sql:15`).

---

### 4.2 Table: `files`
Source: `supabase/schema.sql:17-34`

| Column | Data Type | Nullable | Default | Constraints & Rules |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary Key |
| `chapter_id` | `uuid` | NO | None | Foreign Key `references chapters(id) on delete cascade` |
| `kind` | `text` | NO | None | `check (kind in ('ncert_pdf','ppt','ppt_pdf','teacher_notes'))` |
| `parent_file_id` | `uuid` | YES | `NULL` | Foreign Key `references files(id) on delete cascade` |
| `file_name` | `text` | NO | None | `UNIQUE` constraint across the entire table |
| `teacher_name` | `text` | YES | `NULL` | Populated when `kind = 'teacher_notes'` |
| `size_bytes` | `bigint` | NO | None | `check (size_bytes > 0 and size_bytes <= 209715200)` (Max 200 MiB) |
| `part_count` | `smallint` | NO | `1` | Number of Telegram chunks (>= 1) |
| `mime` | `text` | NO | None | `check (mime in ('application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation'))` |
| `sha256` | `text` | NO | None | Whole-file 64-character hex SHA-256 |
| `is_published` | `boolean` | NO | `true` | Visibility toggle (true = public, false = hidden) |
| `created_at` | `timestamptz` | NO | `now()` | Timestamp with time zone |

**Indexes & Constraints**:
- `UNIQUE (file_name)`: Enforces strictly deterministic, collision-free naming per `buildFileName`.
- `UNIQUE (chapter_id, sha256)`: Enforces **duplicate rejection** (cannot upload identical content to the same chapter).
- `files_chapter`: B-tree index on `chapter_id` for fast catalog lookups (`supabase/schema.sql:33`).
- `files_name_trgm`: GIN index on `file_name gin_trgm_ops` for fuzzy filename search (`supabase/schema.sql:34`).
- Cascade rules:
  - When a `chapters` row is deleted, all child `files` rows cascade-delete.
  - When a parent file is deleted (e.g. `ppt`), linked child file (e.g. `ppt_pdf`) cascade-deletes via `parent_file_id`.

---

### 4.3 Table: `file_parts`
Source: `supabase/schema.sql:36-45`

| Column | Data Type | Nullable | Default | Constraints & Rules |
| :--- | :--- | :--- | :--- | :--- |
| `file_id` | `uuid` | NO | None | Foreign Key `references files(id) on delete cascade` |
| `part_no` | `smallint` | NO | None | `check (part_no >= 1)` (1-based index: 1, 2, 3...) |
| `tg_file_id` | `text` | NO | None | Telegram `file_id` for `getFile` downloads |
| `tg_file_unique_id` | `text` | NO | None | Telegram unique identifier |
| `tg_message_id` | `bigint` | NO | None | Telegram channel `message_id` for message deletion |
| `size_bytes` | `integer` | NO | None | `check (size_bytes > 0 and size_bytes <= 19922944)` (Max 19 MiB) |
| `sha256` | `text` | NO | None | SHA-256 checksum of this individual part chunk |

**Indexes & Constraints**:
- Primary Key: `(file_id, part_no)` ensures parts are uniquely ordered per file.
- Foreign Key: `file_id references files(id) on delete cascade`.
- Size constraint: `size_bytes <= 19922944` strictly enforces Telegram 20 MB download safety (19 MiB = 19,922,944 bytes).

---

## 5. Survey of Existing Database Interacting Code

| File Path | Role / Function | Database Operations |
| :--- | :--- | :--- |
| `src/lib/db.ts:6-28` | Client factory (`getDb`) | Connects via `createClient`, creates singleton. |
| `src/lib/db.ts:42-101` | Schema validator (`checkDatabaseSchema`) | RPC `get_table_rls_status` or `.from(t).select("*").limit(0)`. |
| `src/app/api/health/route.ts:22-29` | Health check endpoint | `.from("chapters").select("id").limit(1)` |
| `scripts/preflight.ts:60-68` | Preflight check runner | Calls `checkDatabaseSchema(db)`. |
| `scripts/db-check.ts:28-232` | Exhaustive constraint test suite | Executes test inserts & queries verifying all check constraints, unique constraints, and indexes. |

### Live Database State Verification
A read-only execution confirmed live connectivity to Supabase:
- `chapters`: 0 rows
- `files`: 0 rows
- `file_parts`: 0 rows
- Status: Ready for Phase 1 data modeling and API integration.

---

## 6. Audit of Requirements R1–R4 Against Schema

### R1. Admin Authentication & Session Security
- **Requirement**: Scrypt hash verify against `ADMIN_PASSWORD_HASH`, 12-hour signed JWT cookie, IP rate limiting, protected `/admin/*` and `/api/admin/*`.
- **Schema Impact**: **None required.**
- **Verification**: The system uses a single admin credential stored in environment variable `ADMIN_PASSWORD_HASH` and stateless JWT signed with `SESSION_SECRET`. No user/admin/session table is needed in Postgres, keeping database overhead zero.

### R2. Deterministic Auto-Naming & Magic-Byte Validation
- **Requirement**: `buildFileName({ class, subject, chapterNo, title, kind, teacherName, ext, existingNames })`, pattern `{Chapter-Title}_Class{C}_{Subject}_Ch{NN}_{Type}.{ext}`. PPTX uploads require an accompanying PDF preview export (`ppt` row linked to `ppt_pdf` row via `parent_file_id`).
- **Schema Alignment**:
  - `files.file_name`: `UNIQUE` constraint guarantees uniqueness.
  - `files.parent_file_id`: `references files(id) on delete cascade` is already present.
  - Linking flow:
    1. Upload PPTX parts to Telegram, compute sha256.
    2. Upload PPTX-preview PDF parts to Telegram, compute sha256.
    3. Insert `files` row for `ppt` (`kind = 'ppt'`).
    4. Insert `files` row for `ppt_pdf` (`kind = 'ppt_pdf'`, `parent_file_id = pptRow.id`).
    5. If PPT is deleted, Postgres automatically cascades delete to the `ppt_pdf` row (application must ensure Telegram messages for both are deleted).

### R3. Chunked Multi-Part Telegram Upload Engine
- **Requirement**: Client-side slicing (<= 19 MiB), sequential upload (`/api/admin/upload/part` and `/api/admin/upload/complete`), rollback on failure, chapter auto-creation if missing, duplicate rejection (same chapter + sha256).
- **Schema Alignment**:
  - **Chapter Auto-Creation**:
    - When completing an upload:
      ```typescript
      // 1. Check if chapter exists by class, subject, chapter_no
      const { data: existingChapter } = await db
        .from("chapters")
        .select("id, title")
        .eq("class", classNo)
        .eq("subject", subject)
        .eq("chapter_no", chapterNo)
        .maybeSingle();

      let chapterId = existingChapter?.id;
      if (!chapterId) {
        const { data: newChapter } = await db
          .from("chapters")
          .insert({ class: classNo, subject, chapter_no: chapterNo, title })
          .select("id")
          .single();
        chapterId = newChapter.id;
      }
      ```
    - Unique constraint `chapters(class, subject, chapter_no)` guarantees no duplicate chapter records can be created concurrently.
  - **Duplicate Rejection**:
    - `files` has `UNIQUE (chapter_id, sha256)`.
    - If a file with the identical content hash is already uploaded to this chapter, Postgres throws `23505` (`files_chapter_id_sha256_key`).
    - The API route can pre-check or catch this constraint violation and return a friendly error message: `"A file with identical content is already uploaded in this chapter"`.
  - **Part Storage**:
    - `file_parts` maps each chunk sequentially (`part_no` 1 to N) with Telegram metadata (`tg_file_id`, `tg_file_unique_id`, `tg_message_id`) and individual part checksum (`sha256`).
    - Check constraint `size_bytes <= 19922944` prevents oversized chunks from entering the database.
  - **Rollback Guarantee**:
    - If part forwarding to Telegram fails, or if Postgres insertion of `files` / `file_parts` fails, the server uses `tg_message_id` collected during the session to call `tgClient.deleteMessage(channelId, msgId)` and rolls back completely without writing broken records.

### R4. Admin Library Management Dashboard
- **Requirement**: List and filter published/hidden files by class, subject, kind; rename chapter title with cascade update; toggle visibility (single file or all teacher notes); delete file with Telegram message cleanup.
- **Schema Alignment**:
  - **List and Filter**:
    - Query joining `files` and `chapters`:
      ```typescript
      db.from("files").select("*, chapters!inner(*)").order("created_at", { ascending: false });
      ```
    - Index `files_chapter` on `files(chapter_id)` ensures fast joins.
  - **Rename Chapter Title with Cascade**:
    - Updating `chapters.title` directly updates the chapter record.
    - **Cascade Rename Logic**: Because `files.file_name` incorporates `{Chapter-Title}`, renaming a chapter means all associated files in `files` must have their `file_name` recalculated via `buildFileName` and updated in Postgres.
    - Because foreign keys are based on immutable `id uuid`, the database relationships remain intact, but the application must execute an update across `files WHERE chapter_id = $1` to keep file names in sync.
  - **Visibility Toggles**:
    - Single file: `UPDATE files SET is_published = $val WHERE id = $fileId`.
    - Teacher notes bulk toggle: `UPDATE files SET is_published = false WHERE kind = 'teacher_notes'`.
  - **Delete File**:
    - Must retrieve all `tg_message_id`s from `file_parts` for `fileId` (and any child `parent_file_id` if deleting a `ppt`).
    - Call `TelegramClient.deleteMessage` for each message.
    - Delete `files` row (`DELETE FROM files WHERE id = $fileId`).
    - Postgres `ON DELETE CASCADE` automatically removes `file_parts` rows.

---

## 7. Blueprint & Recommendations for Phase 1 Implementers

### 7.1 Required TypeScript Data Types
The implementer should create a dedicated typing module (e.g. `src/types/database.ts`):
```typescript
export type Subject = 'History' | 'Geography' | 'Civics' | 'Economics' | 'SocialScience';

export type FileKind = 'ncert_pdf' | 'ppt' | 'ppt_pdf' | 'teacher_notes';

export interface Chapter {
  id: string;
  class: number;
  subject: Subject;
  chapter_no: number;
  title: string;
  book?: string | null;
  edition?: string | null;
  created_at: string;
}

export interface FileRecord {
  id: string;
  chapter_id: string;
  kind: FileKind;
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

export interface FilePart {
  file_id: string;
  part_no: number;
  tg_file_id: string;
  tg_file_unique_id: string;
  tg_message_id: number;
  size_bytes: number;
  sha256: string;
}
```

### 7.2 Database Access Layer (Catalog Service)
We recommend establishing `src/lib/catalog.ts` or `src/lib/db/` to encapsulate:
1. `findOrCreateChapter({ class, subject, chapter_no, title })`
2. `checkDuplicateFile(chapterId, sha256)`
3. `createFileWithParts({ file, parts })`
4. `listAdminFiles({ classFilter?, subjectFilter?, kindFilter?, search? })`
5. `updateChapterTitle(chapterId, newTitle)` (with automated file name regeneration)
6. `setFileVisibility(fileId, isPublished)`
7. `setAllTeacherNotesVisibility(isPublished)`
8. `deleteFileAndCollectTelegramMessages(fileId)`

### 7.3 Critical Edge Cases to Safeguard
1. **PPT Deletion Cascade**: If deleting a `ppt` file that has a child `ppt_pdf` row, `file_parts` for BOTH the `ppt` and the child `ppt_pdf` must be queried first to obtain all Telegram message IDs before issuing the SQL `DELETE`, otherwise the child file's Telegram messages will be orphaned in the Telegram channel.
2. **Subject Capitalization**: Subject values in DB are strictly PascalCase (`History`, `Geography`, `Civics`, `Economics`, `SocialScience`). Any frontend or route input must be validated/normalized to match this exact enum.
3. **Class Range**: Class is smallint between 6 and 10. Forms and APIs must reject values outside [6, 10].
4. **Part Count Integrity**: When completing an upload, `files.part_count` must equal the number of inserted `file_parts` rows.
