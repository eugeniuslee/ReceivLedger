import { useState } from 'react';
import { Finances } from './Finances';
import { useLedger } from '../chain/LedgerContext';
import { useFinance } from '../finance/FinanceContext';
import { borrowingCapacity, money } from '../finance/models';
import { FinancialSource, InvoiceAssessment, NavIllustration } from '../components/FinancialModels';

/** Manager's Finances tab (see Finances.tsx). */
export function Reports() {
  const { role, isV2Manager } = useLedger();
  if (role !== 'manager' && !isV2Manager) return <div className="notice error">Financial reporting is available to the fund manager. Personal investment illustrations are on investor Home.</div>;
  return <Finances />;
}

export function InvestorReporting() {
  const { role } = useLedger();
  const { data } = useFinance();
  if (role !== 'investor' && role !== 'inactiveInvestor') return null;
  return <><section className="section-block"><h2>Investment reporting data</h2><FinancialSource />{!data && <p className="support-copy">Supply, ownership and valuation illustration require a successful live fund read. Your existing wallet controls remain independent of this report.</p>}</section>{data && <NavIllustration snapshot={data} investor />}</>;
}

export function SmeFinancingAssessment() {
  const { account, role } = useLedger();
  const { data } = useFinance();
  const [id, setId] = useState('');
  if (role !== 'sme' && role !== 'provisional') return null;
  const own = data?.invoices.filter(row => row.sme.toLowerCase() === account?.toLowerCase() && (row.status === 'Submitted' || row.status === 'Approved')) ?? [];
  const selected = own.find(row => row.id.toString() === id) ?? own[0];
  return <section className="section-block"><h2>Your financing assessment</h2>{!selected && <FinancialSource />}{!data ? <p className="support-copy">Live portfolio data is required for your assessment. Existing invoice controls remain available.</p> : selected ? <><label className="filter-label">Your invoice<select value={selected.id.toString()} onChange={event => setId(event.target.value)}>{own.map(row => <option key={row.id.toString()} value={row.id.toString()}>#{row.id.toString()} · {row.payer}</option>)}</select></label><InvoiceAssessment key={selected.id.toString()} invoice={selected} /></> : <p className="support-copy">No Submitted or Approved invoices are currently available for this wallet's model assessment. Repaid records remain closed.</p>}</section>;
}

export function SmeCapacity() {
  const { account, role } = useLedger();
  const { data } = useFinance();
  if (!account || (role !== 'sme' && role !== 'provisional')) return null;
  const capacity = data ? borrowingCapacity(account, data) : null;
  return <section className="section-block"><h2>Illustrative available financing capacity</h2><FinancialSource />
    {capacity ? <><p className="capacity-value">{money(capacity.indicativeCapacityCents)}</p><p className="support-copy">Default unassessed scenario: 20% SME concentration cap × 50% risk factor, less this wallet's Financed principal, capped by fund liquidity after a 20% reserve. No sales evidence is assumed.</p></> : <p>Live fund data is unavailable. No financing capacity is substituted.</p>}
    <p className="footnote">A policy illustration, not approved credit or a cash balance. Each invoice still needs payer/maturity checks and manager review. Overdue records require review; the website does not add an automatic contract blocker.</p>
  </section>;
}
