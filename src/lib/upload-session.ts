import crypto from "crypto";
import { PART_SIZE_BYTES } from "@/lib/validate";
import { TelegramClient } from "@/lib/telegram";
import { logger } from "@/lib/logger";

export interface TelegramClientLike {
  sendDocument(
    channelId: string | number,
    fileBuffer: Buffer | Uint8Array,
    fileName: string,
    caption?: string,
    timeoutMs?: number
  ): Promise<{ messageId: number; fileId: string; fileUniqueId: string }>;
  deleteMessage(channelId: string | number, messageId: number): Promise<boolean>;
}

export interface DatabaseLike {
  findOrCreateChapter?(data: { class: number; subject: string; chapterNo: number; title: string }): unknown;
  insertFile?(fileData: unknown, parts: unknown[]): unknown;
  checkDuplicateFile?(chapterId: string, sha256: string): unknown;
}

export interface UploadPartMeta {
  partNo: number;
  sizeBytes: number;
  sha256: string;
  tgMessageId: number;
  tgFileId: string;
  tgFileUniqueId: string;
  uploadedAt: number;
}

export type UploadSessionPartRecord = UploadPartMeta;

export interface UploadSessionData {
  uploadId: string;
  expectedTotalParts: number;
  channelId: string | number;
  fileName?: string;
  kind?: string;
  title?: string;
  class?: number;
  subject?: string;
  chapterNo?: number;
  receivedParts: number[];
  uploadedParts: UploadPartMeta[];
  partsMeta: UploadPartMeta[];
  uploadedMessageIds: number[];
  hashStream: crypto.Hash;
  finalSha256?: string;
  firstChunkHeader?: Buffer;
  totalBytes: number;
  totalBytesReceived: number;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
  isProcessing: boolean;
}

export type UploadSession = UploadSessionData;

export interface UploadSessionConfig {
  sessionTtlMs?: number;
  maxPartSizeBytes?: number;
  channelId?: string | number;
}

export interface CompleteUploadMetadata {
  chapterId: string;
  kind: "ncert_pdf" | "ppt" | "ppt_pdf" | "teacher_notes" | string;
  fileName: string;
  sizeBytes: number;
  parentFileId?: string | null;
  teacherName?: string | null;
  mime?: string;
}

/**
 * Pure slicing simulator matching client/server contract
 */
export function sliceBuffer(buffer: Buffer, partSizeBytes: number = PART_SIZE_BYTES): Buffer[] {
  if (!buffer || buffer.length === 0) return [];
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const end = Math.min(offset + partSizeBytes, buffer.length);
    parts.push(buffer.subarray(offset, end));
    offset = end;
  }
  return parts;
}

/**
 * Calculates expected total parts for a given file size
 */
export function calculatePartCount(totalBytes: number, partSizeBytes: number = PART_SIZE_BYTES): number {
  if (totalBytes <= 0) return 0;
  return Math.ceil(totalBytes / partSizeBytes);
}

/**
 * Validates chunk size against maximum part size invariant
 */
export function validateChunkSize(
  chunkSizeBytes: number,
  maxPartSizeBytes: number = PART_SIZE_BYTES
): { valid: boolean; error?: string } {
  if (chunkSizeBytes <= 0) {
    return { valid: false, error: "Part chunk cannot be empty (0 bytes)" };
  }
  if (chunkSizeBytes > maxPartSizeBytes) {
    return {
      valid: false,
      error: `Part exceeds maximum chunk size of 19 MiB (${chunkSizeBytes} > ${maxPartSizeBytes})`,
    };
  }
  return { valid: true };
}

class AsyncLock {
  private isLocked = false;
  private queue: Array<() => void> = [];

  async acquire(timeoutMs = 30000): Promise<() => void> {
    if (!this.isLocked) {
      this.isLocked = true;
      return () => this.release();
    }
    return new Promise<() => void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const resume = () => {
        if (timer) clearTimeout(timer);
        this.isLocked = true;
        resolve(() => this.release());
      };

      timer = setTimeout(() => {
        const idx = this.queue.indexOf(resume);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error("Upload session concurrency lock timeout"));
      }, timeoutMs);

      this.queue.push(resume);
    });
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    } else {
      this.isLocked = false;
    }
  }

  get locked(): boolean {
    return this.isLocked;
  }
}

export class UploadSessionManager {
  private sessions = new Map<string, UploadSessionData>();
  private locks = new Map<string, AsyncLock>();
  private defaultTg?: TelegramClientLike;
  private defaultDb?: DatabaseLike;
  private sessionTtlMs: number;
  private maxPartSizeBytes: number;
  private defaultChannelId: string | number;
  private reaperInterval?: NodeJS.Timeout;

  constructor(
    tgOrConfig?: TelegramClientLike | UploadSessionConfig | number,
    db?: DatabaseLike,
    sessionTtlMs?: number
  ) {
    if (typeof tgOrConfig === "number") {
      this.sessionTtlMs = tgOrConfig;
      this.maxPartSizeBytes = PART_SIZE_BYTES;
      this.defaultChannelId = process.env.TELEGRAM_CHANNEL_ID || "-1001234567890";
    } else if (tgOrConfig && typeof (tgOrConfig as TelegramClientLike).sendDocument === "function") {
      this.defaultTg = tgOrConfig as TelegramClientLike;
      this.defaultDb = db;
      this.sessionTtlMs = sessionTtlMs ?? 30 * 60 * 1000;
      this.maxPartSizeBytes = PART_SIZE_BYTES;
      this.defaultChannelId = process.env.TELEGRAM_CHANNEL_ID || "-1001234567890";
    } else {
      const config = (tgOrConfig as UploadSessionConfig) || {};
      this.sessionTtlMs = config.sessionTtlMs ?? (typeof sessionTtlMs === "number" ? sessionTtlMs : 30 * 60 * 1000);
      this.maxPartSizeBytes = config.maxPartSizeBytes ?? PART_SIZE_BYTES;
      this.defaultChannelId = config.channelId || process.env.TELEGRAM_CHANNEL_ID || "-1001234567890";
    }

    this.startReaper();
  }

  /**
   * Resolves a Telegram client from argument, instance default, or environment
   */
  getTelegramClient(tgClient?: TelegramClientLike): TelegramClientLike | undefined {
    if (tgClient) return tgClient;
    if (this.defaultTg) return this.defaultTg;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      return new TelegramClient(botToken);
    }
    return undefined;
  }

  /**
   * Starts periodic reaper for sweeping stale sessions without blocking Node exit
   */
  startReaper(intervalMs = 60_000): void {
    if (this.reaperInterval) return;
    this.reaperInterval = setInterval(() => {
      this.cleanupExpiredSessions().catch((err) =>
        logger.warn({ err }, "Periodic session reaper error")
      );
    }, intervalMs);
    if (this.reaperInterval.unref) {
      this.reaperInterval.unref();
    }
  }

  /**
   * Stops periodic reaper
   */
  stopReaper(): void {
    if (this.reaperInterval) {
      clearInterval(this.reaperInterval);
      this.reaperInterval = undefined;
    }
  }

  private getLock(uploadId: string): AsyncLock {
    let lock = this.locks.get(uploadId);
    if (!lock) {
      lock = new AsyncLock();
      this.locks.set(uploadId, lock);
    }
    return lock;
  }

  startSession(
    uploadId: string,
    expectedTotalParts: number,
    metadataOrChannel?: Partial<UploadSessionData> | string | number
  ): UploadSessionData {
    if (!uploadId || typeof uploadId !== "string") {
      throw new Error("Invalid uploadId: non-empty string required");
    }
    if (!Number.isInteger(expectedTotalParts) || expectedTotalParts < 1) {
      throw new Error(`expectedTotalParts must be an integer >= 1 (received ${expectedTotalParts})`);
    }

    let channelId = this.defaultChannelId;
    let meta: Partial<UploadSessionData> = {};

    if (typeof metadataOrChannel === "string" || typeof metadataOrChannel === "number") {
      channelId = metadataOrChannel;
    } else if (metadataOrChannel && typeof metadataOrChannel === "object") {
      meta = metadataOrChannel;
      if (meta.channelId) channelId = meta.channelId;
    }

    const partsMetaList: UploadPartMeta[] = [];

    const session: UploadSessionData = {
      uploadId,
      expectedTotalParts,
      channelId,
      fileName: meta.fileName || "unnamed",
      kind: meta.kind,
      title: meta.title,
      class: meta.class,
      subject: meta.subject,
      chapterNo: meta.chapterNo,
      receivedParts: [],
      uploadedParts: partsMetaList,
      partsMeta: partsMetaList,
      uploadedMessageIds: [],
      hashStream: crypto.createHash("sha256"),
      totalBytes: 0,
      totalBytesReceived: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastActivityAt: Date.now(),
      isProcessing: false,
    };

    this.sessions.set(uploadId, session);
    return session;
  }

  /**
   * Retrieves an upload session by uploadId.
   * If the session is expired:
   * - If `options?.includeExpired` or `options?.allowExpired` is true, returns the session data
   *   (allowing callers to inspect metadata or execute custom rollback before deletion).
   * - Otherwise, triggers Telegram rollback (default rollbackOnExpire = true),
   *   deletes the session, and returns null.
   */
  getSession(
    uploadId: string,
    options?: {
      includeExpired?: boolean;
      allowExpired?: boolean;
      rollbackOnExpire?: boolean;
      tgClient?: TelegramClientLike;
    }
  ): UploadSessionData | null {
    const session = this.sessions.get(uploadId);
    if (!session) return null;

    const isExpired = Date.now() - session.createdAt > this.sessionTtlMs;

    if (isExpired) {
      if (options?.includeExpired || options?.allowExpired) {
        return session;
      }

      const shouldRollback = options?.rollbackOnExpire !== false;
      if (shouldRollback && session.uploadedMessageIds.length > 0) {
        const client = options?.tgClient || this.getTelegramClient();
        if (client) {
          this.rollbackTelegramMessages(session.uploadedMessageIds, client, session.channelId).catch(
            (err) => logger.warn({ uploadId, err }, "Error during getSession TTL rollback")
          );
        }
      }

      this.sessions.delete(uploadId);
      this.locks.delete(uploadId);
      return null;
    }

    return session;
  }

  /**
   * Peeks at a session without checking TTL or deleting it.
   */
  peekSession(uploadId: string): UploadSessionData | null {
    return this.sessions.get(uploadId) || null;
  }

  /**
   * Checks whether a session has exceeded the configured TTL.
   */
  isSessionExpired(uploadIdOrSession: string | UploadSessionData): boolean {
    const session =
      typeof uploadIdOrSession === "string"
        ? this.sessions.get(uploadIdOrSession)
        : uploadIdOrSession;
    if (!session) return true;
    return Date.now() - session.createdAt > this.sessionTtlMs;
  }

  deleteSession(uploadId: string): boolean {
    this.locks.delete(uploadId);
    return this.sessions.delete(uploadId);
  }

  acquireLock(uploadId: string): boolean {
    const session = this.sessions.get(uploadId);
    if (!session || session.isProcessing) return false;
    session.isProcessing = true;
    return true;
  }

  releaseLock(uploadId: string): void {
    const session = this.sessions.get(uploadId);
    if (session) session.isProcessing = false;
  }

  async uploadPart(
    uploadId: string,
    partNo: number,
    partBuffer: Buffer | Uint8Array,
    fileName: string,
    options?: {
      caption?: string;
      tgClient?: TelegramClientLike;
      channelId?: string | number;
    }
  ): Promise<{ messageId: number; fileId: string; fileUniqueId?: string; partSha256: string }> {
    const session = this.sessions.get(uploadId);
    if (!session) {
      throw new Error("Upload session not found or expired");
    }

    // Check session TTL (30 min)
    if (Date.now() - session.createdAt > this.sessionTtlMs) {
      const client = options?.tgClient || this.getTelegramClient();
      const channel = options?.channelId || session.channelId || this.defaultChannelId;
      if (client && session.uploadedMessageIds.length > 0) {
        await this.rollbackTelegramMessages(session.uploadedMessageIds, client, channel);
      }
      this.sessions.delete(uploadId);
      this.locks.delete(uploadId);
      throw new Error("Upload session expired (30m TTL)");
    }

    const lock = this.getLock(uploadId);
    const release = await lock.acquire();

    try {
      const buf = Buffer.isBuffer(partBuffer) ? partBuffer : Buffer.from(partBuffer);

      // Rule: Part size cannot exceed PART_SIZE_BYTES (19 MiB)
      if (buf.length > this.maxPartSizeBytes) {
        throw new Error(
          `Part ${partNo} exceeds maximum chunk size of 19 MiB (${buf.length} > ${this.maxPartSizeBytes})`
        );
      }

      // Rule: Part cannot be 0 bytes
      if (buf.length === 0) {
        throw new Error(`Part ${partNo} cannot be empty (0 bytes)`);
      }

      // Rule: Parts must be strictly sequential (in-order) & no duplicates
      const expectedPart = session.receivedParts.length + 1;
      if (partNo !== expectedPart) {
        throw new Error(`Out of order part: expected ${expectedPart}, received ${partNo}`);
      }

      if (partNo > session.expectedTotalParts) {
        throw new Error(`Part ${partNo} exceeds expected total parts (${session.expectedTotalParts})`);
      }

      const client = options?.tgClient || this.getTelegramClient();
      if (!client) {
        throw new Error("No TelegramClient available for uploadPart");
      }

      const channel = options?.channelId || session.channelId || this.defaultChannelId;
      const caption = options?.caption || `name=${fileName}|part=${partNo}/${session.expectedTotalParts}`;

      // Forward part to Telegram
      try {
        const { messageId, fileId, fileUniqueId } = await client.sendDocument(
          channel,
          buf,
          `${fileName}.part${partNo}`,
          caption
        );

        const partSha = crypto.createHash("sha256").update(buf).digest("hex");
        session.hashStream.update(buf);
        session.receivedParts.push(partNo);
        session.uploadedMessageIds.push(messageId);
        session.totalBytes += buf.length;
        session.totalBytesReceived += buf.length;
        session.updatedAt = Date.now();
        session.lastActivityAt = Date.now();

        const partMeta: UploadPartMeta = {
          partNo,
          sizeBytes: buf.length,
          sha256: partSha,
          tgMessageId: messageId,
          tgFileId: fileId,
          tgFileUniqueId: fileUniqueId || "",
          uploadedAt: Date.now(),
        };
        session.uploadedParts.push(partMeta);

        return { messageId, fileId, fileUniqueId, partSha256: partSha };
      } catch (err) {
        // Automatic Rollback: delete all previously sent parts
        await this.rollbackTelegramMessages(session.uploadedMessageIds, client, channel);
        this.sessions.delete(uploadId);
        this.locks.delete(uploadId);
        throw err;
      }
    } finally {
      release();
    }
  }

  completeSession(uploadId: string): {
    fullSha256: string;
    totalBytes: number;
    partCount: number;
    uploadedParts: UploadPartMeta[];
    uploadedMessageIds: number[];
  } {
    const session = this.sessions.get(uploadId);
    if (!session) {
      throw new Error("Upload session not found or expired");
    }

    if (Date.now() - session.createdAt > this.sessionTtlMs) {
      const client = this.getTelegramClient();
      if (client && session.uploadedMessageIds.length > 0) {
        this.rollbackTelegramMessages(session.uploadedMessageIds, client, session.channelId).catch(
          (err) => logger.warn({ uploadId, err }, "Error during completeSession TTL rollback")
        );
      }
      this.sessions.delete(uploadId);
      this.locks.delete(uploadId);
      throw new Error("Upload session expired (30m TTL)");
    }

    if (session.receivedParts.length !== session.expectedTotalParts) {
      throw new Error(
        `Incomplete upload: received ${session.receivedParts.length} of ${session.expectedTotalParts} parts`
      );
    }

    if (!session.finalSha256) {
      session.finalSha256 = session.hashStream.digest("hex");
    }

    return {
      fullSha256: session.finalSha256,
      totalBytes: session.totalBytes,
      partCount: session.expectedTotalParts,
      uploadedParts: session.uploadedParts,
      uploadedMessageIds: session.uploadedMessageIds,
    };
  }

  async completeUpload(
    uploadId: string,
    fileMetadata: CompleteUploadMetadata,
    options?: {
      db?: DatabaseLike;
      tgClient?: TelegramClientLike;
      channelId?: string | number;
    }
  ): Promise<unknown> {
    const session = this.sessions.get(uploadId);
    if (!session) {
      throw new Error("Upload session not found or expired");
    }

    const tgClient = options?.tgClient || this.getTelegramClient();
    const channel = options?.channelId || session.channelId || this.defaultChannelId;

    // Check session TTL before proceeding
    if (Date.now() - session.createdAt > this.sessionTtlMs) {
      if (tgClient && session.uploadedMessageIds.length > 0) {
        await this.rollbackTelegramMessages(session.uploadedMessageIds, tgClient, channel);
      }
      this.sessions.delete(uploadId);
      this.locks.delete(uploadId);
      throw new Error("Upload session expired (30m TTL)");
    }

    if (session.receivedParts.length !== session.expectedTotalParts) {
      if (tgClient && session.uploadedMessageIds.length > 0) {
        await this.rollbackTelegramMessages(session.uploadedMessageIds, tgClient, channel);
      }
      this.sessions.delete(uploadId);
      this.locks.delete(uploadId);
      throw new Error(
        `Incomplete upload: received ${session.receivedParts.length} of ${session.expectedTotalParts} parts`
      );
    }

    const { fullSha256 } = this.completeSession(uploadId);
    const db = options?.db || this.defaultDb;

    if (!db || typeof db.insertFile !== "function") {
      throw new Error("No database service available for completeUpload");
    }

    try {
      const fileRecord = await db.insertFile(
        {
          chapter_id: fileMetadata.chapterId,
          kind: fileMetadata.kind,
          parent_file_id: fileMetadata.parentFileId ?? null,
          file_name: fileMetadata.fileName,
          teacher_name: fileMetadata.teacherName ?? null,
          size_bytes: fileMetadata.sizeBytes,
          part_count: session.expectedTotalParts,
          mime: fileMetadata.mime || "application/pdf",
          sha256: fullSha256,
          is_published: true,
        },
        session.uploadedParts.map((p) => ({
          part_no: p.partNo,
          tg_file_id: p.tgFileId,
          tg_file_unique_id: p.tgFileUniqueId,
          tg_message_id: p.tgMessageId,
          size_bytes: p.sizeBytes,
          sha256: p.sha256,
        }))
      );

      this.sessions.delete(uploadId);
      this.locks.delete(uploadId);
      return fileRecord;
    } catch (err) {
      // Rollback Telegram messages on database insertion failure
      if (tgClient && session.uploadedMessageIds.length > 0) {
        await this.rollbackTelegramMessages(session.uploadedMessageIds, tgClient, channel);
      }
      this.sessions.delete(uploadId);
      this.locks.delete(uploadId);
      throw err;
    }
  }

  async rollbackTelegramMessages(
    messageIds: number[],
    tgClient?: TelegramClientLike,
    channelId?: string | number
  ): Promise<{ deleted: number[]; failed: number[] }> {
    const client = tgClient || this.getTelegramClient();
    const channel = channelId || this.defaultChannelId;
    const deleted: number[] = [];
    const failed: number[] = [];

    if (!client) {
      logger.error("No TelegramClient available to execute message rollback");
      return { deleted, failed };
    }

    for (const msgId of messageIds) {
      try {
        await client.deleteMessage(channel, msgId);
        deleted.push(msgId);
      } catch (err) {
        logger.warn({ channel, msgId, err }, "Failed to delete Telegram message during rollback");
        failed.push(msgId);
      }
    }

    return { deleted, failed };
  }

  async rollbackSession(
    uploadIdOrSession: string | UploadSessionData,
    tgClient?: TelegramClientLike
  ): Promise<number[]> {
    const session =
      typeof uploadIdOrSession === "string"
        ? this.sessions.get(uploadIdOrSession)
        : uploadIdOrSession;
    if (!session) return [];

    const uploadId = session.uploadId;
    const { deleted } = await this.rollbackTelegramMessages(
      session.uploadedMessageIds,
      tgClient || this.getTelegramClient(),
      session.channelId
    );

    this.sessions.delete(uploadId);
    this.locks.delete(uploadId);
    return deleted;
  }

  async rollbackSessionTelegram(
    uploadIdOrSession: string | UploadSessionData,
    tgClient: TelegramClientLike,
    channelId?: string | number
  ): Promise<number[]> {
    const session =
      typeof uploadIdOrSession === "string"
        ? this.sessions.get(uploadIdOrSession)
        : uploadIdOrSession;
    if (!session || session.uploadedMessageIds.length === 0) return [];

    const { deleted } = await this.rollbackTelegramMessages(
      session.uploadedMessageIds,
      tgClient,
      channelId || session.channelId
    );

    session.uploadedMessageIds = [];
    return deleted;
  }

  /**
   * Purges expired sessions from memory.
   * Defaults rollback: true so any uploaded Telegram messages are deleted.
   * Returns a promise resolving to the number of cleaned sessions, properly awaiting deletions.
   */
  async cleanupExpiredSessions(options?: {
    rollback?: boolean;
    tgClient?: TelegramClientLike;
  }): Promise<number> {
    const now = Date.now();
    const shouldRollback = options?.rollback !== false;
    const client = options?.tgClient || this.getTelegramClient();
    const expiredEntries: Array<[string, UploadSessionData]> = [];

    for (const [uploadId, session] of this.sessions.entries()) {
      if (now - session.createdAt > this.sessionTtlMs) {
        expiredEntries.push([uploadId, session]);
      }
    }

    if (expiredEntries.length === 0) return 0;

    const rollbackPromises: Promise<unknown>[] = [];

    for (const [uploadId, session] of expiredEntries) {
      if (shouldRollback && session.uploadedMessageIds.length > 0 && client) {
        rollbackPromises.push(
          this.rollbackTelegramMessages(session.uploadedMessageIds, client, session.channelId).catch(
            (err) => logger.warn({ uploadId, err }, "Error during cleanup rollback")
          )
        );
      }
      this.sessions.delete(uploadId);
      this.locks.delete(uploadId);
    }

    await Promise.all(rollbackPromises);
    return expiredEntries.length;
  }
}

// Global default singleton for application routes
export const uploadSessionManager = new UploadSessionManager();
