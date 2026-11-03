import test from 'node:test';
import assert from 'node:assert/strict';
import {nextRun,runScheduled} from '../worker/account.mjs';
import {hasRegularMarketSession} from '../worker/market-data.mjs';
test('Friday20 Seoul next run skips Saturday and Sunday to Monday00',()=>{
 assert.equal(nextRun(Date.parse('2026-10-09T11:00:00Z')),'2026-10-11T15:00:00.000Z');
});
test('stale sessions on a weekday cannot stand in for an open market; one current Japan session permits operation',()=>{
 const now=Date.parse('2026-10-05T03:00:00Z'),open=Date.parse('2026-10-05T00:00:00Z')/1000;
 const snapshot={quotes:{'6501':{time:open+3600,regularSessions:[{date:'2026-10-02',openTime:open-3*86400}]}}};
 assert.equal(hasRegularMarketSession(snapshot,now),false);
 snapshot.quotes['6501'].regularSessions.push({date:'2026-10-05',openTime:open});
 assert.equal(hasRegularMarketSession(snapshot,now),true);
});
test('weekend scheduled execution stops before any account read or mutation',async()=>{
 const db={prepare(){throw Error('A closed-day run must not touch the account');}};
 for(const stamp of ['2026-10-09T15:00:00Z','2026-10-10T15:00:00Z']){
  const r=await runScheduled(db,null,Date.parse(stamp),{});assert.equal(r.skipped,true);assert.equal(r.reason,'weekend');
 }
});
