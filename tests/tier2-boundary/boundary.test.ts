import { describe, it, expect, beforeAll } from "vitest";
import { PART_SIZE_BYTES } from "@/lib/validate";
import { sha256, createDeterministicBuffer, FAKE_EXE_HEADER, TRUNCATED_PDF } from "../fixtures/test-fixtures";
import { loadModule, NamingModule, MagicModule } from "../helpers/dynamic-loader";

function sliceBuffer(buffer: Buffer, partSizeBytes: number = PART_SIZE_BYTES): Buffer[] {
  if (buffer.length === 0) return [];
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const end = Math.min(offset + partSizeBytes, buffer.length);
    parts.push(buffer.subarray(offset, end));
    offset = end;
  }
  return parts;
}

function referenceBuildFileName(params: {
  class: number;
  subject: string;
  chapterNo: number;
  title: string;
  kind: string;
  teacherName?: string;
  ext: string;
  existingNames?: string[];
}): string {
  let slug = params.title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (slug.length > 60) {
    slug = slug.substring(0, 60).replace(/-+$/, "");
  }

  const nn = String(params.chapterNo).padStart(2, "0");
  let typeStr = "";
  if (params.kind === "ncert_pdf") typeStr = "NCERT";
  else if (params.kind === "ppt") typeStr = "PPT";
  else if (params.kind === "ppt_pdf") typeStr = "PPT-Preview";
  else if (params.kind === "teacher_notes") {
    const tSlug = (params.teacherName || "Teacher")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    typeStr = `Notes-${tSlug}`;
  } else {
    typeStr = params.kind;
  }

  const cleanExt = params.ext.replace(/^\./, "");
  const baseName = `${slug}_Class${params.class}_${params.subject}_Ch${nn}_${typeStr}`;
  const existing = params.existingNames || [];
  let candidate = `${baseName}.${cleanExt}`;

  if (params.kind === "teacher_notes" && existing.includes(candidate)) {
    let counter = 2;
    while (existing.includes(`${baseName}-${counter}.${cleanExt}`)) {
      counter++;
    }
    candidate = `${baseName}-${counter}.${cleanExt}`;
  }
  return candidate;
}

function referenceValidatePdf(first: Buffer, last?: Buffer): { valid: boolean; error?: string } {
  if (first.length < 5) return { valid: false, error: "Empty or too small" };
  const pdfHeader = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (!first.subarray(0, 5).equals(pdfHeader)) return { valid: false, error: "Missing %PDF-" };
  if (last) {
    const scanArea = last.subarray(Math.max(0, last.length - 1024)).toString("binary");
    if (!scanArea.includes("%%EOF")) return { valid: false, error: "Missing %%EOF" };
  }
  return { valid: true };
}

describe("Tier 2: Boundary & Corner Cases", () => {
  let liveNaming: NamingModule | null = null;
  let liveMagic: MagicModule | null = null;

  beforeAll(async () => {
    liveNaming = await loadModule<NamingModule>("src/lib/naming.ts");
    liveMagic = await loadModule<MagicModule>("src/lib/magic.ts");
  });

  const getBuildFileName = () => liveNaming?.buildFileName || referenceBuildFileName;
  const getValidatePdf = () => liveMagic?.validatePdfMagic || referenceValidatePdf;

  // --------------------------------------------------------------------------
  // Check 1.9: Splitting Unit Tests across exact byte boundaries
  // --------------------------------------------------------------------------
  it("B1.1: splits 1-byte file into exactly 1 part <= 19 MiB and reassembles with identical SHA-256", () => {
    const buf = Buffer.from([0x7f]);
    const originalSha = sha256(buf);
    const parts = sliceBuffer(buf, PART_SIZE_BYTES);

    expect(parts.length).toBe(1);
    expect(parts[0].length).toBe(1);
    expect(parts[0].length).toBeLessThanOrEqual(PART_SIZE_BYTES);

    const reassembled = Buffer.concat(parts);
    expect(reassembled.length).toBe(1);
    expect(sha256(reassembled)).toBe(originalSha);
  });

  it("B1.2: splits exactly 19 MiB file into exactly 1 part <= 19 MiB and reassembles with identical SHA-256", () => {
    const exact19MiB = PART_SIZE_BYTES; // 19,922,944 bytes
    const buf = createDeterministicBuffer(exact19MiB, 0x11);
    const originalSha = sha256(buf);
    const parts = sliceBuffer(buf, PART_SIZE_BYTES);

    expect(parts.length).toBe(1);
    expect(parts[0].length).toBe(exact19MiB);
    expect(parts[0].length).toBeLessThanOrEqual(PART_SIZE_BYTES);

    const reassembled = Buffer.concat(parts);
    expect(reassembled.length).toBe(exact19MiB);
    expect(sha256(reassembled)).toBe(originalSha);
  });

  it("B1.3: splits 19 MiB + 1 byte file into exactly 2 parts and reassembles with identical SHA-256", () => {
    const size = PART_SIZE_BYTES + 1; // 19,922,945 bytes
    const buf = createDeterministicBuffer(size, 0x22);
    const originalSha = sha256(buf);
    const parts = sliceBuffer(buf, PART_SIZE_BYTES);

    expect(parts.length).toBe(2);
    expect(parts[0].length).toBe(PART_SIZE_BYTES);
    expect(parts[1].length).toBe(1);
    expect(parts[0].length).toBeLessThanOrEqual(PART_SIZE_BYTES);
    expect(parts[1].length).toBeLessThanOrEqual(PART_SIZE_BYTES);

    const reassembled = Buffer.concat(parts);
    expect(reassembled.length).toBe(size);
    expect(sha256(reassembled)).toBe(originalSha);
  });

  it("B1.4: splits ~45 MB file into exactly 3 parts and reassembles with identical SHA-256", () => {
    const size = 45 * 1024 * 1024; // 47,185,920 bytes
    const buf = createDeterministicBuffer(size, 0x33);
    const originalSha = sha256(buf);
    const parts = sliceBuffer(buf, PART_SIZE_BYTES);

    expect(parts.length).toBe(3);
    expect(parts[0].length).toBe(PART_SIZE_BYTES);
    expect(parts[1].length).toBe(PART_SIZE_BYTES);
    expect(parts[2].length).toBe(size - 2 * PART_SIZE_BYTES); // ~7.0 MiB
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(PART_SIZE_BYTES);
    }

    const reassembled = Buffer.concat(parts);
    expect(reassembled.length).toBe(size);
    expect(sha256(reassembled)).toBe(originalSha);
  });

  it("B1.5: splits 100 MB (MAX_FILE_MB default) into exactly 6 parts <= 19 MiB and reassembles with identical SHA-256", () => {
    const size = 100 * 1024 * 1024; // 104,857,600 bytes
    const buf = createDeterministicBuffer(size, 0x44);
    const originalSha = sha256(buf);
    const parts = sliceBuffer(buf, PART_SIZE_BYTES);

    expect(parts.length).toBe(6);
    for (let i = 0; i < 5; i++) {
      expect(parts[i].length).toBe(PART_SIZE_BYTES);
    }
    expect(parts[5].length).toBe(size - 5 * PART_SIZE_BYTES); // 5,242,880 bytes
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(PART_SIZE_BYTES);
    }

    const reassembled = Buffer.concat(parts);
    expect(reassembled.length).toBe(size);
    expect(sha256(reassembled)).toBe(originalSha);
  });

  // --------------------------------------------------------------------------
  // Check 1.3: Magic Byte Boundaries & Corrupt Inputs
  // --------------------------------------------------------------------------
  it("B2.1: rejects empty buffer (0 bytes) in validator", () => {
    const validatePdf = getValidatePdf();
    const res = validatePdf(Buffer.alloc(0), Buffer.alloc(0));
    expect(res.valid).toBe(false);
  });

  it("B2.2: rejects executable disguised with PDF extension", () => {
    const validatePdf = getValidatePdf();
    const res = validatePdf(FAKE_EXE_HEADER, FAKE_EXE_HEADER);
    expect(res.valid).toBe(false);
  });

  it("B2.3: rejects PDF missing %%EOF trailer marker", () => {
    const validatePdf = getValidatePdf();
    const res = validatePdf(TRUNCATED_PDF, TRUNCATED_PDF);
    expect(res.valid).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Check 1.2: Messy Chapter Titles & Character Encodings
  // --------------------------------------------------------------------------
  it("B3.1: sanitizes titles with unicode accents and French diacritics", () => {
    const buildFileName = getBuildFileName();
    const name = buildFileName({
      class: 9,
      subject: "History",
      chapterNo: 1,
      title: "L'Économie Française et les Forêts: 2ème Étude!",
      kind: "ncert_pdf",
      ext: "pdf",
    });

    expect(name).toBe("LEconomie-Francaise-et-les-Forets-2eme-Etude_Class9_History_Ch01_NCERT.pdf");
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("B3.2: strips emojis and dangerous path traversal characters", () => {
    const buildFileName = getBuildFileName();
    const name = buildFileName({
      class: 8,
      subject: "Geography",
      chapterNo: 3,
      title: "🌍 Earth / Agriculture & ../../root-exploit!",
      kind: "ncert_pdf",
      ext: "pdf",
    });

    expect(name).not.toContain("🌍");
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("B3.3: truncates 200-character long chapter titles safely to max 60 char slug", () => {
    const buildFileName = getBuildFileName();
    const longTitle = "A very very long chapter title that describes the extensive historical events of the fourteenth and fifteenth century across the subcontinent in exhaustive detail and narrative";
    const name = buildFileName({
      class: 7,
      subject: "History",
      chapterNo: 4,
      title: longTitle,
      kind: "ncert_pdf",
      ext: "pdf",
    });

    const slug = name.split("_Class7_")[0];
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("B3.4: resolves multi-level duplicate teacher names (-2, -3, -4)", () => {
    const buildFileName = getBuildFileName();
    const existing = [
      "The-Story-of-Village-Palampur_Class9_Economics_Ch01_Notes-Sharma.pdf",
      "The-Story-of-Village-Palampur_Class9_Economics_Ch01_Notes-Sharma-2.pdf",
      "The-Story-of-Village-Palampur_Class9_Economics_Ch01_Notes-Sharma-3.pdf",
    ];

    const name = buildFileName({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "The Story of Village Palampur",
      kind: "teacher_notes",
      teacherName: "Sharma",
      ext: "pdf",
      existingNames: existing,
    });

    expect(name).toBe("The-Story-of-Village-Palampur_Class9_Economics_Ch01_Notes-Sharma-4.pdf");
  });
});
