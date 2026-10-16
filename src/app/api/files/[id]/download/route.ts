import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/validate";
import { TelegramClient } from "@/lib/telegram";
import { createTelegramMultiPartStream } from "@/lib/streaming";
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

  const { data: file, error: fileErr } = await db
    .from("files")
    .select(`
      *,
      file_parts (*)
    `)
    .eq("id", fileId)
    .maybeSingle();

  if (fileErr) {
    logger.error({ fileErr, fileId }, "Error querying file for download");
    return NextResponse.json({ error: "Failed to query file" }, { status: 500 });
  }

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

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
  const mimeType = file.mime || "application/octet-stream";

  const env = getEnv();
  const tgClient = new TelegramClient(env.TELEGRAM_BOT_TOKEN);

  const stream = createTelegramMultiPartStream({
    parts: fileParts,
    tgClient,
    totalSizeBytes: totalSize,
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(totalSize),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.file_name)}"`,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
