import assert from "node:assert/strict";
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
} from "../../../src/lib/auth";
import { POST as loginHandler } from "../../../src/app/api/admin/login/route";
import { GET as sessionHandler } from "../../../src/app/api/admin/session/route";
import { middleware } from "../../../src/middleware";

const TEST_SECRET = "super-secret-session-key-at-least-32-chars-long";
const ATTACKER_SECRET = "attacker-controlled-secret-key-32-chars-long";
const CORRECT_PASSWORD = "CorrectAdminPassword2026!";

interface TestResult {
  suite: string;
  testName: string;
  status: "PASS" | "FAIL";
  durationMs: number;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

async function runTest(suite: string, testName: string, fn: () => Promise<void> | void) {
  const start = performance.now();
  try {
    await fn();
    const durationMs = Math.round(performance.now() - start);
    results.push({ suite, testName, status: "PASS", durationMs });
    console.log(`  ✓ [PASS] ${testName} (${durationMs}ms)`);
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - start);
    const errorMsg = err instanceof Error ? err.stack || err.message : String(err);
    results.push({ suite, testName, status: "FAIL", durationMs, error: errorMsg });
    console.error(`  ✗ [FAIL] ${testName} (${durationMs}ms)`);
    console.error(`    Error: ${errorMsg}`);
  }
}

async function main() {
  console.log("===============================================================================");
  console.log("   CHALLENGER 1: ADVERSARIAL AUTHENTICATION STRESS TEST HARNESS");
  console.log("===============================================================================\n");

  const originalEnv = { ...process.env };

  const setupEnv = async () => {
    _clearAllRateLimits();
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = await hashPassword(CORRECT_PASSWORD);
    process.env.SITE_URL = "http://localhost:3000";
  };

  const cleanupEnv = () => {
    process.env = { ...originalEnv };
    _clearAllRateLimits();
  };

  // ==========================================================================
  // SCENARIO 1: BRUTE-FORCE RATE LIMITER & IP ISOLATION
  // ==========================================================================
  console.log("--- Scenario 1: Brute-Force Rate Limiter & IP Isolation ---");
  await setupEnv();

  const VICTIM_IP = "203.0.113.10";
  const INNOCENT_IP = "203.0.113.20";
  const IPV6_CLIENT = "2001:0db8:85a3:0000:0000:8a2e:0370:7334";

  await runTest(
    "Scenario 1",
    "1.1: Fire 10 rapid failed logins from Victim IP (attempts 1-5 -> 401, attempts 6-10 -> 429)",
    async () => {
      // 10 rapid attempts
      for (let attempt = 1; attempt <= 10; attempt++) {
        const req = new NextRequest("http://localhost:3000/api/admin/login", {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            host: "localhost:3000",
            "x-forwarded-for": VICTIM_IP,
            "content-type": "application/json",
          },
          body: JSON.stringify({ password: `adversarial-guess-${attempt}` }),
        });

        const res = await loginHandler(req);

        if (attempt <= 5) {
          assert.equal(
            res.status,
            401,
            `Attempt ${attempt} expected HTTP 401, got ${res.status}`
          );
          const data = await res.json();
          assert.equal(data.error, "Invalid password");
          assert.equal(
            data.remainingAttempts,
            5 - attempt,
            `Attempt ${attempt} expected remainingAttempts ${5 - attempt}, got ${data.remainingAttempts}`
          );
        } else {
          assert.equal(
            res.status,
            429,
            `Attempt ${attempt} expected HTTP 429 (Too Many Requests), got ${res.status}`
          );
          const retryAfter = res.headers.get("Retry-After");
          assert.ok(retryAfter, `Attempt ${attempt} must include Retry-After header`);
          const retrySec = Number(retryAfter);
          assert.ok(
            retrySec > 0 && retrySec <= 900,
            `Retry-After header ${retrySec} outside bounds [1, 900]`
          );

          const data = await res.json();
          assert.ok(
            data.error.includes("Too many failed attempts"),
            `Expected lockout message, got: ${data.error}`
          );
          assert.equal(data.retryAfter, retrySec);
        }
      }
    }
  );

  await runTest(
    "Scenario 1",
    "1.2: IP Isolation: innocent second IP is NOT blocked while victim IP is locked out",
    async () => {
      // Victim IP is still locked out
      const victimCheck = checkRateLimit(VICTIM_IP);
      assert.equal(victimCheck.allowed, false, "Victim IP should still be locked out");
      assert.equal(victimCheck.remainingAttempts, 0);

      // Innocent IP should have full 5 attempts
      const innocentCheck = checkRateLimit(INNOCENT_IP);
      assert.equal(innocentCheck.allowed, true, "Innocent IP should be allowed");
      assert.equal(innocentCheck.remainingAttempts, 5);

      // Fire correct login from innocent IP -> HTTP 200 OK
      const innocentReq = new NextRequest("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          host: "localhost:3000",
          "x-forwarded-for": INNOCENT_IP,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: CORRECT_PASSWORD }),
      });
      const innocentRes = await loginHandler(innocentReq);
      assert.equal(innocentRes.status, 200, "Innocent IP with valid credentials must receive 200");
      const body = await innocentRes.json();
      assert.equal(body.ok, true);
      assert.ok(innocentRes.cookies.get(ADMIN_COOKIE_NAME));

      // Victim IP remains locked out even if presenting correct password
      const victimReq = new NextRequest("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          host: "localhost:3000",
          "x-forwarded-for": VICTIM_IP,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: CORRECT_PASSWORD }),
      });
      const victimRes = await loginHandler(victimReq);
      assert.equal(victimRes.status, 429, "Locked out IP must receive 429 even with correct password");
    }
  );

  await runTest(
    "Scenario 1",
    "1.3: IPv6 Client isolation",
    async () => {
      const ipv6Check = checkRateLimit(IPV6_CLIENT);
      assert.equal(ipv6Check.allowed, true);
      assert.equal(ipv6Check.remainingAttempts, 5);

      const req = new NextRequest("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          host: "localhost:3000",
          "x-forwarded-for": IPV6_CLIENT,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: "wrong-password" }),
      });
      const res = await loginHandler(req);
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.remainingAttempts, 4);
    }
  );

  await runTest(
    "Scenario 1",
    "1.4: Successful login resets failed attempt counter for that IP",
    async () => {
      const TEST_RESET_IP = "192.0.2.77";
      // Record 3 failed attempts
      for (let i = 0; i < 3; i++) {
        const req = new NextRequest("http://localhost:3000/api/admin/login", {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            host: "localhost:3000",
            "x-forwarded-for": TEST_RESET_IP,
            "content-type": "application/json",
          },
          body: JSON.stringify({ password: "bad-password" }),
        });
        await loginHandler(req);
      }
      assert.equal(checkRateLimit(TEST_RESET_IP).remainingAttempts, 2);

      // Now successful login
      const validReq = new NextRequest("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          host: "localhost:3000",
          "x-forwarded-for": TEST_RESET_IP,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: CORRECT_PASSWORD }),
      });
      const validRes = await loginHandler(validReq);
      assert.equal(validRes.status, 200);

      // Counter should now be reset to 5
      assert.equal(checkRateLimit(TEST_RESET_IP).remainingAttempts, 5);
      assert.equal(checkRateLimit(TEST_RESET_IP).allowed, true);
    }
  );

  await runTest(
    "Scenario 1",
    "1.5: High concurrency rate limiting stress (50 distinct IPs)",
    async () => {
      const promises = Array.from({ length: 50 }, async (_, idx) => {
        const ip = `10.200.${Math.floor(idx / 250)}.${idx % 250}`;
        recordFailedAttempt(ip);
        const status = checkRateLimit(ip);
        assert.equal(status.allowed, true);
        assert.equal(status.remainingAttempts, 4);
      });
      await Promise.all(promises);
    }
  );

  await runTest(
    "Scenario 1",
    "1.6: Multi-IP X-Forwarded-For chain extraction and isolation",
    async () => {
      const CHAIN_IP = "198.51.100.99";
      // 5 failed attempts with IP chain: "198.51.100.99, 10.0.0.1, 127.0.0.1"
      for (let i = 1; i <= 5; i++) {
        const req = new NextRequest("http://localhost:3000/api/admin/login", {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            host: "localhost:3000",
            "x-forwarded-for": `${CHAIN_IP}, 10.0.0.1, 127.0.0.1`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ password: "wrong" }),
        });
        const res = await loginHandler(req);
        assert.equal(res.status, 401);
      }

      // 6th attempt must be 429
      const lockReq = new NextRequest("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          host: "localhost:3000",
          "x-forwarded-for": `${CHAIN_IP}, 10.0.0.1, 127.0.0.1`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: CORRECT_PASSWORD }),
      });
      const lockRes = await loginHandler(lockReq);
      assert.equal(lockRes.status, 429);
      assert.ok(lockRes.headers.get("Retry-After"));

      // Different client in same proxy network (198.51.100.100) must NOT be blocked
      const otherReq = new NextRequest("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          host: "localhost:3000",
          "x-forwarded-for": `198.51.100.100, 10.0.0.1, 127.0.0.1`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password: CORRECT_PASSWORD }),
      });
      const otherRes = await loginHandler(otherReq);
      assert.equal(otherRes.status, 200);
    }
  );

  cleanupEnv();

  // ==========================================================================
  // SCENARIO 2: JWT FORGERY & CRYPTOGRAPHIC INTEGRITY
  // ==========================================================================
  console.log("\n--- Scenario 2: JWT Forgery & Cryptographic Integrity ---");
  await setupEnv();

  await runTest(
    "Scenario 2",
    "2.1: Reject forged signature created with attacker secret key",
    async () => {
      const forgedToken = await createAdminToken(ATTACKER_SECRET);
      assert.equal(
        await verifyAdminToken(forgedToken, TEST_SECRET),
        false,
        "Forged token with attacker secret must be rejected"
      );

      // Test against GET /api/admin/session
      const req = new NextRequest("http://localhost:3000/api/admin/session");
      req.cookies.set(ADMIN_COOKIE_NAME, forgedToken);
      const res = await sessionHandler(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.authenticated, false, "Session handler must report unauthenticated");
    }
  );

  await runTest(
    "Scenario 2",
    "2.2: Reject altered payload in originally valid token",
    async () => {
      const validToken = await createAdminToken(TEST_SECRET);
      const [headerB64, payloadB64, signatureB64] = validToken.split(".");

      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
      assert.equal(payload.role, "admin");

      // Tamper: escalate privileges
      payload.superuser = true;
      payload.role = "superadmin";
      const tamperedPayloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
      const tamperedToken = `${headerB64}.${tamperedPayloadB64}.${signatureB64}`;

      assert.equal(
        await verifyAdminToken(tamperedToken, TEST_SECRET),
        false,
        "Tampered payload must fail cryptographic signature verification"
      );

      // Verify Middleware blocks tampered session
      const mwReq = new NextRequest("http://localhost:3000/admin");
      mwReq.cookies.set(ADMIN_COOKIE_NAME, tamperedToken);
      const mwRes = await middleware(mwReq);
      assert.equal(mwRes.status, 307, "Middleware must redirect tampered session to /admin/login");
      assert.ok(mwRes.headers.get("location")?.includes("/admin/login"));
    }
  );

  await runTest(
    "Scenario 2",
    "2.3: Reject expired tokens (1s ago, 1h ago, 24h ago)",
    async () => {
      const secretKey = new TextEncoder().encode(TEST_SECRET);
      const nowEpoch = Math.floor(Date.now() / 1000);

      // Expired 1 second ago
      const expired1s = await new SignJWT({ role: "admin" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(nowEpoch - 3600)
        .setExpirationTime(nowEpoch - 1)
        .sign(secretKey);
      assert.equal(await verifyAdminToken(expired1s, TEST_SECRET), false, "Expired (1s) rejected");

      // Expired 1 hour ago
      const expired1h = await new SignJWT({ role: "admin" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(nowEpoch - 7200)
        .setExpirationTime(nowEpoch - 3600)
        .sign(secretKey);
      assert.equal(await verifyAdminToken(expired1h, TEST_SECRET), false, "Expired (1h) rejected");

      // Expired 24 hours ago
      const expired24h = await new SignJWT({ role: "admin" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(nowEpoch - 100000)
        .setExpirationTime(nowEpoch - 86400)
        .sign(secretKey);
      assert.equal(await verifyAdminToken(expired24h, TEST_SECRET), false, "Expired (24h) rejected");
    }
  );

  await runTest(
    "Scenario 2",
    "2.4: Reject 'none' algorithm unsigned token (alg: none exploit)",
    async () => {
      const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({ role: "admin" })).toString("base64url");
      const noneToken = `${header}.${payload}.`;

      assert.equal(
        await verifyAdminToken(noneToken, TEST_SECRET),
        false,
        "Algorithm 'none' must be rejected"
      );
    }
  );

  await runTest(
    "Scenario 2",
    "2.5: Reject non-admin role, missing role claim, or wrong casing",
    async () => {
      const secretKey = new TextEncoder().encode(TEST_SECRET);

      // Non-admin roles
      for (const role of ["student", "user", "guest", "operator", "moderator"]) {
        const token = await new SignJWT({ role })
          .setProtectedHeader({ alg: "HS256" })
          .setIssuedAt()
          .setExpirationTime("12h")
          .sign(secretKey);
        assert.equal(
          await verifyAdminToken(token, TEST_SECRET),
          false,
          `Role '${role}' must be rejected`
        );
      }

      // Missing role
      const noRoleToken = await new SignJWT({ sub: "user-123" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("12h")
        .sign(secretKey);
      assert.equal(await verifyAdminToken(noRoleToken, TEST_SECRET), false);

      // Case mismatch ("ADMIN", "Admin")
      const caseMismatch = await new SignJWT({ role: "ADMIN" })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("12h")
        .sign(secretKey);
      assert.equal(await verifyAdminToken(caseMismatch, TEST_SECRET), false);
    }
  );

  await runTest(
    "Scenario 2",
    "2.6: Reject truncated, bit-flipped, or stripped signatures",
    async () => {
      const validToken = await createAdminToken(TEST_SECRET);
      const [h, p, s] = validToken.split(".");

      // Truncated signature
      const truncated = `${h}.${p}.${s.slice(0, 12)}`;
      assert.equal(await verifyAdminToken(truncated, TEST_SECRET), false);

      // Corrupted signature
      const corrupted = `${h}.${p}.${s.slice(0, -2)}ZZ`;
      assert.equal(await verifyAdminToken(corrupted, TEST_SECRET), false);

      // Missing signature altogether
      const missingSig = `${h}.${p}`;
      assert.equal(await verifyAdminToken(missingSig, TEST_SECRET), false);

      // Arbitrary garbage string
      assert.equal(await verifyAdminToken("not-a-valid-token", TEST_SECRET), false);
      assert.equal(await verifyAdminToken("", TEST_SECRET), false);
      assert.equal(await verifyAdminToken("header.payload.sig.extra.dot", TEST_SECRET), false);
    }
  );

  await runTest(
    "Scenario 2",
    "2.7: Middleware denies access on forged or altered JWT",
    async () => {
      const forgedToken = await createAdminToken("attacker-bad-key-32-chars-long");
      const req = new NextRequest("http://localhost:3000/api/admin/library");
      req.cookies.set(ADMIN_COOKIE_NAME, forgedToken);

      const res = await middleware(req);
      assert.equal(res.status, 401, "Protected API route must return 401 on forged JWT");
      const data = await res.json();
      assert.equal(data.error, "Unauthorized: Admin authentication required");
    }
  );

  cleanupEnv();

  // ==========================================================================
  // SCENARIO 3: ORIGIN HEADER BYPASS & CSRF DEFENSE
  // ==========================================================================
  console.log("\n--- Scenario 3: Origin Header Bypass & CSRF Defense ---");
  await setupEnv();

  await runTest(
    "Scenario 3",
    "3.1: Reject null, missing, empty, or whitespace Origin headers",
    () => {
      const makeReq = (origin?: string) =>
        new Request("http://localhost:3000/api/admin/login", {
          method: "POST",
          headers: origin !== undefined ? { origin } : {},
        });

      assert.equal(validateOrigin(makeReq()), false, "Missing Origin must be rejected");
      assert.equal(validateOrigin(makeReq("null")), false, "'null' Origin must be rejected");
      assert.equal(validateOrigin(makeReq("")), false, "Empty Origin must be rejected");
      assert.equal(validateOrigin(makeReq("   ")), false, "Whitespace Origin must be rejected");
    }
  );

  await runTest(
    "Scenario 3",
    "3.2: Reject foreign domains, subdomain spoofs, port and protocol mismatches",
    () => {
      const makeReq = (origin: string, host = "localhost:3000") =>
        new Request(`http://${host}/api/admin/upload/part`, {
          method: "POST",
          headers: { origin, host },
        });

      // External attack domain
      assert.equal(validateOrigin(makeReq("https://evil-attacker.com")), false);

      // Subdomain spoof / prefix collision
      assert.equal(validateOrigin(makeReq("http://localhost:3000.evil.com")), false);

      // Domain prefix spoof
      assert.equal(validateOrigin(makeReq("http://attacker-localhost:3000")), false);

      // Port mismatch
      assert.equal(validateOrigin(makeReq("http://localhost:8080")), false);
      assert.equal(validateOrigin(makeReq("http://localhost:3001")), false);

      // Userinfo authority spoof attempt (e.g. http://localhost:3000@evil.com)
      assert.equal(validateOrigin(makeReq("http://localhost:3000@evil-attacker.com")), false);

      // Path / query appended to Origin header
      assert.equal(validateOrigin(makeReq("https://malicious.org:3000")), false);

      // Malformed / dangerous URI schemes
      assert.equal(validateOrigin(makeReq("javascript:alert(1)")), false);
      assert.equal(validateOrigin(makeReq("data:text/html,hack")), false);
      assert.equal(validateOrigin(makeReq("file:///etc/passwd")), false);
    }
  );

  await runTest(
    "Scenario 3",
    "3.3: Case variations in valid origins are handled robustly",
    () => {
      // Uppercase in origin host (e.g. HTTP://LOCALHOST:3000)
      const req = new Request("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          origin: "http://LOCALHOST:3000",
          host: "localhost:3000",
        },
      });
      assert.equal(validateOrigin(req), true, "Valid origin with uppercase host should normalize and match");
    }
  );

  await runTest(
    "Scenario 3",
    "3.4: Middleware blocks mutating admin requests with invalid Origin (HTTP 403)",
    async () => {
      // Missing origin
      const req1 = new NextRequest("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
      });
      const res1 = await middleware(req1);
      assert.equal(res1.status, 403, "Missing origin on mutating API route must return 403");
      const data1 = await res1.json();
      assert.equal(data1.error, "Forbidden: Invalid or missing Origin header");

      // Evil origin
      const req2 = new NextRequest("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
        headers: { origin: "https://evil-cross-origin.com" },
      });
      const res2 = await middleware(req2);
      assert.equal(res2.status, 403, "Evil origin on mutating API route must return 403");

      // Null origin
      const req3 = new NextRequest("http://localhost:3000/api/admin/upload/part", {
        method: "POST",
        headers: { origin: "null" },
      });
      const res3 = await middleware(req3);
      assert.equal(res3.status, 403, "Null origin on mutating API route must return 403");

      // Valid origin passes through to session check / route handler
      const reqValid = new NextRequest("http://localhost:3000/api/admin/login", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          host: "localhost:3000",
        },
      });
      const resValid = await middleware(reqValid);
      assert.equal(resValid.status, 200, "Valid origin passes through middleware");
    }
  );

  cleanupEnv();

  // ==========================================================================
  // SUMMARY AND VERDICT
  // ==========================================================================
  console.log("\n===============================================================================");
  console.log("                        ADVERSARIAL HARNESS SUMMARY");
  console.log("===============================================================================");

  const total = results.length;
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  console.log(`Total Scenarios Tested: ${total}`);
  console.log(`Passed:                ${passed}`);
  console.log(`Failed:                ${failed}`);

  if (failed > 0) {
    console.error(`\nOVERALL VERDICT: REQUEST_CHANGES (${failed} tests failed)`);
    process.exit(1);
  } else {
    console.log(`\nOVERALL VERDICT: APPROVE (100% of adversarial stress tests passed)`);
    process.exit(0);
  }
}

main().catch((e) => {
  console.error("Fatal test runner crash:", e);
  process.exit(1);
});
