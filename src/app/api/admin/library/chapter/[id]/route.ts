import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminToken, validateOrigin, ADMIN_COOKIE_NAME } from "@/lib/auth";
import { renameChapter } from "@/lib/catalog";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const renameChapterSchema = z.object({
  title: z
    .string({ required_error: "title is required" })
    .trim()
    .min(1, "title must be a non-empty string")
    .max(200, "title cannot exceed 200 characters"),
});

/**
 * PATCH /api/admin/library/chapter/[id]
 * Renames chapter title and triggers cascading filename recalculations.
 * Returns: { success: true, updatedChapter, chapter, updatedFilesCount }
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
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

  // 3. Await dynamic parameter (Next.js 16 breaking change)
  const { id: chapterId } = await context.params;
  if (!chapterId || typeof chapterId !== "string" || chapterId.trim().length === 0) {
    return NextResponse.json({ error: "Invalid chapter ID parameter" }, { status: 400 });
  }

  // 4. Parse request body
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  const parsed = renameChapterSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    // 5. Execute rename with cascade
    const result = await renameChapter(chapterId.trim(), parsed.data.title);
    return NextResponse.json(
      {
        success: true,
        updatedChapter: result.updatedChapter,
        chapter: result.updatedChapter,
        updatedFilesCount: result.updatedFilesCount,
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      return NextResponse.json({ error: `Chapter ${chapterId} not found` }, { status: 404 });
    }
    logger.error({ err, chapterId }, "Failed to rename chapter");
    return NextResponse.json(
      { error: "Failed to rename chapter", details: message },
      { status: 500 }
    );
  }
}
