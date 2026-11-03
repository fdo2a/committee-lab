import datetime
import pathlib
import sys
import unittest

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'web'))
import collect_prices

def stamp(text):return int(datetime.datetime.fromisoformat(text).timestamp())
def chart(days,timezone='America/New_York',latest_time=None,delay=15):
 periods=[{'start':stamp(day[0]),'end':stamp(day[1])} for day in days]
 return {'meta':{'exchangeTimezoneName':timezone,'exchangeDataDelayedBy':delay,'regularMarketTime':latest_time or periods[-1]['end'],'currentTradingPeriod':{'regular':periods[-1]},'tradingPeriods':[[p] for p in periods]},'timestamp':[p['start'] for p in periods],'indicators':{'quote':[{'open':[100+i for i in range(len(days))],'close':[102+i for i in range(len(days))],'high':[105+i for i in range(len(days))],'low':[99+i for i in range(len(days))],'volume':[1000]*len(days)}]}}
class RegularSessionCollectorTest(unittest.TestCase):
 def sessions(self,daily,periods,now):
  self.assertTrue(callable(getattr(collect_prices,'regular_sessions',None)))
  return collect_prices.regular_sessions(daily,periods,stamp(now))
 def test_midday_daily_close_is_provisional_but_open_is_available(self):
  c=chart([('2026-10-05T09:30:00-04:00','2026-10-05T16:00:00-04:00')],latest_time=stamp('2026-10-05T12:00:00-04:00'))
  sessions=self.sessions(c,c,'2026-10-05T12:30:00-04:00');self.assertEqual(len(sessions),1);self.assertEqual(sessions[0]['open'],100);self.assertIsNone(sessions[0]['close']);self.assertFalse(sessions[0]['complete']);self.assertEqual(sessions[0]['closeTime'],stamp('2026-10-05T16:00:00-04:00'))
 def test_close_remains_provisional_through_provider_delay(self):
  c=chart([('2026-10-05T09:30:00-04:00','2026-10-05T16:00:00-04:00')],delay=20)
  self.assertFalse(self.sessions(c,c,'2026-10-05T16:19:59-04:00')[0]['complete']);self.assertTrue(self.sessions(c,c,'2026-10-05T16:20:00-04:00')[0]['complete'])
 def test_us_dst_uses_each_provided_start_end_and_exchange_date(self):
  c=chart([('2026-03-06T09:30:00-05:00','2026-03-06T16:00:00-05:00'),('2026-03-09T09:30:00-04:00','2026-03-09T16:00:00-04:00')])
  sessions=self.sessions(c,c,'2026-03-10T01:00:00+00:00');self.assertEqual([s['date'] for s in sessions],['2026-03-06','2026-03-09']);self.assertEqual([datetime.datetime.fromtimestamp(s['openTime'],datetime.timezone.utc).hour for s in sessions],[14,13]);self.assertTrue(all(s['complete'] for s in sessions))
 def test_provider_half_day_end_is_honored_without_inventing_sixteen_hundred(self):
  c=chart([('2026-11-27T09:30:00-05:00','2026-11-27T13:00:00-05:00')])
  s=self.sessions(c,c,'2026-11-27T13:20:00-05:00')[0];self.assertEqual(s['closeTime'],stamp('2026-11-27T13:00:00-05:00'));self.assertEqual(s['close'],102);self.assertTrue(s['complete'])
 def test_historical_sessions_require_provided_periods_and_no_more_than_last_five(self):
  days=[(f'2026-10-{d:02d}T09:30:00-04:00',f'2026-10-{d:02d}T16:00:00-04:00') for d in [1,2,5,6,7,8]];c=chart(days);c['meta'].pop('tradingPeriods');metadata=chart(days[2:])
  sessions=self.sessions(c,metadata,'2026-10-09T12:00:00-04:00');self.assertEqual([s['date'] for s in sessions],['2026-10-05','2026-10-06','2026-10-07','2026-10-08']);self.assertTrue(all(s['complete'] for s in sessions));self.assertEqual(len(self.sessions(c,chart(days),'2026-10-09T12:00:00-04:00')),5)
 def test_future_session_missing_timezone_or_missing_periods_cannot_manufacture_events(self):
  c=chart([('2026-10-05T09:30:00-04:00','2026-10-05T16:00:00-04:00')]);self.assertEqual(self.sessions(c,c,'2026-10-05T08:00:00-04:00'),[])
  no_period={**c,'meta':{'exchangeTimezoneName':'America/New_York'}};self.assertEqual(self.sessions(no_period,no_period,'2026-10-05T17:00:00-04:00'),[])
  c['meta'].pop('exchangeTimezoneName');self.assertEqual(self.sessions(c,c,'2026-10-05T17:00:00-04:00'),[])
 def test_null_provider_period_metadata_fails_closed_without_losing_daily_prices(self):
  c=chart([('2026-10-05T09:30:00-04:00','2026-10-05T16:00:00-04:00')]);c['meta']['currentTradingPeriod']=None;c['meta']['tradingPeriods']=None
  self.assertEqual(self.sessions(c,{'meta':None},'2026-10-05T17:00:00-04:00'),[])
 def test_contradictory_korean_end_requires_latest_daily_auction_timestamp(self):
  c=chart([('2026-10-02T09:00:00+09:00','2026-10-02T15:00:00+09:00')],timezone='Asia/Seoul',latest_time=stamp('2026-10-02T15:30:21+09:00'))
  s=self.sessions(c,c,'2026-10-02T16:00:00+09:00')[0];self.assertEqual(s['closeTime'],stamp('2026-10-02T15:30:21+09:00'));self.assertEqual(s['close'],102);self.assertTrue(s['complete'])
  self.assertFalse(self.sessions(c,c,'2026-10-02T15:40:00+09:00')[0]['complete'])
  c['meta']['regularMarketTime']=stamp('2026-10-02T15:20:00+09:00');self.assertFalse(self.sessions(c,c,'2026-10-02T16:00:00+09:00')[0]['complete'])
 def test_korean_historical_fifteen_hundred_period_never_invents_a_closing_auction(self):
  c=chart([('2026-10-01T09:00:00+09:00','2026-10-01T15:00:00+09:00'),('2026-10-02T09:00:00+09:00','2026-10-02T15:00:00+09:00')],timezone='Asia/Seoul',latest_time=stamp('2026-10-02T15:30:21+09:00'))
  sessions=self.sessions(c,c,'2026-10-02T16:00:00+09:00');self.assertIsNone(sessions[0]['close']);self.assertFalse(sessions[0]['complete']);self.assertTrue(sessions[1]['complete'])

if __name__=='__main__':unittest.main()

class CredentialRedirectTest(unittest.TestCase):
 def _serve(self):
  import http.server,threading
  class Handler(http.server.BaseHTTPRequestHandler):
   def do_GET(self):
    if self.path=='/target':body=b'{"ok":true}';self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    else:self.send_response(302);self.send_header('Location','/target');self.send_header('Content-Length','0');self.end_headers()
   def log_message(self,*args):pass
  server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
  self.addCleanup(server.shutdown);return 'http://127.0.0.1:%d/start'%server.server_address[1]
 def test_access_service_token_refuses_redirect_like_sites_bearer(self):
  url=self._serve()
  for headers in [{'OAI-Sites-Authorization':'Bearer secret'},{'CF-Access-Client-Id':'id.access','CF-Access-Client-Secret':'secret'}]:
   with self.assertRaises(collect_prices.urllib.error.HTTPError) as caught:collect_prices.get_json(url,headers)
   self.assertEqual(caught.exception.code,302)
  self.assertEqual(collect_prices.get_json(url),{'ok':True})
 def test_service_headers_pick_one_credential(self):
  self.assertEqual(collect_prices.service_headers({'token':'t'}),{'OAI-Sites-Authorization':'Bearer t'})
  self.assertEqual(collect_prices.service_headers({'access_client_id':'id.access','access_client_secret':'s','token':'ignored'}),{'CF-Access-Client-Id':'id.access','CF-Access-Client-Secret':'s'})
class SiteRetryTest(unittest.TestCase):
 def test_credentialed_get_retries_503_but_posts_and_public_reads_do_not(self):
  from unittest.mock import patch
  err=lambda code:collect_prices.urllib.error.HTTPError('https://lab.example/api/context',code,'busy',{},None)
  headers={'CF-Access-Client-Id':'id','CF-Access-Client-Secret':'s'}
  with patch.object(collect_prices,'_get_json',side_effect=[err(503),err(503),{'ok':True}]) as call,patch.object(collect_prices.time,'sleep') as sleep:
   self.assertEqual(collect_prices.get_json('https://lab.example/api/context',headers),{'ok':True});self.assertEqual(call.call_count,3);self.assertEqual([c.args[0] for c in sleep.call_args_list],[15,30])
  with patch.object(collect_prices,'_get_json',side_effect=[err(503)]*3),patch.object(collect_prices.time,'sleep'):
   with self.assertRaises(collect_prices.urllib.error.HTTPError):collect_prices.get_json('https://lab.example/api/context',headers)
  for kwargs in [{'headers':headers,'payload':{'a':1}},{'headers':None}]:
   with patch.object(collect_prices,'_get_json',side_effect=[err(503),{'ok':True}]) as call,patch.object(collect_prices.time,'sleep') as sleep:
    with self.assertRaises(collect_prices.urllib.error.HTTPError):collect_prices.get_json('https://lab.example/api/context',**kwargs)
    self.assertEqual(call.call_count,1);sleep.assert_not_called()
  with patch.object(collect_prices,'_get_json',side_effect=[err(404)]),patch.object(collect_prices.time,'sleep') as sleep:
   with self.assertRaises(collect_prices.urllib.error.HTTPError):collect_prices.get_json('https://lab.example/api/context',headers)
   sleep.assert_not_called()
