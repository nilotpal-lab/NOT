import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminToken, ADMIN_COOKIE_NAME } from "@/lib/auth";
import { getChaptersWithFiles } from "@/lib/catalog";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  class: z.coerce.number().int().min(6).max(10).optional(),
  subject: z.enum(["History", "Geography", "Civics", "Economics", "SocialScience"]).optional(),
  kind: z.enum(["ncert_pdf", "ppt", "ppt_pdf", "teacher_notes"]).optional(),
  isPublished: z.preprocess((val) => {
    if (val === "true" || val === true) return true;
    if (val === "false" || val === false) return false;
    return undefined;
  }, z.boolean().optional()),
});

/**
 * GET /api/admin/library
 * Retrieves catalog chapters with nested files matching optional filters:
 * - class: 6, 7, 8, 9, 10
 * - subject: History, Geography, Civics, Economics, SocialScience
 * - kind: ncert_pdf, ppt, ppt_pdf, teacher_notes
 * - isPublished / published: true, false
 */
export async function GET(req: NextRequest) {
  // 1. Session Authentication (defense-in-depth)
  const secret = process.env.SESSION_SECRET;
  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;

  if (!token || !secret) {
    return NextResponse.json({ error: "Unauthorized: Admin session required" }, { status: 401 });
  }
  const isAuth = await verifyAdminToken(token, secret);
  if (!isAuth) {
    return NextResponse.json({ error: "Unauthorized: Invalid or expired admin token" }, { status: 401 });
  }

  // 2. Parse & Validate Query Parameters
  const { searchParams } = req.nextUrl;
  const rawClass = searchParams.get("class");
  const rawSubject = searchParams.get("subject");
  const rawKind = searchParams.get("kind");
  const rawIsPublished =
    searchParams.get("isPublished") ??
    searchParams.get("published") ??
    searchParams.get("publishedOnly");

  const queryParams: Record<string, unknown> = {};
  if (rawClass && rawClass !== "all") queryParams.class = rawClass;
  if (rawSubject && rawSubject !== "all") queryParams.subject = rawSubject;
  if (rawKind && rawKind !== "all") queryParams.kind = rawKind;
  if (rawIsPublished !== null && rawIsPublished !== undefined && rawIsPublished !== "all") {
    queryParams.isPublished = rawIsPublished;
  }

  const parsed = querySchema.safeParse(queryParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const {
    class: classFilter,
    subject: subjectFilter,
    kind: kindFilter,
    isPublished: isPublishedFilter,
  } = parsed.data;

  try {
    // 3. Query catalog from database service
    const chapters = await getChaptersWithFiles({
      class: classFilter,
      subject: subjectFilter,
      kind: kindFilter,
      isPublished: isPublishedFilter,
      publishedOnly: isPublishedFilter === true ? true : undefined,
    });

    // 4. Return JSON list of chapters with files
    return NextResponse.json({ chapters }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, queryParams }, "Failed to query catalog in GET /api/admin/library");
    return NextResponse.json(
      { error: "Failed to fetch catalog chapters", details: message },
      { status: 500 }
    );
  }
}
