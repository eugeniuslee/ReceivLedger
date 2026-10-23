export interface ReportingInvoice {
  id:bigint;entity:string;payer:string;face:bigint;advance:bigint;principal:bigint;commitment:bigint;maturity:bigint;status:bigint;
  collectedBase:bigint;collectedOverdue:bigint;collectedPrincipal:bigint;
}
export function concentrationBand(exposure:bigint,nav:bigint){
  if(exposure<0n||nav<0n)throw new Error('Invalid exposure or NAV');
  if(exposure===0n)return 'Normal';
  if(nav===0n||exposure*10000n>=nav*100n)return 'High concentration — manager acknowledgement required';
  if(exposure*10000n>=nav*80n)return 'Approaching recommended limit';
  if(exposure*10000n>=nav*50n)return 'Moderate concentration';
  return 'Normal';
}
export const percentage=(amount:bigint,total:bigint)=>total>0n?`${Number(amount*10000n/total)/100}%`:amount===0n?'0%':'Unavailable (zero NAV)';
export function concentrationReport(invoices:ReportingInvoice[],nav:bigint,now:bigint){
  const entities=new Map<string,ReportingInvoice[]>(),payers=new Map<string,bigint>();
  for(const invoice of invoices){entities.set(invoice.entity,[...(entities.get(invoice.entity)??[]),invoice]);payers.set(invoice.payer,(payers.get(invoice.payer)??0n)+invoice.principal+(invoice.commitment>0n?invoice.advance:0n));}
  return [...entities].map(([entity,loans])=>{
    const outstanding=loans.reduce((n,i)=>n+i.principal,0n),commitments=loans.reduce((n,i)=>n+(i.commitment>0n?i.advance:0n),0n);
    const pending=loans.filter(i=>i.status===0n),active=loans.filter(i=>i.status===3n),repaid=loans.filter(i=>i.status===5n);
    return {entity,outstanding,commitments,pendingPrincipal:pending.reduce((n,i)=>n+i.advance,0n),pendingCount:pending.length,
      navExposure:percentage(outstanding+commitments,nav),creditUsed:percentage(outstanding+commitments,10000000n),band:concentrationBand(outstanding+commitments,nav),
      invoiceCount:loans.length,repaidCount:repaid.length,principalRecovered:loans.reduce((n,i)=>n+i.collectedPrincipal,0n),
      interestCollected:loans.reduce((n,i)=>n+i.collectedBase+i.collectedOverdue,0n),
      maturities:active.map(i=>({id:i.id,overdue:i.maturity<now,days:i.maturity>=now?(i.maturity-now+86399n)/86400n:-((now-i.maturity+86399n)/86400n)})),
      payers:[...new Set(loans.map(i=>i.payer))].map(payer=>({payer,total:payers.get(payer)??0n,percentage:percentage(payers.get(payer)??0n,nav)}))};
  });
}
export function myAssets(nav:bigint,pricingUnits:bigint,walletUnits:bigint,pendingUnits=0n,allocatedClaim=0n){
  if([nav,pricingUnits,walletUnits,pendingUnits,allocatedClaim].some(n=>n<0n)||walletUnits+pendingUnits>pricingUnits)throw new Error('Inconsistent fund or holdings snapshot');
  const activeUnits=walletUnits+pendingUnits;
  return {nav,activeUnits,navPerRlu:pricingUnits===0n?null:nav*100n/pricingUnits,ownership:percentage(activeUnits,pricingUnits),
    activeValue:pricingUnits===0n?0n:activeUnits*nav/pricingUnits,allocatedClaim,
    personalValue:(pricingUnits===0n?0n:activeUnits*nav/pricingUnits)+allocatedClaim};
}
