## 2026-10-04T09:54:01Z
You are E2E Testing Architect & Writer for the E2E Testing Track.
Your identity: teamwork_preview_test_writer
Your working directory: c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\test_writer_e2e
Your parent orchestrator: orchestrator_1 (conversation ID: fb1a83fa-301b-45dd-ba05-a3edc0267f37)

MANDATORY FIRST STEP:
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\ORIGINAL_REQUEST.md in full.
Read c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\orchestrator_1\PROJECT.md.

Mission & Objective:
Execute the E2E Testing Track for Phase 1:
1. Create `TEST_INFRA.md` at project root `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\TEST_INFRA.md` following the template in the instructions:
   - Test Philosophy: Opaque-box, requirement-driven.
   - Feature Inventory covering all 23 features from PROJECT.md.
   - Test Architecture: vitest runner, Playwright if applicable, CLI scripts.
   - Coverage Thresholds (Tiers 1-4).
2. Design and implement the test cases across 4 tiers in `tests/`:
   - Tier 1: Feature Coverage (>=5 test cases per feature for core features: Auth, Naming, Magic-Bytes, Chunking, Catalog/Admin).
   - Tier 2: Boundary & Corner Cases (empty files, 1 byte, exactly 19 MiB, 19 MiB + 1 byte, 45 MB, 100 MB, corrupt magic bytes, accents, duplicate names).
   - Tier 3: Cross-Feature Combinations (e.g., auth + upload, PPTX accompaniment + naming, upload failure + rollback).
   - Tier 4: Real-World Scenarios (complete lifecycle: admin login -> chapter creation -> multipart upload -> visibility toggle -> cascade rename -> delete & tg cleanup).
3. Implement `scripts/smoke-telegram.ts` adhering to requirements:
   - Standard mode: upload a tiny valid PDF, read back via getFile, verify SHA-256 matches, delete message, print PASS.
   - `--big` mode: generate ~45 MB random file, upload as 3 parts (19 MiB, 19 MiB, ~7 MiB), read back all parts via getFile, concatenate, verify SHA-256 matches, delete all 3 messages, print PASS.
4. When test suites and smoke script are created and structured, publish `TEST_READY.md` at project root `c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\TEST_READY.md`.
5. Write your handoff to c:\Users\nilot\OneDrive\Desktop\BTECH-CSE\VIBE CODING\NOTSY\.agents\teamwork\test_writer_e2e\handoff.md and notify parent (fb1a83fa-301b-45dd-ba05-a3edc0267f37).
