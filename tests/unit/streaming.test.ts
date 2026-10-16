import { describe, it, expect, vi } from "vitest";
import {
  parseRangeHeader,
  planPartStreams,
  createTelegramMultiPartStream,
} from "@/lib/streaming";
import { FilePart } from "@/types/database";
import { TelegramClient } from "@/lib/telegram";

describe("Phase 2: Streaming & HTTP Range Delivery (tests/unit/streaming.test.ts)", () => {
  describe("parseRangeHeader", () => {
    const totalSize = 1000;

    it("returns null if header is null, undefined, or empty", () => {
      expect(parseRangeHeader(null, totalSize)).toBeNull();
      expect(parseRangeHeader(undefined, totalSize)).toBeNull();
      expect(parseRangeHeader("", totalSize)).toBeNull();
    });

    it("returns INVALID if header does not start with bytes=", () => {
      expect(parseRangeHeader("chars=0-100", totalSize)).toBe("INVALID");
      expect(parseRangeHeader("100-200", totalSize)).toBe("INVALID");
    });

    it("parses standard explicit range (bytes=0-499)", () => {
      const res = parseRangeHeader("bytes=0-499", totalSize);
      expect(res).toEqual({
        start: 0,
        end: 499,
        contentLength: 500,
      });
    });

    it("parses open-ended prefix range (bytes=500-)", () => {
      const res = parseRangeHeader("bytes=500-", totalSize);
      expect(res).toEqual({
        start: 500,
        end: 999,
        contentLength: 500,
      });
    });

    it("parses suffix range (bytes=-200)", () => {
      const res = parseRangeHeader("bytes=-200", totalSize);
      expect(res).toEqual({
        start: 800,
        end: 999,
        contentLength: 200,
      });
    });

    it("clips end to totalSize - 1 when end exceeds totalSize", () => {
      const res = parseRangeHeader("bytes=800-2000", totalSize);
      expect(res).toEqual({
        start: 800,
        end: 999,
        contentLength: 200,
      });
    });

    it("takes the first range if multiple comma-separated ranges are provided", () => {
      const res = parseRangeHeader("bytes=0-50, 100-200", totalSize);
      expect(res).toEqual({
        start: 0,
        end: 50,
        contentLength: 51,
      });
    });

    it("returns INVALID when start >= totalSize", () => {
      expect(parseRangeHeader("bytes=1000-1200", totalSize)).toBe("INVALID");
      expect(parseRangeHeader("bytes=1050-", totalSize)).toBe("INVALID");
    });

    it("returns INVALID when start > end", () => {
      expect(parseRangeHeader("bytes=500-400", totalSize)).toBe("INVALID");
    });

    it("returns INVALID on malformed range values", () => {
      expect(parseRangeHeader("bytes=abc-def", totalSize)).toBe("INVALID");
      expect(parseRangeHeader("bytes=-", totalSize)).toBe("INVALID");
      expect(parseRangeHeader("bytes=-0", totalSize)).toBe("INVALID");
      expect(parseRangeHeader("bytes=--10", totalSize)).toBe("INVALID");
    });

    it("returns INVALID if totalSize <= 0", () => {
      expect(parseRangeHeader("bytes=0-10", 0)).toBe("INVALID");
      expect(parseRangeHeader("bytes=0-10", -50)).toBe("INVALID");
    });
  });

  describe("planPartStreams", () => {
    const mockParts: FilePart[] = [
      {
        tg_file_unique_id: "uniq-part-2",
        file_id: "file-1",
        part_no: 2,
        tg_file_id: "tg-file-2",
        tg_message_id: 102,
        size_bytes: 300,
        sha256: "sha2",
      },
      {
        tg_file_unique_id: "uniq-part-1",
        file_id: "file-1",
        part_no: 1,
        tg_file_id: "tg-file-1",
        tg_message_id: 101,
        size_bytes: 200,
        sha256: "sha1",
      },
      {
        tg_file_unique_id: "uniq-part-3",
        file_id: "file-1",
        part_no: 3,
        tg_file_id: "tg-file-3",
        tg_message_id: 103,
        size_bytes: 500,
        sha256: "sha3",
      },
    ];
    // Total size = 200 + 300 + 500 = 1000 bytes
    // Part 1: [0, 199]
    // Part 2: [200, 499]
    // Part 3: [500, 999]

    it("sorts unsorted parts by part_no automatically", () => {
      const plan = planPartStreams(mockParts, { start: 0, end: 999 });
      expect(plan.length).toBe(3);
      expect(plan[0].part.part_no).toBe(1);
      expect(plan[1].part.part_no).toBe(2);
      expect(plan[2].part.part_no).toBe(3);
    });

    it("plans a slice wholly contained within part 1", () => {
      const plan = planPartStreams(mockParts, { start: 50, end: 150 });
      expect(plan.length).toBe(1);
      expect(plan[0].part.part_no).toBe(1);
      expect(plan[0].sliceStart).toBe(50);
      expect(plan[0].sliceEnd).toBe(151); // slice end is non-inclusive boundary for subarray
    });

    it("plans a slice wholly contained within part 2", () => {
      const plan = planPartStreams(mockParts, { start: 250, end: 350 });
      expect(plan.length).toBe(1);
      expect(plan[0].part.part_no).toBe(2);
      expect(plan[0].sliceStart).toBe(50); // 250 - 200 = 50
      expect(plan[0].sliceEnd).toBe(151);  // 350 - 200 + 1 = 151
    });

    it("plans a slice spanning across part 1 and part 2", () => {
      const plan = planPartStreams(mockParts, { start: 100, end: 299 });
      expect(plan.length).toBe(2);

      // Part 1
      expect(plan[0].part.part_no).toBe(1);
      expect(plan[0].sliceStart).toBe(100);
      expect(plan[0].sliceEnd).toBe(200); // 100 bytes from part 1

      // Part 2
      expect(plan[1].part.part_no).toBe(2);
      expect(plan[1].sliceStart).toBe(0);
      expect(plan[1].sliceEnd).toBe(100); // 100 bytes from part 2
    });

    it("plans a slice spanning across all 3 parts", () => {
      const plan = planPartStreams(mockParts, { start: 150, end: 600 });
      expect(plan.length).toBe(3);

      // Part 1: [150, 199] -> length 50
      expect(plan[0].part.part_no).toBe(1);
      expect(plan[0].sliceStart).toBe(150);
      expect(plan[0].sliceEnd).toBe(200);

      // Part 2: full part [0, 300] -> length 300
      expect(plan[1].part.part_no).toBe(2);
      expect(plan[1].sliceStart).toBe(0);
      expect(plan[1].sliceEnd).toBe(300);

      // Part 3: [0, 101] -> length 101 (from 500 to 600)
      expect(plan[2].part.part_no).toBe(3);
      expect(plan[2].sliceStart).toBe(0);
      expect(plan[2].sliceEnd).toBe(101);
    });
  });

  describe("createTelegramMultiPartStream", () => {
    it("fetches, slices, and streams parts through ReadableStream", async () => {
      const buf1 = Buffer.from("Hello, ");
      const buf2 = Buffer.from("world of ");
      const buf3 = Buffer.from("Next.js streaming!");

      const mockParts: FilePart[] = [
        {
          tg_file_unique_id: "uniq-p1",
          file_id: "f1",
          part_no: 1,
          tg_file_id: "tg1",
          tg_message_id: 1,
          size_bytes: buf1.length,
          sha256: "s1",
        },
        {
          tg_file_unique_id: "uniq-p2",
          file_id: "f1",
          part_no: 2,
          tg_file_id: "tg2",
          tg_message_id: 2,
          size_bytes: buf2.length,
          sha256: "s2",
        },
        {
          tg_file_unique_id: "uniq-p3",
          file_id: "f1",
          part_no: 3,
          tg_file_id: "tg3",
          tg_message_id: 3,
          size_bytes: buf3.length,
          sha256: "s3",
        },
      ];

      const totalSize = buf1.length + buf2.length + buf3.length;

      const mockTgClient = {
        getFile: vi.fn(async (fileId: string) => ({
          filePath: `path/${fileId}`,
        })),
        downloadFile: vi.fn(async (path: string) => {
          if (path === "path/tg1") return buf1;
          if (path === "path/tg2") return buf2;
          if (path === "path/tg3") return buf3;
          throw new Error("Unknown path");
        }),
      } as unknown as TelegramClient;

      const stream = createTelegramMultiPartStream({
        parts: mockParts,
        tgClient: mockTgClient,
        totalSizeBytes: totalSize,
      });

      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }

      const combined = Buffer.concat(chunks).toString("utf-8");
      expect(combined).toBe("Hello, world of Next.js streaming!");
      expect(mockTgClient.getFile).toHaveBeenCalledTimes(3);
      expect(mockTgClient.downloadFile).toHaveBeenCalledTimes(3);
    });

    it("streams exact byte slices when range is specified", async () => {
      const fullText = "0123456789abcdefghij"; // 20 bytes
      const buf1 = Buffer.from(fullText.slice(0, 10)); // "0123456789"
      const buf2 = Buffer.from(fullText.slice(10));    // "abcdefghij"

      const mockParts: FilePart[] = [
        {
          tg_file_unique_id: "uniq-p1",
          file_id: "f1",
          part_no: 1,
          tg_file_id: "tg1",
          tg_message_id: 1,
          size_bytes: 10,
          sha256: "s1",
        },
        {
          tg_file_unique_id: "uniq-p2",
          file_id: "f1",
          part_no: 2,
          tg_file_id: "tg2",
          tg_message_id: 2,
          size_bytes: 10,
          sha256: "s2",
        },
      ];

      const mockTgClient = {
        getFile: vi.fn(async (fileId: string) => ({ filePath: `path/${fileId}` })),
        downloadFile: vi.fn(async (path: string) => {
          if (path === "path/tg1") return buf1;
          if (path === "path/tg2") return buf2;
          throw new Error("Unknown path");
        }),
      } as unknown as TelegramClient;

      // Request range 5 to 14: "56789abcde"
      const stream = createTelegramMultiPartStream({
        parts: mockParts,
        tgClient: mockTgClient,
        totalSizeBytes: 20,
        range: { start: 5, end: 14 },
      });

      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }

      const result = Buffer.concat(chunks).toString("utf-8");
      expect(result).toBe("56789abcde");
    });
  });
});
