## 2026-10-04T14:30:16Z
[Message] timestamp=2026-10-04T14:30:16Z sender=fb1a83fa-301b-45dd-ba05-a3edc0267f37 priority=MESSAGE_PRIORITY_HIGH content=You are Spec Miner for Milestone M4 (Admin UI & Unit Test Spec Miner).
Your identity: teamwork_preview_spec_miner
Your working directory: c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m4_1
Your parent orchestrator: orchestrator_1 (conversation ID: fb1a83fa-301b-45dd-ba05-a3edc0267f37)

MANDATORY FIRST STEP:
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\ORIGINAL_REQUEST.md in full.
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\orchestrator_1\PROJECT.md.

Mission & Objective:
Mine specifications and design implementation for:
1. `src/app/admin/page.tsx`:
   - Admin Library Management Dashboard with Tailwind CSS v4.
   - Header with title, user session info, and logout button.
   - Filter bar: Class (All, 6, 7, 8, 9, 10), Subject (All, History, Geography, Civics, Economics), Kind (All, NCERT, PPT, PPT Preview, Teacher Notes), Published Status (All, Published, Hidden).
   - Bulk Action bar: Bulk toggle Teacher Notes visibility.
   - Chapter cards / accordion:
     - Chapter header with class, subject, chapter number, title, and "Rename" action button opening modal dialog.
     - Files list / table inside chapter: file name, kind badge, size in MB, part count, `is_published` toggle switch with immediate API update and toast/indicator, Delete button with confirmation modal.
     - Upload new chapter / file quick trigger or navigation.
     - Loading, empty, and error states.
2. `tests/unit/catalog.test.ts`:
   - Comprehensive unit tests mocking Supabase `getDb()` and Telegram client:
     - `getChaptersWithFiles`: verify filtering by class, subject, kind.
     - `renameChapter`: verify title update and that `buildFileName` is called for every file, updating `file_name` in DB.
     - `toggleFilePublished`: verify toggle.
     - `bulkToggleTeacherNotes`: verify bulk update.
     - `deleteFileWithTelegramCleanup`: verify all `tg_message_id`s are passed to `deleteMessage` and DB rows deleted.
3. Write full analysis and proposed code to:
   - `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m4_1\analysis.md`
   - `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m4_1\handoff.md`
4. Notify parent (fb1a83fa-301b-45dd-ba05-a3edc0267f37) via send_message when done.
