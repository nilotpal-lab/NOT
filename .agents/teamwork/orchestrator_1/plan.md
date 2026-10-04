# Execution Plan: Phase 1 SST Chapter Library

## Objectives
Deliver R1-R4 with 100% verification, passing E2E tests, smoke tests, preflight 5/5, zero secret leaks, and verification table in `docs/verification/phase-1.md`.

## Methodology & Pattern
Project Pattern with Dual Track (Implementation Track + E2E Testing Track).

### Phase 0: Survey & Scope Mapping
- Dispatch 3 Explorers in parallel to inspect existing codebase, database schemas, Telegram smoke test scripts, Next.js architecture, environment configuration, and existing libraries.
- Explorer 1: Codebase structure, Next.js routing, API routes, middleware, existing auth/session logic, packages, scripts.
- Explorer 2: Telegram integration, chunking mechanisms, bot tokens, channel ID, smoke test scripts (`npm run smoke:telegram`), storage model.
- Explorer 3: Database schema (Supabase), migrations, tables (`chapters`, files/parts, etc.), existing models/queries, types.
- Synthesize into `PROJECT.md` (Architecture, Feature Inventory, Milestones, Code Layout, Interface Contracts).

### Phase 1: Track Setup
- Track A: E2E Testing Track — Dispatch test writer / test orchestrator to create `TEST_INFRA.md`, test suites across Tiers 1-4, publish `TEST_READY.md`.
- Track B: Implementation Milestones
  - Milestone R1: Admin Authentication & Session Security (login API & UI, constant-time scrypt, JWT httpOnly cookie, 5/15min rate limiting, origin protection, server guards).
  - Milestone R2: Deterministic Auto-Naming & Magic-Byte Validation (buildFileName, Telegram caption formatting, stream magic-byte validation, PPTX accompanying PDF export enforcement).
  - Milestone R3: Chunked Multi-Part Telegram Upload Engine (client slicing <= 19 MiB, /api/admin/upload/part & complete, in-memory tracking, SHA-256 stream calculation, Telegram forwarding, rollback, auto-chapter creation, duplicate rejection).
  - Milestone R4: Admin Library Management Dashboard (/admin library UI, list/filter, rename cascade, visibility toggles, delete file + Telegram cleanup).

### Phase 2: Final Milestone & Hardening
- Phase 2.1: Pass 100% of E2E test suite (Tiers 1-4).
- Phase 2.2: Tier 5 Adversarial Coverage Hardening (Challenger -> Worker -> Reviewer loop).

### Phase 3: System Health & Final Acceptance
- Build & lint verification (`npm run build`, `npm run lint`).
- Preflight 5/5 verification (`npm run preflight`).
- Real Telegram smoke tests (`npm run smoke:telegram`, `npm run smoke:telegram -- --big`).
- Secret scan across repo, git history, `.next/static`.
- Verification table documented in `docs/verification/phase-1.md`.
- Final victory claim and report to parent.
