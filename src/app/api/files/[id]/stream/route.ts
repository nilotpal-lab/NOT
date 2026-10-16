import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/validate";
import { TelegramClient } from "@/lib/telegram";
import { parseRangeHeader, createTelegramMultiPartStream } from "@/lib/streaming";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: fileId } = await context.params;

  if (!fileId) {
    return NextResponse.json({ error: "File ID is required" }, { status: 400 });
  }

  const db = getDb();

  // 1. Fetch file record with ordered parts
  const { data: file, error: fileErr } = await db
    .from("files")
    .select(`
      *,
      file_parts (*)
    `)
    .eq("id", fileId)
    .maybeSingle();

  if (fileErr) {
    logger.error({ fileErr, fileId }, "Error querying file for streaming");
    return NextResponse.json({ error: "Failed to query file" }, { status: 500 });
  }

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  // Ensure file is published for public access
  if (!file.is_published) {
    return NextResponse.json({ error: "File is hidden or unpublished" }, { status: 403 });
  }

  const fileParts = (file.file_parts || []).sort(
    (a: { part_no: number }, b: { part_no: number }) => a.part_no - b.part_no
  );

  if (fileParts.length === 0) {
    return NextResponse.json({ error: "No chunk parts available for this file" }, { status: 404 });
  }

  const totalSize = Number(file.size_bytes);
  const mimeType = file.mime || (file.file_name.endsWith(".pptx") ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : "application/pdf");

  // 2. Parse HTTP Range header
  const rangeHeader = req.headers.get("range");
  const parsedRange = parseRangeHeader(rangeHeader, totalSize);

  if (parsedRange === "INVALID") {
    return new NextResponse(null, {
      status: 416,
      headers: {
        "Content-Range": `bytes */${totalSize}`,
      },
    });
  }

  const env = getEnv();
  const tgClient = new TelegramClient(env.TELEGRAM_BOT_TOKEN);

  const isRangeRequest = parsedRange !== null;
  const rangeBounds = isRangeRequest
    ? { start: parsedRange.start, end: parsedRange.end }
    : { start: 0, end: totalSize - 1 };

  const contentLength = isRangeRequest ? parsedRange.contentLength : totalSize;

  // 3. Create zero-disk ReadableStream
  const stream = createTelegramMultiPartStream({
    parts: fileParts,
    tgClient,
    range: rangeBounds,
    totalSizeBytes: totalSize,
  });

  // 4. Return streaming response (206 Partial Content or 200 OK)
  const headers: Record<string, string> = {
    "Content-Type": mimeType,
    "Content-Length": String(contentLength),
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    "Content-Disposition": `inline; filename="${encodeURIComponent(file.file_name)}"`,
  };

  if (isRangeRequest) {
    headers["Content-Range"] = `bytes ${rangeBounds.start}-${rangeBounds.end}/${totalSize}`;
    return new NextResponse(stream, {
      status: 206,
      statusText: "Partial Content",
      headers,
    });
  }

  return new NextResponse(stream, {
    status: 200,
    headers,
  });
}
