import {readAccount,context,sessionFor,verifyOperatorException,researchCheck,cleanResearch} from './account.mjs';
import {quantScreening} from '../web/quant-research.mjs';
import {canonical,requestDigest,verifyApproval,validVerdict,CODE_DIGEST,EXECUTION_REVIEW_TTL,MAX_REQUEST_BYTES} from './logic-review.mjs';

const fail=(reason,status=400)=>{throw Object.assign(Error(reason),{status,reason})};
export const cloudConfigured=env=>env.CLOUD_REVIEW_ENABLED==='true'&&!!env.CLOUD_REVIEW_PUBLIC_KEY&&!!env.CLOUD_REVIEW_DISPATCH_TOKEN&&/^[\w.-]+\/[\w.-]+$/.test(env.CLOUD_REVIEW_REPOSITORY??'');
const immutable=c=>Object.fromEntries(Object.entries(c).filter(([k])=>!['research','decision','reviewProof','expectedRevision'].includes(k)));
const row=(db,id)=>db.prepare('SELECT j.*,w.started_at,w.deadline,w.session_key FROM review_job j JOIN review_window w ON w.id=j.window_id WHERE j.id=?').bind(id).first();
async function evidence(db,j){
 const rows=await db.prepare('SELECT part,body FROM review_evidence WHERE job_id=? ORDER BY part').bind(j.id).all();
 if(!j.chunk_count||rows.results.length!==j.chunk_count||rows.results.some((r,i)=>r.part!==i))fail('reviewEvidenceUnavailable',409);
 return JSON.parse(rows.results.map(r=>r.body).join(''));
}
async function saveEvidence(db,id,value){
 const raw=JSON.stringify(value),statements=[];
 // D1 rows are limited to2MB; 500,000 UTF-16 units fit below1.5MB UTF-8.
 for(let start=0;start<raw.length;){
  let end=Math.min(raw.length,start+500000);
  if(end<raw.length&&raw.charCodeAt(end-1)>=0xd800&&raw.charCodeAt(end-1)<=0xdbff)end--;
  statements.push(db.prepare('INSERT INTO review_evidence (job_id,part,body) VALUES (?,?,?)').bind(id,statements.length,raw.slice(start,end)));start=end;
 }
 await db.batch([...statements,db.prepare("UPDATE review_job SET chunk_count=?,status='pending' WHERE id=? AND status='creating'").bind(statements.length,id)]);
}
async function currentJob(env,id,now){
 if(typeof id!=='string'||id.length>64)fail('invalidJob');
 const j=await row(env.DB,id);if(!j)fail('jobNotFound',404);
 const a=await readAccount(env.DB,false);
 const proofExpired=j.status==='approved'&&JSON.parse(j.result??'{}').reviewProof?.expiresAt<=now;
 let stale=now>=j.deadline||proofExpired||j.code_digest!==CODE_DIGEST||a.revision!==j.revision||a.metadata.paused;
 try{stale ||= sessionFor(j.market,j.phase,now).key!==j.session_key;}catch{stale=true}
 if(stale){
  const expired=now>=j.deadline;
  if(expired)await env.DB.prepare('DELETE FROM review_evidence WHERE job_id=?').bind(id).run();
  await env.DB.prepare("UPDATE review_job SET status='expired',chunk_count=?,result=NULL WHERE id=?").bind(expired?0:j.chunk_count,id).run();
  return {...j,status:'expired',chunk_count:expired?0:j.chunk_count,result:null};
 }
 return j;
}
function publicJob(j){
 return {id:j.id,windowId:j.window_id,scope:j.scope,digest:j.digest,codeDigest:j.code_digest,revision:j.revision,round:j.round,status:j.status,reviewStartedAt:j.started_at,reviewDeadline:j.deadline,...(j.result?JSON.parse(j.result):{})};
}
export async function getCloudJob(env,id,now=Date.now()){return publicJob(await currentJob(env,id,now));}
export async function getCloudRetry(env,id,now=Date.now()){
 const j=await currentJob(env,id,now);
 if(!['rejected','approved','expired','error'].includes(j.status)||!j.chunk_count||now>=j.deadline)fail('reviewCannotBeRetried',409);
 return {...publicJob(j),candidate:(await evidence(env.DB,j)).candidate};
}
export async function queueReview(env,input,now=Date.now(),send=fetch){
 if(!cloudConfigured(env))fail('cloudReviewNotConfigured',503);
 if(new TextEncoder().encode(JSON.stringify(input)).length>MAX_REQUEST_BYTES)fail('reviewRequestTooLarge');
 if(Object.keys(input).some(k=>!['scope','candidate','reviewStartedAt','reviewDeadline','windowId','previousJobId'].includes(k)))fail('unknownQueueField');
 const {scope,candidate,reviewStartedAt:started,reviewDeadline:deadline}=input;
 const allowed=scope==='/api/run'?['market','phase','marketSnapshot','fundamentals','research','expectedRevision']:scope==='/api/allocation'?['market','phase','snapshots','failures','decision','expectedRevision']:null;
 if(!allowed||!candidate||Object.keys(candidate).some(k=>!allowed.includes(k)))fail('invalidReviewScope');
 if(!Number.isSafeInteger(started)||!Number.isSafeInteger(deadline)||started<=0||started>now||deadline<=now||deadline>started+EXECUTION_REVIEW_TTL)fail('invalidReviewWindow');
 if(!candidate.market||!candidate.phase)fail('sessionPhaseRequired');
 const session=sessionFor(candidate.market,candidate.phase,now),a=await readAccount(env.DB,false);
 const endMinute=session.phase==='pre'?(session.market==='us'?570:540):session.phase==='open'?(session.market==='us'?960:930):1440;
 if(deadline>now-now%60000+(endMinute-session.minute)*60000)fail('reviewCrossesMarketPhase');
 if(!Number.isSafeInteger(candidate.expectedRevision)||candidate.expectedRevision!==a.revision)fail('revisionChanged',409);
 if(a.metadata.paused)fail('accountPaused',409);
 const prices=scope==='/api/run'?[candidate.marketSnapshot]:Array.isArray(candidate.snapshots)?candidate.snapshots:[];
 const stamps=prices.map(p=>typeof p?.fetchedAt==='string'?Date.parse(p.fetchedAt):NaN);
 const evidenceClock=session.phase==='pre'?started:now;
 if(!stamps.length||stamps.some(t=>!Number.isFinite(t)||t>started||evidenceClock-t>EXECUTION_REVIEW_TTL))fail('priceEvidenceStale');
 if(session.phase!=='pre'&&deadline>Math.min(...stamps)+EXECUTION_REVIEW_TTL)fail('invalidReviewWindow');
 await env.DB.prepare('DELETE FROM review_evidence WHERE job_id IN (SELECT j.id FROM review_job j JOIN review_window w ON w.id=j.window_id WHERE w.deadline<=?)').bind(now).run();
 await env.DB.prepare('UPDATE review_job SET chunk_count=0,result=NULL WHERE window_id IN (SELECT id FROM review_window WHERE deadline<=?)').bind(now).run();
 // Only a new collection after expiry can replace a session's window; retries keep its clock.
 await env.DB.prepare('INSERT INTO review_window (id,session_key,started_at,deadline,rounds) VALUES (?,?,?,?,0) ON CONFLICT(session_key) DO UPDATE SET id=excluded.id,started_at=excluded.started_at,deadline=excluded.deadline,rounds=0 WHERE review_window.deadline<=? AND excluded.started_at>=review_window.deadline AND ?>=review_window.deadline AND ?').bind(crypto.randomUUID(),session.key,started,deadline,now,Math.min(...stamps),input.windowId||input.previousJobId?0:1).run();
 const w=await env.DB.prepare('SELECT * FROM review_window WHERE session_key=?').bind(session.key).first();
 if(w.started_at!==started||w.deadline!==deadline||(input.windowId&&input.windowId!==w.id))fail('reviewWindowChanged',409);
 // Expired jobs keep only their small ledger until the daily pruning below.
 await env.DB.prepare('DELETE FROM review_job WHERE created_at<?').bind(now-86400000).run();
 await env.DB.prepare('DELETE FROM review_window WHERE deadline<?').bind(now-86400000).run();
 const digest=await requestDigest(candidate);
 const duplicate=await env.DB.prepare('SELECT id FROM review_job WHERE window_id=? AND scope=? AND digest=?').bind(w.id,scope,digest).first();
 if(duplicate){if(duplicate.id===input.previousJobId)fail('reviewCandidateUnchanged',409);return getCloudJob(env,duplicate.id,now);}
 const prior=await env.DB.prepare('SELECT * FROM review_job WHERE window_id=? AND scope=? ORDER BY round DESC LIMIT 1').bind(w.id,scope).first();
 if(prior){
  if(input.previousJobId!==prior.id||!['rejected','approved','expired','error'].includes(prior.status)||(!prior.chunk_count&&prior.status!=='error'))fail('previousReviewRequired',409);
  if(await requestDigest(immutable(candidate))!==prior.immutable_digest)fail('collectedEvidenceChanged',409);
 }
 const id=crypto.randomUUID();
 const accountContext=context(a);delete accountContext.metadata.jevEvaluations;
 // A pre-market run carries its own new research; on 2026-10-23 a US basket was reviewed beside the stored asia
 // research's readiness and quant ranking, which the reviewer rightly called inconsistent.
 if(scope==='/api/run'&&candidate.research){
  accountContext.researchReadiness=researchCheck({...a.state,investmentProcessVersion:5},candidate.research,now);
  try{accountContext.investmentProcess.quantResearch=quantScreening({...a.state,externalResearch:cleanResearch(candidate.research)},a.state.analysis?.reports??[],now);}
  catch{accountContext.investmentProcess.quantResearch=[];}
 }
 const inserted=await env.DB.prepare("INSERT OR IGNORE INTO review_job (id,window_id,scope,digest,immutable_digest,code_digest,revision,market,phase,round,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,0,'creating',?)").bind(id,w.id,scope,digest,await requestDigest(immutable(candidate)),CODE_DIGEST,a.revision,session.market,session.phase,now).run();
 if(!inserted.meta.changes){const found=await env.DB.prepare('SELECT id FROM review_job WHERE window_id=? AND scope=? AND digest=?').bind(w.id,scope,digest).first();return getCloudJob(env,found.id,now)}
 const next=await env.DB.prepare('UPDATE review_window SET rounds=rounds+1 WHERE id=? AND rounds<5 RETURNING rounds').bind(w.id).first();
 if(!next){await env.DB.prepare('DELETE FROM review_job WHERE id=?').bind(id).run();fail('reviewRoundLimit',409)}
 await env.DB.prepare('UPDATE review_job SET round=? WHERE id=?').bind(next.rounds,id).run();
 try{await saveEvidence(env.DB,id,{candidate,context:{...accountContext,logicReview:{required:true,configured:true,codeDigest:CODE_DIGEST,maxMinutes:30,maxRounds:5}}})}
 catch{
  await env.DB.prepare("UPDATE review_job SET status='error',result=? WHERE id=? AND status='creating'").bind(JSON.stringify({approved:false,reason:'evidenceStoreUnavailable'}),id).run();
  return getCloudJob(env,id,now);
 }
 try{
  const response=await send(`https://api.github.com/repos/${env.CLOUD_REVIEW_REPOSITORY}/actions/workflows/claude-review.yml/dispatches`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+env.CLOUD_REVIEW_DISPATCH_TOKEN,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'CommitteeLab','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({ref:env.CLOUD_REVIEW_REF||'main',inputs:{job_id:id}})});
  if(response.status!==204)throw Error('dispatch declined');
 }catch{
  await env.DB.prepare("UPDATE review_job SET status='error',result=? WHERE id=? AND status='pending'").bind(JSON.stringify({approved:false,reason:'dispatchUnavailable'}),id).run();
 }
 return getCloudJob(env,id,now);
}
export async function claimCloudJob(env,id,input,now=Date.now()){
 if(!cloudConfigured(env))fail('cloudReviewNotConfigured',503);
 if(Object.keys(input).some(k=>k!=='claimId')||typeof input.claimId!=='string'||!input.claimId||input.claimId.length>64)fail('invalidClaim');
 const j=await currentJob(env,id,now);if(j.status!=='pending')return {...publicJob(j),claimed:false};
 const changed=await env.DB.prepare("UPDATE review_job SET status='running',claim_id=? WHERE id=? AND status='pending'").bind(input.claimId,id).run();
 if(!changed.meta.changes)return {claimed:false,id};
 return {...publicJob(j),status:'running',claimed:true,...await evidence(env.DB,j)};
}
export async function finishCloudJob(env,id,input,now=Date.now()){
 const j=await currentJob(env,id,now);
 if(j.status!=='running'||j.claim_id!==input.claimId)fail('claimChanged',409);
 if(Object.keys(input).some(k=>!['claimId','verdict','reviewProof','reason'].includes(k)))fail('unknownResultField');
 let result,status;
 if(['reviewUnavailable','claudeUsageLimit','claudeAuthenticationUnavailable'].includes(input.reason)&&!input.verdict){result={approved:false,reason:input.reason};status='error'}
 else{
  if(!validVerdict(input.verdict))fail('malformedVerdict');
  result={approved:input.verdict.approved,verdict:input.verdict,issues:input.verdict.issues};status=result.approved?'approved':'rejected';
  if(result.approved){
   if(input.reviewProof?.cloudJobId!==id)fail('jobProofRequired');
   const valid=await verifyApproval({...(await evidence(env.DB,j)).candidate,reviewProof:input.reviewProof},j.scope,env.CLOUD_REVIEW_PUBLIC_KEY,CODE_DIGEST,now);
   if(!valid.approved||input.reviewProof.summary!==input.verdict.summary)fail('invalidCloudProof');
   result.reviewProof=input.reviewProof;
  }else if(input.reviewProof)fail('rejectionCannotBeSigned');
 }
 const changed=await env.DB.prepare('UPDATE review_job SET status=?,result=? WHERE id=? AND status=\'running\' AND claim_id=?').bind(status,JSON.stringify(result),id,input.claimId).run();
 if(!changed.meta.changes)fail('claimChanged',409);
 return getCloudJob(env,id,now);
}
export async function verifyRuntimeApproval(input,scope,env,now=Date.now()){
 if(input.operatorException!==undefined)return verifyOperatorException(input,scope,env,await readAccount(env.DB,false),now);
 const id=input.reviewProof?.cloudJobId;
 if(!id)return verifyApproval(input,scope,env.CLAUDE_REVIEW_PUBLIC_KEY,CODE_DIGEST,now);
 if(!cloudConfigured(env))return {approved:false,reason:'cloudReviewNotConfigured'};
 try{
  const job=await currentJob(env,id,now),result=job.result&&JSON.parse(job.result);
  if(job.status!=='approved'||job.scope!==scope||!result||canonical(result.reviewProof)!==canonical(input.reviewProof))return {approved:false,reason:'cloudReviewHeld'};
  const approval=await verifyApproval(input,scope,env.CLOUD_REVIEW_PUBLIC_KEY,CODE_DIGEST,now);
  return approval.approved&&job.phase==='pre'?{...approval,reviewStartedAt:job.started_at}:approval;
 }catch{return {approved:false,reason:'cloudReviewHeld'}}
}
