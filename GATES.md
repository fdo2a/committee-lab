# Gates: Claude logical review

Scope: reviewed builds and scheduled stock/ETF operation with risk-exit exemption.

- [x] G1: signed approvals reject tampering, expiry, scope and revision changes; stock/ETF entries stay blocked without approval while risk exits work
  CHECK: node --test --test-reporter=tap tests/logic-review.test.mjs
  EXPECT: # fail 0
  EVIDENCE: 2026-10-09; zsh; CWD committee-lab; npm test exit 0; /tmp/committee-theme-node-final-20261009.log reports tests 246, pass 246, fail 0; migration regression fails with migration removed and passes after restoration

- [x] G2: controller retries logical feedback and fails closed; updater never forwards credentials to review
  CHECK: python3 -m unittest discover -s tests -p '*_test.py'
  EXPECT: OK
  EVIDENCE: 2026-10-09; Python unittest exit 0; /tmp/committee-theme-python-final-20261009.log reports Ran 41 tests, OK; five runtime summary regression tests pass

- [x] G3: existing Node regression suite passes
  CHECK: npm test
  EXPECT: fail 0
  EVIDENCE: 2026-10-09; npm test exit 0; /tmp/committee-theme-node-final-20261009.log reports tests 246, pass 246, fail 0; npm run check exit 0

- [x] G4: actual Claude logical review approves the exact source and the guarded deployment build succeeds
  CHECK: CLAUDE_REVIEW_PUBLIC_KEY="$(cat "$HOME/.codex/committee-review/public-key.json")" npm run review:code
  EXPECT: Claude logical review approved
  EVIDENCE: 2026-10-09; /tmp/committee-deploy-review-20261009.log; actual Claude round 1 requested the server's 30-minute contract and risk-only phase-boundary repair. Codex repaired both and added regressions. Controller reran Node/Python/syntax checks, Claude round 2 approved, and the guarded build succeeded. Source digest f563152705f189eabc84069f4790a9c9ae6f7e2166f1def980c342482de698c8 matches the signed receipt, built Worker and deployed context.

- [x] G5: private Site publication is verified and paused schedules stay paused
  EVIDENCE: 2026-10-09 23:56 KST; owner-private Site version31 deployed successfully as appgdep_6ac9008d63fc8191bb65b28f7ebeb111 from pushed commit90a968be99881654838d593a7ce895998a663356. Read-only verification confirms required/configured true, maxMinutes30, exact approved digest and all six updater file hashes match. Site remains owner-only. Existing paused Mac/legacy cloud/US risk schedules were not resumed; Asia risk schedule remains active. No account writes or trades were used for deployment verification.
