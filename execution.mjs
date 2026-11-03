export const executionBasis=(side,state)=>{const v=state?.executionPolicy?.version;return v>=4?'regularOpen':v===3?(['buy','short'].includes(side)?'regularClose':'regularOpen'):v===2?'regularOpen':['buy','cover'].includes(side)?'regularClose':'regularOpen';};
export function enableRegularExecution(state,now=Date.now()){
 if(state.executionPolicy?.version===4)return state.executionPolicy;
 // v4 only changes the basis; keeping the earlier activation lets orders approved before an open still fill at that open.
 const activatedAt=Number.isFinite(Date.parse(state.executionPolicy?.activatedAt))?state.executionPolicy.activatedAt:new Date(now).toISOString();
 state.executionPolicy={version:4,buy:'regularOpen',short:'regularOpen',sell:'regularOpen',cover:'regularOpen',activatedAt};
 return state.executionPolicy;
}
export function stampDecision(plan,now){
 plan.approvedAt=new Date(now).toISOString();plan.eligibleAfter=now/1000;
}
export function regularExecution(state,plan,quote,now){
 const basis=executionBasis(plan.side,state),close=basis==='regularClose';
 const activation=Date.parse(state.executionPolicy?.activatedAt)/1000;
 const cutoff=Math.max(Number.isFinite(activation)?activation:Infinity,Number.isFinite(plan.eligibleAfter)?plan.eligibleAfter:Date.parse(plan.approvedAt)/1000||0,plan.signalTimestamp||0);
 const events=(quote?.regularSessions||[]).filter(s=>s&&/^\d{4}-\d{2}-\d{2}$/.test(s.date)).map(s=>({executionBasis:basis,sessionDate:s.date,sessionPrice:close?s.close:s.open,executionTime:close?s.closeTime:s.openTime,complete:!close||s.complete===true}));
 const event=events.filter(e=>e.complete&&Number.isFinite(e.sessionPrice)&&e.sessionPrice>0&&Number.isFinite(e.executionTime)&&e.executionTime>cutoff&&e.executionTime<=now/1000).sort((a,b)=>a.executionTime-b.executionTime)[0];
 plan.executionWaitReason=event?null:`다음 정규장 ${close?'종가':'시가'} 수집 대기`;
 return event?{...event,recordedAt:new Date(now).toISOString()}:null;
}
