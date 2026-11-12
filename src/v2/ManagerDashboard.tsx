import { useLedger } from '../chain/LedgerContext';
import { useInvoiceCredits } from '../finance/credits';
import { useFinance } from '../finance/FinanceContext';
import { ledgerNav } from '../finance/financing';
import { money } from '../finance/models';

/** Fund NAV from the invoice ledger: available funds + financed invoice amounts + service fees + interest accrued to today. */
export function PublicManagerDashboard({ title='Fund Manager dashboard' }: {title?:string}) {
  const {isV2Manager,v2Owner,events}=useLedger();
  const {data,loading,error,refresh,now}=useFinance();
  const credits=useInvoiceCredits();
  if(!isV2Manager)return null;
  const nav=data?ledgerNav(data,events,now,credits):null;
  return <section className="section-block"><div className="section-heading"><h2>{title}</h2><button className="btn o small" disabled={loading} onClick={()=>void refresh()}>Refresh reports</button></div>
    <p className="mono">{v2Owner}</p>
    {loading&&!data&&<p role="status">Loading fund records…</p>}{error&&<p role="alert">{error}</p>}
    {data&&nav&&<><p>Sepolia block {data.blockNumber}.</p><div className="metric-grid">{[['Fund NAV',money(nav.navCents)],['Available liquidity',money(nav.availableFundsCents)],['Outstanding principal',money(nav.outstandingCents)]].map(([label,value])=><div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <p className="footnote">NAV includes {money(nav.serviceFeesCents)} service fees and {money(nav.accruedInterestCents)} interest accrued to today on financed invoices.{nav.missingFinancingDates>0?` Interest is not yet included for ${nav.missingFinancingDates} invoice(s) whose financing date is still loading.`:''}</p></>}
  </section>;
}
