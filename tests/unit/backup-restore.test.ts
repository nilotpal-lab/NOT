import { describe, it, expect, vi, beforeEach } from "vitest";
import { runBackup, computeBackupChecksum, BackupPayload } from "../../scripts/backup";
import { runRestore } from "../../scripts/restore";
import fs from "fs";
import path from "path";

describe("Phase 4: Automated Backup & Disaster Recovery (tests/unit/backup-restore.test.ts)", () => {
  const tempBackupDir = path.resolve(process.cwd(), "backups/test-temp");

  beforeEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(tempBackupDir)) {
      fs.rmSync(tempBackupDir, { recursive: true, force: true });
    }
  });

  const mockData = {
    chapters: [
      {
        id: "chap-1",
        class: 9,
        subject: "Economics",
        chapter_no: 1,
        title: "The Story of Village Palampur",
        created_at: "2026-01-01T10:00:00Z",
      },
    ],
    files: [
      {
        id: "file-1",
        chapter_id: "chap-1",
        kind: "ncert_pdf",
        file_name: "Village-Palampur_Class9_Economics_Ch01_NCERT.pdf",
        size_bytes: 2048,
        part_count: 1,
        mime: "application/pdf",
        sha256: "testsha1",
        is_published: true,
        created_at: "2026-01-01T10:05:00Z",
      },
    ],
    file_parts: [
      {
        tg_file_unique_id: "uniq-p1",
        file_id: "file-1",
        part_no: 1,
        tg_file_id: "tg-1",
        tg_message_id: 101,
        size_bytes: 2048,
        sha256: "testsha1",
      },
    ],
  };

  it("computes reproducible and unique SHA-256 checksums", () => {
    const hash1 = computeBackupChecksum(mockData);
    const hash2 = computeBackupChecksum(mockData);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
  });

  it("creates a timestamped backup and latest.json with valid counts", async () => {
    const payload = await runBackup({
      mockData,
      outputDir: tempBackupDir,
    });

    expect(payload.version).toBe("1.0.0");
    expect(payload.counts.chapters).toBe(1);
    expect(payload.counts.files).toBe(1);
    expect(payload.counts.file_parts).toBe(1);
    expect(payload.checksum).toBe(computeBackupChecksum(mockData));

    // Verify written files
    const latestPath = path.join(tempBackupDir, "latest.json");
    expect(fs.existsSync(latestPath)).toBe(true);

    const saved = JSON.parse(fs.readFileSync(latestPath, "utf-8"));
    expect(saved.checksum).toBe(payload.checksum);
  });

  it("performs a successful dry-run restore verifying checksum", async () => {
    const checksum = computeBackupChecksum(mockData);
    const validPayload: BackupPayload = {
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      source: "test",
      counts: { chapters: 1, files: 1, file_parts: 1 },
      checksum,
      data: mockData,
    };

    const res = await runRestore({
      dryRun: true,
      customPayload: validPayload,
    });

    expect(res.ok).toBe(true);
    expect(res.dryRun).toBe(true);
    expect(res.checksumVerified).toBe(true);
    expect(res.restoredCounts.chapters).toBe(1);
    expect(res.restoredCounts.files).toBe(1);
    expect(res.restoredCounts.file_parts).toBe(1);
  });

  it("rejects a corrupted or tampered backup file", async () => {
    const tamperedPayload: BackupPayload = {
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      source: "test",
      counts: { chapters: 1, files: 1, file_parts: 1 },
      checksum: "0000000000000000000000000000000000000000000000000000000000000000",
      data: mockData,
    };

    const res = await runRestore({
      customPayload: tamperedPayload,
    });

    expect(res.ok).toBe(false);
    expect(res.checksumVerified).toBe(false);
    expect(res.error).toContain("checksum mismatch");
  });

  it("executes database upserts for chapters, files, and parts during restore", async () => {
    const checksum = computeBackupChecksum(mockData);
    const validPayload: BackupPayload = {
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      source: "test",
      counts: { chapters: 1, files: 1, file_parts: 1 },
      checksum,
      data: mockData,
    };

    const upsertSpy = vi.fn().mockResolvedValue({ error: null });
    const mockDb = {
      from: vi.fn(() => ({
        upsert: upsertSpy,
      })),
    };

    const res = await runRestore({
      dryRun: false,
      customPayload: validPayload,
      customDbClient: mockDb,
    });

    expect(res.ok).toBe(true);
    expect(res.checksumVerified).toBe(true);
    expect(mockDb.from).toHaveBeenCalledWith("chapters");
    expect(mockDb.from).toHaveBeenCalledWith("files");
    expect(mockDb.from).toHaveBeenCalledWith("file_parts");
    expect(upsertSpy).toHaveBeenCalledTimes(3);
  });
});
