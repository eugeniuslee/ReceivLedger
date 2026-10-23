import {money} from '../finance/models';
import type {V2Ledger} from './V2Ledger';
type Report=Awaited<ReturnType<V2Ledger['readReport']>>;
export function InvestorAssets({report}:{report:Report}){
  const a=report.assets;
  return <section className="section-block"><h2>My Assets — public wallet inspection</h2><p>Wallet {report.wallet}; Sepolia block {report.blockTag}. These are simulated balances from the selected V2 contract, not SGD custody or authenticated private records.</p>
    <dl className="detail-list">{[['Total fund assets before allocated exits',money(BigInt(report.fund.fundAssetsCents))],['Investment NAV for active units',money(a.nav)],['NAV per RLU2 (rounded to cents)',a.navPerRlu===null?'No active units':money(a.navPerRlu)],['Active holdings, including pending exit units',`${a.activeUnits/100n}.${(a.activeUnits%100n).toString().padStart(2,'0')} RLU2`],['Ownership of active fund',a.ownership],['Active holdings value',money(a.activeValue)],['Already allocated exit claim',money(a.allocatedClaim)],['Total personal simulated value',money(a.personalValue)]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    <p>Earned unpaid interest is included once in NAV; future interest is excluded. Allocated exits have fixed claims and no longer share later income. Display rounding does not determine execution prices.</p></section>;
}
export function ManagerReport({report}:{report:Report}){
  return <section className="section-block"><h2>SME concentration and NAV movements</h2><p>Complete public invoice totals at block {report.blockTag}. This inspection grants no Manager permissions.</p>
    <p>Available unreserved, uncommitted liquidity: {money(BigInt(report.fund.freeLiquidityCents))}. Earned unpaid interest: {money(BigInt(report.fund.accruedInterestCents))}. Expected losses: {money(BigInt(report.fund.impairmentCents))}.</p>
    <p>New capital usually lowers exposure percentages. Principal repayments lower exposure; interest accrual can raise NAV without cash. Defaults and investor redemption allocations can reduce NAV and raise concentration. Pending requests are proposals; approved commitments reserve capacity and liquidity.</p>
    {!report.concentrations.length&&<p>No V2 invoices at this block.</p>}
    {report.concentrations.map(r=><article className="section-block" key={r.entity}><h3>Verified SME {r.entity}</h3><p className="notice warning">{r.band}</p>
      <dl className="detail-list">{[['Outstanding principal',money(r.outstanding)],['Approved gross commitments',money(r.commitments)],['Pending requests',`${r.pendingCount}; proposed gross ${money(r.pendingPrincipal)}`],['Combined exposure / current NAV',r.navExposure],['S$100,000 facility used (including commitments)',r.creditUsed],['Invoices / repaid',`${r.invoiceCount} / ${r.repaidCount}`],['Principal recovered',money(r.principalRecovered)],['Interest collected',money(r.interestCollected)]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <ul>{r.maturities.map(m=><li key={String(m.id)}>Invoice {String(m.id)}: {m.overdue?`${-m.days} days overdue`:`${m.days} days to maturity`}</li>)}</ul>
      <ul>{r.payers.map(p=><li key={p.payer}>Common payer {p.payer}: total fund exposure including commitments {money(p.total)} ({p.percentage} of NAV).</li>)}</ul>
    </article>)}
    <h3>Recent NAV movement records</h3><p>Blocks {report.movementsFromBlock}–{report.blockTag}. This bounded history is not a lifetime return calculation. Positive Subscription NAV is investor capital, not investment income. Loan receivable impact includes principal and earned interest.</p>
    <p>Live earned interest since the last accounting checkpoint: {money(BigInt(report.fund.accruedInterestCents)-BigInt(report.fund.bookedAccruedCents))}. This is already included in current NAV; its journal event appears at the next financial checkpoint.</p>
    {!report.movements.length?<p>No NAV movement records in this range.</p>:<div style={{overflowX:'auto'}}><table><thead><tr>{['Time (UTC)','Type / reference','Cash','Receivable','Income / loss','NAV','Transaction'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{report.movements.map(m=><tr key={`${m.transaction}:${m.index}`}><td>{new Date(Number(m.timestamp)*1000).toISOString()}</td><td>{m.kind} #{String(m.reference)}</td><td>{money(m.cash)}</td><td>{money(m.loans)}</td><td>{money(m.income)}</td><td>{money(m.nav)}</td><td><a href={`https://sepolia.etherscan.io/tx/${m.transaction}`} target="_blank" rel="noreferrer">View receipt</a></td></tr>)}</tbody></table></div>}
  </section>;
}
