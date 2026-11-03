"""Collect Yahoo prices with Python and submit one unattended paper cycle.
--collect prints a market snapshot only. Otherwise read {site_url,token,research}
from stdin. Credentials are never printed or written to a file.
"""
import json,re,sys,time,ssl,urllib.request,urllib.parse,urllib.error,concurrent.futures,datetime,math
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
try:
 import certifi
 TLS=ssl.create_default_context(cafile=certifi.where())
except ImportError:
 TLS=ssl.create_default_context()
SYMBOLS={'한국':['005930','000660','035420','005380','051910','035720','105560','068270'],'미국':['AAPL','MSFT','NVDA','AMZN','GOOGL','JPM','TSLA','XOM'],'일본':['7203','6758','9984','8035','6861','8306','7974','6501']}
import pathlib
_catalog_text=pathlib.Path(__file__).with_name('index-catalog.mjs').read_text(encoding='utf-8')
_membership=json.loads(_catalog_text.split('\nconst membership=',1)[1].split(';\n',1)[0])
# Entries reference membership["<index>"]; inline the shared object so the catalog parses as plain JSON.
INDEX_CATALOG=json.loads(re.sub(r'membership\[("[^"]+")\]',lambda m:json.dumps(_membership[json.loads(m.group(1))],ensure_ascii=False),_catalog_text.split('\nexport const indexCatalog=',1)[1].strip().removesuffix(';')))
ELIGIBLE={company['symbol']:company for company in INDEX_CATALOG}
YAHOO_SYMBOLS={symbol:company['yahooSymbol'] for symbol,company in ELIGIBLE.items()}
def yahoo_symbol(symbol):
 return YAHOO_SYMBOLS[symbol]
def selected_items(symbols=None):
 if symbols is None:symbols=[symbol for country in SYMBOLS for symbol in SYMBOLS[country]]
 if not isinstance(symbols,list) or not symbols or any(not isinstance(symbol,str) for symbol in symbols) or len(set(symbols))!=len(symbols):raise ValueError('Active symbols must be a nonempty unique list')
 if any(symbol not in ELIGIBLE for symbol in symbols):raise ValueError('Symbol lacks allowed index membership evidence')
 return [(ELIGIBLE[symbol]['country'],symbol) for symbol in symbols]
CREDENTIAL_HEADERS=('oai-sites-authorization','cf-access-client-id','cf-access-client-secret')
def service_headers(config):
 # Cloudflare Access service token when supplied; the legacy Sites bearer otherwise. Never both.
 if config.get('access_client_id'):return {'CF-Access-Client-Id':config['access_client_id'],'CF-Access-Client-Secret':config['access_client_secret']}
 return {'OAI-Sites-Authorization':'Bearer '+config['token']}
SITE_RETRY_DELAYS=(15,30)
def get_json(url,headers=None,payload=None):
 # 2026-10-27: a ~40s Mac tunnel blip answered one authenticated GET with 503 and the whole session died. Only credentialed reads retry; a repeated POST could submit twice, and Yahoo has its own loop.
 site=bool(headers) and any(k.lower() in CREDENTIAL_HEADERS for k in headers) and payload is None
 for attempt in range(len(SITE_RETRY_DELAYS)+1):
  try:return _get_json(url,headers,payload)
  except urllib.error.HTTPError as error:
   if not site or error.code not in (502,503,504) or attempt==len(SITE_RETRY_DELAYS):raise
   time.sleep(SITE_RETRY_DELAYS[attempt])
def _get_json(url,headers=None,payload=None):
 h={'User-Agent':'Mozilla/5.0 CommitteeLab/1.0',**(headers or {})}
 data=None if payload is None else json.dumps(payload,ensure_ascii=False).encode()
 if data is not None:h['Content-Type']='application/json'
 req=urllib.request.Request(url,headers=h,data=data)
 # Any credential header refuses redirects so a secret never travels to another URL.
 if headers and any(k.lower() in CREDENTIAL_HEADERS for k in headers):
  class SiteNoRedirect(urllib.request.HTTPRedirectHandler):
   def redirect_request(self,request,fp,code,msg,response_headers,new_url):
    raise urllib.error.HTTPError(request.full_url,code,'Authenticated Site redirect refused',response_headers,None)
  opener=urllib.request.build_opener(urllib.request.HTTPSHandler(context=TLS),SiteNoRedirect())
  with opener.open(req,timeout=35) as response:return json.load(response)
 with urllib.request.urlopen(req,context=TLS,timeout=35) as response:return json.load(response)
def yahoo(symbol,interval='1d',window='2y'):
 for attempt in range(3):
  host='query1.finance.yahoo.com' if attempt%2==0 else 'query2.finance.yahoo.com'
  try:
   raw=get_json(f'https://{host}/v8/finance/chart/{urllib.parse.quote(symbol,safe="")}?'+urllib.parse.urlencode({'interval':interval,'range':window,'includePrePost':'false','events':'div'}))
   c=raw['chart']['result'][0]
   if raw['chart'].get('error'):raise ValueError('price unavailable')
   return c
  except urllib.error.HTTPError as error:
   if error.code in (402,403,429):raise RuntimeError(f'{symbol}: provider declined request; no bypass or paid fallback') from None
   if attempt==2:raise RuntimeError(f'{symbol}: Yahoo price retrieval failed') from None
   time.sleep(1+attempt)
  except Exception:
   if attempt==2:raise RuntimeError(f'{symbol}: Yahoo price retrieval failed') from None
   time.sleep(1+attempt)
def regular_sessions(daily,period_chart,observed_at):
 """Join actual daily OHLC to provider regular periods; never create a session calendar.
 A current daily close remains provisional through the price publication delay.
 KRX normal closing bound: https://global.krx.co.kr/contents/GLB/01/0109/0109000000/guide_to_trading_in_the_korean_stock_market.pdf
 Yahoo's older 15:00 KRX bound is not a normal close. Only its latest daily
 regularMarketTime in the actual 15:30 closing auction can resolve that mismatch.
 """
 meta=daily.get('meta',{});period_meta=period_chart.get('meta',{})
 meta=meta if isinstance(meta,dict) else {};period_meta=period_meta if isinstance(period_meta,dict) else {}
 try:zone=ZoneInfo(meta['exchangeTimezoneName'])
 except (KeyError,TypeError,ZoneInfoNotFoundError):return []
 numeric=lambda x:isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x)
 local=lambda stamp:datetime.datetime.fromtimestamp(stamp,zone)
 periods=[]
 def walk(value):
  if isinstance(value,list):
   for part in value:walk(part)
  elif isinstance(value,dict) and numeric(value.get('start')) and numeric(value.get('end')):periods.append((value['start'],value['end']))
 for provider_meta in [meta,period_meta]:
  provided=provider_meta.get('tradingPeriods',[])
  walk(provided.get('regular',[]) if isinstance(provided,dict) else provided)
  current_period=provider_meta.get('currentTradingPeriod',{})
  walk(current_period.get('regular',{}) if isinstance(current_period,dict) else {})
 quotes=daily.get('indicators',{}).get('quote',[{}])[0];bars={}
 for i,stamp in enumerate(daily.get('timestamp',[])):
  if not numeric(stamp):continue
  bar={key:(quotes.get(key,[])[i] if i<len(quotes.get(key,[])) else None) for key in ['open','high','low','close','volume']}
  if all(numeric(bar[k]) and bar[k]>0 for k in bar) and bar['low']<=min(bar['open'],bar['close']) and bar['high']>=max(bar['open'],bar['close']):bars[local(stamp).date().isoformat()]=bar
 if not bars:return []
 latest_date=max(bars);market_time=meta.get('regularMarketTime');market_date=local(market_time).date().isoformat() if numeric(market_time) else None
 delay=meta.get('exchangeDataDelayedBy',period_meta.get('exchangeDataDelayedBy',15))
 delay=max(15,delay) * 60 if numeric(delay) and delay>=0 else 15*60
 grouped={}
 for start,end in set(periods):
  if not (0<start<end<=start+86400) or start>observed_at:continue
  date=local(start).date().isoformat();grouped.setdefault(date,set()).add((start,end))
 sessions=[]
 for date,bounds in sorted(grouped.items()):
  if len(bounds)!=1 or date not in bars:continue
  start,end=next(iter(bounds));bar=bars[date]
  if not numeric(market_time) or start>market_time:continue
  verified_end=True;close_time=end
  if meta.get('exchangeTimezoneName')=='Asia/Seoul' and local(end).time()<datetime.time(15,30):
   # Do not backfill historical auctions or infer holidays/early endings.
   auction=local(market_time)
   verified_end=date==latest_date==market_date and datetime.time(15,30)<=auction.time()<datetime.time(15,31)
   if verified_end:close_time=market_time
  elif date==market_date and market_time>end+60:verified_end=False
  complete=bool(verified_end and observed_at>=close_time+delay)
  sessions.append({'date':date,'open':bar['open'],'close':bar['close'] if complete else None,'openTime':start,'closeTime':close_time,'complete':complete})
 return sessions[-5:]
def collect_one(item,minimum=260,external=None,dividends=False):
 country,symbol=item;external=external or yahoo_symbol(symbol)
 c=yahoo(external);observed_at=time.time();q=c['indicators']['quote'][0];rows=[]
 for i,stamp in enumerate(c['timestamp']):
  row={k:q[k][i] for k in ('open','high','low','close','volume')};row['time']=stamp
  if all(isinstance(row[k],(int,float)) and row[k]>0 for k in ('open','high','low','close','volume')) and row['low']<=min(row['open'],row['close']) and row['high']>=max(row['open'],row['close']):rows.append(row)
 if len(rows)<minimum:raise RuntimeError(symbol+': insufficient historical prices')
 currency={'한국':'KRW','미국':'USD','일본':'JPY'}[country]
 if c['meta']['currency']!=currency:raise RuntimeError(symbol+': currency mismatch')
 try:periods=yahoo(external,interval='1h',window='5d')
 except RuntimeError:periods={'meta':{}}
 sessions=regular_sessions(c,periods,observed_at)
 note='Yahoo 정규장 기간과 실제 일봉을 연결. 종가는 제공기관 종료·지연 확인 후 확정; 시간 근거가 없으면 체결 대기.'
 if country=='한국':note+=' Yahoo 15:00 종료 정보는 KRX 정상 종료 15:30 전이므로 최신 일봉의 실제 15:30 정규장 경매 시각만 확인에 사용하며 과거 경매 시각은 만들지 않습니다.'
 result=symbol,rows[-500:],{'price':c['meta']['regularMarketPrice'],'time':c['meta']['regularMarketTime'],'currency':currency,'source':'Yahoo Finance / Python','regularSessions':sessions,'regularSessionNote':note},{'title':symbol+' 가격·정규장 시각','url':f'https://finance.yahoo.com/quote/{external}/history/'}
 return (*result,[{'time':d['date'],'amount':d['amount']} for d in c.get('events',{}).get('dividends',{}).values()]) if dividends else result

ETF_CATALOG=json.loads(pathlib.Path(__file__).with_name('etf-catalog.mjs').read_text(encoding='utf-8').removeprefix('export const ETF_ASSETS = ').strip().removesuffix(';'))
BONDS=[(a['country'],a['symbol'],a['yahooSymbol']) for a in ETF_CATALOG]
def collect_bonds(countries=None,retiring_symbols=None):
 snapshots=[];failures=[]
 excluded={a['symbol'] for a in ETF_CATALOG if a.get('enabled') is False}
 retiring=set(retiring_symbols or [])
 for country,symbol,external in BONDS:
  if symbol in excluded and symbol not in retiring:continue
  if countries is not None and country not in countries:continue
  try:
   _,bars,quote,source,dividends=collect_one((country,symbol),20,external,True)
   currency=quote['currency'];pair='KRW=X' if currency=='USD' else 'JPYKRW=X'
   fx={'rate':1,'time':time.time(),'source':None}
   if currency!='KRW':
    m=yahoo(pair)['meta'];fx={'rate':m['regularMarketPrice'],'time':m['regularMarketTime'],'source':f'https://finance.yahoo.com/quote/{pair}/'}
   snapshots.append({'symbol':symbol,'currency':currency,'provider':'Yahoo Finance / Python','fetchedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'bars':bars,'quote':quote,'sources':[source],'fx':fx,'dividends':dividends})
  except Exception:failures.append({'symbol':symbol,'status':'unavailable','message':'Actual bond price or FX unavailable; no substitute.'})
 return {'snapshots':snapshots,'failures':failures}

def collect(symbols=None,required_symbols=None):
 if required_symbols is None:
  items=selected_items(symbols);required={symbol for country,symbol in items}
 else:
  required={symbol for country,symbol in (selected_items(required_symbols) if required_symbols else [])}
  if not isinstance(symbols,list) or not symbols or any(not isinstance(symbol,str) for symbol in symbols) or len(set(symbols))!=len(symbols) or not required.issubset(symbols):raise ValueError('Invalid collection symbols')
  items=[(ELIGIBLE[symbol]['country'],symbol) for symbol in symbols if symbol in ELIGIBLE]
 failures=[{'symbol':symbol,'status':'unavailable','message':'Allowed index membership evidence unavailable.'} for symbol in (symbols or []) if symbol not in ELIGIBLE]
 rows=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  pending=[(symbol,pool.submit(collect_one,(country,symbol))) for country,symbol in items]
  for symbol,future in pending:
   try:rows.append(future.result())
   except Exception:
    if symbol in required:raise
    failures.append({'symbol':symbol,'status':'unavailable','message':'Actual price or minimum history unavailable; no substitute.'})
 if not rows:raise RuntimeError('No actual prices available')
 count=min(500,min(len(r[1]) for r in rows if r[0] in required)) if required else min(500,min(len(r[1]) for r in rows))
 # Candidates cannot shorten required history; the server requires equal bar counts.
 failures.extend({'symbol':s,'status':'unavailable','message':'History does not cover the required validation window.'} for s,b,q,u in rows if len(b)<count)
 rows=[r for r in rows if len(r[1])>=count]
 fx={'KRW':1,'USD':yahoo('KRW=X')['meta']['regularMarketPrice'],'JPY':yahoo('JPYKRW=X')['meta']['regularMarketPrice']}
 from collect_factors import collect_factors
 return {'factors':collect_factors(),'universeVersion':'indexCatalog','activeSymbols':[s for s,b,q,u in rows],'data':{s:b[-count:] for s,b,q,u in rows},'quotes':{s:q for s,b,q,u in rows},'fx':fx,'sources':[u for s,b,q,u in rows],'failures':failures,'fetchedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'provider':'Yahoo Finance / Python','notes':'실제 일봉·최근 정규장 가격. regularSessions는 제공된 정규장 기간과 일봉만 사용하며 장중 종가는 미확정입니다. 종료 확인 후 최소15분 공개 지연을 기다립니다. 지연과 휴장 가능. 배당 미반영. 네이버증권·Yahoo Finance Japan은 별도 조사와 교차 확인에 사용.'}
def main():
 if '--collect' in sys.argv:print(json.dumps(collect(),ensure_ascii=False));return
 config=json.load(sys.stdin);origin=config['site_url'].rstrip('/')
 if not origin.startswith('https://'):raise ValueError('site_url must use https')
 headers=service_headers(config)
 if datetime.datetime.fromtimestamp(time.time(),datetime.timezone(datetime.timedelta(hours=9))).weekday()>=5:
  print(json.dumps({'skipped':True,'status':'marketClosed','reason':'weekend','verified':True}));return
 # Re-read first so retries do not fetch or trade twice within one slot.
 current=get_json(origin+'/api/account',headers)
 now=time.time()*1000;slot=int((now+9*3600000)//(4*3600000))
 if current['metadata'].get('paused') or (current['metadata'].get('lastSlot') is not None and current['metadata']['lastSlot']>=slot):
  print(json.dumps({'reused':True,'paused':current['metadata'].get('paused',False),'summary':current['state'].get('lastCycle')}));return
 payload={'marketSnapshot':collect(config.get('symbols') or current['state'].get('activeSymbols')),'expectedRevision':current['revision']}
 if config.get('research') is not None:payload['research']=config['research']
 result=get_json(origin+'/api/run',headers,payload)
 readback=get_json(origin+'/api/account',headers)
 if readback['metadata'].get('lastSlot')!=slot:raise RuntimeError('Saved run could not be verified')
 print(json.dumps({'verified':True,'revision':readback['revision'],'runCount':readback['metadata']['runCount'],'summary':result.get('summary'),'lastRun':readback['metadata']['lastRun']},ensure_ascii=False))
if __name__=='__main__':
 try:main()
 except Exception as error:
  # Never include URLs, request payloads, or tokens in failures.
  print(json.dumps({'error':type(error).__name__,'message':'Price collection or saved cycle failed. No fabricated prices were substituted.'}),file=sys.stderr);sys.exit(1)
