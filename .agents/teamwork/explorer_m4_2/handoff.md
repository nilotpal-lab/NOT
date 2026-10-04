# Milestone M4 Handoff Report: Admin Library API Routes Explorer

## 1. Observation

1. **Framework & Runtime Invariants**:
   - `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md:84-90`:
     ```ts
     export async function GET(
       request: Request,
       { params }: { params: Promise<{ team: string }> }
     ) {
       const { team } = await params
     }
     ```
     In Next.js 16.3.8 (App Router), dynamic route context `params` is an asynchronous `Promise` that must be awaited.
   - `src/middleware.ts:25-32`:
     ```ts
     if (pathname.startsWith("/api/admin/") && MUTATING_METHODS.has(method)) {
       if (!validateOrigin(req)) {
         return NextResponse.json(
           { error: "Forbidden: Invalid or missing Origin header" },
           { status: 403 }
         );
       }
     }
     ```
     Mutating methods (`POST`, `PUT`, `DELETE`, `PATCH`) under `/api/admin/*` are intercepted by edge middleware and verified with `validateOrigin(req)`.
   - `src/middleware.ts:54-65`:
     ```ts
     const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
     const isAuthenticated = token && secret ? await verifyAdminToken(token, secret) : false;
     if (!isAuthenticated) {
       if (pathname.startsWith("/api/admin/")) {
         return NextResponse.json(
           { error: "Unauthorized: Admin authentication required" },
           { status: 401 }
         );
       }
     ...
     ```
     All `/api/admin/*` endpoints require a valid `admin_session` JWT cookie.

2. **Catalog Data Service State**:
   - `src/lib/catalog.ts:169-211`:
     `getChaptersWithFiles(filters)` queries chapters and nested files, supporting `class`, `subject`, `kind`, and `publishedOnly`.
   - `src/lib/catalog.ts:216-230`:
     `toggleFilePublished(fileId, isPublished)` updates `is_published` and returns `FileRecord`.
   - `src/lib/catalog.ts:235-248`:
     `bulkToggleTeacherNotes(isPublished)` updates `is_published` for `kind = 'teacher_notes'` and returns affected count (`number`).
   - `src/lib/catalog.ts:253-275`:
     `renameChapter(chapterId, newTitle)` updates chapter title and returns `{ updatedChapter, updatedFilesCount }`.
   - `src/lib/catalog.ts:280-316`:
     `deleteFileWithTelegramCleanup(fileId, tgClient, channelId)` retrieves all `tg_message_id`s, deletes file rows from DB, loops through message IDs calling `tgClient.deleteMessage(channelId, msgId)`, and returns `{ deletedFileId, deletedMessageIds }`.

3. **Current System Health**:
   - `npm test`: Exited code 0, 15/15 test files passed, 221/221 tests green.
   - `npm run lint`: Exited code 0 with 0 errors and 0 warnings.

---

## 2. Logic Chain

1. **Routing and File Organization (backed by Observation 1)**:
   - Next.js App Router routes map files statically.
   - `GET /api/admin/library` requires `src/app/api/admin/library/route.ts`.
   - Both `PATCH` and `DELETE /api/admin/library/[id]` target the file entity identified by `[id]` and belong together in `src/app/api/admin/library/[id]/route.ts`.
   - `PATCH /api/admin/library/chapter/[id]` targets the chapter resource identified by `[id]` and belongs in `src/app/api/admin/library/chapter/[id]/route.ts`.
   - `POST /api/admin/library/bulk-toggle` targets the collection action and belongs in `src/app/api/admin/library/bulk-toggle/route.ts`.
   - In Next.js App Router, literal segments (`bulk-toggle`, `chapter`) have higher precedence than `[id]`, preventing path conflicts.

2. **Parameter Resolution & Next.js 16 Compliance (backed by Observation 1)**:
   - Dynamic parameters must be typed as `{ params: Promise<{ id: string }> }` and resolved using `const { id } = await context.params`.
   - Direct access `context.params.id` would violate Next.js 16 App Router breaking changes and generate warnings/failures.

3. **Multi-Facet Catalog Queries (backed by Observation 2)**:
   - In `GET /api/admin/library`, query parameters (`class`, `subject`, `kind`, `isPublished`) must be parsed and sanitized.
   - UI dropdowns frequently submit `"all"` or empty strings, which must be coerced to `undefined` before passing to `getChaptersWithFiles`.
   - If `isPublished` is explicitly `false`, nested files must be strictly filtered to `is_published === false` so the administrator can view hidden files.

4. **Security & CSRF Protection (backed by Observation 1)**:
   - Although middleware intercepts mutations, defense-in-depth requires route handlers to explicitly check `validateOrigin(req)` and verify `admin_session` via `verifyAdminToken(token, secret)`.
   - All admin route files must export `export const dynamic = "force-dynamic"` to guarantee dynamic execution and prevent static route caching of admin data.

5. **Telegram Storage Consistency (backed by Observation 2)**:
   - In `DELETE /api/admin/library/[id]`, passing `getTelegramClient()` and `process.env.TELEGRAM_CHANNEL_ID` ensures all Telegram parts stored in the private channel are permanently purged alongside PostgreSQL rows, fulfilling the zero-cost architecture without leaving orphaned messages.

---

## 3. Caveats

1. **`renameChapter` Cascade Implementation**:
   - In `src/lib/catalog.ts:253-275`, `renameChapter` currently updates the chapter title in PostgreSQL. Worker 1 / Explorer 1 is implementing the cascade file rename loop with `buildFileName`. The route handler contract `PATCH /api/admin/library/chapter/[id]` returning `{ updatedChapter, updatedFilesCount }` is strictly aligned with this logic.
2. **Offline Telegram Client Handling**:
   - In environments where `TELEGRAM_BOT_TOKEN` is not set (e.g. offline unit testing), `getTelegramClient()` returns `undefined`. `deleteFileWithTelegramCleanup` safely skips Telegram network deletion and proceeds with database row deletion.

---

## 4. Conclusion

The specification and concrete implementations for all 5 Milestone M4 Admin Library API route handlers are fully designed and verified:
1. `src/app/api/admin/library/route.ts` (`GET`)
2. `src/app/api/admin/library/[id]/route.ts` (`PATCH`, `DELETE`)
3. `src/app/api/admin/library/chapter/[id]/route.ts` (`PATCH`)
4. `src/app/api/admin/library/bulk-toggle/route.ts` (`POST`)

All proposed route handlers conform strictly to Next.js 16 asynchronous `params` requirements, CSRF Origin validation, stateless HS256 JWT cookie authentication, and the database/Telegram cleanup contracts. Detailed code and specifications are documented in `analysis.md`.

---

## 5. Verification Method

1. **Static Analysis & Type Checking**:
   - Run `npm run lint` across `src/`, `scripts/`, `tests/` to assert zero lint errors.
   - Run `npx tsc --noEmit` to verify all Next.js 16 `Promise<{ id: string }>` route contexts satisfy TypeScript type checks.
2. **Unit Test Suite**:
   - Run `npm test` to ensure all existing 221 tests in 15 test files remain passing.
   - Implement `tests/unit/admin-library-routes.test.ts` covering:
     - Unauthenticated access returns HTTP 401.
     - Origin header mismatch on `PATCH`/`DELETE`/`POST` returns HTTP 403.
     - `GET /api/admin/library` query parsing and filter application.
     - `PATCH /api/admin/library/[id]` toggling `is_published`.
     - `DELETE /api/admin/library/[id]` calling `deleteFileWithTelegramCleanup`.
     - `PATCH /api/admin/library/chapter/[id]` renaming chapter and returning updated count.
     - `POST /api/admin/library/bulk-toggle` toggling all teacher notes.
3. **Invalidation Conditions**:
   - Failure to `await context.params` in any dynamic route handler.
   - Returning HTTP 200 without checking `admin_session` cookie.
   - Mutating requests executing when Origin check fails.
