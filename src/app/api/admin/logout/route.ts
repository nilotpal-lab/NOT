import { NextRequest, NextResponse } from "next/server";
import { getLogoutCookieOptions, validateOrigin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Origin check defense in depth on mutating POST
  if (!validateOrigin(req)) {
    return NextResponse.json(
      { error: "Forbidden: Invalid or missing Origin header" },
      { status: 403 }
    );
  }

  const response = NextResponse.json(
    { ok: true, success: true, message: "Logged out successfully" },
    { status: 200 }
  );

  response.cookies.set(getLogoutCookieOptions());

  return response;
}
