import contextlib
import importlib.util
import io
import json
import pathlib
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'web'))
import run_autonomy
import logic_review
import collect_factors
# collect() also fetches Fama-French factors; tests stay offline.
collect_factors.fetch=lambda url:(_ for _ in ()).throw(OSError('offline in tests'))
import collect_prices

def approve_fixture(config):return {'approved':True,'candidate':{**config['candidate'],'reviewProof':{'fixture':'signed'}}}
REVIEW_CONTEXT={'required':True,'configured':True,'codeDigest':'fixture'}

class LegacyCollectorRevisionTest(unittest.TestCase):
 def test_direct_compatibility_collector_binds_submission_to_the_revision_it_read(self):
  stamp=run_autonomy.datetime.datetime.fromisoformat('2026-10-08T09:00:00+09:00').timestamp()
  slot=int((stamp*1000+9*3600000)//14400000);calls=[]
  current={'revision':7,'metadata':{'lastSlot':None},'state':{'activeSymbols':['005930']}}
  def request(url,headers,body=None):
   if url.endswith('/api/run'):
    calls.append(body);return {'summary':{'status':'logicReviewHeld'}}
   if calls:return {'revision':8,'metadata':{'lastSlot':slot,'runCount':1,'lastRun':'fixture'}}
   return current
  with patch.object(collect_prices.time,'time',return_value=stamp),patch.object(collect_prices,'collect',return_value={'quotes':{}}),patch.object(collect_prices,'get_json',side_effect=request),patch.object(sys,'stdin',io.StringIO(json.dumps({'site_url':'https://example.com','token':'fixture-token'}))),patch.object(sys,'argv',['collect_prices.py']),contextlib.redirect_stdout(io.StringIO()):
   collect_prices.main()
  self.assertEqual(calls[0].get('expectedRevision'),7)

class UpdaterReadinessTest(unittest.TestCase):
 def setUp(self):
  reviewer=patch.object(logic_review,'invoke_reviewer',side_effect=approve_fixture);reviewer.start();self.addCleanup(reviewer.stop)
  weekday=run_autonomy.datetime.datetime.fromisoformat('2026-10-08T09:20:00+09:00').timestamp()
  clock=patch.object(run_autonomy.time,'time',return_value=weekday);clock.start();self.addCleanup(clock.stop)
 def test_updater_owns_the_review_clock_and_runs_existing_risk_first(self):
  result,calls=self.invoke(complete=True,holdings=True,budget=False)
  runs=[body for route,body in calls if route=='run']
  self.assertTrue(result['verified']);self.assertIn('reviewWindow',result)
  self.assertNotIn('reviewProof',runs[0]);self.assertNotIn('research',runs[0])
  self.assertTrue(any(body.get('reviewProof') for body in runs))
 def test_readonly_collection_honors_explicit_index_subset(self):
  selected=['005930','003030','AOS','1332'];output=io.StringIO()
  with patch.object(run_autonomy,'collect',return_value={'data':{}}) as prices,patch.object(run_autonomy,'collect_fundamentals',return_value={}) as financials,patch.object(sys,'argv',['run_autonomy.py','--collect','--symbols',','.join(selected)]),contextlib.redirect_stdout(output):
   run_autonomy.main()
  prices.assert_called_once_with(selected);financials.assert_called_once_with(selected)
 def test_weekend_stops_before_research_collection_or_account_write(self):
  output=io.StringIO()
  def forbidden(*args,**kwargs):raise AssertionError('Weekend must not fetch or write')
  saturday=run_autonomy.datetime.datetime.fromisoformat('2026-10-10T09:00:00+09:00').timestamp()
  with patch.object(run_autonomy.time,'time',return_value=saturday),patch.object(run_autonomy,'get_json',side_effect=forbidden),patch.object(run_autonomy,'collect',side_effect=forbidden),patch.object(sys,'stdin',io.StringIO(json.dumps({'site_url':'https://example.com','token':'secret-token','reviewStartedAt':run_autonomy.time.time()*1000,'reviewDeadline':run_autonomy.time.time()*1000+run_autonomy.REVIEW_WINDOW_MS}))),patch.object(sys,'argv',['run_autonomy.py']),contextlib.redirect_stdout(output):
   run_autonomy.main()
  result=json.loads(output.getvalue());self.assertEqual(result['status'],'marketClosed');self.assertTrue(result['skipped']);self.assertNotIn('secret-token',output.getvalue())
 def invoke(self,complete=False,holdings=False,reused=False,ready_units=False,changed=False,budget=True):
  calls=[];slot=int((run_autonomy.time.time()*1000+9*3600000)//14400000)
  readiness={'complete':complete,'readyUnitIds':['ready-unit'] if ready_units else [],'regions':[],'missing':[] if complete else [{'region':'한국','kind':'macro','field':'liquidity','reason':'source needed'}]}
  current={'revision':3,'logicReview':REVIEW_CONTEXT,'activeSymbols':['005930'],'metadata':{'runCount':2,'lastSlot':slot if reused else None},'holdings':[{'symbol':'005930'}] if holdings else [],'lastResearch':None,'lastCycle':{'status':'complete'}}
  def get(url,headers=None,payload=None):
   calls.append((url.rsplit('/',1)[-1],payload))
   if url.endswith('/context'):
    if any(route=='run' for route,_ in calls):return {**current,'lastCycle':{'status':'complete' if complete and any(body.get('reviewProof') for route,body in calls if route=='run') else 'logicReviewHeld'},'metadata':{'lastSlot':slot,'pipelineVersion':5,'runCount':3,'lastRun':'now'}}
    return current
   if url.endswith('/research-check'):return readiness
   if url.endswith('/run'):return {'summary':{'status':'complete' if complete else 'researchIncomplete','researchReadiness':readiness}}
   if url.endswith('/research'):return {'revision':4,'researchReadiness':readiness}
   return {'saved':True}
  output=io.StringIO()
  config={'reviewStartedAt':int(run_autonomy.time.time()*1000),'reviewDeadline':int(run_autonomy.time.time()*1000)+run_autonomy.REVIEW_WINDOW_MS-1,'site_url':'https://example.com','token':'secret-token','research':{'asOf':'now'},**({'symbols':['005930','000660']} if changed else {})}
  if not budget:config.pop('reviewStartedAt');config.pop('reviewDeadline')
  with patch.object(run_autonomy,'get_json',side_effect=get),patch.object(run_autonomy,'collect',return_value={'provider':'fixture'}),patch.object(run_autonomy,'collect_fundamentals',return_value={}),patch.object(sys,'stdin',io.StringIO(json.dumps(config))),patch.object(sys,'argv',['run_autonomy.py']),contextlib.redirect_stdout(output):
   run_autonomy.main()
  self.assertNotIn('secret-token',output.getvalue());return json.loads(output.getvalue()),calls
 def test_incomplete_cash_account_never_calls_run_and_reports_missing(self):
  result,calls=self.invoke();self.assertFalse(result['verified']);self.assertEqual(result['status'],'researchIncomplete');self.assertEqual(result['researchReadiness']['missing'][0]['field'],'liquidity');self.assertFalse(any(route=='run' for route,_ in calls))
 def test_incomplete_holdings_keep_risk_monitoring_without_claiming_completion(self):
  result,calls=self.invoke(holdings=True);self.assertFalse(result['verified']);self.assertTrue(result['riskMonitoringVerified']);self.assertTrue(any(route=='run' for route,_ in calls));self.assertEqual(result['status'],'researchIncomplete')
 def test_partial_research_runs_reviewed_units_and_keeps_missing_work_visible(self):
  result,calls=self.invoke(ready_units=True);self.assertTrue(any(route=='run' for route,_ in calls));self.assertEqual(result['status'],'researchIncomplete');self.assertFalse(result['verified']);self.assertEqual(result['researchReadiness']['readyUnitIds'],['ready-unit'])
 def test_complete_research_is_preflighted_before_run_and_read_back(self):
  result,calls=self.invoke(complete=True);self.assertTrue(result['verified']);routes=[route for route,_ in calls];self.assertLess(routes.index('research-check'),routes.index('run'))
 def test_reused_slot_cannot_turn_missing_new_research_into_complete(self):
  result,calls=self.invoke(reused=True);self.assertTrue(result['reused']);self.assertFalse(result['verified']);self.assertEqual(result['status'],'researchIncomplete');self.assertFalse(any(route=='run' for route,_ in calls))
  self.assertTrue(any(route=='research' for route,_ in calls),'Partial discovery must persist for the next analysis batch')

 def test_incomplete_discovery_is_saved_without_running_an_empty_cash_account(self):
  result,calls=self.invoke();self.assertTrue(any(route=='research' for route,_ in calls));self.assertFalse(any(route=='run' for route,_ in calls));self.assertEqual(result['status'],'researchIncomplete')
  result,calls=self.invoke(changed=True);self.assertTrue(any(route=='research' for route,_ in calls));self.assertFalse(any(route=='run' for route,_ in calls));self.assertEqual(result['status'],'researchIncomplete')

 def test_etf_allocation_runs_before_incomplete_stock_research_and_is_verified(self):
  calls=[];current={'revision':1,'logicReview':REVIEW_CONTEXT,'assetAllocation':{'state':None},'metadata':{'lastSlot':None},'holdings':[]}
  def get(url,headers=None,payload=None):
   route=url.rsplit('/',1)[-1];calls.append(route)
   if route=='context':return {**current,'revision':3 if 'allocation' in calls else 1}
   if route=='market-reports':return {'revision':2,'marketReports':{'reports':[]}}
   if route=='allocation':return {'revision':3,'logicReview':{'approved':True},'summary':[{'status':'orderApproved'}]}
   if route=='research-check':return {'complete':False,'missing':[{'field':'liquidity'}]}
   return {'saved':True}
  output=io.StringIO();weekday=run_autonomy.datetime.datetime.fromisoformat('2026-10-05T20:00:00+09:00').timestamp()
  with patch.object(run_autonomy.time,'time',return_value=weekday),patch.object(run_autonomy,'get_json',side_effect=get),patch.object(run_autonomy,'collect_bonds',return_value={'snapshots':[{'symbol':'SGOV'}],'failures':[]}),patch.object(run_autonomy,'collect',side_effect=AssertionError('Stock collection must remain gated')),patch.object(sys,'stdin',io.StringIO(json.dumps({'site_url':'https://example.com','token':'secret-token','reviewStartedAt':run_autonomy.time.time()*1000,'reviewDeadline':run_autonomy.time.time()*1000+run_autonomy.REVIEW_WINDOW_MS}))),patch.object(sys,'argv',['run_autonomy.py']),contextlib.redirect_stdout(output):run_autonomy.main()
  result=json.loads(output.getvalue());self.assertTrue(result['assetAllocation']['verified']);self.assertFalse(result['verified']);self.assertIn('allocation',calls);self.assertNotIn('run',calls)

class SessionUpdaterTest(unittest.TestCase):
 def test_invalid_department_sources_stop_new_submission_after_existing_stock_risk(self):
  stamp=run_autonomy.datetime.datetime.fromisoformat('2026-10-12T08:00:00+09:00').timestamp()
  session={'market':'asia','phase':'pre','date':'2026-10-12','key':'asia:2026-10-12:pre','countries':['한국']}
  current={'revision':1,'logicReview':REVIEW_CONTEXT,'metadata':{},'activeSymbols':['005930'],'holdings':[{'symbol':'005930'}]}
  calls=[];gap={'kind':'validation','field':'technical.005930.sourceUrls','reason':'registered sources required'}
  def get(url,headers=None,payload=None):
   calls.append((url,payload))
   if '/session?' in url:return session
   if url.endswith('/context'):return current
   if url.endswith('/run'):return {'revision':2,'summary':{'status':'logicReviewHeld'}}
   if url.endswith('/research-check'):return {'complete':False,'missing':[gap]}
   if url.endswith('/attempt'):return {'saved':True}
   raise AssertionError(url)
  output=io.StringIO()
  with patch.object(run_autonomy.time,'time',return_value=stamp),patch.object(run_autonomy,'get_json',side_effect=get),patch.object(run_autonomy,'collect',return_value={'quotes':{}}),patch.object(run_autonomy,'collect_fundamentals',return_value={}),patch.object(run_autonomy,'reviewed_submit',side_effect=AssertionError('Invalid research must not reach review')),contextlib.redirect_stdout(output):
   result=run_autonomy.run_session({'market':'asia','phase':'pre','research':{'invalid':'fixture'}},'https://example.com',{})
  self.assertEqual(result,2);self.assertEqual(json.loads(output.getvalue())['researchReadiness']['missing'],[gap])
  risks=[payload for url,payload in calls if url.endswith('/run')];self.assertEqual(len(risks),1);self.assertNotIn('research',risks[0]);self.assertNotIn('operatorException',risks[0])

 def test_collection_error_records_safe_stage_and_http_status_without_raw_credentials(self):
  stamp=run_autonomy.datetime.datetime.fromisoformat('2026-10-12T17:00:00+09:00').timestamp()
  session={'market':'asia','phase':'close','date':'2026-10-12','key':'asia:2026-10-12:close','countries':['한국']}
  attempts=[]
  def get(url,headers=None,payload=None):
   if '/session?' in url:return session
   if url.endswith('/context'):return {'revision':1,'metadata':{},'activeSymbols':['005930']}
   if url.endswith('/attempt'):attempts.append(payload);return {'saved':True}
   raise AssertionError(url)
  error=run_autonomy.urllib.error.HTTPError('https://example.com/?token=secret',403,'secret-token',{},None)
  out,err=io.StringIO(),io.StringIO()
  with patch.object(run_autonomy.time,'time',return_value=stamp),patch.object(run_autonomy,'get_json',side_effect=get),patch.object(run_autonomy,'collect',side_effect=error),patch.object(sys,'stdin',io.StringIO(json.dumps({'site_url':'https://example.com','token':'secret-token','market':'asia','phase':'close'}))),patch.object(sys,'argv',['run_autonomy.py']),contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
   result=run_autonomy.main()
  self.assertEqual(result,1);failure=json.loads(err.getvalue())
  self.assertEqual(failure['diagnostic'],{'stage':'stockPriceCollection','reason':'requestDeclined','httpStatus':403})
  self.assertIn('stockPriceCollection',attempts[0]['message']);self.assertNotIn('secret',json.dumps(attempts)+out.getvalue()+err.getvalue())

 def test_etf_collector_uses_server_open_countries_and_preserves_detailed_failure(self):
  stamp=run_autonomy.datetime.datetime.fromisoformat('2026-10-12T17:00:00+09:00').timestamp()
  session={'market':'asia','phase':'close','date':'2026-10-12','key':'asia:2026-10-12:close','countries':['한국'],'closedCountries':[{'country':'일본','reason':'exchangeHoliday'}]}
  current={'revision':1,'logicReview':REVIEW_CONTEXT,'metadata':{'lastSession':session},'assetAllocation':{'state':None},'activeSymbols':['005930'],'holdings':[]}
  def get(url,headers=None,payload=None):
   if '/session?' in url:return session
   if url.endswith('/context'):return current
   raise AssertionError(url)
  def submit(origin,headers,path,payload,*args,**kwargs):
   if path=='/api/allocation':raise run_autonomy.urllib.error.HTTPError(origin+path,409,'secret',{},None)
   return {'summary':{'status':'complete','session':session}}
  output=io.StringIO()
  with patch.object(run_autonomy.time,'time',return_value=stamp),patch.object(run_autonomy,'get_json',side_effect=get),patch.object(run_autonomy,'collect',return_value={'quotes':{}}),patch.object(run_autonomy,'collect_bonds',return_value={'snapshots':[{'symbol':'153130'}],'failures':[]}) as bonds,patch.object(run_autonomy,'reviewed_submit',side_effect=submit),contextlib.redirect_stdout(output):
   run_autonomy.run_session({'market':'asia','phase':'close'},'https://example.com',{})
  bonds.assert_called_once_with(['한국'],[])
  parsed=json.loads(output.getvalue());self.assertEqual(parsed['assetAllocation']['diagnostic'],{'stage':'allocationSubmit','reason':'requestDeclined','httpStatus':409})
  self.assertFalse(parsed['verified']);self.assertEqual(parsed['status'],'allocationFailed');self.assertEqual(parsed['closedCountries'],session['closedCountries'])

 def test_phase_crossing_reads_back_the_actual_risk_session_and_holds_review(self):
  opened={'market':'asia','phase':'open','date':'2026-10-06','zone':'Asia/Seoul','key':'asia:2026-10-06:open'}
  closed={**opened,'phase':'close','key':'asia:2026-10-06:close'}
  current={'revision':1,'logicReview':REVIEW_CONTEXT,'metadata':{},'activeSymbols':['005930'],'holdings':[{'symbol':'005930'}]}
  runs=[]
  def get(url,headers=None,payload=None):
   if '/session?' in url:return opened
   if url.endswith('/context'):return {**current,'metadata':{'lastSession':closed} if runs else {}}
   if url.endswith('/run'):
    runs.append(payload);return {'summary':{'status':'logicReviewHeld','session':closed,'approved':0}}
   raise AssertionError(url)
  stamp=run_autonomy.datetime.datetime.fromisoformat('2026-10-06T15:35:00+09:00').timestamp()
  output=io.StringIO()
  with patch.object(run_autonomy.time,'time',return_value=stamp),patch.object(run_autonomy,'get_json',side_effect=get),patch.object(run_autonomy,'collect',return_value={'quotes':{}}),patch.object(logic_review,'invoke_reviewer',side_effect=AssertionError('Expired phase must hold review')),contextlib.redirect_stdout(output):
   result=run_autonomy.run_session({'market':'asia'},'https://example.com',{})
  saved=json.loads(output.getvalue());self.assertEqual(result,2);self.assertEqual(saved['status'],'logicReviewHeld');self.assertTrue(saved['riskMonitoringVerified']);self.assertEqual(saved['summary']['session']['key'],closed['key']);self.assertTrue(all('reviewProof' not in body for body in runs))

 def setUp(self):
  reviewer=patch.object(logic_review,'invoke_reviewer',side_effect=approve_fixture);reviewer.start();self.addCleanup(reviewer.stop)
 def test_legacy_review_times_are_not_renewed_even_if_partial_or_expired(self):
  for times in [{'reviewStartedAt':1000000,'reviewDeadline':1000000+run_autonomy.REVIEW_WINDOW_MS},{'reviewStartedAt':1000000},{'reviewDeadline':1000000+run_autonomy.REVIEW_WINDOW_MS}]:
   with self.subTest(times=times),patch.object(run_autonomy.time,'time',return_value=3000):
    config=dict(times);run_autonomy.start_review(config)
    self.assertEqual(config['reviewWindow'],{'reviewStartedAt':times.get('reviewStartedAt'),'reviewDeadline':times.get('reviewDeadline')})
    with self.assertRaises(ValueError) if len(times)==1 else contextlib.nullcontext():logic_review.execution_deadline(config)

 def test_failed_candidates_still_submit_held_stock_risk_before_fundamentals(self):
  stamp=run_autonomy.datetime.datetime.fromisoformat('2026-10-08T08:00:00+09:00').timestamp()
  session={'market':'asia','phase':'pre','date':'2026-10-08','key':'asia:2026-10-08:pre'}
  research={'investmentIdeas':[{'candidates':[{'symbol':'NVDA'},{'symbol':'053610'}]}]}
  current={'revision':1,'logicReview':REVIEW_CONTEXT,'metadata':{},'activeSymbols':['MSFT'],'holdings':[{'symbol':'MSFT'}],'lastResearch':research};runs=[]
  def get(url,headers=None,payload=None):
   if '/api/session?' in url:return session
   if url.endswith('/api/context'):return {**current,'metadata':{'lastSession':session}}
   if url.endswith('/api/research-check'):return {'complete':False,'missing':[{'kind':'validation'}]}
   if url.endswith('/api/attempt'):return {}
   if url.endswith('/api/run'):runs.append(payload);return {'summary':{'status':'logicReviewHeld'}}
   raise AssertionError('Unexpected API')
  def quote(item):
   if item[1]=='NVDA':raise RuntimeError('Insufficient history')
   return item[1],[{'time':i} for i in range(500)],{'price':100},{'title':item[1]}
  def fundamentals(symbols,known=None):
   self.assertTrue(runs,'Held risk must be submitted before fundamentals')
   self.assertEqual(symbols,['MSFT']);return {}
  config={'market':'asia','reviewStartedAt':int(stamp*1000)-run_autonomy.REVIEW_WINDOW_MS,'reviewDeadline':int(stamp*1000)};output=io.StringIO()
  with patch.object(run_autonomy.time,'time',return_value=stamp),patch.object(run_autonomy,'get_json',side_effect=get),patch.object(collect_prices,'collect_one',side_effect=quote),patch.object(collect_prices,'yahoo',return_value={'meta':{'regularMarketPrice':1}}),patch.object(run_autonomy,'collect_fundamentals',side_effect=fundamentals),patch.object(logic_review,'invoke_reviewer',side_effect=AssertionError('Expired review must hold')),contextlib.redirect_stdout(output):
   run_autonomy.run_session(config,'https://example.com',{})
  self.assertTrue(runs);self.assertNotIn('research',runs[0]);self.assertNotIn('reviewProof',runs[0])
  self.assertEqual(runs[0]['marketSnapshot']['activeSymbols'],['MSFT'])
  self.assertEqual({f['symbol'] for f in runs[0]['marketSnapshot']['failures']},{'NVDA','053610'})

 def test_all_theme_candidates_are_collected_once_before_the_shared_review_clock_starts(self):
  start=run_autonomy.datetime.datetime.fromisoformat('2026-10-08T08:00:00+09:00').timestamp();clock=[start]
  session={'market':'asia','phase':'pre','date':'2026-10-08','key':'asia:2026-10-08:pre'}
  research={'investmentIdeas':[{'candidates':[{'symbol':'NVDA'},{'symbol':'AOS'}]},{'candidates':[{'symbol':'005930'},{'symbol':'NVDA'}]}]}
  current={'revision':1,'logicReview':REVIEW_CONTEXT,'assetAllocation':{'state':None},'metadata':{},'activeSymbols':['MSFT'],'holdings':[{'symbol':'MSFT'}],'lastResearch':research}
  prices=[];financials=[];seen=[];calls=[]
  def get(url,headers=None,payload=None):
   calls.append((url,payload))
   if '/api/session?' in url:return session
   if url.endswith('/api/context'):return current.copy()
   if url.endswith('/api/research-check'):return {'complete':True}
   if url.endswith('/api/market-reports'):return {'revision':1}
   if url.endswith('/api/universe'):return {'revision':1}
   if url.endswith('/api/allocation'):return {'revision':1,'summary':[]}
   if url.endswith('/api/run'):
    current['metadata']={'lastSession':session};return {'summary':{'status':'complete'}}
   raise AssertionError('Unexpected API')
  def collect(symbols,required_symbols=None):
   self.assertEqual(required_symbols,['MSFT','TSLA'])
   prices.append(symbols);clock[0]+=20*60
   return {'activeSymbols':symbols,'quotes':{}}
  def fundamentals(symbols,known=None):financials.append(symbols);clock[0]+=2*60;return {}
  def bonds(*args):clock[0]+=2*60;return {'snapshots':[{}],'failures':[]}
  def review(value):seen.append((value['scope'],value['deadline'],clock[0]*1000));return approve_fixture(value)
  config={'market':'asia','symbols':['TSLA']};output=io.StringIO()
  with patch.object(run_autonomy.time,'time',side_effect=lambda:clock[0]),patch.object(run_autonomy,'get_json',side_effect=get),patch.object(run_autonomy,'collect',side_effect=collect),patch.object(run_autonomy,'collect_fundamentals',side_effect=fundamentals),patch.object(run_autonomy,'collect_bonds',side_effect=bonds),patch.object(logic_review,'invoke_reviewer',side_effect=review),contextlib.redirect_stdout(output):
   run_autonomy.run_session(config,'https://example.com',{})
  self.assertEqual(len(prices),1,'The initial risk check and later review must reuse the same collection')
  self.assertEqual(set(prices[0]),{'MSFT','TSLA','NVDA','AOS','005930'})
  self.assertEqual(financials,prices)
  self.assertEqual([scope for scope,_,_ in seen],['/api/allocation','/api/run'])
  self.assertTrue(all(deadline==now+run_autonomy.REVIEW_WINDOW_MS for _,deadline,now in seen),'Collection must not consume review time')
  result=json.loads(output.getvalue());self.assertEqual(result['reviewWindow'],{'reviewStartedAt':int(clock[0]*1000),'reviewDeadline':int(clock[0]*1000)+run_autonomy.REVIEW_WINDOW_MS})

 def test_retries_preserve_an_expired_review_window_and_keep_risk_only(self):
  stamp=run_autonomy.datetime.datetime.fromisoformat('2026-10-08T16:00:00+09:00').timestamp()
  session={'market':'asia','phase':'close','date':'2026-10-08','key':'asia:2026-10-08:close'}
  current={'revision':1,'logicReview':REVIEW_CONTEXT,'metadata':{},'activeSymbols':['005930'],'holdings':[]};runs=[]
  def get(url,headers=None,payload=None):
   if '/api/session?' in url:return session
   if url.endswith('/api/context'):return {**current,'metadata':{'lastSession':session}}
   if url.endswith('/api/run'):runs.append(payload);return {'summary':{'status':'logicReviewHeld'}}
   raise AssertionError('Unexpected API')
  window={'reviewStartedAt':int(stamp*1000)-run_autonomy.REVIEW_WINDOW_MS,'reviewDeadline':int(stamp*1000)}
  config={'market':'asia','reviewWindow':window};output=io.StringIO()
  with patch.object(run_autonomy.time,'time',return_value=stamp),patch.object(run_autonomy,'get_json',side_effect=get),patch.object(run_autonomy,'collect',return_value={'quotes':{}}),patch.object(logic_review,'invoke_reviewer',side_effect=AssertionError('Retry must not restart the review clock')),contextlib.redirect_stdout(output):
   run_autonomy.run_session(config,'https://example.com',{})
  self.assertEqual(json.loads(output.getvalue())['reviewWindow'],window)
  self.assertTrue(runs);self.assertTrue(all('reviewProof' not in p for p in runs))
 def test_etf_and_stock_reviews_share_the_earlier_market_phase_end(self):
  stamp=run_autonomy.datetime.datetime.fromisoformat('2026-10-08T08:55:00+09:00').timestamp()
  end=run_autonomy.datetime.datetime.fromisoformat('2026-10-08T09:00:00+09:00').timestamp()*1000
  session={'market':'asia','phase':'pre','date':'2026-10-08','key':'asia:2026-10-08:pre'};seen=[];stock_risk=[]
  current={'revision':1,'logicReview':REVIEW_CONTEXT,'assetAllocation':{'state':None},'metadata':{},'activeSymbols':['005930'],'holdings':[{'symbol':'005930'}]}
  def get(url,headers=None,payload=None):
   if '/api/session?' in url:return session
   if url.endswith('/api/context'):return current.copy()
   if url.endswith('/api/research-check'):return {'complete':True}
   if url.endswith('/api/market-reports'):return {'revision':1}
   if url.endswith('/api/allocation'):return {'revision':1,'summary':[]}
   if url.endswith('/api/run'):
    if not payload.get('reviewProof'):stock_risk.append(payload)
    current['metadata']={'lastSession':session};return {'summary':{'status':'complete'}}
   raise AssertionError('Unexpected API')
  def review(config):
   self.assertTrue(stock_risk,'Existing stock risk must run before either model')
   self.assertNotIn('research',stock_risk[0]);self.assertNotIn('reviewProof',stock_risk[0])
   seen.append((config['scope'],config['deadline']));return approve_fixture(config)
  config={'market':'asia','reviewStartedAt':stamp*1000,'reviewDeadline':stamp*1000+run_autonomy.REVIEW_WINDOW_MS}
  with patch.object(run_autonomy.time,'time',return_value=stamp),patch.object(run_autonomy,'get_json',side_effect=get),patch.object(run_autonomy,'collect_bonds',return_value={'snapshots':[{}],'failures':[]}),patch.object(run_autonomy,'collect',return_value={'quotes':{}}),patch.object(run_autonomy,'collect_fundamentals',return_value={}),patch.object(logic_review,'invoke_reviewer',side_effect=review),contextlib.redirect_stdout(io.StringIO()):
   run_autonomy.run_session(config,'https://example.com',{})
  self.assertEqual(seen,[('/api/allocation',end),('/api/run',end)])
 def test_allocation_conflict_or_readback_failure_does_not_stop_stock_risk_submission(self):
  import urllib.error
  stamp=run_autonomy.datetime.datetime.fromisoformat('2026-10-08T16:00:00+09:00').timestamp()
  session={'market':'asia','phase':'close','date':'2026-10-08','key':'asia:2026-10-08:close'}
  for failure in ['conflict','readback']:
   calls=[];current={'revision':2,'logicReview':REVIEW_CONTEXT,'assetAllocation':{'state':None},'metadata':{},'activeSymbols':['005930'],'holdings':[{'symbol':'005930'}]}
   def get(url,headers=None,payload=None):
    calls.append((url,payload))
    if '/api/session?' in url:return session
    if url.endswith('/api/context'):return {**current,'metadata':{'lastSession':session}}
    if url.endswith('/api/allocation'):
     if failure=='conflict':raise urllib.error.HTTPError(url,409,'Conflict',{},None)
     return {'revision':1,'summary':[]}
    if url.endswith('/api/run'):return {'summary':{'status':'logicReviewHeld'}}
    raise AssertionError('Unexpected API')
   config={'market':'asia','reviewStartedAt':stamp*1000,'reviewDeadline':stamp*1000+run_autonomy.REVIEW_WINDOW_MS}
   with patch.object(run_autonomy.time,'time',return_value=stamp),patch.object(run_autonomy,'get_json',side_effect=get),patch.object(run_autonomy,'collect_bonds',return_value={'snapshots':[{}],'failures':[]}),patch.object(run_autonomy,'collect',return_value={'quotes':{}}),patch.object(logic_review,'invoke_reviewer',return_value={'approved':False}),contextlib.redirect_stdout(io.StringIO()):
    run_autonomy.run_session(config,'https://example.com',{})
   stock=[body for url,body in calls if url.endswith('/api/run')]
   self.assertTrue(stock);self.assertNotIn('research',stock[0]);self.assertNotIn('reviewProof',stock[0])

 def test_us_friday_close_runs_on_seoul_saturday_without_new_research(self):
  calls=[];session={'market':'us','phase':'close','date':'2026-10-09','key':'us:2026-10-09:close'}
  current={'revision':1,'logicReview':REVIEW_CONTEXT,'metadata':{'sessionMode':True},'activeSymbols':['MSFT'],'holdings':[]}
  def get(url,headers=None,payload=None):
   calls.append((url.rsplit('/',1)[-1],payload))
   if '/session?' in url:return session
   if url.endswith('/context'):return {**current,'metadata':{**current['metadata'],**({'lastSession':session} if any(r=='run' for r,_ in calls) else {})}}
   if url.endswith('/run'):return {'summary':{'status':'complete','approved':0}}
   raise AssertionError('Close must not collect reports or research')
  output=io.StringIO();stamp=run_autonomy.datetime.datetime.fromisoformat('2026-10-10T05:30:00+09:00').timestamp()
  config={'site_url':'https://example.com','token':'secret-token','market':'us','phase':'auto','reviewStartedAt':stamp*1000,'reviewDeadline':stamp*1000+run_autonomy.REVIEW_WINDOW_MS}
  with patch.object(run_autonomy.time,'time',return_value=stamp),patch.object(run_autonomy,'get_json',side_effect=get),patch.object(run_autonomy,'collect',return_value={'quotes':{}}),patch.object(run_autonomy,'collect_fundamentals',side_effect=AssertionError('Close must not collect fundamentals')),patch.object(sys,'stdin',io.StringIO(json.dumps(config))),patch.object(sys,'argv',['run_autonomy.py']),contextlib.redirect_stdout(output):run_autonomy.main()
  result=json.loads(output.getvalue());self.assertTrue(result.get('verified'));self.assertEqual(result.get('phase'),'close');self.assertTrue(any(route=='run' for route,_ in calls));self.assertNotIn('secret-token',output.getvalue())




class CloudRetryTest(unittest.TestCase):
 def test_execution_window_accounts_for_bond_collection_and_a_long_etf_review(self):
  for phase,hour,review_minutes in [('open',9,21),('close',16,21),('close',16,23)]:
   with self.subTest(phase=phase,review_minutes=review_minutes):
    start=run_autonomy.datetime.datetime.fromisoformat(f'2026-10-08T{hour:02}:20:00+09:00').timestamp();clock=[start];queues=[];runs=[]
    session={'market':'asia','phase':phase,'date':'2026-10-08','key':f'asia:2026-10-08:{phase}'}
    current={'revision':1,'logicReview':{**REVIEW_CONTEXT,'cloudConfigured':True},'metadata':{},'assetAllocation':{'state':{'positions':{'SGOV':{'pending':{'side':'buy' if phase=='close' else 'sell','riskExit':False}}}}},'plans':[{'id':'entry','symbol':'005930','status':'승인','side':'buy','riskExit':False}],'activeSymbols':['005930'],'holdings':[]}
    def get(url,headers=None,payload=None):
     if '/api/session?' in url:return session
     if url.endswith('/api/context'):return current.copy()
     if url.endswith('/api/logic-review'):
      queues.append(payload.copy())
      if payload['scope']=='/api/allocation':clock[0]+=review_minutes*60
      return {'id':payload['scope'].rsplit('/',1)[-1],'windowId':'window','round':len(queues),'status':'approved','reviewProof':{'expiresAt':int(clock[0]*1000)+10000}}
     if url.endswith('/api/allocation'):return {'revision':1,'summary':[],'logicReview':{'approved':bool(payload.get('reviewProof'))}}
     if url.endswith('/api/run'):
      runs.append(payload);approved=bool(payload.get('reviewProof'))
      if approved:current['metadata']={'lastSession':session}
      return {'revision':1,'summary':{'status':'complete' if approved else 'logicReviewHeld','session':session},'logicReview':{'approved':approved}}
     raise AssertionError('Unexpected API: '+url)
    def bonds(*args):
     clock[0]+=8*60
     return {'snapshots':[{'fetchedAt':run_autonomy.datetime.datetime.fromtimestamp(clock[0],run_autonomy.datetime.timezone.utc).isoformat()}],'failures':[]}
    snapshot={'fetchedAt':run_autonomy.datetime.datetime.fromtimestamp(start,run_autonomy.datetime.timezone.utc).replace(microsecond=123456).isoformat(),'quotes':{}}
    config={'market':'asia'};output=io.StringIO()
    with patch.object(run_autonomy.time,'time',side_effect=lambda:clock[0]),patch.object(run_autonomy,'get_json',side_effect=get),patch.object(run_autonomy,'collect',return_value=snapshot),patch.object(run_autonomy,'collect_bonds',side_effect=bonds),contextlib.redirect_stdout(output):
     run_autonomy.run_session(config,'https://example.com',{})
    saved=json.loads(output.getvalue());self.assertEqual(saved['verified'],review_minutes==21)
    self.assertEqual(saved['reviewWindow']['reviewStartedAt'],int((start+8*60)*1000))
    self.assertEqual(saved['reviewWindow']['reviewDeadline'],int((start+30*60)*1000)+123)
    self.assertEqual([q['scope'] for q in queues],['/api/allocation','/api/run'] if review_minutes==21 else ['/api/allocation'])
    self.assertTrue(all(q['reviewDeadline']==int((start+30*60)*1000)+123 for q in queues))
    self.assertEqual(clock[0],start+(8+review_minutes)*60)
    self.assertEqual(len(runs),2 if review_minutes==21 else 1);self.assertNotIn('reviewProof',runs[0])
    if review_minutes==21:self.assertIn('reviewProof',runs[1])
    else:
     self.assertEqual(saved['status'],'logicReviewHeld');self.assertEqual(saved['logicReview']['reason'],'reviewDeadlineHeld');self.assertTrue(saved['riskMonitoringVerified'])

 def test_expired_retry_input_is_held_without_attempting_risk_or_review(self):
  import urllib.error
  def get(url,headers=None,payload=None):
   self.assertTrue(url.endswith('/original-job/input'))
   raise urllib.error.HTTPError(url,409,'Expired',{},io.BytesIO(b'{"reason":"reviewCannotBeRetried"}'))
  output=io.StringIO();config={'site_url':'https://example.com','token':'secret-token','reviewJobId':'original-job'}
  with patch.object(run_autonomy,'get_json',side_effect=get),patch.object(sys,'stdin',io.StringIO(json.dumps(config))),patch.object(sys,'argv',['run_autonomy.py']),contextlib.redirect_stdout(output):result=run_autonomy.main()
  saved=json.loads(output.getvalue());self.assertEqual(result,2);self.assertEqual(saved['logicReview']['reason'],'reviewCannotBeRetried');self.assertEqual(saved['logicReview']['jobId'],'original-job');self.assertFalse(saved['riskMonitoringVerified'])
 def test_same_window_retry_skips_risk_and_price_collection_and_returns_held_on_final_conflict(self):
  import urllib.error
  stamp=run_autonomy.datetime.datetime.fromisoformat('2026-10-08T08:40:00+09:00').timestamp()
  started=int(stamp*1000)-26*60000
  candidate={'market':'asia','phase':'pre','marketSnapshot':{'fetchedAt':'old-collection'},'research':{'decision':'original'},'expectedRevision':1}
  ctx={'revision':3,'logicReview':{**REVIEW_CONTEXT,'cloudConfigured':True},'metadata':{}}
  for status in (400,409):
   calls=[];output=io.StringIO()
   def get(url,headers=None,payload=None):
    calls.append((url,payload))
    if url.endswith('/api/logic-review/original-job/input'):return {'scope':'/api/run','candidate':candidate.copy(),'windowId':'window','reviewStartedAt':started,'reviewDeadline':started+run_autonomy.REVIEW_WINDOW_MS}
    if url.endswith('/api/context'):return ctx
    if url.endswith('/api/logic-review'):
     self.assertEqual(payload['candidate']['expectedRevision'],3);self.assertEqual(payload['previousJobId'],'original-job');self.assertEqual(payload['reviewStartedAt'],started)
     return {'id':'new-job','windowId':'window','round':2,'status':'approved','reviewProof':{'expiresAt':int(stamp*1000)+10000}}
    if url.endswith('/api/run'):
     self.assertIn('reviewProof',payload,'Retry must not submit old risk prices')
     raise urllib.error.HTTPError(url,status,'Declined',{},None)
    raise AssertionError('Unexpected API')
   config={'site_url':'https://example.com','token':'secret-token','reviewJobId':'original-job','research':{'decision':'repaired'}}
   with patch.object(run_autonomy.time,'time',return_value=stamp),patch.object(run_autonomy,'get_json',side_effect=get),patch.object(run_autonomy,'collect',side_effect=AssertionError('Do not recollect')),patch.object(sys,'stdin',io.StringIO(json.dumps(config))),patch.object(sys,'argv',['run_autonomy.py']),contextlib.redirect_stdout(output):
    result=run_autonomy.main()
   saved=json.loads(output.getvalue());self.assertEqual(result,2);self.assertEqual(saved['status'],'logicReviewHeld');self.assertEqual(saved['logicReview']['jobId'],'new-job');self.assertEqual(saved['logicReview']['scope'],'/api/run');self.assertFalse(saved['riskMonitoringVerified']);self.assertEqual(saved['reviewWindow']['reviewStartedAt'],started)
   self.assertFalse(any(url.endswith('/api/attempt') for url,_ in calls));self.assertNotIn('secret-token',output.getvalue())

 def test_lengthy_etf_review_reuses_initial_stock_risk_result_and_validates_cloud_research_at_final_submit(self):
  start=run_autonomy.datetime.datetime.fromisoformat('2026-10-08T08:00:00+09:00').timestamp();clock=[start];calls=[]
  session={'market':'asia','phase':'pre','date':'2026-10-08','key':'asia:2026-10-08:pre'}
  ctx={'revision':1,'logicReview':{**REVIEW_CONTEXT,'cloudConfigured':True},'metadata':{},'assetAllocation':{'state':None},'activeSymbols':['005930'],'holdings':[]}
  def get(url,headers=None,payload=None):
   calls.append((url,payload))
   if '/api/session?' in url:return session
   if url.endswith('/api/context'):return {**ctx,'metadata':{'lastSession':session}}
   if url.endswith('/api/market-reports'):return {'revision':1}
   if url.endswith('/api/research-check'):
    self.assertNotIn('marketSnapshot',payload);return {'complete':True}
   if url.endswith('/api/logic-review'):
    if payload['scope']=='/api/allocation':clock[0]+=26*60
    return {'id':payload['scope'].rsplit('/',1)[-1],'windowId':'window','round':1,'status':'approved','reviewProof':{'expiresAt':int(clock[0]*1000)+10000}}
   if url.endswith('/api/allocation'):return {'revision':1,'summary':[],'logicReview':{'approved':bool(payload.get('reviewProof'))}}
   if url.endswith('/api/run'):
    if not payload.get('reviewProof'):self.assertEqual(clock[0],start,'Stock risk must run before collection/review latency')
    return {'revision':1,'summary':{'status':'complete' if payload.get('reviewProof') else 'logicReviewHeld','session':session,'logicReview':{'approved':bool(payload.get('reviewProof'))}}}
   raise AssertionError('Cloud preflight must not resubmit stale prices: '+url)
  def fundamentals(*args):clock[0]+=4*60;return {}
  def bonds(*args):clock[0]+=4*60;return {'snapshots':[{}],'failures':[]}
  config={'market':'asia','research':{},'symbols':['000660']};output=io.StringIO()
  with patch.object(run_autonomy.time,'time',side_effect=lambda:clock[0]),patch.object(run_autonomy,'get_json',side_effect=get),patch.object(run_autonomy,'collect',return_value={'quotes':{}}),patch.object(run_autonomy,'collect_fundamentals',side_effect=fundamentals),patch.object(run_autonomy,'collect_bonds',side_effect=bonds),contextlib.redirect_stdout(output):
   run_autonomy.run_session(config,'https://example.com',{})
  runs=[body for url,body in calls if url.endswith('/api/run')];self.assertEqual(len(runs),2);self.assertNotIn('reviewProof',runs[0]);self.assertIn('reviewProof',runs[1]);self.assertEqual(json.loads(output.getvalue())['logicReview']['approved'],True)
  self.assertEqual(config['reviewWindow']['reviewStartedAt'],int((start+8*60)*1000))

class BondOnlyCollectorTest(unittest.TestCase):
 def test_default_collection_excludes_retired_etfs_but_existing_holdings_are_collected_for_exit(self):
  import collect_prices
  with patch.object(collect_prices,'collect_one',side_effect=RuntimeError('Offline')) as collect:
   result=collect_prices.collect_bonds()
   self.assertEqual(len(result['failures']),10)
   self.assertTrue({'TLTW','JEPI','JEPQ'}.isdisjoint(f['symbol'] for f in result['failures']))
   held=collect_prices.collect_bonds(['미국'],['JEPQ'])
   self.assertEqual({f['symbol'] for f in held['failures']},{'SGOV','IEF','TLT','LQD','HYG','JEPQ'})

class RepairWiringTest(unittest.TestCase):
 def test_only_pre_market_cloud_reviews_receive_the_repair_callback(self):
  for phase in ['pre','open']:
   with self.subTest(phase=phase):
    session={'market':'us','phase':phase,'date':'2026-10-26','zone':'America/New_York','key':'us:2026-10-26:'+phase}
    current={'revision':1,'logicReview':{**REVIEW_CONTEXT,'cloudConfigured':True},'metadata':{},'assetAllocation':{'state':None},'activeSymbols':['MSFT'],'holdings':[]}
    seen=[];marker=object()
    def get(url,headers=None,payload=None):
     if '/api/session?' in url:return session
     if url.endswith('/api/context'):return current.copy()
     if url.endswith('/api/market-reports'):return {'revision':1,'marketReports':None}
     if url.endswith('/api/run'):return {'revision':1,'summary':{'status':'logicReviewHeld'}}
     if url.endswith('/api/research-check'):return {'complete':True,'missing':[],'readyUnitIds':['u']}
     raise AssertionError(url)
    def submit(origin,headers,path,payload,current,config,request=None,**kwargs):
     seen.append((path,kwargs.get('repair')));raise RuntimeError('stop')
    config={'market':'us','_repair':marker}
    with patch.object(run_autonomy,'get_json',side_effect=get),patch.object(run_autonomy,'collect',return_value={'fetchedAt':'2026-10-26T12:30:00+00:00','quotes':{}}),patch.object(run_autonomy,'collect_fundamentals',return_value={}),patch.object(run_autonomy,'collect_bonds',return_value={'snapshots':[{'fetchedAt':'2026-10-26T12:30:00+00:00'}],'failures':[]}),patch.object(run_autonomy,'reviewed_submit',side_effect=submit),contextlib.redirect_stdout(io.StringIO()):
     with self.assertRaises(RuntimeError):run_autonomy.run_session(config,'https://example.com',{})
    self.assertEqual([p for p,_ in seen],['/api/allocation','/api/run']);self.assertTrue(all(r is (marker if phase=='pre' else None) for _,r in seen))

class ResearchRepairTest(unittest.TestCase):
 def test_repair_bridge_needs_the_research_work_dir_and_reports_the_cli_result_without_raising(self):
  import tempfile,time as clock
  payload={'scope':'/api/run','submitted':{'investmentIdeas':[]},'issues':['x'],'summary':'','deadline':int(clock.time()*1000)+60000}
  with tempfile.TemporaryDirectory() as tmp:
   self.assertEqual(run_autonomy.research_repair(payload,pathlib.Path(tmp)),{'error':'repairWorkDirMissing'})
   (pathlib.Path(tmp)/'context.json').write_text('{}')
   with patch.dict(run_autonomy.os.environ,{'CLAUDE_CODE_OAUTH_TOKEN':''}):
    self.assertEqual(run_autonomy.research_repair(payload,pathlib.Path(tmp)),{'error':'repairAuthenticationUnavailable'})
   with patch.object(run_autonomy.subprocess,'run',side_effect=OSError('node missing')):
    self.assertEqual(run_autonomy.research_repair(payload,pathlib.Path(tmp)),{'error':'repairUnavailable'})

if __name__=='__main__':unittest.main()
