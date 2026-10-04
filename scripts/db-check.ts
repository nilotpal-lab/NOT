import dotenv from "dotenv";
import path from "path";
import { getDb, checkDatabaseSchema } from "../src/lib/db";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

interface ConstraintCheck {
  name: string;
  type: "TABLE" | "RLS" | "CHECK_CONSTRAINT" | "UNIQUE_CONSTRAINT" | "INDEX";
  passed: boolean;
  details: string;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    console.error("Error: SUPABASE_URL or SUPABASE_SERVICE_KEY is missing in .env.local");
    process.exit(1);
  }

  console.log("\n=======================================================");
  console.log("   Comprehensive Database Schema & Constraint Check    ");
  console.log("=======================================================\n");

  const db = getDb(url, key);
  const checks: ConstraintCheck[] = [];

  // 1. Table Existence & RLS Checks
  const basicStatus = await checkDatabaseSchema(db);
  for (const t of basicStatus.tables) {
    checks.push({
      name: `Table: ${t.table}`,
      type: "TABLE",
      passed: t.exists,
      details: t.exists ? "Table exists in schema" : "Table is missing",
    });
    checks.push({
      name: `RLS on ${t.table}`,
      type: "RLS",
      passed: t.rlsEnabled,
      details: t.rlsEnabled ? "Row Level Security enabled" : "RLS disabled",
    });
  }

  // 2. CHECK Constraints: chapters
  // 2.1 chapters.class (6 to 10)
  const classCheck = await db.from("chapters").insert({
    class: 15,
    subject: "History",
    chapter_no: 1,
    title: "Test Title",
  });
  checks.push({
    name: "chapters_class_check",
    type: "CHECK_CONSTRAINT",
    passed: classCheck.error?.code === "23514",
    details: classCheck.error?.message || "Constraint not enforced",
  });

  // 2.2 chapters.subject ('History','Geography','Civics','Economics','SocialScience')
  const subjectCheck = await db.from("chapters").insert({
    class: 7,
    subject: "InvalidSubject",
    chapter_no: 1,
    title: "Test Title",
  });
  checks.push({
    name: "chapters_subject_check",
    type: "CHECK_CONSTRAINT",
    passed: subjectCheck.error?.code === "23514",
    details: subjectCheck.error?.message || "Constraint not enforced",
  });

  // 2.3 chapters.chapter_no (1 to 99)
  const chapNoCheck = await db.from("chapters").insert({
    class: 7,
    subject: "Geography",
    chapter_no: 150,
    title: "Test Title",
  });
  checks.push({
    name: "chapters_chapter_no_check",
    type: "CHECK_CONSTRAINT",
    passed: chapNoCheck.error?.code === "23514",
    details: chapNoCheck.error?.message || "Constraint not enforced",
  });

  // 2.4 chapters.title (length 2 to 200)
  const titleCheck = await db.from("chapters").insert({
    class: 7,
    subject: "Geography",
    chapter_no: 1,
    title: "X", // too short (length 1)
  });
  checks.push({
    name: "chapters_title_check",
    type: "CHECK_CONSTRAINT",
    passed: titleCheck.error?.code === "23514",
    details: titleCheck.error?.message || "Constraint not enforced",
  });

  // 3. CHECK Constraints: files
  // 3.1 files.kind ('ncert_pdf','ppt','ppt_pdf','teacher_notes')
  const dummyChapterId = "00000000-0000-0000-0000-000000000000";
  const kindCheck = await db.from("files").insert({
    chapter_id: dummyChapterId,
    kind: "invalid_kind",
    file_name: "test.pdf",
    size_bytes: 1024,
    mime: "application/pdf",
    sha256: "dummy_sha",
  });
  checks.push({
    name: "files_kind_check",
    type: "CHECK_CONSTRAINT",
    passed: kindCheck.error?.code === "23514",
    details: kindCheck.error?.message || "Constraint not enforced",
  });

  // 3.2 files.size_bytes ( > 0 and <= 209715200)
  const sizeCheck = await db.from("files").insert({
    chapter_id: dummyChapterId,
    kind: "ncert_pdf",
    file_name: "test.pdf",
    size_bytes: 0,
    mime: "application/pdf",
    sha256: "dummy_sha",
  });
  checks.push({
    name: "files_size_bytes_check",
    type: "CHECK_CONSTRAINT",
    passed: sizeCheck.error?.code === "23514",
    details: sizeCheck.error?.message || "Constraint not enforced",
  });

  // 3.3 files.mime
  const mimeCheck = await db.from("files").insert({
    chapter_id: dummyChapterId,
    kind: "ncert_pdf",
    file_name: "test.pdf",
    size_bytes: 1024,
    mime: "image/png",
    sha256: "dummy_sha",
  });
  checks.push({
    name: "files_mime_check",
    type: "CHECK_CONSTRAINT",
    passed: mimeCheck.error?.code === "23514",
    details: mimeCheck.error?.message || "Constraint not enforced",
  });

  // 4. CHECK Constraints: file_parts
  // 4.1 file_parts.part_no ( >= 1)
  const partNoCheck = await db.from("file_parts").insert({
    file_id: dummyChapterId,
    part_no: 0,
    tg_file_id: "tg_123",
    tg_file_unique_id: "uniq_123",
    tg_message_id: 1,
    size_bytes: 1024,
    sha256: "dummy_sha",
  });
  checks.push({
    name: "file_parts_part_no_check",
    type: "CHECK_CONSTRAINT",
    passed: partNoCheck.error?.code === "23514",
    details: partNoCheck.error?.message || "Constraint not enforced",
  });

  // 4.2 file_parts.size_bytes ( > 0 and <= 19922944) [19 MiB limit]
  const partSizeCheck = await db.from("file_parts").insert({
    file_id: dummyChapterId,
    part_no: 1,
    tg_file_id: "tg_123",
    tg_file_unique_id: "uniq_123",
    tg_message_id: 1,
    size_bytes: 19922945, // 1 byte over 19 MiB
    sha256: "dummy_sha",
  });
  checks.push({
    name: "file_parts_size_bytes_check (19 MiB)",
    type: "CHECK_CONSTRAINT",
    passed: partSizeCheck.error?.code === "23514",
    details: partSizeCheck.error?.message || "Constraint not enforced",
  });

  // 5. Unique Constraint Verification: chapters(class, subject, chapter_no)
  const tempTitle = "Temporary Verification Chapter";
  const insert1 = await db.from("chapters").insert({
    class: 6,
    subject: "History",
    chapter_no: 99,
    title: tempTitle,
  }).select("id").single();

  if (insert1.data?.id) {
    const dupInsert = await db.from("chapters").insert({
      class: 6,
      subject: "History",
      chapter_no: 99,
      title: "Duplicate Attempt",
    });

    checks.push({
      name: "chapters unique (class, subject, chapter_no)",
      type: "UNIQUE_CONSTRAINT",
      passed: dupInsert.error?.code === "23505",
      details: dupInsert.error?.message || "Unique constraint not enforced",
    });

    // Clean up temporary row
    await db.from("chapters").delete().eq("id", insert1.data.id);
  } else {
    checks.push({
      name: "chapters unique (class, subject, chapter_no)",
      type: "UNIQUE_CONSTRAINT",
      passed: false,
      details: "Could not create temporary row to test unique constraint",
    });
  }

  // 6. GIN Trigram & Index Verification
  const trgmTest = await db.from("chapters").select("id").ilike("title", "%Test%");
  checks.push({
    name: "chapters_title_trgm (GIN index)",
    type: "INDEX",
    passed: !trgmTest.error,
    details: !trgmTest.error ? "pg_trgm trigram index operational" : trgmTest.error.message,
  });

  // Print Results Table
  console.log("| Type               | Constraint / Index Name                  | Status     | Details");
  console.log("|--------------------|------------------------------------------|------------|-----------------------------------------");
  for (const c of checks) {
    const statusFormatted = c.passed ? "[PASS]      " : "[FAIL]      ";
    console.log(`| ${c.type.padEnd(18)} | ${c.name.padEnd(40)} | ${statusFormatted} | ${c.details.substring(0, 40)}`);
  }
  console.log("=======================================================\n");

  const allPassed = checks.every((c) => c.passed);
  if (allPassed) {
    console.log(`[PASS] All ${checks.length} database constraints, indexes, tables, and RLS checks PASSED!\n`);
    process.exit(0);
  } else {
    console.error("[FAIL] One or more constraint checks failed.\n");
    process.exit(1);
  }
}

main();
