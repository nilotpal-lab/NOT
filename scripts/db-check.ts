import dotenv from "dotenv";
import path from "path";
import { getDb, checkDatabaseSchema } from "../src/lib/db";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    console.error("Error: SUPABASE_URL or SUPABASE_SERVICE_KEY is missing in .env.local");
    process.exit(1);
  }

  console.log("Checking Supabase connection and schema...");

  try {
    const db = getDb(url, key);
    const status = await checkDatabaseSchema(db);

    console.log("\nTable Check Results:");
    console.log("-------------------------------------------------------");
    for (const item of status.tables) {
      const existsBadge = item.exists ? "EXISTS (PASS)" : "MISSING (FAIL)";
      const rlsBadge = item.rlsEnabled ? "RLS ON (PASS)" : "RLS OFF (FAIL)";
      console.log(`- ${item.table.padEnd(15)} : ${existsBadge} | ${rlsBadge}`);
    }
    console.log("-------------------------------------------------------");

    if (status.ok) {
      console.log("\n[PASS] All 3 tables exist and Row Level Security (RLS) is active.\n");
      process.exit(0);
    } else {
      console.error("\n[FAIL] Schema check did not pass.");
      if (status.error) {
        console.error(`Detail: ${status.error}`);
      }
      console.log("Please make sure you pasted supabase/schema.sql into the Supabase SQL Editor and ran it.");
      process.exit(1);
    }
  } catch (err) {
    console.error("Database connection failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
