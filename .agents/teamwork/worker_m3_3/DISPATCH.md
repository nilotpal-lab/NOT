## 2026-10-04T14:11:46Z
You are Worker 3 for Milestone M3 Iteration 2 (Upload Session TTL Rollback Implementation).
Your identity: teamwork_preview_worker
Your working directory: c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\worker_m3_3
Your parent orchestrator: orchestrator_1 (conversation ID: fb1a83fa-301b-45dd-ba05-a3edc0267f37)

MANDATORY FIRST STEP:
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\ORIGINAL_REQUEST.md in full.
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\orchestrator_1\PROJECT.md.
Read Explorer Analysis Reports and Proposed Implementations:
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m3_3\handoff.md
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m3_3\proposed_upload-session.ts
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m3_4\handoff.md
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m3_4\proposed_part_route.ts
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m3_4\proposed_complete_route.ts
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m3_5\handoff.md
- c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\explorer_m3_5\analysis.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

File Ownership:
You exclusively own and may modify the following files:
- src/lib/upload-session.ts
- src/app/api/admin/upload/part/route.ts
- src/app/api/admin/upload/complete/route.ts
- tests/unit/rollback.test.ts

Implementation Tasks:
1. `src/lib/upload-session.ts`:
   - Replace with the drop-in implementation designed in `proposed_upload-session.ts`.
   - Ensures `peekSession(uploadId)`, `isSessionExpired(uploadId)`, `getSession(uploadId, options)` handle TTL without dropping `uploadedMessageIds` before rollback.
   - `cleanupExpiredSessions()` defaults to `rollback: true` and awaits/handles message deletion.
2. `src/app/api/admin/upload/part/route.ts`:
   - Replace with `proposed_part_route.ts`. Handles expired sessions by rolling back Telegram parts via `rollbackSessionTelegram` and returning HTTP 410.
3. `src/app/api/admin/upload/complete/route.ts`:
   - Replace with `proposed_complete_route.ts`. Handles expired sessions by rolling back Telegram parts via `rollbackSessionTelegram` and returning HTTP 410 (or 404).
4. `tests/unit/rollback.test.ts`:
   - Append the 8 unit tests formulated by Explorer 3 (R1.7a through R1.7h) verifying session expiration rollback at both unit and route levels.

Verification:
- Run adversarial harness: `npx tsx .agents/teamwork/challenger_m3_1/adversarial_harness.ts` (must pass 12/12!).
- Run full unit tests: `npm test`
- Run linter: `npm run lint`
- Run typecheck: `npx tsc --noEmit`
Document commands, test outputs, and numbers in your handoff report.

Output:
Write changes to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\worker_m3_3\changes.md.
Write handoff to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\worker_m3_3\handoff.md.
Notify parent (fb1a83fa-301b-45dd-ba05-a3edc0267f37) when finished.
