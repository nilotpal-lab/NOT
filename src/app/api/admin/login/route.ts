import { NextRequest, NextResponse } from "next/server";
import {
  verifyPassword,
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
  createAdminToken,
  validateOrigin,
  getAdminCookieOptions,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Extracts client IP from request headers or defaults to localhost.
 */
function extractClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const clientIp = forwarded.split(",")[0]?.trim();
    if (clientIp) return clientIp;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  return "127.0.0.1";
}

export async function POST(req: NextRequest) {
  // 1. Origin header validation (CSRF defense-in-depth)
  if (!validateOrigin(req)) {
    return NextResponse.json(
      { error: "Forbidden: Invalid or missing Origin header" },
      { status: 403 }
    );
  }

  // 2. Extract Client IP and verify rate limit
  const ip = extractClientIp(req);
  const rateLimit = checkRateLimit(ip);

  if (!rateLimit.allowed) {
    const retryAfter = rateLimit.retryAfterSeconds ?? 900;
    return NextResponse.json(
      {
        error: "Too many failed attempts. Try again later.",
        retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
        },
      }
    );
  }

  // 3. Parse and validate JSON payload
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

  // 4. Verify server environment configuration
  const storedHash = process.env.ADMIN_PASSWORD_HASH;
  const sessionSecret = process.env.SESSION_SECRET;

  if (!storedHash || !sessionSecret) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  // 5. Verify password using scrypt timingSafeEqual
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

  // 6. Success: reset rate limit for IP, issue 12h signed JWT, and set cookie
  resetRateLimit(ip);
  const token = await createAdminToken(sessionSecret);

  const response = NextResponse.json(
    { ok: true, success: true, message: "Logged in successfully" },
    { status: 200 }
  );

  response.cookies.set(getAdminCookieOptions(token));

  return response;
}
