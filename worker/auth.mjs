// Request identity for every route. Cloudflare Access JWT by default; the legacy Sites dispatch only when AUTH_PROVIDER=sites.
// Fails closed: missing configuration or any verification failure yields null and the caller rejects.
const JWKS_TTL=3600000,cache=new Map();
const decode=part=>Uint8Array.from(atob(part.replace(/-/g,'+').replace(/_/g,'/').padEnd(part.length+(4-part.length%4)%4,'=')),c=>c.charCodeAt(0));
async function jwks(team,fetchImpl,now){
 const hit=cache.get(team);
 if(hit&&now-hit.fetchedAt<JWKS_TTL)return hit.keys;
 // workerd rejects redirect:'error'; 'manual' plus a strict 200 check gives the same guarantee.
 const response=await fetchImpl(`https://${team}/cdn-cgi/access/certs`,{redirect:'manual'});
 if(response.status!==200)throw Error('jwks unavailable');
 const {keys}=await response.json();
 if(!Array.isArray(keys)||!keys.length)throw Error('jwks empty');
 cache.set(team,{keys,fetchedAt:now});return keys;
}
// Failure reasons are fixed codes for operations logs; token and claim values never leave this module.
const deny=reason=>{console.log('access-auth-denied',reason);return null;};
export async function authenticate(request,env,{fetchImpl=fetch,now=Date.now()}={}){
 if(env.AUTH_PROVIDER==='sites')return request.headers.get('oai-authenticated-user-id')?{kind:'owner'}:{kind:'service'};
 const team=env.ACCESS_TEAM_DOMAIN,aud=env.ACCESS_AUD,owner=env.OWNER_EMAIL?.toLowerCase(),serviceId=env.ACCESS_SERVICE_ID;
 if(!team||!aud||!owner||!serviceId)return deny('configMissing');
 // Access sends the application token as a header and as the CF_Authorization cookie.
 const token=request.headers.get('cf-access-jwt-assertion')||request.headers.get('cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
 if(!token||token.length>8192)return deny('tokenMissing');
 const parts=token.split('.');if(parts.length!==3)return deny('tokenMalformed');
 let header,payload,jwk,valid=false;
 try{
  header=JSON.parse(new TextDecoder().decode(decode(parts[0])));payload=JSON.parse(new TextDecoder().decode(decode(parts[1])));
  if(header.alg!=='RS256'||typeof header.kid!=='string')return deny('headerUnsupported');
  jwk=(await jwks(team,fetchImpl,now)).find(k=>k.kid===header.kid);
  // Unknown kid: refetch once so key rotation does not lock the owner out for an hour.
  if(!jwk){cache.delete(team);jwk=(await jwks(team,fetchImpl,now)).find(k=>k.kid===header.kid);}
  if(!jwk)return deny('kidUnknown');
  const key=await crypto.subtle.importKey('jwk',{kty:jwk.kty,n:jwk.n,e:jwk.e},{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
 }catch{return deny('verifyError')}
 if(!valid)return deny('signatureInvalid');
 const seconds=Math.floor(now/1000),audience=Array.isArray(payload.aud)?payload.aud:[payload.aud];
 if(payload.iss!==`https://${team}`||!audience.includes(aud)||!Number.isFinite(payload.exp)||payload.exp<=seconds||(Number.isFinite(payload.nbf)&&payload.nbf>seconds+60))return deny(payload.iss!==`https://${team}`?'issuerMismatch':!audience.includes(aud)?'audienceMismatch':'expired');
 const email=typeof payload.email==='string'?payload.email.toLowerCase():'';
 if(email)return email===owner?{kind:'owner',email}:deny('emailNotOwner');
 return payload.common_name===serviceId?{kind:'service'}:deny('serviceUnknown');
}
