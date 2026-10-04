import dotenv from "dotenv";
import path from "path";
import { TelegramClient } from "../src/lib/telegram";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("Error: TELEGRAM_BOT_TOKEN is not set in .env.local");
    console.error("Please add your bot token first before running this script.");
    process.exit(1);
  }

  const client = new TelegramClient(token);

  console.log("Checking for updates in your Telegram bot...");
  try {
    const updates = await client.getUpdates();
    if (!updates.ok || !updates.result || updates.result.length === 0) {
      console.log("\nNo messages or channel posts found yet.");
      console.log("------------------------------------------------------------------");
      console.log("Please do this:");
      console.log("1. Open your private Telegram channel.");
      console.log("2. Make sure your bot is added as an Administrator (with Post & Delete permissions).");
      console.log("3. Type and send any short message in the channel (e.g. 'hello').");
      console.log("4. Run 'npm run find-channel-id' again.");
      console.log("------------------------------------------------------------------\n");
      return;
    }

    const channelCandidates = new Set<string>();

    for (const update of updates.result) {
      if (update.channel_post?.chat?.id) {
        channelCandidates.add(
          `${update.channel_post.chat.id} (Title: "${update.channel_post.chat.title || "Untitled"}")`
        );
      }
      if (update.message?.chat?.type === "channel" && update.message.chat.id) {
        channelCandidates.add(
          `${update.message.chat.id} (Title: "${update.message.chat.title || "Untitled"}")`
        );
      }
    }

    if (channelCandidates.size === 0) {
      console.log("\nFound updates, but none were channel posts.");
      console.log("Please send a message directly in your channel, not a private direct message to the bot.");
      console.log("Then run 'npm run find-channel-id' again.");
      return;
    }

    console.log("\n=======================================================");
    console.log("Found Channel ID(s):");
    console.log("=======================================================");
    channelCandidates.forEach((cand) => {
      console.log(` -> ${cand}`);
    });
    console.log("\nCopy the number (including the minus sign, e.g. -100xxxxxxxxxx)");
    console.log("and add it to your .env.local file as:");
    console.log("TELEGRAM_CHANNEL_ID=<your-channel-id>\n");
    console.log("=======================================================\n");
  } catch (err) {
    console.error("Failed to fetch updates from Telegram:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
