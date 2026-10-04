import dotenv from "dotenv";
import path from "path";
import { validateEnv } from "../src/lib/validate";
import { getDb, checkDatabaseSchema } from "../src/lib/db";
import { TelegramClient } from "../src/lib/telegram";
import { verifyGroqSetup } from "../src/lib/groq";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

interface PreflightCheck {
  id: string;
  name: string;
  status: "PASS" | "FAIL" | "UNVERIFIED";
  details?: string;
  actionRequired?: string;
}

async function main() {
  console.log("\n=======================================================");
  console.log("   SST Chapter Library: Preflight Verification Checks  ");
  console.log("=======================================================\n");

  const checks: PreflightCheck[] = [];

  // Check 1: Environment Variables Present and Valid
  const envValidation = validateEnv(process.env);
  if (envValidation.success && envValidation.data) {
    checks.push({
      id: "PRE-1",
      name: "Environment Variables Validation",
      status: "PASS",
      details: "All required environment variables are set and meet schema constraints.",
    });
  } else {
    const missingKeys = envValidation.errors || [];
    checks.push({
      id: "PRE-1",
      name: "Environment Variables Validation",
      status: "FAIL",
      details: missingKeys.join("; "),
      actionRequired: "Create or fill missing keys in .env.local following .env.example",
    });
  }

  // Check 2: Supabase Reachable, Tables Exist, RLS Enabled
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    checks.push({
      id: "PRE-2",
      name: "Supabase Tables & RLS Status",
      status: "UNVERIFIED",
      details: "Supabase credentials missing in .env.local",
      actionRequired: "Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.local",
    });
  } else {
    try {
      const db = getDb(supabaseUrl, supabaseKey);
      const dbStatus = await checkDatabaseSchema(db);
      if (dbStatus.ok) {
        checks.push({
          id: "PRE-2",
          name: "Supabase Tables & RLS Status",
          status: "PASS",
          details: "All 3 tables ('chapters', 'files', 'file_parts') exist and RLS is enabled.",
        });
      } else {
        checks.push({
          id: "PRE-2",
          name: "Supabase Tables & RLS Status",
          status: "FAIL",
          details: dbStatus.error || "One or more tables are missing or have RLS disabled.",
          actionRequired: "Paste supabase/schema.sql into Supabase SQL editor and execute.",
        });
      }
    } catch (err) {
      checks.push({
        id: "PRE-2",
        name: "Supabase Tables & RLS Status",
        status: "FAIL",
        details: err instanceof Error ? err.message : String(err),
        actionRequired: "Verify Supabase URL and service role key in .env.local",
      });
    }
  }

  // Check 3: Telegram getMe Works
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  let tgClient: TelegramClient | null = null;

  if (!tgToken) {
    checks.push({
      id: "PRE-3",
      name: "Telegram Bot Verification (getMe)",
      status: "UNVERIFIED",
      details: "TELEGRAM_BOT_TOKEN missing in .env.local",
      actionRequired: "Create a bot with @BotFather on Telegram and add token to .env.local",
    });
  } else {
    try {
      tgClient = new TelegramClient(tgToken);
      const bot = await tgClient.getMe();
      checks.push({
        id: "PRE-3",
        name: "Telegram Bot Verification (getMe)",
        status: "PASS",
        details: `Connected to bot @${bot.username} (ID: ${bot.id})`,
      });
    } catch (err) {
      checks.push({
        id: "PRE-3",
        name: "Telegram Bot Verification (getMe)",
        status: "FAIL",
        details: err instanceof Error ? err.message : String(err),
        actionRequired: "Verify TELEGRAM_BOT_TOKEN in .env.local",
      });
    }
  }

  // Check 4: Bot Can Post and Delete a Test Message in the Channel
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  if (!tgToken || !channelId) {
    checks.push({
      id: "PRE-4",
      name: "Telegram Channel Posting & Deletion Permissions",
      status: "UNVERIFIED",
      details: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID missing in .env.local",
      actionRequired: "Set TELEGRAM_CHANNEL_ID using 'npm run find-channel-id'",
    });
  } else if (tgClient) {
    try {
      const msgId = await tgClient.postTestMessage(channelId);
      const deleted = await tgClient.deleteMessage(channelId, msgId);
      if (deleted) {
        checks.push({
          id: "PRE-4",
          name: "Telegram Channel Posting & Deletion Permissions",
          status: "PASS",
          details: "Successfully posted and deleted test message in the private storage channel.",
        });
      } else {
        checks.push({
          id: "PRE-4",
          name: "Telegram Channel Posting & Deletion Permissions",
          status: "FAIL",
          details: "Message was posted, but could not be deleted.",
          actionRequired: "Ensure bot has Administrator 'Delete messages' permission in the channel.",
        });
      }
    } catch (err) {
      checks.push({
        id: "PRE-4",
        name: "Telegram Channel Posting & Deletion Permissions",
        status: "FAIL",
        details: err instanceof Error ? err.message : String(err),
        actionRequired: "Ensure bot is an Administrator in the channel with Post & Delete permissions.",
      });
    }
  }

  // Check 5: Groq Key Works and Both Model IDs Exist
  const groqApiKey = process.env.GROQ_API_KEY;
  const groqModel = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const groqFallback = process.env.GROQ_FALLBACK_MODEL || "llama-3.3-70b-versatile";

  if (!groqApiKey) {
    checks.push({
      id: "PRE-5",
      name: "Groq Key & Model Verification",
      status: "UNVERIFIED",
      details: "GROQ_API_KEY missing in .env.local",
      actionRequired: "Create a free API key at console.groq.com and set GROQ_API_KEY in .env.local",
    });
  } else {
    try {
      const groqStatus = await verifyGroqSetup(groqApiKey, groqModel, groqFallback);
      if (groqStatus.ok) {
        checks.push({
          id: "PRE-5",
          name: "Groq Key & Model Verification",
          status: "PASS",
          details: `Groq connected. Both primary ('${groqModel}') and fallback ('${groqFallback}') models verified.`,
        });
      } else {
        const issues: string[] = [];
        if (!groqStatus.modelFound) issues.push(`Primary model '${groqModel}' not found`);
        if (!groqStatus.fallbackModelFound) issues.push(`Fallback model '${groqFallback}' not found`);
        checks.push({
          id: "PRE-5",
          name: "Groq Key & Model Verification",
          status: "FAIL",
          details: groqStatus.error || issues.join("; "),
          actionRequired: "Check available models or update GROQ_MODEL / GROQ_FALLBACK_MODEL in .env.local",
        });
      }
    } catch (err) {
      checks.push({
        id: "PRE-5",
        name: "Groq Key & Model Verification",
        status: "FAIL",
        details: err instanceof Error ? err.message : String(err),
        actionRequired: "Verify GROQ_API_KEY in .env.local",
      });
    }
  }

  // Print Summary Table
  console.log("| ID    | Check                                    | Status     | Details");
  console.log("|-------|------------------------------------------|------------|-----------------------------------------");
  for (const c of checks) {
    const statusFormatted =
      c.status === "PASS"
        ? "[PASS]      "
        : c.status === "FAIL"
        ? "[FAIL]      "
        : "[UNVERIFIED]";
    console.log(`| ${c.id.padEnd(5)} | ${c.name.padEnd(40)} | ${statusFormatted} | ${c.details || ""}`);
  }
  console.log("\n=======================================================\n");

  const hasFails = checks.some((c) => c.status === "FAIL");
  const hasUnverified = checks.some((c) => c.status === "UNVERIFIED");

  if (hasFails) {
    console.error("One or more preflight checks failed. Review details above.");
    process.exit(1);
  }

  if (hasUnverified) {
    console.log("Preflight completed with UNVERIFIED checks (credentials pending).");
    process.exit(0);
  }

  console.log("All preflight checks PASSED successfully!");
  process.exit(0);
}

main();
