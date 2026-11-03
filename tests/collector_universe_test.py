import pathlib,sys,unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'web'))
import collect_prices
import collect_fundamentals
import collect_factors
# collect() also fetches Fama-French factors; tests stay offline.
collect_factors.fetch=lambda url:(_ for _ in ()).throw(OSError('offline in tests'))

class ExpandedCollectorTest(unittest.TestCase):
 def test_kosdaq_price_collection_uses_registered_exchange_symbol(self):
  chart={'meta':{'currency':'KRW','regularMarketPrice':100,'regularMarketTime':1000},'timestamp':list(range(1,261)),'indicators':{'quote':{'open':[100]*260,'close':[100]*260,'high':[101]*260,'low':[99]*260,'volume':[1000]*260}}}
  chart['indicators']['quote']=[chart['indicators']['quote']]
  with patch.object(collect_prices,'get_json',return_value={'chart':{'result':[chart]}}) as fetch:
   symbol,bars,quote,source=collect_prices.collect_one(('한국','014680'))
  self.assertIn('/014680.KS?',fetch.call_args_list[0].args[0])
  self.assertEqual(symbol,'014680');self.assertEqual(len(bars),260)
  self.assertIn('014680.KS',source['url'])


class IndexSubsetCollectorTest(unittest.TestCase):
 def test_collector_rejects_nonindex_symbols_before_network_and_keeps_exact_subset(self):
  with patch.object(collect_prices,'yahoo',side_effect=AssertionError('No network for rejected selection')):
   with self.assertRaises(ValueError):collect_prices.collect(['053610'])
  self.assertEqual(collect_prices.selected_items(['005930','7203']),[('한국','005930'),('일본','7203')])

class PreparedSubsetCollectorTest(unittest.TestCase):
 def test_optional_candidate_failures_do_not_shorten_required_history(self):
  def quote(item):
   country,symbol=item
   if symbol=='NVDA':raise RuntimeError('Provider unavailable')
   size=260 if symbol=='AOS' else 500
   return symbol,[{'time':i} for i in range(size)],{'price':100},{'title':symbol}
  with patch.object(collect_prices,'collect_one',side_effect=quote),patch.object(collect_prices,'yahoo',return_value={'meta':{'regularMarketPrice':1}}):
   snapshot=collect_prices.collect(['MSFT','NVDA','AOS','053610','TSLA'],required_symbols=['MSFT'])
  self.assertEqual(snapshot['activeSymbols'],['MSFT','TSLA'])
  self.assertEqual(len(snapshot['data']['MSFT']),500)
  self.assertEqual(len(snapshot['data']['TSLA']),500)
  self.assertEqual({f['symbol'] for f in snapshot['failures']},{'NVDA','AOS','053610'})

 def test_required_failure_still_aborts_collection(self):
  with patch.object(collect_prices,'collect_one',side_effect=RuntimeError('Provider unavailable')),patch.object(collect_prices,'yahoo',side_effect=AssertionError('No FX after failure')):
   with self.assertRaises(RuntimeError):collect_prices.collect(['MSFT','NVDA'],required_symbols=['MSFT'])

 def test_candidate_below_260_bars_is_excluded_by_the_existing_minimum(self):
  def provider(symbol,**kwargs):
   if symbol in ['KRW=X','JPYKRW=X']:return {'meta':{'regularMarketPrice':1000 if symbol=='KRW=X' else 10}}
   size=259 if symbol=='NVDA' else 500
   return {'meta':{'currency':'USD','regularMarketPrice':100,'regularMarketTime':1000},'timestamp':list(range(1,size+1)),'indicators':{'quote':[{'open':[100]*size,'close':[100]*size,'high':[101]*size,'low':[99]*size,'volume':[1000]*size}]}}
  with patch.object(collect_prices,'yahoo',side_effect=provider):
   snapshot=collect_prices.collect(['MSFT','NVDA'],required_symbols=['MSFT'])
  self.assertEqual(snapshot['activeSymbols'],['MSFT'])
  self.assertEqual(len(snapshot['data']['MSFT']),500)
  self.assertEqual([f['symbol'] for f in snapshot['failures']],['NVDA'])

 def test_snapshot_and_financial_collection_share_exact_requested_symbols(self):
  bars=[{'open':100,'high':101,'low':99,'close':100,'volume':1000,'time':i} for i in range(260)]
  def quote(item):
   country,symbol=item
   return symbol,bars,{'price':100,'time':259,'currency':collect_prices.ELIGIBLE[symbol]['currency']},{'title':symbol,'url':'https://example.com/'+symbol}
  with patch.object(collect_prices,'collect_one',side_effect=quote),patch.object(collect_prices,'yahoo',return_value={'meta':{'regularMarketPrice':1}}):
   snapshot=collect_prices.collect(['005930','7203'])
  self.assertEqual(snapshot['activeSymbols'],['005930','7203'])
  self.assertEqual(list(snapshot['data']),['005930','7203'])
  self.assertEqual(list(snapshot['quotes']),['005930','7203'])
  with patch.object(collect_fundamentals,'one',side_effect=lambda item:(item[1],{'status':'unavailable'})):
   self.assertEqual(list(collect_fundamentals.collect_fundamentals(['005930','7203'])),['005930','7203'])
  with patch.object(collect_fundamentals,'one',side_effect=AssertionError('No network')):
   with self.assertRaises(ValueError):collect_fundamentals.collect_fundamentals(['053610'])

if __name__=='__main__':unittest.main()
