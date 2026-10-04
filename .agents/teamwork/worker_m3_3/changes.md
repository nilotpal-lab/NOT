# Changes Log — Milestone M3 Iteration 2 (Upload Session TTL Rollback)

## 1. `src/lib/upload-session.ts`
- **Replaced with drop-in implementation designed in `proposed_upload-session.ts`**:
  - Added `peekSession(uploadId: string): UploadSessionData | null` to allow callers to inspect active or expired sessions without mutating state.
  - Added `isSessionExpired(uploadIdOrSession: string | UploadSessionData): boolean` to calculate expiration relative to `sessionTtlMs`.
  - Updated `getSession(uploadId, options)` to support `{ includeExpired?: boolean; allowExpired?: boolean; rollbackOnExpire?: boolean; tgClient?: TelegramClientLike }`. When a session is expired:
    - If `includeExpired`/`allowExpired` is true, returns session object without deleting it, enabling route-level custom rollback.
    - If not requested, defaults `rollbackOnExpire = true`, rolls back `session.uploadedMessageIds` asynchronously, purges the session from memory, and returns `null`.
  - Updated `uploadPart`:
    - Checks session TTL before acquiring concurrency locks.
    - If expired, awaits `rollbackTelegramMessages(session.uploadedMessageIds, client, channel)`, deletes session and lock, and throws `new Error("Upload session expired (30m TTL)")`.
  - Updated `completeUpload`:
    - Checks session TTL at entry.
    - If expired, awaits `rollbackTelegramMessages(session.uploadedMessageIds, tgClient, channel)`, deletes session and lock, and throws `new Error("Upload session expired (30m TTL)")`.
  - Updated `cleanupExpiredSessions(options)`:
    - Defaults `shouldRollback = options?.rollback !== false` (true by default).
    - Resolves client via `options?.tgClient || this.getTelegramClient()`.
    - Gathers all expired sessions with uploaded message IDs, dispatches rollbacks, and properly awaits `Promise.all(rollbackPromises)` before returning the count of cleaned sessions.
  - Added `startReaper()` / `stopReaper()` periodic background sweeper utilizing `.unref()`.

## 2. `src/app/api/admin/upload/part/route.ts`
- **Session Lookup & Expiration Handling**:
  - Replaced `uploadSessionManager.getSession(uploadId)` lookup with `peekSession(uploadId)` (fallback `getSession(uploadId, { includeExpired: true })`).
  - Evaluates `isSessionExpired(uploadId)` against `SESSION_TTL_MS` (30 minutes).
  - When expired:
    - Awaits `uploadSessionManager.rollbackSessionTelegram(uploadId, tgClient, channelId)`.
    - Deletes session via `uploadSessionManager.deleteSession(uploadId)`.
    - Returns `NextResponse.json({ error: "Upload session expired (30m TTL)" }, { status: 410 })`.
  - If session does not exist and `partNo === 1`, starts a new session. If `partNo > 1`, returns HTTP 404.

## 3. `src/app/api/admin/upload/complete/route.ts`
- **Session Lookup & Expiration Handling**:
  - Replaced `uploadSessionManager.getSession(uploadId)` with `peekSession(uploadId)` (fallback `getSession(uploadId, { includeExpired: true })`).
  - If session not found, returns HTTP 404.
  - Evaluates `isSessionExpired(uploadId)`.
  - When expired:
    - Awaits `executeRollbackAndCleanup()` (`rollbackSessionTelegram` + `deleteSession`).
    - Returns `NextResponse.json({ error: "Upload session expired (30m TTL)" }, { status: 410 })`.

## 4. `tests/unit/rollback.test.ts`
- Added imports for `uploadSessionManager`, `TelegramClient`, `partRouteHandler`, `completeRouteHandler`, `createAdminToken`, `ADMIN_COOKIE_NAME`, `NextRequest`.
- Added default test environment fallback variables (`SESSION_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `ADMIN_PASSWORD_HASH`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GROQ_API_KEY`) in `beforeEach`.
- Appended 8 unit tests:
  - `R1.7a`: verifies `cleanupExpiredSessions()` automatically deletes orphaned Telegram parts by default.
  - `R1.7b`: verifies `getSession()` on expired session triggers Telegram rollback of uploaded parts and returns null.
  - `R1.7c`: verifies `uploadPart()` on expired session after partial upload triggers Telegram rollback and rejects.
  - `R1.7d`: verifies `completeUpload()` on expired session after partial upload triggers Telegram rollback and rejects.
  - `R1.7e`: verifies route `POST /api/admin/upload/part` after 30m TTL rolls back prior Telegram parts and returns HTTP 410.
  - `R1.7f`: verifies route `POST /api/admin/upload/complete` after 30m TTL rolls back all parts and returns HTTP 410.
  - `R1.7g`: verifies `cleanupExpiredSessions()` handles zero-part expired session gracefully.
  - `R1.7h`: verifies active session within TTL is preserved by `cleanupExpiredSessions()`.
