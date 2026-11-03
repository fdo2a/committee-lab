// Keys remain in Worker runtime. Returned sources never contain credential query strings.
async function fetchJSON(url) {
  for(let attempt=0;attempt<2;attempt++){
    try{
      const r = await fetch(url, {signal:AbortSignal.timeout(18000),redirect:'manual',headers:{'User-Agent':'CommitteeInvestmentLab/1.0 (paper-trading research)'}});
      if (!r.ok) throw Object.assign(Error('upstream request failed'),{code:'HTTP_'+r.status});
      try{return await r.json()}catch{throw Object.assign(Error('non JSON response'),{code:'NON_JSON_RESPONSE'})}
    }catch(e){
      // Retry only a transient upstream/network failure, never credentials, redirects or 429.
      if(attempt===1||(e.code&&!/^HTTP_(408|5\d\d)$/.test(e.code)))throw e;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
  }
}
const safeCode=e=>/^(HTTP_\d{3}|DART_\d{3}|FRED_\d{3}|NON_JSON_RESPONSE)$/.test(e.code||'')?e.code:'NETWORK_OR_TIMEOUT';
const date = n => new Date(Date.now()+9*3600000-n*86400000).toISOString().slice(0,10);
async function dart(key) {
  const u=new URL('https://opendart.fss.or.kr/api/list.json');
  u.search=new URLSearchParams({crtfc_key:key,bgn_de:date(7).replaceAll('-',''),end_de:date(0).replaceAll('-',''),page_count:'100',page_no:'1',sort:'date',sort_mth:'desc'});
  const r=await fetchJSON(u);
  if(!['000','013'].includes(r.status))throw Object.assign(Error('DART response rejected'),{code:'DART_'+r.status});
  const reports=(r.list||[]).map(x=>({company:x.corp_name,corpCode:x.corp_code,symbol:x.stock_code,title:x.report_nm,date:x.rcept_dt,url:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+encodeURIComponent(x.rcept_no)}));
  return {status:'connected',reports,total:r.total_count||0,truncated:(r.total_page||0)>1,limitations:'최근 7일 공시 첫 100건. 전체 공시와 재무제표 검토를 대체하지 않습니다.',source:'https://opendart.fss.or.kr/'};
}
async function edinet(key) {
  // Search backward across weekends/holidays without interpreting an empty day as failure.
  for(let n=0;n<7;n++){
    const u=new URL('https://api.edinet-fsa.go.jp/api/v2/documents.json');u.search=new URLSearchParams({date:date(n),type:'2','Subscription-Key':key});
    const r=await fetchJSON(u);
    if(String(r.metadata?.status)!=='200')throw Error('EDINET status '+String(r.metadata?.status));
    if(r.results?.length)return {status:'connected',date:date(n),reports:r.results.slice(0,300).map(x=>({company:x.filerName,symbol:x.secCode,docId:x.docID,title:x.docDescription,submittedAt:x.submitDateTime,url:'https://disclosure2.edinet-fsa.go.jp/WZEK0040.aspx?'+new URLSearchParams({S:'100',ctl:'0',docID:x.docID})})),total:r.results.length,truncated:r.results.length>300,source:'https://disclosure2.edinet-fsa.go.jp/',limitations:'최근 비어 있지 않은 일자의 제출 목록. 원문 확인 없이 실적 수치로 해석하지 않습니다.'};
  }
  return {status:'connected',reports:[],limitations:'최근 7일 제출 목록 없음',source:'https://disclosure2.edinet-fsa.go.jp/'};
}
async function fred(key) {
  const results=await Promise.all(['DGS10','FEDFUNDS','CPIAUCSL','UNRATE','WALCL','M2SL','ICSA','INDPRO'].map(async id=>{
   try{
    const u=new URL('https://api.stlouisfed.org/fred/series/observations');u.search=new URLSearchParams({api_key:key,series_id:id,file_type:'json',sort_order:'desc',limit:'24'});
    const r=await fetchJSON(u);if(r.error_code)throw Object.assign(Error('FRED response rejected'),{code:'FRED_'+r.error_code});
    return {id,observations:r.observations,source:'https://fred.stlouisfed.org/series/'+id};
   }catch(e){return {id,code:safeCode(e)}}
  }));
  const series=results.filter(r=>!r.code),failures=results.filter(r=>r.code);
  return {status:failures.length?(series.length?'partial':'error'):'connected',series,failures,limitations:'미국 시계열입니다. WALCL·M2SL은 직접 유동성, ICSA는 노동시장 선행, INDPRO는 생산 근거이며 해석과 다른 국가 자료는 별도 확인해야 합니다. 관측일과 공개 시점은 다르며 개정될 수 있습니다.'};
}
export async function researchData(env, providers = ['DART','EDINET','FRED']) {
  const tasks=[['DART','DART_API_KEY',dart],['EDINET','EDINET_API_KEY',edinet],['FRED','FRED_API_KEY',fred]];
  const results=await Promise.all(tasks.filter(([name])=>providers.includes(name)).map(async([name,key,fn])=>{
    if(!env[key])return [name,{status:'unconfigured'}];
    try{return [name,await fn(env[key])]}catch(e){return [name,{status:'error',code:safeCode(e),message:'API 응답 확인 실패. 인증 상태·요청 제한·제공기관 상태를 확인하세요.'}]}
  }));
  return {fetchedAt:new Date().toISOString(),providers:Object.fromEntries(results)};
}
