import {createState,coreCompanies} from '../web/engine.mjs';
import {cleanResearch} from '../worker/account.mjs';
export const testNow=Date.UTC(2026,9,5,0),url='https://example.com/index';
export function ideaResearch(){
 const referenceIndex={name:'시험 참조지수',asOf:'2026-10-01',constituents:['005930','000660'],sourceUrls:[url]};
 const idea={id:'kr-ai',name:'한국 AI 인프라',sourceDepartments:['screening','market'],region:'한국',category:'theme',asOf:new Date(testNow).toISOString(),thesis:'산업 수요와 사업 매출 연결',catalyst:'출하·현금 회수 확인',whatToWatch:'고객 집중·출하·현금흐름',invalidation:'수요와 현금 회수 논리 훼손',candidates:['005930','000660'].map(symbol=>({symbol,reason:'사업 관련 후보'})),referenceIndex,sourceUrls:[url],opposingViews:[],action:'review',withdrawalReason:''};
 return {asOf:new Date(testNow).toISOString(),topDown:'산업 컨셉 조사',bottomUp:'기업 검토',marketReview:'시장 적합성',decision:'최종 두 기업 선정',limitations:'시험 자료',sources:[{title:'시험 근거',url}],investmentIdeas:[idea],macroScorecard:['leading','growth','inflation','policy','liquidity'].map(factor=>({factor,region:'한국',signal:'neutral',observedAt:'2026-10-01',reason:'관측 근거',sourceUrls:[url]})),departmentResearch:Object.fromEntries(['fundamental','technical'].map(d=>[d,['005930','000660'].map(symbol=>({ideaId:idea.id,symbol,stance:'allow',score:80,reason:d==='fundamental'?'사업 연결 확인':'진입 시점 지원',businessPass:d==='fundamental',sourceUrls:[url]}))])),trendUnits:[{id:'test-unit',ideaId:idea.id,name:'검증 바스켓',category:'theme',riskProfile:'defensive',regime:'shortBear',direction:'short',region:'한국',thesis:idea.thesis,catalyst:idea.catalyst,invalidation:idea.invalidation,allocationReason:'기업·기술·위험 검토 배분',riskBasis:'손실 예산',targetReturn:.1,lossLimit:.1,maxWeight:.2,horizonMonths:2,members:['005930','000660'].map(symbol=>({symbol,weight:.5,reason:'최종 선정'})),reserves:[],excluded:[],referenceIndex,sourceUrls:[url],action:'hold',exitReason:''}]};
}
export function ideaState(){const s=createState();Object.assign(s,{mode:'live',investmentProcessVersion:5,date:'2026-10-05',plans:[],holdings:[],trades:[],activeSymbols:coreCompanies.map(c=>c.symbol),fx:{KRW:1,USD:1400,JPY:9.5}});return s;}
export function eligibleIdeaAccount(){const s=ideaState();s.data=Object.fromEntries(coreCompanies.map(c=>[c.symbol,Array.from({length:320},(_,i)=>{const p=100000*Math.pow(.999,i);return {open:p,close:p,high:p*1.00001,low:p*.99999,volume:1000000};})]));s.marketData={fetchedAt:new Date(testNow).toISOString(),quotes:Object.fromEntries(coreCompanies.map(c=>[c.symbol,{price:s.data[c.symbol].at(-1).close,time:testNow/1000,currency:c.currency}]))};s.externalResearch=cleanResearch(ideaResearch());s.externalResearch.fresh=true;s.fundamentals=Object.fromEntries(['005930','000660'].map(symbol=>[symbol,{pass:true,numericPass:true,fetchedAt:new Date(testNow).toISOString(),checks:[{name:'숫자 검증',pass:true}],metrics:{pe:10,roe:.1,revenueGrowth:.1}}]));return s;}

// Explicit test-only migration of the old fixture's final basket into a discovered concept.
export function withIdea(raw){
 const unit=raw.trendUnits[0],id='fixture-idea';
 raw.investmentIdeas=[{id,name:unit.name,sourceDepartments:['screening','market'],region:unit.region,category:unit.category,asOf:raw.asOf,thesis:unit.thesis,catalyst:unit.catalyst,whatToWatch:'실적과 가격 검증',invalidation:unit.invalidation,candidates:unit.members.map(m=>({symbol:m.symbol,reason:m.reason})),referenceIndex:structuredClone(unit.referenceIndex),sourceUrls:unit.sourceUrls,opposingViews:[],action:'review'}];
 unit.ideaId=id;
 for(const department of ['fundamental','technical'])raw.departmentResearch[department]=raw.departmentResearch[department].filter(r=>unit.members.some(m=>m.symbol===r.symbol)).map(r=>({...r,ideaId:id}));
 return raw;
}
