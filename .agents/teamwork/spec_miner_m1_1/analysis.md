# Milestone M1 Specification Analysis: Admin Auth & Security

**Document Version:** 1.0.0  
**Author:** Specification Miner (`teamwork_preview_spec_miner`)  
**Target Milestone:** M1 (Admin Authentication & Session Security)  
**Authoritative Sources:**  
- `.agents/teamwork/ORIGINAL_REQUEST.md` (Sections R1 & Acceptance Criteria)  
- `SST-Library-FINAL-Antigravity-Prompt.md` (Sections 5 & 163–179)  
- `.agents/teamwork/orchestrator_1/PROJECT.md` (Features 1–5 & Interface Contracts)  
- `scripts/hash-password.ts` (Authoritative reference for scrypt parameters)  
- `src/lib/auth.ts` (Existing initial module)  

---

## 1. Executive Summary

Milestone M1 establishes the security perimeter for the SST Chapter Library. It implements single-administrator authentication using scrypt password hashing, constant-time verification, stateless 12-hour signed JWT cookies, in-memory IP brute-force rate limiting (blocking on the 6th failed attempt within 15 minutes), CSRF Origin validation on mutating admin endpoints, and Next.js Edge middleware route guarding.

The system is strictly bifurcated into:
1. **Public Surfaces:** Completely unrestricted access for students and teachers (`/`, `/chapter/*`, `/api/health`, `/api/library.json`, `/api/files/*`). No login prompts, no per-visitor rate limits.
2. **Admin Perimeter:** Strictly guarded surfaces (`/admin/*`, `/api/admin/*`). Requires valid session cookie or valid login credentials. Mutating requests require matching Origin headers.

---

## 2. Authoritative Requirements Extraction

### 2.1 From ORIGINAL_REQUEST.md & SST-Library-FINAL-Antigravity-Prompt.md (R1 & AC)
1. **Scrypt & Constant-Time Verification:** Admin credentials verified against `ADMIN_PASSWORD_HASH` using Node.js `crypto.scrypt` with parameters `N=16384, r=8, p=1, keylen=64` and compared strictly via `crypto.timingSafeEqual`.
2. **JWT Session Cookie:** Issue a signed HS256 JWT containing `{ role: "admin" }`, valid for 12 hours (`43200` seconds), stored in an `httpOnly`, `Secure`, `SameSite=Strict` cookie named `admin_session`.
3. **In-Memory IP Rate Limiting:** Maximum 5 failed attempts per 15 minutes per IP. On the 6th attempt within the 15-minute window, the endpoint MUST return HTTP 429 (Too Many Requests) with a `Retry-After` header. Successful login resets the counter for that IP.
4. **Middleware Route Guarding:** Direct unauthenticated GET to `/admin` or `/admin/*` redirects to `/admin/login`. Direct unauthenticated requests to `/api/admin/*` (except `/api/admin/login`) return HTTP 401 Unauthorized JSON. Tampered JWT tokens or expired sessions are rejected.
5. **Origin Header Validation:** All mutating requests (`POST`, `PUT`, `DELETE`, `PATCH`) to `/api/admin/*` with missing or mismatched `Origin` headers MUST be rejected with HTTP 403 Forbidden.
6. **Public Route Invariance:** Public pages (`/`, `/chapter/*`) and public APIs (`/api/health`, `/api/library.json`, `/api/files/*`) MUST remain accessible without any credentials or cookies.

---

## 3. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Cryptography | `hashPassword` | Hashes plain-text password using scrypt with random 16-byte hex salt | `plainText: string` | `Promise<string>` (`salt:keyHex`) | Rejects on scrypt failure | `scripts/hash-password.ts`, `src/lib/auth.ts` |
| 2 | Cryptography | `verifyPassword` | Verifies plain password against stored hash using `timingSafeEqual` | `plainText: string, storedHash: string` | `Promise<boolean>` | Returns `false` on malformed hash, length mismatch, or wrong password; never throws | R1, `src/lib/auth.ts` |
| 3 | Token Management | `createAdminToken` | Signs HS256 JWT with `{ role: "admin" }` expiring in 12 hours | `secretString: string` | `Promise<string>` (compact JWT) | Throws if secret is empty | R1, `PROJECT.md`, `src/lib/auth.ts` |
| 4 | Token Management | `verifyAdminToken` | Verifies JWT signature, expiration, and admin role claim via `jose` | `token: string, secretString: string` | `Promise<boolean>` or `{ role: string } \| null` | Returns `false` / `null` on tampered signature, expired time, or wrong secret | R1, `PROJECT.md`, `src/lib/auth.ts` |
| 5 | Session / Cookie | `getAdminCookieOptions` | Cookie configuration helper for `admin_session` | None / `isProduction: boolean` | `CookieOptions` (`httpOnly: true, secure: true, sameSite: 'strict', maxAge: 43200`) | N/A | R1, `PROJECT.md` |
| 6 | Rate Limiting | `checkRateLimit` | Checks if client IP has exceeded 5 failed attempts in 15 minutes | `ip: string` | `{ allowed: boolean, remainingAttempts: number, retryAfterSeconds?: number }` | If blocked, returns `{ allowed: false, remainingAttempts: 0, retryAfterSeconds: N }` | R1, AC, `PROJECT.md` |
| 7 | Rate Limiting | `recordFailedAttempt`| Records a failed login attempt timestamp for client IP | `ip: string` | `void` | Prunes timestamps older than 15 min | R1, AC, `PROJECT.md` |
| 8 | Rate Limiting | `resetRateLimit` | Clears failed attempt history for client IP upon successful login | `ip: string` | `void` | Clears IP entry from memory map | R1, `PROJECT.md` |
| 9 | CSRF / Security | `validateOrigin` | Validates `Origin` header on mutating requests against allowed host/SITE_URL | `req: Request` or `origin: string \| null, siteUrl: string` | `boolean` | Returns `false` if missing, invalid format, or mismatched domain | R1, AC, `PROJECT.md` |
| 10 | Route Guarding | Middleware Route Filter | Intercepts requests matching `/admin/:path*` and `/api/admin/:path*` | `NextRequest` | `NextResponse` (Next / Redirect / 401 / 403) | Redirects unauth pages to `/admin/login`; returns 401 JSON for unauth API routes | R1, AC, `PROJECT.md` |
| 11 | API Endpoint | `POST /api/admin/login` | Validates credentials, checks rate limit, sets `admin_session` cookie | `{ password: string }` | `200 OK` + `Set-Cookie` | `400` (missing password), `401` (bad password), `429` (rate limited), `403` (bad origin) | R1, `PROJECT.md` |
| 12 | API Endpoint | `POST /api/admin/logout`| Clears `admin_session` cookie | Empty body / JSON | `200 OK` + `Set-Cookie: Max-Age=0` | `403` if mutating request has invalid Origin | R1, `PROJECT.md` |
| 13 | API Endpoint | `GET /api/admin/session`| Checks if caller has active, valid admin session | `admin_session` cookie | `200 OK` (`{ authenticated: true }`) | `401 Unauthorized` (`{ authenticated: false }`) if cookie missing or invalid | R1, `PROJECT.md` |
| 14 | UI / Presentation | Admin Login UI (`/admin/login`) | Accessible login interface with calm styling, password input, error banner, and redirect | User input | Rendered React HTML | Displays errors cleanly without flashing | R1, Design Brief (Section 6) |

---

## 4. Edge Cases Matrix

| # | Feature | Input / Condition | Observed / Required Behavior |
|---|---------|-------------------|-----------------------------|
| 1 | `verifyPassword` | Empty plain text password (`""`) | Returns `false`. Never matches valid password hash. |
| 2 | `verifyPassword` | Malformed hash without colon (e.g. `"justahash"`) | `[salt, keyHex]` unpacking fails; returns `false` without throwing. |
| 3 | `verifyPassword` | Empty salt or empty keyHex (e.g. `":abc"` or `"abc:"`) | Returns `false` cleanly. |
| 4 | `verifyPassword` | Malformed hex in keyHex (e.g. `"salt:xyz"`) | `Buffer.from(keyHex, "hex")` yields shorter buffer (`length !== 64`); returns `false`. |
| 5 | `verifyPassword` | Truncated derived key (e.g. 32 bytes instead of 64) | Length check fails (`32 !== 64`); returns `false`. |
| 6 | `verifyPassword` | Equal length buffers with mismatched content | Evaluated via `crypto.timingSafeEqual`; returns `false` in constant time. |
| 7 | `verifyPassword` | `crypto.timingSafeEqual` throws `RangeError` | Caught by `try...catch` block; safely resolves to `false`. |
| 8 | `createAdminToken`| Valid secret string (>= 16 chars) | Returns valid compact 3-segment JWT (`eyJ...`). |
| 9 | `verifyAdminToken`| Valid token within 12 hours | Returns `true` (or decoded `{ role: "admin" }`). |
| 10 | `verifyAdminToken`| Expired token (`exp` timestamp in past) | `jwtVerify` throws `ERR_JWT_EXPIRED`; `verifyAdminToken` catches and returns `false`. |
| 11 | `verifyAdminToken`| Tampered signature (altered bytes in segment 3) | `jwtVerify` throws `ERR_JWS_SIGNATURE_VERIFICATION_FAILED`; returns `false`. |
| 12 | `verifyAdminToken`| Tampered payload (altered claims in segment 2) | Signature check fails; returns `false`. |
| 13 | `verifyAdminToken`| Alg 'none' or mismatched algorithm | `jwtVerify` configured with `{ algorithms: ["HS256"] }` strictly rejects non-HS256 algorithms. |
| 14 | `verifyAdminToken`| Malformed token string (`""`, `"abc"`, `"a.b"`) | `jwtVerify` throws `ERR_JWS_INVALID`; returns `false`. |
| 15 | `verifyAdminToken`| Token signed with different secret | Signature verification fails; returns `false`. |
| 16 | `verifyAdminToken`| Token payload has `{ role: "user" }` (not admin) | Returns `false` because `payload.role !== "admin"`. |
| 17 | `checkRateLimit` | Fresh IP address (0 recorded attempts) | Returns `{ allowed: true, remainingAttempts: 5 }`. |
| 18 | `checkRateLimit` | IP with 1 to 5 failed attempts within 15 min | Returns `{ allowed: true, remainingAttempts: 5 - count }`. |
| 19 | `checkRateLimit` | IP with 5 recorded failures attempting 6th time | Returns `{ allowed: false, remainingAttempts: 0, retryAfterSeconds: >0 }`. |
| 20 | `checkRateLimit` | IP with 6th failed attempt | Endpoint returns HTTP 429 with `Retry-After: <seconds>` header and descriptive message. |
| 21 | `checkRateLimit` | Passage of 15 minutes (> 900,000 ms) | Expired timestamps discarded; IP returns to allowed state with 5 attempts. |
| 22 | `resetRateLimit` | Successful login after 4 failed attempts | Clears history for that IP; counter resets to 5 remaining attempts. |
| 23 | `checkRateLimit` | Independent IP addresses (IP A vs IP B) | IP A's failures do NOT reduce IP B's remaining attempts. |
| 24 | `checkRateLimit` | IPv6 address (e.g. `::1`, `2001:db8::1`) | Normalized as string; tracked independently without regex crash. |
| 25 | Rate Limiter Store| High volume of distinct IPs over extended period | Stale IP records pruned to prevent Node.js heap memory exhaustion. |
| 26 | `validateOrigin` | Exact match with `SITE_URL` (e.g. `http://localhost:3000`) | Returns `true`. |
| 27 | `validateOrigin` | Localhost IP variation (`http://127.0.0.1:3000` vs `http://localhost:3000`) | Returns `true` in local development when host matches port. |
| 28 | `validateOrigin` | Missing `Origin` header (`null` or `undefined`) | Returns `false`. Mutating request rejected with HTTP 403 Forbidden. |
| 29 | `validateOrigin` | Empty `Origin` header (`""`) | Returns `false`. Mutating request rejected with HTTP 403 Forbidden. |
| 30 | `validateOrigin` | Malicious external origin (`https://evil-site.com`) | Returns `false`. Mutating request rejected with HTTP 403 Forbidden. |
| 31 | `validateOrigin` | Port mismatch (`http://localhost:8080` vs `http://localhost:3000`) | Returns `false`. Mutating request rejected with HTTP 403 Forbidden. |
| 32 | `validateOrigin` | Non-mutating request (GET, HEAD) | Origin check is not enforced; returns `true` or is bypassed. |
| 33 | Middleware Guard | Unauthenticated GET `/admin` | Returns HTTP 307 Redirect to `/admin/login`. |
| 34 | Middleware Guard | Unauthenticated GET `/admin/upload` | Returns HTTP 307 Redirect to `/admin/login`. |
| 35 | Middleware Guard | Unauthenticated GET `/admin/login` | Exempt from redirect; renders login page. |
| 36 | Middleware Guard | Authenticated GET `/admin/login` | May optionally redirect to `/admin` or render page. |
| 37 | Middleware Guard | Unauthenticated GET `/api/admin/library` | Returns HTTP 401 JSON `{ "error": "Unauthorized" }`. |
| 38 | Middleware Guard | Unauthenticated POST `/api/admin/upload/part` | Returns HTTP 401 JSON `{ "error": "Unauthorized" }`. |
| 39 | Middleware Guard | Unauthenticated POST `/api/admin/login` | Exempt from auth check; handled by login route with rate limiting. |
| 40 | Middleware Guard | Authenticated request with tampered cookie on `/admin` | Cookie rejected; redirects to `/admin/login`. |
| 41 | Middleware Guard | Authenticated request with expired cookie on `/api/admin/*` | Cookie rejected; returns HTTP 401 JSON. |
| 42 | Middleware Guard | Public request to `/` or `/api/health` | Bypasses auth checks completely; returns HTTP 200 without redirect. |

---

## 5. Cryptographic & Security Specifications

### 5.1 Password Hashing & Verification
- **Algorithm:** Node.js `crypto.scrypt`
- **Parameters:**
  - Salt length: 16 bytes (`crypto.randomBytes(16)`), formatted as 32 hex characters.
  - Key length: 64 bytes (`SCRYPT_KEYLEN = 64`), formatted as 128 hex characters.
  - Scrypt options:
    - Cost (`N`): 16384
    - Block size (`r`): 8
    - Parallelization (`p`): 1
- **Stored Format:** `${salt}:${derivedKey.toString("hex")}` (total string length = 32 + 1 + 128 = 161 characters).
- **Constant-Time Comparison:**
  - Salt and keyHex are extracted via `storedHash.split(":")`.
  - Buffer length check: `Buffer.from(keyHex, "hex").length === derivedKey.length`.
  - Comparison: `crypto.timingSafeEqual(keyBuffer, derivedKey)` prevents timing side-channel attacks.

### 5.2 JWT Session Token Lifecycle
- **Library:** `jose` (v6.x)
- **Algorithm:** `HS256` (HMAC SHA-256)
- **Claims:**
  - `role`: `"admin"`
  - `iat`: Issued At timestamp (Unix epoch seconds)
  - `exp`: Expiration time set to 12 hours (`12h` = `Date.now() / 1000 + 43200`)
- **Key Derivation:** Secret derived via `new TextEncoder().encode(SESSION_SECRET)`. `SESSION_SECRET` must be at least 16 characters (production uses 32-byte / 64-hex random string).
- **Edge Runtime Compatibility:** `jose` uses standard Web Crypto API (`crypto.subtle`), ensuring flawless execution in both Next.js Node.js runtime and Edge Middleware.

### 5.3 Cookie Security Specification
- **Cookie Name:** `admin_session`
- **Max-Age:** `43200` seconds (12 hours)
- **Path:** `/`
- **Flags:**
  - `httpOnly: true`: Completely inaccessible to client-side JavaScript (`document.cookie`), mitigating XSS session theft.
  - `secure: true`: Transmitted only over HTTPS. (In local development `process.env.NODE_ENV === "production" ? true : false` or browser localhost exception).
  - `sameSite: "strict"`: Cookie is never sent with cross-site requests, providing robust defense against Cross-Site Request Forgery (CSRF).

---

## 6. Brute-Force Rate Limiting Specification

### 6.1 State Machine & Data Model
- **Storage:** In-memory `Map<string, number[]>` storing timestamps (in ms) of failed attempts for each IP address.
- **Window Duration:** 15 minutes (`15 * 60 * 1000 = 900,000` ms).
- **Threshold:** Maximum 5 failed attempts per window.
- **Evaluation Rule:**
  1. For incoming IP, prune all timestamps where `Date.now() - timestamp > 900_000`.
  2. If count of remaining timestamps `< 5`:
     - Allow attempt: `allowed = true`, `remainingAttempts = 5 - count`.
  3. If count of remaining timestamps `>= 5`:
     - Block attempt: `allowed = false`, `remainingAttempts = 0`.
     - Calculate retry time: `retryAfterSeconds = Math.ceil((oldestTimestamp + 900_000 - Date.now()) / 1000)`.
- **Reset on Success:** When credentials match, call `resetRateLimit(ip)` to immediately clear the IP from memory.
- **Memory Leak Protection:** Periodic cleanup (e.g., every 5 minutes or on each operation) to remove IPs with empty or fully expired timestamp arrays.

### 6.2 HTTP 429 Response Format
```json
HTTP/1.1 429 Too Many Requests
Retry-After: 900
Content-Type: application/json

{
  "error": "Too many failed attempts. Try again in 15 minutes.",
  "retryAfter": 900
}
```

---

## 7. Origin Header Validation Specification

### 7.1 Scope of Enforcement
- Enforced on **mutating HTTP methods**: `POST`, `PUT`, `DELETE`, `PATCH`.
- Non-mutating methods (`GET`, `HEAD`, `OPTIONS`) do not require Origin validation.
- Routes guarded: All `/api/admin/*` endpoints (including `/api/admin/login`, `/api/admin/logout`, `/api/admin/upload/*`, `/api/admin/library/*`).

### 7.2 Validation Rules
1. Extract `req.headers.get("origin")`.
2. If `origin` is missing, empty, or `"null"`: **Reject (return false)**.
3. Parse `origin` URL and compare with configured allowed origin:
   - Primary: `SITE_URL` from environment (e.g., `http://localhost:3000` or `https://sst-library.onrender.com`).
   - Development Tolerance: If `NODE_ENV !== "production"` and host is `localhost` or `127.0.0.1`, accept variations with matching port.
4. If origin does not match: **Reject (return false)**.
5. On rejection, the route handler or middleware returns:
```json
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "error": "Invalid or missing Origin header"
}
```

---

## 8. Edge Middleware & Route Guarding Architecture

### 8.1 Middleware Configuration (`src/middleware.ts`)
- **Runtime:** Edge Runtime (default) or Node.js runtime.
- **Matcher:**
  ```ts
  export const config = {
    matcher: ["/admin/:path*", "/api/admin/:path*"],
  };
  ```

### 8.2 Dispatch Logic
```
Incoming Request
│
├── Path starts with /admin/login or /api/admin/login?
│   └── YES ──> Allow through (Public Auth Endpoint)
│
├── Inspect Cookie: "admin_session"
│   ├── Missing or Invalid/Expired/Tampered Token?
│   │   ├── Request is API route (/api/admin/*)?
│   │   │   └── YES ──> Return HTTP 401 Unauthorized JSON
│   │   │
│   │   └── Request is Page route (/admin/*)?
│   │       └── YES ──> Return HTTP 307 Redirect to /admin/login
│   │
│   └── Valid Admin Token?
│       ├── Mutating Request (POST/PUT/DELETE/PATCH)?
│       │   ├── Validate Origin Header
│       │   ├── Origin Invalid ──> Return HTTP 403 Forbidden JSON
│       │   └── Origin Valid ───> Next (Allow)
│       │
│       └── Non-Mutating Request (GET/HEAD)
│           └── Next (Allow)
```

---

## 9. API Endpoint Specifications

### 9.1 `POST /api/admin/login`
- **Headers:** `Content-Type: application/json`, `Origin: <origin>`
- **Request Body:**
  ```json
  {
    "password": "string"
  }
  ```
- **Responses:**
  - **403 Forbidden:** Origin header missing or mismatched.
  - **429 Too Many Requests:** IP has reached 5 failed attempts in past 15 min. Header `Retry-After: <sec>`.
  - **400 Bad Request:** Password empty or invalid JSON payload.
  - **401 Unauthorized:** Password does not match `ADMIN_PASSWORD_HASH`. (Failed attempt recorded).
  - **200 OK:** Password matches. Rate limit reset. Token generated.
    - Set-Cookie: `admin_session=<jwt>; Path=/; Max-Age=43200; HttpOnly; SameSite=Strict; Secure`
    - Body: `{"success": true}`

### 9.2 `POST /api/admin/logout`
- **Headers:** `Origin: <origin>`
- **Responses:**
  - **403 Forbidden:** Bad Origin.
  - **200 OK:** `Set-Cookie: admin_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict; Secure`, Body: `{"success": true}`.

### 9.3 `GET /api/admin/session`
- **Cookie:** `admin_session=<token>`
- **Responses:**
  - **200 OK:** `{"authenticated": true}`
  - **401 Unauthorized:** `{"authenticated": false, "error": "Unauthorized"}`

---

## 10. Admin Login UI Specification (`/admin/login`)

- **Route:** `/admin/login`
- **Layout & Style:**
  - Calm, accessible design strictly adhering to the Design Brief (Section 6).
  - Soft off-white background (`bg-stone-50` / `dark:bg-stone-900`).
  - Muted forest green/teal accent buttons (`bg-emerald-700 hover:bg-emerald-800`).
  - WCAG AA compliant text contrast.
  - Big tap targets (minimum 44px height for input and submit button).
- **Form Controls:**
  - Password input: `<input type="password" required autoFocus ... />` with clear label.
  - Submit button: "Log In", disabled during submission with a calm loading indicator.
  - Error alert banner: displayed only when error occurs, announcing error text clearly without layout shift.
- **Client-Side Behavior:**
  - On submit: `POST /api/admin/login` with `fetch(..., { headers: { "Content-Type": "application/json" } })`.
  - On 200: `window.location.href = "/admin"` (or Next.js `router.push("/admin")`).
  - On 401: display "Incorrect password. Please try again."
  - On 429: display "Too many failed attempts. Access blocked for 15 minutes."
  - On 403: display "Security check failed (Origin mismatch)."

---

## 11. Unit Test Specification for `tests/unit/auth.test.ts`

The unit test file `tests/unit/auth.test.ts` must be structured into 5 logical test suites covering all cryptographic, token, rate limiting, origin, and cookie specifications.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import {
  hashPassword,
  verifyPassword,
  createAdminToken,
  verifyAdminToken,
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
  validateOrigin,
  ADMIN_COOKIE_NAME,
  ADMIN_COOKIE_MAX_AGE,
} from "@/lib/auth";
```

### Suite 1: Password Verification & Scrypt
1. `it("should hash a password with random salt and scrypt options")`
   - Hashes password. Asserts output format matches `${salt}:${keyHex}` with 32-char salt and 128-char hex key.
2. `it("should return true when verifying the correct password")`
   - Verifies against known good hash; asserts `true`.
3. `it("should return false when verifying an incorrect password")`
   - Verifies `"WrongPassword"` against good hash; asserts `false`.
4. `it("should return false when verifying an empty password")`
   - Verifies `""` against good hash; asserts `false`.
5. `it("should return false for malformed hash without colon separator")`
   - Verifies with `"nohashseparatedbycolon"`; asserts `false`.
6. `it("should return false for malformed hash with empty salt or key")`
   - Verifies with `":abc"`, `"abc:"`, `""`; asserts `false`.
7. `it("should return false for malformed hash with non-hex characters")`
   - Verifies with `"salt:not-valid-hex-zzz"`; asserts `false`.
8. `it("should return false for malformed hash with truncated key length")`
   - Verifies with `"salt:1234abcd"`; asserts `false` due to length check.
9. `it("should strictly use crypto.timingSafeEqual for equal-length key buffers")`
   - Spies on `crypto.timingSafeEqual`. Verifies that it is invoked exactly once during key comparison.
10. `it("should safely handle exceptions thrown by crypto.timingSafeEqual")`
    - Mocks `crypto.timingSafeEqual` to throw an error; asserts `verifyPassword` catches it and returns `false`.

### Suite 2: JWT Admin Tokens
1. `it("should create a signed HS256 JWT valid for 12 hours")`
   - Generates token; asserts valid 3-segment string structure.
2. `it("should verify a valid admin token and confirm role is admin")`
   - Verifies freshly created token; asserts `true` (or decoded object with role admin).
3. `it("should reject a token signed with a different secret")`
   - Verifies token against `"completely-different-secret-key-32b"`; asserts `false`.
4. `it("should reject an expired token")`
   - Generates token with expired timestamp (`-1s` or `-1h`); verifies; asserts `false`.
5. `it("should reject a tampered token signature")`
   - Modifies signature part of token; verifies; asserts `false`.
6. `it("should reject a tampered token payload")`
   - Modifies payload part of token; verifies; asserts `false`.
7. `it("should reject malformed token strings")`
   - Tests `""`, `"abc"`, `"a.b"`, `"a.b.c.d"`; asserts `false`.
8. `it("should reject tokens with non-admin role")`
   - Crafts token with `{ role: "user" }`; verifies; asserts `false`.

### Suite 3: In-Memory IP Rate Limiting
1. `it("should allow first 5 attempts for a fresh IP")`
   - Calls `checkRateLimit("192.168.1.10")`; asserts `allowed: true, remainingAttempts: 5`.
2. `it("should decrement remainingAttempts on each failed attempt")`
   - Records 3 failed attempts; asserts `remainingAttempts: 2`.
3. `it("should allow up to 5 failed attempts")`
   - Records 5 failed attempts; asserts `remainingAttempts: 0, allowed: true` on the 5th attempt.
4. `it("should block on the 6th failed attempt with allowed: false")`
   - With 5 recorded failures, 6th attempt checks rate limit; asserts `allowed: false, remainingAttempts: 0, retryAfterSeconds > 0`.
5. `it("should reset rate limit for an IP on successful login")`
   - Records 4 failed attempts; calls `resetRateLimit("192.168.1.10")`; asserts `remainingAttempts: 5`.
6. `it("should reset rate limit after 15 minute window expires")`
   - Records 5 failed attempts; advances mock time by 16 minutes (`vi.advanceTimersByTime(16 * 60 * 1000)`); asserts `allowed: true, remainingAttempts: 5`.
7. `it("should isolate attempt tracking across different IP addresses")`
   - IP A has 5 failed attempts; IP B has 0; asserts IP B is allowed with 5 attempts.
8. `it("should correctly handle IPv6 addresses")`
   - Records and checks attempts for `"::1"` and `"2001:db8::1"`.

### Suite 4: Origin Header Validation
1. `it("should accept request when Origin exactly matches SITE_URL")`
   - Mock request with `Origin: http://localhost:3000` matching `SITE_URL`; asserts `true`.
2. `it("should accept request for localhost variations in development")`
   - In dev mode, accepts `http://127.0.0.1:3000` when matching host port; asserts `true`.
3. `it("should reject request when Origin header is missing")`
   - Mock request with no Origin header; asserts `false`.
4. `it("should reject request when Origin header is empty string")`
   - Mock request with `Origin: ""`; asserts `false`.
5. `it("should reject request from an untrusted / malicious domain")`
   - Mock request with `Origin: https://attacker-website.com`; asserts `false`.
6. `it("should reject request with mismatched port or protocol")`
   - Mock request with `Origin: http://localhost:8080` (port mismatch); asserts `false`.

### Suite 5: Cookie Security Specifications
1. `it("should define admin_session cookie with 12-hour maxAge")`
   - Asserts `ADMIN_COOKIE_MAX_AGE === 43200` (12 * 3600).
   - Asserts `ADMIN_COOKIE_NAME === "admin_session"`.

---

## 12. Verification & Validation Plan

- Run `npm test` using Vitest to execute `tests/unit/auth.test.ts`.
- Ensure all assertions execute cleanly in < 1 second.
- Verify zero runtime regressions with `tests/unit/env.test.ts`.
