import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {researchCheck} from '../worker/account.mjs';
import {createState} from '../web/engine.mjs';

// Claude's third dry-run output (run 39038910325): one unregistered referenceIndex URL per idea.
test('research-check names the unregistered source URL and accepts the file once it is registered',()=>{
 const research=JSON.parse(readFileSync(new URL('./fixtures/research-asia-dryrun-2026-10-17.json',import.meta.url),'utf8'));
 const state={...createState(),investmentProcessVersion:5},now=Date.parse('2026-10-17T15:00:00Z');
 assert.match(researchCheck(state,research,now).missing[0].reason,/sources에 없는 URL https:\/\/www\.plusetf\.co\.kr/);
 for(const idea of research.investmentIdeas)for(const url of idea.referenceIndex.sourceUrls)if(!research.sources.some(s=>s.url===url))research.sources.push({title:idea.referenceIndex.name,url});
 const ready=researchCheck(state,research,now);
 assert.equal(ready.complete,true);assert.deepEqual(ready.readyUnitIds,[]);
 // Fourth dry run (run 39039964425): marketReportReview written as an object; the reason must show the value.
 const reason=researchCheck(state,{...research,marketReportReview:{asOf:'2026-10-16',reason:'x'}},now).missing[0].reason;
 assert.match(reason,/최대 6000자/);assert.match(reason,/object \{"asOf":"2026-10-16"/);
});
