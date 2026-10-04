import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken, ADMIN_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Checks admin session validity from cookie.
 * Returns HTTP 200 with { authenticated: true, role: "admin" } if valid,
 * or { authenticated: false } if missing or invalid.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const secret = process.env.SESSION_SECRET;

  if (!token || !secret) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }

  const isValid = await verifyAdminToken(token, secret);
  if (!isValid) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }

  return NextResponse.json(
    { authenticated: true, role: "admin" },
    { status: 200 }
  );
}
