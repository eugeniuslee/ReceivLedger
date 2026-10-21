import type { State } from '../types';
import { MAX_DAYS, MAX_FUND, MAX_PCT, D } from '../constants';
import { MGR } from '../demo/demoData';
import { pkey, sh } from '../format';

/* DEMO LEDGER: one function per ReceivLedger.sol function (same checks, order, revert text).
   Each function mutates the State copy it is given and throws Error(revert message) on failure. */
export const exposure=(s:State,p:string)=>s.invoices.filter(i=>i.status===2&&pkey(i.payer)===pkey(p)).reduce((a,i)=>a+i.amount,0);
export const maxExp=(s:State)=>Math.floor(s.total*MAX_PCT/100);
export const emit=(s:State,type:string,detail:string,amount=0,status:'Success'|'Reverted'='Success')=>s.log.unshift({id:s.log.length+1,ts:s.now,type,detail,amount,status,tx:'0x'+Array.from({length:10},()=>(Math.random()*16|0).toString(16)).join('')+'…',avail:s.avail,out:s.total-s.avail});
export const onlyMgr=(s:State)=>{if(s.caller!==MGR)throw Error('Only manager can perform this action')};
export const inv=(s:State,id:number)=>{const i=s.invoices.find(x=>x.id===id);if(!i)throw Error('Invoice does not exist');return i};
export const demoLedger={
 approveInvestor(s:State,a:string){onlyMgr(s);if(!/^0x[0-9a-fA-F]{40}$/.test(a)||/^0x0+$/.test(a))throw Error('Invalid investor address');(s.inv[a]=s.inv[a]||{name:'New investor',bal:0,ok:false}).ok=true;emit(s,'InvestorApproved',sh(a))},
 revokeInvestor(s:State,a:string){onlyMgr(s);if(!s.inv[a]?.ok)throw Error('Investor is not approved');s.inv[a].ok=false;emit(s,'InvestorRevoked',sh(a))},
 issueFundUnits(s:State,a:string,n:number){onlyMgr(s);if(!s.inv[a]?.ok)throw Error('Investor is not approved');if(!(n>0))throw Error('Amount must be greater than zero');if(s.total+n>MAX_FUND)throw Error('Maximum fund size exceeded');s.inv[a].bal+=n;s.total+=n;s.avail+=n;emit(s,'FundUnitsIssued',s.inv[a].name+' ← '+n+' RLU',n)},
 transfer(s:State,from:string,to:string,n:number){if(!s.inv[from]?.ok)throw Error('Sender is not an approved investor');if(!s.inv[to]?.ok)throw Error('Receiver is not an approved investor');if(!(n>0)||n>s.inv[from].bal)throw Error('ERC20InsufficientBalance');s.inv[from].bal-=n;s.inv[to].bal+=n;emit(s,'Transfer',s.inv[from].name+' → '+s.inv[to].name+' · '+n+' RLU',n)},
 submitInvoice(s:State,payer:string,amount:number,mat:number){if(!payer.trim())throw Error('Payer name is required');if(!(amount>0))throw Error('Invoice amount must be greater than zero');if(!(mat>s.now))throw Error('Maturity date must be in the future');const id=s.invoices.length+1;s.invoices.push({id,sme:s.caller,payer:payer.trim(),amount,mat,status:0,reason:''});emit(s,'InvoiceSubmitted','#'+id+' · '+payer.trim(),amount);return id},
 approveInvoice(s:State,id:number){onlyMgr(s);const i=inv(s,id);if(i.status!==0)throw Error('Invoice is not awaiting approval');i.status=1;emit(s,'InvoiceApproved','#'+id+' · '+i.payer,i.amount)},
 financeInvoice(s:State,id:number){onlyMgr(s);const i=inv(s,id);if(i.status!==1)throw Error('Invoice has not been approved');
  const no=(r:string)=>{i.status=3;i.reason=r;emit(s,'InvoiceRejected','#'+id+' · '+r,i.amount);return r};
  if(i.mat<=s.now)return no('Invoice already matured');
  if(i.mat>s.now+MAX_DAYS*D)return no('Maturity exceeds 90 days');
  if(i.amount>s.avail)return no('Insufficient available funds');
  if(exposure(s,i.payer)+i.amount>maxExp(s))return no('Payer exposure limit exceeded');
  i.status=2;s.avail-=i.amount;emit(s,'InvoiceFinanced','#'+id+' · '+i.payer,i.amount);return null},
 recordRepayment(s:State,id:number){onlyMgr(s);const i=inv(s,id);if(i.status!==2)throw Error('Invoice is not financed');i.status=4;s.avail+=i.amount;emit(s,'InvoiceRepaid','#'+id+' · '+i.payer,i.amount)}};
