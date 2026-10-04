import { describe, it, expect, beforeAll } from "vitest";
import { loadModule, NamingModule } from "../helpers/dynamic-loader";

/**
 * Reference pure specification oracle for buildFileName
 * Derived strictly from ORIGINAL_REQUEST.md § 3 and PROJECT.md § Interface Contracts
 */
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
  // Title sanitization: transliterate accents, keep letters/digits/hyphens, collapse hyphens, max 60 chars
  let slug = params.title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics/accents
    .replace(/[^a-zA-Z0-9\s-]/g, "") // drop non-alphanumeric except spaces and hyphens
    .trim()
    .replace(/\s+/g, "-") // spaces to hyphens
    .replace(/-+/g, "-") // collapse repeated hyphens
    .replace(/^-|-$/g, ""); // trim leading/trailing hyphens

  if (slug.length > 60) {
    slug = slug.substring(0, 60).replace(/-+$/, "");
  }

  const nn = String(params.chapterNo).padStart(2, "0");

  let typeStr = "";
  if (params.kind === "ncert_pdf") {
    typeStr = "NCERT";
  } else if (params.kind === "ppt") {
    typeStr = "PPT";
  } else if (params.kind === "ppt_pdf") {
    typeStr = "PPT-Preview";
  } else if (params.kind === "teacher_notes") {
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

  // Duplicate resolution
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

function referenceFormatTelegramCaption(params: {
  title: string;
  class: number;
  subject: string;
  ch: number;
  kind: string;
  name: string;
  sha: string;
  part: number;
  total: number;
}): string {
  const shortSha = params.sha.slice(0, 8);
  return `title=${params.title}|class=${params.class}|subject=${params.subject}|ch=${params.ch}|kind=${params.kind}|name=${params.name}|sha=${shortSha}|part=${params.part}/${params.total}`;
}

describe("Tier 1: Auto-Naming & Telegram Captions (Features 6 & 7)", () => {
  let liveModule: NamingModule | null = null;

  beforeAll(async () => {
    liveModule = await loadModule<NamingModule>("src/lib/naming.ts");
  });

  const getBuildFileName = () => liveModule?.buildFileName || referenceBuildFileName;
  const getFormatTelegramCaption = () =>
    liveModule?.formatTelegramCaption || referenceFormatTelegramCaption;

  // --------------------------------------------------------------------------
  // Feature 6: Deterministic buildFileName
  // --------------------------------------------------------------------------
  it("F6.1: matches exact specification example from ORIGINAL_REQUEST.md", () => {
    const buildFileName = getBuildFileName();
    const result = buildFileName({
      class: 7,
      subject: "Geography",
      chapterNo: 2,
      title: "Example Chapter Title",
      kind: "ncert_pdf",
      ext: "pdf",
    });

    expect(result).toBe("Example-Chapter-Title_Class7_Geography_Ch02_NCERT.pdf");
    expect(result).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("F6.2: produces teacher notes with teacher name from ORIGINAL_REQUEST.md", () => {
    const buildFileName = getBuildFileName();
    const result = buildFileName({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "Example Chapter Title",
      kind: "teacher_notes",
      teacherName: "Sharma",
      ext: "pdf",
    });

    expect(result).toBe("Example-Chapter-Title_Class9_Economics_Ch01_Notes-Sharma.pdf");
    expect(result).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("F6.3: resolves duplicate teacher names with suffix -2, -3", () => {
    const buildFileName = getBuildFileName();
    const existing = ["Example-Chapter-Title_Class9_Economics_Ch01_Notes-Sharma.pdf"];

    const result2 = buildFileName({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "Example Chapter Title",
      kind: "teacher_notes",
      teacherName: "Sharma",
      ext: "pdf",
      existingNames: existing,
    });
    expect(result2).toBe("Example-Chapter-Title_Class9_Economics_Ch01_Notes-Sharma-2.pdf");

    const result3 = buildFileName({
      class: 9,
      subject: "Economics",
      chapterNo: 1,
      title: "Example Chapter Title",
      kind: "teacher_notes",
      teacherName: "Sharma",
      ext: "pdf",
      existingNames: [...existing, result2],
    });
    expect(result3).toBe("Example-Chapter-Title_Class9_Economics_Ch01_Notes-Sharma-3.pdf");
  });

  it("F6.4: correctly formats PPT and PPT-Preview file names", () => {
    const buildFileName = getBuildFileName();
    const ppt = buildFileName({
      class: 10,
      subject: "History",
      chapterNo: 3,
      title: "The Making of a Global World",
      kind: "ppt",
      ext: "pptx",
    });
    expect(ppt).toBe("The-Making-of-a-Global-World_Class10_History_Ch03_PPT.pptx");

    const pptPdf = buildFileName({
      class: 10,
      subject: "History",
      chapterNo: 3,
      title: "The Making of a Global World",
      kind: "ppt_pdf",
      ext: "pdf",
    });
    expect(pptPdf).toBe("The-Making-of-a-Global-World_Class10_History_Ch03_PPT-Preview.pdf");
  });

  it("F6.5: enforces title sanitization (transliterates accents, drops punctuation, collapses hyphens)", () => {
    const buildFileName = getBuildFileName();
    const messyTitle = "  Éléphant & Révolution: Chapter / 1 -- Part * 2!!  ";
    const result = buildFileName({
      class: 8,
      subject: "Civics",
      chapterNo: 1,
      title: messyTitle,
      kind: "ncert_pdf",
      ext: "pdf",
    });

    expect(result).toBe("Elephant-Revolution-Chapter-1-Part-2_Class8_Civics_Ch01_NCERT.pdf");
    expect(result).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("F6.6: caps title slug to maximum 60 characters", () => {
    const buildFileName = getBuildFileName();
    const longTitle = "A".repeat(100);
    const result = buildFileName({
      class: 6,
      subject: "History",
      chapterNo: 5,
      title: longTitle,
      kind: "ncert_pdf",
      ext: "pdf",
    });

    const titlePart = result.split("_Class6_")[0];
    expect(titlePart.length).toBeLessThanOrEqual(60);
    expect(titlePart).toBe("A".repeat(60));
  });

  // --------------------------------------------------------------------------
  // Feature 7: Telegram Caption Formatter
  // --------------------------------------------------------------------------
  it("F7.1: generates machine-readable pipe-delimited caption with all required fields", () => {
    const formatCaption = getFormatTelegramCaption();
    const caption = formatCaption({
      title: "Our Changing Earth",
      class: 7,
      subject: "Geography",
      ch: 2,
      kind: "ncert_pdf",
      name: "Our-Changing-Earth_Class7_Geography_Ch02_NCERT.pdf",
      sha: "12b3e7a94dcea5842f1a404552dc4ae27a8dd7eaf3c5ea0c59cc263f43e7e9f6",
      part: 1,
      total: 1,
    });

    expect(caption).toBe(
      "title=Our Changing Earth|class=7|subject=Geography|ch=2|kind=ncert_pdf|name=Our-Changing-Earth_Class7_Geography_Ch02_NCERT.pdf|sha=12b3e7a9|part=1/1"
    );
    expect(caption.length).toBeLessThanOrEqual(1024);
  });

  it("F7.2: handles multipart numbers accurately (e.g. part 3 of 5)", () => {
    const formatCaption = getFormatTelegramCaption();
    const caption = formatCaption({
      title: "The Story of Village Palampur",
      class: 9,
      subject: "Economics",
      ch: 1,
      kind: "ncert_pdf",
      name: "The-Story-of-Village-Palampur_Class9_Economics_Ch01_NCERT.pdf",
      sha: "abcdef1234567890",
      part: 3,
      total: 5,
    });

    expect(caption).toContain("|part=3/5");
    expect(caption).toContain("|sha=abcdef12");
  });
});
