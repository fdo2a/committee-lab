// One-shot ledger migration into an empty Cloudflare deployment.
// Usage: COMMITTEE_SITE_ORIGIN=https://... COMMITTEE_ACCESS_CLIENT_ID=... COMMITTEE_ACCESS_CLIENT_SECRET=... \
//        node scripts/import-ledger.mjs <account.json> [runs.json ...]
// Credentials come from the environment only; nothing here prints them.
import {readFileSync} from 'node:fs';
const origin=new URL(process.env.COMMITTEE_SITE_ORIGIN||''),headers={'CF-Access-Client-Id':process.env.COMMITTEE_ACCESS_CLIENT_ID||'','CF-Access-Client-Secret':process.env.COMMITTEE_ACCESS_CLIENT_SECRET||'','Content-Type':'application/json'};
if(origin.protocol!=='https:'||!headers['CF-Access-Client-Id']||!headers['CF-Access-Client-Secret'])throw Error('https origin and Access service token required');
const [accountPath,...runPaths]=process.argv.slice(2);
if(!accountPath)throw Error('account export path required');
const call=async(path,payload)=>{
 const r=await fetch(new URL(path,origin),{method:payload?'POST':'GET',redirect:'error',headers,body:payload?JSON.stringify(payload):undefined});
 const text=await r.text();if(!r.ok)throw Error(`${path} failed: HTTP ${r.status} ${text.slice(0,200)}`);return JSON.parse(text);
};
const exported=JSON.parse(readFileSync(accountPath,'utf8'));
console.log('import account',await call('/api/import',{account:{state:exported.state,revision:exported.revision,metadata:exported.metadata,updatedAt:exported.updatedAt}}));
const runs=new Map();
for(const path of runPaths)for(const r of JSON.parse(readFileSync(path,'utf8')).runs??[])runs.set(r.id,r);
if(runs.size)console.log('import runs',await call('/api/import',{runs:[...runs.values()].sort((a,b)=>a.id-b.id)}));
const live=await call('/api/account');
const summary=a=>({revision:a.revision,cash:a.state.cash,holdings:a.state.holdings.map(h=>[h.symbol,h.qty]),trades:a.state.trades.length,plans:a.state.plans.length,history:a.state.history.length,trendUnits:(a.state.trendUnits||[]).length});
const before=summary(exported),after=summary(live),same=JSON.stringify(before)===JSON.stringify(after);
console.log(JSON.stringify({exported:before,live:after,match:same,stateBytesEqual:JSON.stringify(exported.state).length===JSON.stringify(live.state).length},null,1));
process.exitCode=same?0:1;
