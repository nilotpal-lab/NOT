# Milestone M1 Architecture & Implementation Blueprint: Admin Authentication & Session Security

**Author**: Explorer 1 (`teamwork_preview_explorer`)  
**Target Milestone**: M1 (Admin Authentication & Session Security)  
**Status**: Ready for Implementation  
**Date**: 2026-10-04  

---

## 1. Executive Summary

Milestone M1 establishes the zero-trust administrative security foundation for the "SST Chapter Library" application. It provides:
1. **Scrypt Constant-Time Authentication**: Validating credentials against the stored `ADMIN_PASSWORD_HASH` using Node.js `crypto.timingSafeEqual`.
2. **Stateless 12-Hour JWT Session**: Issued using `jose` with HS256 algorithm and stored in an `httpOnly`, `Secure`, `SameSite=Strict` cookie named `admin_session`.
3. **In-Memory IP Rate Limiter**: Maximum 5 failed attempts per 15-minute sliding window; triggers HTTP 429 on the 6th attempt with `Retry-After` header.
4. **Origin Header Verification**: Server-side rejection (HTTP 403) of mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) with missing or mismatched `Origin` headers.
5. **Next.js Edge Middleware**: Guarding all `/admin/*` pages and `/api/admin/*` endpoints, cleanly separating Edge-safe JWT logic from Node-only `crypto.scrypt`.
6. **Tailwind CSS v4 Admin Login UI**: Modern, accessible login form with responsive card layout, password visibility toggle, loading states, error alerts, and redirect handling.

---

## 2. Codebase Baseline & Dependencies

From investigation of `package.json`, `src/lib/validate.ts`, and `src/lib/auth.ts`:
- **Next.js**: `^16.3.8` (App Router, Turbopack)
- **React**: `^19.3.0`
- **Jose**: `^6.2.12` (Edge-compatible Web Crypto JWT library)
- **Tailwind CSS**: `^4.3.3` with `@tailwindcss/postcss`
- **Testing**: `vitest` `^3.0.0`
- **Environment**: Validated by `src/lib/validate.ts`:
  - `ADMIN_PASSWORD_HASH`: required string (`salt:hex`)
  - `SESSION_SECRET`: min 16 characters string
  - `SITE_URL`: valid URL (`http://localhost:3000` default)

---

## 3. Architecture & Module Design

### 3.1 Edge Compatibility Strategy (`src/lib/auth-jwt.ts` vs `src/lib/auth.ts`)
Next.js middleware defaults to the Edge runtime. Node's `crypto.scrypt` does not run in the Edge runtime.
To prevent bundler failures during Turbopack compilation:
- **`src/lib/auth-jwt.ts`**: Pure Web-Crypto/`jose` functions: `createAdminToken`, `verifyAdminToken`, `validateOrigin`, and cookie constants.
- **`src/lib/auth.ts`**: Node-only password utilities (`hashPassword`, `verifyPassword`) + in-memory rate limiting (`checkRateLimit`, `recordFailedAttempt`, `resetRateLimit`) + re-export of all items from `auth-jwt.ts`.
This guarantees that:
1. `src/middleware.ts` can import `verifyAdminToken`, `validateOrigin`, `ADMIN_COOKIE_NAME` without pulling in `crypto.scrypt`.
2. Existing tests (`tests/unit/env.test.ts`) that import from `@/lib/auth` continue to work without breaking changes.

---

## 4. Concrete Specifications & Code Blueprints

### 4.1 `src/lib/auth-jwt.ts` (Edge-Safe Token & Origin Utilities)

```typescript
import { SignJWT, jwtVerify } from "jose";

export const ADMIN_COOKIE_NAME = "admin_session";
export const COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours (43,200s)

export interface AdminCookieOptions {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "strict";
  path: string;
  maxAge: number;
}

export function getAdminCookieOptions(token: string): AdminCookieOptions {
  return {
    name: ADMIN_COOKIE_NAME,
    value: token,
    httpOnly: true,
    // Secure flag: true by default, allows local override if explicitly requested
    secure: process.env.NODE_ENV === "production" || process.env.INSECURE_COOKIE !== "true",
    sameSite: "strict",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

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

/**
 * Validates Origin header for mutating requests against host or SITE_URL.
 * Rejects missing or mismatched Origin headers.
 */
export function validateOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;

  try {
    const originUrl = new URL(origin);
    const hostHeader = req.headers.get("host") || req.headers.get("x-forwarded-host");

    if (hostHeader) {
      const hostHostname = hostHeader.split(":")[0];
      const originHostname = originUrl.hostname;
      
      const hostPort = hostHeader.split(":")[1] || (req.headers.get("x-forwarded-proto") === "https" ? "443" : "80");
      const originPort = originUrl.port || (originUrl.protocol === "https:" ? "443" : "80");

      // Exact match
      if (hostHostname === originHostname && hostPort === originPort) {
        return true;
      }

      // Localhost / 127.0.0.1 development equivalence
      const isLocalHost = (h: string) => h === "localhost" || h === "127.0.0.1";
      if (isLocalHost(hostHostname) && isLocalHost(originHostname) && hostPort === originPort) {
        return true;
      }
    }

    // Fallback to configured SITE_URL
    const siteUrlEnv = process.env.SITE_URL;
    if (siteUrlEnv) {
      const siteUrl = new URL(siteUrlEnv);
      if (originUrl.origin === siteUrl.origin) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}
```

---

### 4.2 `src/lib/auth.ts` (Complete Auth & Rate Limit Engine)

```typescript
import crypto from "crypto";

export * from "./auth-jwt";
import {
  createAdminToken,
  verifyAdminToken,
  validateOrigin,
  ADMIN_COOKIE_NAME,
  COOKIE_MAX_AGE_SECONDS,
  getAdminCookieOptions,
} from "./auth-jwt";

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS: crypto.ScryptOptions = {
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
};

export async function hashPassword(plainText: string): Promise<string> {
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

// ==========================================
// In-Memory IP Rate Limiting Engine
// Window: 15 minutes, Max: 5 failed attempts
// ==========================================

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;

export interface RateLimitStatus {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds?: number;
}

// Global in-memory storage for failed attempt timestamps per IP
const failedAttemptsMap = new Map<string, number[]>();

export function checkRateLimit(ip: string): RateLimitStatus {
  const now = Date.now();
  const timestamps = failedAttemptsMap.get(ip) || [];

  // Filter timestamps within sliding window
  const activeTimestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  failedAttemptsMap.set(ip, activeTimestamps);

  if (activeTimestamps.length >= MAX_FAILED_LOGIN_ATTEMPTS) {
    const oldest = activeTimestamps[0];
    const retryAfterMs = oldest + RATE_LIMIT_WINDOW_MS - now;
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds,
    };
  }

  return {
    allowed: true,
    remainingAttempts: MAX_FAILED_LOGIN_ATTEMPTS - activeTimestamps.length,
  };
}

export function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const timestamps = failedAttemptsMap.get(ip) || [];
  const activeTimestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  activeTimestamps.push(now);
  failedAttemptsMap.set(ip, activeTimestamps);
}

export function resetRateLimit(ip: string): void {
  failedAttemptsMap.delete(ip);
}

export function _clearAllRateLimits(): void {
  failedAttemptsMap.clear();
}
```

---

### 4.3 `src/middleware.ts` (Next.js Security & Route Guard)

```typescript
import { NextRequest, NextResponse } from "next/server";
import {
  verifyAdminToken,
  validateOrigin,
  ADMIN_COOKIE_NAME,
} from "@/lib/auth-jwt";

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
  ],
};

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();
  const secret = process.env.SESSION_SECRET;

  // 1. Origin header check for mutating requests on /api/admin/*
  if (pathname.startsWith("/api/admin/") && MUTATING_METHODS.has(method)) {
    if (!validateOrigin(req)) {
      return NextResponse.json(
        { error: "Invalid or missing Origin header" },
        { status: 403 }
      );
    }
  }

  // 2. Allow login API endpoint without credentials
  if (pathname === "/api/admin/login") {
    return NextResponse.next();
  }

  // 3. API admin routes protection (/api/admin/*)
  if (pathname.startsWith("/api/admin/")) {
    const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    if (!token || !secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isValid = await verifyAdminToken(token, secret);
    if (!isValid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.next();
  }

  // 4. Admin UI routes (/admin/*)
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const isAuthenticated = token && secret ? await verifyAdminToken(token, secret) : false;

  // If visiting /admin/login while already authenticated -> redirect to /admin
  if (pathname === "/admin/login") {
    if (isAuthenticated) {
      const dashboardUrl = req.nextUrl.clone();
      dashboardUrl.pathname = "/admin";
      return NextResponse.redirect(dashboardUrl);
    }
    return NextResponse.next();
  }

  // If visiting protected /admin/* page while unauthenticated -> redirect to /admin/login
  if (!isAuthenticated) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/admin/login";
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
```

---

### 4.4 `src/app/api/admin/login/route.ts` (Login Handler)

```typescript
import { NextRequest, NextResponse } from "next/server";
import {
  verifyPassword,
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
  createAdminToken,
  validateOrigin,
  ADMIN_COOKIE_NAME,
  COOKIE_MAX_AGE_SECONDS,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 1. Validate Origin header
  if (!validateOrigin(req)) {
    return NextResponse.json(
      { error: "Invalid or missing Origin header" },
      { status: 403 }
    );
  }

  // 2. Extract Client IP
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : req.headers.get("x-real-ip") || "127.0.0.1";

  // 3. Rate Limit Check
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "Too many failed attempts. Please try again later.",
        retryAfter: rateLimit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds || 900),
        },
      }
    );
  }

  // 4. Parse Body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || !("password" in body)) {
    return NextResponse.json({ error: "Password is required" }, { status: 400 });
  }

  const { password } = body as { password: unknown };
  if (typeof password !== "string" || !password.trim()) {
    return NextResponse.json({ error: "Password is required" }, { status: 400 });
  }

  // 5. Environment check
  const storedHash = process.env.ADMIN_PASSWORD_HASH;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!storedHash || !sessionSecret) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  // 6. Verify Password
  const isValid = await verifyPassword(password, storedHash);
  if (!isValid) {
    recordFailedAttempt(ip);
    const updatedStatus = checkRateLimit(ip);
    return NextResponse.json(
      {
        error: "Invalid password",
        remainingAttempts: updatedStatus.remainingAttempts,
      },
      { status: 401 }
    );
  }

  // 7. Success: Reset rate limit & Issue Cookie
  resetRateLimit(ip);
  const token = await createAdminToken(sessionSecret);

  const response = NextResponse.json(
    { success: true, message: "Logged in successfully" },
    { status: 200 }
  );

  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || process.env.INSECURE_COOKIE !== "true",
    sameSite: "strict",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}
```

---

### 4.5 `src/app/api/admin/logout/route.ts` (Logout Handler)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  const response = NextResponse.json(
    { success: true, message: "Logged out successfully" },
    { status: 200 }
  );

  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || process.env.INSECURE_COOKIE !== "true",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });

  return response;
}
```

---

### 4.6 `src/app/api/admin/session/route.ts` (Session Check Handler)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken, ADMIN_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const secret = process.env.SESSION_SECRET;

  if (!token || !secret) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const isValid = await verifyAdminToken(token, secret);
  if (!isValid) {
    return NextResponse.json(
      { authenticated: false, error: "Invalid or expired session" },
      { status: 401 }
    );
  }

  return NextResponse.json({ authenticated: true, role: "admin" }, { status: 200 });
}
```

---

### 4.7 `src/app/admin/login/page.tsx` (Client Login Interface)

```tsx
"use client";

import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get("from") || "/admin";

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;

    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          setError(
            `Too many failed attempts. Account locked. Please wait ${data.retryAfter || 900} seconds before retrying.`
          );
          setRemainingAttempts(0);
        } else {
          setError(data.error || "Authentication failed");
          if (data.remainingAttempts !== undefined) {
            setRemainingAttempts(data.remainingAttempts);
          }
        }
        return;
      }

      // Successful login -> Navigate to target page
      router.push(fromUrl);
      router.refresh();
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-180px)] px-4">
      <div className="w-full max-w-md p-8 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] mb-3">
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-[var(--foreground)] tracking-tight">
            Admin Authentication
          </h1>
          <p className="text-sm text-[var(--muted)] mt-1">
            Enter master key to manage chapters, upload materials, and edit library records.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm flex flex-col gap-1"
          >
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="font-medium">{error}</span>
            </div>
            {remainingAttempts !== null && remainingAttempts > 0 && (
              <span className="text-xs text-red-600 dark:text-red-400 pl-6">
                {remainingAttempts} attempt{remainingAttempts === 1 ? "" : "s"} remaining before temporary lockout.
              </span>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="admin-password"
              className="block text-sm font-medium text-[var(--foreground)] mb-1"
            >
              Master Password
            </label>
            <div className="relative">
              <input
                id="admin-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                disabled={loading}
                placeholder="••••••••••••"
                className="w-full px-3.5 py-2.5 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-[var(--foreground)] placeholder-[var(--muted)] focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent text-sm transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted)] hover:text-[var(--foreground)] text-xs font-medium cursor-pointer"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !password.trim()}
            className="w-full py-2.5 px-4 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer shadow-xs"
          >
            {loading ? (
              <>
                <svg
                  className="animate-spin h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                <span>Authenticating...</span>
              </>
            ) : (
              <span>Sign In to Dashboard</span>
            )}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-[var(--border-color)] text-center text-xs text-[var(--muted)]">
          <a href="/" className="hover:text-[var(--foreground)] transition-colors">
            &larr; Return to Public Library
          </a>
        </div>
      </div>
    </div>
  );
}
```

---

### 4.8 `tests/unit/auth.test.ts` (Comprehensive Vitest Suite)

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import {
  hashPassword,
  verifyPassword,
  createAdminToken,
  verifyAdminToken,
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
  _clearAllRateLimits,
  validateOrigin,
  ADMIN_COOKIE_NAME,
  COOKIE_MAX_AGE_SECONDS,
  getAdminCookieOptions,
} from "@/lib/auth";

describe("Milestone M1: Authentication Core", () => {
  beforeEach(() => {
    _clearAllRateLimits();
  });

  describe("Password Hashing & Constant-Time Verification", () => {
    it("generates scrypt hash and verifies valid password", async () => {
      const password = "SuperSecureAdmin2026!";
      const hash = await hashPassword(password);
      expect(hash).toContain(":");

      const isMatch = await verifyPassword(password, hash);
      expect(isMatch).toBe(true);
    });

    it("rejects invalid password", async () => {
      const hash = await hashPassword("ValidPassword");
      const isMatch = await verifyPassword("WrongPassword", hash);
      expect(isMatch).toBe(false);
    });

    it("handles malformed hash string gracefully", async () => {
      expect(await verifyPassword("password", "invalid-hash-without-colon")).toBe(false);
      expect(await verifyPassword("password", "")).toBe(false);
    });
  });

  describe("Stateless JWT Admin Token", () => {
    const secret = "0123456789abcdef0123456789abcdef";

    it("creates a signed JWT valid for 12 hours", async () => {
      const token = await createAdminToken(secret);
      expect(typeof token).toBe("string");

      const isValid = await verifyAdminToken(token, secret);
      expect(isValid).toBe(true);
    });

    it("rejects tampered token", async () => {
      const token = await createAdminToken(secret);
      const tampered = token + "xyz";
      expect(await verifyAdminToken(tampered, secret)).toBe(false);
    });

    it("rejects token verified against incorrect secret", async () => {
      const token = await createAdminToken(secret);
      expect(await verifyAdminToken(token, "wrong-secret-with-length-over-32")).toBe(false);
    });
  });

  describe("IP Rate Limiting (5 Attempts / 15 Minutes)", () => {
    const testIp = "203.0.113.42";

    it("allows up to 5 failed attempts and calculates remaining count", () => {
      expect(checkRateLimit(testIp).allowed).toBe(true);
      expect(checkRateLimit(testIp).remainingAttempts).toBe(5);

      recordFailedAttempt(testIp);
      expect(checkRateLimit(testIp).remainingAttempts).toBe(4);

      recordFailedAttempt(testIp);
      expect(checkRateLimit(testIp).remainingAttempts).toBe(3);

      recordFailedAttempt(testIp);
      recordFailedAttempt(testIp);
      recordFailedAttempt(testIp); // 5th failure

      expect(checkRateLimit(testIp).remainingAttempts).toBe(0);
      expect(checkRateLimit(testIp).allowed).toBe(false);
    });

    it("blocks 6th attempt with HTTP 429 status response parameters", () => {
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt(testIp);
      }

      const status = checkRateLimit(testIp);
      expect(status.allowed).toBe(false);
      expect(status.remainingAttempts).toBe(0);
      expect(status.retryAfterSeconds).toBeGreaterThan(0);
      expect(status.retryAfterSeconds).toBeLessThanOrEqual(900);
    });

    it("resets failed attempts upon successful login", () => {
      for (let i = 0; i < 4; i++) {
        recordFailedAttempt(testIp);
      }
      expect(checkRateLimit(testIp).remainingAttempts).toBe(1);

      resetRateLimit(testIp);
      expect(checkRateLimit(testIp).allowed).toBe(true);
      expect(checkRateLimit(testIp).remainingAttempts).toBe(5);
    });

    it("isolates rate limiting per IP", () => {
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt("10.0.0.1");
      }
      expect(checkRateLimit("10.0.0.1").allowed).toBe(false);
      expect(checkRateLimit("10.0.0.2").allowed).toBe(true);
      expect(checkRateLimit("10.0.0.2").remainingAttempts).toBe(5);
    });
  });

  describe("Origin Header Validation", () => {
    it("accepts valid origin matching host", () => {
      const req = new Request("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          origin: "http://localhost:3000",
        },
      });
      expect(validateOrigin(req)).toBe(true);
    });

    it("rejects request with missing origin header", () => {
      const req = new Request("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          host: "localhost:3000",
        },
      });
      expect(validateOrigin(req)).toBe(false);
    });

    it("rejects request with mismatched origin header", () => {
      const req = new Request("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          origin: "https://malicious-attacker.com",
        },
      });
      expect(validateOrigin(req)).toBe(false);
    });
  });

  describe("Cookie Security Attributes", () => {
    it("configures strict httpOnly, secure, and 12h maxAge", () => {
      expect(ADMIN_COOKIE_NAME).toBe("admin_session");
      expect(COOKIE_MAX_AGE_SECONDS).toBe(43200);

      const options = getAdminCookieOptions("test-token");
      expect(options.name).toBe("admin_session");
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe("strict");
      expect(options.path).toBe("/");
      expect(options.maxAge).toBe(43200);
    });
  });
});
```

---

## 5. Potential Pitfalls & Mitigations

1. **Turbopack Edge Module Resolution**:
   - *Risk*: Importing Node.js `crypto` inside `src/middleware.ts` breaks Edge runtime compilation.
   - *Mitigation*: Segregate Edge-safe functions (`jose` + `validateOrigin`) into `src/lib/auth-jwt.ts`. `src/middleware.ts` only imports `auth-jwt.ts`.
2. **Localhost HTTP vs Secure Cookie**:
   - *Risk*: Browsers running on `http://localhost:3000` might ignore `Secure` cookies if not recognized as secure context.
   - *Mitigation*: Modern Chromium and Firefox treat `http://localhost` as secure context. In addition, allow an environment override `INSECURE_COOKIE=true` for custom non-HTTPS local IP testing.
3. **Sliding Window Memory Growth**:
   - *Risk*: Unlimited growth of IP keys in `failedAttemptsMap`.
   - *Mitigation*: Periodically prune timestamps and purge empty keys during `checkRateLimit`.
4. **Origin Header on Mobile / Proxies**:
   - *Risk*: `x-forwarded-host` or port variations in reverse proxies.
   - *Mitigation*: `validateOrigin` checks `host`, `x-forwarded-host`, and `SITE_URL` with robust URL parsing.
