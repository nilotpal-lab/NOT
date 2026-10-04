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

export interface TelegramSendDocumentResult {
  messageId: number;
  fileId: string;
  fileUniqueId: string;
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
  ): Promise<TelegramSendDocumentResult> {
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

  // Cache management helpers for testing & cache clearing
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
