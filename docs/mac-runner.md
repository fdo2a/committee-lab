# Mac runner behind a Workers VPC tunnel

Since 2026-10-19 the app runs on the operator's Mac. One account read parses about 7.8MB of state and recomputes
the analysis (670-1007ms CPU measured on Cloudflare), so on the free plan's 10ms per-request CPU limit almost every
API call ended in Cloudflare's HTML "Worker exceeded resource limits" 503.

```
browser / GitHub Actions
  → https://portfolio.example.workers.dev   (Cloudflare Access, unchanged)
  → proxy/index.mjs                          (Worker `portfolio`, forwards only)
  → Workers VPC service `committee-mac`      (service_id in proxy/wrangler.toml)
  → Cloudflare Tunnel `committee-mac`        (no public hostname)
  → Mac 127.0.0.1:8787                       (wrangler dev --local on the approved dist/ bundle)
```

The Mac re-verifies every forwarded Access JWT with `worker/auth.mjs` and fails closed, as the Worker did before.
`wrangler dev --host portfolio.example.workers.dev --upstream-protocol https` makes `request.url` the public origin,
so the same-origin write check in `worker/index.mjs` keeps working.

## Runner folder (`~/committee-runner`, outside the repo and the review digest)

- `wrangler.toml`: copy of the root app config, `main` points at `dist/` (a symlink to this checkout's `dist/`).
- `.dev.vars` (mode 600): the same secrets the Worker had. Local file ownership is the trust boundary (AGENTS.md).
- `tunnel-token` (mode 600): connector token, passed with `cloudflared tunnel run --token-file`.
- `.wrangler/state`: the local D1. **After cutover this is the only live copy of the account.** The remote D1 is frozen.
- `backups/`: daily SQL dumps of the local D1.

## Deploy

`npm run deploy` builds the approved bundle into `dist/` (used by the Mac) and deploys `proxy/wrangler.toml` as
`portfolio`. Restart the Mac server after a build so it serves the new `CODE_DIGEST`; the scheduled workflow refuses
to run when the served digest differs from its checkout. Never `wrangler deploy` the root `wrangler.toml`.

## On-time schedule (`com.committee.dispatch`)

GitHub started every cron on 2026-10-19 2 to 5.5 hours late, so the phase gate skipped them all. The launchd job
`com.committee.dispatch` (`~/committee-runner/dispatch.sh`, plist in `~/committee-runner/launchd/`) fires at each
AGENTS.md slot in KST, for both New York UTC offsets, and runs
`gh workflow run scheduled-operation.yml --ref cloud-investment -f market=… -f scheduled=true` only for the slot
whose market-local time and weekday match, at most 20 minutes late. `scheduled=true` makes the dispatch take the
cron phase gate. The crons stay as a fallback: a cron that GitHub delays into a phase skips when a non-failed
dispatch for the same market already started in that phase window, and the server's `sessionRuns` key reuses a
completed session either way. `gh` uses the operator's keyring login; check `logs/com.committee.dispatch.log`.

## Availability

The site and every scheduled run need the Mac awake, online and on power. If the Mac or tunnel is down, the proxy
answers JSON 503 "Mac 서버에 연결하지 못했습니다" and scheduled runs fail instead of writing.

## Rollback

1. Stop the Mac server so nothing else writes.
2. Copy the local D1 back to remote D1 (dump, then load with a tool that accepts multi-hundred-KB statements;
   `wrangler d1 execute --local --file` rejects them with SQLITE_TOOBIG).
3. Restore root `name = "portfolio"`, review, and deploy the app bundle. The CPU limit problem returns.
