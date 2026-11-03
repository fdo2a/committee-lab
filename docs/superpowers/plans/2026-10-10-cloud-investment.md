# Cloud investment review implementation plan

> **For agentic workers:** Use superpowers:executing-plans in this session. The user authorized implementation and authentication on 2026-10-10.

**Goal:** Move runtime Claude subscription review to private GitHub Actions, keeping JEV and owner-private Sites orchestration.

**Architecture:** Sites stores a separate review queue and dispatches opaque job IDs. A tool-free Claude subprocess reviews a hash-bound summary; a separate signer posts a proof. The downloaded Python updater polls the queue and returns rejection details to the existing cloud investigator.

**Tech Stack:** Existing D1 SQLite, Worker WebCrypto, Node standard library, Python standard library, GitHub Actions.

**Spec:** ../specs/2026-10-10-cloud-investment-design.md

## Global constraints

- Collection and review are separate; one 30-minute window, maximum five rounds shared by stock/ETF/repair/revision-conflict reviews (duplicates reuse their job), proofs valid 15 minutes, phase-end clipping.
- Keep local code-approval keys, JEV secrets and account data out of GitHub source and model environments.
- No Chrome launch, paid Claude API fallback, broad GitHub token export or automatic paid credits.
- Existing risk exits continue; no cloud investment activation before real authentication and proof verification.

## Review focus

- Concurrent duplicates must not dispatch twice or consume another round.
- A retry must not renew the window or rewrite collected evidence.
- Changed revision/code or market phase must hold stale results without writing the account.
- Malformed reviews, redirects and unavailable authentication must fail closed.
- Claude receives only its OAuth authentication, never signer/service/GitHub credentials.

### Task 1: Server queue and proof boundary

Files: `worker/cloud-review.mjs`, `worker/index.mjs`, `worker/logic-review.mjs`, `db/schema.ts`, new Drizzle migration, `tests/cloud-review.test.mjs`.

- [x] Write assert tests using in-memory SQLite for deduplication, five-round/window bounds, immutable retry fields, claim/result races, stale revision, proof tampering and account byte preservation. Run `node --test tests/cloud-review.test.mjs` before and after implementation.
- [x] Store windows/jobs separately from `paper_account`. Generate server context rather than trust client context. Dispatch only IDs; reject redirects. Runtime cloud proofs require a matching approved job and unexpired original window. Chunk evidence below D1's2MB row limit and check exact Unicode reconstruction.

### Task 2: Cloud runner and downloaded updater

Files: `scripts/cloud-review.mjs`, `scripts/logic-review.mjs`, `.github/workflows/claude-review.yml`, `web/logic_review.py`, `web/run_autonomy.py`, `tests/cloud-runner.test.mjs`, `tests/logic_review_test.py`.

- [x] Test secret isolation and same-origin requests; reuse `runtimeReviewInput`, `validVerdict`, `signApproval`. Pass OAuth only to the Claude executable; use fresh sessions and no tools.
- [x] Poll the remote queue only when advertised configured, retain local fallback, return structured issues/window/job ID for source-backed cloud repair. Never replay a proof after409.
- [x] Pin Actions and CLI versions; restrict workflow to dispatch, read-only repository access, no checkout credential persistence, no raw model/payload logs.

### Task 3: Provision, approve, deploy and authenticate

Files: `docs/cloud-review-setup.md`, schedule contract updates, `.env.example`, authentication helper, reports excluded from source digest.

- [x] Create a private verifier repository and separate cloud RSA key; register repository secrets/service origin and Site public key while cloud remains inactive. Preserve other environment variables and paused Mac schedules.
- [ ] Run Node/Python checks and real `npm run review:code`; deploy the exact approved artifact through the Sites helper. Push the same reviewed source to the private verifier repository.
- [ ] Prepare hidden-input OAuth/repository-scoped Actions token setup. Verify subscription auth and read-only remote review before enabling cloud dispatch/new-investment schedules. User login is the only manual handoff; never claim it succeeded without a real run.

## Execution ledger

- Approved scope: user message “구현과 인증 설정을 진행해”.
- Native worktree creation returned “Not a git repository” for the parent workspace. Work continues in the nested repository on `cloud-investment`; existing evidence edits preserved.
- No added dependency or new research model. JEV's existing US discovery/admission contract stays intact.
- The first real code review reached Claude after all checks, then hit the Pro subscription limit. Local subscription login is valid; the CLI reports reset at01:20 Asia/Seoul. Do not build or publish until a later real review approves the complete changed source.
- The cloud OAuth and repository-scoped dispatch token require the owner's one-time login/issuance. A hidden-input helper and read-only cloud self-check are prepared; no broad CLI token is exported.
