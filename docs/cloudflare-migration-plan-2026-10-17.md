# Cloudflare migration plan, 2026-10-17

Goal: move committee-lab from the ChatGPT Sites host to Cloudflare Workers + D1. Keep the account ledger, the Claude approval gate, and the risk-exit exemption unchanged. The Sites deployment stays the source of truth until the cutover check in step 5 passes.

## What is Sites-specific today

- **Auth.** `worker/index.mjs` relies on the Sites private dispatch for every `/api/*` and `/mcp` route. Only `/api/action` and `/api/pause` (lines 189, 248) and MCP (`worker/mcp.mjs:126`) check `oai-authenticated-user-id`, and they only test that it is present. Without Sites, the 30 API routes, including `/api/run`, `/api/action` reset and `/api/schedule`, would be public.
- **Service token.** `web/run_autonomy.py`, `scripts/service-request.mjs` and `scripts/cloud-review.mjs` send `OAI-Sites-Authorization`.
- **Deploy.** `.openai/hosting.json` (project `appgprj_6ac1…`, D1 binding `DB`) plus the Codex app's Sites deploy flow.
- **Scheduling.** ChatGPT scheduled tasks download the updater from the Site and run it. No US-session run reached the server during 2026-10-12..16.

The rest is already Cloudflare-shaped: `export default {fetch(request, env)}`, `env.DB` D1 queries, secrets read from `env`, and Drizzle migrations `drizzle/0000..0002`.

## Steps

### 1. Account setup (user)

- Create or confirm a Cloudflare account. Run `npx wrangler login` in an interactive terminal. Claude must not create accounts or handle passwords.
- Enable Zero Trust (free for up to 50 users). Pick a team name.

### 2. Auth in the Worker (code, needs Claude approval)

- Put a Cloudflare Access application in front of the Worker hostname. It allows only the owner email and one service token.
- Add `worker/auth.mjs`. It verifies the `Cf-Access-Jwt-Assertion` JWT against the team JWKS (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`) and the application `aud`. The Worker rejects any API request without a valid token. It fails closed when `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` or `OWNER_EMAIL` is missing. This is a second check behind Access, so a misconfigured Access policy cannot expose the API.
- Owner routes (`/api/action`, `/api/pause`, MCP tool calls, `/api/schedule`) require `email === OWNER_EMAIL`. Service-token JWTs (with `common_name` and no email) can use only the routes the updater needs.
- Replace `OAI-Sites-Authorization` in the three clients with `CF-Access-Client-Id` / `CF-Access-Client-Secret`. Reject non-`https://` site URLs.
- Keep the same-origin check and request size limits.

### 3. Build and deploy config (code, needs Claude approval)

- Add `wrangler.toml`: `main = "dist/server/index.js"`, D1 binding `DB`, `compatibility_date`. Do not add cron yet.
- Add `npm run deploy` = `node scripts/build.mjs && wrangler deploy --no-bundle`. The bundle is still produced only by the approved build. `wrangler` must not rebuild it, so the deployed code matches the approved digest.
- Register secrets with `wrangler secret put`: DART/EDINET/FRED/TYPESAFE keys, `SEC_USER_AGENT`, `CLAUDE_REVIEW_PUBLIC_KEY`, Access settings. Values come from `.env.local` through stdin and are never printed.

### 4. Data migration

- Create the new D1 database and apply `drizzle/0000..0002`.
- Export from Sites. Option A: a full D1 export through the Codex app Sites tools, if available. Option B: read `paper_account` and `run_log` through the authenticated API. `review_window`, `review_job` and `review_evidence` are short-lived and do not need copying.
- Before export, press pause on the Sites account so no run changes it during the copy.
- Import with `wrangler d1 execute`. Verify revision, equity, cash, holdings, plans and the run count match the export exactly. Record a SHA-256 of the exported state JSON in this report.

### 5. Cutover

- Pause the ChatGPT schedules (user, in ChatGPT).
- Deploy to Cloudflare. Read back `/api/context.logicReview.codeDigest` through Access and compare it with `.review/code-approval.json`.
- Run one risk-only updater call against Cloudflare during a real Asia session and one during a real US session. Check that the risk plans and the unit status in the readback are as expected.
- Keep the Sites deployment paused and read-only for at least one week as a fallback. Do not run both hosts at once. Two ledgers would diverge.

### 6. Scheduling (separate change)

- Phase 1: run the existing Python updater on a schedule outside ChatGPT. Use local scheduled tasks on the Mac, which requires the Mac to be on, or a GitHub Actions runner with the service token as a secret.
- Phase 2: add a Worker Cron Trigger for **risk-only** monitoring at each market's open/close. It needs a JS price fetch (port of `web/collect_prices.py`). Then risk exits no longer depend on any external scheduler. New investment activity keeps the signed Claude approval requirement.

## Out of scope

- No change to investment logic, risk limits or approval criteria.
- No new paid APIs. Workers free tier (100k requests/day) and D1 free tier (5 GB) cover current use.

## Open items

- Whether Sites offers a full D1 export (decides option A or B in step 4).
- Hostname: `*.workers.dev` or a custom domain. Access works with both.
- Until the cutover, the unit-exit fix still needs to be deployed on Sites through the Codex app. Its approval expires 2026-10-17 11:07 KST.

## Step 4 record, 2026-10-17

- Export (method B, Codex app, Sites account paused first): `account.json` SHA-256 `53b39622cd54db306cc8e8c2267b9429bdfe59ae2e0df2466d24586c4f133338` (revision 111, updatedAt 2026-10-17T03:25:07.616Z), `runs.json` SHA-256 `e78064f96f5edc32560637242b0a2197b99c44b271963dc593b8e1794e24def0`, weekly context files for 2026-10-05 and 2026-10-12. Sites D1 export was not available, so `run_log` carries the 27 runs reachable through the API (ids 124386..207422); older runs stay only in the Sites database.
- Import: `scripts/import-ledger.mjs` against `https://portfolio.example.workers.dev` with the Access service token. Result `{imported:'account', revision:111, parts:20}`, `{imported:'runs', count:27}`. Readback matched the export exactly: revision 111, cash 44,462,543.685257144, holdings MSFT 10 / NVDA 23, 2 trades, 37 plans, 79 history points, 1 trend unit; `stateBytesEqual: true`.
- The placeholder account the Worker had created on the first browser visit (revision 1, runCount 0) was deleted before the import.
- Sites remains paused and now also `access_mode` private; it is the fallback copy until step 6 is complete.

## Step 6 phase 1 record, 2026-10-17

The scheduled-operation workflow requires a **private repository** because its Actions logs and step summaries contain account results. The entire `operate` job is guarded by `github.event.repository.private == true`, so both scheduled and manual runs skip the job in public repositories or when the private flag is missing. Do not upload account or authentication material to the public `fdo2a/committee` repository.

User chose GitHub Actions over a Mac schedule. `.github/workflows/scheduled-operation.yml` runs `web/run_autonomy.py` from a checkout at the Asia phases (08:00/09:20/16:00 KST) and the US phases (08:30/09:50/16:30 New York, both DST offsets scheduled and the wrong one skipped by a New York clock check). Before each run the job compares `sourceDigest()` of the checkout with the deployed `/api/context.logicReview.codeDigest` and refuses to run on a mismatch, so the updater always matches the server. Exit 2 (new activity held) is reported as a notice, exit 1 fails the job. Repository variables and secrets: `COMMITTEE_SITE_ORIGIN`, `COMMITTEE_ACCESS_CLIENT_ID`, `COMMITTEE_ACCESS_CLIENT_SECRET`. The ChatGPT schedules for the Sites host stay paused. Without a logical reviewer in the runner, every run is risk-only plus bond and market data collection; new stock and ETF activity stays held until a signed Claude approval path is configured (phase 2).

## Step 6 phase 2 record, 2026-10-17

- Cloud review queue revived in `fdo2a/portfolio-investment`: `transport-check` and `auth-check` verified (runs 39025433543, 39026566550), `CLOUD_REVIEW_ENABLED=true`.
- Research subject: Claude Sonnet 5.5 via `scripts/research-agent.mjs` in the pre-market job (user chose Claude over Codex). Inputs are server JSON files plus public web; credentials never reach the model. Up to three `/api/research-check` repair rounds within 20 minutes; partial research is still submitted.
- Pre-market crons moved 50 minutes earlier (07:10 KST, 07:40 New York) after the first dry run (run 39027628820) timed out at the 20-minute cap without a research file; the cap is now 40 minutes, the model writes research.json incrementally, and the job waits for the server pre window before the updater runs.

