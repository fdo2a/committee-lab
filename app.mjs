import {executionBasis} from './execution.mjs';
import {tone,paginate,approvalBlockReason,heldByLimit,CATALOG_PAGE_SIZE,sourceFold,fundamentalSummary,readableReason,ff3Summary} from './ui-format.mjs';
import {ETF_ASSETS,assetPositions,assetValue,assetReceivables} from './asset-allocation.mjs';
import {investmentProcessPanel,processEvidencePanel} from './trend-view.mjs';
import {weeklyReportsPage} from './weekly-view.mjs';
import {
  INITIAL,
  FEE,
  SLIP,
  companies,
  activeCompanies,
  eligibleCatalog,
  CORE_SYMBOLS,
  depts,
  strategies,
  createState,
  technical,
  market,
  equity,
  exposure,
  unrealized,
  isEntry,
  sideLabel,
  drawdown,
  research,
  risk,
  approve,
  advance,
  requestExit,
  validateState,
  analyze,
  fxOf,
  markPrice,
  krwBars,
} from "./engine.mjs";
import {committeeReviewPanel,nominationsFor,reviewSymbols,entryGap} from "./committee-view.mjs";
import {departmentNames,businessResearch,ideaEntryCheck} from "./committee.mjs";
const KEY = "committee-lab-v2",
  root = document.querySelector("#app");
let state,
  serverReady = false,
  revision = 0,
  metadata = {},
  runs = [],
  legacyAvailable = false,
  storageWarning = "";
try {
  const raw = localStorage.getItem(KEY);
  legacyAvailable = !!raw;
  state = raw ? validateState(JSON.parse(raw)) : createState();
} catch {
  state = createState();
  storageWarning =
    "저장된 기록을 불러오지 못했습니다. 기존 저장 내용은 유지합니다. 내보내기로 새 기록을 보관하세요.";
}
let page = "dashboard",
  selected = activeCompanies(state)[0].symbol,
  dept = 0,
  filter = "전체",
  search = "",
  period = 30,
  detail = null,
  results = [],
  busy = false,
  country = "전체",
  catalogSearch = "",
  catalogCountry = "전체",
  catalogOffset = 0;
// keep-all still lets Chrome break between "%" and a Korean particle ("58%|에서");
// a word joiner (U+2060) glues them.
const esc = (x) =>
    String(x ?? "").replace(/%(?=[가-힣])/g, "%⁠").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    ),
  won = (x) => Math.round(x).toLocaleString("ko-KR") + "원",
  num = (x) => Math.round(x).toLocaleString("ko-KR"),
  pct = (x) => (x > 0 ? "+" : "") + (x * 100).toFixed(2) + "%",
  cOf = (s) => companies.find((c) => c.symbol === s)??ETF_ASSETS.find(c=>c.symbol===s),
  good = tone;
const sizeBadge = (company) => {
  if(!["mid", "small"].includes(company.sizeClass))return CORE_SYMBOLS.includes(company.symbol)?"":`<span class="badge">규모 미확인 한도 5%</span>`;
  const label=company.sizeClass==="mid"?"중형":"소형";
  const date=company.sizeEvidence?.asOf?.slice(0,10)||"규모 확인 대기";
  return `<span class="badge" title="${esc(date)} · 프로젝트 규모 기준">${label}</span>`;
};
const native = (value, symbol) =>
  new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: cOf(symbol).currency,
    maximumFractionDigits: cOf(symbol).currency === "USD" ? 2 : 0,
  }).format(value);
const paths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  people:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M9 3a4 4 0 1 0 0 8a4 4 0 0 0 0-8",
  committee: "M4 4h16v12H8l-4 4z M8 8h8 M8 12h5",
  check:
    "m9 11 3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  flask: "M9 3h6 M10 3v6L4 19q-1 2 2 2h12q3 0 2-2L14 9V3 M7 15h10",
  history: "M3 11a9 9 0 1 1 3 7 M3 3v8h8 M12 7v5l3 2",
  info: "M12 11v6 M12 7h.01 M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20",
  arrow: "M4 12h16 m-6-6 6 6-6 6",
  up: "M3 17l6-6 4 4 8-10 M15 5h6v6",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z m-4 9 3 3 5-6",
  search: "M11 3a8 8 0 1 0 0 16a8 8 0 0 0 0-16 M17 17l5 5",
  download: "M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5",
  play: "m8 4 12 8-12 8z",
  chevron: "m9 5 7 7-7 7",
  wallet: "M3 6h17v15H3z M3 6V3h14v3 M15 11h7v6h-7z",
  clock: "M12 2a10 10 0 1 0 0 20a10 10 0 0 0 0-20 M12 6v6l4 2",
  close: "m6 6 12 12 M6 18 18 6",
  refresh: "M20 7A9 9 0 1 0 21 15 M20 2v6h-6",
  calendar: "M3 5h18v16H3z M3 10h18 M8 3v4 M16 3v4",
};
function icon(k, cls = "") {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[k] || paths.grid}"/></svg>`;
}
function toast(t) {
  const el = document.querySelector("#toast");
  el.textContent = t;
  el.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => el.classList.remove("show"), 4200);
}
async function refreshServer() {
  try {
    const res = await fetch("/api/account", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw Error(data.error || "서버 연결 오류");
    const unchanged = serverReady && data.revision === revision && JSON.stringify(data.metadata) === JSON.stringify(metadata);
    lastSync = new Date();
    if (unchanged) {
      const el = root.querySelector(".sync-label");
      if (el) el.textContent = "갱신 " + syncTime();
    } else {
      state = validateState(data.state);
      revision = data.revision;
      metadata = data.metadata;
      serverReady = true;
      storageWarning = "";
      render();
    }
  } catch (e) {
    serverReady = false;
    storageWarning =
      "서버 계좌를 불러오지 못했습니다. 주문 변경을 중단합니다. " + e.message;
    render();
    return;
  }
  // History latency must not delay access to the verified account.
  try {
    const res = await fetch("/api/runs", { cache: "no-store" });
    if (res.ok) {
      runs = (await res.json()).runs;
      if (["journal", "about"].includes(page)) render();
    }
  } catch {}
}
async function perform(command) {
  if (busy || !serverReady) {
    toast("서버 계좌가 연결된 뒤 다시 시도하세요.");
    return;
  }
  busy = true;
  try {
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...command, expectedRevision: revision }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 409) await refreshServer();
      throw Error(data.error || "변경 실패");
    }
    state = validateState(data.state);
    revision = data.revision;
    metadata = data.metadata;
    render();
    toast("서버 계좌에 반영했습니다.");
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
  }
}
const seoulTime = (x) =>
  x
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(x))
    : "아직 없음";
const executionPriceLabel = side => executionBasis(side,state)==='regularClose'?"정규장 종가":"정규장 시가";
const executionWaitLabel = (plan) => plan.executionWaitReason || plan.waitReason || `다음 ${executionPriceLabel(plan.side)} 수집 대기`;
function automationPanel() {
  return `<section class="automation-panel"><div>${icon("refresh")}<b>${!serverReady ? "서버 연결 중" : metadata.paused ? "자동 운용 일시정지" : metadata.enabled ? metadata.sessionMode?"장전 · 개장 · 마감 자동 운용":"4시간마다 자동 운용" : "자동 운용 예약 준비 중"}</b><span>${state.executionPolicy?.version>=4?"장전 승인 · 개장 시가 매수":state.executionPolicy?.version===3?"장전 리서치·승인 · 마감 종가 매수":state.executionPolicy?.version===2?"이전 시가 체결 방식":"매수 종가 · 매도 시가"}</span></div><div><span>마지막 실행 <b>${seoulTime(metadata.lastRun)}${metadata.lastSession?' · '+({pre:'장전 리서치·승인',open:state.executionPolicy?.version>=4?'개장 시가 편입·위험 점검':'개장 위험 점검',close:state.executionPolicy?.version>=4?'마감 평가·위험 점검':'종가 매수·평가'}[metadata.lastSession.phase]):''}</b></span><span>다음 예정 <b>${metadata.enabled&&!metadata.paused?seoulTime(metadata.nextRun):"예약 중지·미등록"}</b></span><button class="btn" data-action="pause">${metadata.paused ? "자동 운용 재개" : "자동 운용 일시정지"}</button></div></section>`;
}
function departmentStatusPanel(){
 if(!state.departments?.length)return "";
 return `<details class="panel research-details spaced"><summary>최근 실행의 부서 결과 <span class="muted">${seoulTime(metadata.lastRun)}</span></summary><p class="muted">실행 기준의 기록입니다. 조사 준비 ${seoulTime(state.researchPreparedAt)} · 신규 편입은 현재 기업·계량·기술 검토와 운용 선정 필요</p><div class="reports-grid">${state.departments.map(d=>`<article class="report-card"><h3>${esc(d.name)} ${badge(d.status)}</h3><b>${esc(d.result)}</b><p>${esc(d.details)}</p></article>`).join("")}</div></details>`;
}
function fundamentalPanel(symbol){
 const f=state.fundamentals?.[symbol];if(!f)return "";
 const failed=f.checks.filter(x=>!x.pass).map(x=>x.name);
 return `<section class="panel spaced">${panelTitle("바텀업 검증 원장",badge(f.pass?"통과":"보류"))}<p class="verdict-line">${esc(f.pass?`통과 이유: 재무 기준 ${f.checks.length}개 모두 충족`:`보류 이유: ${failed.join(", ")}`)}</p><p class="muted">연간 재무 ${esc(f.periodEnd||"미확인")} · ${esc(f.currency)} · 가격 수집 시점 PER ${f.metrics.pe?.toFixed(1)||"미확인"}배</p><div class="checks">${f.checks.map(x=>`<div><span>${esc(x.name)}</span><b class="${x.pass?"positive":"negative"}">${x.pass?"통과":"보류"}</b></div>`).join("")}</div><p>${esc(f.text)}</p>${f.limitations?`<details class="evidence-details"><summary>확인하지 못한 정보</summary><p>${esc(f.limitations)}</p></details>`:""}</section>`;
}
function runHistoryPanel(){return `<section class="panel spaced">${panelTitle("자동 실행 기록",`<small>최근 ${runs.length}회</small>`)}${runs.length?`<div class="event-list">${runs.map(r=>`<div><small>${seoulTime(r.started_at)}</small><span>${badge(r.status==="complete"?"완료":r.status==="failed"?"실패":"진행 중")} ${r.report.summary?`통합 후보 ${r.report.summary.nominated??r.report.summary.screened}개 · 승인 ${r.report.summary.approved}건 · 체결 ${r.report.summary.newExecutions}건 · ${won(r.report.summary.equity)} ${esc(r.report.summary.noTradeReason||"")}`:esc(r.report.message)}</span></div>`).join("")}</div>`:'<p class="muted">아직 저장된 자동 실행 기록이 없습니다.</p>'}</section>`;}
function learningPanel(){
 const list=Object.entries(state.strategyLearning||{}).filter(([_,v])=>v.closed>0);
 return `<section class="panel spaced">${panelTitle("운용 기준 조정")}<p>투자 규모 ${(state.policy?.riskScale*100||100).toFixed(0)}% · ${esc(state.policy?.reason||"거래 결과 대기")}</p>${list.map(([id,v])=>`<p>${esc(id)} · 청산 ${v.closed}회 · 실현 ${won(v.netPnl)} · ${esc(v.reason)}</p>`).join("")}</section>`;
}
function assetPanel(){
 const e=equity(state),book=exposure(state),positions=assetPositions(state);
 return `<section class="panel spaced">${panelTitle("자산 배분",badge("주식 · 채권 ETF · 현금"))}<div class="research-summary">${[["주식 롱",book.long+book.equityEtfs],["채권 ETF",book.bonds],["현금",state.cash],["주식 숏 의무",book.short]].map(([label,v])=>`<div><b>${won(v)}</b><span>${label} · ${e>0?(v/e*100).toFixed(1)+"%":"—"}</span></div>`).join("")}</div>${holdingsPanel()}<p class="muted">기본 유휴자금 배분: 한국 단기채 60% · 미국 0–3개월 국채 25% · 일본 0–1년 국채 5% · 현금 10%. 채권 ETF 합계는 계좌의 50% 이내로 같은 비율 축소. 주식 승인 주문·숏 증거금 우선 확보. ETF는 채권 10개만 신규 편입. 중장기채·회사채·하이일드는 근거 있는 목표 비중으로 편입. 총노출 한도 100% · ETF 주문은 20일 평균 거래대금의 1% 이내.</p><details><summary>배분 판단·위험·체결 기록</summary><p>${esc(state.assetAllocation?.decision?.reason??"기본 유휴자금 배분")} · ${esc(state.assetAllocation?.decision?.risks??"국가별 금리·신용·환율 위험 비교")}</p><p>중장기·회사채 합산 유휴자금 40% 이내, 일반 ETF 개별 20%·하이일드 개별 10%. 기본 단기채 이외 상품은 평가손실 10%·보유 90일 도달 시 다음 시가 청산. TLTW·JEPI·JEPQ는 신규 편입 제외. 기존 보유는 승인 이후 확인되는 정규장 시가에 청산하며 거래·분배금 기록은 보존합니다.</p><p>USD·JPY 환율 위험 및 채권 가격·금리·유동성 위험. 모의 매매는 수집 시점 실제 환율로 원화 환산합니다. 분배금 미수금 ${won(assetReceivables(state))}, 지급일 확인 전 가용 현금에 포함하지 않습니다.</p>${positions.flatMap(a=>a.trades).sort((a,b)=>b.executionTime-a.executionTime).slice(0,30).map(t=>`<p>${esc(t.date)} · ${esc(ETF_ASSETS.find(a=>a.symbol===t.symbol).name)} ${t.side==='buy'?"매수":"매도"} ${num(t.qty)}주 · ${won(t.price)} · ${t.executionBasis==='regularClose'?"정규장 종가":"정규장 시가"}</p>`).join("")||'<p class="muted">체결 기록 없음</p>'}</details>${state.assetAllocation?.collectionFailures?.length?`<p class="negative">가격·환율 확인 실패: ${state.assetAllocation.collectionFailures.map(f=>esc(f.symbol)).join(" · ")}</p>`:""}</section>`;
}
function marketReportsPanel(){
 const bundle=state.marketReports,r=state.externalResearch;
 return `<section class="panel spaced">${panelTitle("미국·한국·일본 시황 보고서",'<button class="btn" data-action="refresh-reports">최신 보고서 수집</button>')}<div class="research-columns">${(bundle?.reports??[]).map(report=>`<article><h3>${esc(report.market)} · ${esc(report.date??"미확인")}</h3>${report.url?`<a href="${esc(report.url)}" target="_blank" rel="noopener noreferrer">${esc(report.title)}</a>`:""}<p>${esc(report.headline??report.message)}</p>${report.status==='unavailable'||report.status==='stale'?'<p class="negative">최신성 확인 필요, 현재 시황으로 간주하지 않습니다.</p>':""}<details><summary>보고서 금리·환율 및 판단 근거</summary>${(report.brief?.ratesAndFx??[]).map(v=>`<p>${esc(v.label)} <b>${esc(v.value)}</b> · 변화 ${esc(v.change??"—")} · ${esc(v.asOf??report.date)} 기준</p>`).join("")}${(report.brief?.commentary??[]).map(p=>`<p>${esc(p.text)}</p>`).join("")}</details></article>`).join("")||'<p class="muted">보고서 수집 대기</p>'}</div><p class="muted">보고서 수집 ${seoulTime(bundle?.fetchedAt)} · 외부 작성자의 시장 해석. 보고서 금리·환율은 기준일을 유지해 판단에 재사용하고, 주문 환산에는 별도 수집 환율을 사용합니다.</p><div class="research-decision"><b>투자 판단 반영</b><p>${esc(r?.marketReportReview??"반영 검토 대기, 수집만으로 매매 결정을 내리지 않습니다.")}</p></div></section>`;
}
function externalResearchPanel() {
 const r=state.externalResearch;
 if(!r)return `<section class="panel external-research">${panelTitle("시장·기업 조사",badge("조사 대기"))}</section>`;
 return `<section class="panel external-research">${panelTitle("시장·기업 조사",`<small class="muted">${esc(r.asOf)}</small>`)}<div class="research-decision"><b>이번 판단</b><p>${esc(r.decision)}</p></div><details class="research-details"><summary>조사 근거</summary><div class="research-columns">${[["탑다운",r.topDown],["바텀업",r.bottomUp],["마켓부",r.marketReview],["리스크관리부",r.riskReview]].map(([label,text])=>`<article><h3>${label}</h3><p>${esc(text||"조사 대기")}</p></article>`).join("")}</div>${r.limitations?`<div class="research-decision"><b>확인하지 못한 정보</b><p>${esc(r.limitations)}</p></div>`:""}</details><div class="source-links">${sourceFold(r.sources,esc)}</div></section>`;
}
function badge(t, type = "") {
  return `<span class="badge ${type || (["상승", "통과", "체결", "승인"].includes(t) ? "green" : ["보류", "하락", "거절"].includes(t) ? "amber" : "")}" >${esc(t)}</span>`;
}
const nav = [
  ["dashboard", "grid", "운용 현황"],
  ["departments", "people", "부서별 조사"],
  ["catalog", "search", "전체 후보 종목"],
  ["committee", "committee", "투자위원회"],
  ["approvals", "check", "자동 운용 계획"],
  ["strategies", "flask", "전략 연구실"],
  ["journal", "history", "거래 기록 · 복기"],
  ["weekly", "calendar", "주간 운용보고서"],
  ["about", "info", "계좌 관리"],
];
function spark(values, color = "#0ecb81") {
  let min = Math.min(...values),
    max = Math.max(...values),
    range = max - min || 1;
  const p = values
    .map(
      (v, i) =>
        `${(i / (values.length - 1)) * 80},${26 - ((v - min) / range) * 23}`,
    )
    .join(" ");
  return `<svg class="spark" viewBox="0 0 80 30" aria-hidden="true"><polyline points="${p}" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`;
}
function chart() {
  const compact = window.innerWidth < 760,
    width = compact ? Math.max(220, window.innerWidth - (window.innerWidth <= 450 ? 132 : 162)) : 780,
    left = compact ? 60 : 64,
    right = width - 20,
    labelSize = compact ? 14 : 16,
    h = state.history.slice(-period),
    series = h.length > 1 ? h : [{ ...h[0], date: "시작" }, h[0]],
    values = series.flatMap((x) => [x.equity, x.benchmark]),
    lo = Math.min(...values) * 0.997,
    hi = Math.max(...values) * 1.003,
    range = hi - lo || 1;
  const coords = (k) =>
    series.map((x, i) => [
      left + (i / (series.length - 1)) * (right - left),
      180 - ((x[k] - lo) / range) * 150,
    ]);
  const p = coords("equity"),
    b = coords("benchmark"),
    path = (a) => a.map((x, i) => (i ? "L" : "M") + x.join(" ")).join(" ");
  return `<svg class="equity-chart" viewBox="0 0 ${width} 225" role="img" aria-label="가상 계좌와 동일가중 참고 바스켓의 자산 추이">${[
    0, 1, 2, 3,
  ]
    .map((i) => {
      const y = 30 + i * 50;
      return `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#2b3139"/><text x="0" y="${y + 4}" fill="#707a8a" font-size="${labelSize}">${((hi - (range * i) / 3) / 10000).toFixed(0)}만</text>`;
    })
    .join(
      "",
    )}<path d="${path(b)}" fill="none" stroke="#707a8a" stroke-width="2" stroke-dasharray="5 5"/><path d="${path(p)}" fill="none" stroke="#fcd535" stroke-width="2.8"/><circle cx="${p.at(-1)[0]}" cy="${p.at(-1)[1]}" r="4" fill="#fcd535"/>${[0, series.length > 2 ? Math.floor((series.length - 1) / 2) : null, series.length - 1].map((i, j) => i === null ? "" : `<text x="${left + j * (right-left) / 2}" y="215" text-anchor="${j === 0 ? "start" : j === 2 ? "end" : "middle"}" fill="#707a8a" font-size="${labelSize}">${esc(series[i].date)}</text>`).join("")}</svg>`;
}
function panelTitle(title, extra = "") {
  return `<div class="panel-heading"><h2>${title}</h2>${extra}</div>`;
}
function exposurePanel(){
 const b=exposure(state),borrow=state.holdings.reduce((a,h)=>a+(h.borrowAccrued||0),0);
 return `<section class="panel spaced exposure-panel">${panelTitle("계좌 노출",state.insolvent?badge("순자산 소진 · 신규 진입 중단"):"")}<div class="research-summary"><div><b>${won(b.long)}</b><span>롱 평가금액</span></div><div><b>${won(b.short)}</b><span>숏 상환 의무</span></div><div><b>${b.grossRatio===null?"—":pct(b.grossRatio)}</b><span>총노출 · 한도 100%</span></div><div><b>${b.netRatio===null?"—":pct(b.netRatio)}</b><span>순노출 · 절댓값 한도 80%</span></div></div><p class="muted">가용 현금 ${won(b.availableCash)} · 숏 증거금 ${won(b.margin)} · 상환 준비금 ${won(b.restrictedProceeds)} · 보유 숏 누적 대차료 ${won(borrow)}</p></section>`;
}
function researchReadinessPanel(){
 const r=state.analysis?.researchReadiness;
 if(!r)return `<section class="readiness-strip">${badge("조사 상태 미확인")}<span>기준 ${esc(state.analysis?.date||state.date)}</span></section>`;
 const factors={leading:"선행지표",growth:"성장",inflation:"물가",policy:"정책",liquidity:"유동성"};
 const missing=(r.missing||[]).map(m=>`<li><b>${esc(m.region)} ${esc(factors[m.field]||m.field||m.kind)}</b><span>${esc(m.reason)}</span></li>`).join("");
 return `<section class="readiness-strip">${badge(r.complete?"조사 완료":"조사 보완 필요",r.complete?"green":"amber")}<span>검토 완료 바스켓 ${r.readyUnitIds?.length??0}개 · 바스켓별 독립 심사</span><div class="readiness-regions">${(r.regions||[]).map(x=>`<span>${esc(x.region)} <b class="${x.complete?"positive":"negative"}">${x.complete?"완료":`${x.missing?.length||0}건 미확인`}</b></span>`).join("")}</div>${missing?`<details><summary>미확인 ${r.missing.length}건</summary><ul class="missing-list">${missing}</ul></details>`:""}</section>`;
}
function holdingsPanel(){
 const holdings=[...state.holdings.filter(h=>h.qty>0),...assetPositions(state).filter(a=>a.qty>0)];
 return `<div class="spaced holdings-panel">${panelTitle("현재 보유 자산",`<button class="text-button" data-page="journal">${holdings.length}개 자산 · 거래 기록 ${icon("arrow")}</button>`)}${holdings.length?`<div class="table-scroll"><table><thead><tr><th>자산</th><th>종류 · 방향</th><th class="numeric">수량</th><th class="numeric">평균단가 · 원화</th><th class="numeric">현재가 · 원화</th><th class="numeric">평가금액</th><th class="numeric">평가손익 · 수익률</th></tr></thead><tbody>${holdings.map(h=>{
  const c=cOf(h.symbol),etf=ETF_ASSETS.find(a=>a.symbol===h.symbol),price=etf?h.quote.price:markPrice(state,h.symbol),fx=etf?h.fx.rate:fxOf(h.symbol,state),value=h.qty*price*fx,pnl=etf?value-h.cost:unrealized(state,h);
  const name=etf?`<a href="${esc(c.source)}" target="_blank" rel="noopener noreferrer"><b>${esc(c.name)}</b></a>`:`<button class="stock-link" data-symbol="${esc(h.symbol)}"><b>${esc(c.name)} ${sizeBadge(c)}</b></button>`;
  return `<tr><td>${name}<small class="table-sub">${esc(c.country)} · ${esc(c.symbol)} · ${esc(c.currency)}</small></td><td>${badge(etf?`${c.assetClass==='bond'?'채권':'주식'} ETF`:h.direction==='short'?"주식 숏":"주식 롱")}</td><td class="numeric">${num(h.qty)}주</td><td class="numeric">${won(h.cost/h.qty)}</td><td class="numeric">${won(price*fx)}${c.currency!=='KRW'?`<small class="table-sub">${native(price,h.symbol)}</small>`:""}</td><td class="numeric">${won(value)}</td><td class="numeric ${good(pnl)}">${won(pnl)}<small class="table-sub ${good(pnl)}">${h.cost>0?pct(pnl/h.cost):"—"}</small></td></tr>`;
 }).join("")}</tbody></table></div><p class="muted">평균단가는 보유 원가를 수량으로 나눈 원화 금액입니다. 평가손익은 비용·환율을 반영하며 숏은 누적 대차료를 차감합니다. ETF 분배금 미수금은 별도입니다.</p>`:'<div class="empty compact">보유 자산 없음</div>'}</div>`;
}
function dashboard() {
 const e=equity(state),book=exposure(state),m=market(state,country),open=state.plans.filter(p=>["대기","승인","보류"].includes(p.status)),pnl=e-INITIAL,dd=drawdown(state.history.map(h=>h.equity)),rank=state.analysis.reports.filter(r=>(country==="전체"||cOf(r.symbol).country===country)&&nominationsFor(state,r).length).sort((a,b)=>(b.candidateScore??0)-(a.candidateScore??0));
 return `<div class="intro"><h1>운용 현황</h1><span class="muted">${esc(state.date)} 기준</span></div><div class="stats"><article><span>총 자산</span><strong>${num(e)}<small>원</small></strong><div class="${good(pnl)}">${pct(e/INITIAL-1)} <span class="muted">누적 수익률</span></div></article><article><span>누적 손익</span><strong class="${good(pnl)}">${num(pnl)}<small>원</small></strong><div class="muted">평가·실현 손익 및 비용 반영</div></article><article><span>가용 현금</span><strong>${num(book.availableCash)}<small>원</small></strong><div class="muted">보유 ${state.holdings.filter(h=>h.qty>0).length+assetPositions(state).filter(a=>a.qty>0).length}개 자산 · 총노출 ${book.grossRatio===null?"—":pct(book.grossRatio)}</div></article><article><span>진행 중 주문</span><strong>${open.length}<small>건</small></strong><button class="text-button" data-page="approvals">운용 계획 ${icon("arrow")}</button></article></div>${automationPanel()}<div class="dashboard-grid"><section class="panel performance">${panelTitle("자산 추이",`<div class="segmented">${[7,30,90].map(n=>`<button data-period="${n}" class="${period===n?'active':''}">${n}일</button>`).join("")}</div>`)}<div class="chart-legend"><span><i class="dot sage"></i>모의계좌</span><span><i class="dot gray"></i>동일가중 바스켓</span><span>최대낙폭 ${(dd*100).toFixed(2)}%</span></div>${chart()}</section><section class="panel market-card">${panelTitle("시장 현황",badge(m.regime))}<div class="country-bar market-filter">${["전체","한국","미국","일본"].map(n=>`<button data-country="${n}" class="${country===n?'active':''}">${n}</button>`).join("")}</div><div class="market-measures"><div><span>60일 평균 위</span><b>${Math.round(m.breadth*m.count)} / ${m.count}종목</b></div><div class="meter"><i style="width:${m.breadth*100}%"></i></div><div><span>20일 모멘텀</span><b class="${good(m.momentum)}">${pct(m.momentum)}</b></div><div><span>USD / KRW</span><b>${num(state.fx?.USD??1400)}</b></div><div><span>JPY / KRW</span><b>${(state.fx?.JPY??9.5).toFixed(2)}</b></div></div></section><section class="panel candidates">${panelTitle("검토 후보",`<button class="text-button" data-page="committee">투자위원회 ${icon("arrow")}</button>`)}${rank.length?`<div class="table-scroll"><table><thead><tr><th>종목</th><th class="numeric">수집 가격</th><th class="numeric">등락</th><th>제안 부서</th></tr></thead><tbody>${rank.slice(0,4).map(r=>{const c=cOf(r.symbol);return `<tr><td><button class="stock-link" data-symbol="${c.symbol}"><span><b>${esc(c.name)} ${sizeBadge(c)}</b><small>${esc(c.country)} · ${esc(c.symbol)}</small></span></button></td><td class="numeric">${native(r.p/fxOf(c.symbol,state),c.symbol)}</td><td class="numeric ${good(r.change)}">${pct(r.change)}</td><td>${esc(nominationsFor(state,r).map(d=>departmentNames[d]).join(" · "))}</td></tr>`}).join("")}</tbody></table></div>`:'<div class="empty compact">검토 후보 없음</div>'}</section><section class="panel activity">${panelTitle("최근 판단")}<div class="timeline">${state.events.slice(0,3).map((x,i)=>`<div><i class="timeline-dot ${i===0?'current':''}"></i><small>${esc(x.date)}</small><p>${esc(x.text)}</p></div>`).join("")}</div></section></div>${assetPanel()}${marketReportsPanel()}${researchReadinessPanel()}${departmentStatusPanel()}`;
}
// Mirrors entryEligible: v5 gates on the idea's 기업·기술 reviews and 운용 selection, older accounts on businessPass.
function fundamentalReviews(symbol) {
  if (state.investmentProcessVersion >= 5) {
    // Same unit lookup as the engine's entry check; stored reports predate any field we could add.
    const ideaId = state.externalResearch?.trendUnits?.find((u) => u.action === "hold" && u.members.some((m) => m.symbol === symbol))?.ideaId;
    return [{ label: "기업·기술 검토와 운용 선정", pass: ideaId ? ideaEntryCheck(state, symbol, ideaId).pass : null }];
  }
  const b = businessResearch(state, symbol);
  return [{ label: "사업 검토", pass: b ? b.businessPass === true : null }];
}
function report(symbol, i) {
  const c = cOf(symbol),
    t = technical(krwBars(state, symbol)),
    m = market(state, c.country),
    r = state.analysis.reports.find((x) => x.symbol === symbol),
    p = state.plans.filter((x) => x.symbol === symbol).at(-1),
    rr = p && isEntry(p) ? risk(state, p) : null;
  const parts = [
    [
      "후보 발굴",
      `탑다운 점수 ${r.score??"미확인"}/100 · 아이디어 후보 발굴`,
      `탑다운: ${r.topDownReason}\n후보 발굴: ${r.screeningReason}`,
      `${activeCompanies(state).length}개 가격 수집 종목을 검토합니다.`,
    ],
    [
      "추세와 모멘텀",
      `${t.trend} 추세 · 기술 점수 ${r.technicalScore}/100`,
      `20일 평균 ${num(t.ma20)}원, 60일 평균 ${num(t.ma60)}원입니다. 20일 모멘텀 ${pct(t.momentum)}, 연환산 변동성 ${(t.vol * 100).toFixed(1)}%로 계산했습니다.`,
      `이동평균은 후행합니다. 가격이 20일 평균 아래로 내려가면 추세 가정을 재검토합니다.`,
    ],
    [
      "실적과 가치",
      state.mode==='live'?'공시·실적 조사':`예시 PER ${c.pe}배`,
      state.mode==='live'?fundamentalSummary({f:state.fundamentals?.[symbol],reviews:fundamentalReviews(symbol),eligible:r.fundamentalPass,gap:entryGap(state,symbol)}):`실적 성장률 ${c.growth}%, 부채비율 ${c.debt}%라는 가상 입력을 사용합니다. ${c.growth > 0 ? "성장 방향은 긍정적이지만 가격에 반영된 기대를 확인해야 합니다." : "성장 둔화를 가격 움직임만으로 상쇄할 수 없습니다."}`,
      state.mode==='live'?[...readableReason(r.bottomUpReason),state.fundamentals?.[symbol]?.limitations].filter(Boolean).join("\n"):`재무 수치는 실제 공시가 아닌 UI 시연용 가정입니다. 금융업 부채비율 0은 미제공 표시이며 비교에 사용하지 않습니다. 공시·현금흐름·업종별 가치평가를 연결하기 전에는 실제 가치 검증으로 해석할 수 없습니다.`,
      state.mode==='live'?'사업 검토 메모':undefined,
    ],
    [
      "시장 국면과 전략",
      `${m.regime} 국면`,
      `가격이 60일 평균 위에 있는 종목의 비율은 ${(m.breadth * 100).toFixed(0)}%입니다.`,
      `${c.country} 가격 수집 종목 ${activeCompanies(state).filter(x=>x.country===c.country).length}개 기준입니다.`,
    ],
    [
      "위험 심사",
      rr ? (rr.pass ? "조건부 통과" : "보류") : "계획 대기",
      rr
        ? `${rr.pass ? "통과 이유: 위험 기준 모두 충족" : `보류 이유: ${rr.checks.filter(([, ok]) => !ok).map(([name]) => name).join(", ")}`}\n예상 투자비중 ${(rr.weight * 100).toFixed(2)}%, 계획 손실 ${won(rr.loss)}입니다.`
        : `계획 대기: ${p ? "진입 계획이 아니어서 편입 위험 심사 대상 아님" : "운용부 매매 계획이 아직 없음"}`,
      r.risks,
    ],
    [
      "최종 매매 계획",
      p
        ? `${sideLabel(p.side)} ${p.qty}주 · ${p.status} · ${executionPriceLabel(p.side)}`
        : "현재 제안 없음",
      p
        ? `${p.status}: ${p.reason}\n전략 ${p.strategy}, 기준가 ${num(p.reference)}원, 손절 ${num(p.stop)}원, 목표 ${num(p.target)}원입니다.`
        : `제안 없음 이유: ${entryGap(state, symbol) ?? "운용부 선정 조건 미충족"}`,
      state.executionPolicy?.version>=4?`장전 승인된 매수·숏은 해당 거래일 개장 시가로 체결하며, 체결 직전 계좌 하드 한도(현금·노출·손실)만 재검사합니다.`:`자동 위험 심사 후 가격 시점이 새로 갱신된 다음 실행에서 재검사합니다. 기준가 대비 3% 넘는 변화 또는 위험 기준 초과 시 거래를 보류합니다.`,
    ],
  ];
  parts.push(["후보 계량 순위",r.quant?.ready?`아이디어 후보 ${r.quant.rank}위 · ${r.quant.style.score.toFixed(1)}점`:"팩터 자료 미확인 · 선정 후순위",r.quant?`가치·ROE·매출성장·방향별 가격모멘텀·FF3 알파 5요소 각 20%, 알파 미확인 시 4요소 각 25%. ${ff3Summary(r.quant.ff3)}. 운용 결정: ${r.quant.selectionReason}.`:"원본 아이디어 후보의 실제 재무·가격이 필요합니다.","규모·배당·이익전망 수정치는 미수집입니다. 계량 순위는 기업 검증·진입 신호·위험 한도를 대체하지 않습니다."]);
  return parts[i];
}
function reportCard(i, symbol) {
  const d = depts[i],
    r = report(symbol, i);
  return `<article class="report-card"><div class="report-top"><span class="dept-icon tone-${i}">${icon(["search", "up", "wallet", "grid", "shield", "committee", "flask"][i])}</span><span><small>${d[0]}</small><h3>${r[0]}</h3></span>${badge(r[1], i === 4 ? "amber" : "")}</div><p>${esc(r[2].includes("\n") ? r[2] : readableReason(r[2]).join("\n"))}</p><details class="evidence-details"><summary>${esc(r[4]||"위험·반대 근거")}</summary><p>${esc(r[3].includes("\n") ? r[3] : readableReason(r[3]).join("\n"))}</p></details><small class="muted">${state.analysis.date} 기준</small></article>`;
}
function departments() {
  return `<div class="page-title"><h1>부서별 조사</h1></div><div class="department-tabs">${depts.map((d, i) => `<button class="${dept === i ? "active" : ""}" data-dept-only="${i}">${icon(["search", "up", "wallet", "grid", "shield", "committee", "flask"][i])}${d[0]}</button>`).join("")}</div><div class="dept-summary panel"><span class="dept-icon large tone-${dept}">${icon(["search", "up", "wallet", "grid", "shield", "committee", "flask"][dept])}</span><div><h2>${depts[dept][0]}</h2><p>${esc(depts[dept][2])}</p></div>${badge("규칙 기반 분석")}</div><div class="selector-row"><label>분석 종목 <select id="symbol-select">${activeCompanies(state).map((c) => `<option value="${c.symbol}" ${c.symbol === selected ? "selected" : ""}>${c.name}</option>`).join("")}</select></label><span class="muted">분석 기준 ${state.analysis.date}</span></div>${reportCard(dept, selected)}${processEvidencePanel(state,selected,{esc})}${committeeReviewPanel(state,selected,{esc,badge})}${
    dept === 0
      ? `<section class="panel spaced">${panelTitle("종목별 검토 점수")}<div class="rank-list">${state.analysis.reports
          .slice()
          .sort((a, b) => b.score - a.score)
          .map(
            (r) =>
              `<button data-symbol="${r.symbol}"><b>${cOf(r.symbol).name}</b><div class="meter"><i style="width:${r.score}%"></i></div><span>${r.score??"—"}</span>${badge(r.trend)}</button>`,
          )
          .join("")}</div></section>`
      : dept === 4
        ? riskPanel(selected)
        : ""
  }`;
}
function riskPanel(symbol) {
  const p = state.plans
    .filter((x) => x.symbol === symbol && isEntry(x))
    .at(-1);
  if (!p) return "";
  const r = risk(state, p);
  const failed = r.checks.filter(([, pass]) => !pass).map(([name]) => name);
  return `<section class="panel spaced">${panelTitle("위험 기준 점검", badge(r.pass ? "통과" : "보류"))}<p class="verdict-line">${esc(r.pass ? `통과 이유: 위험 기준 ${r.checks.length}개 모두 충족` : `보류 이유: ${failed.join(", ")}`)}</p><div class="checks">${r.checks.map(([name, pass]) => `<div><span>${name}</span><b class="${pass ? "positive" : "negative"}">${pass ? "✓ 통과" : "× 보류"}</b></div>`).join("")}</div></section>`;
}
function committee() {
  // Shared research first; stock buttons only for stocks under review, since the rest show identical defaults.
  const shared = `${investmentProcessPanel(state,{esc,badge})}${externalResearchPanel()}`,
    symbols = reviewSymbols(state);
  if (!symbols.length) return `<div class="page-title"><h1>투자위원회</h1></div>${shared}<section class="panel spaced"><div class="empty compact">심사 중인 종목 없음</div></section>`;
  const sym = symbols.includes(selected) ? selected : symbols[0],
    c = cOf(sym),
    t = technical(krwBars(state, sym));
  return `<div class="page-title"><h1>투자위원회</h1></div>${shared}<div class="panel-heading committee-stocks"><h2>종목별 심사</h2><span class="muted">${symbols.length}개 종목</span></div><div class="company-pills">${symbols.map(cOf).map((c) => `<button class="${sym === c.symbol ? "active" : ""}" data-committee-symbol="${c.symbol}">${c.name}</button>`).join("")}</div><div class="panel company-heading"><span class="stock-avatar large">${c.name[0]}</span><div><h2>${c.name} ${sizeBadge(c)}</h2><span class="muted">${c.country} · ${c.symbol} · ${c.currency}</span></div><div class="company-price"><strong>${num(t.p)}<small>원</small></strong><span class="${good(t.change)}">${native(t.p / fxOf(c.symbol,state), c.symbol)} · ${pct(t.change)}</span></div>${spark(state.data[sym].slice(-30).map((b) => b.close))}<button class="btn" data-page="approvals">매매 계획 검토 ${icon("arrow")}</button></div>${committeeReviewPanel(state,sym,{esc,badge})}<div class="reports-grid">${depts.map((_, i) => reportCard(i, sym)).join("")}</div>${riskPanel(sym)}${fundamentalPanel(sym)}`;
}
function approvals() {
  const plans = state.plans
    .filter((p) => filter === "전체" || p.status === filter)
    .slice()
    .reverse();
  return `<div class="page-title"><h1>자동 운용 계획</h1><span class="muted">${state.executionPolicy?.version>=4?"장전 승인 · 개장 시가 체결":state.executionPolicy?.version===3?"장전 승인 · 마감 종가 체결":state.executionPolicy?.version===2?"이전 시가 체결 방식":"매수 종가 · 매도 시가"}</span></div><div class="toolbar"><div class="segmented">${["전체", "대기", "승인", "보류", "체결", "만료"].map((f) => `<button data-filter="${f}" class="${filter === f ? "active" : ""}">${f}</button>`).join("")}</div><button class="btn primary" data-action="advance" disabled title="Python 클라우드 예약 작업에서 실행합니다.">${icon("play")} 자동 실행 대기</button></div><div class="plans">${
    plans.length
      ? plans
          .map((p) => {
            const c = cOf(p.symbol),
              rr = isEntry(p) ? risk(state, p) : null,
              actionable =
                ["대기", "보류"].includes(p.status) && p.date === state.date,
              blocked = approvalBlockReason(p, rr);
            return `<article class="panel plan"><div class="plan-top"><div class="stock-title"><span class="stock-avatar">${c.name[0]}</span><div><h2>${c.name}</h2><small>${p.id} · ${p.date} · ${p.strategy} · ${executionPriceLabel(p.side)}</small></div></div>${badge(p.status)}</div><div class="plan-numbers"><div><span>제안</span><b>${sideLabel(p.side)} ${num(p.qty)}주</b></div><div><span>기준 가격</span><b>${num(p.reference)}원</b></div><div><span>손절 / 목표</span><b>${num(p.stop)} / ${num(p.target)}</b></div><div><span>예상 투자비중</span><b>${rr ? (rr.weight * 100).toFixed(1) + "%" : "보유분 청산"}</b></div></div>${heldByLimit(p, rr) ? `<p class="verdict-line negative">보류: 다른 대기 계획을 먼저 반영하면 계좌 한도를 넘습니다. 지금 승인하면 이 계획이 한도를 먼저 사용합니다.</p>` : ""}<p class="muted">${esc(p.reason)}</p>${rr ? `<details class="check-summary"${rr.pass ? "" : " open"}><summary class="${heldByLimit(p, rr) ? "muted" : rr.pass ? "positive" : "negative"}">${heldByLimit(p, rr) ? "단독 기준 " : ""}리스크 점검 ${rr.checks.filter(([, b]) => b).length}/${rr.checks.length} 통과</summary><div class="inline-checks">${rr.checks.map(([n, b]) => `<span class="${b ? "positive" : "negative"}">${b ? "✓" : "×"} ${n}</span>`).join("")}</div></details>` : ""}<div class="plan-actions"><button class="text-button" data-symbol="${p.symbol}">${depts.length}개 부서 근거 보기 ${icon("arrow")}</button>${actionable ? `<button class="btn" data-reject="${p.id}">반려</button>${blocked ? `<span class="block-reason" id="block-${p.id}">${esc(blocked)}</span>` : ""}<button class="btn primary" data-approve="${p.id}" ${blocked ? `disabled aria-describedby="block-${p.id}"` : ""}>${icon("check")} 모의 ${sideLabel(p.side)} 승인</button>` : p.status === "승인" ? `<span class="muted">${esc(executionWaitLabel(p))}</span><button class="btn" data-cancel="${p.id}">승인 취소</button>` : ""}</div></article>`;
          })
          .join("")
      : `<div class="empty">${icon("check")}<h3>이 상태의 계획이 없습니다.</h3></div>`
  }</div>`;
}
function strategiesPage() {
  results = research(state);
  const list = results.filter(
    (s) =>
      (filter === "전체" || filter === s.regime) &&
      (!search || `${s.id} ${s.family} ${s.size}`.includes(search)),
  );
  return `<div class="page-title"><h1>전략 연구실 <span class="title-count">${results.length}</span></h1></div><div class="research-summary"><div><b>${results.filter((s) => s.pass).length}</b><span>전체 관찰종목 기준 통과</span></div><div><b>${activeCompanies(state).length}</b><span>가격 수집 종목</span></div><div><b>${state.data[activeCompanies(state)[0].symbol].length - (results[0]?.split || 180)}</b><span>평가 구간 거래일</span></div><div><b>0.115%</b><span>편도 비용 · 숏 연 대차료 3% 추가</span></div></div><p class="muted">이 표는 전체 관찰종목의 비교 연구입니다. 실제 신규 편입은 해당 Trend Unit 구성종목의 훈련·검증 구간과 현재 진입 신호를 별도로 심사합니다.</p><div class="toolbar"><div class="segmented">${["전체", "상승", "하락", "횡보"].map((f) => `<button data-filter="${f}" class="${filter === f ? "active" : ""}">${f}</button>`).join("")}</div><label class="search-input">${icon("search")}<input id="strategy-search" value="${esc(search)}" placeholder="전략명 또는 ID 검색" aria-label="전략 검색"></label></div><section class="panel"><div class="table-scroll"><table><thead><tr><th>전략</th><th>국면 · 방향</th><th>운용 방식</th><th>평균 수익률</th><th>최대낙폭</th><th>청산 수</th><th>연구 상태</th><th></th></tr></thead><tbody>${list.map((s) => `<tr><td><b>${s.family}</b><small class="table-sub">${s.id} · ${s.direction==='short'?'숏 v2':'롱 v1'}</small></td><td>${badge(s.regime)} ${badge(s.direction==='short'?'숏':'롱')}</td><td>${s.size}</td><td class="numeric ${good(s.ret)}">${pct(s.ret)}</td><td class="numeric">${(s.dd * 100).toFixed(2)}%</td><td class="numeric">${s.trades}</td><td>${badge(s.pass ? "기준 통과" : "연구 중", s.pass ? "green" : "")}</td><td><button class="text-button" data-strategy="${s.id}">상세</button></td></tr>`).join("")}</tbody></table></div>${!list.length ? '<div class="empty">검색 결과가 없습니다.</div>' : ""}</section>`;
}
function journal() {
  const sells = [...state.trades,...assetPositions(state).flatMap(a=>a.trades)].filter((t) => ["sell","cover"].includes(t.side)),
    holdings = state.holdings;
  return `<div class="page-title"><h1>거래 기록 · 복기</h1></div><section class="panel">${panelTitle("현재 보유 종목", `<span class="muted">${holdings.length}개 종목</span>`)}${
    holdings.length
      ? `<div class="table-scroll"><table><thead><tr><th>종목 · 방향</th><th>수량</th><th>평균 체결가</th><th>현재 평가 가격</th><th>평가손익</th><th></th></tr></thead><tbody>${holdings
          .map((h) => {
            const p = markPrice(state,h.symbol) * fxOf(h.symbol,state),
              pnl = unrealized(state,h);
            return `<tr><td><button class="text-button" data-symbol="${h.symbol}">${cOf(h.symbol).name}</button> ${badge(h.direction==='short'?'숏':'롱')}</td><td>${h.qty}주</td><td>${num(h.entry)}원</td><td>${num(p)}원</td><td class="${good(pnl)}">${won(pnl)}</td><td><button class="btn" data-exit="${h.symbol}">청산 계획 만들기</button></td></tr>`;
          })
          .join("")}</tbody></table></div>`
      : '<div class="empty compact">보유 종목 없음</div>'
  }</section>${assetPanel()}${exposurePanel()}${runHistoryPanel()}${learningPanel()}<div class="two-columns spaced"><section class="panel">${panelTitle("주문과 체결 기록", `<span class="muted">${state.trades.length}건</span>`)}${state.trades.length ? `<div class="trade-list">${state.trades.map((t) => `<div><span class="trade-side ${t.side}">${sideLabel(t.side)}</span><div><b>${cOf(t.symbol).name} ${t.qty}주</b><small>${t.date} · ${esc(t.reason)}</small></div><div class="align-right"><b>${num(t.price)}원</b><small class="${t.pnl === null ? "muted" : good(t.pnl)}">${t.pnl === null ? "수수료 " + won(t.fee) : "실현 " + won(t.pnl) + (t.borrowFee ? " · 대차료 " + won(t.borrowFee) : "")}</small></div></div>`).join("")}</div>` : '<div class="empty compact">아직 체결된 주문이 없습니다.</div>'}</section><section class="panel">${panelTitle("운용 복기")}<div class="review-stats"><div><span>완료된 거래</span><b>${sells.length}건</b></div><div><span>실현 손익</span><b class="${good(sells.reduce((a, t) => a + t.pnl, 0))}">${won(sells.reduce((a, t) => a + t.pnl, 0))}</b></div></div><label class="field-label" for="review-note">나의 복기 메모</label><textarea id="review-note" rows="6" placeholder="복기 메모">${esc(state.note || "")}</textarea><button class="btn primary spaced" data-action="save-note">복기 저장</button></section></div><section class="panel spaced">${panelTitle("의사결정 타임라인")}<div class="event-list">${state.events
    .slice(0, 40)
    .map(
      (e) =>
        `<div><small>${esc(e.date)}</small><span>${esc(e.text)}</span></div>`,
    )
    .join("")}</div></section>`;
}
function about() {
 return `<div class="page-title"><h1>계좌 관리</h1></div><section class="panel spaced">${panelTitle("연구 기록")}<div class="settings-actions"><button class="btn" data-action="export">${icon("download")} 기록 내보내기</button><label class="btn file-label">기록 불러오기<input type="file" id="import-file" accept="application/json,.json"></label>${legacyAvailable?'<button class="btn" data-action="legacy-import">기존 브라우저 계좌 가져오기</button>':""}<button class="btn danger" data-action="reset">새 가상 계좌 만들기</button></div></section>${runHistoryPanel()}${exposurePanel()}`;
}
function modal() {
  if (!detail) return "";
  const s = results.find((s) => s.id === detail);
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="icon-button modal-close" data-action="close-modal" aria-label="닫기">${icon("close")}</button><h2 id="modal-title">${s.family} / ${s.size}</h2><p>${s.regime} 국면에서 ${s.direction==='short'?'숏으로 하락을 헤지하는':'롱으로 진입하는'} 시뮬레이션 조합입니다.</p><div class="research-summary"><div><b class="${good(s.ret)}">${pct(s.ret)}</b><span>종목별 평균 수익률</span></div><div><b>${s.trades}</b><span>전체 청산 횟수</span></div></div><div class="prose"><h3>규칙</h3><p>국면은 종가와 20·60일 평균으로 분류합니다. ${s.direction==='short'? ["가격이 20일 평균 아래이고 20일 모멘텀이 −1% 미만일 때 숏으로 진입합니다.","종가가 직전 20개 봉의 저가 아래로 내려갈 때 숏으로 진입합니다.","20일 평균이 60일 평균보다 낮고 가격과 20일 평균의 차이가 1.5% 미만일 때 숏으로 진입합니다.","하락 추세에서 가격이 20일 평균보다 2.5% 이상 높을 때 숏으로 진입합니다.","20일 모멘텀이 −4% 미만일 때 숏으로 진입합니다."][s.f] : ["가격이 20일 평균 위이고 20일 모멘텀이 1%를 넘을 때 진입합니다.", "종가가 직전 20개 봉의 고가를 넘을 때 진입합니다.", "20일 평균이 60일 평균보다 높고 가격과 20일 평균의 차이가 1.5% 미만일 때 진입합니다.", "가격이 20일 평균보다 2.5% 이상 낮을 때 진입합니다.", "20일 절대 모멘텀이 4%를 넘을 때 진입합니다. 종목 간 상대 순위 비교는 아직 구현하지 않았습니다."][s.f]} ${s.direction==='short'&&s.z===3?"전일보다 종가가 내린 경우만 진입합니다.":["가용 현금의 20%를 사용합니다.", "변동성에 따라 가용 현금의 최대 20%를 사용합니다.", "가용 현금의 10%만 우선 진입합니다. 추가 진입은 아직 구현하지 않았습니다.", "전일보다 종가가 오른 경우만 가용 현금의 20%로 진입합니다."][s.z]}</p><p>방향을 반영한 종가 기준 수익률 −5% 이하, +10% 이상 또는 15개 봉 경과 시 다음 시가에 청산합니다. 이 과거 검증은 종가로 진입하므로 현재 모의계좌의 시가 체결 및 손절·목표가 규칙과 차이가 있습니다. 동일한 성과를 기대할 수 없습니다.</p><p>숏 검증에는 대차료 연 3%를 추가합니다. 개별 전략 과거 검증의 배분과 실제 통합 계좌의 숏 종목 10%·총 30% 제한은 다릅니다.</p><h3>검증의 한계</h3><p>${activeCompanies(state).length}개 종목을 각각 독립적으로 시뮬레이션한 평균입니다. 60개 조합에서 좋은 결과를 선택했으므로 선택 편향이 있습니다. 상승·횡보·하락 구간의 거래 수와 비용 민감도를 별도로 확인해야 합니다.</p></div>${badge(s.pass ? "연구 기준 통과" : "연구 중", s.pass ? "green" : "")}</section></div>`;
}
function catalogPage(){
 const active=new Set(activeCompanies(state).map(c=>c.symbol));
 const query=catalogSearch.trim().toLocaleLowerCase();
 const rows=eligibleCatalog.filter(c=>(catalogCountry==="전체"||c.country===catalogCountry)&&`${c.symbol} ${c.name}`.toLocaleLowerCase().includes(query));
 const page=paginate(rows,catalogOffset);catalogOffset=page.start;
 const eligible=new Set(eligibleCatalog.map(c=>c.symbol));
 const observations=new Map((state.watchlistData?.observations||[]).filter(o=>eligible.has(o.symbol)).map(o=>[o.symbol,o]));
 const failures=new Map((state.watchlistData?.failures||[]).map(f=>[f.symbol,f.reason]));
 const collected=[...observations.values()].filter(o=>Number.isFinite(o.price)&&o.price>0).length;
 const timestamp=value=>{const date=new Date(typeof value==='number'?value*1000:value);return value&&Number.isFinite(date.getTime())?date.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'미확인';};
 return `<div class="page-title"><div><h1>전체 후보 종목</h1><p>코스피200·S&P500·닛케이225 전체 후보</p></div><span class="badge">전체 감시 ${num(eligibleCatalog.length)} · 수집 ${num(collected)} · 상세 조사 준비 ${num(active.size)}</span></div>${manualPanel()}<section class="panel"><div class="toolbar"><label class="search-input"><input id="catalog-search" type="search" aria-label="후보 종목 이름 또는 코드 검색" placeholder="종목 이름 또는 코드" value="${esc(catalogSearch)}"></label><select id="catalog-country" aria-label="후보 국가">${["전체","한국","미국","일본"].map(x=>`<option ${x===catalogCountry?'selected':''}>${x}</option>`).join('')}</select><span class="muted">${num(rows.length)}종목</span><span class="muted">${esc(state.watchlistData?.provider||'감시 데이터 미확인')} · ${esc(timestamp(state.watchlistData?.fetchedAt))}</span></div><div class="table-scroll catalog-table"><table><thead><tr><th>종목</th><th>국가 / 지수</th><th>최근 가격</th><th>20일 모멘텀</th><th>조회 시각 (한국)</th><th>상세 조사</th><th>규모 한도</th><th>구성 근거</th></tr></thead><tbody>${page.rows.map(c=>{
 const observed=observations.get(c.symbol);
 const price=observed&&Number.isFinite(observed.price)&&observed.price>0&&observed.currency===c.currency?native(observed.price,c.symbol):'미확인';
 const momentum=observed&&Number.isFinite(observed.momentum)?pct(observed.momentum):'미확인';
 return `<tr><td>${active.has(c.symbol)?`<button class="text-button" data-symbol="${esc(c.symbol)}">${esc(c.name)}</button>`:`<b>${esc(c.name)}</b>`}<small class="table-sub">${esc(c.symbol)} · 감시 중</small></td><td>${esc(c.country)}<small class="table-sub">${esc(c.indexMembership.index)}</small></td><td class="numeric" title="${esc(price==='미확인'?failures.get(c.symbol)||'실제 가격 미수집':'')}">${esc(price)}</td><td class="numeric ${Number.isFinite(observed?.momentum)?good(observed.momentum):''}">${esc(momentum)}</td><td>${esc(timestamp(observed?.time))}</td><td>${badge(active.has(c.symbol)?'상세 조사 준비':'미준비',active.has(c.symbol)?'green':'')}</td><td>${sizeBadge(c)||'기본 한도'}</td><td><a href="${esc(c.indexMembership.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(c.indexMembership.asOf)} ${c.indexMembership.sourceType==='officialIndexConstituents'?'공식 지수':'공식 ETF 구성'}</a></td></tr>`;
 }).join('')||'<tr><td colspan="8">일치하는 후보가 없습니다.</td></tr>'}</tbody></table></div>${rows.length>page.rows.length?`<div class="pager"><button class="btn" data-catalog-page="-1" ${page.start===0?'disabled':''}>이전</button><span class="muted numeric">${num(page.start+1)}–${num(page.end)} / ${num(rows.length)}</span><button class="btn" data-catalog-page="1" ${page.end>=rows.length?'disabled':''}>다음</button></div>`:''}</section>`;
}
// Owner-named stocks the next pre-market research must review; selection and every check stay unchanged.
function manualPanel(){
 const list=state.manualCandidates||[];
 const result=m=>m.reviewedAt?(m.outcome?.status==='바스켓 제안'?`바스켓 제안 · ${esc(m.outcome.unit||'')}`:`관찰 · ${esc(m.outcome?.reason||'')}`):'다음 장전 조사에서 검토 예정';
 return `<section class="panel">${panelTitle("필수 검토 종목")}<p class="muted">여기 넣은 종목은 다음 장전 조사가 반드시 후보로 검토합니다. 편입 여부는 다른 후보와 같은 검토·서버 심사로 정합니다. 장전 실행 중에 바꾸면 그 실행이 재심사로 늦어질 수 있습니다.</p><div class="toolbar"><label class="search-input"><input id="manual-symbol" aria-label="필수 검토 종목코드" placeholder="종목코드 (예: 005930, AAPL)" maxlength="20"></label><label class="search-input"><input id="manual-note" aria-label="추가 이유 메모" placeholder="추가 이유 (선택, 300자 이하)" maxlength="300"></label><button class="btn" data-manual-add>검토 요청</button></div>${list.length?`<div class="table-scroll"><table><thead><tr><th>종목</th><th>메모</th><th>추가</th><th>결과</th><th></th></tr></thead><tbody>${list.slice().reverse().map(m=>`<tr><td><b>${esc(m.name)}</b><small class="table-sub">${esc(m.symbol)} · ${esc(m.country)}</small></td><td>${esc(m.note||'')}</td><td>${esc(new Date(m.addedAt).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'}))}</td><td>${result(m)}</td><td><button class="text-button" data-manual-remove="${esc(m.symbol)}">삭제</button></td></tr>`).join('')}</tbody></table></div>`:''}</section>`;
}
async function manualRequest(method,payload){
 if(busy||!serverReady)return;busy=true;
 try{const res=await fetch('/api/manual-candidates',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,expectedRevision:revision})});const data=await res.json();if(!res.ok)throw Error(data.error);await refreshServer();toast(method==='POST'?'필수 검토 종목에 추가했습니다.':'목록에서 삭제했습니다.')}
 catch(e){toast(e.message||'요청 실패. 새로고침 후 다시 시도하세요.');await refreshServer()}
 finally{busy=false}
}
let lastSync = null,
  renderedPage = null;
const syncTime = () => lastSync.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });
// innerHTML replaces the whole page; carry over what the reader had open, typed or focused on this page.
function viewSnapshot() {
  const main = root.querySelector("main"), a = document.activeElement;
  if (!main) return null;
  const dataAttr = a && main.contains(a) ? [...a.attributes].find((x) => x.name.startsWith("data-")) : null;
  return {
    page: renderedPage,
    open: new Set([...main.querySelectorAll("details[open] > summary")].map((x) => x.textContent)),
    drafts: [...main.querySelectorAll("textarea[id]")].filter((t) => t.value !== t.defaultValue).map((t) => [t.id, t.value]),
    focus: dataAttr ? `[${dataAttr.name}="${CSS.escape(dataAttr.value)}"]` : a?.id && main.contains(a) ? "#" + CSS.escape(a.id) : null,
  };
}
function restoreView(v) {
  if (!v || v.page !== page) return;
  const main = root.querySelector("main");
  main.querySelectorAll("details > summary").forEach((x) => { if (v.open.has(x.textContent)) x.parentElement.open = true; });
  for (const [id, value] of v.drafts) { const t = main.querySelector("#" + CSS.escape(id)); if (t) t.value = value; }
  if (v.focus) main.querySelector(v.focus)?.focus({ preventScroll: true });
}
function render() {
  const view = viewSnapshot();
  if(!serverReady){
    root.innerHTML=`<main style="max-width:720px;margin:12vh auto;padding:24px"><section class="panel"><h1>Multi-Asset Portfolio</h1><p role="status">${storageWarning?esc(storageWarning):'서버 계좌를 불러오는 중입니다.'}</p>${storageWarning?'<button class="btn" id="retry-account">다시 연결</button>':''}</section></main>`;
    root.querySelector('#retry-account')?.addEventListener('click',refreshServer);
    return;
  }
  if(!activeCompanies(state).some(c=>c.symbol===selected))selected=activeCompanies(state)[0].symbol;
  const pending = state.plans.filter((p) => p.status === "대기").length;
  root.innerHTML = `<aside class="sidebar"><a href="#dashboard" class="brand" data-page="dashboard"><span class="brand-mark">${icon("up")}</span><span>Multi-Asset<span>PORTFOLIO</span></span></a><div class="workspace-label">멀티에셋 포트폴리오</div><nav>${nav.map(([id, ic, label]) => `<button data-page="${id}" class="nav-item ${page === id ? "active" : ""}" aria-label="${label}" title="${label}" ${page === id ? 'aria-current="page"' : ""}>${icon(ic)}<span>${label}</span>${id === "approvals" && pending ? `<b class="nav-count" title="결정 대기 ${pending}건" aria-label="결정 대기 ${pending}건">${pending}</b>` : ""}</button>`).join("")}</nav><div class="sidebar-bottom"><div class="paper-label"><i class="dot sage"></i>페이퍼트레이딩</div><button class="account" data-page="about"><span class="avatar">나</span><span><b>나의 투자 계좌</b><small>서버 계좌</small></span>${icon("chevron")}</button></div></aside><div class="main-shell"><header class="topbar"><div class="breadcrumb">워크스페이스 ${icon("chevron")} <b>${nav.find((n) => n[0] === page)[2]}</b></div><div class="top-actions"><span class="demo-tag"><i class="dot amber-dot"></i>${state.mode==='live'?'Yahoo 가격 · 모의거래':'시뮬레이션 데이터'}</span>${lastSync ? `<span class="sync-label">갱신 ${syncTime()}</span>` : ""}<span class="date-label">${icon("clock")}${state.date}</span><button class="icon-button" data-action="export" aria-label="계좌 기록 내보내기">${icon("download")}</button><span class="avatar">나</span></div></header><main>${storageWarning ? `<div class="callout warning">${storageWarning}</div>` : ""}${{ dashboard, departments, catalog:catalogPage, committee, approvals, strategies: strategiesPage, journal, weekly:()=>weeklyReportsPage(state,{esc,num,pct}), about }[page]()}</main></div>${modal()}`;
  // Toggle groups mark their choice with .active only; expose the same state to assistive tech.
  root.querySelectorAll("main button").forEach((b) => { if (b.parentElement.querySelector(":scope > button.active")) b.setAttribute("aria-pressed", b.classList.contains("active")); });
  renderedPage = page;
  restoreView(view);
  bind();
  if (detail) {
    root.querySelector(".modal-close")?.focus();
  }
}
function go(p) {
  page = p;
  filter = "전체";
  detail = null;
  search = "";
  history.replaceState(null, "", "#" + p);
  render();
  window.scrollTo(0, 0);
}
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `multi-asset-portfolio-account-${state.date}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function bind() {
 const catalogInput=root.querySelector('#catalog-search');
 if(catalogInput)catalogInput.oninput=()=>{const pos=catalogInput.selectionStart;catalogSearch=catalogInput.value;catalogOffset=0;render();const next=root.querySelector('#catalog-search');next.focus();next.setSelectionRange(pos,pos);};
 const catalogSelect=root.querySelector('#catalog-country');
 if(catalogSelect)catalogSelect.onchange=()=>{catalogCountry=catalogSelect.value;catalogOffset=0;render();};
 root.querySelector('[data-manual-add]')?.addEventListener('click',()=>manualRequest('POST',{symbol:root.querySelector('#manual-symbol').value,note:root.querySelector('#manual-note').value}));
 root.querySelectorAll('[data-manual-remove]').forEach(el=>el.onclick=()=>manualRequest('DELETE',{symbol:el.dataset.manualRemove}));
 root.querySelectorAll('[data-catalog-page]').forEach(el=>el.onclick=()=>{catalogOffset+=Number(el.dataset.catalogPage)*CATALOG_PAGE_SIZE;render();root.querySelector('.catalog-table')?.scrollIntoView({block:'start'});});
  root.querySelectorAll("[data-country]").forEach(
    (el) =>
      (el.onclick = () => {
        country = el.dataset.country;
        render();
      }),
  );
  root.querySelectorAll("[data-page]").forEach(
    (el) =>
      (el.onclick = (e) => {
        e.preventDefault();
        if (el.dataset.dept) dept = Number(el.dataset.dept);
        go(el.dataset.page);
      }),
  );
  root.querySelectorAll("[data-symbol]").forEach(
    (el) =>
      (el.onclick = () => {
        selected = el.dataset.symbol;
        go("committee");
      }),
  );
  root.querySelectorAll("[data-committee-symbol]").forEach(
    (el) =>
      (el.onclick = () => {
        selected = el.dataset.committeeSymbol;
        render();
      }),
  );
  root.querySelectorAll("[data-dept-only]").forEach(
    (el) =>
      (el.onclick = () => {
        dept = Number(el.dataset.deptOnly);
        render();
      }),
  );
  root.querySelectorAll("[data-period]").forEach(
    (el) =>
      (el.onclick = () => {
        period = Number(el.dataset.period);
        render();
      }),
  );
  root.querySelectorAll("[data-filter]").forEach(
    (el) =>
      (el.onclick = () => {
        filter = el.dataset.filter;
        render();
      }),
  );
  root.querySelectorAll("[data-strategy]").forEach(
    (el) =>
      (el.onclick = () => {
        detail = el.dataset.strategy;
        render();
      }),
  );
  root
    .querySelectorAll("[data-approve]")
    .forEach(
      (el) =>
        (el.onclick = () => {
          const p = state.plans.find((x) => x.id === el.dataset.approve),
            rr = isEntry(p) ? risk(state, p) : null;
          const lines = [
            `${cOf(p.symbol).name} 모의 ${sideLabel(p.side)} ${num(p.qty)}주 × ${num(p.reference)}원 = 약 ${num(p.qty * p.reference)}원`,
            rr ? `예상 투자비중 ${(rr.weight * 100).toFixed(1)}%` : "",
            heldByLimit(p, rr) ? "보류 계획입니다. 승인하면 다른 대기 계획보다 먼저 계좌 한도를 사용합니다." : "",
          ].filter(Boolean);
          if (confirm(lines.join("\n") + "\n\n승인할까요?")) perform({ action: "approve", id: el.dataset.approve });
        }),
    );
  root
    .querySelectorAll("[data-reject]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          perform({ action: "reject", id: el.dataset.reject })),
    );
  root
    .querySelectorAll("[data-cancel]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          perform({ action: "cancel", id: el.dataset.cancel })),
    );
  root.querySelectorAll("[data-exit]").forEach(
    (el) =>
      (el.onclick = () => {
        page = "approvals";
        filter = "전체";
        perform({ action: "exit", symbol: el.dataset.exit });
      }),
  );
  root.querySelectorAll("[data-action]").forEach(
    (el) =>
      (el.onclick = async () => {
        const a = el.dataset.action;
        if(a==='refresh-reports'){
          if(busy||!serverReady)return;busy=true;
          try{const res=await fetch('/api/market-reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:revision})});const data=await res.json();if(!res.ok)throw Error(data.error);await refreshServer();toast('시황 보고서를 확인했습니다.')}catch{toast('보고서 수집 실패. 최신 계좌를 확인하세요.');await refreshServer()}finally{busy=false}
        }
        if (a === "advance") await perform({ action: "advance" });
        if (a === "export") {
          exportData();
          toast("계좌 기록을 내보냈습니다.");
        }
        if (a === "save-note")
          await perform({
            action: "note",
            note: root.querySelector("#review-note").value,
          });
        if (a === "close-modal") {
          detail = null;
          render();
          root.querySelector("[data-strategy]")?.focus();
        }
        if (
          a === "reset" &&
          confirm("서버 계좌를 백업한 뒤 새 가상 계좌로 교체할까요?")
        ) {
          exportData();
          await perform({ action: "reset" });
        }
        if (
          a === "legacy-import" &&
          confirm("현재 서버 계좌를 백업한 뒤 기존 브라우저 계좌로 교체할까요?")
        ) {
          try {
            const next = validateState(JSON.parse(localStorage.getItem(KEY)));
            exportData();
            await perform({ action: "import", state: next });
          } catch (e) {
            toast(e.message);
          }
        }
        if (a === "pause") {
          // A paused account skips every scheduled run, including the risk-exit check.
          if (!confirm(metadata.paused ? "자동 운용을 재개할까요?\n다음 예정 시각부터 장전·개장·마감 실행이 다시 진행됩니다." : "자동 운용을 일시정지할까요?\n예정된 장전·개장·마감 실행이 모두 멈춥니다. 손절 등 위험 청산 점검도 재개할 때까지 실행되지 않습니다.")) return;
          try {
            const res = await fetch("/api/pause", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paused: !metadata.paused }),
            });
            const data = await res.json();
            if (!res.ok) throw Error(data.error);
            await refreshServer();
            toast(
              metadata.paused
                ? "자동 운용을 일시정지했습니다."
                : "자동 운용을 재개했습니다.",
            );
          } catch (e) {
            toast(e.message);
          }
        }
      }),
  );
  const sel = root.querySelector("#symbol-select");
  if (sel)
    sel.onchange = () => {
      selected = sel.value;
      render();
    };
  const input = root.querySelector("#strategy-search");
  if (input)
    input.oninput = () => {
      const pos = input.selectionStart;
      search = input.value;
      render();
      const next = root.querySelector("#strategy-search");
      next.focus();
      next.setSelectionRange(pos, pos);
    };
  const file = root.querySelector("#import-file");
  if (file)
    file.onchange = async () => {
      try {
        const f = file.files[0];
        if (!f) return;
        if (f.size > 10000000)
          throw Error("10MB 이하의 계좌 파일을 선택하세요.");
        const next = validateState(JSON.parse(await f.text()));
        if (!confirm("현재 계좌를 백업하고 선택한 기록으로 교체할까요?"))
          return;
        exportData();
        await perform({ action: "import", state: next });
      } catch (e) {
        toast(e.message);
      }
    };
}
window.addEventListener("keydown", (e) => {
  if (detail && e.key === "Escape") {
    detail = null;
    render();
    root.querySelector("[data-strategy]")?.focus();
  }
  if (detail && e.key === "Tab") {
    const focusables = [
      ...root
        .querySelector(".modal")
        .querySelectorAll("button,a,input,select,textarea"),
    ];
    if (focusables.length) {
      e.preventDefault();
      const idx = focusables.indexOf(document.activeElement);
      focusables[
        (idx + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length
      ].focus();
    }
  }
});
window.addEventListener("hashchange", () => {
  const p = location.hash.slice(1);
  if (nav.some((n) => n[0] === p)) go(p);
});
const hash = location.hash.slice(1);
if (nav.some((n) => n[0] === hash)) page = hash;
render();
void refreshServer();
setInterval(() => {
  if (
    !busy &&
    !detail &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
  )
    void refreshServer();
}, 60000);
if (document.modelContext?.registerTool) {
  for (const tool of [
    {
      name: "read_paper_account",
      description:
        "Read the server-backed simulated account and pending plans; no real market data.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute(input) {
        if (!input || Object.keys(input).length)
          throw Error("No input fields accepted");
        return {
          date: state.date,
          equity: equity(state),
          cash: state.cash,
          holdings: state.holdings,
          pending: state.plans.filter((x) => x.status === "대기"),
        };
      },
    },
    {
      name: "navigate_committee_view",
      description:
        "Open an existing research view without approving or executing any trade.",
      inputSchema: {
        type: "object",
        properties: { page: { type: "string", enum: nav.map((n) => n[0]) } },
        required: ["page"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute(input) {
        if (
          !input ||
          Object.keys(input).length !== 1 ||
          !nav.some((n) => n[0] === input.page)
        )
          throw Error("Unknown view");
        go(input.page);
        return { page };
      },
    },
  ])
    try {
      Promise.resolve(document.modelContext.registerTool(tool)).catch(() => {});
    } catch {}
}
