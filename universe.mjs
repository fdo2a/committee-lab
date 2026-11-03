import {indexCatalog} from './index-catalog.mjs';
export {indexCatalog} from './index-catalog.mjs';
export const coreCompanies = [
  {
    symbol: "005930",
    name: "삼성전자",
    sector: "반도체",
    base: 72000,
    drift: 0.0009,
    pe: 16.8,
    growth: 18.4,
    debt: 24,
  },
  {
    symbol: "000660",
    name: "SK하이닉스",
    sector: "반도체",
    base: 178000,
    drift: 0.0013,
    pe: 14.2,
    growth: 32.1,
    debt: 48,
  },
  {
    symbol: "035420",
    name: "NAVER",
    sector: "플랫폼",
    base: 194000,
    drift: 0.0005,
    pe: 22.1,
    growth: 12.3,
    debt: 39,
  },
  {
    symbol: "005380",
    name: "현대자동차",
    sector: "자동차",
    base: 231000,
    drift: 0.0004,
    pe: 7.2,
    growth: 8.6,
    debt: 76,
  },
  {
    symbol: "051910",
    name: "LG화학",
    sector: "소재",
    base: 321000,
    drift: -0.0004,
    pe: 31.4,
    growth: -14.2,
    debt: 94,
  },
  {
    symbol: "035720",
    name: "카카오",
    sector: "플랫폼",
    base: 41000,
    drift: -0.0002,
    pe: 38.3,
    growth: -3.1,
    debt: 61,
  },
  {
    symbol: "105560",
    name: "KB금융",
    sector: "금융",
    base: 81000,
    drift: 0.0007,
    pe: 6.8,
    growth: 11.7,
    debt: 0,
  },
  {
    symbol: "068270",
    name: "셀트리온",
    sector: "바이오",
    base: 183000,
    drift: 0.0003,
    pe: 41.2,
    growth: 21.2,
    debt: 32,
  },
];
coreCompanies.forEach((c) =>
  Object.assign(c, { country: "한국", currency: "KRW", fx: 1 }),
);
coreCompanies.push(
  {
    symbol: "AAPL",
    name: "Apple",
    sector: "기술",
    base: 225,
    drift: 0.0007,
    pe: 29,
    growth: 9,
    debt: 110,
    country: "미국",
    currency: "USD",
    fx: 1400,
  },
  {
    symbol: "MSFT",
    name: "Microsoft",
    sector: "기술",
    base: 420,
    drift: 0.0011,
    pe: 34,
    growth: 17,
    debt: 38,
    country: "미국",
    currency: "USD",
    fx: 1400,
  },
  {
    symbol: "NVDA",
    name: "NVIDIA",
    sector: "반도체",
    base: 130,
    drift: 0.0015,
    pe: 44,
    growth: 48,
    debt: 22,
    country: "미국",
    currency: "USD",
    fx: 1400,
  },
  {
    symbol: "AMZN",
    name: "Amazon",
    sector: "소비",
    base: 195,
    drift: 0.0008,
    pe: 37,
    growth: 13,
    debt: 66,
    country: "미국",
    currency: "USD",
    fx: 1400,
  },
  {
    symbol: "GOOGL",
    name: "Alphabet",
    sector: "플랫폼",
    base: 175,
    drift: 0.0006,
    pe: 23,
    growth: 14,
    debt: 15,
    country: "미국",
    currency: "USD",
    fx: 1400,
  },
  {
    symbol: "JPM",
    name: "JPMorgan",
    sector: "금융",
    base: 215,
    drift: 0.0005,
    pe: 12,
    growth: 7,
    debt: 0,
    country: "미국",
    currency: "USD",
    fx: 1400,
  },
  {
    symbol: "TSLA",
    name: "Tesla",
    sector: "자동차",
    base: 245,
    drift: -0.0001,
    pe: 61,
    growth: -4,
    debt: 20,
    country: "미국",
    currency: "USD",
    fx: 1400,
  },
  {
    symbol: "XOM",
    name: "Exxon Mobil",
    sector: "에너지",
    base: 115,
    drift: 0.0003,
    pe: 14,
    growth: 3,
    debt: 24,
    country: "미국",
    currency: "USD",
    fx: 1400,
  },
  {
    symbol: "7203",
    name: "토요타",
    sector: "자동차",
    base: 2650,
    drift: 0.0005,
    pe: 9,
    growth: 8,
    debt: 80,
    country: "일본",
    currency: "JPY",
    fx: 9.5,
  },
  {
    symbol: "6758",
    name: "소니 그룹",
    sector: "기술",
    base: 3200,
    drift: 0.0009,
    pe: 19,
    growth: 12,
    debt: 45,
    country: "일본",
    currency: "JPY",
    fx: 9.5,
  },
  {
    symbol: "9984",
    name: "소프트뱅크 그룹",
    sector: "금융",
    base: 8500,
    drift: 0.0004,
    pe: 26,
    growth: 6,
    debt: 125,
    country: "일본",
    currency: "JPY",
    fx: 9.5,
  },
  {
    symbol: "8035",
    name: "도쿄일렉트론",
    sector: "반도체",
    base: 24500,
    drift: 0.0012,
    pe: 25,
    growth: 23,
    debt: 16,
    country: "일본",
    currency: "JPY",
    fx: 9.5,
  },
  {
    symbol: "6861",
    name: "키엔스",
    sector: "산업재",
    base: 62000,
    drift: 0.0006,
    pe: 35,
    growth: 10,
    debt: 5,
    country: "일본",
    currency: "JPY",
    fx: 9.5,
  },
  {
    symbol: "8306",
    name: "미쓰비시UFJ",
    sector: "금융",
    base: 1550,
    drift: 0.0005,
    pe: 11,
    growth: 9,
    debt: 0,
    country: "일본",
    currency: "JPY",
    fx: 9.5,
  },
  {
    symbol: "7974",
    name: "닌텐도",
    sector: "게임",
    base: 8400,
    drift: 0.0007,
    pe: 24,
    growth: 11,
    debt: 3,
    country: "일본",
    currency: "JPY",
    fx: 9.5,
  },
  {
    symbol: "6501",
    name: "히타치",
    sector: "산업재",
    base: 3600,
    drift: 0.0009,
    pe: 21,
    growth: 16,
    debt: 44,
    country: "일본",
    currency: "JPY",
    fx: 9.5,
  },
);

// The catalog is eligible; an account activates only its verified, priced subset.
const selectedMetadata = {
  "014680": {
    "sector": "소재",
    "sizeClass": "mid",
    "sizeStatus": "observed",
    "universeGroup": "midSmall",
    "sizeEvidence": {
      "value": 2957500000000,
      "currency": "KRW",
      "asOf": "2026-10-02",
      "url": "https://alphasquare.co.kr/home/stock-summary?code=014680",
      "classification": "mid",
      "classificationBasis": "temporary analytic bands small<1tnKRW,mid1-10tnKRW; not KRX officialcapindex"
    },
    "assetType": "common_equity",
    "exchange": "KOSPI",
    "sourceUrls": [
      "https://dart.fss.or.kr/report/viewer.do?rcpNo=20260813001414&dcmNo=11525142&eleId=3&offset=5919&length=107630&dtd=dart4.xsd",
      "https://dart.fss.or.kr/report/viewer.do?rcpNo=20260813001414&dcmNo=11525142&eleId=9&offset=113553&length=89254&dtd=dart4.xsd",
      "https://dart.fss.or.kr/report/viewer.do?rcpNo=20260813001414&dcmNo=11525142&eleId=18&offset=202970&length=20174&dtd=dart4.xsd",
      "https://dart.fss.or.kr/report/viewer.do?rcpNo=20260813001414&dcmNo=11525142&eleId=129&offset=4093492&length=9314&dtd=dart4.xsd",
      "https://englishdart.fss.or.kr/dsbc001/selectPopup.ax?selectKey=00140955",
      "https://alphasquare.co.kr/home/stock-summary?code=014680"
    ]
  },
  "002030": {
    "sizeClass": "small",
    "sizeStatus": "observed",
    "sizeEvidence": {
      "value": 429270600000,
      "currency": "KRW",
      "asOf": "2026-10-02",
      "url": "https://alphasquare.co.kr/home/stock-summary?code=002030",
      "classification": "small",
      "classificationBasis": "temporary analytic bands small<1tnKRW,mid1-10tnKRW; not KRX officialcapindex"
    },
    "sector": "지주회사"
  },
  "003030": {
    "sizeClass": "small",
    "sizeStatus": "observed",
    "sizeEvidence": {
      "value": 477500000000,
      "currency": "KRW",
      "asOf": "2026-10-02",
      "url": "https://alphasquare.co.kr/home/stock-summary?code=003030",
      "classification": "small",
      "classificationBasis": "temporary analytic bands small<1tnKRW,mid1-10tnKRW; not KRX officialcapindex"
    },
    "sector": "철강"
  },
  "014820": {
    "sizeClass": "small",
    "sizeStatus": "observed",
    "sizeEvidence": {
      "value": 617500000000,
      "currency": "KRW",
      "asOf": "2026-10-02",
      "url": "https://alphasquare.co.kr/home/stock-summary?code=014820",
      "classification": "small",
      "classificationBasis": "temporary analytic bands small<1tnKRW,mid1-10tnKRW; not KRX officialcapindex"
    },
    "sector": "소재"
  },
  "1332": {
    "sizeClass": "mid",
    "sizeStatus": "observed",
    "name": "닛스이 (NISSUI CORP.)",
    "sector": "식품",
    "sizeEvidence": {
      "value": 337166000000,
      "currency": "JPY",
      "asOf": "2026-10-05T13:47:00+09:00",
      "url": "https://finance.yahoo.co.jp/quote/1332.T",
      "classification": "mid",
      "limitation": "Yahoo Finance Japan 시가총액 표시(백만엔)를 엔으로 환산한 장중 관측. 1000억~1조엔의 기존 자체 중형 구간에 해당하며 닛케이225 내부의 상대적 소형 후보이지 절대 소형주(<1000억엔)는 아니다."
    },
    "sourceUrls": [
      "https://indexes.nikkei.co.jp/en/nkave/index/component",
      "https://finance.yahoo.co.jp/quote/1332.T",
      "https://contents.xj-storage.jp/xcontents/AS06310/751ed806/69d0/459d/9622/6a4b3aa52bec/20260520172052241s.pdf",
      "https://contents.xj-storage.jp/xcontents/AS06310/c3ebf09c/993d/41cc/ad44/236a6b9bbc15/140120260805510138.pdf"
    ]
  },
  "1721": {
    "sizeClass": "mid",
    "sizeStatus": "observed",
    "name": "코무시스 홀딩스 (COMSYS HOLDINGS CORP.)",
    "sector": "통신 인프라",
    "sizeEvidence": {
      "value": 649590000000,
      "currency": "JPY",
      "asOf": "2026-10-05T14:05:00+09:00",
      "url": "https://finance.yahoo.co.jp/quote/1721.T",
      "classification": "mid",
      "limitation": "Yahoo Finance Japan 시가총액 표시(백만엔)를 엔으로 환산한 장중 관측. 1000억~1조엔의 기존 자체 중형 구간에 해당하며 닛케이225 내부의 상대적 소형 후보이지 절대 소형주(<1000억엔)는 아니다."
    },
    "sourceUrls": [
      "https://indexes.nikkei.co.jp/en/nkave/index/component",
      "https://finance.yahoo.co.jp/quote/1721.T",
      "https://ssl4.eir-parts.net/doc/1721/tdnet/2804012/00.pdf",
      "https://ssl4.eir-parts.net/doc/1721/tdnet/2873280/00.pdf"
    ]
  },
  "4043": {
    "sizeClass": "mid",
    "sizeStatus": "observed",
    "name": "도쿠야마 (TOKUYAMA CORP.)",
    "sector": "화학",
    "sizeEvidence": {
      "value": 298950000000,
      "currency": "JPY",
      "asOf": "2026-10-05T14:02:00+09:00",
      "url": "https://finance.yahoo.co.jp/quote/4043.T",
      "classification": "mid",
      "limitation": "Yahoo Finance Japan 시가총액 표시(백만엔)를 엔으로 환산한 장중 관측. 1000억~1조엔의 기존 자체 중형 구간에 해당하며 닛케이225 내부의 상대적 소형 후보이지 절대 소형주(<1000억엔)는 아니다."
    },
    "sourceUrls": [
      "https://indexes.nikkei.co.jp/en/nkave/index/component",
      "https://finance.yahoo.co.jp/quote/4043.T",
      "https://www.tokuyama.co.jp/ir/pdf/2026mar_tanshin.pdf",
      "https://www.tokuyama.co.jp/ir/pdf/2027mar_1stQ_tanshin.pdf"
    ]
  },
  "6103": {
    "sizeClass": "mid",
    "sizeStatus": "observed",
    "name": "오쿠마 (OKUMA CORP.)",
    "sector": "공작기계",
    "sizeEvidence": {
      "value": 331813000000,
      "currency": "JPY",
      "asOf": "2026-10-05T13:48:00+09:00",
      "url": "https://finance.yahoo.co.jp/quote/6103.T",
      "classification": "mid",
      "limitation": "Yahoo Finance Japan 시가총액 표시(백만엔)를 엔으로 환산한 장중 관측. 1000억~1조엔의 기존 자체 중형 구간에 해당하며 닛케이225 내부의 상대적 소형 후보이지 절대 소형주(<1000억엔)는 아니다."
    },
    "sourceUrls": [
      "https://indexes.nikkei.co.jp/en/nkave/index/component",
      "https://finance.yahoo.co.jp/quote/6103.T",
      "https://contents.xj-storage.jp/xcontents/61030/d5b61d6f/795e/4cc3/b00e/bbcab2199975/140120260511522592.pdf",
      "https://contents.xj-storage.jp/xcontents/61030/4a615fa9/506c/4e72/b93a/438f63babbb0/140120260805509265.pdf"
    ]
  },
  "AOS": {
    "sizeStatus": "pending",
    "sector": "설비"
  },
  "SWK": {
    "sizeStatus": "pending",
    "sector": "공구"
  },
  "HRL": {
    "sizeStatus": "pending",
    "sector": "필수소비재"
  },
  "DVA": {
    "sizeStatus": "pending",
    "sector": "헬스케어"
  }
};
const registry = new Map(indexCatalog.map(c=>[c.symbol,{...c,...selectedMetadata[c.symbol]}]));
for(const previous of coreCompanies){
 const member=registry.get(previous.symbol);registry.set(previous.symbol,{...member,...previous,...(member?.indexMembership?{indexMembership:member.indexMembership}:{})});
}
export const companies = [...registry.values()];
export const eligibleCatalog = indexCatalog.map(c=>registry.get(c.symbol));
export const CORE_SYMBOLS = Object.freeze(coreCompanies.map(c=>c.symbol));
export const EXPANDED_SYMBOLS = Object.freeze([...CORE_SYMBOLS,...["014680", "002030", "003030", "014820", "AOS", "SWK", "HRL", "DVA", "1332", "1721", "4043", "6103"]]);
export const expandedCompanies = EXPANDED_SYMBOLS.map(symbol=>registry.get(symbol));
const eligibleBySymbol = new Map(eligibleCatalog.map(c=>[c.symbol,c]));
export function activeCompanies(state) {
 const version=state?.universeVersion??"core24";
 if(!["core24","expanded36","indexCatalog"].includes(version))throw Error("지원하지 않는 관찰 종목 구성입니다.");
 if(state?.activeSymbols!==undefined){
  const symbols=state.activeSymbols;
  if(!Array.isArray(symbols)||!symbols.length||new Set(symbols).size!==symbols.length)throw Error("활성 관찰 종목은 중복 없는 기호 목록이어야 합니다.");
  const selected=symbols.map(symbol=>eligibleBySymbol.get(symbol));
  if(selected.some(c=>!c))throw Error("허용 지수 편입 근거를 확인하지 못한 관찰 종목입니다.");
  return selected;
 }
 if(version==="core24")return coreCompanies;
 if(version==="expanded36")return expandedCompanies;
 throw Error("지수 후보 운용에는 가격을 준비한 활성 관찰 종목이 필요합니다.");
}
