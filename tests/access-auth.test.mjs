import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {authenticate} from '../worker/auth.mjs';

const keys=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...keys.publicKey.export({format:'jwk'}),kid:'k1',alg:'RS256',use:'sig'};
const other=generateKeyPairSync('rsa',{modulusLength:2048});
const team='team.cloudflareaccess.com',env={ACCESS_TEAM_DOMAIN:team,ACCESS_AUD:'aud-1',OWNER_EMAIL:'Owner@Example.com',ACCESS_SERVICE_ID:'svc.access'};
const now=Date.parse('2026-10-17T03:00:00Z'),seconds=Math.floor(now/1000);
const b64=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value)).toString('base64url');
function jwt(claims,{key=keys.privateKey,kid='k1',alg='RS256'}={}){
 const head=b64({alg,kid}),body=b64({iss:'https://'+team,aud:['aud-1'],iat:seconds-10,exp:seconds+600,...claims});
 return head+'.'+body+'.'+sign('RSA-SHA256',Buffer.from(head+'.'+body),key).toString('base64url');
}
let fetches=0;
const fetchImpl=async url=>{fetches++;assert.equal(url,'https://'+team+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]});};
const request=(token,extra={})=>new Request('https://lab.example/api/context',{headers:{...(token?{'cf-access-jwt-assertion':token}:{}),...extra}});
const auth=(token,overrides={},options={})=>authenticate(request(token),{...env,...overrides},{fetchImpl,now,...options});

test('owner email, service token and failures resolve as intended',async()=>{
 assert.deepEqual(await auth(jwt({email:'owner@example.com'})),{kind:'owner',email:'owner@example.com'});
 assert.deepEqual(await auth(jwt({common_name:'svc.access'})),{kind:'service'});
 assert.deepEqual(await authenticate(new Request('https://lab.example/',{headers:{cookie:'a=1; CF_Authorization='+jwt({email:'owner@example.com'})+'; b=2'}}),env,{fetchImpl,now}),{kind:'owner',email:'owner@example.com'});
 assert.equal(await auth(jwt({email:'intruder@example.com'})),null);
 assert.equal(await auth(jwt({common_name:'other.access'})),null);
 assert.equal(await auth(jwt({email:'owner@example.com',aud:['aud-2']})),null);
 assert.equal(await auth(jwt({email:'owner@example.com',iss:'https://evil.cloudflareaccess.com'})),null);
 assert.equal(await auth(jwt({email:'owner@example.com',exp:seconds-1})),null);
 assert.equal(await auth(jwt({email:'owner@example.com'},{key:other.privateKey})),null);
 assert.equal(await auth(jwt({email:'owner@example.com'},{alg:'none'})),null);
 assert.equal(await auth(jwt({email:'owner@example.com'},{kid:'unknown'})),null);
 assert.equal(await auth(null),null);
 assert.equal(await auth('not.a.jwt'),null);
 for(const missing of Object.keys(env))assert.equal(await auth(jwt({email:'owner@example.com'}),{[missing]:undefined}),null,missing);
 assert.ok(fetches<=4,'JWKS is cached between requests');
});

test('sites mode only trusts the dispatch header; Access mode ignores it',async()=>{
 assert.deepEqual(await authenticate(request(null,{'oai-authenticated-user-id':'u1'}),{AUTH_PROVIDER:'sites'}),{kind:'owner'});
 assert.deepEqual(await authenticate(request(null),{AUTH_PROVIDER:'sites'}),{kind:'service'});
 assert.equal(await authenticate(request(null,{'oai-authenticated-user-id':'u1'}),env,{fetchImpl,now}),null);
});

test('worker rejects unauthenticated requests and keeps settings routes owner-only',async()=>{
 const built=await build({entryPoints:[fileURLToPath(new URL('../worker/index.mjs',import.meta.url))],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'test-static-assets',setup(b){b.onResolve({filter:/assets\.generated\.mjs$/},()=>({path:'assets',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export default {"/index.html":"<html></html>"}'}));}}]});
 const worker=(await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'))).default;
 // The worker uses the real clock, so these tokens are minted against it rather than the fixed test time.
 const live=Math.floor(Date.now()/1000),liveJwt=(claims,options)=>jwt({iat:live-10,exp:live+600,...claims},options);
 const originalFetch=globalThis.fetch;globalThis.fetch=fetchImpl;
 try{
  const call=(path,token,init={})=>worker.fetch(new Request('https://lab.example'+path,{...init,headers:{...(token?{'cf-access-jwt-assertion':token}:{}),'content-type':'application/json',...(init.headers||{})}}),{...env,DB:null});
  assert.equal((await call('/',null)).status,401);
  assert.equal((await call('/api/context',null)).status,401);
  assert.equal((await call('/api/context',liveJwt({email:'owner@example.com'},{key:other.privateKey}))).status,401);
  assert.equal((await call('/',liveJwt({common_name:'svc.access'}))).status,200);
  for(const path of ['/api/action','/api/pause','/api/schedule','/api/watchlist','/api/providers'])assert.equal((await call(path,liveJwt({common_name:'svc.access'}),{method:'POST',body:'{}'})).status,403,path);
  for(const path of ['/api/session?market=asia','/api/run','/api/allocation','/api/research-check','/api/logic-review/check','/api/weekly-report-context','/api/import','/api/jev-evaluate','/api/jev-evaluations'])assert.equal((await call(path,liveJwt({common_name:'svc.access'}),{method:'POST',body:'{}'})).status,503,path);
  // The pre-market host reaches the JEV candidate comparison (scripts/research-agent.mjs jevCycle); the researcher may
  // list SEC filings, but never trigger paid JEV filing ranking or omit the flag.
  // The route never touches the database; a stub only passes the generic storage guard. Without SEC_USER_AGENT it answers an unconfigured bundle.
  const usResearch=payload=>worker.fetch(new Request('https://lab.example/api/us-research',{method:'POST',body:JSON.stringify(payload),headers:{'cf-access-jwt-assertion':liveJwt({common_name:'svc.access'}),'content-type':'application/json'}}),{...env,DB:{}});
  for(const payload of [{symbols:['MSFT']},{symbols:['MSFT'],useJev:true}])assert.equal((await usResearch(payload)).status,403);
  const listed=await usResearch({symbols:['MSFT'],useJev:false});assert.equal(listed.status,200);assert.equal((await listed.json()).sec.status,'unconfigured');
  // Owner reaches the route; with no database bound the next check answers 503 instead of 401/403.
  assert.equal((await call('/api/pause',liveJwt({email:'owner@example.com'}),{method:'POST',body:'{}'})).status,503);
  assert.equal((await call('/api/context',liveJwt({common_name:'svc.access'}))).status,503);
  assert.equal((await call('/mcp',null,{method:'POST',body:'{}'})).status,401);
 }finally{globalThis.fetch=originalFetch;}
});
