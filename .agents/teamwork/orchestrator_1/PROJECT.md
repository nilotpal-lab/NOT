# Project: SST Chapter Library — Phase 1

## Architecture
- **Framework**: Next.js 16.3.8 (App Router), React 19.3.0, TypeScript 5.8.0, Tailwind CSS v4.
- **Database**: Supabase PostgreSQL with strict RLS (0 anon policies, server-side service-role client via `src/lib/db.ts`).
- **Storage**: Zero-cost chunked Telegram channel storage (`src/lib/telegram.ts`), 19 MiB (`19922944` bytes) chunk ceiling.
- **Authentication**: Stateless 12h HS256 JWT in `httpOnly`, `Secure`, `SameSite=Strict` cookie (`src/lib/auth.ts`, `src/middleware.ts`), constant-time scrypt password verification, IP rate limiting (5 failed attempts per 15 min).
- **Upload Engine**: Streamed multipart slicing with in-memory session tracking (30m TTL), incremental SHA-256 computation, automatic Telegram rollback on error, and duplicate detection.
- **Admin Dashboard**: `/admin` library management and `/admin/login`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Scrypt Constant-Time Login | `/api/admin/login` validating against `ADMIN_PASSWORD_HASH` using `crypto.timingSafeEqual` | M1 (Auth) | Survey/R1 |
| 2 | JWT Session Cookie | Issue 12h signed HS256 JWT in `httpOnly`, `Secure`, `SameSite=Strict` cookie | M1 (Auth) | Survey/R1 |
| 3 | IP Rate Limiting | In-memory limiter blocking on 6th failed attempt in 15 min window (HTTP 429) | M1 (Auth) | Survey/R1 |
| 4 | Origin & Middleware Protection | `src/middleware.ts` guarding `/admin/*` and `/api/admin/*`, validating Origin headers on mutations | M1 (Auth) | Survey/R1 |
| 5 | Admin Login UI | `/admin/login` clean interface with error display and redirect to `/admin` | M1 (Auth) | Survey/R1 |
| 6 | Deterministic `buildFileName` | Pure function generating `{Title}_Class{C}_{Subject}_Ch{NN}_{Type}.{ext}` matching `^[A-Za-z0-9._-]+$` | M2 (Naming & Validation) | Survey/R2 |
| 7 | Telegram Caption Formatter | Formatter producing `title=...|class=...|subject=...|ch=...|kind=...|name=...|sha=...|part=n/total` | M2 (Naming & Validation) | Survey/R2 |
| 8 | PDF Magic-Byte Stream Validation | Detect `%PDF-` at start of part 1, `%%EOF` near end of last part without writing to disk | M2 (Naming & Validation) | Survey/R2 |
| 9 | PPTX Magic-Byte Stream Validation | ZIP signature in part 1, central directory read to confirm `[Content_Types].xml` with presentationml | M2 (Naming & Validation) | Survey/R2 |
| 10 | PPTX Accompaniment Enforcement | Reject PPTX upload without accompanying PDF preview export (`parent_file_id` link) | M2 (Naming & Validation) | Survey/R2 |
| 11 | Telegram Client Expansion | Extend `TelegramClient` with `sendDocument`, `getFile`, `downloadFile`, extended timeout | M3 (Upload Engine) | Survey/R3 |
| 12 | Slicing & Part Validation | Validate parts <= 19 MiB (`19922944` bytes), in-order part sequencing | M3 (Upload Engine) | Survey/R3 |
| 13 | Upload Session Management | In-memory session tracking with 30m TTL, streaming incremental SHA-256 calculation | M3 (Upload Engine) | Survey/R3 |
| 14 | Sequential Telegram Forwarding | Stream parts to Telegram, hold at most 1 part in memory per request, global upload lock | M3 (Upload Engine) | Survey/R3 |
| 15 | Telegram & DB Rollback | Auto-delete sent Telegram messages if any part or DB insertion fails; 0 DB rows left | M3 (Upload Engine) | Survey/R3 |
| 16 | Chapter Auto-Creation & Dedup | Find or create chapter in `chapters`; reject duplicate files (`chapter_id` + `sha256`) | M3 (Upload Engine) | Survey/R3 |
| 17 | Admin Library UI | `/admin` dashboard displaying catalog with filtering by class, subject, kind, published | M4 (Library Dashboard) | Survey/R4 |
| 18 | Chapter Rename Cascade | Rename chapter title with cascade recalculation of dependent `file_name`s | M4 (Library Dashboard) | Survey/R4 |
| 19 | File Visibility Toggles | Toggle individual file `is_published` and bulk toggle for all teacher notes | M4 (Library Dashboard) | Survey/R4 |
| 20 | File Deletion & Telegram Cleanup | Delete file records from DB and cleanly delete all Telegram part messages (prevent leaks) | M4 (Library Dashboard) | Survey/R4 |
| 21 | E2E Testing Suite (Tiers 1-4) | Comprehensive opaque-box test suite across 4 tiers covering all requirements | M-E2E (Testing Track) | Survey/AC |
| 22 | Telegram Smoke Test Script | `scripts/smoke-telegram.ts` supporting standard PDF roundtrip and `--big` 45 MB 3-part roundtrip | M-E2E (Testing Track) | Survey/AC |
| 23 | Phase 1 Final Verification | 100% test pass, preflight 5/5, build/lint clean, secret scan, `docs/verification/phase-1.md` | M-FINAL (Verification) | Survey/AC |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M-E2E | E2E Testing Track | Test infra, Tier 1-4 test suites, `scripts/smoke-telegram.ts`, `TEST_READY.md` | none | DONE |
| M1 | Admin Authentication & Session Security | Features 1-5: scrypt login, JWT cookie, rate limiter, middleware guards, login UI | none | DONE |
| M2 | Deterministic Auto-Naming & Magic-Byte Validation | Features 6-10: `buildFileName`, captions, stream magic-bytes, PPTX accompaniment | none | DONE |
| M3 | Chunked Multi-Part Telegram Upload Engine | Features 11-16: extended TelegramClient, upload session, /api/admin/upload/*, rollback, dedup | M1, M2 | DONE |
| M4 | Admin Library Management Dashboard | Features 17-20: /admin UI, catalog APIs, rename cascade, visibility toggle, delete + tg cleanup | M1, M2, M3 | IN_PROGRESS |
| M-FINAL | Final Milestone & Quality Hardening | Phase 1 (100% E2E pass) + Phase 2 (Tier 5 Challenger hardening) + Health & Docs | M-E2E, M4 | PLANNED |

## Interface Contracts
### Auth Module (`src/lib/auth.ts`) ↔ Routes & Middleware
- `verifyPassword(plainText: string, storedHash: string): Promise<boolean>`
- `createAdminToken(secretString: string): Promise<string>`
- `verifyAdminToken(token: string, secretString: string): Promise<{ role: string } | null>`
- `checkRateLimit(ip: string): { allowed: boolean; remainingAttempts: number; retryAfterSeconds?: number }`
- `recordFailedAttempt(ip: string): void`
- `resetRateLimit(ip: string): void`
- `validateOrigin(req: Request): boolean`
- Cookie name: `admin_session`, `httpOnly: true`, `secure: true`, `sameSite: "strict"`, `maxAge: 12 * 60 * 60`

### Naming & Validation (`src/lib/naming.ts`, `src/lib/magic.ts`) ↔ Upload Engine
- `buildFileName(params: { class: number; subject: string; chapterNo: number; title: string; kind: string; teacherName?: string; ext: string; existingNames?: string[] }): string`
  - Pattern: `{Title}_Class{C}_{Subject}_Ch{NN}_{Type}.{ext}`
  - Validation: `^[A-Za-z0-9._-]+$`, max 60 chars for title slug
- `formatTelegramCaption(params: { title: string; class: number; subject: string; ch: number; kind: string; name: string; sha: string; part: number; total: number }): string`
- `validatePdfMagic(firstChunk: Buffer | Uint8Array, lastChunk?: Buffer | Uint8Array): { valid: boolean; error?: string }`
- `validatePptxMagic(firstChunk: Buffer | Uint8Array, lastChunk?: Buffer | Uint8Array): { valid: boolean; error?: string }`

### Telegram Client (`src/lib/telegram.ts`) ↔ Upload Engine
- `sendDocument(channelId: string, fileBuffer: Buffer | Uint8Array, fileName: string, caption?: string, timeoutMs?: number): Promise<{ messageId: number; fileId: string; fileUniqueId: string }>`
- `getFile(fileId: string): Promise<{ filePath: string; fileSize: number }>`
- `downloadFile(filePath: string, timeoutMs?: number): Promise<Buffer>`
- `deleteMessage(channelId: string, messageId: number): Promise<boolean>`

### Catalog Data Service (`src/lib/catalog.ts`) ↔ API & Admin UI
- `getChaptersWithFiles(filters?: { class?: number; subject?: string; kind?: string; publishedOnly?: boolean }): Promise<ChapterWithFiles[]>`
- `findOrCreateChapter(data: { class: number; subject: string; chapterNo: number; title: string }): Promise<Chapter>`
- `renameChapter(chapterId: string, newTitle: string): Promise<{ updatedChapter: Chapter; updatedFilesCount: number }>`
- `toggleFilePublished(fileId: string, isPublished: boolean): Promise<FileRecord>`
- `bulkToggleTeacherNotes(isPublished: boolean): Promise<number>`
- `deleteFileWithTelegramCleanup(fileId: string): Promise<{ deletedFileId: string; deletedMessageIds: number[] }>`

## Code Layout
```
src/
├── app/
│   ├── admin/
│   │   ├── page.tsx               # R4: Admin library management dashboard
│   │   ├── login/
│   │   │   └── page.tsx           # R1: Admin login page
│   ├── api/
│   │   ├── admin/
│   │   │   ├── login/route.ts     # R1: Admin login endpoint
│   │   │   ├── logout/route.ts    # R1: Admin logout endpoint
│   │   │   ├── session/route.ts   # R1: Session status check
│   │   │   ├── upload/
│   │   │   │   ├── part/route.ts  # R3: Chunked part upload
│   │   │   │   └── complete/route.ts # R3: Upload completion, DB record, rollback
│   │   │   ├── library/
│   │   │   │   ├── route.ts       # R4: Catalog list and queries
│   │   │   │   ├── [id]/route.ts  # R4: File delete & update
│   │   │   │   └── chapter/[id]/route.ts # R4: Chapter rename cascade
│   │   ├── health/route.ts        # Health check
├── lib/
│   ├── auth.ts                    # R1: scrypt, JWT, rate limiter, Origin validation
│   ├── naming.ts                  # R2: buildFileName, telegram caption formatting
│   ├── magic.ts                   # R2: PDF & PPTX stream magic-byte validator
│   ├── telegram.ts                # R3: extended Telegram client (sendDoc, getFile, download)
│   ├── upload-session.ts          # R3: in-memory upload tracker, chunk lock, rollback
│   ├── catalog.ts                 # R3 & R4: Supabase catalog data service
│   ├── db.ts                      # Supabase client & connection
│   └── validate.ts                # Constants & Zod env schemas
├── middleware.ts                  # R1: Next.js edge middleware for /admin protection
├── types/
│   └── database.ts                # TypeScript types for chapters, files, file_parts
scripts/
├── smoke-telegram.ts              # Telegram smoke test (single + --big 45 MB)
tests/
├── unit/
│   ├── env.test.ts
│   ├── auth.test.ts               # R1 unit tests
│   ├── naming.test.ts             # R2 unit tests
│   ├── magic.test.ts              # R2 magic byte unit tests
│   ├── chunking.test.ts           # R3 file splitting & SHA256 tests
│   └── rollback.test.ts           # R3 rollback mock tests
├── e2e/                           # E2E test suites (Tiers 1-4)
docs/
└── verification/
    └── phase-1.md                 # Verification evidence table
```
