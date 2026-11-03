import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceDigest} from './code-review.mjs';
import {runtimeReviewInput,assertRuntimeReviewInput,claudeReviewer,validVerdict,signApproval,DECISION_RULES} from './logic-review.mjs';
import {requestDigest,MAX_REQUEST_BYTES,EXECUTION_REVIEW_TTL} from '../worker/logic-review.mjs';

// Cloudflare Access service token {clientId,clientSecret}, or the legacy Sites bearer string.
export const serviceHeaders=token=>token?.clientId?{'CF-Access-Client-Id':token.clientId,'CF-Access-Client-Secret':token.clientSecret}:{'OAI-Sites-Authorization':'Bearer '+token};
export async function siteRequest(origin,token,pathname,payload,deadline,send=fetch){
 const base=new URL(origin),url=new URL(pathname,base);
 if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||url.origin!==base.origin||!url.pathname.startsWith('/api/'))throw Error('Invalid Site origin');
 const response=await send(url,{method:payload===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(35000,deadline-Date.now()))),headers:{...serviceHeaders(token),...(payload===undefined?{}:{'Content-Type':'application/json'})},body:payload===undefined?undefined:JSON.stringify(payload)});
 if(!response.ok)throw Error('Site request declined');
 const raw=await response.text();if(Buffer.byteLength(raw)>2*MAX_REQUEST_BYTES)throw Error('Site result exceeds limit');
 return JSON.parse(raw);
}
export async function reviewCloudJob(config,{request=siteRequest,digest=sourceDigest,review=async input=>claudeReviewer(input.context,true,undefined,DECISION_RULES)(input.candidate,config.deadline)}={}){
 if(typeof config.jobId!=='string'||!/^[-\w]{1,64}$/.test(config.jobId)||!config.token||!config.privateKey)throw Error('Cloud credentials required');
 const claimId=randomUUID(),limit=Date.now()+EXECUTION_REVIEW_TTL;
 const call=(route,payload)=>request(config.origin,config.token,route,payload,config.deadline??limit);
 const route='/api/logic-review/'+config.jobId;
 const job=await call(route+'/claim',{claimId});
 if(!job.claimed)return {id:config.jobId,status:job.status??'held'};
 config.deadline=job.reviewDeadline;
 try{
  if(!['/api/run','/api/allocation'].includes(job.scope)||job.id!==config.jobId||!Number.isSafeInteger(job.reviewStartedAt)||!Number.isSafeInteger(job.reviewDeadline)||job.reviewStartedAt>Date.now()||job.reviewDeadline<=Date.now()||job.reviewDeadline>job.reviewStartedAt+EXECUTION_REVIEW_TTL||job.round<1||job.round>5)throw Error('Invalid cloud job');
  const live=await call('/api/context');
  if(live.revision!==job.revision||job.candidate.expectedRevision!==job.revision||live.logicReview?.codeDigest!==job.codeDigest||job.context.logicReview?.codeDigest!==job.codeDigest||await digest()!==job.codeDigest||await requestDigest(job.candidate)!==job.digest)throw Error('Cloud source or account changed');
  const input=await runtimeReviewInput(job.scope,job.candidate,job.context);
  const verdict=await review(input);
  if(Date.now()>=job.reviewDeadline||!validVerdict(verdict))throw Error('Review unavailable');
  await assertRuntimeReviewInput(job.scope,job.candidate,job.context,input);
  if(await digest()!==job.codeDigest)throw Error('Source changed during review');
  const reviewProof=verdict.approved?await signApproval(job.scope,job.candidate,job.codeDigest,verdict,config.privateKey,Date.now(),{cloudJobId:job.id}):undefined;
  const result=await call(route+'/result',{claimId,verdict,...(reviewProof?{reviewProof}:{})});
  return {id:config.jobId,status:result.status};
 }catch(error){
  const reason=['claudeUsageLimit','claudeAuthenticationUnavailable'].includes(error.reason)?error.reason:'reviewUnavailable';
  try{await call(route+'/result',{claimId,reason})}catch{}
  return {id:config.jobId,status:'held',reason};
 }
}
export async function cloudSelfCheck(config,{request=siteRequest,digest=sourceDigest,review=async(candidate,deadline)=>claudeReviewer({role:'Check this diagnostic only. The candidate explicitly limits itself to read-only authentication and signing verification.'},true)(candidate,deadline)}={}){
 const deadline=Date.now()+EXECUTION_REVIEW_TTL;
 let stage='cloudTransportUnavailable';
 try{
 const current=await request(config.origin,config.token,'/api/context',undefined,deadline);
 stage='cloudSourceMismatch';
 if(await digest()!==current.logicReview?.codeDigest)throw Error('Cloud checkout differs from Site');
 const candidate={purpose:'Read-only cloud authentication diagnostic; this check cannot authorize investment.',nonce:randomUUID(),expectedRevision:current.revision};
 stage='claudeDiagnosticUnavailable';
 const verdict=await review(candidate,deadline);
 stage='claudeDiagnosticRejected';
 if(!validVerdict(verdict)||!verdict.approved)throw Error('Diagnostic not approved');
 stage='cloudSigningUnavailable';
 const proof=await signApproval('/api/logic-review/check',candidate,current.logicReview.codeDigest,verdict,config.privateKey);
 stage='cloudProofUnavailable';
 const checked=await request(config.origin,config.token,'/api/logic-review/check',{...candidate,reviewProof:proof},deadline);
 if(checked.approved!==true)throw Error('Cloud proof not verified');
 return {status:'verified',subscription:true,siteAuthentication:true,cloudSignature:true,accountWrite:false,codeDigest:current.logicReview.codeDigest};
 }catch(error){throw Object.assign(Error('Cloud diagnostic failed; details withheld'),{reason:['claudeUsageLimit','claudeAuthenticationUnavailable'].includes(error.reason)?error.reason:stage,...(error.diagnostic?{diagnostic:error.diagnostic}:{})});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const config={origin:process.env.COMMITTEE_SITE_ORIGIN,token:process.env.COMMITTEE_ACCESS_CLIENT_ID?{clientId:process.env.COMMITTEE_ACCESS_CLIENT_ID,clientSecret:process.env.COMMITTEE_ACCESS_CLIENT_SECRET}:process.env.COMMITTEE_SITE_TOKEN,privateKey:process.env.CLOUD_REVIEW_PRIVATE_KEY,jobId:process.env.REVIEW_JOB_ID};
  if(config.jobId==='transport-check'){
   const current=await siteRequest(config.origin,config.token,'/api/context',undefined,Date.now()+35000);
   if(await sourceDigest()!==current.logicReview?.codeDigest)throw Error('Cloud checkout differs from Site');
   console.log(JSON.stringify({status:'transportVerified',siteAuthentication:true,subscription:false,accountWrite:false,codeDigest:current.logicReview.codeDigest}));
   process.exit(0);
  }
  if(!process.env.CLAUDE_CODE_OAUTH_TOKEN)throw Object.assign(Error('Subscription authentication required'),{reason:'claudeAuthenticationUnavailable'});
  const result=config.jobId==='auth-check'?await cloudSelfCheck(config):await reviewCloudJob(config);
  console.log(JSON.stringify(result));if(result.status==='held')process.exitCode=2;
 }catch(error){const allowed=['claudeUsageLimit','claudeAuthenticationUnavailable','cloudTransportUnavailable','cloudSourceMismatch','claudeDiagnosticUnavailable','claudeDiagnosticRejected','cloudSigningUnavailable','cloudProofUnavailable'];console.log(JSON.stringify({status:'held',reason:allowed.includes(error.reason)?error.reason:'cloudAuthenticationOrTransportUnavailable',...(error.diagnostic?{diagnostic:error.diagnostic}:{})}));process.exitCode=2}
}
