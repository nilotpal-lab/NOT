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
  };
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
  };
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

export class TelegramClient {
  private token: string;
  private baseUrl: string;

  constructor(token: string) {
    if (!token) {
      throw new Error("TelegramClient requires a bot token");
    }
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  private sanitizeError(err: unknown): Error {
    const message = err instanceof Error ? err.message : String(err);
    // Ensure the token is NEVER leaked in any error message
    const sanitized = message.replace(new RegExp(this.token, "g"), "[REDACTED_BOT_TOKEN]");
    return new Error(sanitized);
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/${endpoint}`;
    const timeoutMs = 15000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      if (response.status === 429) {
        const data = (await response.json().catch(() => ({}))) as TelegramMessageResponse;
        const retryAfter = data.parameters?.retry_after || 5;
        logger.warn({ retryAfter }, "Telegram API rate-limited (429)");
        throw new Error(`Telegram rate limited, retry after ${retryAfter}s`);
      }

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as TelegramMessageResponse;
        throw new Error(data.description || `HTTP error ${response.status}`);
      }

      return (await response.json()) as T;
    } catch (err) {
      throw this.sanitizeError(err);
    } finally {
      clearTimeout(timeoutId);
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

  async deleteMessage(channelId: string | number, messageId: number): Promise<boolean> {
    const res = await this.request<{ ok: boolean; description?: string }>("deleteMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: channelId,
        message_id: messageId,
      }),
    });
    return !!res.ok;
  }

  async getUpdates(): Promise<TelegramUpdatesResponse> {
    return this.request<TelegramUpdatesResponse>("getUpdates");
  }
}
