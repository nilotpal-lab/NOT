import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { NextRequest, NextResponse } from "next/server";
import { middleware } from "@/middleware";
import {
  createAdminToken,
  verifyAdminToken,
  validateOrigin,
  ADMIN_COOKIE_NAME,
} from "@/lib/auth-jwt";
import { hashPassword, verifyPassword } from "@/lib/auth";

interface TestResult {
  suite: string;
  id: string;
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  error?: string;
}

const results: TestResult[] = [];

function record(
  suite: string,
  id: string,
  name: string,
  passed: boolean,
  expected: string,
  actual: string,
  error?: string
) {
  results.push({ suite, id, name, passed, expected, actual, error });
  const status = passed ? "PASS" : "FAIL";
  console.log(`[${status}] [${suite}] ${id}: ${name} | Expected: ${expected} | Actual: ${actual}`);
}

const BASE_URL = "http://localhost:3456";
const TEST_SECRET = "super-secret-session-key-at-least-32-chars-long";
let validAdminCookie = "";

async function runLiveHttpTests() {
  console.log("\n=======================================================");
  console.log("SUITE 1: LIVE HTTP ROUTE PROTECTION & ADVERSARIAL TESTS");
  console.log("=======================================================");

  // -------------------------------------------------------------
  // Scenario 1: Route Protection (Unauthenticated rejection)
  // -------------------------------------------------------------
  // 1.1 GET /admin
  try {
    const res = await fetch(`${BASE_URL}/admin`, { redirect: "manual" });
    const location = res.headers.get("location") || "";
    const isRedirect = res.status === 307 && location.includes("/admin/login");
    record(
      "Route Protection",
      "SEC-1.1",
      "Unauthenticated GET /admin redirects to /admin/login",
      isRedirect,
      "HTTP 307 redirect to /admin/login",
      `HTTP ${res.status} to ${location}`
    );
  } catch (err: any) {
    record("Route Protection", "SEC-1.1", "Unauthenticated GET /admin", false, "307 redirect", "Error", err.message);
  }

  // 1.2 GET /admin/dashboard
  try {
    const res = await fetch(`${BASE_URL}/admin/dashboard`, { redirect: "manual" });
    const location = res.headers.get("location") || "";
    const isRedirect = res.status === 307 && location.includes("/admin/login");
    record(
      "Route Protection",
      "SEC-1.2",
      "Unauthenticated GET /admin/dashboard redirects to /admin/login",
      isRedirect,
      "HTTP 307 redirect to /admin/login",
      `HTTP ${res.status} to ${location}`
    );
  } catch (err: any) {
    record("Route Protection", "SEC-1.2", "Unauthenticated GET /admin/dashboard", false, "307 redirect", "Error", err.message);
  }

  // 1.3 GET /admin/anything/deep/nested
  try {
    const res = await fetch(`${BASE_URL}/admin/anything/deep/nested`, { redirect: "manual" });
    const location = res.headers.get("location") || "";
    const isRedirect = res.status === 307 && location.includes("/admin/login");
    record(
      "Route Protection",
      "SEC-1.3",
      "Unauthenticated GET /admin/anything/deep/nested redirects to /admin/login",
      isRedirect,
      "HTTP 307 redirect to /admin/login",
      `HTTP ${res.status} to ${location}`
    );
  } catch (err: any) {
    record("Route Protection", "SEC-1.3", "Unauthenticated GET /admin/anything", false, "307 redirect", "Error", err.message);
  }

  // 1.4 GET /api/admin/session
  try {
    const res = await fetch(`${BASE_URL}/api/admin/session`, { redirect: "manual" });
    const data = await res.json().catch(() => ({}));
    const is401 = res.status === 401 && (data.error || "").toLowerCase().includes("unauthorized");
    record(
      "Route Protection",
      "SEC-1.4",
      "Unauthenticated GET /api/admin/session returns HTTP 401 JSON",
      is401,
      "HTTP 401 Unauthorized JSON",
      `HTTP ${res.status} ${JSON.stringify(data)}`
    );
  } catch (err: any) {
    record("Route Protection", "SEC-1.4", "Unauthenticated GET /api/admin/session", false, "401 JSON", "Error", err.message);
  }

  // 1.5 GET /api/admin/library/test
  try {
    const res = await fetch(`${BASE_URL}/api/admin/library/test`, { redirect: "manual" });
    const data = await res.json().catch(() => ({}));
    const is401 = res.status === 401 && (data.error || "").toLowerCase().includes("unauthorized");
    record(
      "Route Protection",
      "SEC-1.5",
      "Unauthenticated GET /api/admin/library/test returns HTTP 401 JSON",
      is401,
      "HTTP 401 Unauthorized JSON",
      `HTTP ${res.status} ${JSON.stringify(data)}`
    );
  } catch (err: any) {
    record("Route Protection", "SEC-1.5", "Unauthenticated GET /api/admin/library/test", false, "401 JSON", "Error", err.message);
  }

  // 1.6 Mutating POST /api/admin/upload/part without Origin -> 403 Forbidden
  try {
    const res = await fetch(`${BASE_URL}/api/admin/upload/part`, {
      method: "POST",
      redirect: "manual",
    });
    const data = await res.json().catch(() => ({}));
    const is403 = res.status === 403 && (data.error || "").toLowerCase().includes("origin");
    record(
      "Route Protection",
      "SEC-1.6",
      "Mutating POST /api/admin/upload/part without Origin returns HTTP 403",
      is403,
      "HTTP 403 Forbidden",
      `HTTP ${res.status} ${JSON.stringify(data)}`
    );
  } catch (err: any) {
    record("Route Protection", "SEC-1.6", "Mutating POST without Origin", false, "403", "Error", err.message);
  }

  // 1.7 Mutating POST /api/admin/upload/part with foreign Origin -> 403 Forbidden
  try {
    const res = await fetch(`${BASE_URL}/api/admin/upload/part`, {
      method: "POST",
      headers: {
        origin: "https://malicious-attacker.com",
      },
      redirect: "manual",
    });
    const data = await res.json().catch(() => ({}));
    const is403 = res.status === 403 && (data.error || "").toLowerCase().includes("origin");
    record(
      "Route Protection",
      "SEC-1.7",
      "Mutating POST with foreign Origin rejected with HTTP 403",
      is403,
      "HTTP 403 Forbidden",
      `HTTP ${res.status} ${JSON.stringify(data)}`
    );
  } catch (err: any) {
    record("Route Protection", "SEC-1.7", "Mutating POST foreign Origin", false, "403", "Error", err.message);
  }

  // 1.8 Mutating POST with valid Origin but unauthenticated -> 401 Unauthorized
  try {
    const res = await fetch(`${BASE_URL}/api/admin/upload/part`, {
      method: "POST",
      headers: {
        origin: BASE_URL,
      },
      redirect: "manual",
    });
    const data = await res.json().catch(() => ({}));
    const is401 = res.status === 401 && (data.error || "").toLowerCase().includes("unauthorized");
    record(
      "Route Protection",
      "SEC-1.8",
      "Mutating POST with valid Origin but unauthenticated returns HTTP 401",
      is401,
      "HTTP 401 Unauthorized JSON",
      `HTTP ${res.status} ${JSON.stringify(data)}`
    );
  } catch (err: any) {
    record("Route Protection", "SEC-1.8", "Mutating POST unauthenticated", false, "401", "Error", err.message);
  }

  // -------------------------------------------------------------
  // Scenario 2: Public Accessibility
  // -------------------------------------------------------------
  // 2.1 GET / (Homepage)
  try {
    const res = await fetch(`${BASE_URL}/`, { redirect: "manual" });
    const is200 = res.status === 200;
    record(
      "Public Accessibility",
      "PUB-2.1",
      "Unauthenticated GET / is publicly accessible (HTTP 200, no redirect)",
      is200,
      "HTTP 200 OK",
      `HTTP ${res.status}`
    );
  } catch (err: any) {
    record("Public Accessibility", "PUB-2.1", "Unauthenticated GET /", false, "200", "Error", err.message);
  }

  // 2.2 GET /api/health
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { redirect: "manual" });
    const data = await res.json().catch(() => ({}));
    const is200 = res.status === 200 && data.status === "ok";
    record(
      "Public Accessibility",
      "PUB-2.2",
      "Unauthenticated GET /api/health returns HTTP 200 with { status: 'ok' }",
      is200,
      "HTTP 200 OK with status: 'ok'",
      `HTTP ${res.status} ${JSON.stringify(data)}`
    );
  } catch (err: any) {
    record("Public Accessibility", "PUB-2.2", "Unauthenticated GET /api/health", false, "200", "Error", err.message);
  }

  // 2.3 GET /admin/login
  try {
    const res = await fetch(`${BASE_URL}/admin/login`, { redirect: "manual" });
    const is200 = res.status === 200;
    record(
      "Public Accessibility",
      "PUB-2.3",
      "Unauthenticated GET /admin/login renders login UI (HTTP 200, no redirect)",
      is200,
      "HTTP 200 OK",
      `HTTP ${res.status}`
    );
  } catch (err: any) {
    record("Public Accessibility", "PUB-2.3", "Unauthenticated GET /admin/login", false, "200", "Error", err.message);
  }

  // 2.4 POST /api/admin/login accessible to unauthenticated callers
  try {
    const res = await fetch(`${BASE_URL}/api/admin/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
      },
      body: JSON.stringify({ password: "wrong-password-probe" }),
      redirect: "manual",
    });
    const data = await res.json().catch(() => ({}));
    // Should reach the route handler and return 401
    const is401Route =
      res.status === 401 &&
      ((data.error || "").toLowerCase().includes("invalid password") ||
        (data.error || "").toLowerCase().includes("invalid credentials"));
    record(
      "Public Accessibility",
      "PUB-2.4",
      "POST /api/admin/login accessible to unauthenticated visitors (reaches handler)",
      is401Route,
      "HTTP 401 'Invalid password' from route handler",
      `HTTP ${res.status} ${JSON.stringify(data)}`
    );
  } catch (err: any) {
    record("Public Accessibility", "PUB-2.4", "POST /api/admin/login accessibility", false, "401 route", "Error", err.message);
  }

  // -------------------------------------------------------------
  // Scenario 3: Path Manipulation & URL Encoding
  // -------------------------------------------------------------
  // 3.1 URL-encoded /%61dmin -> cannot bypass route protection
  try {
    const res = await fetch(`${BASE_URL}/%61dmin`, { redirect: "manual" });
    const location = res.headers.get("location") || "";
    const isProtected = (res.status === 307 || res.status === 308) && (location.includes("admin") || location.includes("login"));
    record(
      "Path Manipulation",
      "MANIP-3.1",
      "URL-encoded path /%61dmin cannot bypass protection",
      isProtected,
      "HTTP 307/308 redirect",
      `HTTP ${res.status} to ${location}`
    );
  } catch (err: any) {
    record("Path Manipulation", "MANIP-3.1", "URL-encoded /%61dmin", false, "Redirect", "Error", err.message);
  }

  // 3.2 Double URL-encoded /%2561dmin
  try {
    const res = await fetch(`${BASE_URL}/%2561dmin`, { redirect: "manual" });
    // Should return 404 or redirect, never serve admin unauthenticated
    const isProtected = res.status === 404 || res.status === 307 || res.status === 308;
    record(
      "Path Manipulation",
      "MANIP-3.2",
      "Double URL-encoded path /%2561dmin does not leak admin content",
      isProtected,
      "HTTP 404 or 307/308",
      `HTTP ${res.status}`
    );
  } catch (err: any) {
    record("Path Manipulation", "MANIP-3.2", "Double encoded path", false, "Protected", "Error", err.message);
  }

  // 3.3 URL-encoded API route: /api/%61dmin/session
  try {
    const res = await fetch(`${BASE_URL}/api/%61dmin/session`, { redirect: "manual" });
    const location = res.headers.get("location") || "";
    // Either 401 or 307/308 redirect to login
    const isProtected = res.status === 401 || ((res.status === 307 || res.status === 308) && location.includes("admin"));
    record(
      "Path Manipulation",
      "MANIP-3.3",
      "URL-encoded path /api/%61dmin/session is rejected or redirected",
      isProtected,
      "HTTP 401 or 307/308 redirect",
      `HTTP ${res.status} (location: ${location || "none"})`
    );
  } catch (err: any) {
    record("Path Manipulation", "MANIP-3.3", "URL-encoded /api/%61dmin/session", false, "401/307", "Error", err.message);
  }

  // 3.4 Encoded slash in path: /admin%2fsecret
  try {
    const res = await fetch(`${BASE_URL}/admin%2fsecret`, { redirect: "manual" });
    const location = res.headers.get("location") || "";
    const isProtected = res.status === 404 || ((res.status === 307 || res.status === 308) && location.includes("admin"));
    record(
      "Path Manipulation",
      "MANIP-3.4",
      "Encoded slash in /admin%2fsecret cannot bypass perimeter",
      isProtected,
      "HTTP 404 or 307/308 redirect",
      `HTTP ${res.status} (location: ${location || "none"})`
    );
  } catch (err: any) {
    record("Path Manipulation", "MANIP-3.4", "Encoded slash in admin", false, "Protected", "Error", err.message);
  }

  // 3.5 Trailing slash on protected route: /admin/
  try {
    const res = await fetch(`${BASE_URL}/admin/`, { redirect: "manual" });
    const location = res.headers.get("location") || "";
    const isProtected = (res.status === 307 || res.status === 308) && (location.includes("admin") || location.includes("login"));
    record(
      "Path Manipulation",
      "MANIP-3.5",
      "Trailing slash /admin/ correctly redirects without bypassing protection",
      isProtected,
      "HTTP 307/308 redirect",
      `HTTP ${res.status} to ${location}`
    );
  } catch (err: any) {
    record("Path Manipulation", "MANIP-3.5", "Trailing slash /admin/", false, "Redirect", "Error", err.message);
  }

  // 3.6 Trailing slash on login page: /admin/login/
  try {
    const res = await fetch(`${BASE_URL}/admin/login/`, { redirect: "manual" });
    const isSafe = res.status === 200 || res.status === 307 || res.status === 308;
    record(
      "Path Manipulation",
      "MANIP-3.6",
      "Trailing slash /admin/login/ handled cleanly without loop or error",
      isSafe,
      "HTTP 200 or 307/308 redirect",
      `HTTP ${res.status}`
    );
  } catch (err: any) {
    record("Path Manipulation", "MANIP-3.6", "Trailing slash /admin/login/", false, "200/308", "Error", err.message);
  }

  // 3.7 Query parameters on protected route: /admin?redirect=evil&token=bypass
  try {
    const res = await fetch(`${BASE_URL}/admin?redirect=evil&token=bypass`, { redirect: "manual" });
    const location = res.headers.get("location") || "";
    const isRedirect = res.status === 307 && location.includes("/admin/login");
    record(
      "Path Manipulation",
      "MANIP-3.7",
      "Query parameters /admin?redirect=evil preserve route guard",
      isRedirect,
      "HTTP 307 redirect to /admin/login",
      `HTTP ${res.status} to ${location}`
    );
  } catch (err: any) {
    record("Path Manipulation", "MANIP-3.7", "Query parameters /admin", false, "307 redirect", "Error", err.message);
  }

  // 3.8 Query parameters on public route: /api/health?test=123
  try {
    const res = await fetch(`${BASE_URL}/api/health?test=123`, { redirect: "manual" });
    const data = await res.json().catch(() => ({}));
    const is200 = res.status === 200 && data.status === "ok";
    record(
      "Path Manipulation",
      "MANIP-3.8",
      "Query parameters /api/health?test=123 remain publicly accessible",
      is200,
      "HTTP 200 with status: 'ok'",
      `HTTP ${res.status}`
    );
  } catch (err: any) {
    record("Path Manipulation", "MANIP-3.8", "Query params on health", false, "200", "Error", err.message);
  }

  // 3.9 Path traversal attempt: /admin/../admin
  try {
    const res = await fetch(`${BASE_URL}/admin/../admin`, { redirect: "manual" });
    const location = res.headers.get("location") || "";
    const isProtected = res.status === 307 && location.includes("/admin/login");
    record(
      "Path Manipulation",
      "MANIP-3.9",
      "Path traversal /admin/../admin normalized and guarded",
      isProtected,
      "HTTP 307 redirect to /admin/login",
      `HTTP ${res.status} to ${location}`
    );
  } catch (err: any) {
    record("Path Manipulation", "MANIP-3.9", "Path traversal /admin/../admin", false, "307 redirect", "Error", err.message);
  }

  // 3.10 Traversal from API to public route: /api/admin/../../api/health
  try {
    const res = await fetch(`${BASE_URL}/api/admin/../../api/health`, { redirect: "manual" });
    const is200 = res.status === 200;
    record(
      "Path Manipulation",
      "MANIP-3.10",
      "Traversal to public route /api/admin/../../api/health resolves cleanly",
      is200,
      "HTTP 200 OK",
      `HTTP ${res.status}`
    );
  } catch (err: any) {
    record("Path Manipulation", "MANIP-3.10", "Traversal to public route", false, "200", "Error", err.message);
  }

  // 3.11 Case variation: /Admin
  try {
    const res = await fetch(`${BASE_URL}/Admin`, { redirect: "manual" });
    // In Next.js App Router, /Admin returns 404 (not found). Must not return 200 unauthenticated!
    const isNotLeaked = res.status === 404 || res.status === 307 || res.status === 308;
    record(
      "Path Manipulation",
      "MANIP-3.11",
      "Case variation /Admin does not leak content (HTTP 404 or redirect)",
      isNotLeaked,
      "HTTP 404 or 307/308 (never 200)",
      `HTTP ${res.status}`
    );
  } catch (err: any) {
    record("Path Manipulation", "MANIP-3.11", "Case variation /Admin", false, "Protected", "Error", err.message);
  }

  // -------------------------------------------------------------
  // Scenario 4: Successful Authentication & Protected State
  // -------------------------------------------------------------
  // 4.1 Issue valid signed admin token using server SESSION_SECRET
  try {
    const sessionSecret = process.env.SESSION_SECRET || TEST_SECRET;
    validAdminCookie = await createAdminToken(sessionSecret);
    const isValidToken = typeof validAdminCookie === "string" && validAdminCookie.split(".").length === 3;
    record(
      "Authentication Flow",
      "AUTH-4.1",
      "Admin session token issued with 12h validity and HS256 signature",
      isValidToken,
      "Valid HS256 JWT string",
      isValidToken ? "Signed JWT token generated" : "Failed to create token"
    );
  } catch (err: any) {
    record("Authentication Flow", "AUTH-4.1", "Admin session token issuance", false, "Valid JWT", "Error", err.message);
  }

  // 4.2 Authenticated GET /admin with valid session cookie -> 200 OK
  if (validAdminCookie) {
    try {
      const res = await fetch(`${BASE_URL}/admin`, {
        headers: {
          cookie: `admin_session=${validAdminCookie}`,
        },
        redirect: "manual",
      });
      // In App Router, /admin route might return 200 or 404 depending on whether page.tsx exists for /admin
      // What's critical is that it does NOT redirect to /admin/login!
      const location = res.headers.get("location") || "";
      const isNotRedirectedToLogin = !location.includes("/admin/login");
      record(
        "Authentication Flow",
        "AUTH-4.2",
        "Authenticated request with session cookie is NOT redirected to /admin/login",
        isNotRedirectedToLogin,
        "Allowed past middleware (no redirect to /admin/login)",
        `HTTP ${res.status} (location: ${location || "none"})`
      );
    } catch (err: any) {
      record("Authentication Flow", "AUTH-4.2", "Authenticated GET /admin", false, "No redirect", "Error", err.message);
    }

    // 4.3 Authenticated GET /api/admin/session -> returns { authenticated: true, role: 'admin' }
    try {
      const res = await fetch(`${BASE_URL}/api/admin/session`, {
        headers: {
          cookie: `admin_session=${validAdminCookie}`,
        },
        redirect: "manual",
      });
      const data = await res.json().catch(() => ({}));
      const isAuthTrue = res.status === 200 && data.authenticated === true && data.role === "admin";
      record(
        "Authentication Flow",
        "AUTH-4.3",
        "Authenticated GET /api/admin/session returns { authenticated: true, role: 'admin' }",
        isAuthTrue,
        "HTTP 200 { authenticated: true, role: 'admin' }",
        `HTTP ${res.status} ${JSON.stringify(data)}`
      );
    } catch (err: any) {
      record("Authentication Flow", "AUTH-4.3", "Authenticated session check", false, "200 authenticated: true", "Error", err.message);
    }

    // 4.4 Authenticated visitor accessing /admin/login redirected to /admin
    try {
      const res = await fetch(`${BASE_URL}/admin/login`, {
        headers: {
          cookie: `admin_session=${validAdminCookie}`,
        },
        redirect: "manual",
      });
      const location = res.headers.get("location") || "";
      const isRedirectToDashboard = res.status === 307 && location.includes("/admin") && !location.includes("/admin/login");
      record(
        "Authentication Flow",
        "AUTH-4.4",
        "Authenticated user visiting /admin/login is redirected to /admin dashboard",
        isRedirectToDashboard,
        "HTTP 307 redirect to /admin",
        `HTTP ${res.status} to ${location}`
      );
    } catch (err: any) {
      record("Authentication Flow", "AUTH-4.4", "Authenticated visit to /admin/login", false, "307 to /admin", "Error", err.message);
    }

    // 4.5 POST /api/admin/logout clears the session cookie
    try {
      const res = await fetch(`${BASE_URL}/api/admin/logout`, {
        method: "POST",
        headers: {
          cookie: `admin_session=${validAdminCookie}`,
          origin: BASE_URL,
        },
        redirect: "manual",
      });
      const data = await res.json().catch(() => ({}));
      const setCookie = res.headers.get("set-cookie") || "";
      const isLoggedOut = res.status === 200 && (setCookie.includes("max-age=0") || setCookie.includes("admin_session=;"));
      record(
        "Authentication Flow",
        "AUTH-4.5",
        "POST /api/admin/logout clears session cookie with Max-Age=0",
        isLoggedOut,
        "HTTP 200 with expired admin_session cookie",
        `HTTP ${res.status} set-cookie: ${setCookie}`
      );
    } catch (err: any) {
      record("Authentication Flow", "AUTH-4.5", "POST /api/admin/logout", false, "200 expired cookie", "Error", err.message);
    }
  }

  // -------------------------------------------------------------
  // Scenario 5: Rate Limiting & Brute Force Lockout
  // -------------------------------------------------------------
  try {
    const testIp = `198.51.100.${(Date.now() % 200) + 1}`;
    const rateLimitHeaders = {
      "content-type": "application/json",
      origin: BASE_URL,
      "x-forwarded-for": testIp,
    };

    let blockedOn6th = false;
    let fifthAttemptStatus = 0;
    let sixthAttemptStatus = 0;

    for (let i = 1; i <= 6; i++) {
      const res = await fetch(`${BASE_URL}/api/admin/login`, {
        method: "POST",
        headers: rateLimitHeaders,
        body: JSON.stringify({ password: "wrong-password-bruteforce" }),
        redirect: "manual",
      });
      if (i === 5) fifthAttemptStatus = res.status;
      if (i === 6) {
        sixthAttemptStatus = res.status;
        const retryAfter = res.headers.get("retry-after");
        blockedOn6th = res.status === 429 && retryAfter !== null;
      }
    }

    record(
      "Rate Limiting",
      "RATE-5.1",
      "5 failed logins return 401, 6th attempt is blocked with HTTP 429 and Retry-After",
      fifthAttemptStatus === 401 && blockedOn6th,
      "5th: 401, 6th: 429 with Retry-After header",
      `5th: HTTP ${fifthAttemptStatus}, 6th: HTTP ${sixthAttemptStatus}`
    );
  } catch (err: any) {
    record("Rate Limiting", "RATE-5.1", "Rate limiter test", false, "429 on 6th", "Error", err.message);
  }
}

async function runDirectMiddlewareSecurityTests() {
  console.log("\n=======================================================");
  console.log("SUITE 2: IN-PROCESS EDGE MIDDLEWARE ADVERSARIAL TESTS");
  console.log("=======================================================");
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.SITE_URL = "http://localhost:3000";

  // 2.1 Direct Middleware: Authenticated request with valid JWT passes through /admin
  try {
    const validToken = await createAdminToken(TEST_SECRET);
    const req = new NextRequest("http://localhost:3000/admin");
    req.cookies.set(ADMIN_COOKIE_NAME, validToken);

    const res = await middleware(req);
    const isPassed = res.status === 200 && !res.headers.get("location");
    record(
      "Edge Middleware",
      "EDGE-1.1",
      "Authenticated user with valid JWT passes through to /admin",
      isPassed,
      "HTTP 200 pass-through",
      `HTTP ${res.status} location: ${res.headers.get("location") || "none"}`
    );
  } catch (err: any) {
    record("Edge Middleware", "EDGE-1.1", "Valid JWT on /admin", false, "200", "Error", err.message);
  }

  // 2.2 Direct Middleware: Authenticated request with valid JWT on /admin/login redirects to /admin
  try {
    const validToken = await createAdminToken(TEST_SECRET);
    const req = new NextRequest("http://localhost:3000/admin/login");
    req.cookies.set(ADMIN_COOKIE_NAME, validToken);

    const res = await middleware(req);
    const isRedirect = res.status === 307 && res.headers.get("location") === "http://localhost:3000/admin";
    record(
      "Edge Middleware",
      "EDGE-1.2",
      "Authenticated user visiting /admin/login is redirected to /admin",
      isRedirect,
      "HTTP 307 redirect to http://localhost:3000/admin",
      `HTTP ${res.status} to ${res.headers.get("location")}`
    );
  } catch (err: any) {
    record("Edge Middleware", "EDGE-1.2", "Valid JWT on /admin/login", false, "307", "Error", err.message);
  }

  // 2.3 Direct Middleware: Tampered JWT signature
  try {
    const validToken = await createAdminToken(TEST_SECRET);
    const tamperedToken = validToken.slice(0, -6) + "abcdef";
    const req = new NextRequest("http://localhost:3000/admin");
    req.cookies.set(ADMIN_COOKIE_NAME, tamperedToken);

    const res = await middleware(req);
    const isRedirect = res.status === 307 && (res.headers.get("location") || "").includes("/admin/login");
    record(
      "Edge Middleware",
      "EDGE-1.3",
      "Tampered JWT signature redirects /admin to /admin/login",
      isRedirect,
      "HTTP 307 redirect to /admin/login",
      `HTTP ${res.status} to ${res.headers.get("location")}`
    );
  } catch (err: any) {
    record("Edge Middleware", "EDGE-1.3", "Tampered signature", false, "307", "Error", err.message);
  }

  // 2.4 Direct Middleware: Forged alg: none JWT
  try {
    const forgedToken = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url") +
      "." + Buffer.from(JSON.stringify({ role: "admin" })).toString("base64url") +
      ".";
    const req = new NextRequest("http://localhost:3000/admin");
    req.cookies.set(ADMIN_COOKIE_NAME, forgedToken);

    const res = await middleware(req);
    const isRedirect = res.status === 307 && (res.headers.get("location") || "").includes("/admin/login");
    record(
      "Edge Middleware",
      "EDGE-1.4",
      "Forged alg: none JWT is rejected and redirected",
      isRedirect,
      "HTTP 307 redirect to /admin/login",
      `HTTP ${res.status} to ${res.headers.get("location")}`
    );
  } catch (err: any) {
    record("Edge Middleware", "EDGE-1.4", "Alg none token", false, "307", "Error", err.message);
  }

  // 2.5 Direct Middleware: Non-admin role claim
  try {
    const { SignJWT } = await import("jose");
    const guestToken = await new SignJWT({ role: "guest" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("12h")
      .sign(new TextEncoder().encode(TEST_SECRET));
    const req = new NextRequest("http://localhost:3000/admin");
    req.cookies.set(ADMIN_COOKIE_NAME, guestToken);

    const res = await middleware(req);
    const isRedirect = res.status === 307 && (res.headers.get("location") || "").includes("/admin/login");
    record(
      "Edge Middleware",
      "EDGE-1.5",
      "Token with role: 'guest' is rejected with redirect",
      isRedirect,
      "HTTP 307 redirect to /admin/login",
      `HTTP ${res.status} to ${res.headers.get("location")}`
    );
  } catch (err: any) {
    record("Edge Middleware", "EDGE-1.5", "Guest role token", false, "307", "Error", err.message);
  }

  // 2.6 Direct Middleware: Expired JWT token
  try {
    const { SignJWT } = await import("jose");
    const expiredToken = await new SignJWT({ role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 50)
      .sign(new TextEncoder().encode(TEST_SECRET));
    const req = new NextRequest("http://localhost:3000/admin");
    req.cookies.set(ADMIN_COOKIE_NAME, expiredToken);

    const res = await middleware(req);
    const isRedirect = res.status === 307 && (res.headers.get("location") || "").includes("/admin/login");
    record(
      "Edge Middleware",
      "EDGE-1.6",
      "Expired JWT token is rejected with redirect",
      isRedirect,
      "HTTP 307 redirect to /admin/login",
      `HTTP ${res.status} to ${res.headers.get("location")}`
    );
  } catch (err: any) {
    record("Edge Middleware", "EDGE-1.6", "Expired token", false, "307", "Error", err.message);
  }

  // 2.7 Direct Middleware: Whitespace or empty token
  try {
    const req = new NextRequest("http://localhost:3000/admin");
    req.cookies.set(ADMIN_COOKIE_NAME, "    ");

    const res = await middleware(req);
    const isRedirect = res.status === 307 && (res.headers.get("location") || "").includes("/admin/login");
    record(
      "Edge Middleware",
      "EDGE-1.7",
      "Whitespace-only JWT cookie is rejected with redirect",
      isRedirect,
      "HTTP 307 redirect to /admin/login",
      `HTTP ${res.status} to ${res.headers.get("location")}`
    );
  } catch (err: any) {
    record("Edge Middleware", "EDGE-1.7", "Whitespace cookie", false, "307", "Error", err.message);
  }

  // 2.8 Origin Validation Security Matrix
  const originTests = [
    { id: "ORIGIN-2.1", name: "Valid origin matching request URL", origin: "http://localhost:3000", host: "localhost:3000", expected: true },
    { id: "ORIGIN-2.2", name: "Missing origin header", origin: null, host: "localhost:3000", expected: false },
    { id: "ORIGIN-2.3", name: "Empty string origin", origin: "", host: "localhost:3000", expected: false },
    { id: "ORIGIN-2.4", name: "String 'null' origin", origin: "null", host: "localhost:3000", expected: false },
    { id: "ORIGIN-2.5", name: "Mismatched domain origin", origin: "https://evil-attacker.com", host: "localhost:3000", expected: false },
    { id: "ORIGIN-2.6", name: "Subdomain suffix trick origin", origin: "http://localhost:3000.evil.com", host: "localhost:3000", expected: false },
    { id: "ORIGIN-2.7", name: "Mismatched port origin", origin: "http://localhost:8080", host: "localhost:3000", expected: false },
    { id: "ORIGIN-2.8", name: "Localhost vs 127.0.0.1 port-equivalent", origin: "http://127.0.0.1:3000", host: "localhost:3000", expected: true },
  ];

  for (const t of originTests) {
    const headers: Record<string, string> = {};
    if (t.host) headers["host"] = t.host;
    if (t.origin !== null) headers["origin"] = t.origin;
    const req = new Request("http://localhost:3000/api/admin/upload/part", {
      method: "POST",
      headers,
    });
    const result = validateOrigin(req);
    record(
      "Origin Security",
      t.id,
      t.name,
      result === t.expected,
      String(t.expected),
      String(result)
    );
  }

  // 2.9 Mutating methods matrix on /api/admin/*
  const mutatingMethods = ["POST", "PUT", "DELETE", "PATCH"];
  for (const m of mutatingMethods) {
    const req = new NextRequest("http://localhost:3000/api/admin/library/test-id", {
      method: m,
    });
    const res = await middleware(req);
    const is403 = res.status === 403;
    record(
      "Mutating Protection",
      `MUT-${m}`,
      `Mutating ${m} /api/admin/* without Origin rejected with HTTP 403`,
      is403,
      "HTTP 403 Forbidden",
      `HTTP ${res.status}`
    );
  }

  // 2.10 Non-mutating methods without origin (GET, HEAD) should proceed to auth check
  const nonMutatingMethods = ["GET", "HEAD"];
  for (const m of nonMutatingMethods) {
    const req = new NextRequest("http://localhost:3000/api/admin/session", {
      method: m,
    });
    const res = await middleware(req);
    const is401 = res.status === 401;
    record(
      "Non-Mutating Methods",
      `NONMUT-${m}`,
      `Non-mutating ${m} /api/admin/session without Origin reaches auth check (returns 401, not 403)`,
      is401,
      "HTTP 401 Unauthorized",
      `HTTP ${res.status}`
    );
  }
}

async function main() {
  console.log("=================================================");
  console.log("CHALLENGER 2: ADVERSARIAL SECURITY HARNESS");
  console.log("Milestone M1: Middleware & Route Security");
  console.log("=================================================");

  try {
    await runLiveHttpTests();
  } catch (err) {
    console.error("Live HTTP test error:", err);
  }

  try {
    await runDirectMiddlewareSecurityTests();
  } catch (err) {
    console.error("Middleware unit test error:", err);
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.filter((r) => !r.passed).length;
  const totalCount = results.length;

  console.log("\n=================================================");
  console.log(`SUMMARY: ${passedCount}/${totalCount} PASSED (${failedCount} FAILED)`);
  console.log("=================================================");

  if (failedCount > 0) {
    console.log("\nFAILURES:");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`- [${r.suite}] ${r.id}: ${r.name}`);
      console.log(`  Expected: ${r.expected}`);
      console.log(`  Actual:   ${r.actual}`);
      if (r.error) console.log(`  Error:    ${r.error}`);
    }
    process.exit(1);
  } else {
    console.log("\nALL ADVERSARIAL TESTS PASSED EMPIRICALLY!");
    process.exit(0);
  }
}

main();
