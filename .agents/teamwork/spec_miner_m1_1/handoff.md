# Handoff Report — Milestone M1 Specification Mining

**Date:** 2026-10-04T09:56:00Z  
**Agent:** `teamwork_preview_spec_miner` (Spec Miner M1)  
**Recipient:** `orchestrator_1` (conversation ID: `fb1a83fa-301b-45dd-ba05-a3edc0267f37`)  

---

### 1. Observation
1. **Authoritative Request Requirements (`.agents/teamwork/ORIGINAL_REQUEST.md:12-17, 47-52`):**
   - Requirement R1: "Implement the admin login endpoint (`/api/admin/login`) and interface (`/admin/login`). Verify credentials against the `ADMIN_PASSWORD_HASH` scrypt hash using constant-time comparison (`timingSafeEqual`). Issue a signed JWT session stored in an `httpOnly`, `Secure`, `SameSite=Strict` cookie valid for 12 hours. Implement in-memory IP-based rate limiting (maximum 5 failed attempts per 15 minutes per IP; return 429 on 6th attempt). Protect all `/admin/*` pages and `/api/admin/*` routes server-side; reject bad Origin headers on mutating requests. Ensure public routes remain accessible without credentials."
   - Acceptance Criteria:
     - "5 failed admin login attempts within 15 minutes trigger HTTP 429 on the 6th attempt."
     - "Direct unauthenticated GET to `/admin` or `/api/admin/*` returns 401 or redirect."
     - "Tampered JWT tokens or expired sessions are rejected."
     - "Mutating admin requests with invalid or missing Origin headers are rejected."

2. **Reference Scrypt Implementation (`scripts/hash-password.ts:4-19`):**
   ```ts
   const SCRYPT_KEYLEN = 64;
   const SCRYPT_OPTIONS: crypto.ScryptOptions = {
     cost: 16384,
     blockSize: 8,
     parallelization: 1,
   };
   // format: ${salt}:${derivedKey.toString("hex")}
   ```
   Salt is 16 bytes hex (32 hex characters). Derived key is 64 bytes (128 hex characters).

3. **Current Auth Module (`src/lib/auth.ts:1-59`):**
   - Implements `hashPassword`, `verifyPassword`, `createAdminToken`, and `verifyAdminToken`.
   - Uses `jose` (`SignJWT`, `jwtVerify`) with `HS256` algorithm and 12h expiration.
   - Missing from `src/lib/auth.ts`: in-memory rate limiting (`checkRateLimit`, `recordFailedAttempt`, `resetRateLimit`), `validateOrigin`, and cookie options constants.

4. **Cryptographic & Runtime Behavior Observations via Node CLI:**
   - `crypto.timingSafeEqual`: Compares equal-length buffers in constant time. Throws `RangeError: Input buffers must have the same byte length` if buffer lengths differ.
   - `jose.jwtVerify`: Throws `ERR_JWT_EXPIRED` on expired tokens (`"exp" claim timestamp check failed`), `ERR_JWS_SIGNATURE_VERIFICATION_FAILED` on tampered signatures, and `ERR_JWS_INVALID` on malformed tokens.
   - `jose` uses Web Crypto API (`crypto.subtle`), ensuring full compatibility with Next.js Edge Middleware.

5. **Existing Test Suite Execution (`vitest run`):**
   - Command: `npm test`
   - Output: `✓ tests/unit/env.test.ts (7 tests) 149ms` exited with code 0 in ~814ms.

---

### 2. Logic Chain
1. *From Observation 1 and 2:* The password verification mechanism must strictly adhere to the reference parameters (`N=16384, r=8, p=1, keylen=64`) and `${salt}:${derivedKey}` format. Length of the key buffer must be validated to be exactly 64 bytes before calling `timingSafeEqual` to avoid uncaught RangeErrors.
2. *From Observation 1 and 4:* Token tampering and expiration must be handled by `jose.jwtVerify` inside `verifyAdminToken`. Because `jose` executes in Edge runtime, `src/middleware.ts` can directly verify the JWT session cookie without needing Node-specific polyfills.
3. *From Observation 1 and 3:* Rate limiting requires tracking failed login attempts per IP within a 15-minute sliding window. Allowing attempts 1–5 and returning HTTP 429 on the 6th attempt necessitates an in-memory timestamp array store with automatic pruning to prevent memory leaks.
4. *From Observation 1:* Mutating requests (`POST`, `PUT`, `DELETE`, `PATCH`) to `/api/admin/*` must validate the `Origin` header against `SITE_URL` (with localhost tolerance in dev mode). A missing or mismatched Origin must return HTTP 403 Forbidden.
5. *From Observation 1, 3, and 5:* The unit test suite `tests/unit/auth.test.ts` must comprehensively verify:
   - Scrypt hashing, constant-time verification, length mismatch handling, malformed hash rejection.
   - JWT generation, valid verification, signature tampering rejection, payload tampering rejection, expired rejection.
   - Rate limiting: 5 allowed, 6th blocked (`allowed: false`), remaining attempts decrements, resets on window expiry and on success, isolated IP tracking.
   - Origin validation: exact match passes, localhost dev variations pass, missing origin fails (403), mismatch fails (403).
   - Session cookie security options (`admin_session`, `httpOnly: true, secure: true, sameSite: 'strict', maxAge: 43200`).

---

### 3. Caveats
- `src/lib/auth.ts` currently lacks rate limiting functions (`checkRateLimit`, `recordFailedAttempt`, `resetRateLimit`) and `validateOrigin`. These will be implemented by the assigned M1 developer agent following this specification.
- In Next.js Edge Middleware, while `jose` runs natively, in-memory state (like IP rate limiting) is best placed in the Node.js Route Handler (`/api/admin/login`) because Edge functions can be deployed across multi-region instances where memory is not shared. Rate limiting failed admin logins directly in `/api/admin/login` ensures accurate, isolated state management.

---

### 4. Conclusion
The specification for Milestone M1 is fully mined, verified, and documented.
All acceptance criteria, 14 discovered features, 42 edge cases, cryptographic parameters, rate limiting mechanics, Origin validation rules, status codes, and the complete unit test architecture for `tests/unit/auth.test.ts` are codified in `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m1_1\analysis.md`.

---

### 5. Verification Method
1. **Inspect Analysis File:**
   - Path: `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m1_1\analysis.md`
   - Confirm presence of Features Discovered table, Edge Cases matrix, API endpoint contracts, and unit test specifications.
2. **Execute Current Unit Tests:**
   - Command: `npm test`
   - Expected: 7 tests passing in `tests/unit/env.test.ts`.
3. **Invalidation Conditions:**
   - If `tests/unit/auth.test.ts` does not cover all 5 suites defined in `analysis.md`, the specification verification is invalidated.
   - If scrypt parameters or cookie maxAge deviate from `43200` seconds / 12 hours, the specification is violated.
