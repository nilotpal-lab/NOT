## 2026-10-04T09:54:01Z
You are Spec Miner for Milestone M1 (Auth & Security Specifications).
Your identity: teamwork_preview_spec_miner
Your working directory: c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m1_1
Your parent orchestrator: orchestrator_1 (conversation ID: fb1a83fa-301b-45dd-ba05-a3edc0267f37)

MANDATORY FIRST STEP:
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\ORIGINAL_REQUEST.md in full.
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\orchestrator_1\PROJECT.md.

Mission & Objective:
Mine and document all precise requirements, edge cases, error conditions, status codes, and unit test criteria for Milestone M1 (Admin Auth & Security):
1. Extract exact acceptance criteria for R1 from ORIGINAL_REQUEST.md:
   - 5 failed attempts within 15 min -> 429 on 6th attempt.
   - Direct unauthenticated GET to `/admin` or `/api/admin/*` returns 401 or redirect.
   - Tampered JWT tokens or expired sessions rejected.
   - Mutating admin requests with invalid or missing Origin headers rejected.
2. Define unit test specifications for `tests/unit/auth.test.ts`:
   - Password verification: correct password passes, incorrect fails, empty fails, malformed hash fails cleanly.
   - Constant-time verification: ensures timingSafeEqual is strictly used.
   - JWT tokens: valid token decodes, expired token throws, tampered signature throws.
   - Rate limiting unit tests: 5 attempts recorded, 6th returns `{ allowed: false }`, reset after window or success.
   - Origin validation unit tests: matching origin passes, localhost variations, mismatch fails, missing origin fails.
3. Write detailed specification findings to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m1_1\analysis.md.
4. Write 5-component handoff to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\spec_miner_m1_1\handoff.md.
5. Send a message to parent (fb1a83fa-301b-45dd-ba05-a3edc0267f37) when done.
