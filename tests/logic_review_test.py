import io,json,pathlib,sys,unittest,shutil,subprocess,tempfile,urllib.error,time
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'web'))
import logic_review

class ReviewSubmitTest(unittest.TestCase):
 def test_operator_exception_submits_real_server_authorization_without_a_model_or_forged_proof(self):
  config=self.budget();posted=[]
  ctx={'revision':2,'logicReview':{'required':True,'configured':True,'operatorException':{'id':'user-once','status':'pending','expiresAt':config['reviewDeadline']}}}
  def request(url,headers,body=None):
   if url.endswith('/api/context'):return ctx
   posted.append(body)
   return {'revision':3 if body.get('operatorException') else 2,'summary':{'status':'complete' if body.get('operatorException') else 'logicReviewHeld'},'logicReview':{'approved':bool(body.get('operatorException')),'reviewer':'operator-exception'}}
  with patch.object(logic_review,'invoke_reviewer',side_effect=AssertionError('Exception must not invoke Claude')):
   result=logic_review.reviewed_submit('https://example.com',{},'/api/run',{'market':'asia','phase':'pre','research':{'source':'real evidence'}},{'revision':1,'logicReview':{'required':True}},config,request)
  self.assertTrue(result['logicReview']['approved']);self.assertTrue(result['riskMonitoringVerified']);self.assertEqual(posted[1]['operatorException'],'user-once');self.assertNotIn('operatorException',posted[0]);self.assertNotIn('research',posted[0]);self.assertNotIn('reviewProof',posted[1]);self.assertEqual(posted[1]['expectedRevision'],2)

 def test_operator_exception_rejected_by_server_keeps_risk_result_and_never_retries_with_Claude(self):
  config=self.budget();posted=[];ctx={'revision':2,'logicReview':{'required':True,'configured':True,'operatorException':{'id':'user-once','status':'active','market':'asia','expiresAt':config['reviewDeadline']}}}
  def request(url,headers,body=None):
   if url.endswith('/api/context'):return ctx
   posted.append(body)
   if body.get('operatorException'):raise urllib.error.HTTPError(url,422,'Incomplete research',{},io.BytesIO(b'{}'))
   return {'revision':2,'summary':{'status':'logicReviewHeld'}}
  with patch.object(logic_review,'invoke_reviewer',side_effect=AssertionError('Exception must not invoke Claude')):
   result=logic_review.reviewed_submit('https://example.com',{},'/api/run',{'market':'asia','phase':'open'},{'revision':1,'logicReview':{'required':True}},config,request)
  self.assertFalse(result['logicReview']['approved']);self.assertTrue(result['riskMonitoringVerified']);self.assertEqual(result['logicReview']['reason'],'operatorExceptionUnavailable');self.assertEqual(len(posted),2)

 def test_local_subscription_failures_preserve_only_safe_reasons(self):
  for reason in ['claudeUsageLimit','claudeAuthenticationUnavailable','reviewCandidateUnchanged','private-secret']:
   result=subprocess.CompletedProcess([],2,stdout=json.dumps({'approved':False,'reason':reason}),stderr='private model output')
   with patch.object(logic_review.subprocess,'run',return_value=result):
    held=logic_review.invoke_reviewer({'deadline':int(time.time()*1000)+1000})
   self.assertEqual(held,{'approved':False,'reason':reason if reason!='private-secret' else 'logicReviewUnavailable'})

 def test_open_close_without_nonrisk_orders_never_start_a_reviewer(self):
  for cloud in [False,True]:
   for phase in ['open','close']:
    for scope in ['/api/run','/api/allocation']:
     with self.subTest(cloud=cloud,phase=phase,scope=scope):
      posted=[];ctx={'revision':2,'plans':[{'status':'승인','side':'sell','riskExit':True}],'assetAllocation':{'state':{'positions':{'SGOV':{'pending':None}}}},'logicReview':{'required':True,'configured':True,'cloudConfigured':cloud}}
      def request(url,headers,body=None):
       if url.endswith('/api/context'):return ctx
       self.assertTrue(url.endswith(scope));posted.append(body)
       return {'revision':2,'summary':{'status':'logicReviewHeld'}}
      with patch.object(logic_review,'invoke_reviewer',side_effect=AssertionError('No activity must not review')),patch.object(logic_review,'invoke_cloud_reviewer',side_effect=AssertionError('No activity must not queue')):
       result=logic_review.reviewed_submit('https://example.com',{},scope,{'phase':phase,'market':'us'}, {'revision':1,'logicReview':{'required':True}},self.budget(),request)
      self.assertEqual(len(posted),1);self.assertNotIn('reviewProof',posted[0]);self.assertTrue(result['riskMonitoringVerified']);self.assertEqual(result['logicReview']['reason'],'reviewNotNeeded');self.assertFalse(result['logicReview']['approved'])

 def test_pending_nonrisk_orders_missing_context_and_premarket_still_require_review(self):
  for scope,phase,extra in [('/api/run','close',{'plans':[{'status':'승인','side':'buy','riskExit':False}]}),('/api/run','open',{}),('/api/run','open',{'plans':[{}]}),('/api/allocation','open',{'assetAllocation':{'state':{'positions':{'IEF':{'pending':{'side':'sell','riskExit':False}}}}}}),('/api/allocation','close',{}),('/api/allocation','close',{'assetAllocation':{'state':{'positions':{'SGOV':{}}}}}),('/api/run','pre',{'plans':[]}),('/api/allocation','pre',{'assetAllocation':{'state':None}})]:
   with self.subTest(scope=scope,phase=phase):
    ctx={'revision':2,'logicReview':{'required':True,'configured':True},**extra}
    def request(url,headers,body=None):return ctx if url.endswith('/api/context') else {'revision':2,'summary':{'status':'logicReviewHeld'}}
    with patch.object(logic_review,'invoke_reviewer',return_value={'approved':False,'reason':'fixture'}) as reviewer:
     logic_review.reviewed_submit('https://example.com',{},scope,{'market':'us','phase':phase},{'revision':1,'logicReview':{'required':True}},self.budget(),request)
    reviewer.assert_called_once()

 def test_subscription_failure_stops_other_scopes_in_same_window_after_risk(self):
  config=self.budget();calls=[];ctx={'revision':2,'logicReview':{'required':True,'configured':True}}
  def request(url,headers,body=None):
   if url.endswith('/api/context'):return ctx
   calls.append(body);return {'revision':2,'summary':{'status':'logicReviewHeld'}}
  with patch.object(logic_review,'invoke_reviewer',return_value={'approved':False,'reason':'claudeUsageLimit'}) as reviewer:
   for scope in ['/api/allocation','/api/run']:
    result=logic_review.reviewed_submit('https://example.com',{},scope,{'phase':'pre'},{'revision':1,'logicReview':{'required':True}},config,request)
    self.assertEqual(result['logicReview']['reason'],'claudeUsageLimit');self.assertTrue(result['riskMonitoringVerified'])
   self.assertEqual(reviewer.call_count,1)
  self.assertEqual(len(calls),2)

 def budget(self):
  now=int(time.time()*1000);return {'reviewStartedAt':now,'reviewDeadline':now+logic_review.EXECUTION_REVIEW_MS}
 def test_cloud_queue_keeps_credentials_out_of_review_and_returns_repair_feedback(self):
  config=self.budget();calls=[];ctx={'revision':2,'logicReview':{'required':True,'configured':True,'cloudConfigured':True}}
  def request(url,headers,body=None):
   calls.append((url,body))
   if url.endswith('/api/context'):return ctx
   if url.endswith('/api/logic-review'):
    self.assertNotIn('secret-token',json.dumps(body));return {'id':'job','windowId':'window','round':1,'status':'rejected','issues':['Read original disclosure']}
   return {'revision':2,'summary':{'status':'logicReviewHeld'}}
  with patch.object(logic_review,'invoke_reviewer',side_effect=AssertionError('Cloud must not start local CLI')):
   result=logic_review.reviewed_submit('https://example.com',{'OAI-Sites-Authorization':'Bearer secret-token'},'/api/run',{'research':{'reason':'evidence'},'expectedRevision':1},{'revision':1,'logicReview':{'required':True}},config,request)
  self.assertTrue(result['riskMonitoringVerified']);self.assertEqual(result['logicReview']['issues'],['Read original disclosure'])
  self.assertEqual(result['logicReview']['jobId'],'job');self.assertEqual(config['reviewWindow']['cloudPreviousJobs']['/api/run'],'job');self.assertEqual(len(calls),3)
 def test_rejected_etf_review_keeps_the_array_summary_and_reports_issues(self):
  # /api/allocation answers one summary per ETF (a list); the held result must not spread it like the /api/run object.
  config=self.budget();ctx={'revision':2,'logicReview':{'required':True,'configured':True,'cloudConfigured':True}}
  etf_summary=[{'status':'logicReviewHeld','asset':{'symbol':'570A'}},{'status':'logicReviewHeld','asset':{'symbol':'153130'}}]
  def request(url,headers,body=None):
   if url.endswith('/api/context'):return ctx
   if url.endswith('/api/logic-review'):return {'id':'etf-job','windowId':'window','round':1,'status':'rejected','issues':['570A A43 pending 18 days','decision asOf stale']}
   return {'revision':2,'summary':etf_summary,'logicReview':{'approved':False,'reason':'logicPending'}}
  with patch.object(logic_review,'invoke_reviewer',side_effect=AssertionError('Cloud must not start local CLI')):
   result=logic_review.reviewed_submit('https://example.com',{},'/api/allocation',{'market':'us','phase':'close','snapshots':[{'symbol':'570A'}],'expectedRevision':1},{'revision':1,'logicReview':{'required':True}},config,request)
  self.assertEqual(result['summary'],etf_summary);self.assertTrue(result['riskMonitoringVerified'])
  self.assertEqual(result['logicReview']['reason'],'cloudReviewRejected');self.assertEqual(result['logicReview']['issues'],['570A A43 pending 18 days','decision asOf stale']);self.assertEqual(result['logicReview']['jobId'],'etf-job')
 def test_cloud_approval_polls_then_submits_only_original_candidate_with_proof(self):
  config=self.budget();ctx={'revision':2,'logicReview':{'required':True,'configured':True,'cloudConfigured':True}};posted=[]
  def request(url,headers,body=None):
   if url.endswith('/api/context'):return ctx
   if url.endswith('/api/logic-review'):return {'id':'job','windowId':'window','round':1,'status':'pending'}
   if url.endswith('/api/logic-review/job'):return {'id':'job','windowId':'window','round':1,'status':'approved','reviewProof':{'expiresAt':int(time.time()*1000)+10000}}
   posted.append(body);return {'revision':2,'summary':{'status':'complete'},'logicReview':{'approved':True}}
  with patch.object(logic_review.time,'sleep'):
   result=logic_review.reviewed_submit('https://example.com',{},'/api/run',{'marketSnapshot':{'actual':100}}, {'revision':1,'logicReview':{'required':True}},config,request)
  self.assertTrue(result['logicReview']['approved']);self.assertNotIn('reviewProof',posted[0]);self.assertEqual(posted[1]['marketSnapshot'],{'actual':100});self.assertEqual(posted[1]['expectedRevision'],2)
 def test_cloud_round_limit_is_reported_after_risk_and_unknown_error_text_is_withheld(self):
  for reason in ['reviewRoundLimit','untrusted-secret-string']:
   config=self.budget();ctx={'revision':2,'logicReview':{'required':True,'configured':True,'cloudConfigured':True}}
   def request(url,headers,body=None):
    if url.endswith('/api/context'):return ctx
    if url.endswith('/api/logic-review'):raise urllib.error.HTTPError(url,409,'Conflict',{},io.BytesIO(json.dumps({'reason':reason}).encode()))
    return {'revision':2,'summary':{'status':'logicReviewHeld'}}
   result=logic_review.reviewed_submit('https://example.com',{},'/api/run',{}, {'revision':1,'logicReview':{'required':True}},config,request)
   self.assertTrue(result['riskMonitoringVerified']);self.assertEqual(result['logicReview']['reason'],'reviewRoundLimit' if reason=='reviewRoundLimit' else 'logicReviewUnavailable');self.assertNotIn('untrusted-secret-string',json.dumps(result))
 def test_missing_or_extended_deadline_holds_review_but_preserves_risk_submission(self):
  now=1000000;ctx={'revision':2,'logicReview':{'required':True,'configured':True}}
  for config in [{},{'reviewStartedAt':now,'reviewDeadline':now+logic_review.EXECUTION_REVIEW_MS+1}]:
   calls=[]
   def request(url,headers,body=None):
    calls.append(body);return ctx if url.endswith('/api/context') else {'summary':{'status':'logicReviewHeld'}}
   with patch.object(logic_review.time,'time',return_value=now/1000),patch.object(logic_review,'invoke_reviewer',side_effect=AssertionError('Invalid budget must not review')):
    result=logic_review.reviewed_submit('https://example.com',{},'/api/run',{}, {'revision':1,'logicReview':{'required':True}},config,request)
   self.assertTrue(result['riskMonitoringVerified']);self.assertEqual(len(calls),2);self.assertEqual(result['logicReview']['reason'],'reviewDeadlineHeld')

 def test_allocation_run_and_retry_share_one_deadline_and_expiry_keeps_risk_only(self):
  now=1000000;config={'reviewStartedAt':now,'reviewDeadline':now+logic_review.EXECUTION_REVIEW_MS};seen=[];submitted=[]
  ctx={'revision':2,'logicReview':{'required':True,'configured':True}}
  def request(url,headers,body=None):
   if url.endswith('/api/context'):return ctx
   submitted.append(body);return {'summary':{'status':'logicReviewHeld'}}
  def review(value):
   seen.append(value['deadline']);return {'approved':False}
  for offset,path in [(0,'/api/allocation'),(600000,'/api/run'),(logic_review.EXECUTION_REVIEW_MS,'/api/run')]:
   with patch.object(logic_review.time,'time',return_value=(now+offset)/1000),patch.object(logic_review,'invoke_reviewer',side_effect=review):
    logic_review.reviewed_submit('https://example.com',{},path,{}, {'revision':1,'logicReview':{'required':True}},config,request)
  self.assertEqual(seen,[now+logic_review.EXECUTION_REVIEW_MS,now+logic_review.EXECUTION_REVIEW_MS]);self.assertEqual(len(submitted),3)

 def test_downloaded_cloud_updater_imports_and_submits_risk_without_mac_bridge(self):
  web=pathlib.Path(__file__).resolve().parents[1]/'web'
  with tempfile.TemporaryDirectory() as folder:
   for name in ['collect_prices.py','collect_fundamentals.py','run_autonomy.py','logic_review.py','index-catalog.mjs','etf-catalog.mjs']:
    shutil.copyfile(web/name,pathlib.Path(folder)/name)
   imported=subprocess.run([sys.executable,'-c','import run_autonomy'],cwd=folder,capture_output=True,text=True)
   self.assertEqual(imported.returncode,0,imported.stderr)
   calls=[];ctx={'revision':2,'logicReview':{'required':True,'configured':True,'codeDigest':'code'}}
   risk_result={'summary':{'status':'logicReviewHeld'},'revision':2}
   def request(url,headers,body=None):
    calls.append((url,body));return ctx if url.endswith('/api/context') else risk_result
   with patch.object(logic_review,'__file__',str(pathlib.Path(folder)/'logic_review.py')):
    self.assertEqual(logic_review.invoke_reviewer({})['reason'],'macReviewerRequired')
    result=logic_review.reviewed_submit('https://example.com',{},'/api/run',{'expectedRevision':1,'research':{'decision':'new entry'}},{'revision':1,'logicReview':{'required':True}},self.budget(),request)
   self.assertTrue(result['riskMonitoringVerified']);self.assertEqual(result['logicReview']['reason'],'macReviewerRequired')
   self.assertEqual(len(calls),2);self.assertNotIn('research',calls[0][1]);self.assertNotIn('reviewProof',calls[0][1])

 def test_revision_conflict_is_held_without_resubmitting_a_previous_approval(self):
  calls=[];ctx={'revision':2,'logicReview':{'required':True,'configured':True,'codeDigest':'code'}}
  def request(url,headers,body=None):
   calls.append((url,body))
   if url.endswith('/api/context'):return ctx
   if body.get('reviewProof'):raise urllib.error.HTTPError(url,409,'Conflict',{},None)
   return {'summary':{'status':'logicReviewHeld'}}
  def review(config):return {'approved':True,'candidate':{**config['candidate'],'reviewProof':{'fixture':'signed'}}}
  with patch.object(logic_review,'invoke_reviewer',side_effect=review):
   result=logic_review.reviewed_submit('https://example.com',{},'/api/run',{'expectedRevision':1},{'revision':1,'logicReview':{'required':True}},self.budget(),request)
  self.assertFalse(result['logicReview']['approved']);self.assertEqual(result['logicReview']['reason'],'revisionChanged');self.assertEqual(len(calls),4)

 def test_cloud_final_submission_errors_hold_with_original_job_and_scope(self):
  for status,reason in [(409,'revisionChanged'),(400,'submissionInvalid')]:
   config=self.budget();ctx={'revision':2,'logicReview':{'required':True,'configured':True,'cloudConfigured':True}};posted=[]
   def request(url,headers,body=None):
    if url.endswith('/api/context'):return ctx
    if url.endswith('/api/logic-review'):return {'id':'job','windowId':'window','round':1,'status':'approved','reviewProof':{'expiresAt':int(time.time()*1000)+10000}}
    posted.append(body)
    if body.get('reviewProof'):raise urllib.error.HTTPError(url,status,'Declined',{},io.BytesIO(b'{"error":"secret-string"}'))
    return {'revision':2,'summary':{'status':'logicReviewHeld'}}
   result=logic_review.reviewed_submit('https://example.com',{},'/api/run',{}, {'revision':1,'logicReview':{'required':True}},config,request)
   self.assertEqual(result['logicReview']['reason'],reason);self.assertEqual(result['logicReview']['jobId'],'job');self.assertEqual(result['logicReview']['scope'],'/api/run')
   self.assertNotIn('secret-string',json.dumps(result));self.assertEqual(len(posted),2)

 def test_queue_retry_does_not_resubmit_old_risk_evidence(self):
  config=self.budget();ctx={'revision':3,'logicReview':{'required':True,'configured':True,'cloudConfigured':True}};calls=[]
  def request(url,headers,body=None):
   calls.append((url,body))
   if url.endswith('/api/context'):return ctx
   if url.endswith('/api/logic-review'):return {'id':'next-job','windowId':'window','round':2,'status':'rejected'}
   raise AssertionError('Old prices must not be risk-submitted on retry')
  result=logic_review.reviewed_submit('https://example.com',{},'/api/run',{'marketSnapshot':{'fetchedAt':'original'}},ctx,config,request,skip_risk=True)
  self.assertEqual(result['logicReview']['jobId'],'next-job');self.assertFalse(result['riskMonitoringVerified']);self.assertEqual(result['revision'],3)

 def test_stale_risk_evidence_returns_structured_hold_without_starting_model(self):
  ctx={'revision':1,'logicReview':{'required':True,'configured':True}}
  def request(url,headers,body=None):
   if url.endswith('/api/context'):return ctx
   raise urllib.error.HTTPError(url,400,'Stale',{},io.BytesIO(b'{"reason":"priceEvidenceStale"}'))
  with patch.object(logic_review,'invoke_reviewer',side_effect=AssertionError('Invalid risk evidence must hold')):
   result=logic_review.reviewed_submit('https://example.com',{},'/api/run',{},ctx,self.budget(),request)
  self.assertEqual(result['logicReview']['reason'],'priceEvidenceStale');self.assertFalse(result['riskMonitoringVerified'])

 def test_risk_operation_precedes_model_call_and_only_latest_revision_is_reviewed(self):
  calls=[];payload={'research':{'decision':'evidence'},'marketSnapshot':{'prices':'actual'},'expectedRevision':1}
  ctx={'revision':2,'logicReview':{'required':True,'configured':True,'codeDigest':'code'}}
  def request(url,headers,body=None):
   calls.append(('api',url,body));return ctx if url.endswith('/api/context') else {'summary':{'status':'logicReviewHeld' if len(calls)==1 else 'complete'}}
  def model(config):
   calls.append(('model',config));self.assertNotIn('secret-token',json.dumps(config));self.assertEqual(config['candidate']['expectedRevision'],2)
   return {'approved':True,'candidate':{**config['candidate'],'reviewProof':{'signature':'signed'}}}
  with patch.object(logic_review,'get_json',side_effect=request),patch.object(logic_review,'invoke_reviewer',side_effect=model):
   result=logic_review.reviewed_submit('https://example.com',{'OAI-Sites-Authorization':'Bearer secret-token'},'/api/run',payload,{'revision':1,'logicReview':{'required':True}},self.budget())
  self.assertEqual(calls[0][0],'api');self.assertNotIn('research',calls[0][2]);self.assertEqual(calls[2][0],'model');self.assertEqual(calls[3][2]['reviewProof']['signature'],'signed');self.assertEqual(result['summary']['status'],'complete')
 def test_rejection_or_missing_reviewer_returns_risk_result_without_new_entry_submission(self):
  calls=[];ctx={'revision':2,'logicReview':{'required':True,'configured':True,'codeDigest':'code'}}
  def request(url,headers,body=None):calls.append(url);return ctx if url.endswith('/api/context') else {'summary':{'status':'logicReviewHeld'}}
  with patch.object(logic_review,'get_json',side_effect=request),patch.object(logic_review,'invoke_reviewer',return_value={'approved':False}):
   result=logic_review.reviewed_submit('https://example.com',{},'/api/run',{'expectedRevision':1},{'revision':1,'logicReview':{'required':True}},self.budget())
  self.assertEqual(len(calls),2);self.assertEqual(result['summary']['status'],'logicReviewHeld');self.assertTrue(result['riskMonitoringVerified'])
 def test_repaired_payload_cannot_modify_price_evidence_or_phase(self):
  payload={'expectedRevision':1,'phase':'pre','marketSnapshot':{'actual':100}}
  ctx={'revision':2,'logicReview':{'required':True,'configured':True,'codeDigest':'code'}}
  with patch.object(logic_review,'get_json',side_effect=[{'summary':{'status':'logicReviewHeld'}},ctx]),patch.object(logic_review,'invoke_reviewer',return_value={'approved':True,'candidate':{**payload,'expectedRevision':2,'marketSnapshot':{'actual':999},'reviewProof':{}}}):
   result=logic_review.reviewed_submit('https://example.com',{},'/api/run',payload,{'revision':1,'logicReview':{'required':True}},self.budget())
  self.assertEqual(result['summary']['status'],'logicReviewHeld')
class CloudRepairRoundTest(unittest.TestCase):
 ctx={'revision':2,'logicReview':{'required':True,'configured':True,'cloudConfigured':True}}
 def queue(self,verdicts,posted,queued):
  # Each queue call answers the next verdict; the final store call records what was submitted.
  def request(url,headers,body=None):
   if url.endswith('/api/context'):return self.ctx
   if url.endswith('/api/logic-review'):
    queued.append(body);status=verdicts[len(queued)-1]
    return {'id':'job'+str(len(queued)),'windowId':'window','round':len(queued),'status':status,'issues':['기준 불일치'] if status=='rejected' else [],'verdict':{'summary':'반려 요약'},**({'reviewProof':{'expiresAt':int(time.time()*1000)+60000}} if status=='approved' else {})}
   posted.append(body);return {'revision':2,'summary':{'status':'complete' if body.get('reviewProof') else 'logicReviewHeld'},'logicReview':{'approved':bool(body.get('reviewProof'))}}
  return request
 def submit(self,verdicts,repair,config=None,path='/api/run',payload=None):
  posted=[];queued=[];config=config or {'reviewStartedAt':int(time.time()*1000),'reviewDeadline':int(time.time()*1000)+logic_review.EXECUTION_REVIEW_MS}
  payload=payload or {'market':'us','phase':'pre','research':{'decision':'v1'},'expectedRevision':1}
  result=logic_review.reviewed_submit('https://example.com',{},path,payload,{'revision':1,'logicReview':{'required':True}},config,self.queue(verdicts,posted,queued),repair=repair)
  return result,posted,queued
 def test_rejection_feeds_issues_to_the_researcher_and_the_repaired_research_is_approved_and_stored(self):
  seen=[]
  def repair(job):
   seen.append(job);return {'research':{'decision':'v2'}}
  result,posted,queued=self.submit(['rejected','approved'],repair)
  self.assertTrue(result['logicReview']['approved']);self.assertEqual(seen[0]['issues'],['기준 불일치']);self.assertEqual(seen[0]['summary'],'반려 요약')
  self.assertEqual(seen[0]['submitted'],{'decision':'v1'});self.assertEqual(queued[1]['candidate']['research'],{'decision':'v2'});self.assertEqual(queued[1]['previousJobId'],'job1')
  self.assertEqual(posted[-1]['research'],{'decision':'v2'});self.assertIn('reviewProof',posted[-1])
  self.assertLessEqual(seen[0]['deadline'],int(time.time()*1000)+logic_review.REPAIR_ROUND_MS)
 def test_repairs_stop_at_the_scope_limit_and_on_a_failed_repair(self):
  result,posted,queued=self.submit(['rejected']*5,lambda job:{'research':{'decision':str(time.time())}})
  self.assertEqual(len(queued),1+logic_review.REPAIR_LIMITS['/api/run']);self.assertFalse(result['logicReview']['approved'])
  self.assertEqual(len(result['logicReview']['repairs']),logic_review.REPAIR_LIMITS['/api/run'])
  result,posted,queued=self.submit(['rejected'],lambda job:{'error':'repairUnchanged'})
  self.assertEqual(len(queued),1);self.assertEqual(result['logicReview']['repairs'],[{'stopped':'repairUnchanged'}])
  called=[]
  for payload in [{'market':'us','phase':'pre','snapshots':[],'expectedRevision':1},{'market':'us','phase':'pre','snapshots':[],'decision':{'reason':'v1'},'expectedRevision':1}]:
   result,posted,queued=self.submit(['rejected','approved'],lambda job:called.append(job) or {'decision':{'reason':'v2'}},path='/api/allocation',payload=payload)
   self.assertEqual(len(queued),1,'ETF reviews are never repaired, with or without a decision')
  self.assertEqual(called,[])
 def test_no_repair_starts_with_under_ten_minutes_left_or_after_a_non_rejection(self):
  now=int(time.time()*1000);called=[]
  result,posted,queued=self.submit(['rejected'],lambda job:called.append(job),config={'reviewStartedAt':now-21*60000,'reviewDeadline':now+9*60000})
  self.assertEqual(called,[]);self.assertEqual(result['logicReview']['repairs'],[{'stopped':'repairWindowClosed'}])
  result,posted,queued=self.submit(['expired'],lambda job:called.append(job))
  self.assertEqual(called,[]);self.assertNotIn('repairs',result['logicReview'])
 def test_a_server_refusal_of_the_resubmission_ends_the_loop_with_its_safe_reason(self):
  base=self.queue(['rejected'],[],[])
  def request(url,headers,body=None):
   if url.endswith('/api/logic-review') and body.get('previousJobId'):raise urllib.error.HTTPError(url,409,'limit',{},io.BytesIO(b'{"reason":"reviewRoundLimit"}'))
   return base(url,headers,body)
  config={'reviewStartedAt':int(time.time()*1000),'reviewDeadline':int(time.time()*1000)+logic_review.EXECUTION_REVIEW_MS}
  result=logic_review.reviewed_submit('https://example.com',{},'/api/run',{'market':'us','phase':'pre','research':{'decision':'v1'},'expectedRevision':1},{'revision':1,'logicReview':{'required':True}},config,request,repair=lambda job:{'research':{'decision':'v2'}})
  self.assertEqual(result['logicReview']['reason'],'reviewRoundLimit');self.assertFalse(result['logicReview']['approved'])

if __name__=='__main__':unittest.main()
