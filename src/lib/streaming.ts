/**
 * SST Chapter Library — Streaming & HTTP Range Delivery Engine
 *
 * Provides zero-disk-buffering sequential streaming from Telegram storage
 * with full HTTP 206 Range request support for PDF seeking and rapid browsing.
 */

import { FilePart } from "@/types/database";
import { TelegramClient } from "./telegram";
import { logger } from "./logger";

export interface RangeResult {
  start: number;
  end: number;
  contentLength: number;
}

/**
 * Parses HTTP 'Range' request header according to RFC 7233 / RFC 9110.
 *
 * @param rangeHeader Raw 'Range' header string, e.g. "bytes=0-1023", "bytes=500-", "bytes=-500"
 * @param totalSizeBytes Total file size in bytes
 * @returns Parsed range, null if no Range header, or "INVALID" if malformed/unsatisfiable
 */
export function parseRangeHeader(
  rangeHeader: string | null | undefined,
  totalSizeBytes: number
): RangeResult | null | "INVALID" {
  if (!rangeHeader || typeof rangeHeader !== "string") {
    return null;
  }

  const trimmed = rangeHeader.trim();
  if (!trimmed.startsWith("bytes=")) {
    return "INVALID";
  }

  const rangeSpec = trimmed.slice(6).trim();
  // We handle single-part ranges (multi-part multipart/byteranges is not needed for PDF viewing)
  if (rangeSpec.includes(",")) {
    // Pick the first range specification if multiple provided
    const firstSpec = rangeSpec.split(",")[0].trim();
    return parseSingleRange(firstSpec, totalSizeBytes);
  }

  return parseSingleRange(rangeSpec, totalSizeBytes);
}

function parseSingleRange(spec: string, totalSize: number): RangeResult | "INVALID" {
  const dashIndex = spec.indexOf("-");
  if (dashIndex === -1) {
    return "INVALID";
  }

  const startStr = spec.slice(0, dashIndex).trim();
  const endStr = spec.slice(dashIndex + 1).trim();

  let start: number;
  let end: number;

  if (startStr === "" && endStr !== "") {
    // Suffix range: "bytes=-500" (last 500 bytes)
    const suffixLength = parseInt(endStr, 10);
    if (isNaN(suffixLength) || suffixLength <= 0) {
      return "INVALID";
    }
    start = Math.max(0, totalSize - suffixLength);
    end = totalSize - 1;
  } else if (startStr !== "" && endStr === "") {
    // Prefix range: "bytes=500-" (from byte 500 to EOF)
    start = parseInt(startStr, 10);
    if (isNaN(start) || start < 0) {
      return "INVALID";
    }
    end = totalSize - 1;
  } else if (startStr !== "" && endStr !== "") {
    // Explicit range: "bytes=0-1023"
    start = parseInt(startStr, 10);
    end = parseInt(endStr, 10);
    if (isNaN(start) || isNaN(end) || start < 0) {
      return "INVALID";
    }
  } else {
    return "INVALID";
  }

  // Bounds validation
  if (start >= totalSize || start > end || totalSize <= 0) {
    return "INVALID";
  }

  // Clip end to file boundary
  end = Math.min(end, totalSize - 1);
  const contentLength = end - start + 1;

  if (contentLength <= 0) {
    return "INVALID";
  }

  return { start, end, contentLength };
}

export interface StreamPartPlan {
  part: FilePart;
  partOffsetStart: number;
  partOffsetEnd: number;
  sliceStart: number;
  sliceEnd: number;
}

/**
 * Computes which chunk parts intersect the requested byte range,
 * and the exact slice boundaries within each chunk.
 */
export function planPartStreams(
  parts: FilePart[],
  range: { start: number; end: number }
): StreamPartPlan[] {
  const sortedParts = [...parts].sort((a, b) => a.part_no - b.part_no);
  const plans: StreamPartPlan[] = [];

  let currentCumulativeOffset = 0;

  for (const part of sortedParts) {
    const partStart = currentCumulativeOffset;
    const partEnd = currentCumulativeOffset + part.size_bytes - 1;
    currentCumulativeOffset += part.size_bytes;

    // Check if this part overlaps with [range.start, range.end]
    if (partEnd >= range.start && partStart <= range.end) {
      const sliceStart = Math.max(0, range.start - partStart);
      const sliceEnd = Math.min(part.size_bytes, range.end - partStart + 1);

      plans.push({
        part,
        partOffsetStart: partStart,
        partOffsetEnd: partEnd,
        sliceStart,
        sliceEnd,
      });
    }
  }

  return plans;
}

export interface MultiPartStreamOptions {
  parts: FilePart[];
  tgClient: TelegramClient;
  range?: { start: number; end: number };
  totalSizeBytes: number;
  timeoutMs?: number;
}

/**
 * Creates a zero-disk-buffering ReadableStream that fetches parts on the fly
 * from Telegram Bot API and streams chunks directly to the response pipe.
 */
export function createTelegramMultiPartStream(
  options: MultiPartStreamOptions
): ReadableStream<Uint8Array> {
  const { parts, tgClient, totalSizeBytes, timeoutMs = 60000 } = options;

  const effectiveRange = options.range || {
    start: 0,
    end: Math.max(0, totalSizeBytes - 1),
  };

  const plans = planPartStreams(parts, effectiveRange);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const plan of plans) {
          // 1. Resolve Telegram file path (uses in-memory 45m cache)
          const fileInfo = await tgClient.getFile(plan.part.tg_file_id, timeoutMs);

          // 2. Fetch chunk buffer from Telegram
          const chunkBuf = await tgClient.downloadFile(fileInfo.filePath, timeoutMs);

          // 3. Slice only the requested bytes for this part
          const slice = chunkBuf.subarray(plan.sliceStart, plan.sliceEnd);

          // 4. Enqueue into HTTP response stream
          controller.enqueue(new Uint8Array(slice));
        }
        controller.close();
      } catch (err) {
        logger.error({ err }, "Error during multi-part Telegram streaming");
        controller.error(err);
      }
    },
  });
}
