import test from 'node:test';
import assert from 'node:assert/strict';
import {ideaResearch,ideaState,eligibleIdeaAccount,testNow} from './idea-fixtures.mjs';
import {researchCheck,autonomousCycle,context} from '../worker/account.mjs';
import {addManualCandidate,removeManualCandidate,manualGaps,markManualReviewed,MANUAL_PENDING_LIMIT} from '../worker/manual-candidates.mjs';
import {eligibleCatalog} from '../web/universe.mjs';
import {readFileSync} from 'node:fs';

test('only catalog stocks that are not held, pending or over the limit can be added, with a short note',()=>{
 const s=ideaState();
 addManualCandidate(s,{symbol:' 035420 ',note:' 검색 광고 회복 '},testNow);
 assert.deepEqual(s.manualCandidates.map(m=>[m.symbol,m.country,m.note]),[['035420','한국','검색 광고 회복']]);
 assert.throws(()=>addManualCandidate(s,{symbol:'035420'}),/검토 대기 중/);
 assert.throws(()=>addManualCandidate(s,{symbol:'NOTREAL'}),/후보에 있는 종목코드만/);
 assert.throws(()=>addManualCandidate(s,{symbol:'AAPL',note:'x'.repeat(301)}),/300자/);
 s.holdings=[{symbol:'7203'}];assert.throws(()=>addManualCandidate(s,{symbol:'7203'}),/보유 중/);
 const t=ideaState();
 for(const c of eligibleCatalog.slice(0,MANUAL_PENDING_LIMIT))addManualCandidate(t,{symbol:c.symbol});
 assert.throws(()=>addManualCandidate(t,{symbol:eligibleCatalog[MANUAL_PENDING_LIMIT].symbol}),/최대/);
 removeManualCandidate(t,eligibleCatalog[0].symbol);assert.equal(t.manualCandidates.length,MANUAL_PENDING_LIMIT-1);
 assert.throws(()=>removeManualCandidate(t,'NOTREAL'),/목록에 없는/);
});

test('a pending manual stock of a researched region is a gap that never holds another ready basket',()=>{
 const s=ideaState();
 for(const symbol of ['035420','AAPL'])addManualCandidate(s,{symbol},testNow);
 const result=researchCheck(s,ideaResearch(),testNow);
 // The research covers 한국 only, so the US stock waits for the US run.
 assert.deepEqual(result.missing.map(m=>[m.kind,m.symbol,m.ideaId]),[['manual','035420',null]]);
 assert.equal(result.complete,false);assert.deepEqual(result.readyUnitIds,['test-unit']);
 // Covered once it is a candidate of a live idea with sourced fundamental and technical rows.
 const raw=ideaResearch(),idea=raw.investmentIdeas[0];
 idea.candidates.push({symbol:'035420',reason:'사용자 지정 후보'});idea.referenceIndex.constituents.push('035420');
 for(const d of ['fundamental','technical'])raw.departmentResearch[d].push({...raw.departmentResearch[d][0],symbol:'035420',stance:'watch',reason:'공시 확인 후 관찰'});
 assert.equal(researchCheck(s,raw,testNow).complete,true);
 idea.action='withdraw';idea.withdrawalReason='철회';
 assert.ok(manualGaps(s,raw).some(m=>m.symbol==='035420'));
});

test('an approved pre-market save marks covered stocks reviewed with the outcome; uncovered ones stay pending',()=>{
 const s=eligibleIdeaAccount();
 for(const symbol of ['000660','035420'])addManualCandidate(s,{symbol},testNow);
 autonomousCycle(s,ideaResearch(),testNow);
 const [member,uncovered]=s.manualCandidates;
 assert.equal(member.outcome.status,'바스켓 제안');assert.equal(member.outcome.unit,'검증 바스켓');assert.ok(member.reviewedAt);
 assert.equal(uncovered.reviewedAt,undefined);
 assert.deepEqual(context({state:s,revision:1,metadata:{}}).manualCandidates.map(m=>m.symbol),['035420']);
 const watch=ideaState();addManualCandidate(watch,{symbol:'000660'},testNow);
 const raw=ideaResearch();raw.trendUnits=[];markManualReviewed(watch,raw,testNow);
 assert.equal(watch.manualCandidates[0].outcome.status,'관찰');
 // Open/close runs and unapproved reviews never mark anything.
 const later=eligibleIdeaAccount();addManualCandidate(later,{symbol:'000660'},testNow);
 autonomousCycle(later,ideaResearch(),testNow,null,null,null,{approved:false});
 assert.equal(later.manualCandidates[0].reviewedAt,undefined);
});

test('the list is owner-only and the research prompt requires covering it',()=>{
 const index=readFileSync(new URL('../worker/index.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(index.match(/const SERVICE_ROUTES = \[[^\]]*\]/)[0],/manual-candidates/);
 const agent=readFileSync(new URL('../scripts/research-agent.mjs',import.meta.url),'utf8');
 assert.match(agent,/manualCandidates는 사용자가 반드시 검토하라고 지정한 종목/);
});
