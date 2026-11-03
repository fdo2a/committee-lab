import {ff3Summary} from './ui-format.mjs';
function strategyEvidence(review,{esc,num,pct}){
 if(!review?.available)return '<p class="muted">당시 전략 기록 없음 · 현재 자료로 과거 주간을 소급 작성하지 않습니다.</p>';
 const rate=x=>Number.isFinite(x)?pct(x):'미확인',number=(x,suffix='')=>Number.isFinite(x)?x.toFixed(1)+suffix:'미확인';
 const links=xs=>(xs??[]).filter(x=>/^https:\/\//.test(typeof x==='string'?x:x?.url)).map(x=>`<a href="${esc(typeof x==='string'?x:x.url)}" target="_blank" rel="noopener noreferrer">${esc(typeof x==='string'?'출처':x.title??'자료')}</a>`).join(' · ');
 const score=(stock,factor)=>Number.isFinite(stock.factors?.[factor])?number(stock.factors[factor],'점'):'미수집';
 const macroNames={leading:'선행지표',growth:'경기',inflation:'물가',policy:'정책',liquidity:'유동성'},signals={positive:'우호',neutral:'중립',negative:'부정',unknown:'미확인'};
 const selectionNames={selected:'선정',reserve:'예비',excluded:'제외',exited:'청산',watch:'관찰'},reasonLabels={selected:'선정 이유',reserve:'예비',excluded:'제외 이유',exited:'청산 이유',watch:'관찰 이유'};
 // Snapshots saved before candidateReason existed put the nomination reason in selectionReason for reserve/watch rows.
 const decision=(idea,stock)=>{
  const legacy=stock.candidateReason===undefined&&['reserve','watch'].includes(stock.selection);
  return {reason:legacy?(stock.selection==='watch'?idea.managementReview?.reason||'당시 미기록':'최종 바스켓의 예비 후보'):stock.selectionReason??'미기록',nominated:legacy?stock.selectionReason:stock.candidateReason};
 };
 const facts=rows=>`<dl class="weekly-facts">${rows.filter(Boolean).map(([label,html])=>`<div><dt>${label}</dt><dd>${html}</dd></div>`).join('')}</dl>`;
 const line=(label,text,muted=false)=>`<p class="cell-line${muted?' muted':''}"><span class="cell-label">${label}</span>${esc(text)}</p>`;
 return `<section class="weekly-section"><h3 class="weekly-heading">당시 근거 · Macro Top-down → Universe → 종목 선정 → 위험·청산</h3>
 <div class="weekly-body">${paragraphs(review.macro?.topDown??'매크로 판단 미기록',esc)}</div>
 <p class="weekly-meta">${esc(review.asOf)} · 실행 기록 ${review.snapshotCount}회 · ${esc(review.limitation)}</p>
 ${review.ideas.map((idea,i)=>`<details class="weekly-idea" ${i===0?'open':''}><summary class="weekly-subtitle">${esc(idea.name)} <span class="muted">· ${esc(idea.referenceIndex?.name??'Universe 미확인')}</span></summary><div>
 <p class="weekly-meta">아이디어 관측 ${esc(idea.capturedAt)} · 참조지수 기준 ${esc(idea.referenceIndex?.asOf??'미확인')} ${links(idea.referenceIndex?.sourceUrls)}</p>
 ${facts([['매크로 연결',esc(idea.macro?.topDown??'미기록')],['Universe 선택 원인',esc(idea.universeReason?.trim()||'당시 미기록')],['투자 논리',esc(idea.thesis??'미기록')],['촉매·관찰 조건',`${esc(idea.catalyst??'미기록')}<br>${esc(idea.whatToWatch??'미기록')}`],['반증·철회 조건',`${esc(idea.invalidation??'미기록')} ${links(idea.sourceUrls)}`],idea.managementReview&&['운용 관찰 판단',esc(idea.managementReview.reason)]])}
 ${(idea.macro?.scorecard??[]).length?`<h4 class="weekly-minor">지표별 판단</h4><ul class="weekly-list">${idea.macro.scorecard.map(r=>`<li><span class="weekly-tag">${esc(macroNames[r.factor]??r.factor)} · ${esc(signals[r.signal]??r.signal)}</span>${esc(r.reason)} <span class="muted">(${esc(r.observedAt)})</span> ${links(r.sourceUrls)}</li>`).join('')}</ul>`:''}
 <h4 class="weekly-minor">종목별 선정 이유·팩터·위험</h4>
 <div class="table-scroll"><table class="weekly-table" style="white-space:nowrap" aria-label="종목별 팩터 및 위험지표"><thead><tr>${['종목·선정 이유','Value','Size','Quality','Dividend','Growth','Momentum','FF3 알파·위험 참고','변동성 (연율)','VaR 60거래일 90%','VaR 60거래일 95%','자료 시점·출처'].map(t=>`<th scope="col">${t}</th>`).join('')}</tr></thead><tbody>
 ${idea.stocks.map(stock=>`<tr><td style="min-width:260px;white-space:normal"><div class="stock-name">${esc(stock.name)} (${esc(stock.symbol)}) <span class="badge">${selectionNames[stock.selection]??'관찰'}</span></div>${(({reason,nominated})=>line(reasonLabels[stock.selection]??'관찰 이유',reason)+(nominated&&nominated!==reason?line('후보 사유',nominated,true):''))(decision(idea,stock))}${stock.fundamentalReason?line('기업 검토',stock.fundamentalReason):''}${stock.technicalReason?line('진입 검토',stock.technicalReason):''}${stock.strategyValidation?line('전략 검증',`바스켓 전략 ${stock.strategyValidation.id} · 훈련 ${stock.strategyValidation.trainTrades}건 / 검증 ${stock.strategyValidation.trades}건`):''}${line('계량',`후보 내 순위 ${stock.rank??'미확인'} · 종합 ${number(stock.quantScore,'점')} · ${stock.quantReady?'계량 검증 완료':'계량 미충족'}`,true)}</td>
 <td>PER ${number(stock.metrics?.pe,'배')}<br>${score(stock,'value')}</td>
 <td style="min-width:120px;max-width:240px;white-space:normal">${Number.isFinite(stock.metrics?.marketCap)?`${num(stock.metrics.marketCap)} ${esc(stock.metrics.marketCapCurrency)}`:'시가총액 미수집'}<br>${score(stock,'size')}${stock.sizeEvidence?`<br>${esc(stock.sizeEvidence.asOf)} · ${links([{url:stock.sizeEvidence.url,title:'규모 자료'}])}<br>${esc(stock.sizeEvidence.classificationBasis??'')}`:''}</td>
 <td>ROE ${rate(stock.metrics?.roe)}<br>${score(stock,'quality')}</td><td>배당수익률 미수집<br>${score(stock,'dividend')}</td>
 <td>연간 매출성장 ${rate(stock.metrics?.revenueGrowth)}<br>${score(stock,'growth')}</td><td>20거래일 ${rate(stock.metrics?.momentum20d)}<br>방향별 ${score(stock,'momentum')}</td>
 <td style="min-width:220px;white-space:normal">알파 ${score(stock,'ff3Alpha')}<br>${esc(ff3Summary(stock.ff3))}</td>
 <td>${rate(stock.riskMetrics?.volatility)}</td><td>${rate(stock.riskMetrics?.var60d90)}</td><td>${rate(stock.riskMetrics?.var60d95)}<br>중첩 표본 ${stock.riskMetrics?.samples??'미확인'}개</td>
 <td style="min-width:190px">재무 수집 ${esc(stock.financialAsOf??'미확인')}<br>회계기간 말 ${esc(stock.periodEnd??'미확인')}<br>가격 수집 ${esc(stock.priceAsOf??'미확인')}<br>${links(stock.financialSources)}</td></tr>`).join('')}
 </tbody></table></div>
 ${(idea.units??[]).length?`<h4 class="weekly-minor">바스켓</h4>`:''}${(idea.units??[]).map(u=>`<div class="weekly-unit"><p class="weekly-unit-title">${esc(u.name)} <span class="muted">· ${esc(u.status??'편입 제안')} · ${u.direction==='short'?'숏':'롱'} · ${esc(({bull:'강세',sideways:'횡보',shortBear:'단기 약세',longBear:'장기 약세'})[u.regime]??'국면 미확인')}</span></p>
 ${facts([['예산·목표·손절',`예산 상한 ${rate(u.maxWeight)} · 목표 ${rate(u.targetReturn)} · 손절 ${rate(Number.isFinite(u.lossLimit)?-u.lossLimit:null)} · 절반 축소 기준 ${rate(Number.isFinite(u.lossLimit)?-u.lossLimit/2:null)} · 기한 ${u.horizonMonths??'미확인'}개월${u.expiresAt?' / '+esc(u.expiresAt):''}`],['구성 비중',(u.members??[]).map(m=>esc(m.symbol)+' '+rate(m.weight)).join(' · ')],['배분 이유',esc(u.allocationReason??'미기록')],['위험 근거',esc(u.riskBasis??'미기록')],(u.reviewLog??[]).length&&['검토 기록',u.reviewLog.map(x=>`${esc(x.date)} · ${esc(x.reason)}`).join('<br>')],u.exitReason&&['청산 판단',esc(u.exitReason)]])}</div>`).join('')}
 </div></details>`).join('')}
 ${review.portfolioUnitRisk?`<p class="weekly-footnote">유닛 간 상관 0.8 이상 ${(review.portfolioUnitRisk.concentrationPairs??[]).map(x=>esc(x.a)+' / '+esc(x.b)+' '+number(x.correlation)).join(' · ')||'관측 없음'} · 상관 미확인 ${review.portfolioUnitRisk.unavailablePairs??0}쌍 · ${esc(review.portfolioUnitRisk.limitations??'')}</p>`:''}
 <p class="weekly-footnote">팩터는 0~100점의 내부 단순 점수이며 MSCI 공식 점수가 아닙니다. Value=연간 PER, Quality=ROE, Growth=연간 매출성장, Momentum=가격 추세 점수입니다. FF3 알파는 방향별 알파 t값 점수이며, 알파가 있으면 5요소 각 20%, 알파 미확인 시 4요소 각 25%로 계산합니다. 베타·R²는 위험 참고값입니다. Size·Dividend 점수와 EPS 전망 수정치는 미수집입니다. 가격모멘텀·위험값은 수집 가격과 고정 환율 변환 기준이며 역사적 환율 위험을 반영하지 않습니다. 재무 수집이 30일 이상 경과하거나 필수 팩터·숫자 검증이 미충족이면 계량 검증 완료로 표시하지 않습니다.</p>
 <p class="weekly-footnote">변동성은 최대 최근 252개 일간 수익률, 최소 60개 관측의 연율 값입니다. VaR는 과거 중첩 60거래일 손실의 90%·95% 분위수이며 최소 120개 중첩 구간이 필요합니다. 독립 표본·미래 최대손실 보장이 아니며 개별 VaR 가중평균은 바스켓 VaR가 아닙니다.</p></section>`;
}
// Model-written report text arrives as plain text; each line becomes its own paragraph.
function paragraphs(text,esc){
 const lines=String(text??'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
 return lines.length?lines.map(x=>`<p>${esc(x)}</p>`).join(''):'<p class="muted">미기록</p>';
}
export function weeklyReportsPage(state,{esc,num,pct}){
 const reports=state.weeklyReports??[],money=x=>x===null||x===undefined?'—':num(x)+'원';
 const section=(title,text)=>`<section class="weekly-section"><h3 class="weekly-heading">${title}</h3><div class="weekly-body">${paragraphs(text,esc)}</div></section>`;
 const k=r=>r.unitPerformance,ratio=x=>x===null?'미확인':pct(x);
 return `<div class="page-title"><h1>주간 운용보고서</h1><span class="muted">매주 토요일 09:00</span></div>${reports.length?reports.map((r,i)=>`<details class="panel spaced weekly-report" ${i===0?'open':''}><summary class="weekly-title">${esc(r.period.start)} — ${esc(r.period.end)}${r.coverage.complete?'':' <span class="muted">· 부분 기간</span>'}</summary><div class="weekly-content"><div class="stats"><article><span>기간 손익</span><strong style="font-size:24px">${money(r.metrics.pnl)}</strong></article><article><span>기간 수익률</span><strong style="font-size:24px">${r.metrics.returnRate===null?'—':pct(r.metrics.returnRate)}</strong></article><article><span>최근 기록 자산</span><strong style="font-size:24px">${money(r.metrics.endingEquity)}</strong></article><article><span>체결</span><strong style="font-size:24px">${r.metrics.executions}건</strong></article></div>
 ${section('매크로 판단·시장 국면',r.marketOverview)}${section('Universe 선택·종목 선정 이유',r.selectionReview)}
 ${strategyEvidence(r.strategyReview,{esc,num,pct})}
 ${section('운용 결과·위험·청산 복기',r.resultsReview)}${section('다음 주 촉매·진입·교체 조건',r.nextWeekPlan)}
 <footer class="weekly-notes">${k(r)?`<p class="weekly-footnote">주간 종료 유닛 ${k(r).closed}개 · 수익 성공률 ${ratio(k(r).hitRatio)} · 목표 도달률 ${ratio(k(r).targetHitRatio)} · 평균 수익 ${ratio(k(r).averageWin)} · 평균 손실 ${ratio(k(r).averageLoss)} · 평균 보유 ${k(r).averageHoldingDays===null?'미확인':k(r).averageHoldingDays.toFixed(1)+'일'}</p>`:''}
 <p class="weekly-footnote">수수료 ${money(r.metrics.fees)} · 실현손익 ${money(r.metrics.realizedPnl)} · ${esc(r.coverage.lastObservation??'관측 기록 없음')}</p><p class="weekly-footnote">${esc(r.coverage.limitation)}</p>${r.sources.length?`<details class="source-fold"><summary>보고서 출처 ${r.sources.length}개</summary><div>${r.sources.map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>`).join('')}</div></details>`:''}</footer></div></details>`).join(''):'<section class="panel"><div class="empty">첫 보고서 예정 · 토요일 오전 9시</div></section>'}`;
}
