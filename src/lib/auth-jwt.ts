import { SignJWT, jwtVerify } from "jose";

export const ADMIN_COOKIE_NAME = "admin_session";
export const COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours = 43,200 seconds

export interface AdminCookieOptions {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "strict";
  path: string;
  maxAge: number;
}

/**
 * Returns standard cookie configuration options for admin_session.
 */
export function getAdminCookieOptions(token: string): AdminCookieOptions {
  return {
    name: ADMIN_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || process.env.INSECURE_COOKIE !== "true",
    sameSite: "strict",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

/**
 * Returns options for clearing the admin_session cookie upon logout.
 */
export function getLogoutCookieOptions(): AdminCookieOptions & { expires: Date } {
  return {
    name: ADMIN_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || process.env.INSECURE_COOKIE !== "true",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  };
}

/**
 * Signs a 12-hour HS256 JWT containing { role: "admin" } using the provided secret.
 */
export async function createAdminToken(secretString: string): Promise<string> {
  if (!secretString) {
    throw new Error("Cannot create admin token without a secret string.");
  }
  const secretKey = new TextEncoder().encode(secretString);
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secretKey);
}

/**
 * Verifies that a JWT is valid, signed with HS256 using the secret, not expired,
 * and carries the { role: "admin" } claim.
 */
export async function verifyAdminToken(token: string, secretString: string): Promise<boolean> {
  if (!token || !secretString) {
    return false;
  }
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
 * Validates Origin header for mutating requests against host, request URL, or configured SITE_URL.
 * Returns false if origin is missing, empty, 'null', or mismatches.
 */
export function validateOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin || origin === "null" || origin.trim() === "") {
    return false;
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  // 1. Check against incoming Request URL if valid
  try {
    if (req.url) {
      const requestUrl = new URL(req.url);
      if (originUrl.origin === requestUrl.origin) {
        return true;
      }
    }
  } catch {
    // Ignore invalid request URL parsing
  }

  // 2. Check against Host / X-Forwarded-Host header
  const hostHeader = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (hostHeader) {
    const primaryHost = hostHeader.split(",")[0]?.trim();
    if (primaryHost) {
      if (originUrl.host === primaryHost) {
        return true;
      }

      // Check port-matched localhost / 127.0.0.1 development equivalence
      const [hostHostname, hostPort] = primaryHost.split(":");
      const isLocal = (h: string) => h === "localhost" || h === "127.0.0.1";
      const originPort = originUrl.port || (originUrl.protocol === "https:" ? "443" : "80");
      const effectiveHostPort =
        hostPort || (req.headers.get("x-forwarded-proto") === "https" ? "443" : "80");

      if (isLocal(hostHostname) && isLocal(originUrl.hostname) && effectiveHostPort === originPort) {
        return true;
      }
    }
  }

  // 3. Check against configured SITE_URL (from environment)
  const siteUrlEnv = process.env.SITE_URL;
  if (siteUrlEnv) {
    try {
      const siteUrl = new URL(siteUrlEnv);
      if (originUrl.origin === siteUrl.origin) {
        return true;
      }
    } catch {
      // Ignore invalid SITE_URL format
    }
  }

  return false;
}
