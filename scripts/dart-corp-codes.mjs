// Regenerates scripts/dart-corp-codes.json (stock code -> DART corp code for the Korean universe) from DART's
// corpCode.xml. Run on the Mac when web/universe.mjs changes Korean symbols:
//   DART_API_KEY=... node scripts/dart-corp-codes.mjs
// The key is read from the environment only; the output holds public codes and no credentials.
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {eligibleCatalog} from '../web/universe.mjs';
import {downloadCorpCodes} from './filings.mjs';

export function corpCodeTable(map,catalog=eligibleCatalog){
 const symbols=catalog.filter(c=>c.country==='한국').map(c=>c.symbol).sort();
 const missing=symbols.filter(s=>!map.has(s));
 return {table:Object.fromEntries(symbols.filter(s=>map.has(s)).map(s=>[s,map.get(s)])),missing};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const key=process.env.DART_API_KEY;
 if(!key)throw Error('DART_API_KEY environment variable required');
 const {table,missing}=corpCodeTable(await downloadCorpCodes(key));
 await writeFile(new URL('./dart-corp-codes.json',import.meta.url),JSON.stringify(table,null,1)+'\n');
 console.log(JSON.stringify({written:Object.keys(table).length,missing}));
 if(missing.length)process.exitCode=2;
}
