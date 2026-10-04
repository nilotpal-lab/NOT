## 2026-10-04T14:40:53Z

You are Worker 1 for Milestone M4 (Admin Library Management Dashboard).
Your identity: teamwork_preview_worker
Your working directory: c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\worker_m4_1
Your parent orchestrator: orchestrator_1 (conversation ID: fb1a83fa-301b-45dd-ba05-a3edc0267f37)

MANDATORY FIRST STEP:
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\ORIGINAL_REQUEST.md in full.
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\orchestrator_1\PROJECT.md.
Read Explorer Analysis & Specification Reports:
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m4_1\analysis.md
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m4_1\handoff.md
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m4_2\analysis.md
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m4_2\handoff.md
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m4_1\analysis.md
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m4_1\handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

File Ownership:
You exclusively own and may modify or create the following files:
- src/lib/catalog.ts
- src/types/database.ts
- src/app/api/admin/library/route.ts
- src/app/api/admin/library/[id]/route.ts
- src/app/api/admin/library/chapter/[id]/route.ts
- src/app/api/admin/library/bulk-toggle/route.ts
- src/app/admin/page.tsx
- tests/unit/catalog.test.ts

Implementation Tasks:
1. `src/types/database.ts` & `src/lib/catalog.ts`:
   - Implement `getChaptersWithFiles`: filtering by class, subject, kind, isPublished.
   - Implement `renameChapter`: updates chapter title AND cascades recalculation of `file_name` for all files in that chapter using `buildFileName` from `src/lib/naming.ts`.
   - Implement `toggleFilePublished`: toggles `is_published` for a file.
   - Implement `bulkToggleTeacherNotes`: updates `is_published` for all files where `kind = 'teacher_notes'`.
   - Implement `deleteFileWithTelegramCleanup`: fetches all `file_parts`, deletes each part from Telegram using `tgClient.deleteMessage` (with per-message error handling), and deletes DB rows.
2. API Routes:
   - `src/app/api/admin/library/route.ts` (GET catalog)
   - `src/app/api/admin/library/[id]/route.ts` (PATCH toggle published, DELETE with Telegram cleanup)
   - `src/app/api/admin/library/chapter/[id]/route.ts` (PATCH rename chapter cascade)
   - `src/app/api/admin/library/bulk-toggle/route.ts` (POST bulk toggle teacher notes)
   - Remember Next.js 16 breaking change: dynamic route `params` are asynchronous Promises strictly awaited: `const { id } = await context.params;`
   - Include CSRF `validateOrigin` on all mutating routes and session check `verifyAdminToken`.
3. `src/app/admin/page.tsx`:
   - Implement the complete Admin Library Management Dashboard with Tailwind CSS v4 and inline SVGs.
   - Multi-faceted filter bar (Class 6-10, Subject, Kind, Published status).
   - Bulk teacher notes visibility toggle bar.
   - Collapsible chapter cards with Rename modal.
   - Files table inside chapter with instant toggle switch and Delete confirmation modal.
   - Header with session badge and logout button.
4. `tests/unit/catalog.test.ts`:
   - Comprehensive unit test suite covering all catalog functions, cascade renaming with `buildFileName`, and Telegram message deletion cleanup.

Verification:
- Run `npm test`
- Run `npm run lint`
- Run `npx tsc --noEmit`
- Run `npm run build`
Document all commands, test counts, and outputs in your handoff report.

Output:
Write changes to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\worker_m4_1\changes.md.
Write handoff to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\worker_m4_1\handoff.md.
Notify parent (fb1a83fa-301b-45dd-ba05-a3edc0267f37) when finished.
