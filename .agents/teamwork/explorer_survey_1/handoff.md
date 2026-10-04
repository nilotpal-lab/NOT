# Handoff Report: Codebase & App Architecture Survey (Phase 1 Baseline)

**Agent**: Explorer 1 (`teamwork_preview_explorer`)  
**Folder**: `.agents/teamwork/explorer_survey_1/`  
**Handoff Type**: Hard (Investigation complete, authoritative survey ready)  
**Recipient**: `orchestrator_1` (`fb1a83fa-301b-45dd-ba05-a3edc0267f37`)  
**Timestamp**: 2026-10-04T09:52:00Z  

---

## 1. Observation

### 1.1 Package & Dependencies (`package.json`)
- Lines 24-34 (`dependencies`):
  ```json
  "@supabase/supabase-js": "^2.117.2",
  "dotenv": "^16.4.7",
  "groq-sdk": "^1.6.0",
  "jose": "^6.2.12",
  "next": "^16.3.8",
  "pino": "^10.4.0",
  "react": "^19.3.0",
  "react-dom": "^19.3.0",
  "zod": "^3.24.2"
  ```
- Lines 35-50 (`devDependencies`):
  ```json
  "@playwright/test": "^1.63.0",
  "@tailwindcss/postcss": "^4.3.3",
  "@types/node": "^24.18.0",
  "@types/react": "^19.3.0",
  "@types/react-dom": "^19.3.0",
  "eslint": "^9.0.0",
  "eslint-config-next": "^16.3.8",
  "pino-pretty": "^13.0.0",
  "postcss": "^8.4.38",
  "tailwindcss": "^4.3.3",
  "tsx": "^4.23.15",
  "typescript": "^5.8.0",
  "typescript-eslint": "^8.71.0",
  "vitest": "^3.0.0"
  ```
- Line 17 (`scripts.smoke:telegram`): `"smoke:telegram": "tsx scripts/smoke-telegram.ts"`. File `scripts/smoke-telegram.ts` does not yet exist.

### 1.2 Configuration Files
- `next.config.ts` (lines 3-6):
  ```typescript
  const nextConfig: NextConfig = {
    output: "standalone",
    serverExternalPackages: ["pino", "pino-pretty"],
  };
  ```
- `tsconfig.json` (lines 26-28): `"paths": { "@/*": ["./src/*"] }`, target `ES2022`, strict `true`, moduleResolution `bundler`.
- `postcss.config.mjs` (lines 1-5): Configured with `@tailwindcss/postcss`. No `tailwind.config.*` file exists; styling is driven by Tailwind v4 via `src/app/globals.css`.
- `vitest.config.ts` (lines 4-15): Environment `node`, globals `true`, include `["tests/**/*.test.ts"]`, alias `@` -> `./src`.
- `playwright.config.ts` (lines 4-13): testDir `./tests/e2e`, webServer `npm run dev` on port 3000.

### 1.3 Routing & Directory Layout
- App Router is active under `src/app/`. There is no `pages/` directory.
- `src/app/layout.tsx` (lines 23-28): Contains a header link to `/admin`.
- `src/app/page.tsx` (lines 23-31): Contains class links (`/class/${cls}` for classes 6 to 10).
- `src/app/api/health/route.ts` (lines 1-60): Active health check endpoint (`GET`).
- **No `/admin` page exists** (`src/app/admin/page.tsx` is missing).
- **No `/admin/login` page exists** (`src/app/admin/login/page.tsx` is missing).
- **No `/api/admin/*` routes exist** (`src/app/api/admin/` does not exist).

### 1.4 Middleware & Security
- `find_by_name` for `*middleware*` (excluding `node_modules` and `.next`) returned 0 results.
- **No `middleware.ts` or `src/middleware.ts` exists.**
- No Origin header validation or CSRF check exists anywhere in the repository.

### 1.5 Authentication & Environment Primitives
- `src/lib/auth.ts` (lines 11-58):
  - `hashPassword(plainText)`: Scrypt with 16-byte random salt, output format `${salt}:${derivedKeyHex}`.
  - `verifyPassword(plainText, storedHash)`: Scrypt comparison using `crypto.timingSafeEqual`.
  - `createAdminToken(secretString)`: Issues signed JWT (`jose.SignJWT({ role: "admin" })`), alg HS256, expiration 12h.
  - `verifyAdminToken(token, secretString)`: Verifies token with `jose.jwtVerify`.
  - Cookie handling, IP rate limiting, and Origin validation are not yet implemented in `src/lib/auth.ts`.
- `src/lib/validate.ts` (lines 3-24):
  - Line 3: `export const PART_SIZE_BYTES = 19 * 1024 * 1024;`
  - Lines 5-24: `envSchema` requires `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GROQ_API_KEY`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `SITE_URL` (default `http://localhost:3000`), `MAX_FILE_MB` (default 100, max 200).

### 1.6 Telegram Client Baseline
- `src/lib/telegram.ts` (lines 55-145):
  - `TelegramClient` currently implements: `getMe()`, `postTestMessage()`, `deleteMessage()`, `getUpdates()`.
  - `sendDocument` (multipart chunk upload), `getFile` (file path retrieval), and `downloadFile` (file content streaming/fetching) are not yet implemented.

### 1.7 Current Test & Verification Execution
- Tool command: `npm test`
  - Result: Exit code 0, 7 tests passed (in `tests/unit/env.test.ts`).
- Tool command: `npm run lint`
  - Result: Exit code 0, 0 ESLint errors.
- Tool command: `npm run preflight`
  - Result: Exit code 0, 5/5 checks passed (Environment, Supabase & RLS, Telegram getMe, Channel Post/Delete, Groq models).

---

## 2. Logic Chain

1. **Phase 0 Health Confirmed**:
   - Observations 1.7 demonstrate that the existing repository passes all linting, unit tests, and live preflight checks. Thus, the foundation is stable and ready for Phase 1.
2. **Missing Admin Entry Points**:
   - Observations 1.3 show that `src/app/layout.tsx` already links to `/admin`, but neither `/admin` nor `/admin/login` exist. To meet Requirement R1 and R4, these pages must be created under `src/app/admin/`.
3. **Missing Authentication Infrastructure**:
   - Observations 1.4 and 1.5 show that while core hashing and JWT signing exist in `src/lib/auth.ts`, there is no `middleware.ts`, no cookie issue/clear handler, no IP rate limiter (5 attempts per 15 min), and no Origin header validator. Therefore, Phase 1 must implement these in `src/middleware.ts`, `src/lib/auth.ts`, and the `/api/admin/login` route handler.
4. **Missing Upload & Auto-Naming Pipeline**:
   - Observations 1.5 and 1.6 show that `PART_SIZE_BYTES = 19 * 1024 * 1024` is defined, but `buildFileName`, magic-byte detection (PDF and PPTX), and Telegram document chunk upload (`sendDocument`, `getFile`) are absent. Therefore, Phase 1 must implement `src/lib/naming.ts`, `src/lib/magic.ts`, extend `TelegramClient`, and create sequential chunk route handlers `/api/admin/upload/part` and `/api/admin/upload/complete`.
5. **Missing Phase 1 Smoke Test**:
   - Observation 1.1 shows `"smoke:telegram": "tsx scripts/smoke-telegram.ts"` is listed in `package.json`, but the file is missing. To fulfill Acceptance Criteria for Upload & Chunking Reliability (`npm run smoke:telegram` and `npm run smoke:telegram -- --big`), `scripts/smoke-telegram.ts` must be created.

---

## 3. Caveats

- **Network-dependent tests**: `npm run preflight` connects to live Supabase and Telegram using `.env.local` credentials. In offline environments, unit tests using mocks will be essential.
- **Edge Runtime vs Node Runtime**: Next.js App Router route handlers run in Node runtime by default (supporting Node `crypto.scrypt`), whereas `src/middleware.ts` runs in the Edge runtime. `jose` is web-crypto based and functions in Edge runtime, but any scrypt password hashing must stay in Node Route Handlers (`/api/admin/login`).
- **No other caveats**: The codebase layout is completely mapped with 100% of non-ignored files cataloged.

---

## 4. Conclusion

The application architecture is well-structured and cleanly primed for Phase 1 implementation. To execute Phase 1 without regressions or architecture mismatch:
1. Implement security guards: `src/middleware.ts`, IP rate limiter (in-memory map), Origin check, and session cookie handlers.
2. Implement naming & validation engines: `buildFileName` (pure function with regex `^[A-Za-z0-9._-]+$`), magic-byte stream validator, and file-splitting helper.
3. Implement upload engine: extend `TelegramClient` with `sendDocument`, `getFile`, `downloadFile`; create chunked upload session manager; create `/api/admin/upload/part` and `/api/admin/upload/complete` with automatic Telegram message deletion rollback on any failure.
4. Implement admin interfaces: `/admin/login`, `/admin` dashboard with library table and multi-part upload form.
5. Implement verification: unit tests (`naming.test.ts`, `validator.test.ts`, `auth.test.ts`, `upload.test.ts`), live smoke script (`scripts/smoke-telegram.ts`), and update verification report in `docs/verification/phase-1.md`.

---

## 5. Verification Method

To independently verify the survey findings:

1. **Verify Unit Tests & Baseline**:
   ```bash
   npm test
   ```
   Expect: 7 passed tests in `tests/unit/env.test.ts`.
2. **Verify Linter Cleanliness**:
   ```bash
   npm run lint
   ```
   Expect: ESLint passes with 0 errors across `src/`, `scripts/`, `tests/`.
3. **Verify Preflight Status**:
   ```bash
   npm run preflight
   ```
   Expect: 5/5 checks PASS with live credentials.
4. **Verify Absence of Admin Routes & Middleware**:
   ```bash
   # In PowerShell:
   Test-Path src/middleware.ts
   Test-Path src/app/admin/page.tsx
   Test-Path scripts/smoke-telegram.ts
   ```
   Expect: `False` for all three paths.
5. **Examine Detailed Survey Analysis**:
   Inspect `.agents/teamwork/explorer_survey_1/analysis.md`.
