import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runProcess} from '../scripts/logic-review.mjs';
import {researchCycle,RESEARCH_RULES,EVENING_ROUNDS,serverTechnicalScores,repairCycle,withinSubmitted,jevPackets,jevCycle} from '../scripts/research-agent.mjs';

const token={clientId:'svc.access',clientSecret:'SECRET-VALUE'};
const context={revision:7,investmentProcess:{ideaFields:'investmentIdeas:[...]'},holdings:[]};
function site(readinessByRound){
 let checks=0;const posts=[];
 const send=async(url,options)=>{
  assert.equal(options.redirect,'error');assert.equal(options.headers['CF-Access-Client-Id'],'svc.access');
  const p=new URL(url).pathname;
  if(options.method==='GET')return new Response(JSON.stringify(p==='/api/context'?context:{route:p}),{status:200});
  assert.equal(p,'/api/research-check');posts.push(JSON.parse(options.body));
  const r=readinessByRound[Math.min(checks++,readinessByRound.length-1)];
  return new Response(JSON.stringify(r.body),{status:r.status??200});
 };
 return {send,posts,checks:()=>checks};
}
async function workDir(){return mkdtemp(path.join(tmpdir(),'research-'));}

test('research loop feeds server gaps back to the model and never exposes credentials to its files or prompt',async()=>{
 const dir=await workDir(),prompts=[];
 const run=async(command,args,input,deadline,cwd)=>{
  assert.equal(command,'claude');assert.equal(cwd,dir);assert.ok(deadline>Date.now());
  assert.ok(args.includes('--tools')&&args[args.indexOf('--tools')+1]==='Read,Write,WebFetch,WebSearch');assert.ok(args.includes('--no-session-persistence'));
  assert.equal(args[args.indexOf('--allowedTools')+1],'Read(//work/**),Edit(//work/research.json),Edit(//work/allocation-decision.json),Edit(//work/jev-packet.json),WebFetch,WebSearch');
  assert.equal(JSON.parse(args[args.indexOf('--settings')+1]).permissions.blockReadsOutsideWorkingDirectories,true);
  assert.ok(!JSON.stringify([args,input]).includes('SECRET-VALUE'));
  prompts.push(input);
  const files=await readdir(cwd);assert.ok(files.includes('context.json')&&files.includes('scheduled-research-v5.md')&&files.includes('README.md'));
  for(const f of files)assert.ok(!(await readFile(path.join(cwd,f),'utf8')).includes('SECRET-VALUE'),f);
  await writeFile(path.join(cwd,'research.json'),JSON.stringify({asOf:'2026-10-19T22:50:00Z',sources:[],investmentIdeas:prompts.length===1?[]:[{id:'kr-ai'}],trendUnits:[]}));
  return '{"type":"system"}\n{"type":"result","subtype":"success","is_error":false,"num_turns":4,"duration_ms":61000,"result":"done"}';
 };
 const {send,posts}=site([{body:{complete:false,missing:[{region:'한국',kind:'macro',field:'leading',reason:'선행지수 근거 필요'}]}},{body:{complete:true,missing:[],readyUnitIds:['u1']}}]);
 const logged=[];
 const result=await researchCycle({market:'asia',origin:'https://lab.example',token,workDir:dir,run,send,log:l=>logged.push(l)});
 assert.equal(result.rounds,2);assert.deepEqual(result.outcomes[1],{subtype:'success',isError:false,turns:4,seconds:61,text:'done'});assert.equal(logged.filter(l=>l.includes('"round"')).length,2);assert.ok(logged.some(l=>l.includes('allocation-decision.json 없음')),'a missing pre-market decision is logged, not thrown');assert.equal(result.ready,true);assert.equal(result.missing,0);assert.equal(result.research.investmentIdeas.length,1);
 assert.equal(posts.length,2);assert.match(prompts[1],/missing\.json/);assert.match(JSON.parse(await readFile(path.join(dir,'missing.json'),'utf8'))[0].field,/leading/);
 assert.ok(RESEARCH_RULES.includes('research.json'));
});

test('invalid model output and server rejection count as gaps; partial research survives the last round',async()=>{
 const dir=await workDir();let calls=0;
 const run=async(command,args,input,deadline,cwd)=>{calls++;if(calls===1)return await writeFile(path.join(cwd,'research.json'),'not json'),'{}';await writeFile(path.join(cwd,'research.json'),JSON.stringify({asOf:'x',sources:[]}));return '{}';};
 const {send}=site([{status:400,body:{error:'출처는 최대 300개입니다.'}},{body:{complete:false,missing:[{kind:'research',field:'research',reason:'부족'}]}}]);
 const result=await researchCycle({market:'us',origin:'https://lab.example',token,workDir:dir,run,send,rounds:3,log:()=>{},retryDelay:0});
 assert.equal(calls,3);assert.deepEqual(result.outcomes,[null,null,null]);assert.equal(result.ready,false);assert.deepEqual(result.research,{asOf:'x',sources:[]});assert.equal(result.missing,1);
 await assert.rejects(researchCycle({market:'kr',origin:'https://lab.example',token,workDir:dir,run,send}),/market/);
 await assert.rejects(researchCycle({market:'us',origin:'http://lab.example',token,workDir:dir,run,send}),/Invalid Site origin/);
});


test('research model runs in a container without host process visibility, host secrets or host home mounts',async()=>{
 const {runResearchModel}=await import('../scripts/research-agent.mjs');
 assert.equal(typeof runResearchModel,'function','a credential-filtered host child still exposes parent /proc');
 const calls=[];
 const execute=async(command,args,input,deadline,cwd)=>{calls.push({command,args,input,cwd});return '{}';};
 const dir=await workDir();
 await runResearchModel('claude',['-p'],'public prompt',Date.now()+5000,dir,execute,'fixture-oauth');
 const launch=calls[0];
 assert.equal(launch.command,'docker');assert.equal(launch.args[0],'run');
 assert.ok(launch.args.includes('--read-only'));assert.ok(launch.args.includes('--cap-drop=ALL'));
 assert.ok(launch.args.includes('--security-opt=no-new-privileges'));
 assert.equal(launch.args.filter(x=>x==='--mount').length,1);
 assert.equal(launch.args[launch.args.indexOf('--mount')+1],`type=bind,src=${dir},dst=/work`);
 assert.ok(!launch.args.some(x=>x.includes('--pid')||x.includes('--privileged')||x.includes('docker.sock')||x.includes('SECRET-VALUE')));
 assert.ok(!JSON.stringify(launch.args).includes('fixture-oauth'));
 assert.deepEqual(JSON.parse(launch.input),{oauth:'fixture-oauth',input:'public prompt'});
 assert.equal(calls[1].args[0],'rm');assert.ok(calls[1].args.includes('--force'));
});

test('container failure holds research and always removes the container without a host fallback',async()=>{
 const {runResearchModel}=await import('../scripts/research-agent.mjs');
 assert.equal(typeof runResearchModel,'function');
 const calls=[];
 const execute=async(command,args)=>{calls.push([command,args]);if(args[0]==='run')throw Error('container unavailable');return '';};
 await assert.rejects(runResearchModel('claude',[],'public prompt',Date.now()+5000,await workDir(),execute,'fixture-oauth'),/container unavailable/);
 assert.deepEqual(calls.map(([command,args])=>[command,args[0]]),[['docker','run'],['docker','rm']]);
});


test('container entry passes only the research prompt to Claude and keeps service secrets out of its environment',async()=>{
 const {runResearchModel}=await import('../scripts/research-agent.mjs');
 const dir=await workDir(),executable=path.join(dir,'claude');
 await writeFile(executable,`#!${process.execPath}
let input='';for await(const chunk of process.stdin)input+=chunk;
console.log(JSON.stringify({input,oauth:process.env.CLAUDE_CODE_OAUTH_TOKEN,service:process.env.COMMITTEE_ACCESS_CLIENT_SECRET??null,args:process.argv.slice(2)}));`);
 await chmod(executable,0o700);
 const savedPath=process.env.PATH,savedSecret=process.env.COMMITTEE_ACCESS_CLIENT_SECRET;
 process.env.PATH=dir+path.delimiter+savedPath;
 process.env.COMMITTEE_ACCESS_CLIENT_SECRET='SYNTHETIC-SERVICE-SECRET';
 try{
  // Exercise the real stdin bootstrap and process-environment filter without a Docker daemon or a model call.
  const execute=async(command,args,input,deadline,cwd)=>{
   if(args[0]==='rm')return '';
   const start=args.indexOf('committee-research:local')+1;
   return runProcess(process.execPath,args.slice(start+1),input,deadline,cwd);
  };
  const raw=await runResearchModel('claude',['-p'],'public research only',Date.now()+5000,dir,execute,'synthetic-oauth');
  assert.deepEqual(JSON.parse(raw),{input:'public research only',oauth:'synthetic-oauth',service:null,args:['-p']});
 }finally{
  process.env.PATH=savedPath;
  if(savedSecret===undefined)delete process.env.COMMITTEE_ACCESS_CLIENT_SECRET;else process.env.COMMITTEE_ACCESS_CLIENT_SECRET=savedSecret;
 }
});

test('a 5xx from research-check is retried once inside the same round',async()=>{
 const dir=await workDir();
 const run=async(command,args,input,deadline,cwd)=>{await writeFile(path.join(cwd,'research.json'),JSON.stringify({asOf:'x',sources:[]}));return '';};
 const {send,checks}=site([{status:503,body:null},{body:{complete:true,missing:[]}}]);
 const result=await researchCycle({market:'us',origin:'https://lab.example',token,workDir:dir,run,send,rounds:1,log:()=>{},retryDelay:0});
 assert.equal(checks(),2);assert.equal(result.ready,true);assert.equal(result.rounds,1);
});

test('an evening draft seeds the pre-market workdir and prompt; a broken draft starts fresh',async()=>{
 const dir=await workDir(),draft=path.join(await workDir(),'research.json'),prompts=[],seen=[];
 const run=async(command,args,input,deadline,cwd)=>{prompts.push(input);seen.push(await readFile(path.join(cwd,'research.json'),'utf8').catch(()=>null));await writeFile(path.join(cwd,'research.json'),JSON.stringify({asOf:'x',sources:[]}));return '';};
 await writeFile(draft,JSON.stringify({asOf:'2026-10-18T09:40:00Z',sources:[],investmentIdeas:[{id:'evening-idea'}]}));
 const seeded=await researchCycle({market:'asia',origin:'https://lab.example',token,workDir:dir,run,send:site([{body:{complete:true,missing:[]}}]).send,draft,rounds:1,log:()=>{}});
 assert.equal(seeded.seeded,true);assert.match(seen[0],/evening-idea/);assert.match(prompts[0],/전날 저녁 조사 초안/);assert.doesNotMatch(prompts[0],/저녁 조사다/);
 await writeFile(draft,'not json');
 const fresh=await researchCycle({market:'asia',origin:'https://lab.example',token,workDir:dir,run,send:site([{body:{complete:true,missing:[]}}]).send,draft,rounds:1,log:()=>{}});
 assert.equal(fresh.seeded,false);assert.equal(seen[1],null);assert.doesNotMatch(prompts[1],/전날 저녁 조사 초안/);
 const evening=await researchCycle({market:'us',origin:'https://lab.example',token,workDir:dir,run,send:site([{body:{complete:true,missing:[]}}]).send,evening:true,rounds:1,log:()=>{}});
 assert.equal(evening.seeded,false);assert.match(prompts[2],/저녁 조사다/);assert.match(prompts[2],/아이디어 5개 이상/);assert.match(prompts[2],/아이디어당 후보는 10~20개/);assert.doesNotMatch(prompts[1],/아이디어 5개 이상/);
 // Only pre-market research writes the ETF decision file.
 assert.match(prompts[0],/allocation-decision\.json/);assert.doesNotMatch(prompts[2],/allocation-decision\.json/);assert.match(RESEARCH_RULES,/allocation-decision\.json/);
});

test('complete research without a unit keeps researching while time remains and collects filings for each round\'s candidates',async()=>{
 const dir=await workDir(),prompts=[],collected=[];
 const run=async(command,args,input,deadline,cwd)=>{
  prompts.push(input);
  const units=prompts.length===2?[{id:'u1'}]:[];
  await writeFile(path.join(cwd,'research.json'),JSON.stringify({asOf:'x',sources:[],investmentIdeas:[{id:'kr',candidates:[{symbol:'005930'},{symbol:prompts.length===1?'000660':'042700'}]}],trendUnits:units}));
  return '';
 };
 const collect=async(symbols,cwd)=>{assert.equal(cwd,dir);collected.push(symbols);return {added:symbols.length};};
 const {send}=site([{body:{complete:true,missing:[]}}]);
 const result=await researchCycle({market:'asia',origin:'https://lab.example',token,workDir:dir,run,send,collect,log:()=>{}});
 assert.equal(result.rounds,2);assert.equal(result.research.trendUnits.length,1);
 assert.doesNotMatch(prompts[0],/trendUnits가 비어/);assert.match(prompts[1],/trendUnits가 비어/);assert.match(prompts[1],/다가오는 이벤트나 일부 미확인 근거만으로 관찰을 유지하지 않고/);
 // Price checks are the server's: unread price pages alone must not hold a basket, and no 'technical review passed' gate.
 assert.match(prompts[1],/가격 원문을 읽지 못했다는 이유만으로 관찰을 유지하지 않는다/);assert.doesNotMatch(prompts[1],/사업·기술 검토를 통과한/);
 assert.match(RESEARCH_RULES,/일단 편입하고 편입 뒤에 계속 판단한다/);assert.doesNotMatch(RESEARCH_RULES,/승인 기준을 완화하지 않는다/);assert.match(RESEARCH_RULES,/서버 technicalScore로 덮어쓰/);assert.match(RESEARCH_RULES,/가격·차트 원문을 읽지 못했다는 이유만으로 바스켓을 비우지 않는다/);
 assert.match(prompts[0],/filings\/index\.json/);
 assert.deepEqual(collected,[[],['005930','000660'],['005930','042700']]);
});

test('a unit-less research loop still stops at the round cap and skips filings when the budget is nearly spent',async()=>{
 const dir=await workDir();let t=0,calls=0,collects=0;
 const run=async(command,args,input,deadline,cwd)=>{calls++;t+=32*60000;await writeFile(path.join(cwd,'research.json'),JSON.stringify({asOf:'x',sources:[],trendUnits:[]}));return '';};
 const {send}=site([{body:{complete:true,missing:[]}}]);
 const result=await researchCycle({market:'us',origin:'https://lab.example',token,workDir:dir,run,send,now:()=>t,collect:async()=>{collects++;return {};},log:()=>{}});
 // 40-minute budget: filings run before round 1; round 1 ends at 32m with 8m left, so filings are skipped and round 2 runs past the deadline.
 assert.equal(calls,2);assert.equal(result.rounds,2);assert.equal(collects,1);
 const capped=await researchCycle({market:'us',origin:'https://lab.example',token,workDir:dir,run:async(c,a,i,d,cwd)=>{await writeFile(path.join(cwd,'research.json'),JSON.stringify({asOf:'x',sources:[]}));return '';},send,rounds:5,log:()=>{}});
 assert.equal(capped.rounds,5);assert.equal(capped.ready,true);
});

test('filing collection shares one absolute deadline and reserves ten minutes for research',async()=>{
 const dir=await workDir();let t=0;
 const deadlines=[];
 const collect=async(symbols,cwd,options)=>{deadlines.push(options?.deadline);};
 const run=async(command,args,input,deadline,cwd)=>{
  t+=60000;
  await writeFile(path.join(cwd,'research.json'),JSON.stringify({asOf:'x',sources:[],trendUnits:[]}));return '';
 };
 await researchCycle({market:'asia',origin:'https://lab.example',token,workDir:dir,run,send:site([{body:{complete:true,missing:[]}}]).send,now:()=>t,collect,rounds:2,log:()=>{}});
 assert.deepEqual(deadlines,[30*60000,30*60000,30*60000]);
});

test('a pre-market ETF decision is validated with the server rules and an invalid or missing one is dropped with a log',async()=>{
 const valid={asOf:new Date(Date.now()-60000).toISOString(),weights:{'153130':.5,SGOV:.25,'570A':.05,'114260':.1},reason:'단기채 중심 유지, 한국 3년 국채 10%.',risks:'금리·환율 위험.',sourceUrls:['https://www.samsungfund.com/etf/product/view.do?id=2ETF35']};
 const cases=[['valid',valid,true],['over-limit',{...valid,weights:{...valid.weights,'114260':.15}},false],['http-source',{...valid,sourceUrls:['http://example.com']},false],['missing',null,false]];
 for(const [name,file,expected] of cases){
  const dir=await workDir(),logs=[];
  const run=async(command,args,input,deadline,cwd)=>{await writeFile(path.join(cwd,'research.json'),JSON.stringify({asOf:'x',sources:[],trendUnits:[{id:'u'}]}));if(file)await writeFile(path.join(cwd,'allocation-decision.json'),JSON.stringify(file));return '';};
  const result=await researchCycle({market:'asia',origin:'https://lab.example',token,workDir:dir,run,send:site([{body:{complete:true,missing:[],readyUnitIds:['u']}}]).send,log:l=>logs.push(l)});
  assert.equal(!!result.decision,expected,name);
  if(expected){assert.equal(result.decision.weights['114260'],.1);assert.equal(result.decision.weights.TLT,0);assert.equal(result.decision.reason,valid.reason);}
  else assert.ok(logs.some(l=>l.includes('allocationDecision')),name+' must log the drop');
 }
 // Evening research never produces a decision even when the model writes the file.
 const dir=await workDir();
 const run=async(command,args,input,deadline,cwd)=>{await writeFile(path.join(cwd,'research.json'),JSON.stringify({asOf:'x',sources:[]}));await writeFile(path.join(cwd,'allocation-decision.json'),JSON.stringify(valid));return '';};
 const evening=await researchCycle({market:'asia',origin:'https://lab.example',token,workDir:dir,run,send:site([{body:{complete:true,missing:[]}}]).send,evening:true,rounds:1,log:()=>{}});
 assert.equal(evening.decision,null);
});

test('evening research keeps looping below five ideas even when the server calls the draft complete',async()=>{
 const dir=await workDir(),prompts=[];
 const ideas=n=>Array.from({length:n},(_,i)=>({id:'idea-'+i}));
 const run=async(command,args,input,deadline,cwd)=>{prompts.push(input);await writeFile(path.join(cwd,'research.json'),JSON.stringify({asOf:'x',sources:[],investmentIdeas:ideas(prompts.length+1),trendUnits:[{id:'u'}]}));return '';};
 const complete=()=>site([{body:{complete:true,missing:[]}}]).send;
 const evening=await researchCycle({market:'asia',origin:'https://lab.example',token,workDir:dir,run,send:complete(),evening:true,rounds:EVENING_ROUNDS,log:()=>{}});
 assert.equal(evening.rounds,4);assert.equal(evening.research.investmentIdeas.length,5);
 assert.match(prompts[0],/라운드 1\/8/);assert.doesNotMatch(prompts[0],/개 이상 더 발굴/);
 // Macro reads the daily market reports first and fetches official originals only for what they lack.
 assert.match(prompts[0],/market-reports\.json.*1차 근거/);assert.match(prompts[0],/일본 주간.*일간은 7일·주간은 10일 이내/);assert.match(prompts[0],/보고서 기준일\(date\) 뒤에 일어난 사건.*만 공식 원문을 직접 조회/);
 assert.match(prompts[0],/업종·테마가 겹치지 않게/);assert.match(prompts[0],/category 값\(theme\|macro\|deepValue\|momentum\)은 중복 가능/);
 assert.match(RESEARCH_RULES,/market-reports\.json에서 읽은 보고서 추출본의 url/);assert.match(RESEARCH_RULES,/추출본 기준/);
 assert.match(prompts[1],/아이디어는 2개다/);assert.match(prompts[1],/3개 이상 더 발굴/);assert.match(prompts[3],/1개 이상 더 발굴/);
 // Pre-market research stops at the first complete draft with a basket, whatever the idea count.
 prompts.length=0;
 const pre=await researchCycle({market:'asia',origin:'https://lab.example',token,workDir:dir,run,send:complete(),rounds:3,log:()=>{}});
 assert.equal(pre.rounds,1);assert.match(prompts[0],/라운드 1\/3/);
});

test('every round prompt carries the current UTC time so the model never guesses asOf',async()=>{
 const dir=await workDir(),prompts=[],clock=Date.parse('2026-10-24T00:05:00Z');
 const run=async(command,args,input,deadline,cwd)=>{prompts.push(input);await writeFile(path.join(cwd,'research.json'),JSON.stringify({asOf:'x',sources:[],trendUnits:[{id:'u'}]}));return '';};
 await researchCycle({market:'asia',origin:'https://lab.example',token,workDir:dir,run,send:site([{body:{complete:true,missing:[],readyUnitIds:['u']}}]).send,now:()=>clock,log:()=>{}});
 assert.match(prompts[0],/현재 UTC 시각: 2026-10-24T00:05:00\.000Z/);assert.match(prompts[0],/미래 시각은 서버가 버린다/);
});

test('technical scores in submitted research are the server technicalScore, or null when the server has none',()=>{
 const research={departmentResearch:{technical:[{symbol:'FANG',score:94},{symbol:'HAL',score:75},{symbol:'NEW',score:60}],fundamental:[{symbol:'FANG',score:70}]}};
 serverTechnicalScores(research,[{symbol:'FANG',technicalScore:80},{symbol:'HAL',technicalScore:40}]);
 assert.deepEqual(research.departmentResearch.technical.map(r=>r.score),[80,40,null]);
 assert.equal(research.departmentResearch.fundamental[0].score,70);
});

test('the host stamps the ETF decision asOf with the file write time, so a model-guessed future or missing asOf is not dropped',async()=>{
 const base={weights:{'153130':.6,SGOV:.25,'570A':.05},reason:'단기채 중심 유지.',risks:'금리 위험.',sourceUrls:['https://fred.stlouisfed.org/series/DGS10']};
 for(const file of [{...base,asOf:new Date(Date.now()+13*60000).toISOString()},base]){
  const dir=await workDir(),before=Date.now();
  const run=async(command,args,input,deadline,cwd)=>{await writeFile(path.join(cwd,'research.json'),JSON.stringify({asOf:'x',sources:[],trendUnits:[{id:'u'}]}));await writeFile(path.join(cwd,'allocation-decision.json'),JSON.stringify(file));return '';};
  const result=await researchCycle({market:'us',origin:'https://lab.example',token,workDir:dir,run,send:site([{body:{complete:true,missing:[],readyUnitIds:['u']}}]).send,log:()=>{}});
  assert.ok(result.decision,'decision kept');
  const stamped=Date.parse(result.decision.asOf);
  assert.ok(stamped>=before-1000&&stamped<=Date.now(),'asOf is the write time, never the future');
 }
});

const submittedResearch=()=>({asOf:'2026-10-26T11:50:00Z',decision:'AI 인프라 바스켓 편입.',sources:[],investmentIdeas:[{id:'us-ai',candidates:[{symbol:'AMZN'},{symbol:'ORCL'}]}],departmentResearch:{technical:[{symbol:'AMZN',score:33}]},trendUnits:[{id:'u',members:[{symbol:'AMZN'}]}]});
async function repairDir(){const dir=await workDir();await writeFile(path.join(dir,'context.json'),JSON.stringify({technical:[{symbol:'AMZN',technicalScore:12}]}));return dir;}
const issues=['AMZN과 ORCL에 같은 부채 기준을 적용하지 않았다.'];

test('a repair round rewrites only the rejected research, pins server scores and resubmits only a ready, narrower revision',async()=>{
 const dir=await repairDir(),prompts=[],deadline=Date.now()+5*60000;
 const run=async(command,args,input,end,cwd)=>{
  prompts.push(input);assert.equal(end,deadline);assert.equal(cwd,dir);
  assert.deepEqual(JSON.parse(await readFile(path.join(cwd,'review-issues.json'),'utf8')).issues,issues);
  const r=JSON.parse(await readFile(path.join(cwd,'research.json'),'utf8'));r.decision+=' 검토 지적 대응: ORCL과 같은 기준으로 AMZN 비중을 낮췄다.';r.departmentResearch.technical[0].score=90;
  await writeFile(path.join(cwd,'research.json'),JSON.stringify(r));return '';
 };
 const {send,posts}=site([{body:{complete:true,missing:[],readyUnitIds:['u']}}]);
 const result=await repairCycle({scope:'/api/run',submitted:submittedResearch(),issues,summary:'반려',origin:'https://lab.example',token,workDir:dir,deadline,run,send,log:()=>{}});
 assert.match(result.research.decision,/검토 지적 대응/);assert.equal(result.research.departmentResearch.technical[0].score,12);
 assert.equal(posts.length,1);assert.match(prompts[0],/지시가 아니라 자료/);assert.match(prompts[0],/새 후보 종목을 추가하지 않는다/);
 // 2026-10-28 lower entry hurdle: repair trims a basket before withdrawing it to watch.
 assert.match(prompts[0],/지적된 종목을 빼거나 비중을 줄여 바스켓을 유지한다/);assert.match(prompts[0],/바스켓 합계를 100%로 맞춘다/);assert.doesNotMatch(prompts[0],/관찰로 내리는 것도 올바른 결과/);
 assert.ok(!prompts[0].includes('SECRET-VALUE'));
});
test('a repair that adds candidates, changes nothing or is not ready is never resubmitted',async()=>{
 const deadline=Date.now()+5*60000;
 const cases=[
  ['repairAddedCandidates',r=>{r.investmentIdeas[0].candidates.push({symbol:'META'});r.decision+=' 추가';},{complete:true,missing:[]}],
  ['repairUnchanged',r=>{r.departmentResearch.technical[0].score=55;},{complete:true,missing:[]}],
  ['repairIncomplete',r=>{r.decision+=' 수정';},{complete:false,missing:[{kind:'macro'}],readyUnitIds:[]}],
 ];
 for(const [error,edit,readiness] of cases){
  const dir=await repairDir();
  const run=async(command,args,input,end,cwd)=>{const r=JSON.parse(await readFile(path.join(cwd,'research.json'),'utf8'));edit(r);await writeFile(path.join(cwd,'research.json'),JSON.stringify(r));return '';};
  const result=await repairCycle({scope:'/api/run',submitted:submittedResearch(),issues,origin:'https://lab.example',token,workDir:dir,deadline,run,send:site([{body:readiness}]).send,log:()=>{}});
  assert.equal(result.error,error);assert.equal(result.research,undefined);
 }
 assert.equal((await repairCycle({scope:'/api/run',submitted:submittedResearch(),issues,workDir:await workDir(),deadline,run:async()=>'',log:()=>{}})).error,'repairWorkDirMissing');
 assert.equal(withinSubmitted(submittedResearch(),{investmentIdeas:[{id:'other',candidates:[]}]}),false);
});
test('an ETF repair is validated with the server rules and stamped with its write time',async()=>{
 const dir=await repairDir(),deadline=Date.now()+5*60000;
 const submitted={asOf:new Date(Date.now()-3600000).toISOString(),weights:{'153130':.6,SGOV:.25,'570A':.05},reason:'단기채 유지.',risks:'금리.',sourceUrls:['https://fred.stlouisfed.org/series/DGS10']};
 const write=change=>async(command,args,input,end,cwd)=>{await writeFile(path.join(cwd,'allocation-decision.json'),JSON.stringify({...submitted,...change,asOf:'2099-01-01T00:00:00Z'}));return '';};
 const before=Date.now();
 const revised=await repairCycle({scope:'/api/allocation',submitted,issues,workDir:dir,deadline,run:write({reason:'10월 수치로 다시 확인한 단기채 유지.'}),log:()=>{}});
 assert.equal(revised.decision.reason,'10월 수치로 다시 확인한 단기채 유지.');assert.ok(Date.parse(revised.decision.asOf)>=before-1000&&Date.parse(revised.decision.asOf)<=Date.now());
 assert.equal((await repairCycle({scope:'/api/allocation',submitted,issues,workDir:dir,deadline,run:write({}),log:()=>{}})).error,'repairUnchanged');
 assert.equal((await repairCycle({scope:'/api/allocation',submitted,issues,workDir:dir,deadline,run:write({weights:{SGOV:2}}),log:()=>{}})).error,'repairDecisionInvalid');
});

const jevResearch={sources:[{url:'https://a.example/1'},{url:'https://a.example/2'}],
 investmentIdeas:[{id:'us-ai',region:'미국',asOf:'2026-10-27T11:50:00Z',candidates:[{symbol:'MSFT'},{symbol:'NVDA'}]},{id:'kr-ai',region:'한국',asOf:'2026-10-27T11:50:00Z',candidates:[{symbol:'005930'}]}]};
const jevRow=(symbol,extra={})=>({symbol,conceptEvidence:'Cloud AI revenue — “grew” 40%…',regimeEvidence:'',catalystEvidence:'Earnings on 10-29.',counterEvidence:'Capex risk.',admissionEvidence:'Server PER within limit.',sourceUrls:['https://a.example/1'],...extra});
const JEV_NOW=Date.parse('2026-10-27T12:10:00Z');
const jevIdea=(extra={})=>({ideaId:'us-ai',regime:'Late cycle',concept:'AI infrastructure',horizonMonths:2,catalyst:'Q3 earnings',invalidation:'Capex cut',sourceUrls:['https://a.example/2'],candidates:[jevRow('MSFT'),jevRow('NVDA')],...extra});

test('JEV packets use the saved idea asOf and full candidate set, map typographic punctuation and keep admission evidence out of discovery',()=>{
 const {packets,skipped}=jevPackets(jevResearch,{ideas:[jevIdea({asOf:'2030-01-01T00:00:00Z'})]},JEV_NOW);
 assert.deepEqual(skipped,[]);assert.equal(packets.length,1);
 const {discovery,admission}=packets[0];
 assert.equal(discovery.asOf,'2026-10-27T11:50:00Z');assert.deepEqual(discovery.candidates.map(c=>c.symbol),['MSFT','NVDA']);
 assert.equal(discovery.candidates[0].conceptEvidence,'Cloud AI revenue - "grew" 40%...');
 assert.ok(discovery.candidates.every(c=>!('admissionEvidence' in c)));assert.equal(admission.candidates[0].admissionEvidence,'Server PER within limit.');
 assert.deepEqual(Object.keys(discovery).sort(),['asOf','candidates','catalyst','concept','horizonMonths','invalidation','regime','sourceUrls']);
});

test('a JEV packet with a non-US idea, a partial candidate set, an unregistered source, Korean text or an empty concept is skipped with its field',()=>{
 const cases=[[{ideaId:'kr-ai'},'ideaId'],[{candidates:[jevRow('MSFT')]},'candidates'],[{sourceUrls:['https://unread.example/']},'sourceUrls'],
  [{candidates:[jevRow('MSFT',{counterEvidence:'수요 둔화'}),jevRow('NVDA')]},'MSFT.counterEvidence'],[{concept:' '},'concept'],[{horizonMonths:6},'horizonMonths']];
 for(const [extra,field] of cases){const r=jevPackets(jevResearch,{ideas:[jevIdea(extra)]},JEV_NOW);assert.equal(r.packets.length,0,field);assert.equal(r.skipped[0].field,field);}
 // A model-guessed future asOf would fail both paid stages on the server.
 assert.equal(jevPackets(jevResearch,{ideas:[jevIdea()]},Date.parse('2026-10-27T11:49:00Z')).skipped[0].field,'asOf');
});

function jevSite(responses={}){
 const calls=[];
 const send=async(url,options)=>{const p=new URL(url).pathname,body=JSON.parse(options.body);calls.push({p,body});
  const r=responses[p]?.(body)??{status:200,body:{status:'evaluated',id:'r'+calls.length,metrics:{inputTokens:900}}};
  return new Response(JSON.stringify(r.body),{status:r.status});};
 return {send,calls};
}
async function jevDir(enabled=true,packet={ideas:[jevIdea()]}){
 const dir=await workDir();
 await writeFile(path.join(dir,'context.json'),JSON.stringify({revision:7,jevWorkflow:{enabled}}));
 if(packet)await writeFile(path.join(dir,'jev-packet.json'),JSON.stringify(packet));
 return dir;
}

test('the host saves the research, then sends discovery and admission once each as paid replay calls',async()=>{
 const dir=await jevDir(),{send,calls}=jevSite(),clock=Date.parse('2026-10-27T12:10:00Z');
 const result=await jevCycle({research:jevResearch,workDir:dir,origin:'https://lab.example',token,deadline:clock+20*60000,send,now:()=>clock});
 assert.deepEqual(calls.map(c=>c.p),['/api/research','/api/jev-evaluate','/api/jev-evaluate']);
 assert.deepEqual(calls[0].body,{research:jevResearch,expectedRevision:7});
 assert.deepEqual(calls.slice(1).map(c=>[c.body.stage,c.body.ideaId,c.body.useJev,c.body.replay]),[['discovery','us-ai',true,true],['admission','us-ai',true,true]]);
 assert.equal(result.status,'submitted');assert.deepEqual(result.evaluations.map(e=>[e.stage,e.http,e.status]),[['discovery',200,'evaluated'],['admission',200,'evaluated']]);
});

test('JEV is never called when disabled, without a packet, near the deadline or after a failed research save, and a failed call is not retried',async()=>{
 const clock=Date.parse('2026-10-27T12:10:00Z'),args={research:jevResearch,origin:'https://lab.example',token,now:()=>clock,deadline:clock+20*60000};
 for(const [dir,deadline,status] of [[await jevDir(false),args.deadline,'disabled'],[await jevDir(true,null),args.deadline,'noPacket'],[await jevDir(),clock+4*60000,'skipped'],[await jevDir(),NaN,'skipped']]){
  const {send,calls}=jevSite();assert.equal((await jevCycle({...args,workDir:dir,deadline,send})).status,status);assert.equal(calls.length,0,status);
 }
 let site=jevSite({'/api/research':()=>({status:409,body:{error:'revision'}})});
 assert.equal((await jevCycle({...args,workDir:await jevDir(),send:site.send})).status,'researchSaveFailed');assert.deepEqual(site.calls.map(c=>c.p),['/api/research']);
 site=jevSite({'/api/jev-evaluate':()=>({status:500,body:{error:'provider'}})});
 const failed=await jevCycle({...args,workDir:await jevDir(),send:site.send});
 assert.equal(site.calls.filter(c=>c.p==='/api/jev-evaluate').length,2);assert.deepEqual(failed.evaluations.map(e=>e.http),[500,500]);
});

test('only an enabled US pre-market prompt asks for the JEV packet',async()=>{
 const prompts=[];
 const run=async(command,args,input,deadline,cwd)=>{prompts.push(input);await writeFile(path.join(cwd,'research.json'),JSON.stringify({asOf:'x',sources:[],trendUnits:[{id:'u'}]}));return '';};
 const send=enabled=>async(url,options)=>{const p=new URL(url).pathname;
  if(options.method==='GET')return new Response(JSON.stringify(p==='/api/context'?{...context,jevWorkflow:{enabled}}:{route:p}),{status:200});
  return new Response(JSON.stringify({complete:true,missing:[],readyUnitIds:['u']}),{status:200});};
 const asked=[];
 for(const [market,enabled,evening] of [['us',true,false],['us',true,true],['asia',true,false],['us',false,false]]){
  prompts.length=0;
  // Evening research loops for more ideas (rounds:1 keeps this to the prompt under test).
  await researchCycle({market,evening,origin:'https://lab.example',token,workDir:await workDir(),run,send:send(enabled),rounds:1,log:()=>{}});
  asked.push(prompts.some(p=>p.includes('jev-packet.json')));
 }
 assert.deepEqual(asked,[true,false,false,false]);
});
test('a ready basket does not end the loop while a must-review stock is still a gap',async()=>{
 const dir=await workDir(),prompts=[];
 const run=async(command,args,input,deadline,cwd)=>{prompts.push(input);await writeFile(path.join(cwd,'research.json'),JSON.stringify({asOf:'x',sources:[],trendUnits:[{id:'u'}]}));return '';};
 const gap={stage:'ideas',ideaId:null,region:'한국',kind:'manual',field:'manual.035420',symbol:'035420',reason:'사용자 필수 검토 종목'};
 const {send}=site([{body:{complete:false,missing:[gap],readyUnitIds:['u']}},{body:{complete:true,missing:[],readyUnitIds:['u']}}]);
 const result=await researchCycle({market:'asia',origin:'https://lab.example',token,workDir:dir,run,send,log:()=>{}});
 assert.equal(result.rounds,2);assert.match(prompts[1],/missing\.json/);
 assert.match(prompts[0],/manualCandidates는 사용자가 반드시 검토하라고 지정한 종목/);assert.match(prompts[0],/referenceIndex\.constituents에도 그 종목을 포함/);
});
