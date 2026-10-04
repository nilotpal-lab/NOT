import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { TelegramClient } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function GET() {
  const health: {
    status: "ok" | "degraded" | "error";
    timestamp: string;
    database: { status: "ok" | "error"; error?: string };
    telegram: { status: "ok" | "error"; username?: string; error?: string };
  } = {
    status: "ok",
    timestamp: new Date().toISOString(),
    database: { status: "error" },
    telegram: { status: "error" },
  };

  // Test Database
  try {
    const db = getDb();
    const { error } = await db.from("chapters").select("id").limit(1);
    if (!error) {
      health.database.status = "ok";
    } else {
      health.database.error = error.message;
      health.status = "degraded";
    }
  } catch (err) {
    health.database.error = err instanceof Error ? err.message : "Database connection failed";
    health.status = "degraded";
  }

  // Test Telegram
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      const tg = new TelegramClient(token);
      const bot = await tg.getMe();
      health.telegram.status = "ok";
      health.telegram.username = bot.username;
    } else {
      health.telegram.error = "TELEGRAM_BOT_TOKEN not configured";
      health.status = "degraded";
    }
  } catch (err) {
    health.telegram.error = err instanceof Error ? err.message : "Telegram connection failed";
    health.status = "degraded";
  }

  if (health.database.status === "error" && health.telegram.status === "error") {
    health.status = "error";
  }

  return NextResponse.json(health, {
    status: health.status === "ok" ? 200 : 503,
  });
}
