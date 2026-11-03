import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
let input='';
for await(const chunk of process.stdin){input+=chunk;if(input.includes('\n'))break;}
process.stdin.pause();
try{
 const c=JSON.parse(input.trim());
 if(new URL(c.origin).protocol!=='https:')throw Error('https origin required');
 // Cloudflare Access service token when supplied; the legacy Sites bearer otherwise.
 const auth=c.accessClientId?{'CF-Access-Client-Id':c.accessClientId,'CF-Access-Client-Secret':c.accessClientSecret}:{'OAI-Sites-Authorization':'Bearer '+c.token};
 if(c.runCollector){const r=spawnSync('python3',['web/run_autonomy.py'],{input:JSON.stringify({site_url:c.origin,token:c.token,access_client_id:c.accessClientId,access_client_secret:c.accessClientSecret,research:c.research,reviewStartedAt:c.reviewStartedAt,reviewDeadline:c.reviewDeadline}),encoding:'utf8',maxBuffer:2000000});console.log(r.stdout||r.stderr);process.exit(r.status||0);}
 const url=new URL(c.path,c.origin);
 if(url.origin!==new URL(c.origin).origin)throw Error('origin mismatch');
 const r=await fetch(url,{redirect:'error',method:c.body?'POST':'GET',headers:{...auth,...(c.body?{'Content-Type':'application/json'}:{})},body:c.body?JSON.stringify(c.body):undefined});
 if(!r.ok){console.log(JSON.stringify({status:r.status,error:'service request failed'}));process.exit(1);}
 if(c.verifyScript){const source=await r.text();const expected=readFileSync('web/'+c.verifyScript,'utf8');if(source!==expected)throw Error('script mismatch');console.log(JSON.stringify({verifiedScript:true,bytes:source.length}));}
 else{const v=await r.json();if(c.fullOutput)console.log(JSON.stringify(v));else if(v.providers)console.log(JSON.stringify({fetchedAt:v.fetchedAt,providers:Object.fromEntries(Object.entries(v.providers).map(([k,p])=>[k,{status:p.status,code:p.code,date:p.date,records:p.reports?.length,total:p.total,truncated:p.truncated,series:p.series?.map(s=>({id:s.id,latest:s.observations?.find(x=>x.value!=='.'),source:s.source})),message:p.message}]))}));else console.log(JSON.stringify({revision:v.revision,metadata:v.metadata,mode:v.state?.mode,equity:v.summary?.equity,summary:v.summary??v.state?.lastCycle,holdings:v.state?.holdings?.length,trades:v.state?.trades?.length,plans:v.state?.plans?.length,reused:v.reused,paused:v.paused}));}
}catch{console.log(JSON.stringify({error:'Request failed; credentials withheld'}));process.exitCode=1;}
