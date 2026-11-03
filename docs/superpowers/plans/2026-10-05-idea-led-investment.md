# 아이디어 중심 투자 흐름 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 실행 방식은 사용자 검토 후 선택한다.

**Goal:** 산업·테마분석부/마켓부의 컨셉에서 출발해 기업 검토, 기술 지원, 운용 선정, 위험 심사, 실제 가격 모의 체결을 연결한다.

**Architecture:** 기존 계좌 JSON, 조사 API, 유닛·가격·위험 엔진을 재사용한다. `investmentIdeas`를 추가하고 최종 `trendUnits`와 기업·기술 검토에 `ideaId`를 연결한다. 신규 진입은 이 연결을 필수로 요구하되 과거 기록 조회와 기존 보유 청산은 유지한다.

**Tech Stack:** Node.js 22+, ES modules, 기존 node:test/assert, Python 수집기, esbuild, Cloudflare Worker/D1, Sites. 새 패키지·DB 테이블·모델 에이전트·단계별 API를 추가하지 않는다.

**Spec:** `docs/superpowers/specs/2026-10-05-idea-led-investment-design.md`

## Global Constraints

- 산업·테마분석, 마켓, 펀더멘탈, 기술적 분석, 운용, 리스크관리의 여섯 부서를 유지한다. 기술적 분석부는 별도 부서로서 운용부를 지원한다.
- 부서 조사 36시간 이내, 재무 수집 24시간 이내, 연간 재무 기간 550일 이내, 거시 5항목·참조지수 구성 확인 120일 이내를 유지한다.
- 흑자, 매출 감소 15% 이내, PER 45배 이하, 비금융 영업현금흐름 양수·차입금/자기자본 3배 이하, 금융 ROE 5% 이상을 유지한다.
- 최종 유닛 2~20개 구성종목, 예비 10개 이하, 유닛 예산 상한 40%, 첫 체결부터 1~3개월 기한을 유지한다.
- 손실 한도 절반에서 1회 절반 축소, 전체 손실·목표·기한·논리 훼손 시 청산 요청, 부분 체결, 축소 후 자동 재확대 금지를 유지한다.
- 롱 종목 20%, 숏 종목 10%, 업종 40%, 총노출 100%, 숏 총노출 30%, 절대 순노출 80%, 계획 손절 손실 0.8%, 합산 손절 손실 2%, 최대낙폭 10% 미만을 유지한다.
- 기존 추가 중형 10%·소형/규모 미확인 5%·20일 평균 거래대금 1% 주문 한도와 승인 주문의 한도 예약을 유지한다.
- 장전 신규 판단·승인, 승인 이후 실제 정규장 시가 체결, 마감 평가, 일시정지, revision 및 동일 세션 중복 방지를 유지한다.
- 기존 보유 유닛의 최초 조건·원가·기한·거래 이력을 보존한다. 새 조사 누락이나 형식 오류로 기존 보유 위험 청산을 막지 않는다.
- ETF 자산배분·시황 수집·예약 시간·예약 활성 여부·사이트 접근 범위를 유지한다. 가격 수집 실패 시 대체 가격이나 과거 시가 체결을 만들지 않는다.
- 작업 시작 시 존재한 미커밋 변경을 보존한다. 특히 `worker/account.mjs`, `worker/index.mjs`, `worker/fundamentals.mjs`, `worker/research-data.mjs`, README, MCP 관련 파일은 이미 변경돼 있으므로 통째로 되돌리거나 작업과 무관한 변경을 커밋하지 않는다.

## Review Focus

1. 같은 기업이 두 아이디어에 속하고 기업·기술 의견이 다를 때 다른 아이디어의 통과 결과를 가져오지 않는다. Task 1의 복합 키 검사와 Task 2의 승인·체결 테스트로 고정한다.
2. 조사 입력의 아이디어·최종 유닛·예비/제외 목록이 불일치하거나 활성 가격 범위 밖 종목을 담으면 새 진입을 보류한다. Task 1의 계약·준비 상태 테스트로 고정한다.
3. v4 입력이나 변경 전 승인 주문을 새 절차 통과로 간주하지 않는다. Task 2의 마이그레이션·기존 승인 테스트로 고정한다.
4. 아이디어 철회·조사 만료·기업 검토 변경이 승인 이후 발생하면 신규 진입은 만료시키고 기존 위험 청산은 계속한다. Task 2의 새 가격 실행 테스트로 고정한다.
5. 예약 실행이 이전 제출 계약을 사용하는 동안 서버만 변경하면 운영이 멈출 수 있다. Task 3에서 서버의 계약 안내·Python 버전·예약 프롬프트를 맞추고 실제 저장 상태를 readback한다. 실제 운영 자료 없이 합성 조사를 제출해 통과시키지 않는다.

## 적용할 입력 계약

기존 `departmentResearch`의 내부 부서 키 `screening`을 유지하고 표시명만 산업·테마분석부로 바꾼다. 새 필드나 별칭으로 저장 기록을 중복 생성하지 않는다. 아이디어 제안 부서도 `screening|market` 키를 사용한다.

`investmentIdeas`는 최대 12개, 아이디어 후보는 중복 없이 1~30개로 제한한다. 이는 기존 최종 유닛 최대 12개·참조 구성 목록 최대 30개의 입력 크기를 재사용한 수집 범위이며 전체 시장 발굴을 뜻하지 않는다. 다음은 실제 제출 가능한 필드 예시다. 예시 URL은 테스트 출처이며 운영 제출에 사용하지 않는다.

```js
const idea = {
  id: 'kr-ai-infrastructure', name: '한국 AI 인프라',
  sourceDepartments: ['screening', 'market'],
  region: '한국', category: 'theme', asOf: '2026-10-05T00:00:00Z',
  thesis: '산업 수요와 실제 사업 매출의 연결 검토',
  catalyst: '다음 실적 발표에서 출하·현금 회수 확인',
  whatToWatch: '출하, 고객 집중, 투자 회수',
  invalidation: '수요 또는 현금 회수 논리 훼손',
  candidates: [
    {symbol: '005930', reason: '메모리 사업의 수요 연결 검토'},
    {symbol: '000660', reason: 'AI 메모리 공급 경로 검토'},
  ],
  referenceIndex: {
    name: '시험 참조지수', asOf: '2026-10-01',
    constituents: ['005930', '000660'],
    sourceUrls: ['https://example.com/index'],
  },
  sourceUrls: ['https://example.com/index'],
  opposingViews: [{department: 'market', reason: '금리 부담',
    sourceUrls: ['https://example.com/index']}],
  action: 'review', withdrawalReason: '',
};
```

`action`은 `review|withdraw`이고 철회 시 사유가 필요하다. `sourceDepartments`는 1~2개 고유 키를 받는다. 후보·참조 구성의 종목은 실제 활성 가격 범위에 속해야 한다. 컨셉에는 비중·수량·최종 손절을 넣지 않는다.

펀더멘탈/기술 검토는 기존 행에 `ideaId`를 추가한다. 동일 부서 안에서 `(ideaId, symbol)`을 고유 키로 삼고, 해당 아이디어 후보에 속하지 않는 행은 신규 절차의 근거로 사용하지 않는다. `stance`, `revisedStance`, `revisionReason`, `reason`, `sourceUrls`, `businessPass`의 의미와 원래 의견 보존은 유지한다. 펀더멘탈만 `businessPass`를 제출할 수 있다.

최종 유닛은 기존 필드에 `ideaId`와 `excluded:[{symbol,reason}]`를 추가한다. 구성·예비·제외 목록은 해당 컨셉 후보에서만 선택하고, 그 유닛에서 채택하지 않은 후보에는 예비 지정 또는 제외 이유를 남긴다. 복수 유닛은 서로 다른 구성종목을 선택할 수 있다. 컨셉 철회, 기업 검증 실패, 기술 검토 미완료를 최종 유닛의 높은 점수로 우회할 수 없다.

## Task 1: 컨셉·기업 검토·최종 유닛 계약과 준비 상태

**Files:** Modify `web/committee.mjs`, `web/trend-units.mjs`, `worker/account.mjs`, `worker/research-readiness.mjs`, `tests/research-readiness.test.mjs`, `tests/fixtures.mjs`; Create `tests/idea-workflow.test.mjs`.

**Interfaces:** 기존 `cleanResearch(input)`와 `researchReadiness(state,research,now)` 시그니처를 유지한다. `cleanInvestmentProcess`가 `{investmentIdeas,macroScorecard,trendUnits}`를 반환하고 `cleanResearch`가 아이디어별 부서 행을 보존한다. `researchReadiness`는 기존 `complete/missing/regions`에 `stages`를 추가한다. 아이디어 조회는 `ideaFor(state,ideaId)`, 기업 검토 조회는 `businessResearch(state,symbol,ideaId)`를 사용한다.

- [ ] **Step 1: 기존 `processInput()`의 단순 유닛 예제를 `tests/fixtures.mjs`로 옮겨 재사용 가능한 조사 fixture를 만들고 아래 신규 검사를 작성한다.** fixture는 `investmentIdeas:[idea]`, 최종 유닛의 `ideaId`, 후보별 펀더멘탈/기술 행과 등록 HTTPS 출처를 갖는다. 기존 테스트 파일을 import해 테스트가 중복 실행되도록 하지 않는다.

```js
test('concept is stored and a final unit needs its source idea', () => {
  const raw = ideaResearch();
  const clean = cleanResearch(raw);
  assert.equal(clean.investmentIdeas[0].id, raw.trendUnits[0].ideaId);
  raw.trendUnits[0].ideaId = 'missing';
  assert.equal(researchReadiness(ideaState(), cleanResearch(raw), testNow).complete, false);
});
test('reviews use idea and symbol together', () => {
  const raw = ideaResearch();
  raw.departmentResearch.fundamental.push({
    ...raw.departmentResearch.fundamental[0], ideaId: 'other-idea', businessPass: false,
  });
  const clean = cleanResearch(raw);
  assert.equal(clean.departmentResearch.fundamental.length, 3);
  raw.departmentResearch.fundamental.push(raw.departmentResearch.fundamental[0]);
  assert.throws(() => cleanResearch(raw));
});
```

fixture는 아래 코드로 정의한다. 위 계약의 `idea` 객체를 테스트 fixture 안에 그대로 선언한다. `tests/fixtures.mjs`에 아래 함수를 export하고 검사 파일에서 가져온다. 기존 import에는 `coreCompanies`를 추가하고 아래 import와 중복 선언하지 않는다. 운영 자료가 아니라 검증을 위한 합성 입력이다.

```js
import {createState, coreCompanies} from '../web/engine.mjs';
import {cleanResearch} from '../worker/account.mjs';
export const testNow = Date.UTC(2026, 9, 5, 0);
const url = 'https://example.com/index';
export function ideaResearch() {
  return {
    asOf: new Date(testNow).toISOString(), topDown: '산업 컨셉 조사',
    bottomUp: '후보 기업 검토', marketReview: '시장 적합성 검토',
    decision: '최종 두 기업 선정', limitations: '시험 자료',
    sources: [{title: '시험 근거', url}],
    investmentIdeas: [structuredClone(idea)],
    macroScorecard: ['leading','growth','inflation','policy','liquidity'].map(factor => ({
      factor, region: '한국', signal: 'neutral', observedAt: '2026-10-01',
      reason: '관측 근거', sourceUrls: [url],
    })),
    departmentResearch: Object.fromEntries(['fundamental','technical'].map(department => [
      department, ['005930','000660'].map(symbol => ({
        ideaId: idea.id, symbol, stance: 'allow', score: 80,
        reason: department === 'fundamental' ? '사업 연결 검토' : '진입 시점 지원',
        businessPass: department === 'fundamental', sourceUrls: [url],
      })),
    ])),
    trendUnits: [{
      id: 'test-unit', ideaId: idea.id, name: '검증 바스켓',
      category: 'theme', riskProfile: 'defensive', regime: 'shortBear',
      direction: 'short', region: '한국', thesis: idea.thesis,
      catalyst: idea.catalyst, invalidation: idea.invalidation,
      allocationReason: '기업·기술·위험을 검토한 배분', riskBasis: '손실 예산',
      targetReturn: .1, lossLimit: .1, maxWeight: .2, horizonMonths: 2,
      members: ['005930','000660'].map(symbol => ({symbol, weight: .5, reason: '최종 선정'})),
      reserves: [], excluded: [], referenceIndex: structuredClone(idea.referenceIndex),
      sourceUrls: [url], action: 'hold', exitReason: '',
    }],
  };
}
export function ideaState() {
  const s = createState();
  Object.assign(s, {mode: 'live', investmentProcessVersion: 5,
    date: '2026-10-05', plans: [], holdings: [], trades: [],
    activeSymbols: coreCompanies.map(c => c.symbol), fx: {KRW: 1, USD: 1400, JPY: 9.5}});
  return s;
}
export function eligibleIdeaAccount() {
  const s = ideaState();
  s.data = Object.fromEntries(coreCompanies.map(c => [c.symbol,
    Array.from({length: 320}, (_, i) => {
      const p = 100000 * Math.pow(.999, i);
      return {open:p,close:p,high:p*1.00001,low:p*.99999,volume:1000000};
    }),
  ]));
  s.marketData = {fetchedAt: new Date(testNow).toISOString(), quotes:
    Object.fromEntries(coreCompanies.map(c => [c.symbol,
      {price:s.data[c.symbol].at(-1).close,time:testNow/1000,currency:c.currency}]))};
  s.externalResearch = cleanResearch(ideaResearch());
  s.externalResearch.fresh = true;
  s.fundamentals = Object.fromEntries(['005930','000660'].map(symbol => [symbol, {
    pass:true,numericPass:true,checks:[{name:'숫자 검증',pass:true}],
    metrics:{pe:10,roe:.1,revenueGrowth:.1},
  }]));
  return s;
}
```

추가 검사: 펀더멘탈·기술 행만 있고 컨셉이 없으면 새 유닛은 미완료; 컨셉만 있고 최종 유닛이 없으면 발굴 완료·선정 대기; 가격 범위 밖 후보, 다른 아이디어의 구성종목, 누락 기술 검토, 미등록 출처, 동일 아이디어 ID 중복, 철회 사유 누락, 후보 제외 이유 누락, 36시간 초과 컨셉, 120일 초과 참조/거시 근거가 각각 준비 미완료 또는 입력 오류가 된다. 후보 외 34개 기업의 의견이 없어도 완성된 2종목 컨셉을 검사할 수 있어야 한다. 원래/수정 의견 보존 검사도 포함한다.

- [ ] **Step 2: `node --test tests/idea-workflow.test.mjs tests/research-readiness.test.mjs`로 신규 검사 실패를 확인한다.** 기존 구현에서 `investmentIdeas`가 저장되지 않거나 `ideaId` 없는 유닛이 허용되는 이유로 실패해야 한다. import/문법 실패를 기대한 실패로 인정하지 않는다.

- [ ] **Step 3: 기존 정제 함수와 준비 상태 검사를 확장한다.** `cleanInvestmentProcess` 안의 기존 `text/urls` 검사를 재사용해 아이디어 필드를 정제한다. 기존 유닛 정제 결과에 아래 필드를 추가한다. v4 입력은 정제·조회할 수 있지만 새 절차 완료 판정은 받지 못한다.

```js
...(u.ideaId !== undefined ? {ideaId: text(u.ideaId, 80)} : {}),
excluded: (u.excluded ?? []).map(x => ({symbol: x.symbol, reason: text(x.reason, 1500)})),
```

부서 행 정제 결과에도 선택적 `ideaId`를 보존하고 고유 키를 다음과 같이 바꾼다. 기존 `ideaId` 없는 행의 중복 종목 검사는 그대로 작동한다.

```js
const keys = rows.map(x => `${x.ideaId ?? ''}:${x.symbol}`);
if (new Set(keys).size !== keys.length) throw Error('부서별 아이디어·종목이 중복되었습니다.');
```

아이디어 조회와 정확한 기업 검토 조회는 기존 `committee.mjs`에 둔다.

```js
export const ideaFor = (s, ideaId) =>
  s.externalResearch?.investmentIdeas?.find(i => i.id === ideaId);

// businessResearch의 기존 legacy 분기는 ideaId 없는 과거 조회에만 사용한다.
if (ideaId !== undefined) return s.externalResearch?.departmentResearch?.fundamental
  ?.find(x => x.ideaId === ideaId && x.symbol === symbol) ?? null;
```

`departmentReadiness`는 아이디어 후보별 펀더멘탈·기술 행을 검사한다. 산업/마켓은 컨셉의 제안 부서·근거·반대 의견으로 발굴 상태를 판단한다. 전체 활성 종목 × 네 부서 행을 요구하는 기존 루프는 신규 절차에서 사용하지 않는다. `missing`에 `stage`, `ideaId`, `symbol`을 추가하되 기존 `region/kind/field/reason`을 보존한다. `stages`의 키는 `ideas/fundamental/technical/management`이며 값은 `complete|pending|watch`다. 위험 승인은 조사 준비 판정과 구분한다.

아이디어가 없고 최종 유닛도 없는 출처 있는 관찰 판단은 `ideas:'watch'`로 표시한다. 최소 출처와 비어 있지 않은 산업·시장·운용 관찰 이유가 없으면 미완료로 판정한다. `complete:true`인 관찰 판단에도 신규 편입 대상은 없다. 컨셉별 기업·기술 행이 없는 과거 종목 추천은 단계 완료로 승격하지 않는다.

- [ ] **Step 4: Task 1 검사를 다시 실행하고 입력 정제·신선도·검토 범위 검사가 모두 통과하는지 확인한다.** `node --test tests/idea-workflow.test.mjs tests/research-readiness.test.mjs tests/trend-units.test.mjs`를 사용한다. 기존 v4 유닛 모니터링 fixture를 v5 입력 fixture로 무조건 바꾸지 않는다.
- [ ] **Step 5: 이 작업의 변경만 커밋한다.** 기존 미커밋 코드가 있는 파일은 `git diff`로 작업 부분을 확인하고 선택적으로 stage한다. 메시지: `feat: link investment concepts and department reviews`.

## Task 2: 운용 선정·승인·체결과 기존 계좌 보호

**Files:** Modify `web/engine.mjs`, `web/committee.mjs`, `web/trend-units.mjs`, `worker/account.mjs`, `web/run_autonomy.py`, `tests/idea-workflow.test.mjs`, `tests/committee.test.mjs`, `tests/trend-units.test.mjs`, `tests/automation.test.mjs`, `tests/session-operation.test.mjs`, `tests/run_autonomy_test.py`.

**Interfaces:** `entryEligible(state,symbol,ideaId,now=Date.now())`가 기업별 숫자 검사와 해당 아이디어의 질적 통과를 함께 검사한다. `ideaEntryCheck(state,symbol,ideaId,now=Date.now())`는 `{pass,reason,idea,fundamental,technical}`을 반환한다. `unitEntryCheck`의 기존 반환과 인수를 보존하고 선택적 `now`를 마지막 인수로 받아 v5에서 아이디어 연결을 검사한다. `analyze(state,now=Date.now())`, `approve(state,id,now)`, `advance(state,options)`가 같은 검사에 경유한다.

- [ ] **Step 1: 실제 승인·체결 경로를 지나는 신규 검사를 작성한다.** 기존 320개 하락 일봉·고정 가격·연간 숫자 fixture를 재사용하고, 삼성전자·SK하이닉스 두 기업의 숏 컨셉/유닛으로 새 계약을 만든다. 아래 assertion으로 후보 출발점과 최종 바스켓을 검증한다.

```js
const state = eligibleIdeaAccount();
analyze(state, testNow);
const plan = state.plans.find(p => p.symbol === '005930' && p.status === '대기');
assert.equal(plan.ideaId, 'kr-ai-infrastructure');
assert.equal(plan.unitId, 'test-unit');
assert.deepEqual(plan.managementReview.candidateDepartments, ['screening', 'market']);
approve(state, plan.id, testNow);
assert.equal(plan.riskReview.status, 'approved');
```

다른 아이디어에서 동일 종목의 `businessPass:true`가 존재해도 해당 컨셉의 `false`를 우회하지 못하는 검사를 추가한다. 외부 기술 의견은 있어야 하지만 `watch` 자체는 자동 거절이 아니다. 운용부가 반대 이유를 기록하고 기존 서버 진입 신호·위험 검사를 통과하면 판단할 수 있어야 한다. 펀더멘탈 `businessPass:false`, 필수 숫자 실패, 출처 누락은 항상 차단한다.

승인 후 컨셉 철회·36시간 초과·최종 구성에서 제외·숫자 실패·기술 검토 제거를 각각 적용하고, 이후 실제 새 가격 `advance`에서 계획이 만료되고 거래가 없는지 검사한다. 기존 승인 계획에 `ideaId`가 없으면 만료시키되 기존 보유 종목의 손절·유닛 목표/기한 청산 요청은 계속한다. 같은 세션 재시도에서 새 주문·체결이 생기지 않는 기존 검사를 유지한다.

- [ ] **Step 2: `node --test tests/idea-workflow.test.mjs tests/committee.test.mjs tests/session-operation.test.mjs`로 신규 조건이 기존 선정·승인·체결에서 차단되지 않는 실패를 확인한다.**
- [ ] **Step 3: 기존 흐름의 출발점을 아이디어 후보로 바꾸고 공유 검사를 추가한다.** `departmentNames.screening='산업·테마분석부'`로 바꾸고 여섯 부서의 설명을 새 역할에 맞춘다. v5의 `candidateDepartments`는 아이디어의 `sourceDepartments`이며 펀더멘탈·기술 의견은 검토 지원 정보로 남긴다. 최종 유닛에 포함된 기업 중 정확한 기업·기술 검토가 있는 종목만 운용 순위에 넣는다.

```js
const idea = ideaFor(s, unit?.ideaId);
const fundamental = businessResearch(s, symbol, idea?.id);
const technical = s.externalResearch?.departmentResearch?.technical
  ?.find(x => x.ideaId === idea?.id && x.symbol === symbol);
const reviewed = !!idea && idea.action === 'review' &&
  idea.candidates.some(x => x.symbol === symbol) &&
  fundamental?.businessPass === true && fundamental.sourceUrls.length > 0 &&
  !!technical && technical.sourceUrls.length > 0 && technical.reason.trim().length > 0;
```

위 조건을 `ideaEntryCheck`에 한 번만 구현하고 전체 조사 및 개별 아이디어 신선도 36시간 검사와 선정/참조 연결 검사를 같은 함수에 둔다. `entryEligible`·`unitEntryCheck`·`currentNomination`에서 이를 재사용한다. `approve`와 `advance`는 계획의 `ideaId/unitId` 및 실제 검사 시각을 전달한다. `analyze`가 만든 계획과 체결/보유/청산 기록에 `ideaId`를 보존하고 최종 유닛 첫 체결 원가·기한 집계는 기존 구현을 사용한다.

`refreshFundamentals`와 `prepareResearch`에서는 숫자 체크의 결과를 `numericPass`로 보존한다. 기존 UI용 종합 `pass`는 숫자와 확인된 사업 검토의 합성 결과를 유지하되, 실제 진입은 아래와 같이 정확한 아이디어 검토를 추가로 요구한다.

```js
const numeric = (f.checks ?? []).filter(x => x.name !== '최신 바텀업 사업·공시 검토');
f.numericPass = numeric.length > 0 && numeric.every(x => x.pass);
const business = businessResearch(s, symbol, ideaId);
return f.numericPass === true && business?.businessPass === true &&
  business.sourceUrls.length > 0 && ideaEntryCheck(s, symbol, ideaId, now).pass;
```

`ideaEntryCheck`는 `entryEligible`를 호출하지 않아 순환 호출을 피한다. 기존 v4 숫자 값은 보존된 `checks`에서 읽고 미확인 숫자를 임의로 통과시키지 않는다.

`PIPELINE_VERSION=5`, 신규 실행의 `investmentProcessVersion=5`, Python `PIPELINE_VERSION=5`로 일치시킨다. v4 유닛 예산 검사는 v5에도 적용되도록 `===4` 분기를 `>=4`로 바꾸되 단순히 신규 아이디어 검사까지 생략하지 않게 한다. 유닛별 청산 묶음 복기 분기도 `>=4`로 유지한다. 실가격 계좌는 읽을 때와 승인/실행 때 v5 진입 검사 대상으로 취급한다. GET은 영구 계좌·revision·슬롯을 바꾸지 않고, 다음 기존 쓰기에서 새 버전을 저장한다. 시연 계좌의 가격 생성 경로는 과거 시연 용도로만 유지한다.

`businessResearch`의 아이디어 없는 fallback은 과거 조회에만 남긴다. `currentNomination`의 v5 경로는 더 이상 네 부서의 `allow` 합집합을 사용하지 않는다. 기존 승인 주문은 새 조건을 통과하지 못하면 실행 직전에 만료시키며 계좌 초기화·새 슬롯 소비는 하지 않는다.

- [ ] **Step 4: 관련 JavaScript와 Python 검사를 실행한다.**

```bash
node --test tests/idea-workflow.test.mjs tests/committee.test.mjs tests/trend-units.test.mjs tests/research-readiness.test.mjs tests/automation.test.mjs tests/session-operation.test.mjs tests/long-short.test.mjs
python3 -m unittest discover -s tests -p 'run_autonomy_test.py'
```

기존 v4 행 조회·보유 청산 검사는 유지하고, v4 단독 후보로 신규 승인이 가능하다고 주장하는 테스트만 새 정책에 맞춰 바꾼다. 원래 의견·숫자 검증·위험 한도·새 가격 체결·세션 중복 검사는 삭제하지 않는다.
- [ ] **Step 5: 이 작업의 변경만 선택적으로 커밋한다.** 메시지: `feat: enforce concept-led selection before paper execution`.

## Task 3: 화면·부서 보고·자동 조사 계약과 배포

**Files:** Modify `web/committee-view.mjs`, `web/trend-view.mjs`, `web/app.mjs`, `worker/department-reviews.mjs`, `worker/account.mjs`의 `context`, `README.md`, `docs/trend-investment-process.md`, `docs/independent-research-design.md`, `tests/idea-workflow.test.mjs`, `tests/mcp.test.mjs`. Sites의 기존 두 활성 예약 실행은 ID·시장·시간·활성 여부를 보존하고 조사 프롬프트만 갱신한다. 기존 MCP 작업의 변경은 보존한다.

**Interfaces:** `/api/context`의 `investmentProcess.version/researchWorkflow.version/pipelineVersion`은 5이며 입력 계약과 순서를 안내한다. 기존 `lastResearch`, `departments`, `researchReadiness`, `investmentProcess.episodes`는 유지한다. `researchPreparedAt`과 최근 실행의 `lastRun`을 별도 표시하고, 투자위원회에서 컨셉→기업/기술 검토→최종 선정→위험→체결의 상태를 연결한다.

- [ ] **Step 1: 렌더링과 context의 새 흐름을 검사한다.** 기존 `investmentProcessPanel`과 `committeeReviewPanel`을 HTML 문자열로 렌더링하고 다음을 확인한다. `esc`는 실제 화면의 기존 escaping 구현을 사용한다.

```js
const html = investmentProcessPanel(state, {esc, badge});
assert.match(html, /바스켓 컨셉/);
assert.match(html, /최종 바스켓/);
assert.match(html, /산업·테마분석부/);
assert.ok(!html.includes('<script>attack</script>'));
const ctx = context({state, revision: 1, metadata: {enabled: false}});
assert.equal(ctx.researchWorkflow.version, 5);
assert.ok(ctx.researchWorkflow.sequence.join(' ').includes('기업 분석'));
```

컨셉 이름·철회 조건·제외 이유에 HTML을 넣어 escaping을 검사한다. 과거 보고서는 과거 기준일을 유지하고 현재 계약 완료로 표시하지 않는 검사를 추가한다. MCP 조회가 새 context를 읽고 기존 계좌·토큰·원문 접근 경계를 유지하는 기존 테스트도 실행한다.

- [ ] **Step 2: `node --test tests/idea-workflow.test.mjs tests/mcp.test.mjs`로 화면·context의 새 안내가 없는 실패를 확인한다.**
- [ ] **Step 3: 기존 화면과 보고서를 연결한다.** 컨셉 카드에 제안 부서·논리·관찰/철회 조건·후보군·출처를, 최종 유닛 카드에 연결된 아이디어·선정/예비/제외 이유·비중·위험·체결을 표시한다. 과거 유닛은 원본 아이디어 미연결을 명시하고 조회를 유지한다. 기술적 분석부의 외부 검토와 규칙 계산을 기존 구분 그대로 표시한다.

부서 보고는 산업·마켓의 컨셉 수, 펀더멘탈의 검토/통과 수, 기술의 검토/대기 수, 운용의 최종 유닛·선정 수, 리스크의 심사/보류 수로 바꾼다. 동일 종목의 아이디어별 검토 수와 고유 종목 수를 혼동하지 않는다. 조사 준비 시점과 실제 마지막 실행 시점을 따로 붙이고, 기존 요약 숫자를 새 조사 숫자로 덮어쓴 실행 성과처럼 표시하지 않는다.

context의 순서는 다음 배열을 사용한다.

```js
sequence: [
  '산업·테마분석부·마켓부가 출처 있는 아이디어와 바스켓 컨셉 발굴',
  '펀더멘탈부가 후보 기업의 사업·공시·재무를 분석',
  '기술적 분석부가 운용부의 종목 선정과 진입 시점 지원',
  '운용부가 최종 종목·비중·전략·손절·목표·기한 결정',
  '리스크관리부가 한도 심사하고 체결 직전 재검사',
  '장전 승인 이후 실제 정규장 시가에서 모의 체결',
],
```

README와 이전 설계/트렌드 분석 문서는 과거 구조라는 날짜·버전을 명시하고 현재 설명을 v5로 맞춘다. 기존 ETF·MCP·시황·세션 운용 설명을 삭제하지 않는다. 화면에 필드명·파이프라인 내부 키를 사용자 의사결정에 불필요하게 노출하지 않는다.

- [ ] **Step 4: 전체 기존 검사와 빌드를 완료한다.**

```bash
npm test
python3 -m unittest discover -s tests -p '*_test.py'
npm run check
npm run build
git diff --check
```

새 오류가 생기면 관련 원인을 수정하고 실패한 검사부터 재실행한다. 같은 상태에서 통과한 전체 검사를 근거 없이 반복하지 않는다. 기존 미커밋 작업에서 발생한 오류도 배포 전 원인을 구분해 확인한다.

- [ ] **Step 5: 변경 검토를 완료하고 정확한 소스 상태를 배포한다.** 실행 방식에서 정한 리뷰 절차를 적용한다. 배포 전에 `sites:sites-hosting` 스킬을 읽고 기존 `.openai/hosting.json`의 `appgprj_6ac1eb9be0b48191abbc67fb0238f38e`를 재사용한다. 배포 산출물과 저장 버전은 실제 push한 동일 소스 상태여야 한다. 다른 미커밋 작업을 몰래 포함하거나 덮어쓰지 않고 의존하는 변경은 검토된 소스에 포함할 범위를 명시한다. 현재 소유자 전용 접근과 기존 DB를 유지한다.

- [ ] **Step 6: 기존 활성 예약의 제출 지침을 새 계약에 맞춘다.** Sites `get_site`로 현재 ID와 프롬프트 편집 경로를 확인하고 지원되는 예약 편집 도구를 사용한다. 같은 시장의 새 예약을 만들어 중복 실행시키지 않는다. 프롬프트에는 다음 절차를 반영한다.

> 장전에는 산업·테마분석부와 마켓부가 투자 아이디어·바스켓 컨셉을 먼저 기록한다. 후보 기업의 펀더멘탈 분석과 별도 기술적 분석부의 지원 의견을 ideaId와 연결한 뒤 운용부가 최종 trendUnits와 선정·제외 이유를 작성한다. /api/context가 안내하는 계약을 따르고 /api/research-check의 누락을 원문 근거로 보완한다. 개장·마감은 기존 승인과 보유 위험 관리를 이어받으며 새 조사·승인을 만들지 않는다. 자료 수집 실패 시 합성 자료를 만들지 않는다. 기존 ETF·시황 경로와 실제 가격·위험 검사를 유지한다.

예약 편집 기능이 제공되지 않거나 자동 승인 검토가 거절하면 완료를 주장하지 않는다. 가능한 배포·조회 검증을 마친 뒤, 영향을 받는 예약과 미완료 사유를 사용자에게 보고한다. 기존 예약을 임의로 중지·복제·재개하지 않는다.

- [ ] **Step 7: 배포 상태와 readback을 확인한다.** `get_deployment_status`의 성공을 확인하고 인증된 동일 origin의 GET `/api/context`, `/api/account`, `/api/runs`로 버전 5, 신규 계약 안내, 계좌 현금·보유·원가·거래·revision·슬롯·예약·공개 범위를 비교한다. GET에서 계좌 저장이나 슬롯 소비가 일어나지 않아야 한다. 브라우저에서 컨셉/최종 바스켓/기술 지원/기준 시점 표시를 확인한다. 운영 계좌에 시험 주문이나 합성 조사를 제출하지 않는다. 실제 새 조사가 아직 없으면 화면은 기존 제안의 재검토 대기를 보여야 하며, 승인·체결 완료로 보고하지 않는다.

- [ ] **Step 8: 실제 변경·검사·배포·예약 결과만 짧게 보고한다.** 미완료 작업이 있으면 다음 운용에 미치는 영향을 함께 명시한다. 커밋 메시지: `feat: present and operate the concept-led investment workflow`.

## 계획 자체 검토

- 설계의 컨셉/최종 바스켓 분리, 여섯 부서 역할, 기업/기술 범위, 의견 보존, 가격·위험·유닛 관리, 과거 호환, UI/기준 시점, 예약 계약을 Task 1~3에 각각 연결했다.
- 신규 함수의 인수와 반환, 입력 필드명, 버전 5, 내부 부서 키를 위 계약으로 통일했다. 기존 함수의 호출부는 import/caller 검색 후 실제 검사 시각·아이디어 연결을 전달한다.
- Review Focus 1~4는 계약 및 승인·체결 테스트, 5는 배포/예약/readback 절차에 연결했다. 운영 수집 실패를 테스트용 입력으로 감추지 않는다.
- 사용자 승인 전에는 제품 코드·배포·예약 실행을 변경하지 않는다. 현재 산출물은 이 구현 계획이다.

## 구현·검증 기록 (2026-10-06)

아이디어·후보 검증·최종 바스켓 연결, 표시명 변경, 승인·체결 전 재검증, 과거 계좌 조회 호환을 구현했다. 기술적 분석부와 펀더멘탈부가 같은 발굴 후보를 각각 검증한 뒤 운용부가 판단한다. 기존 미커밋 MCP·재무·시황 작업을 별도 기준 커밋으로 보존하고 그 위에 변경했다.

최종 검증: JavaScript 149/149, Python 20/20, 구문 검사·빌드·diff 검사 통과. 독립 최종 리뷰에서 필수 근거 우회, 숫자 검증의 24시간 만료, 초기 API/MCP 관찰 판정, 과거 추천 표시, 참조 구성의 활성 가격 범위, 구식 검증 안내를 재현 후 수정했다. 미룬 경미한 지적은 없다.

구현 중 판단과 한계:

1. 네이티브 worktree 생성이 저장소 위치를 인식하지 못해 별도 Git worktree를 사용했다. 기존 파일 보존을 우선했으며 원본 반영에는 변경 전 내용 비교가 필요하다.
2. 순수 엔진의 v4 검사는 과거 동작 기록으로 유지했다. 서버 실가격 조회·승인·실행은 v5로 처리한다. 엔진을 직접 사용하는 다른 소비자가 있으면 버전을 명시해야 한다.
3. 기존 시연 진행에 결합된 fixture 대신 전용 아이디어 시험 자료를 사용했다. 시험 자료와 실제 제출 계약의 일치가 전제이며 운영에 시험 자료를 제출하지 않는다.
4. 검토한 후보를 전부 제외할 수 있도록 근거·출처가 있는 운용 관찰 결정을 허용했다. 관찰 자체는 신규 주문을 허가하지 않는다.
5. 사용자의 추가 결정대로 기업·기술 두 부서가 발굴 후보를 각각 검증한다. 두 부서의 독자적인 신규 후보 제안은 편입 출발점이 될 수 없다.
6. 기존 두 Sites 클라우드 예약의 프롬프트 편집 기능이 제공되지 않아 예약 ID·시간·활성 상태를 유지했다. 새 서버 계약은 제공하지만 예약 프롬프트 갱신은 미완료다. 이전 제출 자료는 새 점검에서 거절될 수 있으며 적용할 지침은 [예약 조사 지침](../../scheduled-research-v5.md)에 보존했다.
7. 잘못된 v5 입력에 구식 전체 종목 검토 안내가 나오면 자동조사를 다른 흐름으로 돌릴 수 있어 중요한 문제로 보고 수정했다. 모든 출처·형식·위험 검증은 유지했다.

리뷰 범위 밖: 실제 배포와 인증 readback은 실행 담당자가 별도로 확인한다. 예약 갱신은 위 도구 제한으로 남아 있다. ETF·자료 제공기관·MCP 전송 전체를 다시 감사하지 않았으며 기존 회귀 검사는 통과했다. 기존 계좌의 보유·현금·원가·승인 시각·거래·revision·슬롯은 이 변경으로 초기화하지 않는다.

### 예약 지침 적용 (2026-10-06)

ChatGPT 웹의 예약 편집 화면에서 기존 한국·일본 및 미국 예약의 독립 조사 지침을 v5 공통 후보 검증 절차로 교체했다. 두 예약을 다시 열어 저장값 일치를 확인했으며 Sites readback에서 기존 ID·일정·시간대·활성 상태와 과거 예약의 비활성 상태를 확인했다. 서버 계약의 sourceDepartments, investmentIdeas, (ideaId,symbol), 원본 후보의 운용 선정·관찰 및 숫자 24시간 유효 조건을 반영했다. 이전 기록의 클라우드 지침 미적용 제한은 해소됐다. 새 장전 조사의 실제 결과는 장전 실행 이후 검증하며, 현재 미국 예약을 수동 실행해 기존 세션 완료 여부와 중복 체결 방지 점검을 진행했다.

> 2026-10-25 수정(사용자 요청 "매수 적격으로 통과하는 기준을 좀 더 널널하게"): PER 한도는 기본 60배, 매출 성장 15%·ROE 10%·영업현금흐름 양수이면 80배로 올렸다. 비금융 차입금/자기자본 한도는 4배이며, Yahoo가 차입금을 제공하지 않으면 그 항목만으로 탈락시키지 않는다(흑자·영업현금흐름 양수 조건은 그대로). 흑자·매출 감소 15% 이내·금융 ROE 5%·24시간 수집·위험 한도는 바꾸지 않았다.
