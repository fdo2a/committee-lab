import {researchData} from './research-data.mjs';
import {collectUsResearch} from './us-research.mjs';
import {evaluateUsCandidates,getJevEvaluations,jevWorkflow} from './jev-candidates.mjs';
import {CODE_DIGEST,MAX_REQUEST_BYTES,EXECUTION_REVIEW_TTL,verifyApproval} from './logic-review.mjs';
import {cloudConfigured,queueReview,getCloudJob,getCloudRetry,claimCloudJob,finishCloudJob,verifyRuntimeApproval} from './cloud-review.mjs';
import {marketReports,compactReports} from './market-reports.mjs';
import {handleMcp} from './mcp.mjs';
import {authenticate} from './auth.mjs';
import {validateWatchlist} from './watchlist.mjs';
import {addManualCandidate,removeManualCandidate} from './manual-candidates.mjs';
import {validateMarket,hasRegularMarketSession} from './market-data.mjs';
import {reportWeek,weeklyReportContext,saveWeeklyReport} from './weekly-reports.mjs';
import {enableRegularExecution} from '../web/execution.mjs';
import assets from "./assets.generated.mjs";
import {
  readAccount,operatorExceptionStatus,importLedger,
  writeAccount,
  runScheduled,
  applyAction,
  nextRun,
  PIPELINE_VERSION,context,prepareAllocation,saveRun,recentRuns,slotFor,researchCheck,prepareResearch,prepareUniverse,universeCatalog,isTradingWeekday,sessionFor,
} from "./account.mjs";
// Routes the updater, risk monitor and cloud reviewer call with a service token. Paid, watchlist and account-setting routes stay owner-only.
const SERVICE_ROUTES = ["/api/import", "/api/context", "/api/session", "/api/account", "/api/runs", "/api/run", "/api/attempt", "/api/research", "/api/research-check", "/api/research-data", "/api/us-research", "/api/jev-evaluate", "/api/jev-evaluations", "/api/universe", "/api/allocation", "/api/market-reports", "/api/weekly-report-context", "/api/weekly-reports"];
const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function body(request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw Error("JSON 요청이 필요합니다.");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_REQUEST_BYTES) throw Error("요청은 UTF-8 10MB 이하여야 합니다.");
  return JSON.parse(raw);
}
async function weeklyRuns(db,weekStart){
  const period=reportWeek(weekStart),rows=await db.prepare('SELECT * FROM run_log WHERE started_at >= ? AND started_at <= ? ORDER BY started_at').bind(new Date(period.startAt).toISOString(),new Date(period.endAt).toISOString()).all();
  return rows.results.map(r=>({...r,report:JSON.parse(r.report)}));
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      // Every route, static files included, needs a verified identity before anything is served.
      const identity = await authenticate(request, env);
      if (!identity) return json({ error: "Cloudflare Access 인증이 필요합니다." }, 401);
      // Service identity (updater, reviewer) is limited to the routes those clients use; every other API route needs the owner.
      if (identity.kind !== "owner" && url.pathname.startsWith("/api/") && !SERVICE_ROUTES.includes(url.pathname) && !url.pathname.startsWith("/api/logic-review"))
        return json({ error: "소유자 로그인이 필요한 경로입니다." }, 403);
      if (url.pathname === '/mcp') return await handleMcp(request, env, identity);
      if (!url.pathname.startsWith("/api/")) {
        const path = url.pathname === "/" ? "/index.html" : url.pathname;
        const text = assets[path];
        if (!text) return new Response("Not found", { status: 404 });
        const type = path.endsWith(".py")?"text/plain":path.endsWith(".mjs")
          ? "text/javascript"
          : path.endsWith(".css")
            ? "text/css"
            : path.endsWith(".svg")
              ? "image/svg+xml"
              : "text/html";
        return new Response(text, {
          headers: {
            "Content-Type": type + "; charset=utf-8",
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      if (!env.DB)
        return json({ error: "서버 저장소를 연결하지 못했습니다." }, 503);
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin)
        return json(
          { error: "다른 사이트에서의 변경 요청은 허용하지 않습니다." },
          403,
        );
      if(url.pathname==='/api/context'&&request.method==='GET'){
       const a=await readAccount(env.DB),c=context(a);delete c.metadata.jevEvaluations;
       return json({...c,jevWorkflow:jevWorkflow(env),logicReview:{required:true,configured:!!env.CLAUDE_REVIEW_PUBLIC_KEY||cloudConfigured(env),cloudConfigured:cloudConfigured(env),operatorException:operatorExceptionStatus(env,a),cloudQueue:'/api/logic-review',codeDigest:CODE_DIGEST,role:'논리 정합성·전제 모순·근거에서 결론으로의 비약',riskExitExempt:true,maxRounds:5,maxMinutes:EXECUTION_REVIEW_TTL/60000}});
      }
      if(url.pathname==='/api/logic-review'&&request.method==='POST')return json(await queueReview(env,await body(request)));
      if(url.pathname==='/api/logic-review/check'&&request.method==='POST'){
       const input=await body(request),a=await readAccount(env.DB,false);
       if(Object.keys(input).some(k=>!['purpose','nonce','expectedRevision','reviewProof'].includes(k))||input.expectedRevision!==a.revision)return json({approved:false,reason:'diagnosticChanged'},409);
       return json({...await verifyApproval(input,'/api/logic-review/check',env.CLOUD_REVIEW_PUBLIC_KEY),accountWrite:false});
      }
      const jobRoute=url.pathname.match(/^\/api\/logic-review\/([\w-]+)(?:\/(claim|result|input))?$/);
      if(jobRoute){
       const [,id,operation]=jobRoute;
       if(!operation&&request.method==='GET')return json(await getCloudJob(env,id));
       if(operation==='input'&&request.method==='GET')return json(await getCloudRetry(env,id));
       if(request.method==='POST'&&operation==='claim')return json(await claimCloudJob(env,id,await body(request)));
       if(request.method==='POST'&&operation==='result')return json(await finishCloudJob(env,id,await body(request)));
      }
      if(url.pathname==='/api/session'&&request.method==='GET'){
        try{return json(sessionFor(url.searchParams.get('market'),url.searchParams.get('phase')??'auto'))}
        catch{return json({skipped:true,reason:'outsideMarketPhase'});}
      }
      if(url.pathname==='/api/runs'&&request.method==='GET')return json({runs:await recentRuns(env.DB)});
      if(url.pathname==='/api/weekly-report-context'&&request.method==='GET'){
        const a=await readAccount(env.DB),week=url.searchParams.get('weekStart')??undefined;
        return json(weeklyReportContext(a,await weeklyRuns(env.DB,week),week));
      }
      if(url.pathname==='/api/weekly-reports'&&request.method==='GET')return json({reports:(await readAccount(env.DB)).state.weeklyReports??[]});
      if(url.pathname==='/api/weekly-reports'&&request.method==='POST'){
        const input=await body(request),a=await readAccount(env.DB);
        if(Object.keys(input).some(k=>!['report','expectedRevision'].includes(k)))throw Error('지원하지 않는 보고서 인자입니다.');
        if(input.expectedRevision!==a.revision)return json({error:'최신 revision으로 보고서 저장을 재시도하세요.'},409);
        const existing=a.state.weeklyReports?.find(r=>r.id===input.report?.weekStart);
        if(existing)return json({reused:true,revision:a.revision,report:existing});
        const report=saveWeeklyReport(a,await weeklyRuns(env.DB,input.report?.weekStart),input.report),saved=await writeAccount(env.DB,a,a.state);
        return json({saved:true,revision:saved.revision,report});
      }
      if(url.pathname==='/api/attempt'&&request.method==='POST'){
        const input=await body(request),session=input.phase||input.market?sessionFor(input.market,input.phase):null;
        if(!session&&!isTradingWeekday(Date.now()))return json({skipped:true,reason:'weekend'});
        const a=await readAccount(env.DB);if(a.metadata.paused)return json({paused:true});
        if(!['running','failed','researchIncomplete'].includes(input.status))throw Error('상태 오류');
        if(!session&&a.metadata.lastSlot!==null&&a.metadata.lastSlot>=slotFor(Date.now()))return json({reused:true});
        await saveRun(env.DB,session?.slot??slotFor(Date.now()),input.status,{...(session?{session}:{}),message:typeof input.message==='string'?input.message.slice(0,1000):'Python 수집·부서 검토 진행 중',...(input.status==='researchIncomplete'?{researchReadiness:researchCheck(a.state,input.research)}:{})});return json({saved:true});
      }
      if(url.pathname==='/api/allocation'&&request.method==='POST'){
        const input=await body(request),a=await readAccount(env.DB);
        if(Object.keys(input).some(k=>!['snapshots','failures','decision','expectedRevision','phase','market','reviewProof','operatorException'].includes(k)))throw Error('지원하지 않는 배분 인자입니다.');
        if(input.expectedRevision!==a.revision)return json({error:'최신 revision으로 자산 배분을 재시도하세요.'},409);
        if(a.metadata.paused)return json({paused:true,revision:a.revision});
        const logicReview=await verifyRuntimeApproval(input,'/api/allocation',env);
        const summary=prepareAllocation(a,input,Date.now(),logicReview),saved=await writeAccount(env.DB,a,a.state);
        return json({revision:saved.revision,summary,logicReview,assetAllocation:saved.state.assetAllocation});
      }
      if(url.pathname==='/api/providers'&&request.method==='GET')return json({DART_API_KEY:!!env.DART_API_KEY,EDINET_API_KEY:!!env.EDINET_API_KEY,FRED_API_KEY:!!env.FRED_API_KEY,TYPESAFE_API_KEY:!!env.TYPESAFE_API_KEY,SEC_USER_AGENT:!!env.SEC_USER_AGENT,priceProvider:'Yahoo Finance / Python'});
      if(url.pathname==='/api/us-research'&&request.method==='POST'){
        // The researcher's service identity gets SEC filing lists only; paid JEV filing ranking stays owner-only.
        // Its JEV candidate comparison goes through /api/jev-evaluate (scripts/research-agent.mjs jevCycle).
        const input=await body(request);
        if(identity.kind!=='owner'&&input?.useJev!==false)return json({error:'서비스 호출은 useJev:false로 SEC 목록만 요청할 수 있습니다.'},403);
        return json(await collectUsResearch(env,input));
      }
      if(url.pathname==='/api/jev-evaluate'&&request.method==='POST')return json(await evaluateUsCandidates(env,await body(request)));
      if(url.pathname==='/api/jev-evaluations'&&request.method==='GET')return json(await getJevEvaluations(env));
      if(url.pathname==='/api/research-data'&&request.method==='GET'){
        const [data,reports]=await Promise.all([researchData(env),marketReports()]);return json({...data,marketReports:compactReports(reports)});
      }
      if(url.pathname==='/api/market-reports'&&request.method==='GET')return json(compactReports(await marketReports()));
      if(url.pathname==='/api/market-reports'&&request.method==='POST'){
        const input=await body(request),a=await readAccount(env.DB);
        if(Object.keys(input).some(k=>k!=='expectedRevision'))throw Error('지원하지 않는 보고서 인자입니다.');
        if(input.expectedRevision!==a.revision)return json({error:'최신 revision으로 시황 자료를 저장하세요.'},409);
        const reports=await marketReports();
        // Preserve the last verified body on failure, with an explicit failed-refresh timestamp.
        const previous=a.state.marketReports?.reports??[];
        a.state.marketReports={...reports,reports:reports.reports.map(r=>r.status==='unavailable'?{...previous.find(p=>p.market===r.market),...r}:r)};
        const saved=await writeAccount(env.DB,a,a.state);return json({revision:saved.revision,marketReports:compactReports(saved.state.marketReports)});
      }
      if(url.pathname==='/api/research-check'&&['GET','POST'].includes(request.method)){
        const a=await readAccount(env.DB);
        if(request.method==='GET')return json(researchCheck({...a.state,investmentProcessVersion:5}));
        const input=await body(request);
        if(Object.keys(input).some(k=>!['research','marketSnapshot'].includes(k)))throw Error('지원하지 않는 조사 점검 인자입니다.');
        const snapshot=input.marketSnapshot?validateMarket(input.marketSnapshot):null;
        return json({...researchCheck({...a.state,investmentProcessVersion:5,...(snapshot?{universeVersion:'indexCatalog',activeSymbols:snapshot.activeSymbols}:{})},input.research??null),...(snapshot?{marketSessionAvailable:hasRegularMarketSession(snapshot)}:{})});
      }
      if(url.pathname==='/api/research'&&request.method==='POST'){
        const input=await body(request),a=await readAccount(env.DB);
        if(Object.keys(input).some(k=>!['research','expectedRevision'].includes(k)))throw Error('지원하지 않는 조사 준비 인자입니다.');
        if(input.expectedRevision!==a.revision)return json({error:'계좌가 갱신됐습니다. 최신 revision으로 조사 준비를 재시도하세요.'},409);
        const researchReadiness=prepareResearch(a,input.research);
        const saved=await writeAccount(env.DB,a,a.state);
        return json({revision:saved.revision,status:researchReadiness.complete?'researchPrepared':'researchIncomplete',researchReadiness,researchPreparedAt:saved.state.researchPreparedAt});
      }
      if(url.pathname==='/api/universe'&&request.method==='GET')return json(universeCatalog());
      if(url.pathname==='/api/watchlist'&&request.method==='GET'){
        const a=await readAccount(env.DB);return json(a.state.watchlistData??{count:0,complete:false,observations:[],failures:[]});
      }
      if(url.pathname==='/api/watchlist'&&request.method==='POST'){
        const input=await body(request),a=await readAccount(env.DB);
        if(input.expectedRevision!==a.revision)return json({error:'최신 revision으로 감시 자료를 저장하세요.'},409);
        a.state.watchlistData=validateWatchlist(input.snapshot);
        const saved=await writeAccount(env.DB,a,a.state);
        return json({revision:saved.revision,count:saved.state.watchlistData.count,complete:saved.state.watchlistData.complete,fetchedAt:saved.state.watchlistData.fetchedAt});
      }
      // Owner-only (not in SERVICE_ROUTES): the researcher reads the list through /api/context but cannot change it.
      if(url.pathname==='/api/manual-candidates'&&request.method==='GET'){
        const a=await readAccount(env.DB);return json({revision:a.revision,manualCandidates:a.state.manualCandidates??[]});
      }
      if(url.pathname==='/api/manual-candidates'&&['POST','DELETE'].includes(request.method)){
        const input=await body(request),a=await readAccount(env.DB);
        if(Object.keys(input).some(k=>!['symbol','note','expectedRevision'].includes(k))||(request.method==='DELETE'&&input.note!==undefined))throw Error('지원하지 않는 수동 후보 인자입니다.');
        if(input.expectedRevision!==a.revision)return json({error:'계좌가 갱신됐습니다. 새로고침 후 다시 시도하세요.'},409);
        // Validation messages name the problem for the owner; the generic handler would hide them.
        try{if(request.method==='POST')addManualCandidate(a.state,input);else removeManualCandidate(a.state,input.symbol);}
        catch(error){return json({error:error.message},400);}
        const saved=await writeAccount(env.DB,a,a.state);
        return json({revision:saved.revision,manualCandidates:saved.state.manualCandidates});
      }
      if(url.pathname==='/api/universe'&&request.method==='POST'){
        const input=await body(request),a=await readAccount(env.DB);
        if(Object.keys(input).some(k=>!['marketSnapshot','fundamentals','research','expectedRevision'].includes(k)))throw Error('지원하지 않는 후보군 준비 인자입니다.');
        if(input.expectedRevision!==a.revision)return json({error:'최신 revision으로 후보군 준비를 재시도하세요.'},409);
        const researchReadiness=prepareUniverse(a,input.marketSnapshot,input.fundamentals,input.research);
        const saved=await writeAccount(env.DB,a,a.state);
        return json({revision:saved.revision,universeVersion:saved.state.universeVersion,companyCount:Object.keys(saved.state.data).length,researchReadiness,universePreparedAt:saved.state.universePreparedAt});
      }
      if (url.pathname === "/api/import" && request.method === "POST") {
        // Migration only: importLedger refuses unless the ledger (or run log) is still empty.
        try { return json(await importLedger(env.DB, await body(request))); }
        catch (error) { if (error.status === 409) return json({ error: error.message }, 409); throw error; }
      }
      if (url.pathname === "/api/account" && request.method === "GET") {
        const a = await readAccount(env.DB);
        return json({
          ...a,
          metadata: { ...a.metadata, nextRun: nextRun(Date.now(),a.metadata.sessionMode) },
        });
      }
      if (url.pathname === "/api/action" && request.method === "POST") {
        const input = await body(request),
          a = await readAccount(env.DB);
        if (input.expectedRevision !== a.revision)
          return json(
            {
              error:
                "자동 운용으로 계좌가 변경됐습니다. 최신 기록을 확인하고 다시 시도하세요.",
            },
            409,
          );
        if(input.action==='advance')return json({error:'가격 수집은 Python 클라우드 작업에서 실행합니다. 예정된 자동 실행 결과를 기다리세요.'},409);
        if(input.action==='import'&&(a.state.mode==='live'||input.state?.mode==='live')||a.state.mode==='live'&&input.action==='approve'&&!a.state.plans.find(p=>p.id===input.id)?.riskExit)return json({error:'신규 승인은 Claude 논리 검토를 거친 자동 실행에서 진행합니다.'},409);
        return json(await writeAccount(env.DB, a, applyAction(a.state, input)));
      }
      if (url.pathname === "/api/run" && request.method === "POST") {
        const input = await body(request);
        const now=Date.now(),logicReview=await verifyRuntimeApproval(input,'/api/run',env,now);
        const session=input.phase||input.market?sessionFor(input.market,input.phase,now,!logicReview.approved):null;
        if(!session&&!isTradingWeekday(now))return json({skipped:true,reason:'weekend',nextRun:nextRun(now)});
        if (Object.keys(input).some((k) => !["research","marketSnapshot","fundamentals","phase","market","expectedRevision","reviewProof","operatorException"].includes(k)))
          throw Error("지원하지 않는 실행 인자입니다.");
        const current=await readAccount(env.DB);
        const slot=slotFor(now);
        if(current.metadata.paused)return json({...current,paused:true});
        if(current.metadata.sessionMode&&!session)return json({skipped:true,reason:'sessionPhaseRequired'});
        if(input.expectedRevision!==current.revision)return json({error:'최신 revision으로 운용 단계를 다시 요청하세요.'},409);
        if(logicReview.approved&&session&&session.phase!=='pre'&&(input.research||input.fundamentals))throw Error('개장·마감 단계에서는 장전 판단을 재작성하지 않습니다.');
        if(!session&&current.metadata.lastSlot!==null&&current.metadata.lastSlot>=slot&&current.state.lastCycle?.status!=='logicReviewHeld'){await saveRun(env.DB,current.metadata.lastSlot,current.state.lastCycle?.status||'complete',{summary:current.state.lastCycle,departments:current.state.departments,research:current.state.externalResearch,learning:current.state.strategyLearning},Date.parse(current.metadata.lastRun));return json({...current,reused:true});}
        const snapshot=validateMarket(input.marketSnapshot,now,logicReview.approved&&session?.phase==='pre'?logicReview.reviewStartedAt??null:null);
        const researchReadiness=researchCheck({...current.state,mode:'live',investmentProcessVersion:5,universeVersion:'indexCatalog',activeSymbols:snapshot.activeSymbols},input.research??null,now);
        if(logicReview.approved&&(!session||session.phase==='pre')&&!researchReadiness.complete&&!researchReadiness.readyUnitIds?.length&&!current.state.holdings.length)return json({status:'researchIncomplete',researchReadiness,message:'누락 근거를 보완한 뒤 동일 실행에서 사전 점검을 다시 요청하세요.'},422);
        if(session?.phase==='pre'&&Date.parse(input.research?.asOf)>now)throw Error('미래 시각의 장전 판단은 사용할 수 없습니다.');
        if((!session||session.phase!=='pre')&&!hasRegularMarketSession(snapshot,now,session?.countries))return json({skipped:true,reason:'noVerifiedRegularSession',nextRun:nextRun(now,!!session)});
        return json(await runScheduled(env.DB, input.research,now,snapshot,input.fundamentals,session,logicReview,input.expectedRevision));
      }
      if (url.pathname === "/api/schedule" && request.method === "POST") {
        const input = await body(request);
        if (
          typeof input.enabled !== "boolean" ||
          typeof input.scheduleId !== "string" ||
          input.scheduleId.length > 300
        )
          throw Error("예약 설정이 올바르지 않습니다.");
        const a = await readAccount(env.DB);
        if(input.sessionMode!==undefined&&typeof input.sessionMode!=='boolean')throw Error('운용 방식 확인 필요');
        if(input.sessionMode===true)enableRegularExecution(a.state);
        return json(
          await writeAccount(env.DB, a, a.state, {
            ...a.metadata,
            enabled: input.enabled,
            scheduleId: input.scheduleId,
            ...(input.sessionMode!==undefined?{sessionMode:input.sessionMode}:{}),
            nextRun: nextRun(Date.now(),input.sessionMode??a.metadata.sessionMode),
          }),
        );
      }
      if (url.pathname === "/api/pause" && request.method === "POST") {
        const input = await body(request);
        if (typeof input.paused !== "boolean")
          throw Error("일시정지 설정이 올바르지 않습니다.");
        const a = await readAccount(env.DB);
        return json(
          await writeAccount(env.DB, a, a.state, {
            ...a.metadata,
            paused: input.paused,
          }),
        );
      }
      return json({ error: "지원하지 않는 요청입니다." }, 404);
    } catch (e) {
      console.error("account operation failed", e.message);
      return json(
        {
          ...(typeof e.reason==='string'?{reason:e.reason}:{}),
          error:
            e.status === 409
              ? e.message
              : "계좌 작업을 완료하지 못했습니다. 입력과 서버 연결을 확인하세요.",
        },
        e.status || 400,
      );
    }
  },
};
