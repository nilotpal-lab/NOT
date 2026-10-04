/**
 * SST Chapter Library - Deterministic Auto-Naming & Telegram Caption Formatting
 * Module: src/lib/naming.ts
 *
 * Implements pure functions according to:
 * - ORIGINAL_REQUEST.md § R2
 * - SST-Library-FINAL-Antigravity-Prompt.md § 3
 * - PROJECT.md § Interface Contracts
 */

export interface BuildFileNameParams {
  class: number;
  subject: string;
  chapterNo: number;
  title: string;
  kind: string;
  teacherName?: string;
  ext: string;
  existingNames?: string[];
}

export interface TelegramCaptionParams {
  title: string;
  class: number;
  subject: string;
  ch: number;
  kind: string;
  name: string;
  sha: string;
  part: number;
  total: number;
}

export interface ParsedTelegramCaption {
  title: string;
  class: number;
  subject: string;
  ch: number;
  kind: string;
  name: string;
  sha: string;
  part: number;
  total: number;
}

/**
 * Sanitizes a title string into a strict URL/filename-safe slug:
 * 1. Transliterates/decomposes unicode diacritics (NFD).
 * 2. Removes combining diacritical marks (\u0300-\u036f).
 * 3. Drops any non-alphanumeric character (except spaces and hyphens).
 * 4. Trims leading/trailing whitespace.
 * 5. Replaces internal whitespace sequences with single hyphens.
 * 6. Collapses consecutive hyphens.
 * 7. Trims leading and trailing hyphens.
 * 8. Truncates to max 60 characters without dangling trailing hyphens.
 * 9. Falls back to "Chapter" if input title yields an empty slug.
 */
export function sanitizeTitleSlug(rawTitle: string, maxLen = 60): string {
  let slug = (rawTitle || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics / accents
    .replace(/[^a-zA-Z0-9\s-]/g, "") // drop non-alphanumeric except whitespace and hyphens
    .trim()
    .replace(/\s+/g, "-") // spaces to hyphens
    .replace(/-+/g, "-") // collapse repeated hyphens
    .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens

  if (slug.length > maxLen) {
    slug = slug.substring(0, maxLen).replace(/-+$/, "");
  }

  return slug || "Chapter";
}

/**
 * Sanitizes a teacher's name into a strict slug:
 * Follows identical rules to title sanitization, falling back to "Teacher".
 */
export function sanitizeTeacherSlug(rawName?: string): string {
  if (!rawName) return "Teacher";
  const slug = (rawName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "Teacher";
}

/**
 * Pure function: buildFileName
 *
 * Generates deterministic, collision-resistant filenames adhering to:
 * Pattern: {Chapter-Title}_Class{C}_{Subject}_Ch{NN}_{Type}.{ext}
 *
 * Type mappings:
 * - "ncert_pdf" | "NCERT" -> "NCERT"
 * - "ppt" | "PPT" -> "PPT"
 * - "ppt_pdf" | "PPT-Preview" | "PPT_PDF" -> "PPT-Preview"
 * - "teacher_notes" -> "Notes-{TeacherName}"
 *
 * Duplicate resolution:
 * If candidate already exists in existingNames, appends -2, -3, etc.
 *
 * Strict validation:
 * Asserts output matches ^[A-Za-z0-9._-]+$
 */
export function buildFileName(params: BuildFileNameParams): string {
  // 1. Sanitize Chapter Title
  const titleSlug = sanitizeTitleSlug(params.title, 60);

  // 2. Format Class
  const classNum = Math.floor(Number(params.class)) || 0;
  const classStr = `Class${classNum}`;

  // 3. Sanitize Subject (preserve standard PascalCase/camelCase, drop unsafe characters)
  const cleanSubject =
    (params.subject || "")
      .trim()
      .replace(/\s+/g, "")
      .replace(/[^a-zA-Z0-9_-]/g, "") || "Subject";

  // 4. Format Chapter Number zero-padded to at least 2 digits (Ch01, Ch02, etc.)
  const chNum = Math.max(0, Math.floor(Number(params.chapterNo) || 0));
  const nn = String(chNum).padStart(2, "0");
  const chStr = `Ch${nn}`;

  // 5. Determine Type string
  let typeStr = "";
  const k = params.kind ? params.kind.trim() : "";
  if (k === "ncert_pdf" || k === "NCERT") {
    typeStr = "NCERT";
  } else if (k === "ppt" || k === "PPT") {
    typeStr = "PPT";
  } else if (k === "ppt_pdf" || k === "PPT-Preview" || k === "PPT_PDF") {
    typeStr = "PPT-Preview";
  } else if (k === "teacher_notes") {
    const tSlug = sanitizeTeacherSlug(params.teacherName);
    typeStr = `Notes-${tSlug}`;
  } else {
    // Fallback for custom kinds
    typeStr = k.replace(/[^a-zA-Z0-9_-]/g, "") || "File";
  }

  // 6. Clean Extension (strip leading dots, lowercase, keep alphanumeric only)
  const cleanExt = (params.ext || "pdf")
    .replace(/^\.+/, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase() || "pdf";

  // 7. Assemble Base Name
  const baseName = `${titleSlug}_${classStr}_${cleanSubject}_${chStr}_${typeStr}`;

  // 8. Collision / Duplicate Resolution
  const existing = params.existingNames || [];
  let candidate = `${baseName}.${cleanExt}`;

  if (existing.includes(candidate)) {
    let counter = 2;
    while (existing.includes(`${baseName}-${counter}.${cleanExt}`)) {
      counter++;
    }
    candidate = `${baseName}-${counter}.${cleanExt}`;
  }

  // 9. Strict Regex Assertion
  if (!/^[A-Za-z0-9._-]+$/.test(candidate)) {
    throw new Error(
      `Generated filename "${candidate}" violates strict pattern ^[A-Za-z0-9._-]+$`
    );
  }

  return candidate;
}

/**
 * Pure function: formatTelegramCaption
 *
 * Formats machine-readable Telegram document caption adhering to:
 * `title=...|class=...|subject=...|ch=...|kind=...|name=...|sha=...|part=n/total`
 *
 * Guarantees total length <= 1024 characters (Telegram caption limit).
 */
export function formatTelegramCaption(params: TelegramCaptionParams): string {
  const shortSha = (params.sha || "").slice(0, 8);
  const classNum = params.class;
  const subjectStr = params.subject || "";
  const chNum = params.ch;
  const kindStr = params.kind || "";
  const nameStr = params.name || "";
  const partStr = `part=${params.part}/${params.total}`;

  // Clean title from pipe and newlines to preserve delimiter integrity
  let title = (params.title || "").replace(/[\r\n|]+/g, " ").trim();

  let caption = `title=${title}|class=${classNum}|subject=${subjectStr}|ch=${chNum}|kind=${kindStr}|name=${nameStr}|sha=${shortSha}|${partStr}`;

  // Telegram caption limit is strictly 1024 characters
  const MAX_CAPTION_LEN = 1024;
  if (caption.length > MAX_CAPTION_LEN) {
    const excess = caption.length - MAX_CAPTION_LEN;
    const allowedTitleLen = Math.max(0, title.length - excess);
    title = title.substring(0, allowedTitleLen).trim();
    caption = `title=${title}|class=${classNum}|subject=${subjectStr}|ch=${chNum}|kind=${kindStr}|name=${nameStr}|sha=${shortSha}|${partStr}`;
  }

  return caption;
}

/**
 * Pure helper function: parseTelegramCaption
 *
 * Parses a pipe-delimited Telegram caption string back into structured parameters.
 * Returns null if the caption format is invalid.
 */
export function parseTelegramCaption(caption: string): ParsedTelegramCaption | null {
  if (!caption || typeof caption !== "string") return null;

  const parts = caption.split("|");
  const map = new Map<string, string>();

  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx !== -1) {
      const key = part.slice(0, eqIdx).trim();
      const val = part.slice(eqIdx + 1).trim();
      map.set(key, val);
    }
  }

  const title = map.get("title");
  const classStr = map.get("class");
  const subject = map.get("subject");
  const chStr = map.get("ch");
  const kind = map.get("kind");
  const name = map.get("name");
  const sha = map.get("sha");
  const partFraction = map.get("part");

  if (!title || !classStr || !subject || !chStr || !kind || !name || !sha || !partFraction) {
    return null;
  }

  const fractionMatch = partFraction.match(/^(\d+)\/(\d+)$/);
  if (!fractionMatch) return null;

  const part = parseInt(fractionMatch[1], 10);
  const total = parseInt(fractionMatch[2], 10);

  return {
    title,
    class: parseInt(classStr, 10),
    subject,
    ch: parseInt(chStr, 10),
    kind,
    name,
    sha,
    part,
    total,
  };
}
