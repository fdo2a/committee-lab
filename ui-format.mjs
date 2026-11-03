// Pure display helpers kept out of app.mjs so node tests can import them without a DOM.

// Zero is neither gain nor loss, so it must not borrow the gain color.
export const tone = (x) => (x > 0 ? "positive" : x < 0 ? "negative" : "muted");

export function ff3Summary(ff3) {
  if (!ff3) return 'FF3 베타·R²·알파 t값 미확인';
  const number = x => Number.isFinite(x) ? x.toFixed(2) : '미확인';
  const r2 = Number.isFinite(ff3.r2) ? (ff3.r2 * 100).toFixed(1) + '%' : '미확인';
  return `FF3 위험 참고: 시장 베타 ${number(ff3.betas?.market)} · 규모(SMB) 베타 ${number(ff3.betas?.size)} · 가치(HML) 베타 ${number(ff3.betas?.value)} · R² ${r2} · 알파 t값 ${number(ff3.alphaT)}`;
}

export const CATALOG_PAGE_SIZE = 50;

// Clamps the offset so a narrower filter never leaves the view on an empty page.
export function paginate(rows, offset, size = CATALOG_PAGE_SIZE) {
  const last = Math.max(0, Math.floor((rows.length - 1) / size) * size);
  const start = Math.min(Math.max(0, offset), last);
  return { start, end: Math.min(start + size, rows.length), rows: rows.slice(start, start + size) };
}

// Mirrors the approve button's disabled condition so the reason shown always matches the gate.
export function approvalBlockReason(plan, rr) {
  const reasons = [];
  if (rr && !rr.pass) reasons.push("리스크 점검 미통과: " + rr.checks.filter(([, ok]) => !ok).map(([name]) => name).join(", "));
  return reasons.join(" · ");
}

// Plan creation holds an entry when it no longer fits after the other 대기 plans are reserved;
// the live risk check only counts approved plans, so on its own it can still pass.
export const heldByLimit = (plan, rr) => plan.status === "보류" && plan.riskReview?.status === "held" && !!rr?.pass;

const ACCOUNTS = { revenue: "매출", netIncome: "순이익", operatingCashFlow: "영업현금흐름", freeCashFlow: "잉여현금흐름", equity: "자본", debt: "부채", eps: "EPS", priorRevenue: "전년 매출" };
const PASSES = { businessPass: "사업 검증", numericPass: "수치 검증", fundamentalPass: "기업 검증" };
const SYMBOLS = { USD: "$", JPY: "¥", EUR: "€" };

function amount(v, currency, perShare) {
  const a = Math.abs(v);
  if (currency === "KRW") return perShare || a < 1e8 ? v.toLocaleString("ko-KR") + "원" : a >= 1e12 ? (v / 1e12).toFixed(1) + "조원" : Math.round(v / 1e8).toLocaleString("ko-KR") + "억원";
  const c = SYMBOLS[currency] ?? "";
  return perShare || a < 1e6 ? c + v.toLocaleString("en-US") : a >= 1e12 ? c + (v / 1e12).toFixed(2) + "T" : a >= 1e9 ? c + (v / 1e9).toFixed(1) + "B" : c + (v / 1e6).toFixed(1) + "M";
}

// Research reasons are free text written by the research model; older runs pasted raw collector output
// (key=value pairs, account JSON, ISO stamps, internal pass flags). Rewrite those into readable sentences.
export function readableReason(text) {
  const currency = /통화\s*=\s*([A-Z]{3})/.exec(text ?? "")?.[1] ?? "KRW";
  const ratio = (v) => {
    const n = Number(v);
    // ponytail: values up to 3 are treated as ratios (0.104 = 10.4%), larger ones as already in percent.
    return (Math.abs(n) <= 3 ? n * 100 : n).toFixed(1) + "%";
  };
  return String(text ?? "")
    .replace(/계정\s*=\s*(\{[^{}]*\})/g, (m, json) => {
      try {
        return Object.entries(JSON.parse(json)).map(([k, v]) => `${ACCOUNTS[k] ?? k} ${typeof v === "number" ? amount(v, currency, k === "eps") : v}`).join(" · ");
      } catch {
        return m;
      }
    })
    .replace(/fetchedAt\s*=\s*(\d{4}-\d{2}-\d{2})T[0-9:.]+(?:Z|[+-]\d{2}:?\d{2})?/g, "수집일 $1")
    .replace(/periodEnd\s*=\s*/g, "결산일 ")
    .replace(/periodType\s*=\s*12M/g, "연간")
    .replace(/periodType\s*=\s*3M/g, "분기")
    .replace(/통화\s*=\s*([A-Z]{3})/g, "통화 $1")
    .replace(/필수 누락\s*=\s*\[\]/g, "필수 항목 누락 없음")
    .replace(/([^\s,;:=]*(?:성장|성장률|ROE|ROA|마진|이익률|수익률))\s*=\s*(-?\d+(?:\.\d+)?)/g, (m, k, v) => `${k} ${ratio(v)}`)
    .replace(/([^\s,;:=]*(?:PER|PBR|EV\/EBITDA))\s*=\s*(-?\d+(?:\.\d+)?)/g, (m, k, v) => `${k} ${Number(v).toFixed(1)}배`)
    .replace(/(businessPass|numericPass|fundamentalPass)는\s*false로 유지/g, (m, k) => `${PASSES[k]} 미통과 유지`)
    .replace(/\b(businessPass|numericPass|fundamentalPass)\b/g, (k) => PASSES[k])
    .replace(/-?\d+\.\d{4,}/g, (v) => Number(v).toFixed(2))
    // One line per sentence and per "부서명:" entry of a joined department list.
    .split(/(?<=[.;])\s+|\s·\s(?=[^\s·:]{2,12}부:)/)
    .map((line) => line.replace(/;$/, "").trim())
    .filter(Boolean);
}

// Long reasons show their first lines and fold the rest.
export function reasonHtml(text, esc, visible = 3) {
  const lines = readableReason(text).map((line) => `<p>${esc(line)}</p>`);
  if (lines.length <= visible + 1) return `<div class="reason-lines">${lines.join("")}</div>`;
  return `<div class="reason-lines">${lines.slice(0, visible).join("")}<details class="reason-more"><summary>자세히 · ${lines.length - visible}줄 더</summary>${lines.slice(visible).join("")}</details></div>`;
}

// Sources stay one click away instead of filling the reading flow.
export function sourceFold(sources, esc) {
  const list = (sources ?? []).map((s) => (typeof s === "string" ? { url: s } : s)).filter((s) => s?.url);
  if (!list.length) return "";
  const host = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };
  return `<details class="source-fold"><summary>출처 ${list.length}개</summary><div>${list.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || host(s.url))}</a>`).join("")}</div></details>`;
}

// The 실적과 가치 card: the entry verdict first, then the checks behind it in plain words.
// reviews: [{label, pass}] with pass true, false (not finished) or null (not researched yet).
export function fundamentalSummary({ f, reviews = [], eligible, gap = null }) {
  // The stored entry result can be older than these checks; never show "가능" next to an unfinished check.
  const ok = eligible && f?.pass && reviews.every((x) => x.pass);
  const lines = [ok ? `결론: 편입 검토 가능 — 재무 숫자와 ${reviews.map((x) => x.label).join("·") || "검토"} 모두 통과` : `결론: 매수 보류 — ${gap ?? "다른 진입 조건 미충족"}`];
  if (!f) lines.push("· 재무 숫자: 아직 수집되지 않음");
  else {
    const m = f.metrics || {}, cur = f.currency, num = Number.isFinite;
    const failed = (f.checks || []).filter((x) => !x.pass).map((x) => x.name);
    lines.push(`· 재무 숫자: ${f.pass ? "기준 통과" : `기준 미달 (${failed.join(", ")})`}`);
    const facts = [
      num(m.revenue) && `매출 ${amount(m.revenue, cur)}${num(m.revenueGrowth) ? `(전년 대비 ${m.revenueGrowth >= 0 ? "+" : ""}${(m.revenueGrowth * 100).toFixed(1)}%)` : ""}`,
      num(m.netIncome) && `순이익 ${amount(m.netIncome, cur)}`,
      num(m.operatingCashFlow) && `영업현금흐름 ${amount(m.operatingCashFlow, cur)}`,
      num(m.pe) && `PER ${m.pe.toFixed(1)}배${num(m.peLimit) ? `(한도 ${m.peLimit}배)` : ""}`,
    ].filter(Boolean);
    const year = /^\d{4}/.exec(f.periodEnd ?? "")?.[0];
    if (facts.length) lines.push(`   ${year ? year + "년 연간 " : ""}${facts.join(", ")}`);
  }
  for (const { label, pass } of reviews) lines.push(`· ${label}: ${pass ? "통과" : pass === false ? "아직 끝나지 않음" : "조사 전"}`);
  if (!eligible && f?.pass && reviews.every((x) => x.pass)) lines.push("· 다른 진입 조건이 아직 남아 있음");
  return lines.join("\n");
}
