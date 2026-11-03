import test from 'node:test';
import assert from 'node:assert/strict';
import {tone,paginate,approvalBlockReason,heldByLimit,readableReason,reasonHtml,sourceFold,fundamentalSummary} from '../web/ui-format.mjs';

test('zero is neutral, not a gain', () => {
  assert.equal(tone(0), 'muted');
  assert.equal(tone(0.01), 'positive');
  assert.equal(tone(-0.01), 'negative');
});

test('catalog pages clamp to the filtered rows', () => {
  const rows = Array.from({length: 128}, (_, i) => i);
  assert.deepEqual([paginate(rows, 50).start, paginate(rows, 50).end], [50, 100]);
  assert.equal(paginate(rows, 500).start, 100);
  assert.equal(paginate(rows, -50).start, 0);
  assert.equal(paginate(rows.slice(0, 7), 100).rows.length, 7);
  assert.equal(paginate([], 50).rows.length, 0);
});

test('block reason exists exactly when approval is disabled and names failed checks', () => {
  const ok = {pass: true, checks: [['현금', true]]};
  const bad = {pass: false, checks: [['현금', true], ['총노출 100% 이하', false]]};
  assert.equal(approvalBlockReason({strategy: 'trend'}, ok), '');
  assert.equal(approvalBlockReason({strategy: 'trend'}, null), '');
  assert.equal(approvalBlockReason({strategy: '미검증'}, ok), '');
  assert.match(approvalBlockReason({strategy: 'trend'}, bad), /총노출 100% 이하/);
  assert.doesNotMatch(approvalBlockReason({strategy: 'trend'}, bad), /현금/);
});

const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

test('raw collector output in a research reason becomes readable Korean lines', () => {
  const raw = '사업 원문 1차 검토: HBM4 노출. businessPass는 false로 유지. 실제 연간 수집: periodEnd=2025-12-31, periodType=12M, fetchedAt=2026-10-08T09:36:34.593955+00:00, 통화=KRW, 계정={"revenue": 333605938000000.0, "eps": 6605.0, "debt": 25239139000000.0}. 필수 누락=[]; 매출성장=0.10880093313642902, 단순 기말자본 ROE=0.1043119805437141, 일봉가격/연간EPS PER=39.666919000757005. 임의 numericPass/businessPass 승인을 하지 않음.';
  assert.deepEqual(readableReason(raw), [
    '사업 원문 1차 검토: HBM4 노출.',
    '사업 검증 미통과 유지.',
    '실제 연간 수집: 결산일 2025-12-31, 연간, 수집일 2026-10-08, 통화 KRW, 매출 333.6조원 · EPS 6,605원 · 부채 25.2조원.',
    '필수 항목 누락 없음',
    '매출성장 10.9%, 단순 기말자본 ROE 10.4%, 일봉가격/연간EPS PER 39.7배.',
    '임의 수치 검증/사업 검증 승인을 하지 않음.',
  ]);
  assert.match(readableReason('통화=USD, 계정={"revenue": 391035000000}.')[0], /매출 \$391\.0B/);
  assert.deepEqual(readableReason('진입 시점 지원'), ['진입 시점 지원']);
});

test('long reasons fold after three lines and sources fold behind a count', () => {
  const html = reasonHtml('하나. 둘. 셋. 넷. 다섯.', esc);
  assert.match(html, /<summary>자세히 · 2줄 더<\/summary>/);
  assert.doesNotMatch(reasonHtml('하나. 둘. 셋. 넷.', esc), /자세히/);
  const fold = sourceFold(['https://www.dart.fss.or.kr/a', { title: '삼성 IR <보고서>', url: 'https://samsung.com/ir' }], esc);
  assert.match(fold, /<summary>출처 2개<\/summary>/);
  assert.match(fold, />dart\.fss\.or\.kr</);
  assert.match(fold, />삼성 IR &lt;보고서&gt;</);
  assert.equal(sourceFold([], esc), '');
});

test('fundamental card leads with the verdict and never shows 가능 beside an unfinished check', () => {
  const f = { pass: true, currency: 'KRW', periodEnd: '2025-12-31', checks: [{ name: '재무 수집 30일 이내', pass: true }], metrics: { revenue: 333605938000000, revenueGrowth: 0.1088, netIncome: 44260956000000, operatingCashFlow: 85315148000000, pe: 39.67, peLimit: 45 } };
  const review = (pass) => [{ label: '기업·기술 검토와 운용 선정', pass }];
  assert.equal(fundamentalSummary({ f, reviews: review(false), eligible: false, gap: '펀더멘탈부 사업 검증 미통과' }), [
    '결론: 매수 보류 — 펀더멘탈부 사업 검증 미통과',
    '· 재무 숫자: 기준 통과',
    '   2025년 연간 매출 333.6조원(전년 대비 +10.9%), 순이익 44.3조원, 영업현금흐름 85.3조원, PER 39.7배(한도 45배)',
    '· 기업·기술 검토와 운용 선정: 아직 끝나지 않음',
  ].join('\n'));
  assert.match(fundamentalSummary({ f, reviews: review(false), eligible: true }), /^결론: 매수 보류/);
  assert.match(fundamentalSummary({ f, reviews: review(true), eligible: true }), /^결론: 편입 검토 가능 — 재무 숫자와 기업·기술 검토와 운용 선정 모두 통과/);
  assert.match(fundamentalSummary({ f, reviews: review(true), eligible: false }), /다른 진입 조건이 아직 남아 있음/);
  assert.match(fundamentalSummary({ f: { ...f, pass: false, checks: [{ name: 'PER 45배 이하', pass: false }] }, reviews: review(null), eligible: false }), /기준 미달 \(PER 45배 이하\)[\s\S]*조사 전/);
  assert.match(fundamentalSummary({ f: null, reviews: [], eligible: false }), /재무 숫자: 아직 수집되지 않음/);
});

test('joined department risk lists break at each department and sentence', () => {
  assert.deepEqual(readableReason('기술적 분석부: 급변·갭·시세 지연 검증 없음 · 펀더멘탈부: 실적 연결·밸류에이션 미검증 · 마켓부: 금리 정상화는 할인율 위험. AI 수요만으로 상승을 확정하지 않음.'), [
    '기술적 분석부: 급변·갭·시세 지연 검증 없음',
    '펀더멘탈부: 실적 연결·밸류에이션 미검증',
    '마켓부: 금리 정상화는 할인율 위험.',
    'AI 수요만으로 상승을 확정하지 않음.',
  ]);
  // A middle dot inside one department's text stays on its line.
  assert.deepEqual(readableReason('HBM4·DDR5 · 서버 수요 확인'), ['HBM4·DDR5 · 서버 수요 확인']);
});

test('heldByLimit marks only limit-held plans whose standalone risk check passes', () => {
  const held = {status: '보류', riskReview: {status: 'held'}};
  assert.equal(heldByLimit(held, {pass: true}), true);
  assert.equal(heldByLimit(held, {pass: false}), false);
  assert.equal(heldByLimit(held, null), false);
  assert.equal(heldByLimit({status: '대기', riskReview: {status: 'pending'}}, {pass: true}), false);
  assert.equal(heldByLimit({status: '보류'}, {pass: true}), false);
});
