import { describe, it, expect } from "vitest";
import {
  buildFileName,
  formatTelegramCaption,
  parseTelegramCaption,
  sanitizeTitleSlug,
  sanitizeTeacherSlug,
} from "@/lib/naming";

describe("Unit: Deterministic Auto-Naming Engine (src/lib/naming.ts)", () => {
  // --------------------------------------------------------------------------
  // 1. Standard Classes, Subjects, and File Kinds
  // --------------------------------------------------------------------------
  describe("Standard Mappings", () => {
    it("generates canonical filenames for NCERT PDF across Class 6-10 and all 5 subjects", () => {
      const subjects = ["History", "Geography", "Civics", "Economics", "SocialScience"];
      for (let c = 6; c <= 10; c++) {
        for (const sub of subjects) {
          const name = buildFileName({
            class: c,
            subject: sub,
            chapterNo: 1,
            title: "Standard Chapter Title",
            kind: "ncert_pdf",
            ext: "pdf",
          });
          expect(name).toBe(`Standard-Chapter-Title_Class${c}_${sub}_Ch01_NCERT.pdf`);
          expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
        }
      }
    });

    it("generates correct filename for PPT and PPT-Preview", () => {
      const ppt = buildFileName({
        class: 10,
        subject: "History",
        chapterNo: 3,
        title: "The Making of a Global World",
        kind: "ppt",
        ext: "pptx",
      });
      expect(ppt).toBe("The-Making-of-a-Global-World_Class10_History_Ch03_PPT.pptx");
      expect(ppt).toMatch(/^[A-Za-z0-9._-]+$/);

      const pptPreview = buildFileName({
        class: 10,
        subject: "History",
        chapterNo: 3,
        title: "The Making of a Global World",
        kind: "ppt_pdf",
        ext: "pdf",
      });
      expect(pptPreview).toBe("The-Making-of-a-Global-World_Class10_History_Ch03_PPT-Preview.pdf");
      expect(pptPreview).toMatch(/^[A-Za-z0-9._-]+$/);
    });

    it("supports kind aliases for PPT-Preview (PPT_PDF and PPT-Preview)", () => {
      const alias1 = buildFileName({
        class: 9,
        subject: "Geography",
        chapterNo: 2,
        title: "Physical Features of India",
        kind: "PPT_PDF",
        ext: "pdf",
      });
      expect(alias1).toBe("Physical Features of India".replace(/\s+/g, "-") + "_Class9_Geography_Ch02_PPT-Preview.pdf");

      const alias2 = buildFileName({
        class: 9,
        subject: "Geography",
        chapterNo: 2,
        title: "Physical Features of India",
        kind: "PPT-Preview",
        ext: "pdf",
      });
      expect(alias2).toBe("Physical-Features-of-India_Class9_Geography_Ch02_PPT-Preview.pdf");
    });

    it("generates correct filename for Teacher Notes with teacher name", () => {
      const notes = buildFileName({
        class: 9,
        subject: "Economics",
        chapterNo: 1,
        title: "The Story of Village Palampur",
        kind: "teacher_notes",
        teacherName: "Sharma",
        ext: "pdf",
      });
      expect(notes).toBe("The-Story-of-Village-Palampur_Class9_Economics_Ch01_Notes-Sharma.pdf");
      expect(notes).toMatch(/^[A-Za-z0-9._-]+$/);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Chapter Number Zero-Padding
  // --------------------------------------------------------------------------
  describe("Chapter Number Zero-Padding", () => {
    it("pads single-digit chapter numbers with leading zero (Ch01 to Ch09)", () => {
      for (let i = 1; i <= 9; i++) {
        const name = buildFileName({
          class: 7,
          subject: "Geography",
          chapterNo: i,
          title: "Chapter",
          kind: "ncert_pdf",
          ext: "pdf",
        });
        expect(name).toContain(`_Ch0${i}_`);
      }
    });

    it("formats double-digit chapter numbers without modification (Ch10, Ch18, Ch99)", () => {
      const ch10 = buildFileName({
        class: 8,
        subject: "Civics",
        chapterNo: 10,
        title: "Law and Social Justice",
        kind: "ncert_pdf",
        ext: "pdf",
      });
      expect(ch10).toContain("_Ch10_");

      const ch99 = buildFileName({
        class: 8,
        subject: "Civics",
        chapterNo: 99,
        title: "Law and Social Justice",
        kind: "ncert_pdf",
        ext: "pdf",
      });
      expect(ch99).toContain("_Ch99_");
    });
  });

  // --------------------------------------------------------------------------
  // 3. Title Sanitization, Accents, and Punctuation
  // --------------------------------------------------------------------------
  describe("Title Sanitization & Character Encodings", () => {
    it("transliterates accents (French, Spanish, German) cleanly to ASCII", () => {
      const name = buildFileName({
        class: 9,
        subject: "History",
        chapterNo: 1,
        title: "L'Économie Française, El Niño, Über die Revolution!",
        kind: "ncert_pdf",
        ext: "pdf",
      });
      expect(name).toBe("LEconomie-Francaise-El-Nino-Uber-die-Revolution_Class9_History_Ch01_NCERT.pdf");
      expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
    });

    it("strips emojis, special punctuation, and path traversal characters", () => {
      const name = buildFileName({
        class: 8,
        subject: "Geography",
        chapterNo: 3,
        title: "🌍 Earth & Agriculture: @2026 #Top [Part-1] / ../hack!",
        kind: "ncert_pdf",
        ext: "pdf",
      });
      expect(name).toBe("Earth-Agriculture-2026-Top-Part-1-hack_Class8_Geography_Ch03_NCERT.pdf");
      expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
    });

    it("collapses multiple consecutive spaces and hyphens into single hyphens", () => {
      const name = buildFileName({
        class: 6,
        subject: "History",
        chapterNo: 2,
        title: "  From   Hunting-Gathering  ---   to Growing Food  ",
        kind: "ncert_pdf",
        ext: "pdf",
      });
      expect(name).toBe("From-Hunting-Gathering-to-Growing-Food_Class6_History_Ch02_NCERT.pdf");
    });

    it("falls back to 'Chapter' when title contains only stripped characters or is empty", () => {
      const nameEmpty = buildFileName({
        class: 6,
        subject: "History",
        chapterNo: 1,
        title: "",
        kind: "ncert_pdf",
        ext: "pdf",
      });
      expect(nameEmpty).toBe("Chapter_Class6_History_Ch01_NCERT.pdf");

      const nameEmojisOnly = buildFileName({
        class: 6,
        subject: "History",
        chapterNo: 1,
        title: "✨🎉🔥",
        kind: "ncert_pdf",
        ext: "pdf",
      });
      expect(nameEmojisOnly).toBe("Chapter_Class6_History_Ch01_NCERT.pdf");
    });
  });

  // --------------------------------------------------------------------------
  // 4. Title Truncation at 60 Characters
  // --------------------------------------------------------------------------
  describe("Slug Truncation & Boundaries", () => {
    it("truncates slug exceeding 60 characters and strips any dangling trailing hyphen", () => {
      const base59 = "A".repeat(59);
      const title = `${base59}-extra-characters-that-make-this-very-long`;
      const name = buildFileName({
        class: 7,
        subject: "History",
        chapterNo: 4,
        title: title,
        kind: "ncert_pdf",
        ext: "pdf",
      });
      const slug = name.split("_Class7_")[0];
      expect(slug.length).toBe(59);
      expect(slug.endsWith("-")).toBe(false);
      expect(slug).toBe(base59);
    });

    it("caps 200-character long titles to max 60 character slug", () => {
      const longTitle = "A".repeat(200);
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
      expect(slug).toBe("A".repeat(60));
    });

    it("handles title exactly 60 characters without truncation", () => {
      const title60 = "A".repeat(60);
      expect(sanitizeTitleSlug(title60, 60)).toBe(title60);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Extension Handling
  // --------------------------------------------------------------------------
  describe("Extension Handling", () => {
    it("strips leading dots and normalizes extension to lowercase", () => {
      const res1 = buildFileName({
        class: 10,
        subject: "Civics",
        chapterNo: 1,
        title: "Power Sharing",
        kind: "ncert_pdf",
        ext: ".pdf",
      });
      expect(res1.endsWith(".pdf")).toBe(true);
      expect(res1).not.toContain("..pdf");

      const res2 = buildFileName({
        class: 10,
        subject: "Civics",
        chapterNo: 1,
        title: "Power Sharing",
        kind: "ppt",
        ext: ".PPTX",
      });
      expect(res2.endsWith(".pptx")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Teacher Names & Duplicate Disambiguation
  // --------------------------------------------------------------------------
  describe("Teacher Names and Duplicate Resolution", () => {
    it("sanitizes complex teacher names with spaces, titles, and accents", () => {
      const name = buildFileName({
        class: 9,
        subject: "Economics",
        chapterNo: 1,
        title: "Village Palampur",
        kind: "teacher_notes",
        teacherName: "Dr. René K. Sharma (HOD)",
        ext: "pdf",
      });
      expect(name).toBe("Village-Palampur_Class9_Economics_Ch01_Notes-Dr-Rene-K-Sharma-HOD.pdf");
      expect(sanitizeTeacherSlug("Dr. René K. Sharma (HOD)")).toBe("Dr-Rene-K-Sharma-HOD");
    });

    it("defaults teacher name to 'Teacher' if undefined or empty", () => {
      const name = buildFileName({
        class: 9,
        subject: "Economics",
        chapterNo: 1,
        title: "Village Palampur",
        kind: "teacher_notes",
        ext: "pdf",
      });
      expect(name).toBe("Village-Palampur_Class9_Economics_Ch01_Notes-Teacher.pdf");
      expect(sanitizeTeacherSlug(undefined)).toBe("Teacher");
      expect(sanitizeTeacherSlug("")).toBe("Teacher");
    });

    it("resolves duplicate teacher names by appending -2, -3", () => {
      const existing = [
        "Village-Palampur_Class9_Economics_Ch01_Notes-Sharma.pdf",
        "Village-Palampur_Class9_Economics_Ch01_Notes-Sharma-2.pdf",
      ];
      const name = buildFileName({
        class: 9,
        subject: "Economics",
        chapterNo: 1,
        title: "Village Palampur",
        kind: "teacher_notes",
        teacherName: "Sharma",
        ext: "pdf",
        existingNames: existing,
      });
      expect(name).toBe("Village-Palampur_Class9_Economics_Ch01_Notes-Sharma-3.pdf");
    });

    it("fills lowest available slot if sequence gap exists in duplicates", () => {
      const existing = [
        "Village-Palampur_Class9_Economics_Ch01_Notes-Sharma.pdf",
        "Village-Palampur_Class9_Economics_Ch01_Notes-Sharma-3.pdf",
      ];
      const name = buildFileName({
        class: 9,
        subject: "Economics",
        chapterNo: 1,
        title: "Village Palampur",
        kind: "teacher_notes",
        teacherName: "Sharma",
        ext: "pdf",
        existingNames: existing,
      });
      expect(name).toBe("Village-Palampur_Class9_Economics_Ch01_Notes-Sharma-2.pdf");
    });

    it("handles multi-level duplicate collisions (-2, -3, -4)", () => {
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

  // --------------------------------------------------------------------------
  // 7. Safety Invariant Assertion
  // --------------------------------------------------------------------------
  describe("Safety Invariant", () => {
    it("ensures every generated filename matches ^[A-Za-z0-9._-]+$", () => {
      const testCases = [
        { title: "Standard", ext: "pdf" },
        { title: "Messy #!$@ Title", ext: ".pdf" },
        { title: "Éléphant", ext: "pptx" },
        { title: "Very Long ".repeat(10), ext: ".pptx" },
      ];
      for (const tc of testCases) {
        const res = buildFileName({
          class: 8,
          subject: "Civics",
          chapterNo: 1,
          title: tc.title,
          kind: "ncert_pdf",
          ext: tc.ext,
        });
        expect(res).toMatch(/^[A-Za-z0-9._-]+$/);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 8. Telegram Caption Formatting & Parsing
  // --------------------------------------------------------------------------
  describe("Telegram Caption Formatter & Parser", () => {
    it("formats pipe-delimited caption with short sha (8 chars) and part information", () => {
      const caption = formatTelegramCaption({
        title: "Resources and Development",
        class: 10,
        subject: "Geography",
        ch: 1,
        kind: "ncert_pdf",
        name: "Resources-and-Development_Class10_Geography_Ch01_NCERT.pdf",
        sha: "a1b2c3d4e5f67890abcdef1234567890",
        part: 2,
        total: 5,
      });
      expect(caption).toBe(
        "title=Resources and Development|class=10|subject=Geography|ch=1|kind=ncert_pdf|name=Resources-and-Development_Class10_Geography_Ch01_NCERT.pdf|sha=a1b2c3d4|part=2/5"
      );
      expect(caption.length).toBeLessThanOrEqual(1024);
    });

    it("sanitizes pipes and newlines inside title to preserve delimiter integrity", () => {
      const caption = formatTelegramCaption({
        title: "Chapter | Pipe \n Newline \r Carriage",
        class: 7,
        subject: "History",
        ch: 3,
        kind: "ncert_pdf",
        name: "test.pdf",
        sha: "1234567890abcdef",
        part: 1,
        total: 1,
      });
      expect(caption).not.toContain("Chapter | Pipe");
      expect(caption).toContain("title=Chapter Pipe Newline Carriage|");
    });

    it("truncates excessively long titles to guarantee total caption length <= 1024", () => {
      const massiveTitle = "A".repeat(2000);
      const caption = formatTelegramCaption({
        title: massiveTitle,
        class: 9,
        subject: "History",
        ch: 5,
        kind: "ncert_pdf",
        name: "name.pdf",
        sha: "abcdef1234567890",
        part: 1,
        total: 1,
      });
      expect(caption.length).toBeLessThanOrEqual(1024);
      expect(caption).toContain("|sha=abcdef12|part=1/1");
    });

    it("correctly parses formatted caption back into structured object with parseTelegramCaption", () => {
      const original = {
        title: "Our Changing Earth",
        class: 7,
        subject: "Geography",
        ch: 2,
        kind: "ncert_pdf",
        name: "Our-Changing-Earth_Class7_Geography_Ch02_NCERT.pdf",
        sha: "12b3e7a9",
        part: 1,
        total: 3,
      };

      const caption = formatTelegramCaption(original);
      const parsed = parseTelegramCaption(caption);

      expect(parsed).not.toBeNull();
      expect(parsed?.title).toBe(original.title);
      expect(parsed?.class).toBe(original.class);
      expect(parsed?.subject).toBe(original.subject);
      expect(parsed?.ch).toBe(original.ch);
      expect(parsed?.kind).toBe(original.kind);
      expect(parsed?.name).toBe(original.name);
      expect(parsed?.sha).toBe("12b3e7a9");
      expect(parsed?.part).toBe(1);
      expect(parsed?.total).toBe(3);
    });

    it("returns null for malformed captions in parseTelegramCaption", () => {
      expect(parseTelegramCaption("")).toBeNull();
      expect(parseTelegramCaption("not a valid caption")).toBeNull();
      expect(parseTelegramCaption("title=abc|class=10")).toBeNull(); // missing fields
      expect(parseTelegramCaption("title=a|class=10|subject=H|ch=1|kind=k|name=n|sha=s|part=invalid")).toBeNull();
    });
  });
});
