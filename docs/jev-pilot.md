# 미국 종목 선정 JEV 비교 실험

목표는 매크로·컨셉과 기업의 수혜 연결을 같은 기준으로 비교하는 데 JEV가 도움이 되는지 확인하는 것이다. 현재는 독립적인 기존 선정 결과와 병행하는 shadow 평가이며 종목·비중·승인·체결에 영향을 주지 않는다. 미국 등록 종목만 대상으로 한다. 가격·재무·진입 신호·Claude 승인·위험 심사는 기존 절차를 사용한다.

## 두 단계

1. 산업·시장 부서가 컨셉과 원본 후보를 `/api/research`에 저장한다. 기업·기술 검토와 최종 선정을 저장하기 전에 `/api/jev-evaluate`에 `stage:discovery`를 호출한다. 원본 후보 전체를 평가하며 조사 순서를 제안한다. 기존 부서 분석에는 평가 결과를 전달하지 않아 비교 기준이 오염되지 않게 한다.
2. 기업·기술 검토와 독립적인 운용 선정 또는 출처 있는 관찰 결정을 `/api/research`에 저장한다. 기존 승인 절차 직전에 `stage:admission`을 호출한다. 같은 원본 컨셉·후보·매크로를 유지하고 보완한 원문 근거를 제출한다. 발굴 단계의 shadow 기록이 필요하다. 이후 `/api/context`를 새로 읽어 revision을 갱신하고 기존 승인·위험 절차를 진행한다.

`GET /api/context` 또는 MCP `get_investment_context`의 `jevWorkflow.enabled`가 true이면 미국 장전 조사에 위 두 단계를 사용한다. `JEV_PILOT_ENABLED=true`는 controller 지침이며 자동 평가 자체를 실행하지 않는다. `useJev:true`를 명시한 요청만 유료 호출한다. 새로운 예약을 만들지 않으며 개장·마감·한국·일본에서는 호출하지 않는다. 실패나 자료 부족이 기존 위험 점검을 막아서는 안 된다.

이미 선정이 끝난 자료는 `replay:true`로 두 단계를 비교할 수 있다. 이 경우 mode는 `retrospective`, prospective는 false다. 당시 발굴 시점에 관측한 결과나 수익률 검증으로 보고하지 않는다. 원래 asOf를 보존하며 오래된 자료의 신선도를 새 시각으로 바꾸지 않는다.

## 입력

```json
{
  "stage": "discovery",
  "ideaId": "existing-us-idea-id",
  "useJev": true,
  "packet": {
    "asOf": "original investmentIdeas[].asOf",
    "regime": "English macro regime and evidence summary",
    "concept": "English investment thesis",
    "horizonMonths": 2,
    "catalyst": "Evidence-backed event within this horizon",
    "invalidation": "Observable condition that defeats the thesis",
    "sourceUrls": ["https://source-already-registered.example/"],
    "candidates": [{
      "symbol": "MSFT",
      "conceptEvidence": "English source quotation or faithful business-exposure summary",
      "regimeEvidence": "English evidence of macro sensitivity",
      "catalystEvidence": "English evidence of event and timing",
      "counterEvidence": "English opposing evidence, unresolved risk or limiting condition",
      "sourceUrls": ["https://source-already-registered.example/"]
    }]
  }
}
```

예시는 형식만 설명한다. 실제 원본 후보 전체, 최대100개를 중복 없이 제출한다. 모든 URL은 기존 `research.sources`에 등록되어 있어야 한다. 후보별 네 항목은 영문 각1500자, 전체 packet은200000자 이하다. 비어 있는 항목은 미확인이며 해당 종목을 JEV로 평가하지 않는다. 원문을 읽고 인용하거나 충실하게 요약해야 한다. JEV는 URL을 직접 확인하지 않으므로 URL 등록이 주장 검증을 뜻하지 않는다. 키·연락처·보유 수량·계좌 정보는 JEV 입력에 넣지 않는다.

admission에는 후보별 `admissionEvidence`를 영문2000자 이하로 추가하여 실제 기업 검토·밸류에이션·기술적 진입 검토를 연결한다. 해당 원문 출처도 후보 sourceUrls에 등록한다. 누락은 admission_evidence로 보류한다. discovery에서는 이 필드를 비워 두어 최종 검토 자료가 앞 단계에 섞이지 않게 한다. 숫자는 기존 수집·서버 계산을 사용하고 외부 모델이 미확인 수치를 만들어 넣지 않는다.

## 결과와 비교

컨셉 연결, 국면 민감도, 기간 내 촉매, 반대 근거 대응의 네 항목을 각각0~4로 평가하고 동일가중0~100점으로 합산한다. admission에는 candidate/reserve/watch/exclude 분류도 기록한다. 한 항목이라도 confidence<0.8이면 needs_research로 남긴다. 0.8과 동일가중은 금융 자료에서 보정하지 않은 초기 설정이다. confidence는 주가 상승 확률이 아니다.

admission의 사업 검토·기술 검토·서버 계량 자료·36시간 이내 조사 중 하나라도 미확인이면 needs_research다. 이 제한을 통과해도 편입 승인이 아니다. rawJevCandidateSymbols는 모델의 원래 제안이고 jevCandidateSymbols는 자료 확인을 반영한 비교 후보다. 두 목록을 구분한다. 정기 운용은 별도의 실제 가격·진입 신호·위험·승인을 계속 요구한다.

기존 선정 목록은 모델 입력에서 숨기고 호출 직전 snapshot에 고정한다. baselineSelectedOverlap은 기존 선정 중 자료 확인을 거친 JEV 후보에도 포함된 비율이다. rawSelectedOverlap은 원래 제안과의 일치 비율이다. 일치도가 높거나 낮다는 사실만으로 어느 선정이 옳다고 판정하지 않는다. 추가·누락·불일치 종목과 반대 근거를 원문으로 재검토한다.

`GET /api/jev-evaluations` 또는 MCP `get_jev_evaluations`로 최근20개 record를 조회한다. packet·원본 기준시각·모델·rubricVersion·단계·소스 revision·선정 snapshot·점수/확신·누락·지연시간·입출력 토큰을 보존한다. 입력 크기에 맞춰 최대8개 후보씩 나누며 단계 내 여러 유료 요청이 될 수 있다. 일부 묶음 실패 시 부분 응답을 전체 순위처럼 보고하지 않는다. 2026-10-08 [공식 모델 가격](https://docs.typesafe.ai/models)의 입력100만 토큰당$0.042, 출력 무료를 기준으로 estimatedCostUsd를 기록하며 실제 청구액은 별도로 대조한다. 토큰 미확인의 null을 무료라고 해석하지 않는다. 장기 비교는20개를 넘기기 전에 내보낸다.

평가 전 pending 기록을 CAS로 예약한다. 동일 snapshot 재요청은 캐시를 반환하며 재결제하지 않는다. 오류·시간 초과는 자동 재시도하지 않는다. pending이 남으면 이미 결제되었을 수 있으므로 재호출하지 말고 상태를 확인한다. 기록은 metadata만 변경하고 계좌 state는 덮어쓰지 않는다. revision 충돌 시 최신 context를 읽되 유료 평가를 자동 재시도하지 않는다.

## 정기 장전 호스트 호출

정기 미국 장전 조사(`RESEARCH_MODE=pre`)에서 `jevWorkflow.enabled`가 true이고 조사가 완료됐거나 편입 가능한 유닛이 있으면 `scripts/research-agent.mjs`의 `jevCycle`이 호출한다. 조사 모델은 API·자격 증명에 접근하지 않고 `jev-packet.json`만 쓴다. 호스트는 `research.json`·`allocation-decision.json` 출력을 먼저 저장한 뒤, 아이디어별 원본 후보 전체·등록 출처·ASCII·길이를 확인한다. 따옴표·대시·말줄임표는 ASCII로 바꾸고, 그 밖의 문자 오류가 있는 아이디어는 필드 이름을 기록하고 제외한다. asOf는 `research.json`의 아이디어 asOf를 사용한다.

호스트는 같은 조사를 `/api/research`로 저장한 뒤 discovery(admissionEvidence 제외)와 admission을 각각 한 번 `useJev:true, replay:true`로 요청한다. 같은 실행에서 선정 후에 쓴 입력이므로 기록은 `retrospective`, prospective false이고 pairedDiscoveryId는 null이다. 사전 증거로 보고하지 않는다. 조사 마감까지 5분 미만이면 호출하지 않고, 각 요청 대기는 남은 시간으로 제한하며, 오류·시간 초과·revision 충돌은 재시도하지 않는다. 결과는 조사 주체에게 돌아가지 않고 research-summary의 `jev`에만 기록된다. 검토 반려 후 수정 라운드가 있으면 기록은 수정 전 조사를 기준으로 한다. 조사 저장은 세션의 `/api/run`보다 먼저 일어나며 세션이 같은 조사를 다시 제출한다.

## 평가 순서

첫 저장 자료 재평가는 연결·출력·차이를 확인하는 용도다. 이후 실제 시점에 저장한 discovery/admission 쌍에서 후보별 판단 차이, 근거 부족, 불확실 결과, 원문 재검토에서 드러난 오류, 토큰/지연을 확인한다. 높은 확신인데 틀린 사례와 우량 후보를 뒤로 밀어낸 사례를 우선 기록한다. 향후 수익률 비교에는 당시 자료만 고정한 후보 바스켓, 동일 보유기간·가중치·거래비용·기준지수·선정 시점 이후 가격이 필요하다. 이 구현에는 수익률 백테스트가 포함되어 있지 않다.
