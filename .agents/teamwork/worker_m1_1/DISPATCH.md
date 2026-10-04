## 2026-10-04T10:01:58Z

You are Worker 1 for Milestone M1 (Admin Authentication & Session Security).
Your identity: teamwork_preview_worker
Your working directory: c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\worker_m1_1
Your parent orchestrator: orchestrator_1 (conversation ID: fb1a83fa-301b-45dd-ba05-a3edc0267f37)

MANDATORY FIRST STEP:
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\ORIGINAL_REQUEST.md in full.
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\orchestrator_1\PROJECT.md.
Read Explorer Analysis Reports:
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m1_1\analysis.md
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m1_2\analysis.md
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m1_1\analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

File Ownership:
You exclusively own and may modify or create the following files:
- src/lib/auth-jwt.ts
- src/lib/auth.ts
- src/middleware.ts
- src/app/api/admin/login/route.ts
- src/app/api/admin/logout/route.ts
- src/app/api/admin/session/route.ts
- src/app/admin/login/page.tsx
- tests/unit/auth.test.ts

Implementation Requirements:
1. `src/lib/auth-jwt.ts`: Edge-safe implementation using `jose` for `createAdminToken` (12h HS256 JWT) and `verifyAdminToken`, cookie options (`admin_session`, httpOnly, Secure, SameSite=Strict, maxAge: 43200), and `validateOrigin` (validates Origin header against Host / SITE_URL on mutating requests).
2. `src/lib/auth.ts`: Node `crypto` scrypt implementation of `hashPassword` and `verifyPassword` using `crypto.timingSafeEqual`, in-memory IP rate limiter (15 min window, max 5 failed attempts per IP, blocks on 6th returning allowed: false and retryAfterSeconds, reset on success, cleanup to prevent leaks), and re-exports of all functions from `src/lib/auth-jwt.ts` to ensure 100% backward compatibility.
3. `src/middleware.ts`: Next.js App Router Edge middleware matching `['/admin', '/admin/:path*', '/api/admin/:path*']`:
   - Exempts `/admin/login` page from auth check.
   - Exempts `/api/admin/login` from auth check, but enforces Origin validation on POST.
   - Mutating requests (POST, PUT, DELETE, PATCH) to `/api/admin/*` must pass `validateOrigin` (returns 403 on mismatch/missing).
   - Unauthenticated browser requests to `/admin` or `/admin/*` redirect to `/admin/login?from=...` (307).
   - Unauthenticated API requests to `/api/admin/*` return HTTP 401 `{ error: "Unauthorized: Admin authentication required" }`.
   - Valid admin session passes through.
4. `/api/admin/login/route.ts`:
   - Extracts client IP (`x-forwarded-for`, `x-real-ip`, etc.).
   - Checks rate limit: if not allowed, returns HTTP 429 `{ error: "Too many failed attempts. Try again later." }` with `Retry-After` header.
   - Reads password from JSON body. If invalid, records failed attempt and returns HTTP 401 `{ error: "Invalid password", remainingAttempts: ... }`.
   - If valid, resets rate limit for IP, creates JWT token, sets `admin_session` cookie, returns HTTP 200 `{ ok: true, message: "Logged in successfully" }`.
5. `/api/admin/logout/route.ts`:
   - Clears `admin_session` cookie (`maxAge: 0`), returns HTTP 200 `{ ok: true }`.
6. `/api/admin/session/route.ts`:
   - Checks `admin_session` cookie with `verifyAdminToken`. Returns HTTP 200 `{ authenticated: true, role: "admin" }` or `{ authenticated: false }`.
7. `/admin/login/page.tsx`:
   - Admin Login UI built with Tailwind CSS v4.
   - Clean card layout, title "Admin Login - SST Chapter Library", password field, submit button with loading state, error alert banner (displays error and remaining attempts if present), and client redirect to `/admin` (or `from` param) upon success.
8. `tests/unit/auth.test.ts`:
   - Comprehensive Vitest test suite covering:
     - Scrypt password hashing & timingSafeEqual verification.
     - JWT creation, verification, expiration rejection, tampered token rejection.
     - Rate limiter: allows 5 failed attempts, blocks 6th with 429, reset on success.
     - Origin header validation: valid host/origin passes, mismatch fails, missing fails on mutations.
     - Middleware behavior / route protection contracts.

Verification:
Run the tests and linter:
- `npm test`
- `npm run lint`
Document commands, outputs, and passing status in your handoff.

Output:
Write changes to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\worker_m1_1\changes.md.
Write handoff to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\worker_m1_1\handoff.md.
Notify parent (fb1a83fa-301b-45dd-ba05-a3edc0267f37) when finished.
