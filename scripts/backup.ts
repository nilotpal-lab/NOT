import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { getDb } from "../src/lib/db";
import { Chapter, FileRecord, FilePart } from "../src/types/database";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

export interface BackupPayload {
  version: "1.0.0";
  timestamp: string;
  source: string;
  counts: {
    chapters: number;
    files: number;
    file_parts: number;
  };
  checksum: string;
  data: {
    chapters: Chapter[];
    files: FileRecord[];
    file_parts: FilePart[];
  };
}

export function computeBackupChecksum(data: {
  chapters: Chapter[];
  files: FileRecord[];
  file_parts: FilePart[];
}): string {
  const serialized = JSON.stringify(data, Object.keys(data).sort());
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

export async function runBackup(options?: {
  mockData?: {
    chapters: Chapter[];
    files: FileRecord[];
    file_parts: FilePart[];
  };
  outputDir?: string;
}): Promise<BackupPayload> {
  const outputDir = options?.outputDir || path.resolve(process.cwd(), "backups");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let chapters: Chapter[] = [];
  let files: FileRecord[] = [];
  let fileParts: FilePart[] = [];

  if (options?.mockData) {
    chapters = options.mockData.chapters;
    files = options.mockData.files;
    fileParts = options.mockData.file_parts;
  } else {
    const db = getDb();

    // 1. Fetch Chapters
    const chapRes = await db.from("chapters").select("*").order("class", { ascending: true });
    if (chapRes.error) throw new Error(`Failed to fetch chapters: ${chapRes.error.message}`);
    chapters = chapRes.data || [];

    // 2. Fetch Files
    const fileRes = await db.from("files").select("*").order("created_at", { ascending: true });
    if (fileRes.error) throw new Error(`Failed to fetch files: ${fileRes.error.message}`);
    files = fileRes.data || [];

    // 3. Fetch File Parts
    const partRes = await db.from("file_parts").select("*").order("part_no", { ascending: true });
    if (partRes.error) throw new Error(`Failed to fetch file parts: ${partRes.error.message}`);
    fileParts = partRes.data || [];
  }

  const checksum = computeBackupChecksum({
    chapters,
    files,
    file_parts: fileParts,
  });

  const now = new Date();
  const timestampStr = now.toISOString().replace(/[:.]/g, "-");

  const payload: BackupPayload = {
    version: "1.0.0",
    timestamp: now.toISOString(),
    source: "SST Chapter Library (Supabase)",
    counts: {
      chapters: chapters.length,
      files: files.length,
      file_parts: fileParts.length,
    },
    checksum,
    data: {
      chapters,
      files,
      file_parts: fileParts,
    },
  };

  const backupFileName = `backup-${timestampStr}.json`;
  const backupFilePath = path.join(outputDir, backupFileName);
  const latestFilePath = path.join(outputDir, "latest.json");

  fs.writeFileSync(backupFilePath, JSON.stringify(payload, null, 2), "utf-8");
  fs.writeFileSync(latestFilePath, JSON.stringify(payload, null, 2), "utf-8");

  return payload;
}

async function main() {
  console.log("\n=======================================================");
  console.log("     SST Chapter Library — Automated Backup Engine     ");
  console.log("=======================================================\n");

  try {
    const result = await runBackup();
    console.log(`✓ Backup successfully generated!`);
    console.log(`  - Chapters:   ${result.counts.chapters}`);
    console.log(`  - Files:      ${result.counts.files}`);
    console.log(`  - File Parts: ${result.counts.file_parts}`);
    console.log(`  - SHA-256:    ${result.checksum}`);
    console.log(`  - Location:   backups/latest.json\n`);
  } catch (err: any) {
    console.error(`✗ Backup failed: ${err?.message || err}`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith("backup.ts")) {
  main();
}
