import {createState,advance} from '../web/engine.mjs';
// Eight observed sessions yield eligible long signals under close-price entries.
const ready=createState();
for(let i=0;i<8;i++)advance(ready);
export const readyState=()=>structuredClone(ready);
