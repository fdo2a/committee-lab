import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {modelEnvironment} from '../scripts/logic-review.mjs';
import {siteRequest,reviewCloudJob,cloudSelfCheck} from '../scripts/cloud-review.mjs';
import {requestDigest,verifyApproval} from '../worker/logic-review.mjs';

test('workflow authentication logs contain only a boolean and a fixed status, never account metadata or raw errors',async()=>{
 const workflow=readFileSync(new URL('../.github/workflows/claude-review.yml',import.meta.url),'utf8');
 const script=workflow.match(/node --input-type=module - <<'JS'\n([\s\S]*?)\n\s+JS\n/)?.[1];
 assert.ok(script,'Authentication diagnostic script must be exercised');
 const body=script.replace(/^\s*import .*;\n/m,'');
 const metadata={email:'private-account@example.invalid',subscriptionType:'private-plan',authMethod:'private-method'};
 for(const {raw,error,want} of [
  {raw:JSON.stringify({...metadata,loggedIn:true}),want:{loggedIn:true,status:'authenticated'}},
  {raw:JSON.stringify({...metadata,loggedIn:false}),want:{loggedIn:false,status:'unavailable'}},
  {raw:JSON.stringify({...metadata,loggedIn:'true'}),want:{loggedIn:false,status:'unavailable'}},
  {raw:JSON.stringify(metadata),want:{loggedIn:false,status:'unavailable'}},
  {raw:'malformed private response',want:{loggedIn:false,status:'unavailable'}},
  {error:Error('private authentication error'),want:{loggedIn:false,status:'unavailable'}}
 ]){
  const logs=[];
  await runInNewContext(`(async()=>{${body}\n})()`,{
   runProcess:async()=>{if(error)throw error;return raw},
   console:{log:line=>logs.push(line)}
  },{timeout:1000});
  assert.deepEqual(logs.map(line=>JSON.parse(line)),[want]);
 }
});

test('only Claude receives subscription OAuth; no model executable receives cloud service/signing/dispatch credentials',()=>{
 const values={CLAUDE_CODE_OAUTH_TOKEN:'subscription',COMMITTEE_SITE_TOKEN:'site',CLOUD_REVIEW_PRIVATE_KEY:'private',CLOUD_REVIEW_DISPATCH_TOKEN:'dispatch',GH_TOKEN:'github',ANTHROPIC_API_KEY:'paid'};
 const previous=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
 try{
  const claude=modelEnvironment('claude'),other=modelEnvironment('codex');assert.equal(claude.CLAUDE_CODE_OAUTH_TOKEN,'subscription');assert.equal(other.CLAUDE_CODE_OAUTH_TOKEN,undefined);
  for(const key of Object.keys(values).filter(k=>k!=='CLAUDE_CODE_OAUTH_TOKEN'))assert.equal(claude[key],undefined);
 }finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value}}
});
test('authenticated Site requests reject other origins and redirects',async()=>{
 await assert.rejects(siteRequest('https://site.example','secret','https://evil.example/api/job',{},Date.now()+1000));
 const send=async(url,options)=>{assert.equal(options.redirect,'error');assert.equal(options.headers['OAI-Sites-Authorization'],'Bearer secret');throw Error('redirect')};
 await assert.rejects(siteRequest('https://site.example','secret','/api/job',{},Date.now()+1000,send));
});
test('cloud authentication diagnostic identifies the failed boundary without exposing credentials or model replies',async()=>{
 const keys=generateKeyPairSync('rsa',{modulusLength:2048});
 const config={origin:'http://fixture.invalid',token:'secret-service',privateKey:keys.privateKey.export({type:'pkcs8',format:'pem'})};
 const clean={approved:true,summary:'Fixture only',issues:[]};
 const base={request:async(_origin,_token,route)=>route==='/api/context'?{revision:1,logicReview:{codeDigest:'source'}}:{approved:true},digest:async()=> 'source',review:async()=>clean};
 for(const {reason,deps,settings} of [
  {reason:'cloudTransportUnavailable',deps:{request:async()=>{throw Error(config.token)}}},
  {reason:'cloudSourceMismatch',deps:{digest:async()=> 'other'}},
  {reason:'claudeAuthenticationUnavailable',deps:{review:async()=>{throw Object.assign(Error('private model output'),{reason:'claudeAuthenticationUnavailable'})}}},
  {reason:'claudeUsageLimit',deps:{review:async()=>{throw Object.assign(Error('private model output'),{reason:'claudeUsageLimit'})}}},
  {reason:'claudeDiagnosticRejected',deps:{review:async()=>({approved:false,summary:'private model output',issues:['private issue']})}},
  {reason:'cloudSigningUnavailable',settings:{privateKey:'invalid'}},
  {reason:'cloudProofUnavailable',deps:{request:async(_origin,_token,route)=>route==='/api/context'?{revision:1,logicReview:{codeDigest:'source'}}:{approved:false}}}
 ])await assert.rejects(cloudSelfCheck({...config,...settings},{...base,...deps}),error=>error.reason===reason&&!error.message.includes(config.token)&&!error.message.includes('private model output'));
 const result=await cloudSelfCheck(config,{...base,request:async(_origin,_token,route,payload)=>{
  if(route==='/api/context')return {revision:1,logicReview:{codeDigest:'source'}};
  assert.equal(route,'/api/logic-review/check');assert.equal(payload.expectedRevision,1);
  assert.ok(!JSON.stringify(payload).includes(config.token));
  return verifyApproval(payload,route,JSON.stringify(keys.publicKey.export({format:'jwk'})),'source');
 }});
 assert.equal(result.status,'verified');assert.equal(result.accountWrite,false);assert.equal(result.cloudSignature,true);
});
test('cloud runner signs only a real clean review of the validated source/payload and posts no credentials',async()=>{
 const keys=generateKeyPairSync('rsa',{modulusLength:2048}),candidate={market:'asia',phase:'open',expectedRevision:1};
 const config={origin:'https://site.example',token:'secret-service',privateKey:keys.privateKey.export({type:'pkcs8',format:'pem'}),jobId:'test-id'};
 const now=Date.now(),job={id:'test-id',claimed:true,scope:'/api/run',candidate,digest:await requestDigest(candidate),codeDigest:'source',revision:1,context:{revision:1,logicReview:{codeDigest:'source'}},round:1,reviewStartedAt:now,reviewDeadline:now+10000};
 let posted,models=0;
 const request=async(origin,token,route,payload)=>{if(route.endsWith('/claim'))return job;if(route==='/api/context')return {revision:1,logicReview:{codeDigest:'source'}};posted=payload;return {status:payload.verdict?.approved?'approved':'error'}};
 const deps={request,digest:async()=> 'source',review:async input=>{models++;assert.ok(!JSON.stringify(input).includes(config.token));assert.ok(!JSON.stringify(input).includes('PRIVATE KEY'));return {approved:true,summary:'Fixture clean review',issues:[]}}};
 assert.equal((await reviewCloudJob(config,deps)).status,'approved');assert.equal(models,1);assert.equal(posted.reviewProof.cloudJobId,job.id);
 assert.equal((await verifyApproval({...candidate,reviewProof:posted.reviewProof},job.scope,JSON.stringify(keys.publicKey.export({format:'jwk'})),job.codeDigest)).approved,true);
 assert.ok(!JSON.stringify(posted).includes(config.token));
 models=0;assert.equal((await reviewCloudJob(config,{...deps,digest:async()=> 'changed'})).status,'held');assert.equal(models,0);assert.equal(posted.reason,'reviewUnavailable');
 assert.equal((await reviewCloudJob(config,{...deps,review:async()=>{throw Object.assign(Error('withheld'),{reason:'claudeUsageLimit'})}})).reason,'claudeUsageLimit');assert.equal(posted.reason,'claudeUsageLimit');
});
