import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {RESEARCH_MINUTES,EVENING_MINUTES,researchMinutes} from '../scripts/research-agent.mjs';

const workflow=readFileSync(new URL('../.github/workflows/scheduled-operation.yml',import.meta.url),'utf8');
const gate=workflow.match(/id: gate\n([\s\S]*?)      - uses:/)[1].split('        run: |\n')[1].replace(/^          /gm,'').replaceAll('${{ github.event_name }}','$EVENT_NAME');
function runGate(schedule,hour,minute,offset,market='us',event='schedule',{scheduled='',dispatched='0'}={}){
 const output=path.join(mkdtempSync(path.join(tmpdir(),'schedule-gate-')),'output');
 const clock='date() { case "$1" in +%H) echo "$HOUR";; +%M) echo "$MINUTE";; +%z) echo "$OFFSET";; *) return 1;; esac; }\n';
 // gh prints how many dispatch runs the jq filter kept; an empty DISPATCHED simulates an API failure.
 const gh='gh() { [ -n "$DISPATCHED" ] && echo "$DISPATCHED"; }\n';
 execFileSync('bash',['-e','-c',clock+gh+gate],{env:{PATH:process.env.PATH,MARKET:market,EVENT_NAME:event,EVENT_SCHEDULE:schedule,SCHEDULED:scheduled,DISPATCHED:dispatched,GITHUB_REPOSITORY:'o/r',HOUR:hour,MINUTE:minute,OFFSET:offset,GITHUB_OUTPUT:output}});
 return Object.fromEntries(readFileSync(output,'utf8').trim().split('\n').map(line=>line.split('=')));
}

test('US crons admit exactly one pre, open and close in EDT and EST, including the opposite open cron inside pre',()=>{
 const crons=[['40 11 * * 1-5',11,40],['40 12 * * 1-5',12,40],['50 13 * * 1-5',13,50],['50 14 * * 1-5',14,50],['30 20 * * 1-5',20,30],['30 21 * * 1-5',21,30]];
 for(const [offset,hours] of [['-0400',4],['-0500',5]]){
  const accepted=[];
  for(const [cron,h,m] of crons){
   const result=runGate(cron,String(h-hours),String(m),offset);
   if(result.run==='true')accepted.push([cron,result.phase]);
  }
  assert.deepEqual(accepted,offset==='-0400'?
   [['40 11 * * 1-5','pre'],['50 13 * * 1-5','open'],['30 20 * * 1-5','close']]:
   [['40 12 * * 1-5','pre'],['50 14 * * 1-5','open'],['30 21 * * 1-5','close']]);
  // A delayed opposite-offset pre cron can land inside pre too.
  assert.equal(runGate(offset==='-0400'?'40 12 * * 1-5':'40 11 * * 1-5','8','20',offset).run,'false');
  assert.equal(runGate(offset==='-0400'?'40 11 * * 1-5':'40 12 * * 1-5','9','50',offset).run,'false');
 }
});

test('Asia gates and manual dispatch retain their existing clock behavior',()=>{
 assert.deepEqual(runGate('10 22 * * 0-4','7','10','+0900','asia'),{phase:'pre',run:'true'});
 assert.equal(runGate('20 0 * * 1-5','9','20','+0900','asia').phase,'open');
 assert.equal(runGate('5 7 * * 1-5','16','5','+0900','asia').phase,'close');
 assert.equal(runGate('','12','0','-0400','us','workflow_dispatch').run,'true');
 assert.equal(runGate('30 20 * * 1-5','12','0','-0400').run,'false');
});

test('Mac scheduler dispatches take the cron gate, and a delayed cron skips a phase a dispatch already ran',()=>{
 // On-time dispatches from launchd get the same phases as the crons.
 assert.deepEqual(runGate('','7','10','+0900','asia','workflow_dispatch',{scheduled:'true'}),{phase:'pre',run:'true'});
 assert.deepEqual(runGate('','9','50','-0500','us','workflow_dispatch',{scheduled:'true'}),{phase:'open',run:'true'});
 assert.deepEqual(runGate('','22','5','-0400','us','workflow_dispatch',{scheduled:'true'}),{phase:'evening',run:'true'});
 // A scheduled dispatch outside every window holds, unlike a manual one.
 assert.deepEqual(runGate('','10','20','-0400','us','workflow_dispatch',{scheduled:'true'}),{phase:'none',run:'false'});
 assert.equal(runGate('','10','20','-0400','us','workflow_dispatch',{scheduled:'false'}).run,'true');
 // A cron that GitHub delayed into the same phase skips after the dispatch, and runs when none ran or the API failed.
 assert.deepEqual(runGate('10 22 * * 0-4','8','50','+0900','asia','schedule',{dispatched:'1'}),{phase:'pre',run:'false'});
 assert.deepEqual(runGate('10 22 * * 0-4','8','50','+0900','asia','schedule',{dispatched:'0'}),{phase:'pre',run:'true'});
 assert.deepEqual(runGate('10 22 * * 0-4','8','50','+0900','asia','schedule',{dispatched:''}),{phase:'pre',run:'true'});
 assert.deepEqual(runGate('5 9 * * 0-4','19','30','+0900','asia','schedule',{dispatched:'1'}),{phase:'evening',run:'false'});
});

test('the dedup query counts only this market\'s non-failed dispatches since the phase window opened',()=>{
 const filter=gate.match(/--jq "(.*?)"\)? \|\| ran=0/)[1].replaceAll('\\"','"').replace('$MARKET','asia').replace(/\$\(\( .*? \)\)/,String((530-420+1)*60));
 const now=Date.parse('2026-10-19T23:50:00Z')/1000;
 const runs=[
  {display_title:'Operate asia (workflow_dispatch)',conclusion:'success',created_at:'2026-10-19T22:10:30Z'},
  {display_title:'Operate asia (workflow_dispatch)',conclusion:'failure',created_at:'2026-10-19T22:10:00Z'},
  {display_title:'Operate asia (workflow_dispatch)',conclusion:null,created_at:'2026-10-19T22:30:00Z'},
  {display_title:'Operate us (workflow_dispatch)',conclusion:'success',created_at:'2026-10-19T22:30:00Z'},
  {display_title:'Operate asia (workflow_dispatch)',conclusion:'success',created_at:'2026-10-19T09:10:00Z'},
 ];
 const count=execFileSync('jq',['--argjson','t',String(now),filter.replaceAll('now','$t')],{input:JSON.stringify({workflow_runs:runs}),encoding:'utf8'}).trim();
 assert.equal(count,'2');
});

test('no cron fires at minute 0, where GitHub delays and drops scheduled runs most',()=>{
 const crons=[...workflow.matchAll(/- cron: '(\d+) /g)].map(m=>m[1]);
 assert.equal(crons.length,12);
 assert.ok(crons.every(minute=>minute!=='0'));
});

test('Asia accepts delayed open and close runs while US holds runs outside its operation windows',()=>{
 assert.deepEqual(runGate('20 0 * * 1-5','10','25','+0900','asia'),{phase:'open',run:'true'});
 assert.deepEqual(runGate('5 7 * * 1-5','17','25','+0900','asia'),{phase:'close',run:'true'});
 assert.deepEqual(runGate('50 13 * * 1-5','10','40','-0400'),{phase:'none',run:'false'});
 assert.deepEqual(runGate('30 21 * * 1-5','17','40','-0500'),{phase:'none',run:'false'});
});

test('US open and close gates enforce both operation-window boundaries in EDT and EST',()=>{
 for(const [offset,openCron,closeCron] of [
  ['-0400','50 13 * * 1-5','30 20 * * 1-5'],
  ['-0500','50 14 * * 1-5','30 21 * * 1-5'],
 ]){
  for(const [cron,hour,minute,phase,run] of [
   [openCron,'9','39','none','false'],
   [openCron,'9','40','open','true'],
   [openCron,'10','14','open','true'],
   [openCron,'10','15','none','false'],
   [closeCron,'16','19','none','false'],
   [closeCron,'16','20','close','true'],
   [closeCron,'16','54','close','true'],
   [closeCron,'16','55','none','false'],
  ])assert.deepEqual(runGate(cron,hour,minute,offset),{phase,run},`${offset} ${hour}:${minute}`);
 }
});

test('evening research runs once per market night, research only, in EDT and EST',()=>{
 assert.deepEqual(runGate('5 9 * * 0-4','18','5','+0900','asia'),{phase:'evening',run:'true'});
 assert.deepEqual(runGate('5 2 * * 1-5','22','5','-0400'),{phase:'evening',run:'true'});
 assert.deepEqual(runGate('5 3 * * 1-5','22','5','-0500'),{phase:'evening',run:'true'});
 // The opposite-offset cron lands at 23:05 EDT or 21:05 EST and must not run a second evening job.
 assert.equal(runGate('5 3 * * 1-5','23','5','-0400').run,'false');
 assert.equal(runGate('5 2 * * 1-5','21','5','-0500').run,'false');
 // Evening crons are routed to their market.
 assert.match(workflow,/startsWith\(github\.event\.schedule, '5 9'\)\) && 'asia'/);
 const step=name=>workflow.split(`      - name: ${name}\n`)[1].split('      - name:')[0];
 assert.match(step('Pre-market research by Claude'),/phase == 'evening'/);
 assert.match(step('Run the market session'),/phase != 'evening'/);
 assert.match(step('Keep the evening draft for pre-market research'),/phase == 'evening'/);
 assert.match(step('Wait for the server pre-market window'),/phase == 'pre'\n/);
});

test('pre-market research takes only a fresh evening draft from this branch',()=>{
 const step=workflow.split('      - name: Fetch the evening research draft\n')[1].split('      - name:')[0];
 assert.match(step,/continue-on-error: true/);
 const script=step.split('        run: |\n')[1].replace(/^          /gm,'');
 const dir=mkdtempSync(path.join(tmpdir(),'research-draft-'));
 execFileSync('bash',['-c','mkdir -p z && echo \'{"asOf":"evening"}\' > z/research.json && cd z && zip -q ../draft.zip research.json'],{cwd:dir});
 const fake='gh() { case "$2" in */zip) cat "$ZIP";; *) jq -r "$4" <<< "$LIST";; esac; }\ndate() { if [ "$1" = -d ]; then echo "$CREATED_S"; else echo 100000; fi; }\n';
 const fetch=(artifacts,createdSeconds)=>{
  const out=mkdtempSync(path.join(tmpdir(),'research-draft-run-'));
  execFileSync('bash',['-e','-c',fake+script],{cwd:out,env:{PATH:process.env.PATH,GITHUB_REPOSITORY:'o/r',GITHUB_REF_NAME:'cloud-investment',MARKET:'asia',ZIP:path.join(dir,'draft.zip'),CREATED_S:String(createdSeconds),LIST:JSON.stringify({artifacts})}});
  try{return readFileSync(path.join(out,'research-draft','research.json'),'utf8').trim();}catch{return null;}
 };
 const artifact=(branch,expired=false)=>({id:7,created_at:'2026-10-18T09:50:00Z',expired,workflow_run:{head_branch:branch}});
 assert.equal(fetch([artifact('cloud-investment')],100000-13*3600),'{"asOf":"evening"}');
 assert.equal(fetch([artifact('cloud-investment')],100000-16*3600),null,'a draft from a skipped evening is too old');
 assert.equal(fetch([artifact('other-branch')],100000-3600),null);
 assert.equal(fetch([artifact('cloud-investment',true)],100000-3600),null);
 assert.equal(fetch([],0),null);
});

test('a delayed pre-market cron shortens research so the updater keeps its review window before the open',()=>{
 const step=workflow.split('      - name: Budget pre-market research\n')[1].split('      - name:')[0];
 const script=step.split('        run: |\n')[1].replace(/^          /gm,'');
 const clock='date() { case "$1" in "+%H %M %S") echo "$HOUR $MINUTE 0";; +%s) echo 1000000;; *) return 1;; esac; }\n';
 const deadline=(market,hour,minute)=>{
  const output=path.join(mkdtempSync(path.join(tmpdir(),'research-budget-')),'output');
  execFileSync('bash',['-e','-c',clock+script],{env:{PATH:process.env.PATH,MARKET:market,HOUR:hour,MINUTE:minute,GITHUB_OUTPUT:output}});
  return Number(readFileSync(output,'utf8').trim().split('=')[1]);
 };
 const now=1000000*1000;
 // On time: 07:13 KST / 07:43 New York after the container build keeps the full budget.
 assert.equal(researchMinutes(deadline('asia','07','13'),now),RESEARCH_MINUTES);
 assert.equal(researchMinutes(deadline('us','07','43'),now),RESEARCH_MINUTES);
 // Delayed 30 minutes: research must end at 08:15 KST / 08:45 New York.
 assert.equal(researchMinutes(deadline('asia','07','43'),now),32);
 assert.equal(researchMinutes(deadline('us','08','13'),now),32);
 // Evening research has no deadline and takes the longer cap; a deadline still wins when it is shorter.
 assert.equal(researchMinutes(undefined,now,EVENING_MINUTES),EVENING_MINUTES);assert.equal(researchMinutes(undefined,now),RESEARCH_MINUTES);assert.equal(researchMinutes(deadline('us','08','13'),now,EVENING_MINUTES),32);
 // Too late for a round: the agent skips research and the session continues risk-only.
 assert.ok(researchMinutes(deadline('asia','08','10'),now)<10);
 // Manual dry runs outside the pre phase have no deadline and keep the full budget.
 assert.equal(researchMinutes('',now),RESEARCH_MINUTES);
});

test('after research, pre-market waiting uses only the remaining local time, including seconds',()=>{
 const waitStep=workflow.split('      - name: Wait for the server pre-market window\n')[1].split('      - name:')[0];
 const script=waitStep.split('        run:')[1].replace(/^ \|\n/,'').replace(/^          /gm,'').trim().replaceAll('${{ steps.gate.outputs.wait }}','3000');
 const clock='date() { case "$1" in +%H) echo "$HOUR";; +%M) echo "$MINUTE";; "+%H %M %S") echo "$HOUR $MINUTE $SECOND";; *) return 1;; esac; }\nsleep() { echo "sleep=$1"; }\n';
 for(const [market,hour,minute,second,want] of [
  ['asia','07','40','15','sleep=1185'], // 30 minutes of research after the 07:10 gate.
  ['asia','07','50','00','sleep=600'],
  ['asia','08','00','00',''],
  ['asia','08','05','00',''],
  ['us','08','10','15','sleep=1185'], // Same remaining wait in EDT and EST local time.
  ['us','08','20','00','sleep=600'],
  ['us','08','30','00',''],
  ['us','08','35','00',''],
 ]){
  const result=execFileSync('bash',['-e','-c',clock+script],{encoding:'utf8',env:{PATH:process.env.PATH,MARKET:market,HOUR:hour,MINUTE:minute,SECOND:second}});
  assert.equal(result.trim(),want,`${market} ${hour}:${minute}:${second}`);
 }
});

test('research timeout cannot consume the updater risk-monitoring and review budget',()=>{
 const jobMinutes=Number(workflow.match(/    timeout-minutes: (\d+)/)[1]);
 const researchStep=workflow.split('      - name: Pre-market research by Claude\n')[1].split('      - name:')[0];
 // The step timeout is an expression: the evening value first, the pre-market value second.
 const [,eveningStep,researchMinutes]=(researchStep.match(/        timeout-minutes: \$\{\{ steps\.gate\.outputs\.phase == 'evening' && (\d+) \|\| (\d+) \}\}/)??[]).map(Number);
 assert.ok(researchMinutes>=RESEARCH_MINUTES,'research must have its own bounded step with room for the model budget');
 assert.ok(eveningStep>=EVENING_MINUTES&&jobMinutes>=eveningStep+30,'evening research gets its longer budget inside the job timeout');
 assert.match(researchStep,/        continue-on-error: true\n/,'a research step timeout must not hold risk monitoring');
 // Even counting research and the whole earliest gate-to-window wait separately leaves
 // 30 minutes for setup/collection and the updater's complete 30-minute review window.
 assert.ok(jobMinutes>=researchMinutes+60+30+30,'job must leave updater time after research and waiting');
});


test('service secrets are scoped to service steps, never the job environment inherited by every subprocess',()=>{
 const jobEnv=workflow.match(/    env:\n([\s\S]*?)    steps:/)[1];
 assert.ok(!jobEnv.includes('COMMITTEE_ACCESS_CLIENT_ID'));
 assert.ok(!jobEnv.includes('COMMITTEE_ACCESS_CLIENT_SECRET'));
});
