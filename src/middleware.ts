import { NextRequest, NextResponse } from "next/server";
import {
  verifyAdminToken,
  validateOrigin,
  ADMIN_COOKIE_NAME,
} from "@/lib/auth-jwt";

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};

const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

/**
 * Next.js Edge Middleware for Admin Authentication and Perimeter Security.
 * Enforces Origin validation on mutating requests, session authentication on protected admin routes,
 * and redirects unauthenticated visitors to /admin/login.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();
  const secret = process.env.SESSION_SECRET;

  // 1. Origin header check for mutating requests on /api/admin/*
  if (pathname.startsWith("/api/admin/") && MUTATING_METHODS.has(method)) {
    if (!validateOrigin(req)) {
      return NextResponse.json(
        { error: "Forbidden: Invalid or missing Origin header" },
        { status: 403 }
      );
    }
  }

  // 2. Exempt public login entry points
  // 2a. Admin Login UI page exemption (/admin/login)
  if (pathname === "/admin/login") {
    const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    const isAuthenticated = token && secret ? await verifyAdminToken(token, secret) : false;
    if (isAuthenticated) {
      const dashboardUrl = req.nextUrl.clone();
      dashboardUrl.pathname = "/admin";
      dashboardUrl.search = "";
      return NextResponse.redirect(dashboardUrl);
    }
    return NextResponse.next();
  }

  // 2b. Admin Login API endpoint exemption (/api/admin/login)
  if (pathname === "/api/admin/login") {
    return NextResponse.next();
  }

  // 3. Verify session token for all other admin routes
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const isAuthenticated = token && secret ? await verifyAdminToken(token, secret) : false;

  // 4. Reject unauthenticated requests
  if (!isAuthenticated) {
    // API admin routes return HTTP 401 Unauthorized JSON
    if (pathname.startsWith("/api/admin/")) {
      return NextResponse.json(
        { error: "Unauthorized: Admin authentication required" },
        { status: 401 }
      );
    }

    // Admin browser pages (/admin, /admin/*) redirect to /admin/login?from=... (HTTP 307)
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/admin/login";
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl, 307);
  }

  // 5. Authenticated requests pass through
  return NextResponse.next();
}
