import io,pathlib,sys,unittest,zipfile
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'web'))
import collect_factors

DAILY="""This file was created using the 202609 Bloomberg database.
Missing data are indicated by -99.99.

,Mkt-RF,SMB,HML,RF
20260928    ,1.00   ,-99.99 ,0.10  ,0.01
20260929   ,-0.79    ,0.08   ,-0.97    ,0.01
20260930    ,1.52   ,-0.95    ,0.18    ,0.01

 Copyright 2026 Eugene F. Fama and Kenneth R. French
,Mkt-RF,SMB,HML,RF
20261001    ,9.0 ,9.0 ,9.0 ,9.0
"""
class CollectFactorsTest(unittest.TestCase):
 def test_daily_parse_keeps_first_block_skips_missing_and_maps_columns_by_header(self):
  self.assertEqual(collect_factors.parse(DAILY,'daily',600),[[20260929,-0.79,0.08,-0.97,0.01],[20260930,1.52,-0.95,0.18,0.01]])
 def test_only_us_and_japan_are_collected(self):
  self.assertEqual(list(collect_factors.FILES),['us','japan'])
 def test_a_failed_region_is_omitted_and_no_data_returns_none(self):
  def archive(text):
   buffer=io.BytesIO()
   with zipfile.ZipFile(buffer,'w') as z:z.writestr('x.csv',text)
   return buffer.getvalue()
  def get(url):
   if 'Japan' in url:return archive(DAILY)
   raise OSError('offline')
  out=collect_factors.collect_factors(get)
  self.assertEqual(list(out),['japan']);self.assertEqual(out['japan']['source'],collect_factors.SOURCE+'Japan_3_Factors_Daily_CSV.zip')
  self.assertIsNone(collect_factors.collect_factors(lambda url:(_ for _ in ()).throw(OSError('offline'))))

if __name__=='__main__':unittest.main()
