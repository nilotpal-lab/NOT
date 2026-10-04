# Milestone M3: Telegram Client Expansion & Upload Session Manager Analysis

**Explorer**: Explorer 1 (`explorer_m3_1`)  
**Date**: 2026-10-04  
**Target Modules**: `src/lib/telegram.ts`, `src/lib/upload-session.ts`  
**Reference Specs**: `ORIGINAL_REQUEST.md` (§ R3), `PROJECT.md` (Features 11–15)

---

## 1. Executive Summary & Problem Boundary

Milestone M3 establishes the zero-cost storage engine for the SST Chapter Library. Because storage is backed entirely by a private Telegram channel without cloud object storage costs, all file storage operations rely on chunked multi-part uploads sent via the Telegram Bot API and indexed in Supabase.

To meet R3 and all testing tier requirements, two foundational components are needed:
1. **`src/lib/telegram.ts` (Telegram Client Expansion)**:
   - Provide `sendDocument` with native multipart form streaming (`FormData` + `Blob`), configurable timeouts (default 60s), automatic 429 rate-limit backoff, and bulletproof token redaction.
   - Provide `getFile` with an in-memory 45-minute TTL cache (Telegram links expire in 1 hour; caching for 45 minutes eliminates redundant API roundtrips while preventing expired URL leakage).
   - Provide `downloadFile` for reading back raw chunks directly from `https://api.telegram.org/file/bot<token>/<path>`.
2. **`src/lib/upload-session.ts` (Upload Session Engine)**:
   - Provide in-memory session management with 30-minute TTL.
   - Enforce concurrency locking per session to prevent race conditions from concurrent part uploads.
   - Enforce strict part validation: `PART_SIZE_BYTES = 19 * 1024 * 1024` (19922944 bytes max), strict sequence order (`partNo == nextExpectedPart`), and duplicate part rejection.
   - Maintain an incremental streaming SHA-256 digest across incoming chunks so that at no point does the server hold more than a single 19 MiB chunk in memory.
   - Provide robust rollback helpers that cleanly delete all forwarded Telegram messages if any part or subsequent database insertion fails.

---

## 2. Deep Dive: `src/lib/telegram.ts` Expansion

### 2.1 Current State vs. Target State
In the initial skeleton (`src/lib/telegram.ts`), `TelegramClient` only contained:
- `getMe()`
- `postTestMessage(channelId)`
- `deleteMessage(channelId, messageId)`
- `getUpdates()`

It lacked:
- `sendDocument`
- `getFile`
- `downloadFile`
- 45-minute TTL cache for `file_path`
- Configurable request timeout & 429 retry handling

### 2.2 Interface Contract
```typescript
export interface TelegramFileInfo {
  filePath: string;
  fileSize: number;
  fileId: string;
  fileUniqueId?: string;
  // Alias for snake_case compatibility
  file_path?: string;
  file_size?: number;
}

export interface TelegramSendDocumentResult {
  messageId: number;
  fileId: string;
  fileUniqueId: string;
}

export interface TelegramRequestOptions extends RequestInit {
  timeoutMs?: number;
  maxRetries?: number;
}
```

### 2.3 Key Implementation Mechanics
1. **Token Redaction**:
   The bot token must never appear in error stacks or logs. We use regex escaping to ensure regex special characters in tokens do not break substitution:
   ```typescript
   private sanitizeError(err: unknown): Error {
     const message = err instanceof Error ? err.message : String(err);
     const escapedToken = this.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
     const sanitized = message.replace(new RegExp(escapedToken, "g"), "[REDACTED_BOT_TOKEN]");
     return new Error(sanitized);
   }
   ```
2. **Multipart Form Upload via Fetch (`sendDocument`)**:
   In modern Node.js and Next.js, `FormData` and `Blob` are global. We append `chat_id`, `document` (as `Blob`), and optional `caption`. We do *not* set the `Content-Type` header manually so that the runtime computes the boundary string automatically.
3. **429 Rate Limit Handling**:
   When Telegram responds with HTTP 429, it includes `parameters.retry_after` (in seconds). If retries remain (`attempt < maxRetries`) and `retry_after <= 60s`, the client logs a warning, awaits the specified delay, and retries the request transparently.
4. **45-Minute `file_path` Cache**:
   Telegram download links are valid for 1 hour. Caching `file_path` for 45 minutes guarantees that links returned by `getFile` will remain valid for at least 15 minutes while drastically cutting down on Bot API roundtrips.

---

## 3. Deep Dive: `src/lib/upload-session.ts`

### 3.1 Interface Contract & Session State
```typescript
export interface UploadPartMeta {
  partNo: number;
  sizeBytes: number;
  sha256: string;
  tgMessageId: number;
  tgFileId: string;
  tgFileUniqueId: string;
  uploadedAt: number;
}

export interface UploadSessionData {
  uploadId: string;
  expectedTotalParts: number;
  channelId: string | number;
  fileName?: string;
  receivedParts: number[];
  uploadedParts: UploadPartMeta[];
  uploadedMessageIds: number[];
  hashStream: crypto.Hash;
  finalSha256?: string;
  totalBytes: number;
  createdAt: number;
  updatedAt: number;
}
```

### 3.2 Concurrency Lock Design
To prevent concurrent requests from corrupting the stream or sending duplicate messages to Telegram, each upload session possesses an `AsyncLock`.
```typescript
class AsyncLock {
  private isLocked = false;
  private queue: Array<() => void> = [];

  async acquire(timeoutMs = 30000): Promise<() => void> {
    if (!this.isLocked) {
      this.isLocked = true;
      return () => this.release();
    }
    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.indexOf(resume);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error("Concurrency lock acquisition timed out"));
      }, timeoutMs);

      const resume = () => {
        clearTimeout(timer);
        this.isLocked = true;
        resolve(() => this.release());
      };
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
}
```

### 3.3 Strict Validation Invariants
1. **Size Limit**: `PART_SIZE_BYTES = 19 * 1024 * 1024` (19922944 bytes).
   - If `buffer.length > PART_SIZE_BYTES`:
     `throw new Error("Part ${partNo} exceeds maximum chunk size of 19 MiB (${buffer.length} > ${PART_SIZE_BYTES})")`
   - If `buffer.length === 0`:
     `throw new Error("Part ${partNo} cannot be empty (0 bytes)")`
2. **Strict Ordering**:
   - `const expectedPart = session.receivedParts.length + 1;`
   - If `partNo !== expectedPart`:
     `throw new Error("Out of order part: expected ${expectedPart}, received ${partNo}")`
   - Note: If part 1 was received, and part 1 is sent again, `expectedPart` is 2 and `partNo` is 1, matching the test pattern: `Out of order part: expected 2, received 1`.
3. **Session Expiry (30-min TTL)**:
   - If `Date.now() - session.createdAt > 30 * 60 * 1000`:
     `this.sessions.delete(uploadId);`
     `throw new Error("Upload session expired (30m TTL)")`

### 3.4 Incremental Streaming SHA-256
Because files can be up to 100 MB or 200 MB, storing all parts in memory would cause severe memory pressure on serverless/container runtimes.
- As each part arrives, it is fed to `session.hashStream.update(partBuffer)`.
- The part's individual SHA-256 is computed: `crypto.createHash("sha256").update(partBuffer).digest("hex")`.
- When the final part is received and `completeSession` is called, `session.hashStream.digest("hex")` yields the exact global SHA-256 of the complete file.
- Memory usage is strictly bounded to at most **one chunk (<= 19 MiB)** at any moment.

### 3.5 Rollback Mechanics
If sending a chunk to Telegram fails, or if inserting metadata into Supabase fails during completion:
- `rollbackTelegramMessages(channelId, uploadedMessageIds)` is invoked.
- Each message ID is deleted via `tgClient.deleteMessage(channelId, msgId)`.
- Error handling in rollback is resilient: failures on deleting one message are caught and logged so that remaining messages continue to be deleted.
- The session is deleted from memory, leaving zero orphan messages in Telegram and zero partial rows in the database.

---

## 4. Proposed Concrete Code: `src/lib/telegram.ts`

```typescript
import { logger } from "./logger";

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramMessageResponse {
  ok: boolean;
  result?: {
    message_id: number;
    chat: {
      id: number;
      title?: string;
      type: string;
    };
    date: number;
    text?: string;
    document?: {
      file_id: string;
      file_unique_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
  };
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
  };
}

export interface TelegramFileResult {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface TelegramFileResponse {
  ok: boolean;
  result?: TelegramFileResult;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
  };
}

export interface TelegramFileInfo {
  filePath: string;
  fileSize: number;
  fileId: string;
  fileUniqueId?: string;
  file_path?: string;
  file_size?: number;
}

export interface TelegramUpdatesResponse {
  ok: boolean;
  result?: Array<{
    update_id: number;
    channel_post?: {
      message_id: number;
      chat: {
        id: number;
        title?: string;
        type: string;
      };
      text?: string;
    };
    message?: {
      message_id: number;
      chat: {
        id: number;
        title?: string;
        type: string;
      };
      text?: string;
    };
  }>;
  description?: string;
}

interface CachedFileInfo {
  filePath: string;
  fileSize: number;
  fileId: string;
  fileUniqueId?: string;
  cachedAt: number;
}

export class TelegramClient {
  private token: string;
  private baseUrl: string;
  private fileBaseUrl: string;

  // In-memory cache for file_path with 45-minute TTL (links expire after 1 hour)
  private filePathCache = new Map<string, CachedFileInfo>();
  private static readonly FILE_PATH_CACHE_TTL_MS = 45 * 60 * 1000;

  constructor(token: string) {
    if (!token) {
      throw new Error("TelegramClient requires a bot token");
    }
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.fileBaseUrl = `https://api.telegram.org/file/bot${token}`;
  }

  private sanitizeError(err: unknown): Error {
    const message = err instanceof Error ? err.message : String(err);
    // Ensure the token is NEVER leaked in any error message (escaped for regex safety)
    const escapedToken = this.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sanitized = message.replace(new RegExp(escapedToken, "g"), "[REDACTED_BOT_TOKEN]");
    return new Error(sanitized);
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit & { timeoutMs?: number; maxRetries?: number } = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/${endpoint}`;
    const timeoutMs = options.timeoutMs ?? 15000;
    const maxRetries = options.maxRetries ?? 2;
    let attempt = 0;

    while (true) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        if (response.status === 429) {
          const data = (await response.json().catch(() => ({}))) as TelegramMessageResponse;
          const retryAfter = data.parameters?.retry_after ?? 5;
          logger.warn({ retryAfter, attempt, endpoint }, "Telegram API rate-limited (429)");

          if (attempt <= maxRetries && retryAfter <= 60) {
            await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
            continue;
          }
          throw new Error(`Telegram rate limited, retry after ${retryAfter}s`);
        }

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as TelegramMessageResponse;
          throw new Error(data.description || `HTTP error ${response.status}`);
        }

        return (await response.json()) as T;
      } catch (err) {
        if (attempt > maxRetries || (err instanceof Error && err.name === "AbortError")) {
          throw this.sanitizeError(err);
        }
        // If network failed and attempts remain, try once more after short delay
        if (attempt <= maxRetries && !(err instanceof Error && err.message.includes("Telegram rate limited"))) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        throw this.sanitizeError(err);
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  async getMe(): Promise<TelegramUser> {
    const data = await this.request<{ ok: boolean; result: TelegramUser }>("getMe");
    if (!data.ok || !data.result) {
      throw new Error("Failed to call getMe on Telegram Bot");
    }
    return data.result;
  }

  async postTestMessage(channelId: string | number): Promise<number> {
    const res = await this.request<TelegramMessageResponse>("sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: channelId,
        text: "SST Library bot verification test message. Deleting immediately.",
      }),
    });

    if (!res.ok || !res.result) {
      throw new Error(res.description || "Failed to post test message to Telegram channel");
    }
    return res.result.message_id;
  }

  async sendDocument(
    channelId: string | number,
    fileBuffer: Buffer | Uint8Array,
    fileName: string,
    caption?: string,
    timeoutMs = 60000
  ): Promise<{ messageId: number; fileId: string; fileUniqueId: string }> {
    const formData = new FormData();
    formData.append("chat_id", String(channelId));

    const blob = new Blob([new Uint8Array(fileBuffer)], {
      type: "application/octet-stream",
    });
    formData.append("document", blob, fileName);

    if (caption) {
      formData.append("caption", caption);
    }

    try {
      const res = await this.request<TelegramMessageResponse>("sendDocument", {
        method: "POST",
        body: formData,
        timeoutMs,
        maxRetries: 3,
      });

      if (!res.ok || !res.result?.document) {
        throw new Error(res.description || "Failed to upload document to Telegram");
      }

      return {
        messageId: res.result.message_id,
        fileId: res.result.document.file_id,
        fileUniqueId: res.result.document.file_unique_id,
      };
    } catch (err) {
      throw this.sanitizeError(err);
    }
  }

  async getFile(fileId: string, timeoutMs = 30000): Promise<TelegramFileInfo> {
    // 1. Check in-memory cache
    const cached = this.filePathCache.get(fileId);
    if (cached && Date.now() - cached.cachedAt < TelegramClient.FILE_PATH_CACHE_TTL_MS) {
      return {
        filePath: cached.filePath,
        fileSize: cached.fileSize,
        fileId: cached.fileId,
        fileUniqueId: cached.fileUniqueId,
        file_path: cached.filePath,
        file_size: cached.fileSize,
      };
    }

    // 2. Fetch from Telegram Bot API
    try {
      const res = await this.request<TelegramFileResponse>("getFile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: fileId }),
        timeoutMs,
      });

      if (!res.ok || !res.result?.file_path) {
        throw new Error(res.description || `Failed to get file path for file_id: ${fileId}`);
      }

      const fileInfo: CachedFileInfo = {
        filePath: res.result.file_path,
        fileSize: res.result.file_size || 0,
        fileId: res.result.file_id,
        fileUniqueId: res.result.file_unique_id,
        cachedAt: Date.now(),
      };

      // 3. Store in cache
      this.filePathCache.set(fileId, fileInfo);

      return {
        filePath: fileInfo.filePath,
        fileSize: fileInfo.fileSize,
        fileId: fileInfo.fileId,
        fileUniqueId: fileInfo.fileUniqueId,
        file_path: fileInfo.filePath,
        file_size: fileInfo.fileSize,
      };
    } catch (err) {
      throw this.sanitizeError(err);
    }
  }

  async downloadFile(filePath: string, timeoutMs = 60000): Promise<Buffer> {
    const cleanPath = filePath.replace(/^\/+/, "");
    const url = `${this.fileBaseUrl}/${cleanPath}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status} downloading file from Telegram`);
      }
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      throw this.sanitizeError(err);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async deleteMessage(channelId: string | number, messageId: number): Promise<boolean> {
    try {
      const res = await this.request<{ ok: boolean; description?: string }>("deleteMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: channelId,
          message_id: messageId,
        }),
      });
      return !!res.ok;
    } catch (err) {
      logger.warn({ channelId, messageId, err: this.sanitizeError(err).message }, "Failed to delete Telegram message");
      return false;
    }
  }

  async getUpdates(): Promise<TelegramUpdatesResponse> {
    return this.request<TelegramUpdatesResponse>("getUpdates");
  }

  // Cache management helpers for testing
  clearFilePathCache(): void {
    this.filePathCache.clear();
  }

  getCachedFilePath(fileId: string): string | null {
    const entry = this.filePathCache.get(fileId);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt >= TelegramClient.FILE_PATH_CACHE_TTL_MS) {
      this.filePathCache.delete(fileId);
      return null;
    }
    return entry.filePath;
  }
}
```

---

## 5. Proposed Concrete Code: `src/lib/upload-session.ts`

```typescript
import crypto from "crypto";
import { PART_SIZE_BYTES } from "./validate";
import { TelegramClient } from "./telegram";
import { logger } from "./logger";

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

export interface UploadSessionData {
  uploadId: string;
  expectedTotalParts: number;
  channelId?: string | number;
  receivedParts: number[];
  uploadedParts: UploadPartMeta[];
  uploadedMessageIds: number[];
  hashStream: crypto.Hash;
  finalSha256?: string;
  totalBytes: number;
  fileName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UploadSessionConfig {
  sessionTtlMs?: number;
  maxPartSizeBytes?: number;
  channelId?: string | number;
}

export interface CompleteUploadMetadata {
  chapterId: string;
  kind: "ncert_pdf" | "ppt" | "ppt_pdf" | "teacher_notes";
  fileName: string;
  sizeBytes: number;
  parentFileId?: string | null;
  teacherName?: string | null;
  mime?: string;
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
      const timer = setTimeout(() => {
        const idx = this.queue.indexOf(resume);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error("Upload session concurrency lock timeout"));
      }, timeoutMs);

      const resume = () => {
        clearTimeout(timer);
        this.isLocked = true;
        resolve(() => this.release());
      };
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

  constructor(
    tgOrConfig?: TelegramClientLike | UploadSessionConfig,
    db?: DatabaseLike,
    sessionTtlMs?: number
  ) {
    if (tgOrConfig && typeof (tgOrConfig as TelegramClientLike).sendDocument === "function") {
      this.defaultTg = tgOrConfig as TelegramClientLike;
      this.defaultDb = db;
      this.sessionTtlMs = sessionTtlMs ?? 30 * 60 * 1000;
      this.maxPartSizeBytes = PART_SIZE_BYTES;
      this.defaultChannelId = process.env.TELEGRAM_CHANNEL_ID || "-1001234567890";
    } else {
      const config = (tgOrConfig as UploadSessionConfig) || {};
      this.sessionTtlMs = config.sessionTtlMs ?? 30 * 60 * 1000;
      this.maxPartSizeBytes = config.maxPartSizeBytes ?? PART_SIZE_BYTES;
      this.defaultChannelId = config.channelId || process.env.TELEGRAM_CHANNEL_ID || "-1001234567890";
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
    channelId?: string | number
  ): UploadSessionData {
    if (!uploadId || typeof uploadId !== "string") {
      throw new Error("Invalid uploadId: non-empty string required");
    }
    if (!Number.isInteger(expectedTotalParts) || expectedTotalParts < 1) {
      throw new Error(`expectedTotalParts must be an integer >= 1 (received ${expectedTotalParts})`);
    }

    const session: UploadSessionData = {
      uploadId,
      expectedTotalParts,
      channelId: channelId || this.defaultChannelId,
      receivedParts: [],
      uploadedParts: [],
      uploadedMessageIds: [],
      hashStream: crypto.createHash("sha256"),
      totalBytes: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.sessions.set(uploadId, session);
    return session;
  }

  getSession(uploadId: string): UploadSessionData | null {
    const session = this.sessions.get(uploadId);
    if (!session) return null;

    if (Date.now() - session.createdAt > this.sessionTtlMs) {
      this.sessions.delete(uploadId);
      this.locks.delete(uploadId);
      return null;
    }
    return session;
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

      const client = options?.tgClient || this.defaultTg;
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
        session.updatedAt = Date.now();

        const partMeta: UploadPartMeta = {
          partNo,
          sizeBytes: buf.length,
          sha256: partSha,
          tgMessageId: messageId,
          tgFileId: fileId,
          tgFileUniqueId: fileUniqueId,
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

    const { fullSha256 } = this.completeSession(uploadId);
    const db = options?.db || this.defaultDb;
    const tgClient = options?.tgClient || this.defaultTg;
    const channel = options?.channelId || session.channelId || this.defaultChannelId;

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
      if (tgClient) {
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
    const client = tgClient || this.defaultTg;
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
    uploadId: string,
    tgClient?: TelegramClientLike
  ): Promise<number[]> {
    const session = this.sessions.get(uploadId);
    if (!session) return [];

    const { deleted } = await this.rollbackTelegramMessages(
      session.uploadedMessageIds,
      tgClient || this.defaultTg,
      session.channelId
    );

    this.sessions.delete(uploadId);
    this.locks.delete(uploadId);
    return deleted;
  }

  cleanupExpiredSessions(options?: {
    rollback?: boolean;
    tgClient?: TelegramClientLike;
  }): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [uploadId, session] of this.sessions.entries()) {
      if (now - session.createdAt > this.sessionTtlMs) {
        if (options?.rollback && session.uploadedMessageIds.length > 0) {
          this.rollbackTelegramMessages(session.uploadedMessageIds, options.tgClient, session.channelId).catch(
            (err) => logger.warn({ uploadId, err }, "Error during cleanup rollback")
          );
        }
        this.sessions.delete(uploadId);
        this.locks.delete(uploadId);
        cleaned++;
      }
    }
    return cleaned;
  }
}

// Global default singleton for application routes
export const uploadSessionManager = new UploadSessionManager();
```

---

## 6. Verification and Test Alignment

### 6.1 `tests/tier1-feature/chunking.test.ts`
All 8 existing tests in `tests/tier1-feature/chunking.test.ts` align directly with our design:
1. `F12.1`: Slices file into parts <= 19 MiB.
2. `F12.2`: Rejects oversized part exceeding 19 MiB with regex `/exceeds maximum chunk size/`.
3. `F13.1`: Incremental stream SHA-256 matches full file hash.
4. `F14.1`: Rejects out-of-order part uploads (`Out of order part: expected 1, received 2`).
5. `F14.2`: Rejects duplicate part upload attempt (`Out of order part: expected 2, received 1`).
6. `F15.1`: Failure on part 3 of 5 deletes parts 1 and 2 and leaves 0 DB rows.
7. `F15.2`: DB insertion failure on `completeUpload` cleans up all Telegram parts.
8. `F15.3`: Expired upload session (> 30 min TTL) rejects new parts with regex `/Upload session expired/`.

### 6.2 Unit Tests (`tests/unit/chunking.test.ts` and `tests/unit/rollback.test.ts`)
The planned unit tests specified by `spec_miner_m3_1` test:
- Pure buffer slicing and reassembly matching byte-exact SHA-256 across exact boundaries: 1 byte, 19 MiB (19922944), 19 MiB + 1, 45 MB, 100 MB.
- Rollback execution verifying `deleteMessage` calls, zero DB rows, and state clearance.
Our modules provide direct drop-in exports for both test suites.

---

## 7. Coordination with Explorer 2 & Implementer

1. **Explorer 2 Interface**:
   - `/api/admin/upload/part/route.ts` imports `uploadSessionManager` from `@/lib/upload-session` and `TelegramClient` from `@/lib/telegram`.
   - On incoming chunk: calls `uploadSessionManager.uploadPart(uploadId, partNo, buffer, fileName, { tgClient, caption })`.
   - `/api/admin/upload/complete/route.ts`: calls `uploadSessionManager.completeSession(uploadId)` to obtain `fullSha256` and the list of uploaded parts. It checks duplicate file in Supabase (`chapter_id` + `sha256`). If conflict, calls `uploadSessionManager.rollbackSession(uploadId, tgClient)` and returns 409. If insertion succeeds, session is removed.
2. **Worker M3 Implementation Steps**:
   - Update `src/lib/telegram.ts` with the new methods, interfaces, and cache.
   - Create `src/lib/upload-session.ts` with the complete engine and singleton.
   - Run `npx vitest run` to ensure all 164 existing tests continue to pass with 0 regressions.
