# Analysis Report: Security, Rate Limiting & Middleware (Milestone M1)

**Agent**: `explorer_m1_2` (Explorer 2 for M1)  
**Date**: 2026-10-04  
**Scope**: Next.js App Router Middleware architecture, Edge Runtime JWT verification, In-Memory IP Rate Limiting, Origin Header Validation, and Route Redirection / 401 Handling.

---

## Executive Summary

This report establishes the comprehensive architectural blueprint for the security subsystem of Milestone M1. It analyzes the interaction between Next.js Edge Middleware and Node.js App Router API handlers, demonstrates why IP rate limiting belongs in `/api/admin/login` rather than Edge middleware, resolves potential Edge runtime bundling pitfalls with Node's `crypto` module, designs an in-memory IP rate limiter that strictly adheres to the 5-attempt/15-minute window with zero memory leaks, formulates robust Origin header validation for mutating requests, and maps out exact route-matching and redirection/401 policies.

---

## 1. Next.js App Router Middleware Architecture (`src/middleware.ts`)

### 1.1 Route Matching Configuration
Next.js App Router middleware executes before routes are rendered. To minimize overhead and ensure public routes remain unimpeded, the middleware matcher must strictly isolate the admin domain:

```typescript
export const config = {
  matcher: [
    '/admin',
    '/admin/:path*',
    '/api/admin/:path*',
  ],
};
```

**Matcher Behavior:**
- Matches root admin page `/admin` and nested pages (`/admin/login`, `/admin/upload`, `/admin/library`, etc.).
- Matches all admin API endpoints (`/api/admin/login`, `/api/admin/logout`, `/api/admin/upload/part`, `/api/admin/upload/complete`, `/api/admin/library/*`).
- Completely bypasses public routes: `/`, `/api/health`, `/chapter/:path*`, `/api/files/:path*`, `/api/library.json`, and static assets (`/_next/*`, `/favicon.ico`).

### 1.2 Public Route Exemptions
Within the matched admin path set, two endpoints represent entry points and must be exempted from admin session verification:
1. `/admin/login` (Admin Login UI) — Must be accessible to unauthenticated visitors.
2. `/api/admin/login` (Admin Authentication API) — Must accept credentials from unauthenticated visitors.

```typescript
const { pathname } = request.nextUrl;

// Public admin exemptions
if (pathname === '/admin/login') {
  return NextResponse.next();
}
```
*Note on `/api/admin/login`:* While exempted from session authentication, it is a mutating `POST` endpoint and therefore **MUST** undergo Origin header validation before reaching the route handler.

---

## 2. Edge Runtime & JWT Verification Compatibility

### 2.1 The Edge Runtime Constraint
In Next.js 14–16, `middleware.ts` runs exclusively within the **Edge Runtime** (V8 isolate).
- Edge Runtime does **not** support Node.js core modules like `fs`, `net`, and crucially `crypto.scrypt`.
- If `src/middleware.ts` statically imports `src/lib/auth.ts`, and `auth.ts` has top-level `import crypto from "crypto"` with `crypto.scrypt(...)`, the Next.js Edge compiler statically inspects the dependency graph and will trigger:
  `Error: The edge runtime does not support Node.js 'crypto.scrypt' module.`

### 2.2 Proof of Jose Web-API Purity
Inspection of `node_modules/jose/package.json` confirms:
- Package version: `6.2.12`.
- Main/default export: `"./dist/webapi/index.js"`.
- `jose` relies exclusively on the standard Web Cryptography API (`crypto.subtle`) and `TextEncoder`, which are first-class globals in the Edge Runtime.
- `jwtVerify` and `SignJWT` execute without Node.js dependencies.

### 2.3 Edge-Safe Architecture Recommendation
To prevent Next.js compiler errors while preserving the unified interface contract in `src/lib/auth.ts`:

#### Option A (Recommended): Dynamic Import for Node Crypto in `auth.ts`
In `src/lib/auth.ts`, dynamically import `node:crypto` inside `hashPassword` and `verifyPassword`:
```typescript
export async function verifyPassword(plainText: string, storedHash: string): Promise<boolean> {
  const [salt, keyHex] = storedHash.split(":");
  if (!salt || !keyHex) return false;

  const crypto = await import("crypto");
  return new Promise((resolve) => {
    crypto.scrypt(plainText, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (err, derivedKey) => {
      if (err) return resolve(false);
      const keyBuffer = Buffer.from(keyHex, "hex");
      if (keyBuffer.length !== derivedKey.length) return resolve(false);
      try {
        resolve(crypto.timingSafeEqual(keyBuffer, derivedKey));
      } catch {
        resolve(false);
      }
    });
  });
}
```
Because `verifyAdminToken` only uses `jose`, and `crypto` is dynamically imported in password routines that middleware never calls, `auth.ts` can be safely imported by `src/middleware.ts` without triggering Edge bundling errors.

#### Option B: Clean WebCrypto Token Helper
Alternatively, define a lightweight token helper `src/lib/token.ts` with `verifyAdminToken` using only `jose`, and re-export from `src/lib/auth.ts`. Middleware imports from `src/lib/token.ts`.

---

## 3. In-Memory IP Rate Limiting Strategy

### 3.1 Architectural Placement: `/api/admin/login` vs Middleware
A fundamental finding of this analysis is that **IP rate limiting must be managed within the Node.js API route (`/api/admin/login/route.ts`), not in Edge Middleware**:
1. **Isolated Memory Spaces**: In Next.js, Edge Middleware and Node.js route handlers run in separate process/runtime environments. An in-memory `Map` instantiated in Edge Middleware is not shared with the Node.js runtime of `/api/admin/login`.
2. **Failure-Based Rate Limiting**: The specification dictates: "maximum 5 *failed* attempts per 15 minutes per IP; return 429 on 6th attempt". Middleware runs *before* password verification and cannot know whether the password is valid or invalid.
3. **Execution Sequence**:
   - `POST /api/admin/login` arrives.
   - Route handler extracts client IP: `const ip = extractClientIp(req);`.
   - Route handler evaluates `const status = checkRateLimit(ip);`.
   - If `!status.allowed`, return HTTP 429 with `Retry-After: status.retryAfterSeconds`.
   - If allowed, verify password.
   - If password incorrect: call `recordFailedAttempt(ip)` and return HTTP 401.
   - If password correct: call `resetRateLimit(ip)` and issue session cookie.

### 3.2 Client IP Extraction
To support local development, proxies, reverse-proxies (Render.com), and Cloudflare:
```typescript
export function extractClientIp(req: Request | Headers): string {
  const headers = req instanceof Request ? req.headers : req;

  // 1. Standard x-forwarded-for header (first IP in comma-separated list is client)
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const clientIp = forwardedFor.split(",")[0]?.trim();
    if (clientIp) return clientIp;
  }

  // 2. Reverse proxy x-real-ip
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  // 3. Cloudflare connecting IP
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  // 4. Default fallback for local testing
  return "127.0.0.1";
}
```

### 3.3 Rate Limiter Implementation & Memory Leak Prevention
- **Window**: 15 minutes (`15 * 60 * 1000 = 900,000` ms).
- **Threshold**: 5 failed attempts allowed. Block on the 6th attempt (`failedAttempts >= 5`).
- **Data Structure**:
```typescript
interface RateLimitRecord {
  failedAttempts: number;
  firstAttemptAt: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
```

- **Leak Prevention**:
  1. *Passive Cleanup*: Expired entries are automatically detected and purged on access during `checkRateLimit` and `recordFailedAttempt`.
  2. *Opportunistic Sweep*: Whenever `recordFailedAttempt` is invoked, if the store contains > 500 entries or > 5 minutes have elapsed since the last sweep, all expired records are removed via `rateLimitStore.entries()`.
  3. *Zero Hanging Timers*: Avoids un-unref'd `setInterval`, ensuring tests (Vitest) exit cleanly without open handles.
  4. *Reset Helper*: `_clearRateLimitStore()` is provided to enable test isolation.

---

## 4. Origin Header Validation

### 4.1 Specification & Threat Model
Mutating requests (`POST`, `PUT`, `DELETE`, `PATCH`) to `/api/admin/*` represent state changes (login, upload, catalog editing, deletion). To defend against Cross-Site Request Forgery (CSRF) and cross-origin abuse:
- Any mutating admin request must have an `Origin` header.
- The `Origin` must match either the configured `SITE_URL` origin or the incoming request's host.
- Missing or mismatched origins are immediately rejected with **HTTP 403 Forbidden**.

### 4.2 Algorithm (`validateOrigin`)
```typescript
export function validateOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    return false; // Reject missing origin on mutating requests
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false; // Reject malformed origin
  }

  // 1. Check against configured SITE_URL (from env)
  const siteUrl = process.env.SITE_URL;
  if (siteUrl) {
    try {
      const configuredOrigin = new URL(siteUrl).origin;
      if (originUrl.origin === configuredOrigin) {
        return true;
      }
    } catch {
      // Ignore invalid SITE_URL parse error
    }
  }

  // 2. Check against request Host / X-Forwarded-Host
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) {
    const hostHeader = host.split(",")[0]?.trim();
    if (originUrl.host === hostHeader) {
      return true;
    }
  }

  return false;
}
```

### 4.3 Middleware Enforcement
Because Edge Middleware intercepts every request before routing to handlers, Origin validation is enforced centrally in `src/middleware.ts`:
```typescript
const isMutating = ["POST", "PUT", "DELETE", "PATCH"].includes(request.method);
if (isMutating && pathname.startsWith("/api/admin/")) {
  if (!validateOrigin(request)) {
    return NextResponse.json(
      { error: "Forbidden: Invalid or missing Origin header" },
      { status: 403 }
    );
  }
}
```
This guarantees that unauthenticated attacks, CSRF attempts, and unauthorized origins are stopped at the perimeter before any session or database operations.

---

## 5. Redirection & 401 Handling Matrix

| Request Target | HTTP Method | Auth State | Origin State | Expected Response | Rationale |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/admin/login` | GET | Any | N/A | `NextResponse.next()` (200) | Public admin login page exemption |
| `/api/admin/login` | POST | Unauth | Valid | Route handler (200, 401, or 429) | Public auth endpoint; rate limited in route |
| `/api/admin/login` | POST | Any | Missing/Bad | HTTP 403 JSON | Central origin check blocks bad origins |
| `/admin` or `/admin/*` | GET | Unauth | N/A | HTTP 307 Redirect → `/admin/login?from=...` | Interactive browser page requires login |
| `/admin` or `/admin/*` | GET | Invalid/Expired JWT | N/A | HTTP 307 Redirect → `/admin/login?from=...` | Tampered/expired session redirected |
| `/api/admin/*` | GET/POST/etc. | Unauth | Valid/N/A | HTTP 401 JSON: `{ error: "Unauthorized..." }` | API clients receive JSON, not redirects |
| `/api/admin/*` | Mutating | Any | Missing/Bad | HTTP 403 JSON: `{ error: "Forbidden..." }` | Origin check takes precedence on mutations |
| `/api/admin/*` | Any | Valid Admin JWT | Valid/Safe | `NextResponse.next()` | Authorized admin request |
| `/` or `/api/health` | GET | Public | N/A | `NextResponse.next()` (200) | Matcher excludes all public endpoints |

---

## 6. Complete Implementation Designs

### 6.1 `src/middleware.ts`
```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

export const config = {
  matcher: [
    "/admin",
    "/admin/:path*",
    "/api/admin/:path*",
  ],
};

function isValidOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;

  try {
    const originUrl = new URL(origin);

    const siteUrl = process.env.SITE_URL;
    if (siteUrl) {
      try {
        if (originUrl.origin === new URL(siteUrl).origin) return true;
      } catch {}
    }

    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    if (host) {
      const cleanHost = host.split(",")[0]?.trim();
      if (originUrl.host === cleanHost) return true;
    }
  } catch {
    return false;
  }

  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

  // 1. Allow login UI unconditionally
  if (pathname === "/admin/login") {
    return NextResponse.next();
  }

  // 2. Validate Origin on mutating requests to /api/admin/* (including /api/admin/login)
  const isMutating = ["POST", "PUT", "DELETE", "PATCH"].includes(method);
  if (isMutating && pathname.startsWith("/api/admin/")) {
    if (!isValidOrigin(request)) {
      return NextResponse.json(
        { error: "Forbidden: Invalid or missing Origin header" },
        { status: 403 }
      );
    }
  }

  // 3. Allow /api/admin/login endpoint through to handler (credentials verified there)
  if (pathname === "/api/admin/login") {
    return NextResponse.next();
  }

  // 4. Verify admin session cookie
  const token = request.cookies.get("admin_session")?.value;
  const secret = process.env.SESSION_SECRET;

  let isAuthenticated = false;
  if (token && secret) {
    try {
      const secretKey = new TextEncoder().encode(secret);
      const { payload } = await jwtVerify(token, secretKey, {
        algorithms: ["HS256"],
      });
      isAuthenticated = payload.role === "admin";
    } catch {
      isAuthenticated = false;
    }
  }

  // 5. Handle unauthenticated requests
  if (!isAuthenticated) {
    if (pathname.startsWith("/api/admin/")) {
      return NextResponse.json(
        { error: "Unauthorized: Admin authentication required" },
        { status: 401 }
      );
    }

    // Page requests: redirect to /admin/login with destination preservation
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
```

### 6.2 Rate Limiter & Auth Utilities (`src/lib/auth.ts`)
```typescript
import { SignJWT, jwtVerify } from "jose";

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = {
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
};

export const ADMIN_COOKIE_NAME = "admin_session";
export const ADMIN_COOKIE_MAX_AGE = 12 * 60 * 60; // 12 hours

export const ADMIN_COOKIE_OPTIONS = {
  name: ADMIN_COOKIE_NAME,
  httpOnly: true,
  secure: true,
  sameSite: "strict" as const,
  path: "/",
  maxAge: ADMIN_COOKIE_MAX_AGE,
};

// Password Hashing & Verification (Dynamic Import to guarantee Edge-safety)
export async function hashPassword(plainText: string): Promise<string> {
  const crypto = await import("crypto");
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(plainText, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

export async function verifyPassword(plainText: string, storedHash: string): Promise<boolean> {
  const [salt, keyHex] = storedHash.split(":");
  if (!salt || !keyHex) return false;

  const crypto = await import("crypto");
  return new Promise((resolve) => {
    crypto.scrypt(plainText, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (err, derivedKey) => {
      if (err) return resolve(false);
      const keyBuffer = Buffer.from(keyHex, "hex");
      if (keyBuffer.length !== derivedKey.length) return resolve(false);
      try {
        resolve(crypto.timingSafeEqual(keyBuffer, derivedKey));
      } catch {
        resolve(false);
      }
    });
  });
}

// Token Generation & Verification (Pure Web-Crypto via jose)
export async function createAdminToken(secretString: string): Promise<string> {
  const secretKey = new TextEncoder().encode(secretString);
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secretKey);
}

export async function verifyAdminToken(token: string, secretString: string): Promise<boolean> {
  try {
    const secretKey = new TextEncoder().encode(secretString);
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });
    return payload.role === "admin";
  } catch {
    return false;
  }
}

// Client IP Extraction
export function extractClientIp(req: Request | Headers): string {
  const headers = req instanceof Request ? req.headers : req;
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const clientIp = forwardedFor.split(",")[0]?.trim();
    if (clientIp) return clientIp;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  return "127.0.0.1";
}

// In-Memory Rate Limiting
export interface RateLimitStatus {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds?: number;
}

interface RateLimitRecord {
  failedAttempts: number;
  firstAttemptAt: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FAILED_ATTEMPTS = 5; // 5 failed attempts allowed; 6th blocked

export function checkRateLimit(ip: string): RateLimitStatus {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now >= record.resetAt) {
    if (record) rateLimitStore.delete(ip);
    return {
      allowed: true,
      remainingAttempts: MAX_FAILED_ATTEMPTS,
    };
  }

  if (record.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds,
    };
  }

  return {
    allowed: true,
    remainingAttempts: MAX_FAILED_ATTEMPTS - record.failedAttempts,
  };
}

export function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now >= record.resetAt) {
    rateLimitStore.set(ip, {
      failedAttempts: 1,
      firstAttemptAt: now,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
  } else {
    record.failedAttempts += 1;
  }

  cleanupExpiredRateLimits();
}

export function resetRateLimit(ip: string): void {
  rateLimitStore.delete(ip);
}

export function _clearRateLimitStore(): void {
  rateLimitStore.clear();
}

let lastCleanup = Date.now();
function cleanupExpiredRateLimits(): void {
  const now = Date.now();
  if (now - lastCleanup < 5 * 60 * 1000 && rateLimitStore.size < 500) {
    return;
  }
  lastCleanup = now;
  for (const [key, val] of rateLimitStore.entries()) {
    if (now >= val.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

// Origin Header Validation
export function validateOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const siteUrl = process.env.SITE_URL;
  if (siteUrl) {
    try {
      if (originUrl.origin === new URL(siteUrl).origin) return true;
    } catch {}
  }

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) {
    const cleanHost = host.split(",")[0]?.trim();
    if (originUrl.host === cleanHost) return true;
  }

  return false;
}
```

---

## 7. Recommended Test Cases for `tests/unit/auth.test.ts`
1. `checkRateLimit`:
   - Returns `allowed: true`, `remainingAttempts: 5` initially.
   - Calling `recordFailedAttempt` 5 times leaves `remainingAttempts: 0`.
   - On the 6th check, returns `allowed: false`, `retryAfterSeconds: <= 900`.
   - `resetRateLimit` restores `allowed: true`, `remainingAttempts: 5`.
2. `validateOrigin`:
   - Missing origin header returns `false`.
   - Origin matching `SITE_URL` returns `true`.
   - Origin matching `Host` header returns `true`.
   - Untrusted domain returns `false`.
3. `extractClientIp`:
   - Extracts first item from comma-separated `x-forwarded-for`.
   - Falls back to `x-real-ip`.
   - Falls back to `127.0.0.1`.
4. `verifyAdminToken`:
   - Rejects tampered token.
   - Rejects token signed with different secret.
   - Rejects expired token.
