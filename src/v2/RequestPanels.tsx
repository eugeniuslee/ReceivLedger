import { useState } from 'react';
import { money, moneyInput } from '../finance/models';
import { investmentAllowance } from './activation';
import type { V2Ledger } from './V2Ledger';
type Report = Awaited<ReturnType<V2Ledger['readReport']>>;
const units = (value:bigint) => `${value/100n}.${String(value%100n).padStart(2,'0')} RLU2`;
const label = (values:string[],value:bigint) => values[Number(value)] ?? 'Unknown contract status';
export function InvestmentPolicy({ amount }: { amount:string }) {
  const [used,setUsed]=useState('0');
  let result:ReturnType<typeof investmentAllowance>|null=null,error='';
  try { result=investmentAllowance(moneyInput(amount),moneyInput(used)); } catch { error='Enter valid amounts; the investment must be at least S$1.'; }
  return <><label>Scenario lifetime automatic investment already used (S$)<input inputMode="decimal" value={used} onChange={e=>setUsed(e.target.value)}/></label>
    {error&&<p role="alert">{error}</p>}{result&&<p className="notice info">Scenario automatic allowance remaining: {money(result.remaining)}. {result.reviewRequired?'Manager review required for this investment.':'Within the cumulative automatic allowance.'} Approval and manager-confirmed funding are still required. Redemptions never reset usage.</p>}</>;
}
export function RedemptionDraft({ report }: { report:Report|null }) {
  const [quantity,setQuantity]=useState(''),[minimum,setMinimum]=useState('0');
  let estimate:bigint|null=null,error='';
  if(quantity) try {
    const amount=moneyInput(quantity); if(amount<=0n)throw Error('Enter positive units.');
    moneyInput(minimum);
    if(report){const supply=BigInt(report.fund.pricingUnits);if(supply>0n)estimate=amount*BigInt(report.fund.navCents)/supply;}
  } catch {error='Enter positive RLU2 units with at most two decimals and a non-negative minimum payout.';}
  return <details className="model-controls"><summary>Prepare a redemption request</summary><p>Draft only. No units are escrowed and no request is submitted.</p>
    <div className="form-row"><label>RLU2 units to redeem<input inputMode="decimal" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label><label>Minimum accepted simulated payout (S$)<input inputMode="decimal" value={minimum} onChange={e=>setMinimum(e.target.value)}/></label></div>
    {error&&<p role="alert">{error}</p>}<p>{estimate===null?'A live V2 NAV and active-unit read is required to estimate a payout.':`Indicative payout at the reporting block: ${money(estimate)}. Allocation reprices at execution; liquidity, eligibility, escrow and minimum payout must be rechecked.`}</p>
    <button className="btn o" disabled>Submit redemption request</button>
  </details>;
}
export function ManagerDraft() {
  return <details className="model-controls"><summary>Prepare a manager review</summary><p>Draft only. Select a confirmed V2 request after deployment; IDs never refer to V1 invoices.</p>
    <div className="form-row"><label>V2 request or invoice ID<input inputMode="numeric" placeholder="Confirmed V2 ID"/></label><label>Review / rejection reason<input maxLength={250}/></label><label>Simulated collection amount (S$)<input inputMode="decimal"/></label><label>Unique funding / collection reference<input placeholder="Reviewed evidence reference"/></label></div>
    <p>No draft is saved or executed. Canonical identities, funding, credit clearance and private documents require independently verified evidence.</p>
  </details>;
}
export function RequestHistory({report,stakeholder}:{report:Report;stakeholder:'manager'|'investor'|'sme'}) {
  const own=(address:string)=>address.toLowerCase()===report.wallet.toLowerCase(),all=stakeholder==='manager';
  const subscriptions=(report.subscriptions??[]).filter(r=>all||own(r.investor));
  const redemptions=(report.redemptions??[]).filter(r=>all||own(r.investor));
  const invoices=(report.invoices??[]).filter(r=>all||r.sme&&own(r.sme));
  return <section className="section-block"><h2>{all?'Fund request register':'Your V2 request register'}</h2><p>Confirmed public records at Sepolia block {report.blockTag}. These states do not prove real payments. Record IDs are not fabricated transaction receipts.</p>
    {stakeholder!=='sme'&&<><h3>Investment requests</h3>{subscriptions.length?subscriptions.map(r=><p key={String(r.id)}>#{String(r.id)} · {money(r.cents)} · {label(['Pending funding','Pending review','Ready','Processed','Cancelled','Refund pending','Refunded','Rejected'],r.status)} · Funding {r.funded?'confirmed by manager':'not confirmed'}{all&&` · ${r.investor}`}</p>):<p>No investment requests for this view.</p>}
    <h3>Redemption requests</h3>{redemptions.length?redemptions.map(r=><p key={String(r.id)}>#{String(r.id)} · {units(r.units)} · {label(['Pending review','Pending liquidity','Allocated','Settled','Cancelled','Rejected'],r.status)} · Allocated payout {money(r.payoutCents)}{all&&` · ${r.investor}`}</p>):<p>No redemption requests for this view.</p>}</>}
    {stakeholder!=='investor'&&<><h3>Invoice status and repayment breakdown</h3>{invoices.length?invoices.map(r=><details className="model-controls" key={String(r.id)}><summary>Invoice #{String(r.id)} · {label(['Submitted','Auto-approved','Approved','Financed','Rejected','Repaid'],r.status)}</summary>
      <p>Face {money(r.face)}; gross advance {money(r.advance)}; principal remaining {money(r.principal)}. {r.status===3n&&r.maturity<report.timestamp?'Overdue; not automatically repaid.':''}</p>
      {r.breakdown&&<dl className="detail-list">{Object.entries(r.breakdown).map(([key,value])=><div key={key}><dt>{{netAdvance:'Net cash advanced',fee:'Processing fee earned once',principal:'Outstanding principal',baseInterest:'Earned unpaid base interest',overdueInterest:'Earned unpaid overdue interest',payerCollections:'Payer collections offset',smeCollections:'SME collections',reserve:'Reserve payable',released:'Reserve already released'}[key]}</dt><dd>{money(value)}</dd></div>)}</dl>}
      <p>Principal recovered {money(r.collectedPrincipal)}; interest collected {money(r.collectedBase+r.collectedOverdue)}. Payer collections and SME repayments settle the same debt.</p>
    </details>):<p>No invoices for this view.</p>}</>}
  </section>;
}
