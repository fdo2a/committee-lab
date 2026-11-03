// Edge proxy for portfolio.example.workers.dev. The app itself runs on the operator's Mac (scripts outside this repo
// run `wrangler dev --local` on the approved dist bundle), because one account read needs far more than the
// free plan's 10ms CPU. Cloudflare Access still guards this hostname; the Mac re-verifies the forwarded Access JWT
// with worker/auth.mjs, so this proxy adds no trust of its own and only forwards bytes.
export default {
  async fetch(request, env) {
    // The VPC service reaches the Mac over plain http; host, path and query stay unchanged so the app sees
    // the public origin (wrangler dev --host rewrites it back to https for the same-origin write check).
    const url = new URL(request.url);
    url.protocol = "http:";
    try {
      return await env.MAC.fetch(new Request(url, request));
    } catch {
      return Response.json(
        { error: "Mac 서버에 연결하지 못했습니다. Mac 전원·네트워크·터널 상태를 확인하세요." },
        { status: 503, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
      );
    }
  },
};
