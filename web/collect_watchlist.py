"""Observe every allowed index member; never submit trades or fabricate gaps."""
import concurrent.futures,datetime,json,math,sys
from collect_prices import INDEX_CATALOG,yahoo

def observe(c):
 raw=yahoo(c['yahooSymbol'],window='3mo');meta=raw['meta'];q=raw['indicators']['quote'][0];times=raw.get('timestamp',[])
 bars=[(t,p,v) for t,p,v in zip(times,q.get('close',[]),q.get('volume',[])) if isinstance(p,(int,float)) and p>0 and math.isfinite(p)]
 price=meta.get('regularMarketPrice');stamp=meta.get('regularMarketTime');currency=meta.get('currency')
 if currency!=c['currency'] or not isinstance(price,(int,float)) or price<=0 or not isinstance(stamp,(int,float)) or not bars:raise ValueError('Unverified quote')
 recent=bars[-20:];turnovers=[p*v for _,p,v in recent if isinstance(v,(int,float)) and v>=0]
 return {'symbol':c['symbol'],'price':price,'time':stamp,'currency':currency,'momentum':bars[-1][1]/bars[-21][1]-1 if len(bars)>=21 else None,'averageTurnover':sum(turnovers)/20 if len(turnovers)==20 else None,'bars':len(bars)}
def collect_watchlist():
 observations=[];failures=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
  futures={pool.submit(observe,c):c for c in INDEX_CATALOG}
  for future in concurrent.futures.as_completed(futures):
   c=futures[future]
   try:observations.append(future.result())
   except Exception as e:failures.append({'symbol':c['symbol'],'reason':str(e)[:180]})
 return {'provider':'Yahoo Finance / Python','fetchedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'observations':sorted(observations,key=lambda x:x['symbol']),'failures':sorted(failures,key=lambda x:x['symbol'])}
if __name__=='__main__':json.dump(collect_watchlist(),sys.stdout,ensure_ascii=False)
