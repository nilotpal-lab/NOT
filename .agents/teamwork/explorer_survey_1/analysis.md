# Authoritative Codebase & App Architecture Survey: Phase 1 Readiness

**Surveyor**: Explorer 1 (`teamwork_preview_explorer`)  
**Target Repository**: `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY`  
**Date**: 2026-10-04  
**Status**: COMPLETE — Read-Only Architecture Survey  

---

## Executive Summary

The repository `sst-library` has successfully concluded Phase 0 foundation setup with all 5 preflight checks passing (`npm run preflight`: 5/5 green) and all 7 baseline unit tests passing (`npm test`: 7/7 pass in 183ms). The codebase is configured with **Next.js 16.3.8** (App Router), **React 19.3.0**, **Tailwind CSS v4.3.3**, **TypeScript 5.8.0** (strict mode), **Vitest 3.2.7**, and **Playwright 1.63.0**.

For Phase 1 (Admin Portal, Auto-Naming Engine, Chunked Telegram Upload, and Library Management Dashboard), the core cryptographic primitives (`scrypt` hashing, constant-time comparison, JWT signing/verifying) and initial Telegram/Supabase clients are established in `src/lib/`. However:
1. **No Next.js Middleware** (`middleware.ts`) exists yet.
2. **No Admin routes** exist yet (neither UI pages `/admin`, `/admin/login` nor API handlers `/api/admin/*`).
3. **No file chunking, streaming upload API, or auto-naming logic** is implemented yet.
4. `scripts/smoke-telegram.ts` is registered in `package.json` scripts but the script file does not yet exist.

Below is the authoritative, verified breakdown of the existing architecture, configurations, and Phase 1 implementation blueprint.

---

## 1. Dependencies & Package Scripts Survey (`package.json`)

**File Path**: `package.json` (52 lines)

### 1.1 Dependency Breakdown

- **Next.js**: `^16.3.8` (App Router, standalone server build)
- **React & React-DOM**: `^19.3.0`
- **Database**: `@supabase/supabase-js` `^2.117.2`
- **Crypto & Auth**: `jose` `^6.2.12` (JWT generation/verification via Web Crypto / Uint8Array)
- **Validation**: `zod` `^3.24.2`
- **AI SDK**: `groq-sdk` `^1.6.0`
- **Logging**: `pino` `^10.4.0`, `pino-pretty` `^13.0.0`
- **Environment**: `dotenv` `^16.4.7`
- **CSS / Styling**: `tailwindcss` `^4.3.3`, `@tailwindcss/postcss` `^4.3.3`, `postcss` `^8.4.38`
- **Testing**: `vitest` `^3.0.0`, `@playwright/test` `^1.63.0`
- **Tooling**: `tsx` `^4.23.15`, `typescript` `^5.8.0`, `eslint` `^9.0.0`, `typescript-eslint` `^8.71.0`

### 1.2 Package Scripts Analysis

| Script Name | Command | Purpose & Phase Status |
| :--- | :--- | :--- |
| `dev` | `next dev` | Local development server on port 3000. |
| `build` | `next build` | Next.js standalone build. Verified passing clean. |
| `start` | `next start` | Production standalone server execution. |
| `lint` | `eslint src/ scripts/ tests/` | ESLint 9 flat config linting. Verified 0 errors. |
| `test` | `vitest run` | Runs Vitest unit test suite. Verified 7/7 passing. |
| `test:watch` | `vitest` | Vitest watcher for TDD. |
| `e2e` | `playwright test` | Playwright test suite (targets `./tests/e2e`). |
| `preflight` | `tsx scripts/preflight.ts` | 5-point live integration test. Verified 5/5 green. |
| `db:check` | `tsx scripts/db-check.ts` | Exhaustive table, check constraint, unique constraint, and RLS check against Supabase. Verified passing. |
| `find-channel-id` | `tsx scripts/find-channel-id.ts` | Telegram Bot API updater to discover private channel ID. Verified functional. |
| `hash-password` | `tsx scripts/hash-password.ts` | Scrypt password generator for `ADMIN_PASSWORD_HASH`. Verified functional. |
| `smoke:telegram` | `tsx scripts/smoke-telegram.ts` | **Missing file!** Target for Phase 1 verification (`npm run smoke:telegram` and `--big`). |
| `eval:chat` | `tsx scripts/eval-chat.ts` | Script placeholder for Phase 3 AI evaluation. |
| `backup` | `tsx scripts/backup.ts` | Script placeholder for Phase 4 disaster recovery. |
| `restore` | `tsx scripts/restore.ts` | Script placeholder for Phase 4 disaster recovery. |
| `verify-library` | `tsx scripts/verify-library.ts` | Script placeholder for Phase 4 integrity audit. |
| `smoke:prod` | `tsx scripts/smoke-prod.ts` | Script placeholder for Phase 4 live production check. |

---

## 2. Next.js & Tooling Configuration Survey

### 2.1 Next.js Configuration (`next.config.ts`)

**File Path**: `next.config.ts` (lines 1-9)
```typescript
1: import type { NextConfig } from "next";
2: 
3: const nextConfig: NextConfig = {
4:   output: "standalone",
5:   serverExternalPackages: ["pino", "pino-pretty"],
6: };
7: 
8: export default nextConfig;
```
- **`output: "standalone"`**: Generates self-contained server assets inside `.next/standalone`, suitable for Render free container deployment without full node_modules overhead.
- **`serverExternalPackages`**: Explicitly preserves `pino` and `pino-pretty` as external Node.js packages to prevent bundling errors in Next.js server compilation.

### 2.2 TypeScript Configuration (`tsconfig.json`)

**File Path**: `tsconfig.json` (lines 1-42)
- **Compiler target**: `ES2022`
- **Module resolution**: `bundler`
- **Strict mode**: `"strict": true` (type safety enforced)
- **Path Aliasing**:
  - `"@/*": ["./src/*"]` (lines 26-28)
- **Includes**: Includes `next-env.d.ts`, `**/*.ts`, `**/*.tsx`, `.next/types/**/*.ts`, `.next/dev/types/**/*.ts`.
- **Excludes**: `node_modules`.

### 2.3 PostCSS & Tailwind v4 Configuration

- **`postcss.config.mjs`** (lines 1-6): Configured with `@tailwindcss/postcss: {}`.
- **`src/app/globals.css`** (lines 1-44):
  - Uses `@import "tailwindcss";` (Tailwind v4 syntax without `tailwind.config.js`).
  - Sets design token CSS variables adhering to the design brief:
    - Light: `--background: #fbf9f5`, `--foreground: #2d3748`, `--card-bg: #ffffff`, `--border-color: #e2e8f0`, `--accent: #2e7d6b`, `--accent-hover: #246456`, `--muted: #718096`.
    - Dark (`prefers-color-scheme: dark`): `--background: #18191a`, `--foreground: #e4e6eb`, `--card-bg: #242526`, `--border-color: #3a3b3c`, `--accent: #38a189`, `--accent-hover: #48bb9f`, `--muted: #a0aec0`.
    - Accessibility: WCAG AA contrast, body font 17px/1.6, `prefers-reduced-motion` zeroing animation durations.

### 2.4 ESLint Configuration (`eslint.config.mjs`)

**File Path**: `eslint.config.mjs` (lines 1-18)
- Uses flat config with `@eslint/js` and `typescript-eslint`.
- Ignored paths: `.next/**`, `node_modules/**`, `coverage/**`, `*.d.ts`.
- Rules tuned: `@typescript-eslint/no-unused-vars: "off"`, `@typescript-eslint/no-explicit-any: "warn"`, `"no-undef": "off"`.

---

## 3. Existing Routes & Directory Layout Survey

### 3.1 Directory Structure

```
c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\
├── docs/
│   └── verification/
│       └── phase-0.md             # Verified Phase 0 sign-off
├── scripts/
│   ├── db-check.ts                # Deep DB schema check (254 lines)
│   ├── find-channel-id.ts         # Telegram channel polling (72 lines)
│   ├── hash-password.ts           # Admin password hasher (60 lines)
│   └── preflight.ts               # 5-check system preflight (241 lines)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── health/
│   │   │       └── route.ts       # Health endpoint (60 lines)
│   │   ├── globals.css            # Tailwind v4 theme & CSS vars (44 lines)
│   │   ├── layout.tsx             # Root layout with header/footer (49 lines)
│   │   └── page.tsx               # Home landing page with Class 6-10 buttons (37 lines)
│   └── lib/
│       ├── auth.ts                # scrypt & JWT signing/verifying (59 lines)
│       ├── db.ts                  # Supabase client & schema checker (102 lines)
│       ├── groq.ts                # Groq SDK client & model checker (58 lines)
│       ├── logger.ts              # Pino logger with secret redactor (35 lines)
│       ├── telegram.ts            # TelegramClient wrapper (146 lines)
│       └── validate.ts            # Zod env schema & PART_SIZE_BYTES (63 lines)
├── supabase/
│   └── schema.sql                 # DDL for chapters, files, file_parts (50 lines)
└── tests/
    └── unit/
        └── env.test.ts            # 7 Vitest tests for env & auth (97 lines)
```

### 3.2 Existing vs Missing Routes

1. **Existing Routes**:
   - `GET /`: `src/app/page.tsx` (Public homepage with Class 6-10 selection grid).
   - `GET /api/health`: `src/app/api/health/route.ts` (Dynamic health route verifying DB and Telegram connection).
2. **Missing Routes Required for Phase 1**:
   - `GET /admin`: Needs `src/app/admin/page.tsx` (Admin dashboard: library listing, filters by class/subject/kind, rename chapter, toggle visibility, delete file).
   - `GET /admin/login`: Needs `src/app/admin/login/page.tsx` (Admin login form).
   - `POST /api/admin/login`: Needs `src/app/api/admin/login/route.ts` (Validates password against `ADMIN_PASSWORD_HASH`, rate limits 5 failed attempts per 15 min, issues 12-hour `admin_session` cookie).
   - `POST /api/admin/logout`: Needs `src/app/api/admin/logout/route.ts` (Clears session cookie).
   - `POST /api/admin/upload/part`: Needs `src/app/api/admin/upload/part/route.ts` (Chunked multi-part upload endpoint, streams part to Telegram, computes incremental SHA-256, holds upload session).
   - `POST /api/admin/upload/complete`: Needs `src/app/api/admin/upload/complete/route.ts` (Finalizes file upload, validates magic bytes, persists chapter and file metadata in Supabase).
   - `GET /api/admin/library`: Needs `src/app/api/admin/library/route.ts` (Lists chapters & files including hidden status).
   - `PATCH /api/admin/library/chapter`: Needs chapter rename endpoint.
   - `PATCH /api/admin/library/file`: Needs file visibility toggle endpoint.
   - `DELETE /api/admin/library/file`: Needs file deletion endpoint (deletes database records and calls `deleteMessage` on Telegram for all part message IDs).

---

## 4. Existing Middleware, Headers & CORS / Origin Handling

### 4.1 Middleware Absence
- **Finding**: **No `middleware.ts` or `src/middleware.ts` currently exists.**
- In Next.js 16 App Router, `src/middleware.ts` is the standard location for intercepting incoming HTTP requests before routing.

### 4.2 Security Requirements for Phase 1 Middleware / Route Guards
From `ORIGINAL_REQUEST.md` (R1) & `SST-Library-FINAL-Antigravity-Prompt.md`:
1. **Public Route Pass-Through**:
   - `/`, `/class/*`, `/chapter/*`, `/api/health`, `/admin/login`, `/api/admin/login` must remain accessible without credentials.
2. **Admin Route Protection**:
   - Unauthenticated `GET /admin/*` must redirect to `/admin/login`.
   - Unauthenticated `GET /api/admin/*` must return HTTP `401 Unauthorized` JSON.
   - Tampered or expired JWT session tokens must be rejected.
3. **Origin Header Verification**:
   - For mutating admin requests (`POST`, `PUT`, `PATCH`, `DELETE`) to `/api/admin/*`, the server must verify the `Origin` (or `Referer`) header matches `SITE_URL` (or request origin) to prevent CSRF attacks. Bad or missing Origin on mutating requests must return HTTP `403 Forbidden`.
4. **Runtime Consideration**:
   - If using `src/middleware.ts`, Next.js middleware executes in the Edge / lightweight runtime. `jose` is 100% compatible with Edge runtime (as it uses Web Crypto standard APIs). Node `crypto.scrypt` is used only in `/api/admin/login`, which runs in the Node.js Route Handler runtime.

---

## 5. Environment Variable Handling & Definitions

### 5.1 Zod Environment Schema (`src/lib/validate.ts`)

**File Path**: `src/lib/validate.ts` (lines 5-24)
```typescript
5: export const envSchema = z.object({
6:   TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
7:   TELEGRAM_CHANNEL_ID: z.string().min(1, "TELEGRAM_CHANNEL_ID is required"),
8:   SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
9:   SUPABASE_SERVICE_KEY: z.string().min(1, "SUPABASE_SERVICE_KEY is required"),
10:   GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY is required"),
11:   GROQ_MODEL: z.string().default("llama-3.1-8b-instant"),
12:   GROQ_FALLBACK_MODEL: z.string().default("llama-3.3-70b-versatile"),
13:   ADMIN_PASSWORD_HASH: z.string().min(1, "ADMIN_PASSWORD_HASH is required"),
14:   SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
15:   SITE_URL: z.string().url("SITE_URL must be a valid URL").default("http://localhost:3000"),
16:   CONTACT_EMAIL: z.string().optional().or(z.literal("")),
17:   MAX_FILE_MB: z
18:     .coerce
19:     .number()
20:     .int()
21:     .min(1, "MAX_FILE_MB must be at least 1")
22:     .max(200, "MAX_FILE_MB cannot exceed 200")
23:     .default(100),
24: });
```

### 5.2 Constant Definition
- `PART_SIZE_BYTES = 19 * 1024 * 1024` (19,922,944 bytes = 19 MiB) is exported at `src/lib/validate.ts` line 3.

### 5.3 Secret Redaction & Logging Safeguards
- In `src/lib/validate.ts` lines 36-47: Error reporting outputs only the affected variable names (e.g. `Variable 'SUPABASE_URL': ...`), never the input values.
- In `src/lib/logger.ts` lines 3-23: Pino configuration redacts all credential fields (`TELEGRAM_BOT_TOKEN`, `SUPABASE_SERVICE_KEY`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `*.token`, `headers.cookie`, etc.).
- In `src/lib/telegram.ts` lines 67-72: `TelegramClient.sanitizeError()` explicitly strips `this.token` from any thrown error messages.

---

## 6. Test Infrastructure & Preflight Scripts

### 6.1 Vitest Configuration & Tests

**File Path**: `vitest.config.ts` (lines 1-16)
- Node environment, globals enabled, aliases `@` -> `./src`.
- Current unit tests: `tests/unit/env.test.ts` (97 lines):
  - Validates full `envSchema` parsing.
  - Ensures zero leakage of secrets in validation errors.
  - Verifies `MAX_FILE_MB` 200 upper bound.
  - Asserts `PART_SIZE_BYTES` is strictly equal to `19922944` and below 20 MiB.
  - Tests scrypt `hashPassword` and `verifyPassword`.
  - Tests `createAdminToken` and `verifyAdminToken` (including tampered token rejection).

### 6.2 Preflight Script (`scripts/preflight.ts`)

**File Path**: `scripts/preflight.ts` (241 lines)
- Executes 5 live integration checks:
  1. `PRE-1`: Environment variables validation via Zod.
  2. `PRE-2`: Supabase tables (`chapters`, `files`, `file_parts`) and RLS status check via `checkDatabaseSchema()`.
  3. `PRE-3`: Telegram Bot API `getMe()` verification.
  4. `PRE-4`: Telegram Channel test message posting and immediate deletion.
  5. `PRE-5`: Groq API key and model list check (`GROQ_MODEL`, `GROQ_FALLBACK_MODEL`).
- Status: **All 5 checks verified PASS.**

### 6.3 Missing Test Assets for Phase 1

To fulfill Phase 1 Acceptance Criteria and Checks 1.1 - 1.10:
1. `tests/unit/naming.test.ts`:
   - Unit tests for `buildFileName` covering standard format, messy titles, punctuation, accents, zero-padding, duplicate teacher naming (`-2`, `-3`), and `^[A-Za-z0-9._-]+$` regex compliance.
2. `tests/unit/validator.test.ts`:
   - Magic-byte validation tests: valid PDF (`%PDF-` / `%%EOF`), valid PPTX (`[Content_Types].xml` in central directory), corrupted headers, renamed `.exe`, empty files.
   - File size splitting tests: 1 byte, 19 MiB, 19 MiB + 1, 45 MB, 100 MB.
3. `tests/unit/auth.test.ts`:
   - IP rate limiting tests (5 failed attempts per 15 min, 429 on 6th attempt).
   - Session cookie options validation (`httpOnly`, `Secure`, `SameSite=Strict`, 12h expiry).
   - Origin header check verification.
4. `tests/unit/upload.test.ts`:
   - Upload session lifecycle, out-of-order rejection, duplicate part rejection, > 19 MiB rejection.
   - Mocked upload rollback on part failure (e.g. failure on part 3 of 5 deletes parts 1 and 2 and leaves no database rows).
   - Duplicate file check (same chapter + sha256).
   - PPTX without accompanying PDF preview rejection.
5. `scripts/smoke-telegram.ts`:
   - Live smoke test script testing small PDF upload/download/verify/delete and `--big` (~45 MB 3-part file) upload/download/verify/delete against real channel.

---

## 7. Database & Schema Specifications

**File Path**: `supabase/schema.sql` (lines 1-50)

### 7.1 Schema Definitions
1. `chapters`:
   - `id uuid primary key default gen_random_uuid()`
   - `class smallint check (class between 6 and 10)`
   - `subject text check (subject in ('History','Geography','Civics','Economics','SocialScience'))`
   - `chapter_no smallint check (chapter_no between 1 and 99)`
   - `title text check (length(title) between 2 and 200)`
   - `unique (class, subject, chapter_no)`
   - GIN Trigram index on `title gin_trgm_ops`
2. `files`:
   - `id uuid primary key default gen_random_uuid()`
   - `chapter_id uuid references chapters(id) on delete cascade`
   - `kind text check (kind in ('ncert_pdf','ppt','ppt_pdf','teacher_notes'))`
   - `parent_file_id uuid references files(id) on delete cascade`
   - `file_name text unique`
   - `teacher_name text`
   - `size_bytes bigint check (size_bytes > 0 and size_bytes <= 209715200)` (200 MiB limit)
   - `part_count smallint default 1`
   - `mime text check (mime in ('application/pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation'))`
   - `sha256 text`
   - `is_published boolean default true`
   - `unique (chapter_id, sha256)`
3. `file_parts`:
   - `file_id uuid references files(id) on delete cascade`
   - `part_no smallint check (part_no >= 1)`
   - `tg_file_id text`
   - `tg_file_unique_id text`
   - `tg_message_id bigint`
   - `size_bytes integer check (size_bytes > 0 and size_bytes <= 19922944)` (19 MiB limit)
   - `sha256 text`
   - `primary key (file_id, part_no)`

### 7.2 Security Policy (RLS)
- RLS is explicitly enabled on all 3 tables with **zero public anon policies**.
- Backend connects exclusively using `SUPABASE_SERVICE_KEY` in `src/lib/db.ts`, which bypasses RLS on server-side queries while completely locking out direct browser/anon queries.

---

## 8. Architectural Recommendations for Phase 1 Implementation

1. **Telegram Multi-Part API Expansion** (`src/lib/telegram.ts`):
   - Add `sendDocument(channelId, buffer, filename, caption)` using `multipart/form-data`.
   - Add `getFile(fileId)` to retrieve Telegram file download paths.
   - Add `downloadFile(filePath)` to stream/download Telegram file parts for smoke test verification and downloads.
2. **Auto-Naming & Magic-Byte Utilities** (`src/lib/naming.ts` & `src/lib/magic.ts` or extended `src/lib/validate.ts`):
   - Implement `buildFileName` with title sanitization, subject enums, zero-padding, type suffixes, duplicate teacher indexing (`-2`, `-3`), and `^[A-Za-z0-9._-]+$` validation.
   - Implement in-memory magic-byte detection for PDF (`%PDF-` at start of part 1, `%%EOF` near end of last part) and PPTX (ZIP signature `PK\x03\x04` and ZIP central directory `[Content_Types].xml` inspection).
3. **Session & Rate-Limiting Engine** (`src/lib/auth.ts`):
   - Add in-memory sliding window or bucket rate limiter for IP addresses: 5 failed attempts within 15 minutes; reject on 6th attempt with HTTP 429 (`Retry-After: 900`).
   - Add cookie helpers for `admin_session` (`httpOnly: true`, `secure: process.env.NODE_ENV === "production"`, `sameSite: "strict"`, `maxAge: 12 * 60 * 60`).
   - Add Origin verification helper comparing `request.headers.get("origin")` to `SITE_URL`.
4. **Next.js Middleware** (`src/middleware.ts`):
   - Protect `/admin/:path*` (redirecting unauthenticated requests to `/admin/login`, except `/admin/login` itself).
   - Protect `/api/admin/:path*` (returning 401 for unauthenticated requests, except `/api/admin/login`).
   - Enforce Origin checks on mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) to `/api/admin/*`.
5. **Sequential Chunk Upload Engine** (`src/app/api/admin/upload/*`):
   - Implement `UploadSessionManager` in memory with 30-minute expiration and a global upload mutex.
   - Part endpoint `/api/admin/upload/part`: validates chunk size (<= 19 MiB), checks part index continuity, streams part to Telegram, updates incremental SHA-256.
   - Complete endpoint `/api/admin/upload/complete`: validates magic bytes across parts, verifies whole-file SHA-256, auto-creates chapter in `chapters` table, saves `files` and `file_parts` in Supabase. On any error, executes rollback by deleting all sent Telegram messages via `deleteMessage`.
6. **Admin Dashboard UI**:
   - `/admin/login`: Clean form matching the design brief (calm, accessible, WCAG AA, dark mode support).
   - `/admin`: Dashboard with library management table (Class, Subject, Chapter, Title, Files, Visibility toggle, Rename Chapter, Delete File with modal confirmation, and multi-part upload form with chunking progress bar).
7. **Smoke Test Script** (`scripts/smoke-telegram.ts`):
   - Implements both standard tiny PDF verification and `--big` (~45 MB 3-part file) upload, download, SHA-256 match, and deletion cleanup.
