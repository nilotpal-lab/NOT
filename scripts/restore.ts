import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { getDb } from "../src/lib/db";
import { BackupPayload, computeBackupChecksum } from "./backup";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

export interface RestoreResult {
  ok: boolean;
  dryRun: boolean;
  restoredCounts: {
    chapters: number;
    files: number;
    file_parts: number;
  };
  checksumVerified: boolean;
  error?: string;
}

export async function runRestore(options?: {
  backupFilePath?: string;
  dryRun?: boolean;
  customPayload?: BackupPayload;
  customDbClient?: any;
}): Promise<RestoreResult> {
  const backupPath =
    options?.backupFilePath || path.resolve(process.cwd(), "backups/latest.json");
  const dryRun = !!options?.dryRun;

  let payload: BackupPayload;

  if (options?.customPayload) {
    payload = options.customPayload;
  } else {
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup file not found at: ${backupPath}`);
    }
    const raw = fs.readFileSync(backupPath, "utf-8");
    payload = JSON.parse(raw);
  }

  // 1. Verify Checksum
  const computed = computeBackupChecksum(payload.data);
  const checksumVerified = computed === payload.checksum;

  if (!checksumVerified) {
    return {
      ok: false,
      dryRun,
      restoredCounts: { chapters: 0, files: 0, file_parts: 0 },
      checksumVerified: false,
      error: `Backup checksum mismatch! Expected: ${payload.checksum}, Computed: ${computed}`,
    };
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      restoredCounts: {
        chapters: payload.data.chapters.length,
        files: payload.data.files.length,
        file_parts: payload.data.file_parts.length,
      },
      checksumVerified: true,
    };
  }

  // 2. Perform Real Database Restore
  const db = options?.customDbClient || getDb();

  // 2.1 Restore Chapters
  if (payload.data.chapters.length > 0) {
    const { error: chapErr } = await db.from("chapters").upsert(payload.data.chapters, {
      onConflict: "class,subject,chapter_no",
    });
    if (chapErr) throw new Error(`Failed to restore chapters: ${chapErr.message}`);
  }

  // 2.2 Restore Files
  if (payload.data.files.length > 0) {
    const { error: fileErr } = await db.from("files").upsert(payload.data.files, {
      onConflict: "id",
    });
    if (fileErr) throw new Error(`Failed to restore files: ${fileErr.message}`);
  }

  // 2.3 Restore File Parts
  if (payload.data.file_parts.length > 0) {
    const { error: partErr } = await db.from("file_parts").upsert(payload.data.file_parts, {
      onConflict: "file_id,part_no",
    });
    if (partErr) throw new Error(`Failed to restore file parts: ${partErr.message}`);
  }

  return {
    ok: true,
    dryRun: false,
    restoredCounts: {
      chapters: payload.data.chapters.length,
      files: payload.data.files.length,
      file_parts: payload.data.file_parts.length,
    },
    checksumVerified: true,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fileArg = args.find((a) => !a.startsWith("--"));

  console.log("\n=======================================================");
  console.log("     SST Chapter Library — Automated Disaster Restore   ");
  console.log("=======================================================\n");

  try {
    const res = await runRestore({
      backupFilePath: fileArg,
      dryRun,
    });

    if (res.dryRun) {
      console.log(`[DRY RUN] Verification successful! Checksum valid.`);
      console.log(`  - Chapters to restore:   ${res.restoredCounts.chapters}`);
      console.log(`  - Files to restore:      ${res.restoredCounts.files}`);
      console.log(`  - File parts to restore: ${res.restoredCounts.file_parts}`);
    } else {
      console.log(`✓ Restore successfully completed!`);
      console.log(`  - Chapters restored:   ${res.restoredCounts.chapters}`);
      console.log(`  - Files restored:      ${res.restoredCounts.files}`);
      console.log(`  - File parts restored: ${res.restoredCounts.file_parts}`);
    }
  } catch (err: any) {
    console.error(`✗ Restore failed: ${err?.message || err}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith("restore.ts")) {
  main();
}
