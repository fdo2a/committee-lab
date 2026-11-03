import test from 'node:test';
import assert from 'node:assert/strict';
import proxy from '../proxy/index.mjs';

test('proxy forwards method, headers, body, host, path and query to the Mac over http',async()=>{
  let seen;
  const env={MAC:{fetch:async r=>{seen={url:r.url,method:r.method,jwt:r.headers.get('cf-access-jwt-assertion'),body:await r.text()};return new Response('ok',{status:201});}}};
  const request=new Request('https://portfolio.example.workers.dev/api/action?x=1',{method:'POST',headers:{'cf-access-jwt-assertion':'jwt','content-type':'application/json'},body:'{"a":1}'});
  const response=await proxy.fetch(request,env);
  assert.equal(response.status,201);
  assert.deepEqual(seen,{url:'http://portfolio.example.workers.dev/api/action?x=1',method:'POST',jwt:'jwt',body:'{"a":1}'});
});

test('proxy answers JSON 503 when the Mac is unreachable, so the app shows a readable error',async()=>{
  const response=await proxy.fetch(new Request('https://portfolio.example.workers.dev/api/account'),{MAC:{fetch:async()=>{throw Error('tunnel down');}}});
  assert.equal(response.status,503);
  assert.match((await response.json()).error,/Mac 서버/);
});
