"""Local/cloud review bridge. Credentials stay in authenticated transport, never model input."""
import json,os,pathlib,subprocess,time,urllib.error
from collect_prices import get_json
EXECUTION_REVIEW_MS=30*60*1000
# Repair rounds after a rejected pre-market cloud review: each round gets at most 6 minutes of model time, keeps
# 4 minutes for the following review, and none starts with under 10 minutes left in the 30-minute window.
REPAIR_ROUND_MS=6*60*1000;REPAIR_REVIEW_MS=4*60*1000;REPAIR_START_MS=10*60*1000
# Stocks carry the buys and are reviewed after ETF in the session, so the user turned ETF repairs off (2026-10-27)
# to leave the whole window to stocks; 3 stock repairs fill the server's 5 rounds after the two first verdicts.
REPAIR_LIMITS={'/api/allocation':0,'/api/run':3}

def execution_deadline(config):
 started=config.get('reviewStartedAt');deadline=config.get('reviewDeadline')
 if not all(isinstance(value,(int,float)) and not isinstance(value,bool) and value==int(value) for value in (started,deadline)):
  raise ValueError('Valid execution review deadline required')
 if not 0<started<=time.time()*1000 or not started<deadline<=started+EXECUTION_REVIEW_MS:
  raise ValueError('Invalid execution review deadline')
 return deadline

def invoke_reviewer(config):
 script=pathlib.Path(__file__).resolve().parents[1]/'scripts'/'logic-review.mjs'
 if not script.is_file():return {'approved':False,'reason':'macReviewerRequired'}
 allowed={'PATH','HOME','USER','LOGNAME','SHELL','CODEX_HOME','LANG','LC_ALL','TMPDIR','XDG_CONFIG_HOME','COMMITTEE_REVIEW_KEY'}
 env={k:v for k,v in os.environ.items() if k in allowed}
 try:
  result=subprocess.run(['node',str(script)],input=json.dumps(config,ensure_ascii=False),text=True,capture_output=True,cwd=script.parents[1],env=env,timeout=max(1,min(1801,(config['deadline']-time.time()*1000)/1000+1)))
  parsed=json.loads(result.stdout)
  if result.returncode:
   reason=parsed.get('reason')
   return {'approved':False,'reason':reason if reason in ('claudeUsageLimit','claudeAuthenticationUnavailable','reviewCandidateUnchanged') else 'logicReviewUnavailable'}
  return parsed
 except (OSError,ValueError,subprocess.TimeoutExpired):return {'approved':False,'reason':'logicReviewUnavailable'}

def invoke_cloud_reviewer(origin,headers,review,config,request):
 window=config['reviewWindow'];scope=review['scope']
 queued={'scope':scope,'candidate':review['candidate'],'reviewStartedAt':window['reviewStartedAt'],'reviewDeadline':window['reviewDeadline']}
 if window.get('cloudWindowId'):queued['windowId']=window['cloudWindowId']
 prior=window.get('cloudPreviousJobs',{}).get(scope)
 if prior:queued['previousJobId']=prior
 job=request(origin+'/api/logic-review',headers,queued)
 window['cloudWindowId']=job['windowId'];window.setdefault('cloudPreviousJobs',{})[scope]=job['id']
 while job.get('status') in ('creating','pending','running') and time.time()*1000<review['deadline']:
  time.sleep(min(5,max(0,(review['deadline']-time.time()*1000)/1000)))
  if time.time()*1000>=review['deadline']:break
  job=request(origin+'/api/logic-review/'+job['id'],headers)
 if job.get('status')=='approved' and job.get('reviewProof',{}).get('expiresAt',0)>time.time()*1000:
  return {'approved':True,'candidate':{**review['candidate'],'reviewProof':job['reviewProof']},'rounds':job['round'],'jobId':job['id'],'round':job['round'],'scope':scope}
 return {'approved':False,'reason':job.get('reason','cloudReview'+job.get('status','Held').capitalize()),'issues':job.get('issues',[]),'summary':(job.get('verdict') or {}).get('summary',''),'jobId':job['id'],'round':job['round'],'scope':scope}

def repair_rounds(origin,headers,review,evidence,config,request,repair,now=time.time):
 """Feeds a rejected verdict's issues to the researcher and resubmits in the same window until approval or a limit."""
 scope=evidence['scope'];field='research' if scope=='/api/run' else 'decision';log=[]
 for _ in range(REPAIR_LIMITS.get(scope,0)):
  remaining=evidence['deadline']-now()*1000
  if review.get('approved') is True or review.get('reason')!='cloudReviewRejected' or field not in evidence['candidate']:break
  if remaining<REPAIR_START_MS:log.append({'stopped':'repairWindowClosed'});break
  result=repair({'scope':scope,'submitted':evidence['candidate'][field],'issues':review.get('issues',[]),'summary':review.get('summary',''),'deadline':int(now()*1000+min(REPAIR_ROUND_MS,remaining-REPAIR_REVIEW_MS))})
  revised=result.get(field) if isinstance(result,dict) else None
  if revised is None:log.append({'stopped':(result or {}).get('error','repairUnavailable') if isinstance(result,dict) else 'repairUnavailable'});break
  evidence={**evidence,'candidate':{**evidence['candidate'],field:revised}}
  try:review=invoke_cloud_reviewer(origin,headers,evidence,config,request)
  except urllib.error.HTTPError as error:
   review={'approved':False,'reason':submission_reason(error,'logicReviewUnavailable'),'scope':scope};log.append({'stopped':review['reason']});break
  log.append({'round':review.get('round'),'approved':review.get('approved') is True,'reason':review.get('reason')})
 return {**review,**({'repairs':log} if log else {})},evidence

def risk_submit(origin,headers,path,payload,current,request=None):
 request=request or get_json
 if current.get('logicReview',{}).get('required') is not True:
  raise RuntimeError('Server logical-review capability is required')
 risk_payload={k:v for k,v in payload.items() if k not in ('research','decision','reviewProof','operatorException')}
 risk_payload['expectedRevision']=current['revision']
 return request(origin+path,headers,risk_payload)

def submission_reason(error,fallback=None):
 try:reason=json.load(error).get('reason')
 except Exception:reason=None
 allowed={'reviewRoundLimit','reviewWindowChanged','revisionChanged','previousReviewRequired','collectedEvidenceChanged','cloudReviewNotConfigured','reviewCrossesMarketPhase','reviewRequestTooLarge','accountPaused','sessionPhaseRequired','priceEvidenceStale','reviewCandidateUnchanged','reviewCannotBeRetried'}
 return reason if reason in allowed else fallback or ('revisionChanged' if error.code==409 else 'submissionInvalid')

def review_needed(path,payload,current):
 # Ambiguous or older server context keeps the review; risk-only never gains approval.
 if payload.get('phase') not in ('open','close') or payload.get('research') or payload.get('decision'):return True
 if path=='/api/run':
  plans=current.get('plans')
  return not isinstance(plans,list) or any(not isinstance(p,dict) or p.get('status')!='승인' or p.get('side') not in ('sell','cover') or p.get('riskExit') is not True for p in plans)
 if path=='/api/allocation':
  allocation=current.get('assetAllocation')
  if not isinstance(allocation,dict) or 'state' not in allocation:return True
  state=allocation['state']
  if state is None:return False
  if not isinstance(state,dict) or not isinstance(state.get('positions'),dict):return True
  for position in state['positions'].values():
   if not isinstance(position,dict) or 'pending' not in position:return True
   pending=position.get('pending')
   if pending is not None and (not isinstance(pending,dict) or pending.get('side')!='sell' or pending.get('riskExit') is not True):return True
  return False
 return True

def reviewed_submit(origin,headers,path,payload,current,config,request=None,skip_risk=False,risk_result=None,repair=None):
 request=request or get_json
 # Risk exits run before either model, including when the Mac reviewer is unavailable.
 risk_verified=risk_result is not None
 if risk_result is None:
  risk_result={'revision':current['revision'],'summary':{'status':'logicReviewHeld'}}
  if not skip_risk:
   try:risk_result=risk_submit(origin,headers,path,payload,current,request);risk_verified=True
   except urllib.error.HTTPError as error:
    if error.code not in (400,409):raise
    return {**risk_result,'riskMonitoringVerified':False,'logicReview':{'approved':False,'reason':submission_reason(error),'scope':path}}
 if risk_result.get('skipped') or risk_result.get('paused'):return risk_result
 fresh=request(origin+'/api/context',headers)
 candidate={**payload,'expectedRevision':fresh['revision']}
 try:deadline=execution_deadline(config)
 except (ValueError,OverflowError):deadline=0
 review={'approved':False,'reason':'reviewNotConfigured'}
 hold=config.get('reviewWindow',{}).get('reviewHoldReason') if isinstance(config.get('reviewWindow',{}),dict) else None
 exception=fresh.get('logicReview',{}).get('operatorException',{})
 if deadline>time.time()*1000 and exception.get('expiresAt',0)>time.time()*1000 and (exception.get('status')=='pending' and candidate.get('phase')=='pre' or exception.get('status')=='active' and exception.get('market')==candidate.get('market')) and path not in exception.get('completedScopes',[]):
  try:
   saved=request(origin+path,headers,{**candidate,'operatorException':exception['id']})
   return {**saved,'riskMonitoringVerified':risk_verified}
  except urllib.error.HTTPError as error:
   if error.code not in (400,409,422):raise
   return {**risk_result,'riskMonitoringVerified':risk_verified,'logicReview':{'approved':False,'reason':submission_reason(error,'operatorExceptionUnavailable'),'scope':path}}
 if not review_needed(path,candidate,fresh):
  review={'approved':False,'reason':'reviewNotNeeded'}
 elif deadline<=time.time()*1000:
  review={'approved':False,'reason':'reviewDeadlineHeld'}
 elif hold in ('claudeUsageLimit','claudeAuthenticationUnavailable'):
  review={'approved':False,'reason':hold}
 elif fresh.get('logicReview',{}).get('configured'):
  try:
   evidence={'scope':path,'candidate':candidate,'context':fresh,'deadline':deadline}
   if fresh.get('logicReview',{}).get('cloudConfigured'):
    config.setdefault('reviewWindow',{'reviewStartedAt':config['reviewStartedAt'],'reviewDeadline':config['reviewDeadline']})
    review=invoke_cloud_reviewer(origin,headers,evidence,config,request)
    if repair:
     review,evidence=repair_rounds(origin,headers,review,evidence,config,request,repair)
     candidate=evidence['candidate']
   else:review=invoke_reviewer(evidence)
  except urllib.error.HTTPError as error:
   review={'approved':False,'reason':submission_reason(error,'logicReviewUnavailable')}
  except Exception:review={'approved':False,'reason':'logicReviewUnavailable'}
 if review.get('reason') in ('claudeUsageLimit','claudeAuthenticationUnavailable'):
  config.setdefault('reviewWindow',{'reviewStartedAt':config.get('reviewStartedAt'),'reviewDeadline':config.get('reviewDeadline')})['reviewHoldReason']=review['reason']
 if review.get('approved') is True and time.time()*1000<deadline:
  revised=review.get('candidate',{})
  immutable=lambda value:{k:v for k,v in value.items() if k not in ('research','decision','reviewProof')}
  if immutable(revised)==immutable(candidate) and set(revised)==set(candidate)|{'reviewProof'}:
   try:
    saved=request(origin+path,headers,revised)
    logical=saved.get('logicReview') or saved.get('summary',{}).get('logicReview')
    if logical is not None:
     saved['logicReview']={**{k:v for k,v in review.items() if k in ('jobId','round','scope','repairs')},**logical}
    return saved
   except urllib.error.HTTPError as error:
    if error.code not in (400,409):raise
    review={**review,'approved':False,'reason':submission_reason(error)}
    fresh=request(origin+'/api/context',headers)
 # /api/run answers a summary object; /api/allocation answers one summary per ETF, each already marked logicReviewHeld by the server.
 summary=risk_result.get('summary',{})
 risk_result={**risk_result,'revision':fresh['revision'],'summary':{**summary,'status':'logicReviewHeld'} if isinstance(summary,dict) else summary}
 risk_result['riskMonitoringVerified']=risk_verified
 risk_result['logicReview']={k:v for k,v in review.items() if k in ('reason','issues','jobId','round','scope','repairs')}
 risk_result['logicReview'].update({'approved':False,'reason':review.get('reason','logicReviewHeld'),'scope':path})
 prior=config.get('reviewWindow',{}).get('cloudPreviousJobs',{}).get(path) if isinstance(config.get('reviewWindow'),dict) else None
 if prior:risk_result['logicReview'].setdefault('jobId',prior)
 return risk_result
