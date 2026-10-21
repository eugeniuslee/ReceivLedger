import type { State } from '../types';
import { D } from '../constants';
import { demoLedger } from '../ledger/demoLedger';
import { INV0, MGR, NAMES, W } from './demoData';

/* Seeded fictional fund. Built by calling the same ledger functions the UI uses, so it is always consistent.
   Edit the amounts / payers / days below to change the demo data. */
export function seed(): State {
 const s:State={now:Date.now()-14*D,caller:MGR,total:0,avail:0,inv:{},invoices:[],log:[]},R=Date.now();
 INV0.forEach(([name,a])=>s.inv[a]={name,bal:0,ok:false});
 INV0.slice(0,4).forEach(([,a],i)=>{demoLedger.approveInvestor(s,a);s.now+=D/4;demoLedger.issueFundUnits(s,a,[300000,220000,160000,120000][i]);s.now+=D/4});
 const sub=(who:string,p:string,a:number,days:number)=>{s.caller=who;const id=demoLedger.submitInvoice(s,p,a,R+days*D);s.caller=MGR;return id};
 const E=Object.keys(NAMES);const step=()=>s.now+=D/2;
 const a=sub(E[1],'Changi Retail Group',45000,40),b=sub(E[2],'Harbour Marine Pte Ltd',60000,55),c=sub(W.sme,'Changi Retail Group',30000,30),d=sub(E[3],'Skyline Developments',25000,20),e=sub(W.sme,'Harbour Marine Pte Ltd',30000,60),f=sub(E[1],'Skyline Developments',18000,45),g=sub(E[2],'Changi Retail Group',20000,35);
 [a,b,c,d,e,g].forEach(i=>{demoLedger.approveInvoice(s,i);step()});[a,b,c,d,g].forEach(i=>{demoLedger.financeInvoice(s,i);step()});demoLedger.recordRepayment(s,d);s.now=R;return s}
