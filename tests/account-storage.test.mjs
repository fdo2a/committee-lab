import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {readAccount,writeAccount,importLedger,recentRuns} from '../worker/account.mjs';
import {createState} from '../web/engine.mjs';

// Mirrors D1: any bound string above 2MB is rejected.
function database(){
 const sqlite=new DatabaseSync(':memory:');
 for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 return {sqlite,prepare(sql){const s=sqlite.prepare(sql);let a=[];return {bind(...v){assert.ok(v.every(x=>typeof x!=='string'||Buffer.byteLength(x)<2000000),'D1 value limit');a=v;return this},async first(){return s.get(...a)},async all(){return {results:s.all(...a)}},async run(){return {meta:{changes:Number(s.run(...a).changes)}}}}}};
}
const parts=db=>db.sqlite.prepare('SELECT part_set, count(*) AS n FROM paper_account_part GROUP BY part_set').all();
function largeState(){const s=createState();s.note='가'.repeat(1_500_000);return s;}

test('states above the D1 row limit round-trip through parts and keep small states inline',async()=>{
 const db=database();let a=await readAccount(db);
 assert.equal(parts(db).length,0);
 const saved=await writeAccount(db,a,largeState());
 assert.ok(saved.partSet);assert.equal(parts(db).length,1);assert.ok(parts(db)[0].n>=4);
 assert.match(db.sqlite.prepare("SELECT state FROM paper_account WHERE id='main'").get().state,/^\{"parts":\d+,"set":/);
 a=await readAccount(db);assert.equal(a.revision,2);assert.equal(a.state.note.length,1_500_000);assert.equal(a.partSet,saved.partSet);
 // Second large write keeps only the previous set for in-flight readers.
 const second=await writeAccount(db,a,{...a.state,note:'나'.repeat(1_200_000)});
 assert.deepEqual(parts(db).map(p=>p.part_set).sort(),[saved.partSet,second.partSet].sort());
 const third=await writeAccount(db,await readAccount(db),{...a.state,note:'다'.repeat(1_100_000)});
 assert.deepEqual(parts(db).map(p=>p.part_set).sort(),[second.partSet,third.partSet].sort());
 // Shrinking back below the limit stores inline again and leaves no new set.
 const small=await writeAccount(db,await readAccount(db),createState());
 assert.equal(small.partSet,undefined);assert.doesNotMatch(db.sqlite.prepare("SELECT state FROM paper_account WHERE id='main'").get().state,/^\{"parts"/);
});

test('a lost write race removes its orphan parts and metadata-only updates keep the pointer readable',async()=>{
 const db=database();const a=await readAccount(db);
 const saved=await writeAccount(db,a,largeState());
 await assert.rejects(writeAccount(db,a,largeState()),/다른 실행/);
 assert.deepEqual(parts(db).map(p=>p.part_set),[saved.partSet]);
 db.sqlite.exec("UPDATE paper_account SET metadata='{\"enabled\":false}', revision=revision+1 WHERE id='main'");
 const after=await readAccount(db);assert.equal(after.revision,3);assert.equal(after.state.note.length,1_500_000);assert.equal(after.metadata.enabled,false);
});

test('non-BMP text crossing a state part boundary round-trips without UTF-8 corruption',async()=>{
 const db=database();const current=await readAccount(db);const state={note:'',...createState()};
 const noteStart=JSON.stringify(state).indexOf('"note":"')+'"note":"'.length;
 state.note='가'.repeat(399999-noteStart)+'😀'+'나'.repeat(400000);
 const original=JSON.stringify(state);
 assert.equal(original.charCodeAt(399999),0xd83d);
 const saved=await writeAccount(db,current,state);
 assert.ok(saved.partSet);
 const stored=db.sqlite.prepare('SELECT body FROM paper_account_part WHERE id = ? AND part_set = ? ORDER BY part').all('main',saved.partSet).map(p=>p.body).join('');
 assert.ok(stored===original,'stored state must preserve the original JSON through UTF-8 binding');
 assert.ok((await readAccount(db)).state.note===state.note,'readAccount must preserve the original non-BMP text');
});

test('a pointer whose parts are missing fails closed instead of reinitializing',async()=>{
 const db=database();await writeAccount(db,await readAccount(db),largeState());
 db.sqlite.exec('DELETE FROM paper_account_part');
 await assert.rejects(readAccount(db),/계좌 조각/);
 assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM paper_account').get().n,1);
});

test('ledger import only fills an empty database and preserves revision, state and runs exactly',async()=>{
 const db=database();const state=largeState();state.cash=12345.5;
 const account={state,revision:111,metadata:{enabled:true,runCount:50,sessionMode:true},updatedAt:'2026-10-17T03:25:07.616Z'};
 const result=await importLedger(db,{account});assert.equal(result.revision,111);assert.ok(result.parts>=4);
 const a=await readAccount(db,false);assert.equal(a.revision,111);assert.equal(a.state.cash,12345.5);assert.equal(a.state.note.length,1_500_000);assert.equal(a.metadata.runCount,50);assert.equal(a.updatedAt,account.updatedAt);
 await assert.rejects(importLedger(db,{account}),e=>e.status===409);
 const runs=[{id:207421,started_at:'2026-10-16T00:24:50.702Z',status:'logicReviewHeld',report:{summary:{status:'logicReviewHeld'}}},{id:207422,started_at:'2026-10-16T07:02:09.843Z',status:'logicReviewHeld',report:{x:1}}];
 assert.deepEqual(await importLedger(db,{runs}),{imported:'runs',count:2});
 assert.deepEqual((await recentRuns(db)).map(r=>[r.id,r.status,r.report]),[[207422,'logicReviewHeld',{x:1}],[207421,'logicReviewHeld',{summary:{status:'logicReviewHeld'}}]]);
 await assert.rejects(importLedger(db,{runs}),e=>e.status===409);
 for(const bad of [{},{account:{...account,revision:0}},{account:{...account,state:{...state,version:1}}},{runs:[{id:'x'}]}])await assert.rejects(importLedger(database(),bad));
});
