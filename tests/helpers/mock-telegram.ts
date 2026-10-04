import crypto from "crypto";

export interface MockSentMessage {
  messageId: number;
  channelId: string | number;
  fileName: string;
  caption?: string;
  fileId: string;
  fileUniqueId: string;
  sizeBytes: number;
  buffer: Buffer;
  sha256: string;
}

export class MockTelegramClient {
  public sentMessages: MockSentMessage[] = [];
  public deletedMessageIds: number[] = [];
  public failOnPartNumber: number | null = null;
  public failOnDbInsert = false;
  private nextMessageId = 1000;

  reset() {
    this.sentMessages = [];
    this.deletedMessageIds = [];
    this.failOnPartNumber = null;
    this.failOnDbInsert = false;
    this.nextMessageId = 1000;
  }

  async sendDocument(
    channelId: string | number,
    fileBuffer: Buffer | Uint8Array,
    fileName: string,
    caption?: string
  ): Promise<{ messageId: number; fileId: string; fileUniqueId: string }> {
    const buf = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer);

    // Extract part number from caption or filename if present to simulate mid-stream failure
    const partMatch = caption?.match(/part=(\d+)\/(\d+)/);
    const currentPartNo = partMatch ? parseInt(partMatch[1], 10) : 1;

    if (this.failOnPartNumber !== null && currentPartNo === this.failOnPartNumber) {
      throw new Error(`Telegram network error simulated on part ${currentPartNo}`);
    }

    const messageId = ++this.nextMessageId;
    const fileId = `tg_file_${messageId}_${crypto.randomBytes(4).toString("hex")}`;
    const fileUniqueId = `tg_uniq_${messageId}`;
    const fileSha256 = crypto.createHash("sha256").update(buf).digest("hex");

    const messageRecord: MockSentMessage = {
      messageId,
      channelId,
      fileName,
      caption,
      fileId,
      fileUniqueId,
      sizeBytes: buf.length,
      buffer: buf,
      sha256: fileSha256,
    };

    this.sentMessages.push(messageRecord);

    return {
      messageId,
      fileId,
      fileUniqueId,
    };
  }

  async getFile(fileId: string): Promise<{ filePath: string; fileSize: number }> {
    const found = this.sentMessages.find((m) => m.fileId === fileId);
    if (!found) {
      throw new Error(`Telegram error: file_id ${fileId} not found`);
    }
    return {
      filePath: `documents/${fileId}.dat`,
      fileSize: found.sizeBytes,
    };
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const fileId = filePath.replace("documents/", "").replace(".dat", "");
    const found = this.sentMessages.find((m) => m.fileId === fileId);
    if (!found) {
      throw new Error(`Telegram download error: file not found for path ${filePath}`);
    }
    return found.buffer;
  }

  async deleteMessage(channelId: string | number, messageId: number): Promise<boolean> {
    this.deletedMessageIds.push(messageId);
    this.sentMessages = this.sentMessages.filter((m) => m.messageId !== messageId);
    return true;
  }
}
