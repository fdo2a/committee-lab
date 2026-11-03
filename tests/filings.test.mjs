import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {unzip,excerpt,plainText,decodeText,filingsCollector,COLLECTION_CAP,JSON_TIMEOUT,DOWNLOAD_TIMEOUT} from '../scripts/filings.mjs';
import shipped from '../scripts/dart-corp-codes.json' with {type:'json'};
import {corpCodeTable} from '../scripts/dart-corp-codes.mjs';
import {eligibleCatalog} from '../web/universe.mjs';
import {siteCall} from '../scripts/research-agent.mjs';

// Builds a real deflate/store zip so the reader is tested against the on-disk format, not a mock.
function zip(entries){
 const locals=[],centrals=[];let offset=0;
 for(const [name,text,store] of entries){
  const raw=Buffer.from(text),data=store?raw:deflateRawSync(raw),n=Buffer.from(name),method=store?0:8;
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(method,8);local.writeUInt32LE(data.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(n.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(method,10);central.writeUInt32LE(data.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(n.length,28);central.writeUInt32LE(offset,42);
  locals.push(local,n,data);centrals.push(central,n);offset+=30+n.length+data.length;
 }
 const dir=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,dir,end]);
}

test('zip reader handles deflate and stored entries and rejects non-zip bodies',()=>{
 const files=unzip(zip([['a.xml','<a>삼성</a>'],['b.txt','plain',true]]));
 assert.equal(files.get('a.xml').toString(),'<a>삼성</a>');assert.equal(files.get('b.txt').toString(),'plain');
 assert.throws(()=>unzip(Buffer.from('{"status":"010"}')),e=>e.code==='NOT_ZIP');
});

test('text helpers decode declared encodings, strip markup and skip a table-of-contents hit',()=>{
 const euc=Buffer.concat([Buffer.from('<?xml version="1.0" encoding="EUC-KR"?><p>'),Buffer.from([0xbb,0xe7,0xbe,0xf7]),Buffer.from('</p>')]);
 assert.match(decodeText(euc),/사업/);
 assert.equal(plainText('<p>A&amp;B&#44;<script>x()</script>  C&nbsp;D</p>'),'A&B, C D');
 const text='목차 II. 사업의 내용 III. 재무에 관한 사항 '+'x'.repeat(2000)+' II. 사업의 내용 메모리 반도체를 만든다. III. 재무에 관한 사항 숫자';
 assert.equal(excerpt(text,/II\.\s*사업의\s*내용/,/III\.\s*재무에\s*관한\s*사항/).trim(),'II. 사업의 내용 메모리 반도체를 만든다.');
 assert.equal(excerpt('XbodyYtail',/X/,/Y/,4),'Xbod');
});

test('excerpt omits text when either section boundary is missing or out of order',()=>{
 for(const text of ['none here','cover Y tail','cover X body','Y cover X body'])assert.equal(excerpt(text,/X/,/Y/,4),null,text);
 assert.equal(excerpt('Xvalid bodyY tail X unbounded body',/X/,/Y/),'Xvalid body');
});

const catalog=[{symbol:'005930',country:'한국'},{symbol:'285A',country:'일본'},{symbol:'MSFT',country:'미국'},{symbol:'NVDA',country:'미국'}];
const now=Date.parse('2026-10-23T00:00:00Z');

test('collector writes DART, EDINET and SEC filings with public URLs and never writes or logs API keys',async()=>{
 const urls=[],calls=[],logs=[];
 const dartBody='<document><p>I. 회사의 개요</p><p>II. 사업의 내용</p><p>메모리와 파운드리 사업을 영위한다.</p><p>III. 재무에 관한 사항</p></document>';
 const send=async(url,options)=>{
  assert.equal(options.redirect,'manual');const u=new URL(url);urls.push(u);
  if(u.pathname==='/api/corpCode.xml')return new Response(zip([['CORPCODE.xml','<result><list><corp_code>00000001</corp_code><stock_code> </stock_code></list><list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code></list></result>']]));
  if(u.pathname==='/api/list.json'){assert.equal(u.searchParams.get('corp_code'),'00126380');return Response.json(u.searchParams.get('pblntf_ty')==='A'?{status:'000',list:[{corp_name:'삼성전자',report_nm:'반기보고서 (2026.06)',rcept_dt:'20260814',rcept_no:'20260814000111'}]}:{status:'013'});}
  if(u.pathname==='/api/document.xml')return new Response(zip([['20260814000111.xml',dartBody]]));
  if(u.pathname==='/api/v2/documents.json')return Response.json({metadata:{status:'200'},results:u.searchParams.get('date')==='2026-08-14'?[{secCode:'285A0',docID:'S100AAAA',filerName:'KIOXIA',docTypeCode:'160',docDescription:'半期報告書',submitDateTime:'2026-08-14 15:00',withdrawalStatus:'0'}]:[]});
  if(u.pathname==='/api/v2/documents/S100AAAA')return new Response(zip([['XBRL/PublicDoc/0101010_honbun.htm','<html><body>3 【事業の内容】 フラッシュメモリを製造する。 4 【関係会社の状況】</body></html>']]));
  throw Error('unexpected '+u);
 };
 const call=async(route,payload)=>{calls.push([route,payload]);return {status:200,body:{documents:[{symbol:'MSFT',company:'Microsoft',form:'8-K',date:'2026-10-01',title:'Current report',url:'https://www.sec.gov/Archives/edgar/data/789019/1/a.htm',required:true},{symbol:'MSFT',company:'Microsoft',form:'10-K',date:'2026-07-30',title:'Annual report',url:'https://www.sec.gov/Archives/edgar/data/789019/2/b.htm',required:true}],sec:{failures:[{symbol:'NVDA',code:'HTTP_403'}]}}};};
 const dir=await mkdtemp(path.join(tmpdir(),'filings-'));
 const collect=filingsCollector({dartKey:'DART-SECRET',edinetKey:'EDINET-SECRET',call,send,now,log:l=>logs.push(l),catalog});
 const first=await collect(['005930','285A','MSFT','NVDA','UNKNOWN'],dir);
 assert.deepEqual(first,{added:3,total:4,errors:1});
 assert.deepEqual(calls,[['/api/us-research',{symbols:['MSFT','NVDA'],useJev:false}]]);
 const index=JSON.parse(await readFile(path.join(dir,'filings','index.json'),'utf8')).companies;
 const by=Object.fromEntries(index.map(e=>[e.symbol,e]));
 assert.equal(by['005930'].excerptUrl,'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814000111');
 assert.equal(by['285A'].excerptUrl,'https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?S=100&ctl=0&docID=S100AAAA');
 assert.equal(by['005930'].excerptStatus,'found');assert.equal(by['285A'].excerptStatus,'found');
 assert.equal(by.MSFT.documents[0].title.startsWith('10-K'),true);assert.equal(by.MSFT.excerptFile,null);
 assert.deepEqual([by.NVDA.status,by.NVDA.code],['error','HTTP_403']);
 assert.match(await readFile(path.join(dir,'filings','005930.txt'),'utf8'),/메모리와 파운드리 사업을 영위한다/);
 assert.match(await readFile(path.join(dir,'filings','285A.txt'),'utf8'),/フラッシュメモリを製造する/);
 for(const f of await readdir(path.join(dir,'filings')))assert.doesNotMatch(await readFile(path.join(dir,'filings',f),'utf8'),/SECRET/,f);
 assert.doesNotMatch(JSON.stringify(logs),/SECRET/);
 // EDINET scans weekdays only, once per run; already collected symbols are not fetched again.
 const scans=urls.filter(u=>u.pathname==='/api/v2/documents.json');
 assert.ok(scans.length>80&&scans.length<100);assert.ok(scans.every(u=>![0,6].includes(new Date(u.searchParams.get('date')+'T00:00:00Z').getUTCDay())));
 const before=urls.length;
 assert.deepEqual(await collect(['005930','MSFT'],dir),{added:0,total:4});assert.equal(urls.length,before);
});

for(const [source,symbol,start,stop] of [['DART','005930','II. 사업의 내용','III. 재무에 관한 사항'],['EDINET','285A','事業の内容','関係会社の状況']]){
 for(const missing of ['start','stop'])test(`${source} keeps public documents but omits the excerpt when ${missing} heading is missing`,async()=>{
  const body=missing==='start'?`표지와 목차 ${stop}`:`표지 ${start} 사업 본문`;
  const send=async url=>{
   const u=new URL(url);
   if(u.pathname==='/api/corpCode.xml')return new Response(zip([['CORPCODE.xml','<result><list><corp_code>00126380</corp_code><stock_code>005930</stock_code></list></result>']]));
   if(u.pathname==='/api/list.json')return Response.json({status:'000',list:[{corp_name:'삼성전자',report_nm:'반기보고서',rcept_dt:'20260814',rcept_no:'20260814000111'}]});
   if(u.pathname==='/api/document.xml')return new Response(zip([['20260814000111.xml',body]]));
   if(u.pathname==='/api/v2/documents.json')return Response.json({metadata:{status:'200'},results:u.searchParams.get('date')==='2026-08-14'?[{secCode:'285A0',docID:'S100AAAA',filerName:'KIOXIA',docTypeCode:'160',docDescription:'半期報告書',submitDateTime:'2026-08-14 15:00',withdrawalStatus:'0'}]:[]});
   if(u.pathname==='/api/v2/documents/S100AAAA')return new Response(zip([['XBRL/PublicDoc/0101010_honbun.htm',body]]));
   throw Error('unexpected public filing request');
  };
  const dir=await mkdtemp(path.join(tmpdir(),'filings-'));
  const result=await filingsCollector({dartKey:'DART-TEST',edinetKey:'EDINET-TEST',send,now,catalog})([symbol],dir);
  assert.deepEqual(result,{added:1,total:1,errors:0});
  const {companies:[entry]}=JSON.parse(await readFile(path.join(dir,'filings','index.json'),'utf8'));
  assert.equal(entry.status,'connected');assert.equal(entry.excerptStatus,'sectionNotFound');
  assert.equal(entry.excerptFile,null);assert.equal(entry.excerptUrl,null);
  assert.ok(entry.documents.length>0);assert.match(entry.documents[0].url,/^https:\/\//);
  assert.deepEqual(await readdir(path.join(dir,'filings')),['index.json']);
 });
}

test('missing keys and provider failures are recorded per company, not thrown',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'filings-'));
 const send=async url=>{const u=new URL(url);if(u.pathname==='/api/corpCode.xml')return new Response('{"status":"010","message":"등록되지 않은 인증키입니다."}');throw Error('offline');};
 const result=await filingsCollector({dartKey:'BAD',send,now,catalog,corpCodes:{}})(['005930','285A','MSFT'],dir);
 assert.deepEqual(result,{added:0,total:3,errors:3});
 const index=JSON.parse(await readFile(path.join(dir,'filings','index.json'),'utf8')).companies;
 assert.deepEqual(index.map(e=>[e.symbol,e.status,e.code??null]).sort(),[['005930','error','DART_010'],['285A','unconfigured',null],['MSFT','unconfigured',null]]);
});

test('timeouts, socket failures and provider statuses keep their codes, and failed companies are retried next round',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'filings-'));
 let dartAttempts=0,edinetAttempts=0;
 const send=async url=>{
  const u=new URL(url);
  if(u.pathname==='/api/corpCode.xml'){
   // Attempt 1 and its inline retry both time out; the next round's attempt succeeds.
   if(++dartAttempts<=2)throw Object.assign(new DOMException('The operation was aborted due to timeout','TimeoutError'));
   return new Response(zip([['CORPCODE.xml','<result><list><corp_code>00126380</corp_code><stock_code>005930</stock_code></list></result>']]));
  }
  if(u.pathname==='/api/list.json')return Response.json({status:'013'});
  if(u.pathname==='/api/v2/documents.json'){
   edinetAttempts++;
   return Response.json({StatusCode:401,message:'Access denied due to invalid subscription key.'});
  }
  throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});
 };
 const read=async()=>Object.fromEntries(JSON.parse(await readFile(path.join(dir,'filings','index.json'),'utf8')).companies.map(e=>[e.symbol,[e.status,e.code??null]]));
 const collect=filingsCollector({dartKey:'K',edinetKey:'E',send,now,catalog,corpCodes:{}});
 await collect(['005930','285A'],dir);
 assert.deepEqual(await read(),{'005930':['error','TIMEOUT'],'285A':['error','EDINET_401']});
 // Round 2: the failed corpCode download is retried and succeeds; EDINET is retried and still rejected.
 const before=edinetAttempts;
 assert.deepEqual(await collect(['005930','285A'],dir),{added:1,total:2,errors:1});
 assert.deepEqual(await read(),{'005930':['connected',null],'285A':['error','EDINET_401']});
 assert.equal(dartAttempts,3);assert.ok(edinetAttempts>before);
 // A connected company is not fetched again; NOT_FOUND is permanent and not retried.
 const notFound=filingsCollector({dartKey:'K',send:async u=>new URL(u).pathname==='/api/corpCode.xml'?new Response(zip([['C.xml','<result></result>']])):Response.json({status:'013'}),now,catalog,corpCodes:{}});
 await notFound(['005930'],dir);
 assert.deepEqual(await notFound(['005930'],dir),{added:0,total:1});
 const offline=filingsCollector({dartKey:'K',send:async()=>{throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});},now,catalog});
 await offline(['005930'],dir);assert.deepEqual((await read())['005930'],['error','NETWORK_ECONNRESET']);
});

test('a missing company in a partial EDINET scan is retryable and connects after the failed day recovers',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'filings-'));
 let recovered=false;
 const collect=filingsCollector({edinetKey:'E',now,catalog,send:async url=>{
  const date=new URL(url).searchParams.get('date');
  if(date==='2026-08-14'&&!recovered)return new Response('',{status:503});
  return Response.json({metadata:{status:'200'},results:date==='2026-08-14'?[{secCode:'285A0',docID:'S100AAAA',filerName:'KIOXIA',docTypeCode:'180',docDescription:'臨時報告書',submitDateTime:'2026-08-14 15:00',withdrawalStatus:'0'}]:[]});
 }});
 const read=async()=>JSON.parse(await readFile(path.join(dir,'filings','index.json'),'utf8')).companies[0];
 await collect(['285A'],dir);
 assert.equal((await read()).status,'error');assert.equal((await read()).code,'HTTP_503');
 recovered=true;
 assert.deepEqual(await collect(['285A'],dir),{added:1,total:1,errors:0});
 assert.equal((await read()).status,'connected');assert.equal((await read()).documents[0].date,'2026-08-14');
});

for(const source of ['DART','EDINET','SEC'])test(`${source} collection deadline aborts in-flight work and leaves remaining companies retryable`,async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'filings-'));
 const country={DART:'한국',EDINET:'일본',SEC:'미국'}[source];
 const selected=Array.from({length:7},(_,i)=>({symbol:String(i).padStart(6,'0'),country}));
 let expired=true,aborted=false,requests=0;
 const pending=signal=>new Promise((resolve,reject)=>{
  requests++;
  if(!signal)return reject(new DOMException('per-request timeout','TimeoutError'));
  const fallback=setTimeout(()=>{signal.removeEventListener('abort',stop);reject(new DOMException('per-request timeout','TimeoutError'));},150);
  const stop=()=>{clearTimeout(fallback);aborted=true;reject(signal.reason);};
  if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});
 });
 const send=async(url,{signal})=>{
  if(expired){await pending(signal);throw Error('unreachable');}
  const u=new URL(url);
  if(u.pathname==='/api/corpCode.xml')return new Response(zip([['C.xml',`<result>${selected.map(c=>`<list><corp_code>${c.symbol}</corp_code><stock_code>${c.symbol.padStart(6,'0')}</stock_code></list>`).join('')}</result>`]]));
  return Response.json(u.pathname==='/api/list.json'?{status:'013'}:{metadata:{status:'200'},results:u.searchParams.get('date')==='2026-08-14'?selected.map(c=>({secCode:c.symbol+'0',docID:'S'+c.symbol,filerName:c.symbol,docTypeCode:'180',docDescription:'臨時報告書',submitDateTime:'2026-08-14 15:00',withdrawalStatus:'0'})):[]});
 };
 const call=async(route,payload,options)=>{
  if(expired){await pending(options?.signal);throw Error('unreachable');}
  return {status:200,body:{documents:payload.symbols.map(symbol=>({symbol,company:symbol,form:'8-K',date:'2026-10-01',title:'Current',url:'https://www.sec.gov/Archives/edgar/data/1/a.htm'}))}};
 };
 const collect=filingsCollector({dartKey:'D',edinetKey:'E',send,call,now,catalog:selected});
 // Keep the test runner alive while AbortSignal.timeout's unref'ed timer fires.
 const keepAlive=setTimeout(()=>{},5000);
 try{await collect(selected.map(c=>c.symbol),dir,{deadline:Date.now()+50});}finally{clearTimeout(keepAlive);}
 assert.equal(aborted,true,'the collection deadline must abort active upstream work');
 assert.ok(requests<=4,'queued companies/dates must not start requests after expiry');
 const entries=JSON.parse(await readFile(path.join(dir,'filings','index.json'),'utf8')).companies;
 assert.equal(entries.length,7);assert.ok(entries.every(e=>e.status==='error'&&e.code==='TIMEOUT'));
 expired=false;
 await collect(selected.map(c=>c.symbol),dir,{deadline:Date.now()+5000});
 const retried=JSON.parse(await readFile(path.join(dir,'filings','index.json'),'utf8')).companies;
 assert.ok(retried.every(e=>e.status==='connected'));
});

test('an expired collection deadline starts no upstream requests and records retryable errors',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'filings-'));
 const unexpected=()=>{assert.fail('expired collection must not request upstream data');};
 await filingsCollector({dartKey:'D',edinetKey:'E',send:unexpected,call:unexpected,now,catalog})(catalog.map(c=>c.symbol),dir,{deadline:Date.now()-1});
 const entries=JSON.parse(await readFile(path.join(dir,'filings','index.json'),'utf8')).companies;
 assert.equal(entries.length,4);assert.ok(entries.every(e=>e.status==='error'&&e.code==='TIMEOUT'));
});

for(const source of ['DART','SEC'])test(`${source} collection deadline also interrupts a stalled response body`,async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'filings-'));let aborted=false;
 const send=async(url,{signal})=>{
  if(new URL(url).pathname==='/api/corpCode.xml')return new Response(zip([['C.xml','<result><list><corp_code>00126380</corp_code><stock_code>005930</stock_code></list></result>']]));
  return new Response(new ReadableStream({start(controller){
   const stop=()=>{clearTimeout(fallback);aborted=true;controller.error(new DOMException('body aborted','AbortError'));};
   const fallback=setTimeout(()=>{signal.removeEventListener('abort',stop);controller.error(new DOMException('per-request timeout','TimeoutError'));},150);
   if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});
  }}));
 };
 const call=(route,payload,options)=>siteCall('https://lab.example','synthetic-token',route,payload,send,options?.signal);
 const collect=filingsCollector({dartKey:'D',call,send,now,catalog});
 await collect([source==='DART'?'005930':'MSFT'],dir,{deadline:Date.now()+50});
 assert.equal(aborted,true);
 const [entry]=JSON.parse(await readFile(path.join(dir,'filings','index.json'),'utf8')).companies;
 assert.equal(entry.status,'error');assert.equal(entry.code,'TIMEOUT');
});

test('shipped corp code table covers every Korean universe symbol and the collector skips corpCode.xml for mapped symbols',async()=>{
 const kr=eligibleCatalog.filter(c=>c.country==='한국').map(c=>c.symbol);
 assert.ok(kr.length>=100);
 for(const s of kr)assert.match(shipped[s]??'',/^\d{8}$/,`dart-corp-codes.json lacks ${s}; run scripts/dart-corp-codes.mjs on the Mac`);
 assert.deepEqual(corpCodeTable(new Map([['005930','00126380']]),[{symbol:'005930',country:'한국'},{symbol:'000660',country:'한국'},{symbol:'MSFT',country:'미국'}]),{table:{'005930':'00126380'},missing:['000660']});
 const dir=await mkdtemp(path.join(tmpdir(),'filings-'));
 const paths=[];
 const send=async url=>{const u=new URL(url);paths.push(u.pathname);
  if(u.pathname==='/api/corpCode.xml')return new Response(zip([['C.xml','<result><list><corp_code>00999999</corp_code><stock_code>999999</stock_code></list></result>']]));
  if(u.pathname==='/api/list.json')return Response.json({status:'013'});throw Error('unexpected '+u.pathname);};
 const collect=filingsCollector({dartKey:'K',send,now,catalog:[{symbol:'005930',country:'한국'},{symbol:'999999',country:'한국'}],corpCodes:{'005930':'00126380'}});
 await collect(['005930'],dir);
 assert.ok(!paths.includes('/api/corpCode.xml'),'a mapped symbol must not download corpCode.xml');
 await collect(['999999'],dir);
 assert.equal(paths.filter(p=>p==='/api/corpCode.xml').length,1,'an unmapped symbol falls back to corpCode.xml once');
 const index=Object.fromEntries(JSON.parse(await readFile(path.join(dir,'filings','index.json'),'utf8')).companies.map(e=>[e.symbol,e.status]));
 assert.deepEqual(index,{'005930':'connected','999999':'connected'});
});

test('a failed shared download fails once per collection call, is retried next call, and single requests retry once',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'filings-'));
 const timeoutError=()=>new DOMException('The operation was aborted due to timeout','TimeoutError');
 let corpCodeRequests=0,listRequests=0,edinetDays=0,failEdinet=true;
 const send=async url=>{const u=new URL(url);
  if(u.pathname==='/api/corpCode.xml'){corpCodeRequests++;if(corpCodeRequests<=3)throw timeoutError();return new Response(zip([['C.xml','<result>'+['000001','000002','000003','000004','000005','000006'].map(s=>`<list><corp_code>${s}</corp_code><stock_code>${s}</stock_code></list>`).join('')+'</result>']]));}
  if(u.pathname==='/api/list.json'){listRequests++;if(listRequests===1)throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});return Response.json({status:'013'});}
  if(u.pathname==='/api/v2/documents.json'){edinetDays++;if(failEdinet)throw timeoutError();return Response.json({metadata:{status:'200'},results:[]});}
  throw Error('unexpected '+u.pathname);};
 const kr=['000001','000002','000003','000004','000005','000006'].map(symbol=>({symbol,country:'한국'}));
 const collect=filingsCollector({dartKey:'K',edinetKey:'E',send,now,catalog:[...kr,{symbol:'7777',country:'일본'}],corpCodes:{}});
 const read=async()=>Object.fromEntries(JSON.parse(await readFile(path.join(dir,'filings','index.json'),'utf8')).companies.map(e=>[e.symbol,e.code??e.status]));
 await collect([...kr.map(c=>c.symbol),'7777'],dir);
 // One download attempt plus its single retry for all six Korean companies, not one per company.
 assert.equal(corpCodeRequests,2);assert.deepEqual(await read(),{'000001':'TIMEOUT','000002':'TIMEOUT','000003':'TIMEOUT','000004':'TIMEOUT','000005':'TIMEOUT','000006':'TIMEOUT','7777':'TIMEOUT'});
 const daysFirstCall=edinetDays;assert.ok(daysFirstCall>0);
 // Next call: the shared downloads are retried (attempt 3 fails, its retry succeeds); the ECONNRESET list call retried once inline.
 failEdinet=false;
 await collect([...kr.map(c=>c.symbol),'7777'],dir);
 assert.equal(corpCodeRequests,4);assert.ok(edinetDays>daysFirstCall);
 assert.deepEqual(await read(),{'000001':'connected','000002':'connected','000003':'connected','000004':'connected','000005':'connected','000006':'connected','7777':'NOT_FOUND'});
});

test('collection timeouts are 30s for JSON, 120s for archives, and every call carries a signal even without a caller deadline',async()=>{
 assert.equal(COLLECTION_CAP,4*60000);assert.equal(JSON_TIMEOUT,30000);assert.equal(DOWNLOAD_TIMEOUT,120000);
 const dir=await mkdtemp(path.join(tmpdir(),'filings-'));
 const signals=[];
 const send=async(url,{signal})=>{signals.push(signal);return Response.json({status:'013'});};
 // The 4-minute cap itself is a timer on the combined signal; it cannot be awaited in a unit test, so this checks the signal is present.
 await filingsCollector({dartKey:'K',send,now,catalog:[{symbol:'005930',country:'한국'}],corpCodes:{'005930':'00126380'}})(['005930'],dir,{deadline:Infinity});
 assert.ok(signals.length>=1&&signals.every(s=>s instanceof AbortSignal&&!s.aborted));
});
