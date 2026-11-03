# Independent Research Implementation Plan

**Goal:** 각 부서의 독립 후보를 운용부와 리스크관리부의 공동 판단으로 편입한다.
**Architecture:** 부서별 조사 계약과 순수 의견 계산을 분리하고 엔진의 후보·승인·체결에서 동일 검증을 사용한다.
**Tech Stack:** JavaScript ESM, Node test runner, Python updater, Cloudflare Worker/D1, Sites.
**Spec:** ../../independent-research-design.md

## Constraints

24개 종목, 기존 위험 한도, 새 가격 체결, 4시간 일정, 기존 계좌와 사이트 접근 권한 유지. 같은 슬롯 중복 실행 금지. 새 의존성 없음. 사용자가 승인한 설계를 현재 세션에서 직접 구현한다.

## Execution

- [ ] tests/committee.test.mjs: 스크리닝 반대 후보의 계획·승인·체결, 재무 실패, 오래된 자료, 위험 실패, 의견 수정과 입력 검증을 먼저 실패시킨다.
- [ ] web/committee.mjs, worker/account.mjs: 부서별 조사 입력 검증, 기존 입력 호환, 근거·최초 의견·수정 이유 보존, 사업/재무 검증 연결.
- [ ] web/engine.mjs: 후보 합집합, 운용 판단과 리스크 결과 분리, 승인·체결 전 재검사, 스크리닝 허가 조건 제거.
- [ ] worker/department-reviews.mjs, web/app.mjs: 부서별 제안 수, 종목별 찬반, 운용 사유와 위험 심사를 표시한다.
- [ ] web/run_autonomy.py, worker/index.mjs, README.md: v3 계약과 중복 실행 보존, 기존 자동 작업에 새 조사 계약 제공.
- [ ] 공개 조회 UI와 엔진 사본 동기화. 두 프로젝트 테스트·빌드 후 기존 두 사이트에 게시.

## Review Focus

스크리닝의 avoid가 다른 후보를 차단하지 않는지, 추천이 재무 승인으로 오인되지 않는지, 의견 수정에 이유가 있는지, 오래된 조사로 승인 주문이 체결되지 않는지, v3 게시 직후 동일 슬롯 거래가 재실행되지 않는지 확인한다.
