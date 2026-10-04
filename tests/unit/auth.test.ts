import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
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
  getLogoutCookieOptions,
} from "@/lib/auth";
import { middleware } from "@/middleware";
import { POST as loginHandler } from "@/app/api/admin/login/route";
import { POST as logoutHandler } from "@/app/api/admin/logout/route";
import { GET as sessionHandler } from "@/app/api/admin/session/route";

const TEST_SECRET = "super-secret-session-key-at-least-32-chars-long";
const TEST_PASSWORD = "CorrectAdminPassword2026!";

describe("Milestone M1: Admin Authentication & Session Security", () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    _clearAllRateLimits();
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = await hashPassword(TEST_PASSWORD);
    process.env.SITE_URL = "http://localhost:3000";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _clearAllRateLimits();
  });

  // ==========================================================================
  // 1. Scrypt Password Hashing & Constant-Time Verification
  // ==========================================================================
  describe("Scrypt Password Hashing & Verification", () => {
    it("generates scrypt hash formatted as salt:hex (32 hex salt, 128 hex key)", async () => {
      const hash = await hashPassword("MySecureKey123");
      expect(hash).toContain(":");
      const [salt, keyHex] = hash.split(":");
      expect(salt.length).toBe(32); // 16 bytes hex
      expect(keyHex.length).toBe(128); // 64 bytes hex
    });

    it("generates distinct salts on repeated hashes of the same password", async () => {
      const hash1 = await hashPassword("SamePassword");
      const hash2 = await hashPassword("SamePassword");
      expect(hash1).not.toBe(hash2);
      expect(hash1.split(":")[0]).not.toBe(hash2.split(":")[0]);
    });

    it("verifies matching password against scrypt hash", async () => {
      const hash = await hashPassword("SuperSecretKey!");
      const isMatch = await verifyPassword("SuperSecretKey!", hash);
      expect(isMatch).toBe(true);
    });

    it("rejects incorrect password using constant-time evaluation", async () => {
      const hash = await hashPassword("SuperSecretKey!");
      const isMatch = await verifyPassword("IncorrectKey!", hash);
      expect(isMatch).toBe(false);
    });

    it("gracefully rejects malformed or empty hashes without throwing", async () => {
      expect(await verifyPassword("password", "")).toBe(false);
      expect(await verifyPassword("", "salt:key")).toBe(false);
      expect(await verifyPassword("password", "no-colon-in-string")).toBe(false);
      expect(await verifyPassword("password", ":")).toBe(false);
      expect(await verifyPassword("password", "salt:")).toBe(false);
      expect(await verifyPassword("password", ":key")).toBe(false);
      expect(await verifyPassword("password", "salt:tooshort")).toBe(false);
      expect(await verifyPassword("password", "salt:invalid-hex-chars-!@#$")).toBe(false);
    });
  });

  // ==========================================================================
  // 2. JWT Session Token Lifecycle
  // ==========================================================================
  describe("Stateless 12h JWT Session Token", () => {
    it("creates a signed HS256 JWT with admin role", async () => {
      const token = await createAdminToken(TEST_SECRET);
      expect(typeof token).toBe("string");
      expect(token.split(".").length).toBe(3); // header.payload.signature

      const isValid = await verifyAdminToken(token, TEST_SECRET);
      expect(isValid).toBe(true);
    });

    it("throws when creating token without a secret", async () => {
      await expect(createAdminToken("")).rejects.toThrow();
    });

    it("rejects token verified against an incorrect secret", async () => {
      const token = await createAdminToken(TEST_SECRET);
      const isValid = await verifyAdminToken(token, "completely-different-secret-key-32-chars");
      expect(isValid).toBe(false);
    });

    it("rejects tampered token signature", async () => {
      const token = await createAdminToken(TEST_SECRET);
      const tampered = token.slice(0, -6) + "xyz123";
      expect(await verifyAdminToken(tampered, TEST_SECRET)).toBe(false);
    });

    it("rejects token with missing or malformed input", async () => {
      expect(await verifyAdminToken("", TEST_SECRET)).toBe(false);
      expect(await verifyAdminToken("not.a.jwt", TEST_SECRET)).toBe(false);
      expect(await verifyAdminToken("random-string", TEST_SECRET)).toBe(false);
      expect(await verifyAdminToken("valid-token", "")).toBe(false);
    });

    it("rejects expired token", async () => {
      const secretKey = new TextEncoder().encode(TEST_SECRET);
      const expiredToken = await new SignJWT({ role: "admin" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(Math.floor(Date.now() / 1000) - 7200) // 2h ago
        .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // expired 1h ago
        .sign(secretKey);

      const isValid = await verifyAdminToken(expiredToken, TEST_SECRET);
      expect(isValid).toBe(false);
    });

    it("rejects token with non-admin role payload", async () => {
      const secretKey = new TextEncoder().encode(TEST_SECRET);
      const userToken = await new SignJWT({ role: "student" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("12h")
        .sign(secretKey);

      const isValid = await verifyAdminToken(userToken, TEST_SECRET);
      expect(isValid).toBe(false);
    });
  });

  // ==========================================================================
  // 3. Cookie Configuration Options
  // ==========================================================================
  describe("Cookie Configuration", () => {
    it("sets correct security flags for admin_session cookie", () => {
      expect(ADMIN_COOKIE_NAME).toBe("admin_session");
      expect(COOKIE_MAX_AGE_SECONDS).toBe(43200);

      const options = getAdminCookieOptions("sample-token");
      expect(options.name).toBe("admin_session");
      expect(options.value).toBe("sample-token");
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe("strict");
      expect(options.path).toBe("/");
      expect(options.maxAge).toBe(43200);
    });

    it("sets maxAge: 0 and expired date for logout cookie options", () => {
      const options = getLogoutCookieOptions();
      expect(options.name).toBe("admin_session");
      expect(options.value).toBe("");
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe("strict");
      expect(options.maxAge).toBe(0);
      expect(options.expires.getTime()).toBe(0);
    });
  });

  // ==========================================================================
  // 4. In-Memory IP Rate Limiting Engine
  // ==========================================================================
  describe("In-Memory IP Rate Limiting (5 Attempts / 15 Minutes)", () => {
    const testIp = "198.51.100.25";

    it("allows up to 5 consecutive failed attempts and decrements remainingAttempts", () => {
      expect(checkRateLimit(testIp).allowed).toBe(true);
      expect(checkRateLimit(testIp).remainingAttempts).toBe(5);

      recordFailedAttempt(testIp);
      expect(checkRateLimit(testIp).allowed).toBe(true);
      expect(checkRateLimit(testIp).remainingAttempts).toBe(4);

      recordFailedAttempt(testIp);
      expect(checkRateLimit(testIp).remainingAttempts).toBe(3);

      recordFailedAttempt(testIp);
      expect(checkRateLimit(testIp).remainingAttempts).toBe(2);

      recordFailedAttempt(testIp);
      expect(checkRateLimit(testIp).remainingAttempts).toBe(1);

      recordFailedAttempt(testIp); // 5th failure recorded
      // 6th attempt is blocked
      const status = checkRateLimit(testIp);
      expect(status.allowed).toBe(false);
      expect(status.remainingAttempts).toBe(0);
      expect(status.retryAfterSeconds).toBeGreaterThan(0);
      expect(status.retryAfterSeconds).toBeLessThanOrEqual(900);
    });

    it("blocks on the 6th attempt returning allowed: false and retryAfterSeconds", () => {
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt(testIp);
      }
      const status = checkRateLimit(testIp);
      expect(status.allowed).toBe(false);
      expect(status.remainingAttempts).toBe(0);
      expect(status.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("resets failed attempt counter upon successful login", () => {
      for (let i = 0; i < 4; i++) {
        recordFailedAttempt(testIp);
      }
      expect(checkRateLimit(testIp).remainingAttempts).toBe(1);

      resetRateLimit(testIp);
      const status = checkRateLimit(testIp);
      expect(status.allowed).toBe(true);
      expect(status.remainingAttempts).toBe(5);
    });

    it("isolates rate limiting between distinct IP addresses (IPv4 & IPv6)", () => {
      const ip1 = "10.0.0.1";
      const ip2 = "10.0.0.2";
      const ipV6 = "2001:db8::1";

      for (let i = 0; i < 5; i++) {
        recordFailedAttempt(ip1);
      }

      expect(checkRateLimit(ip1).allowed).toBe(false);
      expect(checkRateLimit(ip2).allowed).toBe(true);
      expect(checkRateLimit(ip2).remainingAttempts).toBe(5);
      expect(checkRateLimit(ipV6).allowed).toBe(true);
      expect(checkRateLimit(ipV6).remainingAttempts).toBe(5);
    });
  });

  // ==========================================================================
  // 5. Origin Header Validation
  // ==========================================================================
  describe("CSRF Origin Header Validation", () => {
    it("allows request when Origin matches Host header", () => {
      const req = new Request("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          origin: "http://localhost:3000",
        },
      });
      expect(validateOrigin(req)).toBe(true);
    });

    it("allows request when Origin matches SITE_URL environment variable", () => {
      process.env.SITE_URL = "https://sst-library.example.com";
      const req = new Request("https://sst-library.example.com/api/admin/login", {
        method: "POST",
        headers: {
          origin: "https://sst-library.example.com",
        },
      });
      expect(validateOrigin(req)).toBe(true);
    });

    it("allows localhost and 127.0.0.1 development equivalence with matching port", () => {
      const req = new Request("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          origin: "http://127.0.0.1:3000",
        },
      });
      expect(validateOrigin(req)).toBe(true);
    });

    it("rejects mutating request with missing Origin header", () => {
      const req = new Request("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
        headers: {
          host: "localhost:3000",
        },
      });
      expect(validateOrigin(req)).toBe(false);
    });

    it("rejects mutating request with empty or 'null' Origin header", () => {
      const emptyReq = new Request("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
        headers: {
          origin: "",
        },
      });
      expect(validateOrigin(emptyReq)).toBe(false);

      const nullReq = new Request("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
        headers: {
          origin: "null",
        },
      });
      expect(validateOrigin(nullReq)).toBe(false);
    });

    it("rejects mutating request with foreign or mismatched Origin header", () => {
      const req = new Request("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          origin: "https://malicious-attacker.com",
        },
      });
      expect(validateOrigin(req)).toBe(false);
    });

    it("rejects request when port mismatches", () => {
      const req = new Request("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          origin: "http://localhost:8080",
        },
      });
      expect(validateOrigin(req)).toBe(false);
    });
  });

  // ==========================================================================
  // 6. Next.js Edge Middleware Route Protection
  // ==========================================================================
  describe("Middleware Route Guard Contracts", () => {
    it("exempts unauthenticated GET /admin/login page", async () => {
      const req = new NextRequest("http://localhost:3000/admin/login");
      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });

    it("redirects authenticated visitor from /admin/login to /admin", async () => {
      const token = await createAdminToken(TEST_SECRET);
      const req = new NextRequest("http://localhost:3000/admin/login");
      req.cookies.set(ADMIN_COOKIE_NAME, token);

      const res = await middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/admin");
    });

    it("redirects unauthenticated GET /admin to /admin/login?from=/admin with HTTP 307", async () => {
      const req = new NextRequest("http://localhost:3000/admin");
      const res = await middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/admin/login?from=%2Fadmin");
    });

    it("redirects unauthenticated GET /admin/upload to /admin/login?from=/admin/upload with HTTP 307", async () => {
      const req = new NextRequest("http://localhost:3000/admin/upload");
      const res = await middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(
        "http://localhost:3000/admin/login?from=%2Fadmin%2Fupload"
      );
    });

    it("returns HTTP 401 JSON for unauthenticated GET /api/admin/library", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/library");
      const res = await middleware(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized: Admin authentication required");
    });

    it("rejects mutating request with missing Origin on /api/admin/* with HTTP 403", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
      });
      const res = await middleware(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe("Forbidden: Invalid or missing Origin header");
    });

    it("exempts /api/admin/login from session check when origin is valid", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          host: "localhost:3000",
        },
      });
      const res = await middleware(req);
      expect(res.status).toBe(200); // passes through to route handler
    });

    it("allows authenticated request with valid cookie to pass through to /admin", async () => {
      const token = await createAdminToken(TEST_SECRET);
      const req = new NextRequest("http://localhost:3000/admin");
      req.cookies.set(ADMIN_COOKIE_NAME, token);

      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });

    it("allows authenticated request with valid cookie to pass through to /api/admin/library", async () => {
      const token = await createAdminToken(TEST_SECRET);
      const req = new NextRequest("http://localhost:3000/api/admin/library");
      req.cookies.set(ADMIN_COOKIE_NAME, token);

      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it("rejects request with tampered session cookie on /admin by redirecting", async () => {
      const req = new NextRequest("http://localhost:3000/admin");
      req.cookies.set(ADMIN_COOKIE_NAME, "tampered.jwt.token");

      const res = await middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/admin/login");
    });

    it("rejects request with tampered session cookie on /api/admin/library with HTTP 401", async () => {
      const req = new NextRequest("http://localhost:3000/api/admin/library");
      req.cookies.set(ADMIN_COOKIE_NAME, "tampered.jwt.token");

      const res = await middleware(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Unauthorized: Admin authentication required");
    });
  });

  // ==========================================================================
  // 7. Route Handlers: Login, Logout, Session
  // ==========================================================================
  describe("Admin API Route Handlers", () => {
    describe("POST /api/admin/login", () => {
      it("rejects request missing Origin with HTTP 403", async () => {
        const req = new NextRequest("http://localhost:3000/api/admin/login", {
          method: "POST",
          body: JSON.stringify({ password: TEST_PASSWORD }),
        });
        const res = await loginHandler(req);
        expect(res.status).toBe(403);
      });

      it("rejects missing or empty password with HTTP 400", async () => {
        const req = new NextRequest("http://localhost:3000/api/admin/login", {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "content-type": "application/json",
          },
          body: JSON.stringify({ password: "" }),
        });
        const res = await loginHandler(req);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBe("Password is required");
      });

      it("rejects invalid password with HTTP 401 and records failed attempt", async () => {
        const req = new NextRequest("http://localhost:3000/api/admin/login", {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "x-forwarded-for": "203.0.113.88",
            "content-type": "application/json",
          },
          body: JSON.stringify({ password: "WrongPassword123" }),
        });
        const res = await loginHandler(req);
        expect(res.status).toBe(401);
        const data = await res.json();
        expect(data.error).toBe("Invalid password");
        expect(data.remainingAttempts).toBe(4);
      });

      it("enforces HTTP 429 when IP exceeds 5 failed attempts", async () => {
        const ip = "203.0.113.99";

        // Perform 5 failed attempts
        for (let i = 0; i < 5; i++) {
          const req = new NextRequest("http://localhost:3000/api/admin/login", {
            method: "POST",
            headers: {
              origin: "http://localhost:3000",
              "x-forwarded-for": ip,
              "content-type": "application/json",
            },
            body: JSON.stringify({ password: "WrongPassword" }),
          });
          const res = await loginHandler(req);
          if (i < 4) {
            expect(res.status).toBe(401);
          }
        }

        // 6th attempt must trigger HTTP 429
        const lockedReq = new NextRequest("http://localhost:3000/api/admin/login", {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "x-forwarded-for": ip,
            "content-type": "application/json",
          },
          body: JSON.stringify({ password: TEST_PASSWORD }),
        });
        const lockedRes = await loginHandler(lockedReq);
        expect(lockedRes.status).toBe(429);
        expect(lockedRes.headers.get("Retry-After")).toBeDefined();
        const data = await lockedRes.json();
        expect(data.error).toContain("Too many failed attempts");
      });

      it("authenticates valid password, resets rate limit, and issues session cookie", async () => {
        const ip = "203.0.113.50";

        // Record a failure first
        recordFailedAttempt(ip);
        expect(checkRateLimit(ip).remainingAttempts).toBe(4);

        const req = new NextRequest("http://localhost:3000/api/admin/login", {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "x-forwarded-for": ip,
            "content-type": "application/json",
          },
          body: JSON.stringify({ password: TEST_PASSWORD }),
        });

        const res = await loginHandler(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);

        // Rate limit should be reset
        expect(checkRateLimit(ip).remainingAttempts).toBe(5);

        // Cookie should be set
        const cookie = res.cookies.get(ADMIN_COOKIE_NAME);
        expect(cookie).toBeDefined();
        expect(cookie?.value).toBeDefined();
        expect(await verifyAdminToken(cookie!.value, TEST_SECRET)).toBe(true);
      });
    });

    describe("POST /api/admin/logout", () => {
      it("clears session cookie on logout", async () => {
        const req = new NextRequest("http://localhost:3000/api/admin/logout", {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
          },
        });
        const res = await logoutHandler(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ok).toBe(true);

        const cookie = res.cookies.get(ADMIN_COOKIE_NAME);
        expect(cookie?.value).toBe("");
        expect(cookie?.maxAge).toBe(0);
      });
    });

    describe("GET /api/admin/session", () => {
      it("returns authenticated: false when session cookie is absent", async () => {
        const req = new NextRequest("http://localhost:3000/api/admin/session");
        const res = await sessionHandler(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.authenticated).toBe(false);
      });

      it("returns authenticated: false when session cookie is invalid", async () => {
        const req = new NextRequest("http://localhost:3000/api/admin/session");
        req.cookies.set(ADMIN_COOKIE_NAME, "tampered-token");
        const res = await sessionHandler(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.authenticated).toBe(false);
      });

      it("returns authenticated: true and role: admin when valid session cookie is present", async () => {
        const token = await createAdminToken(TEST_SECRET);
        const req = new NextRequest("http://localhost:3000/api/admin/session");
        req.cookies.set(ADMIN_COOKIE_NAME, token);

        const res = await sessionHandler(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.authenticated).toBe(true);
        expect(data.role).toBe("admin");
      });
    });
  });
});
