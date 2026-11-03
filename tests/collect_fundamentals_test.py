import datetime,unittest,sys,pathlib
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'web'))
import collect_fundamentals

class RecheckTest(unittest.TestCase):
 def test_only_unknown_or_week_old_symbols_hit_yahoo(self):
  now=datetime.datetime.now(datetime.timezone.utc)
  known={'005930':(now-datetime.timedelta(days=2)).isoformat(),'000660':(now-datetime.timedelta(days=8)).isoformat(),'AAPL':'not a date'}
  asked=[]
  def one(item):asked.append(item[1]);return item[1],{'status':'collected'}
  with patch.object(collect_fundamentals,'one',side_effect=one):
   result=collect_fundamentals.collect_fundamentals(['005930','000660','AAPL','MSFT'],known)
  # Two pool workers call Yahoo concurrently, so call order is not fixed.
  self.assertCountEqual(asked,['000660','AAPL','MSFT'])
  self.assertEqual(set(result),{'000660','AAPL','MSFT'})
  with patch.object(collect_fundamentals,'one',side_effect=one):
   collect_fundamentals.collect_fundamentals(['005930'])
  self.assertEqual(asked[-1],'005930')

if __name__=='__main__':unittest.main()
