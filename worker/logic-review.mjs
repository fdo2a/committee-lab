export const CODE_DIGEST=typeof __COMMITTEE_CODE_DIGEST__==='string'?__COMMITTEE_CODE_DIGEST__:'development';
export const REVIEW_TTL=15*60*1000;
export const EXECUTION_REVIEW_TTL=30*60*1000;
export const MAX_REQUEST_BYTES=10_000_000;
export function validVerdict(v){return v&&typeof v.approved==='boolean'&&typeof v.summary==='string'&&v.summary.trim()&&v.summary.length<=4000&&Array.isArray(v.issues)&&v.issues.length<=50&&v.issues.every(x=>typeof x==='string'&&x.trim()&&x.length<=4000)&&(!v.approved||v.issues.length===0);}
export function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export async function requestDigest(input){
 const {reviewProof,...payload}=input;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(payload)));
 return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function verifyApproval(input,path,publicKey,codeDigest=CODE_DIGEST,now=Date.now()){
 const held=reason=>({approved:false,reason});
 if(!publicKey)return held('reviewNotConfigured');
 const proof=input.reviewProof;
 if(!proof)return held('logicPending');
 try{
  const {signature,...receipt}=proof;
  if(receipt.version!==1||receipt.reviewer!=='claude-code'||receipt.scope!==path||receipt.codeDigest!==codeDigest||receipt.approved!==true||typeof receipt.summary!=='string'||!receipt.summary.trim()||receipt.summary.length>4000)return held('invalidApproval');
  if(!Number.isSafeInteger(receipt.issuedAt)||!Number.isSafeInteger(receipt.expiresAt)||receipt.issuedAt>now||receipt.expiresAt<=now||receipt.expiresAt<=receipt.issuedAt||receipt.expiresAt-receipt.issuedAt>REVIEW_TTL)return held('approvalExpired');
  if(receipt.digest!==await requestDigest(input))return held('approvalChanged');
  if(typeof signature!=='string'||!/^[a-f0-9]{512}$/.test(signature))return held('invalidSignature');
  const key=await crypto.subtle.importKey('jwk',JSON.parse(publicKey),{name:'RSA-PSS',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify({name:'RSA-PSS',saltLength:32},key,Uint8Array.from(signature.match(/../g),x=>parseInt(x,16)),new TextEncoder().encode(canonical(receipt)));
  return valid?{approved:true,reason:'logicalReviewPassed',summary:receipt.summary,digest:receipt.digest,issuedAt:receipt.issuedAt,expiresAt:receipt.expiresAt}:held('invalidSignature');
 }catch{return held('invalidApproval');}
}
