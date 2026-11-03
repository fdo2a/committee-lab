"""Unauthenticated Yahoo financial timeseries, retrieved in Python.
No paid provider, AI API, cookie bypass, or invented fallback data.
"""
import datetime,urllib.parse,concurrent.futures,math
from collect_prices import get_json,selected_items,yahoo_symbol
FIELDS={'revenue':'annualTotalRevenue','netIncome':'annualNetIncome','operatingCashFlow':'annualOperatingCashFlow','freeCashFlow':'annualFreeCashFlow','equity':'annualStockholdersEquity','debt':'annualTotalDebt','eps':'annualBasicEPS'}
def one(item):
 country,symbol=item;external=yahoo_symbol(symbol)
 source={'title':symbol+' Yahoo 연간 재무','url':'https://finance.yahoo.com/quote/'+external+'/financials/'}
 try:
  end=int(datetime.datetime.now(datetime.timezone.utc).timestamp());start=end-6*365*86400
  url='https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/'+external+'?'+urllib.parse.urlencode({'symbol':external,'type':','.join(FIELDS.values()),'period1':start,'period2':end})
  raw=get_json(url)['timeseries']['result'];series={}
  for r in raw:
   for field in FIELDS.values():
    if field in r:series[field]=sorted([x for x in r[field] if isinstance(x.get('reportedValue',{}).get('raw'),(int,float)) and math.isfinite(x['reportedValue']['raw'])],key=lambda x:x['asOfDate'])
  revenues=series.get(FIELDS['revenue'],[])
  if len(revenues)<2:raise ValueError('missing comparison year')
  latest=revenues[-1];period=latest['asOfDate'];currency=latest['currencyCode'];metrics={}
  for key,field in FIELDS.items():
   values=[x for x in series.get(field,[]) if x['asOfDate']==period and x.get('currencyCode')==currency and x.get('periodType')=='12M']
   metrics[key]=values[-1]['reportedValue']['raw'] if values else None
  prior=[x for x in revenues[:-1] if x.get('currencyCode')==currency and x.get('periodType')=='12M' and 330<=(datetime.date.fromisoformat(period)-datetime.date.fromisoformat(x['asOfDate'])).days<=400]
  metrics['priorRevenue']=prior[-1]['reportedValue']['raw'] if prior else None
  return symbol,{'status':'collected','periodEnd':period,'periodType':'12M','currency':currency,'metrics':metrics,'fetchedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sources':[source]}
 except Exception:return symbol,{'status':'unavailable','sources':[source],'reason':'Yahoo 연간 재무 누락 또는 조회 실패. 수치를 추정하지 않습니다.'}
RECHECK_DAYS=7
def recently_read(stamp,now):
 try:return (now-datetime.datetime.fromisoformat(stamp)).total_seconds()<RECHECK_DAYS*86400
 except (TypeError,ValueError):return False
def collect_fundamentals(symbols=None,known=None):
 # 2026-10-28: annual figures change once a year, so a stock read within RECHECK_DAYS (server fundamentalsAsOf) is left
 # out of the payload and the server keeps its stored numbers. Only the missing or week-old ones hit Yahoo.
 now=datetime.datetime.now(datetime.timezone.utc)
 items=[item for item in selected_items(symbols) if not recently_read((known or {}).get(item[1]),now)]
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:return dict(pool.map(one,items))
