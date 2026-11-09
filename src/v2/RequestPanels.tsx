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
    {error&&<p role="alert">{error}</p>}{result&&<p className="notice info">Estimated automatic allowance remaining: {money(result.remaining)}. {result.reviewRequired?'Manager review required for this investment.':'Within the cumulative automatic allowance.'} Approval and funding confirmation are required.</p>}<p className="footnote">Redemptions do not reset your lifetime automatic allowance.</p></>;
}
export function RedemptionDraft({ report }: { report:Report|null }) {
  const [quantity,setQuantity]=useState(''),[minimum,setMinimum]=useState('0');
  let estimate:bigint|null=null,error='';
  if(quantity) try {
    const amount=moneyInput(quantity); if(amount<=0n)throw Error('Enter positive units.');
    moneyInput(minimum);
    if(report){const supply=BigInt(report.fund.pricingUnits);if(supply>0n)estimate=amount*BigInt(report.fund.navCents)/supply;}
  } catch {error='Enter positive RLU2 units with at most two decimals and a non-negative minimum payout.';}
  return <details className="model-controls"><summary>Estimate a redemption</summary><p className="support-copy">Redemption requests are not available yet. Use this estimate to review a possible payout.</p>
    <div className="form-row"><label>RLU2 units to redeem<input inputMode="decimal" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label><label>Minimum accepted payout (S$)<input inputMode="decimal" value={minimum} onChange={e=>setMinimum(e.target.value)}/></label></div>
    {error&&<p role="alert">{error}</p>}<p>{estimate===null?'Live fund data is required to estimate a payout.':`Estimated payout: ${money(estimate)}. The final amount depends on fund value and available liquidity when allocated.`}</p>
    <button className="btn o" disabled>Submit redemption request</button>
  </details>;
}
export function ManagerDraft() {
  return <details className="model-controls"><summary>Prepare a manager review</summary><p className="support-copy">Review drafts are not saved or submitted.</p>
    <div className="form-row"><label>Request or invoice ID<input inputMode="numeric" placeholder="Request ID"/></label><label>Review / rejection reason<input maxLength={250}/></label><label>Collection amount (S$)<input inputMode="decimal"/></label><label>Funding / collection reference<input placeholder="Payment reference"/></label></div>
    <details className="calculation-notes"><summary>Review requirements</summary><p>Use the request IDs in this fund's records. Verify the applicant, funding, credit clearance and private documents before approving a request.</p></details>
  </details>;
}
export function RequestHistory({report,stakeholder}:{report:Report;stakeholder:'manager'|'investor'|'sme'}) {
  const own=(address:string)=>address.toLowerCase()===report.wallet.toLowerCase(),all=stakeholder==='manager';
  const subscriptions=(report.subscriptions??[]).filter(r=>all||own(r.investor));
  const redemptions=(report.redemptions??[]).filter(r=>all||own(r.investor));
  const invoices=(report.invoices??[]).filter(r=>all||r.sme&&own(r.sme));
  return <section className="section-block"><h2>{all?'Request history':'Your requests'}</h2>
    {stakeholder!=='sme'&&<><h3>Investment requests</h3>{subscriptions.length?<div className="table-scroll"><table><thead><tr><th>Request</th><th>Amount</th><th>Status</th><th>Funding</th>{all&&<th>Investor</th>}</tr></thead><tbody>{subscriptions.map(r=><tr key={String(r.id)}><td>#{String(r.id)}</td><td>{money(r.cents)}</td><td>{label(['Pending funding','Pending review','Ready','Processed','Cancelled','Refund pending','Refunded','Rejected'],r.status)}</td><td>{r.funded?'Confirmed':'Awaiting confirmation'}</td>{all&&<td className="mono">{r.investor}</td>}</tr>)}</tbody></table></div>:<p className="support-copy">No investment requests yet.</p>}
    <h3>Redemption requests</h3>{redemptions.length?<div className="table-scroll"><table><thead><tr><th>Request</th><th>Units</th><th>Status</th><th>Allocated payout</th>{all&&<th>Investor</th>}</tr></thead><tbody>{redemptions.map(r=><tr key={String(r.id)}><td>#{String(r.id)}</td><td>{units(r.units)}</td><td>{label(['Pending review','Pending liquidity','Allocated','Settled','Cancelled','Rejected'],r.status)}</td><td>{r.status===2n||r.status===3n?money(r.payoutCents):'Not allocated'}</td>{all&&<td className="mono">{r.investor}</td>}</tr>)}</tbody></table></div>:<p className="support-copy">No redemption requests yet.</p>}</>}
    {stakeholder!=='investor'&&<><h3>Invoices and repayments</h3>{invoices.length?invoices.map(r=><details className="model-controls" key={String(r.id)}><summary>Invoice #{String(r.id)} · {label(['Submitted','Auto-approved','Approved','Financed','Rejected','Repaid'],r.status)}</summary>
      <dl className="detail-list"><div><dt>Invoice amount</dt><dd>{money(r.face)}</dd></div><div><dt>Gross advance</dt><dd>{money(r.advance)}</dd></div><div><dt>Principal remaining</dt><dd>{money(r.principal)}</dd></div></dl>{r.status===3n&&r.maturity<report.timestamp&&<p className="notice warning">This invoice is overdue.</p>}
      {r.breakdown&&<dl className="detail-list">{Object.entries(r.breakdown).map(([key,value])=><div key={key}><dt>{{netAdvance:'Net cash advanced',fee:'Processing fee earned once',principal:'Outstanding principal',baseInterest:'Earned unpaid base interest',overdueInterest:'Earned unpaid overdue interest',payerCollections:'Payer collections offset',smeCollections:'SME collections',reserve:'Reserve payable',released:'Reserve already released'}[key]}</dt><dd>{money(value)}</dd></div>)}</dl>}
      <dl className="detail-list"><div><dt>Principal repaid</dt><dd>{money(r.collectedPrincipal)}</dd></div><div><dt>Interest collected</dt><dd>{money(r.collectedBase+r.collectedOverdue)}</dd></div></dl><p className="footnote">Payer collections and SME repayments settle the same debt.</p>
    </details>):<p className="support-copy">No invoices yet.</p>}</>}
    <details className="calculation-notes"><summary>Record details</summary><p>Sepolia block {report.blockTag}. Funding statuses record manager confirmations; they do not independently verify bank payments.</p></details>
  </section>;
}
