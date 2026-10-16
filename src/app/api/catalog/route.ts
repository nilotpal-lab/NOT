import { NextRequest, NextResponse } from "next/server";
import { getChaptersWithFiles } from "@/lib/catalog";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const classParam = url.searchParams.get("class");
    const subjectParam = url.searchParams.get("subject");
    const queryParam = url.searchParams.get("q") || "";

    const filters: {
      class?: number;
      subject?: string;
      isPublished: boolean;
      hideEmptyChapters?: boolean;
    } = {
      isPublished: true,
      hideEmptyChapters: false,
    };

    if (classParam && classParam !== "all") {
      const classNum = parseInt(classParam, 10);
      if (!isNaN(classNum)) {
        filters.class = classNum;
      }
    }

    if (subjectParam && subjectParam !== "all") {
      filters.subject = subjectParam;
    }

    let chapters = await getChaptersWithFiles(filters);

    // Apply keyword search if present
    if (queryParam.trim()) {
      const q = queryParam.toLowerCase();
      chapters = chapters.filter((c) => {
        const titleMatch = c.title.toLowerCase().includes(q);
        const subjectMatch = c.subject.toLowerCase().includes(q);
        const fileMatch = (c.files || []).some((f) =>
          f.file_name.toLowerCase().includes(q)
        );
        return titleMatch || subjectMatch || fileMatch;
      });
    }

    return NextResponse.json({
      success: true,
      chapters,
      count: chapters.length,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch student catalog");
    return NextResponse.json(
      { error: "Failed to load chapter catalog" },
      { status: 500 }
    );
  }
}
