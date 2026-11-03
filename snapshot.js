// Read-only snapshot: serves the two GET routes the app reads from frozen JSON files and refuses every write.
(() => {
  const files = { "/api/account": "data/account.json", "/api/runs": "data/runs.json" };
  const loaded = {};
  const realFetch = window.fetch.bind(window);
  const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    const method = (init.method || "GET").toUpperCase();
    if (method !== "GET" || !files[url.pathname]) return json({ error: "읽기 전용 스냅샷이라 변경할 수 없습니다." }, 403);
    // The app polls every minute; the large account file is downloaded once and reused.
    loaded[url.pathname] ??= realFetch(files[url.pathname]).then((r) => r.text());
    return new Response(await loaded[url.pathname], { status: 200, headers: { "Content-Type": "application/json" } });
  };
  document.addEventListener("DOMContentLoaded", async () => {
    const bar = document.createElement("div");
    bar.className = "snapshot-bar";
    bar.textContent = "읽기 전용 스냅샷 · 페이퍼트레이딩(실제 자금 없음) · 버튼을 눌러도 변경되지 않습니다";
    document.body.prepend(bar);
    try {
      const meta = await (await realFetch("data/meta.json", { cache: "no-store" })).json();
      bar.textContent = `읽기 전용 스냅샷 · ${meta.asOf} KST 기준 데이터 · 4일마다 갱신 · 페이퍼트레이딩(실제 자금 없음) · 버튼을 눌러도 변경되지 않습니다`;
    } catch {}
  });
})();
