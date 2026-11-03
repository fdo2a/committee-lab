"""Kenneth French Data Library three-factor returns (Mkt-RF, SMB, HML, RF in percent), retrieved in Python.
US and Japan daily files only; Korean candidates keep the four required quant factors.
A failed region is omitted and the quant department simply has no alpha for it.
"""
import io,urllib.request,zipfile
from collect_prices import TLS
SOURCE='https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/'
# Must match FF3_FILES in web/fama-french.mjs; the server rejects any other source or frequency.
FILES={'us':('F-F_Research_Data_Factors_daily_CSV.zip','daily',600),'japan':('Japan_3_Factors_Daily_CSV.zip','daily',600)}

def parse(text,frequency,limit):
 """First data block only: the monthly files append an annual block after a blank line."""
 digits=8 if frequency=='daily' else 6;header=None;rows=[]
 for line in text.splitlines():
  cells=[c.strip() for c in line.split(',')]
  if header is None:
   if 'Mkt-RF' in cells:header=cells
   continue
  if cells[0].isdigit() and len(cells[0])==digits:
   values=[float(cells[header.index(k)]) for k in ('Mkt-RF','SMB','HML','RF')]
   if all(abs(v+99.99)>1e-9 for v in values):rows.append([int(cells[0])]+values)
  elif rows:break
 return rows[-limit:]

def fetch(url):
 request=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 committee-lab research'})
 with urllib.request.urlopen(request,context=TLS,timeout=30) as response:return response.read()

def collect_factors(get=None):
 get=get or fetch;out={}
 for region,(name,frequency,limit) in FILES.items():
  try:
   archive=zipfile.ZipFile(io.BytesIO(get(SOURCE+name)))
   rows=parse(archive.read(archive.namelist()[0]).decode('latin-1'),frequency,limit)
   if rows:out[region]={'frequency':frequency,'source':SOURCE+name,'rows':rows}
  except Exception:continue
 return out or None
