import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminToken, validateOrigin, ADMIN_COOKIE_NAME } from "@/lib/auth";
import { toggleFilePublished, deleteFileWithTelegramCleanup } from "@/lib/catalog";
import { TelegramClient } from "@/lib/telegram";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const patchFileSchema = z.object({
  is_published: z.boolean().optional(),
  isPublished: z.boolean().optional(),
}).refine(
  (data) => typeof data.is_published === "boolean" || typeof data.isPublished === "boolean",
  { message: "Either 'is_published' or 'isPublished' must be a boolean" }
);

function getTelegramClient(): TelegramClient | undefined {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return undefined;
  try {
    return new TelegramClient(token);
  } catch {
    return undefined;
  }
}

/**
 * PATCH /api/admin/library/[id]
 * Toggles a file's visibility (is_published).
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
  const { id: fileId } = await context.params;
  if (!fileId || typeof fileId !== "string" || fileId.trim().length === 0) {
    return NextResponse.json({ error: "Invalid file ID parameter" }, { status: 400 });
  }

  // 4. Parse request body
  let bodyJson: unknown;
  try {
    bodyJson = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body" }, { status: 400 });
  }

  const parsed = patchFileSchema.safeParse(bodyJson);
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
    // 5. Update visibility
    const updatedFile = await toggleFilePublished(fileId.trim(), targetPublished);
    return NextResponse.json(
      { success: true, file: updatedFile, ...updatedFile },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      return NextResponse.json({ error: `File ${fileId} not found` }, { status: 404 });
    }
    logger.error({ err, fileId }, "Failed to toggle file visibility");
    return NextResponse.json(
      { error: "Failed to update file visibility", details: message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/library/[id]
 * Deletes a file record from DB and purges all Telegram chunk messages from channel.
 * Returns: { success: true, deletedFileId, deletedMessageIds }
 */
export async function DELETE(
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
  const { id: fileId } = await context.params;
  if (!fileId || typeof fileId !== "string" || fileId.trim().length === 0) {
    return NextResponse.json({ error: "Invalid file ID parameter" }, { status: 400 });
  }

  try {
    // 4. Execute deletion with Telegram purge
    const channelId = process.env.TELEGRAM_CHANNEL_ID;
    const tgClient = getTelegramClient();
    const result = await deleteFileWithTelegramCleanup(fileId.trim(), tgClient, channelId);

    return NextResponse.json(
      {
        success: true,
        deletedFileId: result.deletedFileId,
        deletedMessageIds: result.deletedMessageIds,
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not found")) {
      return NextResponse.json({ error: `File ${fileId} not found` }, { status: 404 });
    }
    logger.error({ err, fileId }, "Failed to delete file and Telegram messages");
    return NextResponse.json(
      { error: "Failed to delete file", details: message },
      { status: 500 }
    );
  }
}
