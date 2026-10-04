import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminToken, validateOrigin, ADMIN_COOKIE_NAME } from "@/lib/auth";
import { bulkToggleTeacherNotes } from "@/lib/catalog";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const bulkToggleSchema = z.object({
  is_published: z.boolean().optional(),
  isPublished: z.boolean().optional(),
}).refine(
  (data) => typeof data.is_published === "boolean" || typeof data.isPublished === "boolean",
  { message: "Either 'is_published' or 'isPublished' must be a boolean" }
);

/**
 * POST /api/admin/library/bulk-toggle
 * Bulk toggles published status of all teacher notes files.
 * Returns: { success: true, count, updatedCount, is_published, isPublished }
 */
export async function POST(req: NextRequest) {
  // 1. CSRF Protection
  if (!validateOrigin(req)) {
    return NextResponse.json(
      { error: "Forbidden: Invalid or missing Origin header" },
      { status: 403 }
    );
  }

  // 2. Authentication
  const secret = process.env.SESSION_SECRET;
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!token || !secret) {
    return NextResponse.json({ error: "Unauthorized: Admin session required" }, { status: 401 });
  }
  const isAuth = await verifyAdminToken(token, secret);
  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized: Invalid or expired admin token" }, { status: 401 });
  }

  // 3. Parse request body
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  const parsed = bulkToggleSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const targetPublished =
    parsed.data.is_published !== undefined
      ? parsed.data.is_published
      : (parsed.data.isPublished as boolean);

  try {
    // 4. Execute bulk toggle
    const count = await bulkToggleTeacherNotes(targetPublished);
    return NextResponse.json(
      {
        success: true,
        count,
        updatedCount: count,
        is_published: targetPublished,
        isPublished: targetPublished,
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Failed to bulk toggle teacher notes");
    return NextResponse.json(
      { error: "Failed to bulk toggle teacher notes", details: message },
      { status: 500 }
    );
  }
}
