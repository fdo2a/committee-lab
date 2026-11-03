"""Cloud updater: preflight research, collect prices/financials, save/readback.
Run with a JSON stdin configuration. Credentials never go to output or files.
--collect saves no account: print a sourced data bundle for research preparation.
researchIncomplete returns structured fields for the AI caller to supplement and retry.
"""
import json,os,pathlib,subprocess,sys,time,datetime,urllib.error
from zoneinfo import ZoneInfo
from collect_prices import collect,get_json,collect_bonds,service_headers
from collect_fundamentals import collect_fundamentals
from logic_review import reviewed_submit,risk_submit,submission_reason
PIPELINE_VERSION=5
REVIEW_WINDOW_MS=30*60*1000
def failure_diagnostic(stage,error):
 # Only fixed categories leave the boundary; exception messages can contain credentials.
 if isinstance(error,urllib.error.HTTPError):return {'stage':stage,'reason':'requestDeclined','httpStatus':error.code}
 reason='timeout' if isinstance(error,TimeoutError) else 'networkUnavailable' if isinstance(error,urllib.error.URLError) else 'invalidData' if isinstance(error,(ValueError,KeyError,TypeError)) else 'operationFailed'
 return {'stage':stage,'reason':reason}
def required_collection_symbols(config,current):
 symbols=list(current.get('activeSymbols') or [])+list(config.get('symbols') or [])
 symbols.extend(h['symbol'] for h in current.get('holdings',[]))
 symbols.extend(p['symbol'] for p in current.get('plans',[]) if p.get('status')=='승인')
 return list(dict.fromkeys(symbols))
def collection_symbols(config,current,research):
 symbols=required_collection_symbols(config,current)
 for saved in [current.get('lastResearch'),research]:
  for idea in (saved or {}).get('investmentIdeas',[]):symbols.extend(c['symbol'] for c in idea.get('candidates',[]))
 return list(dict.fromkeys(symbols)) or None

ROOT=pathlib.Path(__file__).resolve().parents[1]
def research_repair(payload,work_dir=ROOT/'research-work'):
 """One researcher repair round (scripts/research-agent.mjs repair). Never raises: any failure ends the repair loop."""
 try:
  if not (work_dir/'context.json').is_file():return {'error':'repairWorkDirMissing'}
  timeout=max(1,(payload['deadline']-time.time()*1000)/1000+60)
  done=subprocess.run(['node',str(ROOT/'scripts'/'research-agent.mjs'),'repair',str(work_dir)],input=json.dumps(payload,ensure_ascii=False),text=True,capture_output=True,cwd=ROOT,env=os.environ.copy(),timeout=timeout)
  # The repair transcript summary goes to the Actions log; it holds model text, never credentials.
  if done.stderr:sys.stderr.write(done.stderr[-4000:])
  return json.loads(done.stdout.strip().splitlines()[-1])
 except Exception:return {'error':'repairUnavailable'}

def start_review(config,phase_end=None):
 # Retries carry the returned window; collection never starts or renews it.
 if 'reviewWindow' not in config:
  if 'reviewStartedAt' in config or 'reviewDeadline' in config:
   config['reviewWindow']={key:config.get(key) for key in ('reviewStartedAt','reviewDeadline')}
  else:
   started=int(time.time()*1000)
   config['reviewWindow']={'reviewStartedAt':started,'reviewDeadline':started+REVIEW_WINDOW_MS}
 if phase_end is not None and isinstance(config['reviewWindow'],dict) and isinstance(config['reviewWindow'].get('reviewDeadline'),(int,float)):
  config['reviewWindow']={**config['reviewWindow'],'reviewDeadline':min(config['reviewWindow']['reviewDeadline'],phase_end)}
 window=config['reviewWindow']
 config['reviewStartedAt']=window.get('reviewStartedAt') if isinstance(window,dict) else None
 config['reviewDeadline']=window.get('reviewDeadline') if isinstance(window,dict) else None

def run_session(config,origin,headers):
 config['_stage']='sessionLookup'
 session=get_json(origin+'/api/session?market='+config['market']+'&phase='+config.get('phase','auto'),headers)
 if session.get('skipped'):
  print(json.dumps({**session,'verified':True}));return
 config['_stage']='contextRead'
 current=get_json(origin+'/api/context',headers)
 if current['metadata'].get('paused'):
  print(json.dumps({'paused':True,'verified':False}));return
 phase=session['phase'];base={'phase':phase,'market':session['market']};allocation=None;reports=None
 end_minute=(570 if session['market']=='us' else 540) if phase=='pre' else (960 if session['market']=='us' else 930) if phase=='open' else 1440
 phase_end=datetime.datetime.fromisoformat(session['date']).replace(tzinfo=ZoneInfo(session.get('zone','America/New_York' if session['market']=='us' else 'Asia/Seoul'))).timestamp()*1000+end_minute*60000
 research=config.get('research') or current.get('lastResearch');symbols=collection_symbols(config,current,research)
 config['_stage']='stockPriceCollection'
 snapshot=collect(symbols,required_symbols=required_collection_symbols(config,current) if symbols else None);financials=None
 symbols=snapshot.get('activeSymbols',symbols)
 changed=bool(symbols and set(symbols)!=set(current.get('activeSymbols') or []))
 stock_risk=None
 cloud=current.get('logicReview',{}).get('cloudConfigured') is True
 # Only pre-market reasoning (research, ETF decision) can be repaired; open/close reviews carry none.
 repair=config.get('_repair',research_repair) if cloud and phase=='pre' else None
 if current.get('holdings') or cloud:
  config['_stage']='stockRiskSubmit'
  stock_risk=risk_submit(origin,headers,'/api/run',{**base,'marketSnapshot':snapshot},current,get_json)
  config['_stage']='stockRiskReadback'
  current=get_json(origin+'/api/context',headers)
 if cloud and phase!='pre':
  phase_end=min(phase_end,int(datetime.datetime.fromisoformat(snapshot['fetchedAt']).timestamp()*1000)+REVIEW_WINDOW_MS)
 if phase=='pre':
  config['_stage']='financialCollection'
  financials=collect_fundamentals(symbols,current.get('fundamentalsAsOf'))
 try:
  if current.get('assetAllocation') is not None:
   if phase=='pre':
    config['_stage']='marketReportRefresh'
    refreshed=get_json(origin+'/api/market-reports',headers,{'expectedRevision':current['revision']});current['revision']=refreshed['revision'];reports=refreshed.get('marketReports')
   config['_stage']='allocationPriceCollection'
   bundle=collect_bonds(session.get('countries',['미국'] if session['market']=='us' else ['한국','일본']),[a['symbol'] for a in current['assetAllocation'].get('retiringAssets',[])])
   if bundle['snapshots']:
    if cloud and phase!='pre':
     phase_end=min(phase_end,*(int(datetime.datetime.fromisoformat(s['fetchedAt']).timestamp()*1000)+REVIEW_WINDOW_MS for s in bundle['snapshots']))
    start_review(config,phase_end)
    config['_stage']='allocationSubmit'
    saved=reviewed_submit(origin,headers,'/api/allocation',{**bundle,**base,**({'decision':config['allocationDecision']} if phase=='pre' and config.get('allocationDecision') else {}),'expectedRevision':current['revision']},current,config,get_json,repair=repair)
    config['_stage']='allocationReadback'
    current=get_json(origin+'/api/context',headers)
    if current['revision']!=saved['revision']:raise RuntimeError('Allocation readback failed')
    allocation={'verified':saved.get('logicReview',{}).get('approved',False),'logicReview':saved.get('logicReview'),'riskMonitoringVerified':saved.get('riskMonitoringVerified',False),'summary':saved['summary'],'failures':bundle['failures']}
   else:allocation={'verified':False,'status':'dataUnavailable','failures':bundle['failures']}
 except Exception as error:
  allocation={'verified':False,'status':'allocationFailed','diagnostic':failure_diagnostic(config['_stage'],error),'message':'ETF 처리는 실패했으며 주식 위험 점검은 계속합니다.'}
  config['_stage']='allocationRecoveryReadback'
  current=get_json(origin+'/api/context',headers)
 if current['metadata'].get('sessionRuns',{}).get(session['key'],{}).get('complete'):
  print(json.dumps({'verified':allocation is None or allocation.get('status') not in ('allocationFailed','dataUnavailable'),'reused':True,**base,'closedCountries':session.get('closedCountries',[]),'reviewWindow':config.get('reviewWindow'),'assetAllocation':allocation}));return
 payload={**base,'marketSnapshot':snapshot}
 if phase=='pre':
  if changed and not cloud:
   config['_stage']='universePrepare'
   get_json(origin+'/api/universe',headers,{'marketSnapshot':snapshot,'fundamentals':financials,'research':research,'expectedRevision':current['revision']});current=get_json(origin+'/api/context',headers)
  # The early cloud risk pass saved this universe; preflight need not resubmit old prices.
  config['_stage']='researchPreflight'
  readiness=get_json(origin+'/api/research-check',headers,{'research':research,**({} if cloud else {'marketSnapshot':snapshot})})
  if any(m.get('kind')=='validation' for m in readiness.get('missing',[])) or not readiness.get('complete') and not readiness.get('readyUnitIds') and not current.get('holdings'):
   if research and not any(m.get('kind')=='validation' for m in readiness.get('missing',[])):
    config['_stage']='researchSave'
    prepared=get_json(origin+'/api/research',headers,{'research':research,'expectedRevision':current['revision']});readiness=prepared['researchReadiness']
   get_json(origin+'/api/attempt',headers,{**base,'status':'researchIncomplete','research':research,'message':'장전 주식 조사 미완료, 독립 ETF 판단 결과는 유지합니다.'})
   print(json.dumps({'verified':False,'status':'researchIncomplete',**base,'closedCountries':session.get('closedCountries',[]),'reviewWindow':config.get('reviewWindow'),'assetAllocation':allocation,'marketReports':reports,'researchReadiness':readiness},ensure_ascii=False));return 2
  payload.update({'research':research,'fundamentals':financials})
 start_review(config,phase_end)
 config['_stage']='stockSubmit'
 payload['expectedRevision']=current['revision'];result=reviewed_submit(origin,headers,'/api/run',payload,current,config,get_json,risk_result=stock_risk if cloud else None,repair=repair)
 if result.get('skipped'):
  print(json.dumps({**result,**base,'verified':True,'reviewWindow':config.get('reviewWindow'),'assetAllocation':allocation}));return
 config['_stage']='stockReadback'
 readback=get_json(origin+'/api/context',headers)
 actual_session=result.get('summary',{}).get('session',session)
 if result.get('logicReview',{}).get('approved') is not False and readback['metadata'].get('lastSession',{}).get('key')!=actual_session['key']:raise RuntimeError('Session readback failed')
 status=result.get('summary',{}).get('status')
 if status=='complete' and allocation and allocation.get('status') in ('allocationFailed','dataUnavailable'):status='allocationFailed'
 print(json.dumps({'verified':status=='complete',**base,'status':status,'closedCountries':session.get('closedCountries',[]),'reviewWindow':config.get('reviewWindow'),'logicReview':result.get('logicReview'),'riskMonitoringVerified':result.get('riskMonitoringVerified',False),'revision':readback['revision'],'assetAllocation':allocation,'summary':result.get('summary'),'researchReadiness':readback.get('researchReadiness')},ensure_ascii=False));return 2 if status in ('logicReviewHeld','allocationFailed') else 0
def main():
 if '--collect-bonds' in sys.argv:
  print(json.dumps(collect_bonds(),ensure_ascii=False));return
 if '--collect' in sys.argv:
  symbols=sys.argv[sys.argv.index('--symbols')+1].split(',') if '--symbols' in sys.argv else None
  print(json.dumps({'marketSnapshot':collect(symbols),'fundamentals':collect_fundamentals(symbols)},ensure_ascii=False));return
 config=json.load(sys.stdin);origin=config['site_url'].rstrip('/')
 if not origin.startswith('https://'):raise ValueError('site_url must use https')
 headers=service_headers(config)
 if config.get('reviewJobId'):
  # The server retains the original collection; cloud repair changes only reasoning.
  job_id=config['reviewJobId']
  if not isinstance(job_id,str) or not all(c.isalnum() or c=='-' for c in job_id):raise ValueError('Invalid review job')
  try:job=get_json(origin+'/api/logic-review/'+job_id+'/input',headers)
  except urllib.error.HTTPError as error:
   if error.code not in (400,409):raise
   print(json.dumps({'verified':False,'status':'logicReviewHeld','reviewWindow':config.get('reviewWindow'),'logicReview':{'approved':False,'reason':submission_reason(error),'jobId':job_id},'riskMonitoringVerified':False},ensure_ascii=False));return 2
  candidate=job['candidate'];scope=job['scope']
  for field,key in [('research','research'),('decision','allocationDecision')]:
   if key in config:
    if field not in candidate:raise ValueError('Cannot add absent reasoning field')
    candidate[field]=config[key]
  config['reviewWindow']={'reviewStartedAt':job['reviewStartedAt'],'reviewDeadline':job['reviewDeadline'],'cloudWindowId':job['windowId'],'cloudPreviousJobs':{scope:job_id}}
  start_review(config)
  current=get_json(origin+'/api/context',headers)
  result=reviewed_submit(origin,headers,scope,candidate,current,config,get_json,skip_risk=True)
  readback=get_json(origin+'/api/context',headers)
  approved=result.get('logicReview',{}).get('approved') is True
  if approved and result.get('revision')!=readback['revision']:raise RuntimeError('Review retry readback failed')
  print(json.dumps({'verified':approved,'status':'reviewApproved' if approved else 'logicReviewHeld','revision':readback['revision'],'reviewWindow':config['reviewWindow'],'logicReview':result.get('logicReview'),'summary':result.get('summary'),'riskMonitoringVerified':result.get('riskMonitoringVerified',False)},ensure_ascii=False));return 0 if approved else 2
 if config.get('market'):
  if config['market'] not in ['asia','us'] or config.get('phase','auto') not in ['auto','pre','open','close']:raise ValueError('Invalid market phase')
  try:return run_session(config,origin,headers)
  except Exception as error:
   diagnostic=failure_diagnostic(config.get('_stage','sessionLookup'),error)
   try:get_json(origin+'/api/attempt',headers,{'market':config['market'],'phase':config.get('phase','auto'),'status':'failed','message':json.dumps(diagnostic,ensure_ascii=False)})
   except Exception:pass
   print(json.dumps({'error':'Autonomous paper cycle failed','diagnostic':diagnostic,'reviewWindow':config.get('reviewWindow')},ensure_ascii=False),file=sys.stderr);return 1
 if datetime.datetime.fromtimestamp(time.time(),datetime.timezone(datetime.timedelta(hours=9))).weekday()>=5:
  print(json.dumps({'skipped':True,'status':'marketClosed','reason':'weekend','verified':True}));return
 current=get_json(origin+'/api/context',headers);slot=int((time.time()*1000+9*3600000)//14400000)
 if current['metadata'].get('paused'):
  print(json.dumps({'reused':True,'paused':True,'status':'paused','verified':False}));return
 allocation=None;market_reports=None
 research=config.get('research') or current.get('lastResearch')
 symbols=collection_symbols(config,current,research)
 changed=bool(symbols and set(symbols)!=set(current.get('activeSymbols') or []))
 readiness=get_json(origin+'/api/research-check',headers,{'research':research})
 snapshot=None;fundamentals=None
 if current.get('holdings') or changed or readiness.get('complete') or readiness.get('readyUnitIds'):
  snapshot=collect(symbols,required_symbols=required_collection_symbols(config,current) if symbols else None)
  symbols=snapshot.get('activeSymbols',symbols)
  changed=bool(symbols and set(symbols)!=set(current.get('activeSymbols') or []))
 if current.get('holdings'):
  risk_submit(origin,headers,'/api/run',{'marketSnapshot':snapshot},current,get_json)
  current=get_json(origin+'/api/context',headers)
 if snapshot is not None:
  fundamentals=collect_fundamentals(symbols,current.get('fundamentalsAsOf'))
  readiness=get_json(origin+'/api/research-check',headers,{'research':research,'marketSnapshot':snapshot})
 try:
  if current.get('assetAllocation') is not None:
   # Independent bond allocation continues even when stock research or its 4h slot is incomplete.
   refreshed=get_json(origin+'/api/market-reports',headers,{'expectedRevision':current['revision']})
   current['revision']=refreshed['revision'];market_reports=refreshed.get('marketReports')
   bundle=collect_bonds(retiring_symbols=[a['symbol'] for a in current['assetAllocation'].get('retiringAssets',[])])
   if bundle['snapshots']:
    start_review(config)
    saved=reviewed_submit(origin,headers,'/api/allocation',{**bundle,**({'decision':config['allocationDecision']} if config.get('allocationDecision') else {}),'expectedRevision':current['revision']},current,config,get_json)
    current=get_json(origin+'/api/context',headers)
    if current['revision']!=saved['revision']:raise RuntimeError('Allocation readback failed')
    allocation={'verified':saved.get('logicReview',{}).get('approved',False),'logicReview':saved.get('logicReview'),'riskMonitoringVerified':saved.get('riskMonitoringVerified',False),'summary':saved['summary'],'failures':bundle['failures']}
   else:allocation={'verified':False,'status':'dataUnavailable','failures':bundle['failures']}
 except Exception:
  allocation={'verified':False,'status':'allocationFailed','message':'ETF 수집·제출·저장 확인 실패. 주식 위험 점검은 계속합니다.'}
  current=get_json(origin+'/api/context',headers)
 reused=current['metadata'].get('lastSlot') is not None and current['metadata']['lastSlot']>=slot and current.get('lastCycle',{}).get('status')!='logicReviewHeld'
 def pending(risk_monitoring=False,summary=None):
  print(json.dumps({'status':'researchIncomplete','verified':False,'reviewWindow':config.get('reviewWindow'),'assetAllocation':allocation,'marketReports':market_reports,'reused':reused,'riskMonitoringVerified':risk_monitoring,'researchReadiness':readiness,'summary':summary,'nextAction':'supplementResearchAndRetry','message':'Fill the reported source-backed fields and repeat preflight in this execution. Do not report the research complete.'},ensure_ascii=False))
  return 2
 if reused:
  if changed:
   prepared=get_json(origin+'/api/universe',headers,{'marketSnapshot':snapshot,'fundamentals':fundamentals,'research':research,'expectedRevision':current['revision']})
   readiness=prepared['researchReadiness'];current=get_json(origin+'/api/context',headers)
  if config.get('research') and research!=current.get('lastResearch') and not any(m.get('kind')=='validation' for m in readiness.get('missing',[])):
   prepared=get_json(origin+'/api/research',headers,{'research':research,'expectedRevision':current['revision']})
   readiness=prepared['researchReadiness']
  if not readiness.get('complete'):return pending()
  print(json.dumps({'reused':True,'paused':False,'status':'researchPrepared','verified':True,'reviewWindow':config.get('reviewWindow'),'assetAllocation':allocation,'marketReports':market_reports,'researchReadiness':readiness,'summary':current.get('lastCycle')},ensure_ascii=False));return
 if not readiness.get('complete'):
  get_json(origin+'/api/attempt',headers,{'status':'researchIncomplete','research':research,'message':'조사 미완료. 누락한 지역별 매크로·바스켓·참조지수 원문을 보완하고 같은 실행에서 다시 점검합니다.'})
  if not current.get('holdings') and not readiness.get('readyUnitIds'):
   if config.get('research') and not any(m.get('kind')=='validation' for m in readiness.get('missing',[])):
    prepared=get_json(origin+'/api/research',headers,{'research':research,'expectedRevision':current['revision']});readiness=prepared['researchReadiness']
   return pending()
 try:
  if snapshot is None:
   snapshot=collect(symbols,required_symbols=required_collection_symbols(config,current) if symbols else None)
   symbols=snapshot.get('activeSymbols',symbols);fundamentals=collect_fundamentals(symbols,current.get('fundamentalsAsOf'))
  readiness=get_json(origin+'/api/research-check',headers,{'research':research,'marketSnapshot':snapshot})
  if readiness.get('marketSessionAvailable') is False:
   print(json.dumps({'skipped':True,'status':'marketClosed','reason':'noVerifiedRegularSession','verified':True}));return
  if not readiness.get('complete') and not readiness.get('readyUnitIds') and not current.get('holdings'):return pending()
  get_json(origin+'/api/attempt',headers,{'status':'running'})
  start_review(config)
  result=reviewed_submit(origin,headers,'/api/run',{'marketSnapshot':snapshot,'fundamentals':fundamentals,'research':research},current,config,get_json)
  if result.get('skipped'):
   print(json.dumps({'skipped':True,'status':'marketClosed','reason':result.get('reason'),'verified':True}));return
  readback=get_json(origin+'/api/context',headers)
  if readback['metadata'].get('lastSlot')!=slot or readback['metadata'].get('pipelineVersion')!=PIPELINE_VERSION:raise RuntimeError('Readback failed')
  summary=result.get('summary') or result.get('state',{}).get('lastCycle')
  if summary and summary.get('status')=='logicReviewHeld':
   print(json.dumps({'verified':False,'status':'logicReviewHeld','reviewWindow':config.get('reviewWindow'),'logicReview':result.get('logicReview'),'riskMonitoringVerified':result.get('riskMonitoringVerified',False),'assetAllocation':allocation,'summary':summary},ensure_ascii=False));return 2
  readiness=summary.get('researchReadiness',readiness) if summary else readiness
  if not readiness.get('complete'):return pending(risk_monitoring=True,summary=summary)
  print(json.dumps({'verified':True,'status':'complete','reviewWindow':config.get('reviewWindow'),'assetAllocation':allocation,'marketReports':market_reports,'researchReadiness':readiness,'revision':readback['revision'],'runCount':readback['metadata']['runCount'],'summary':summary,'departments':readback.get('departments'),'lastRun':readback['metadata']['lastRun']},ensure_ascii=False))
 except Exception:
  try:get_json(origin+'/api/attempt',headers,{'status':'failed','message':'수집·조사·운용 또는 저장 확인 실패. 기존 계좌를 보존하며 가격을 만들어 대체하지 않습니다.'})
  except Exception:pass
  print(json.dumps({'error':'Autonomous paper cycle failed','reviewWindow':config.get('reviewWindow')},ensure_ascii=False),file=sys.stderr);return 1
if __name__=='__main__':
 try:sys.exit(main() or 0)
 except Exception as e:print(json.dumps({'error':type(e).__name__,'message':'Autonomous paper cycle failed; no credential or fabricated data emitted.'}),file=sys.stderr);sys.exit(1)
