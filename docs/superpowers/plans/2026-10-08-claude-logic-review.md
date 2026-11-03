# Claude logic review implementation plan

**Goal:** Claude logical review gates code builds and scheduled stock/ETF entries, with risk exits preserved.
**Architecture:** A Mac CLI controller reviews and repairs candidate logic, signs approvals; Worker verifies the exact request and source version. Existing engines retain deterministic checks and execute risk exits on held reviews.
**Tech Stack:** Node, Python standard library, Web Crypto RSA-PSS, existing Claude/Codex CLIs.
**Spec:** ../specs/2026-10-08-claude-logic-review.md

## Constraints
No new dependencies, no paid API fallback, 5 attempts; code review 45 minutes, investment review 30 minutes, no risk limit relaxation. No credentials in prompts, argv, files or logs. Private signing key remains outside repository and deployed assets. The current file signer does not isolate the key from model processes running as the same OS user; an isolated signer account is required for that guarantee. Existing risk exits remain active without approval.

## Tasks
1. Add failing tests for cryptographic request binding, expiry, false approval, review retry limits, unapproved stock/ETF entries and surviving risk exits. Run them before implementation.
2. Implement shared canonical hashing/signature verification in worker/logic-review.mjs; connect worker/index.mjs, account.mjs and engine/asset-allocation entry checks. Preserve CAS and retry eligibility.
3. Implement scripts/logic-review.mjs (Claude logical reviewer, Codex repairs, bounded subprocesses, private approval receipts) and code-review.mjs (source fingerprint, tests, approved build). Attach updater review calls for both session and compatibility modes.
4. Verify targeted tests, complete Node/Python suites, actual Claude review, and approved build. Register the public key, privately publish the exact approved source and activate the prepared Mac market schedules after the deployed gate is confirmed. Preserve the existing cloud market schedules as risk-only monitors and leave paused legacy schedules paused. The owner chose this Mac as the scheduled reviewer. Saved cloud editor observations are in docs/claude-schedule-verification.md; preserve those verified facts when repairing code.
