# Original User Request

## 2026-10-04T09:42:05Z

Build the Phase 1 Admin Portal, Auto-Naming Engine, Chunked Upload System, and Library Management for "SST Chapter Library", adhering strictly to the zero-cost architecture with private Telegram channel chunked storage and Supabase catalog indexing.

Working directory: c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY
Integrity mode: development

## Requirements

### R1. Admin Authentication & Session Security
- Implement the admin login endpoint (`/api/admin/login`) and interface (`/admin/login`).
- Verify credentials against the `ADMIN_PASSWORD_HASH` scrypt hash using constant-time comparison (`timingSafeEqual`).
- Issue a signed JWT session stored in an `httpOnly`, `Secure`, `SameSite=Strict` cookie valid for 12 hours.
- Implement in-memory IP-based rate limiting (maximum 5 failed attempts per 15 minutes per IP; return 429 on 6th attempt).
- Protect all `/admin/*` pages and `/api/admin/*` routes server-side; reject bad Origin headers on mutating requests. Ensure public routes remain accessible without credentials.

### R2. Deterministic Auto-Naming & Magic-Byte Validation
- Implement the pure function `buildFileName({ class, subject, chapterNo, title, kind, teacherName, ext, existingNames })` matching pattern `{Chapter-Title}_Class{C}_{Subject}_Ch{NN}_{Type}.{ext}`.
- Sanitization rules: title spaces to hyphens, alphanumeric and hyphens only, collapsed hyphens, max 60 chars. Duplicate teacher names get `-2`, `-3`. Output must match `^[A-Za-z0-9._-]+$`.
- Telegram caption formatting: `title=...|class=...|subject=...|ch=...|kind=...|name=...|sha=...|part=n/total`.
- Server-side magic-byte validation without writing to disk:
  - PDF: `%PDF-` at start of part 1, `%%EOF` near end of last part.
  - PPTX: ZIP signature in part 1, central directory read from final parts to confirm `[Content_Types].xml` with presentationml and zip-bomb entry size safeguards.
- Enforce PPTX uploads require an accompanying PDF preview export (`ppt` row linked to `ppt_pdf` row via `parent_file_id`).

### R3. Chunked Multi-Part Telegram Upload Engine
- Slicing: Client slices files into parts of at most 19 MiB (`PART_SIZE_BYTES = 19 * 1024 * 1024`).
- Sequential upload API (`/api/admin/upload/part` and `/api/admin/upload/complete`):
  - In-memory session tracking (expires after 30 min).
  - Out-of-order, duplicate, or oversized parts (> 19 MiB) rejected.
  - Incremental SHA-256 computation across stream.
  - Forward parts sequentially to Telegram channel; hold at most one part in memory per request; global upload lock.
- Automatic Rollback: If any part fails or database insertion fails, delete all Telegram messages already sent for that file and write nothing to the database.
- Chapter auto-creation in `chapters` table if not already present. Duplicate files (same chapter + sha256) rejected with friendly message.

### R4. Admin Library Management Dashboard
- Admin library interface at `/admin`:
  - List and filter published/hidden files by class, subject, and kind.
  - Rename chapter title with cascade update.
  - Toggle visibility (hide/unhide file; hide all teacher notes toggle).
  - Delete file: deletes database records and all associated Telegram part messages.

## Acceptance Criteria

### Security & Access Control
- [ ] 5 failed admin login attempts within 15 minutes trigger HTTP 429 on the 6th attempt.
- [ ] Direct unauthenticated GET to `/admin` or `/api/admin/*` returns 401 or redirect.
- [ ] Tampered JWT tokens or expired sessions are rejected.
- [ ] Mutating admin requests with invalid or missing Origin headers are rejected.

### Naming & Validation
- [ ] Unit tests for `buildFileName` pass on standard, messy (accents, emojis, symbols), zero-padded, and duplicate teacher name cases.
- [ ] Magic-byte validator accepts valid PDFs and PPTX files and rejects renamed `.exe`, empty files, and corrupted headers.
- [ ] PPTX upload without accompanying PDF export is rejected with a validation error.

### Upload & Chunking Reliability
- [ ] Mocked upload unit tests verify that a failure on part 3 of 5 deletes parts 1 and 2 and leaves no database rows.
- [ ] File splitting unit tests verify sizes (1 byte, exactly 19 MiB, 19 MiB + 1, 45 MB, 100 MB) produce correct part counts <= 19 MiB and reassemble to identical SHA-256.
- [ ] Real Telegram smoke test (`npm run smoke:telegram`) successfully uploads a test PDF to the channel, reads it back with `getFile`, verifies SHA-256 match, and deletes it.
- [ ] Real big-file smoke test (`npm run smoke:telegram -- --big`) generates a ~45 MB test file, uploads it as 3 parts, reads all back, verifies SHA-256 match, and cleans up completely.

### System Health & Quality
- [ ] `npm run build` and `npm run lint` pass with zero errors.
- [ ] `npm run preflight` remains 5/5 green.
- [ ] Secret scan across repo, git history, and `.next/static` confirms zero key leakage.
- [ ] Verification table written to `docs/verification/phase-1.md`.
