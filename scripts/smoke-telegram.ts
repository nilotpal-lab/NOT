import dotenv from "dotenv";
import path from "path";
import crypto from "crypto";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

const PART_SIZE_BYTES = 19 * 1024 * 1024; // 19922944 bytes (19 MiB)

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
  };
}

interface TelegramFileResult {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

interface TelegramMessageResult {
  message_id: number;
  document?: TelegramFileResult;
}

class SmokeTelegramRunner {
  private token: string;
  private channelId: string;
  private baseUrl: string;
  private fileBaseUrl: string;

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const channelId = process.env.TELEGRAM_CHANNEL_ID;

    if (!token || !channelId) {
      throw new Error(
        "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID in environment or .env.local"
      );
    }

    this.token = token;
    this.channelId = channelId;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
    this.fileBaseUrl = `https://api.telegram.org/file/bot${token}`;
  }

  private sanitize(message: string): string {
    return message.replace(new RegExp(this.token, "g"), "[REDACTED_BOT_TOKEN]");
  }

  async sendDocument(
    buffer: Buffer | Uint8Array,
    fileName: string,
    caption: string,
    timeoutMs = 120000
  ): Promise<{ messageId: number; fileId: string }> {
    const formData = new FormData();
    formData.append("chat_id", this.channelId);
    formData.append(
      "document",
      new Blob([new Uint8Array(buffer)], { type: "application/octet-stream" }),
      fileName
    );
    formData.append("caption", caption);

    try {
      const res = await fetch(`${this.baseUrl}/sendDocument`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const data = (await res.json()) as TelegramResponse<TelegramMessageResult>;
      if (!res.ok || !data.ok || !data.result?.document) {
        throw new Error(
          this.sanitize(
            data.description || `HTTP ${res.status} failed to send document`
          )
        );
      }

      return {
        messageId: data.result.message_id,
        fileId: data.result.document.file_id,
      };
    } catch (err) {
      throw new Error(this.sanitize(err instanceof Error ? err.message : String(err)));
    }
  }

  async getFile(fileId: string, timeoutMs = 30000): Promise<string> {
    try {
      const res = await fetch(`${this.baseUrl}/getFile?file_id=${encodeURIComponent(fileId)}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      const data = (await res.json()) as TelegramResponse<TelegramFileResult>;
      if (!res.ok || !data.ok || !data.result?.file_path) {
        throw new Error(
          this.sanitize(
            data.description || `HTTP ${res.status} failed to call getFile`
          )
        );
      }

      return data.result.file_path;
    } catch (err) {
      throw new Error(this.sanitize(err instanceof Error ? err.message : String(err)));
    }
  }

  async downloadFile(filePath: string, timeoutMs = 120000): Promise<Buffer> {
    try {
      const res = await fetch(`${this.fileBaseUrl}/${filePath}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} failed to download file`);
      }

      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch (err) {
      throw new Error(this.sanitize(err instanceof Error ? err.message : String(err)));
    }
  }

  async deleteMessage(messageId: number, timeoutMs = 15000): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/deleteMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.channelId,
          message_id: messageId,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const data = (await res.json()) as TelegramResponse<boolean>;
      return !!data.ok;
    } catch {
      return false;
    }
  }
}

function createMinimalValidPdf(): Buffer {
  const content = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [] /Count 0 >>
endobj
xref
0 3
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
trailer
<< /Size 3 /Root 1 0 R >>
startxref
115
%%EOF
`;
  return Buffer.from(content, "utf-8");
}

function generateDeterministicBigBuffer(totalBytes: number): Buffer {
  const buf = Buffer.alloc(totalBytes);
  const chunkSize = 1024 * 1024; // 1 MB fill chunks
  let seed = 0x5a;
  for (let offset = 0; offset < totalBytes; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, totalBytes);
    buf.fill(seed++, offset, end);
  }
  return buf;
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function runStandardSmoke(runner: SmokeTelegramRunner) {
  console.log("==> Running Standard Telegram Smoke Test (Single Tiny PDF)...");
  const testPdf = createMinimalValidPdf();
  const originalSha256 = sha256Hex(testPdf);
  console.log(`    Generated valid PDF: ${testPdf.length} bytes, SHA-256: ${originalSha256}`);

  const uploadedMessages: number[] = [];
  try {
    const caption = `title=Smoke Test|class=9|subject=Economics|ch=1|kind=ncert_pdf|name=Smoke-Test_Class9_Economics_Ch01_NCERT.pdf|sha=${originalSha256.slice(0, 8)}|part=1/1`;
    console.log("    Uploading to Telegram channel...");
    const { messageId, fileId } = await runner.sendDocument(
      testPdf,
      "Smoke-Test_Class9_Economics_Ch01_NCERT.pdf",
      caption
    );
    uploadedMessages.push(messageId);
    console.log(`    Uploaded: messageId=${messageId}, fileId=${fileId}`);

    console.log("    Calling getFile...");
    const filePath = await runner.getFile(fileId);
    console.log(`    Obtained filePath: ${filePath}`);

    console.log("    Downloading file back from Telegram...");
    const downloadedBuf = await runner.downloadFile(filePath);
    const downloadedSha256 = sha256Hex(downloadedBuf);
    console.log(`    Downloaded: ${downloadedBuf.length} bytes, SHA-256: ${downloadedSha256}`);

    if (downloadedSha256 !== originalSha256) {
      throw new Error(
        `SHA-256 mismatch! Original: ${originalSha256}, Downloaded: ${downloadedSha256}`
      );
    }
    console.log("    SHA-256 verification succeeded!");

    console.log("    Cleaning up message from channel...");
    const deleted = await runner.deleteMessage(messageId);
    if (!deleted) {
      console.warn(`    Warning: deleteMessage returned false for messageId=${messageId}`);
    } else {
      console.log(`    Message ${messageId} deleted cleanly.`);
    }

    console.log("\nPASS: Standard Telegram smoke test passed with 100% SHA-256 fidelity!\n");
  } catch (err) {
    for (const msgId of uploadedMessages) {
      await runner.deleteMessage(msgId).catch(() => {});
    }
    throw err;
  }
}

async function runBigSmoke(runner: SmokeTelegramRunner) {
  console.log("==> Running Big-File Telegram Smoke Test (~45 MB, 3 parts)...");
  const TOTAL_BYTES = 45 * 1024 * 1024; // 47,185,920 bytes (~45 MiB)
  const partSizes: number[] = [
    PART_SIZE_BYTES, // Part 1: 19 MiB (19922944 bytes)
    PART_SIZE_BYTES, // Part 2: 19 MiB (19922944 bytes)
    TOTAL_BYTES - 2 * PART_SIZE_BYTES, // Part 3: 7,340,032 bytes (~7 MiB)
  ];

  console.log(`    Generating ~45 MB file (${TOTAL_BYTES} bytes)...`);
  const startTime = Date.now();
  const bigBuffer = generateDeterministicBigBuffer(TOTAL_BYTES);
  const originalSha256 = sha256Hex(bigBuffer);
  console.log(`    Generated in ${Date.now() - startTime}ms. Global SHA-256: ${originalSha256}`);
  console.log(
    `    Planned 3 parts: Part 1 (${partSizes[0]} B), Part 2 (${partSizes[1]} B), Part 3 (${partSizes[2]} B)`
  );

  const uploadedMessages: number[] = [];
  const downloadedParts: Buffer[] = [];

  try {
    let offset = 0;
    for (let i = 0; i < partSizes.length; i++) {
      const partNo = i + 1;
      const partSize = partSizes[i];
      const partSlice = bigBuffer.subarray(offset, offset + partSize);
      const partSha = sha256Hex(partSlice);
      offset += partSize;

      const partCaption = `title=Big Smoke Test|class=10|subject=History|ch=1|kind=ncert_pdf|name=Big-Smoke_Class10_History_Ch01_NCERT.pdf|sha=${partSha.slice(0, 8)}|part=${partNo}/3`;
      console.log(
        `    Uploading Part ${partNo}/3 (${partSize} bytes, sha=${partSha.slice(0, 8)})...`
      );

      const { messageId, fileId } = await runner.sendDocument(
        partSlice,
        `Big-Smoke_Class10_History_Ch01_NCERT.pdf.part${partNo}`,
        partCaption
      );
      uploadedMessages.push(messageId);
      console.log(`    Part ${partNo} uploaded: messageId=${messageId}`);

      console.log(`    Part ${partNo}: resolving getFile...`);
      const filePath = await runner.getFile(fileId);

      console.log(`    Part ${partNo}: downloading back...`);
      const downloadedPart = await runner.downloadFile(filePath);
      const downloadedPartSha = sha256Hex(downloadedPart);

      if (downloadedPartSha !== partSha) {
        throw new Error(
          `Part ${partNo} SHA-256 mismatch! Expected ${partSha}, Got ${downloadedPartSha}`
        );
      }
      downloadedParts.push(downloadedPart);
      console.log(`    Part ${partNo} verified successfully!`);
    }

    console.log("    Reassembling all 3 parts into original buffer...");
    const assembledBuf = Buffer.concat(downloadedParts);
    console.log(`    Reassembled size: ${assembledBuf.length} bytes`);

    if (assembledBuf.length !== TOTAL_BYTES) {
      throw new Error(`Assembled length mismatch: expected ${TOTAL_BYTES}, got ${assembledBuf.length}`);
    }

    const assembledSha256 = sha256Hex(assembledBuf);
    console.log(`    Reassembled SHA-256: ${assembledSha256}`);
    if (assembledSha256 !== originalSha256) {
      throw new Error(
        `Global SHA-256 mismatch! Original: ${originalSha256}, Assembled: ${assembledSha256}`
      );
    }
    console.log("    Global SHA-256 matches original file 100%!");

    console.log("    Cleaning up all 3 Telegram messages from storage channel...");
    for (const msgId of uploadedMessages) {
      await runner.deleteMessage(msgId);
      console.log(`    Deleted messageId ${msgId}`);
    }

    console.log("\nPASS: Big-file (~45 MB, 3 parts) Telegram smoke test passed!\n");
  } catch (err) {
    console.error("    Error occurred during big smoke test. Cleaning up sent messages...");
    for (const msgId of uploadedMessages) {
      await runner.deleteMessage(msgId).catch(() => {});
    }
    throw err;
  }
}

async function main() {
  const isBig = process.argv.includes("--big");
  try {
    const runner = new SmokeTelegramRunner();
    if (isBig) {
      await runBigSmoke(runner);
    } else {
      await runStandardSmoke(runner);
    }
    process.exit(0);
  } catch (err) {
    console.error("\nFAIL: Telegram Smoke Test failed:");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
