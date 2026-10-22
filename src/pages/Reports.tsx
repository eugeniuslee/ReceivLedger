import { useState } from 'react';
import { useLedger } from '../chain/LedgerContext';
import { useFinance } from '../finance/FinanceContext';
import { borrowingCapacity, money, portfolio, prospectiveIncome } from '../finance/models';
import { formatInteger } from '../chain/presentation';
import { FeeCalculator, FinancialSource, InvoiceAssessment, NavIllustration, useModelAssumptions } from '../components/FinancialModels';

export function Reports() {
  const { role } = useLedger();
  if (role !== 'manager') return <div className="notice error">Financial reporting is available to the fund manager. Personal investment illustrations are on investor Home.</div>;
  return <ManagerReports />;
}
function ManagerReports() {
  const { data, now } = useFinance();
  const { assumptions, controls, error } = useModelAssumptions();
  const summary = data ? portfolio(data, now) : null;
  const [selectedId, setSelectedId] = useState('');
  const candidates = data?.invoices.filter(row => row.status === 'Submitted' || row.status === 'Approved') ?? [];
  const selected = candidates.find(row => row.id.toString() === selectedId) ?? candidates[0];
  return <>
    <section className="section-block"><div className="section-heading"><h2>Fund financial reporting</h2><span className="source-tag">Read-only Sepolia accounting</span></div><FinancialSource />
      <p className="support-copy">Contract values are simulated SGD accounting. Actual invoice statuses and token supply come from Sepolia. Modelled fees, impairment and NAV scenarios below are separate and do not alter those records.</p>
      {!data && <p className="empty-state compact">Live fund data is required to display blockchain metrics. No sample balances are substituted.</p>}
    </section>
    {data && summary && <>
      <section className="metric-grid"><div className="metric emphasis"><span>Simulated fund capital</span><strong>{money(data.totalFundSize * 100n)}</strong><small>totalFundSize · not NAV</small></div><div className="metric"><span>Available financing capacity</span><strong>{money(data.availableFunds * 100n)}</strong><small>availableFunds</small></div><div className="metric"><span>Outstanding principal</span><strong>{money(summary.outstandingCents)}</strong><small>{summary.counts.Financed} Financed invoice(s)</small></div><div className="metric"><span>Total RLU supply</span><strong>{formatInteger(data.totalSupply)}</strong><small>On-chain · 0 decimals</small></div></section>
      {summary.reconciliationCents !== 0n && <div className="notice warning" role="alert">Accounting mismatch: capital minus available funds minus financed principal is {money(summary.reconciliationCents)}. Investigate the records before relying on the model.</div>}
      <section className="dashboard-grid"><div className="section-block"><h2>Invoice status breakdown</h2><div className="status-breakdown">{Object.entries(summary.counts).map(([status, count]) => <div key={status}><span>{status}</span><strong>{count}</strong></div>)}<div className="overdue-stat"><span>Overdue (subset of Financed)</span><strong>{summary.overdueCount}</strong></div></div><p className="footnote">Overdue principal: {money(summary.overdueCents)}. Repaid invoice principal total: {money(summary.repaidPrincipalCents)}; this is principal turnover, not revenue or profit.</p></div>
        <div className="section-block"><h2>Income and risk scenario</h2><p>Contract financing-fee income: <b>not supported</b>. Principal repayments do not create fee income.</p>{controls}{error && <p className="inline-error" role="alert">{error}</p>}
          {assumptions && <p className="scenario-total"><span>Hypothetical remaining-term gross income</span><strong>{money(prospectiveIncome(data, now, assumptions.annualFeeBps))}</strong></p>}
          <p className="footnote">Uses actual full financed principal × selected annual discount rate × rounded-up remaining days / 365. Overdue and repaid invoices are excluded. No service fee is assumed for existing financing. This is a forward what-if, not accrued or realised income, and it is not automatically added to NAV.</p>
        </div></section>
      <section className="section-block"><h2>Portfolio exposure by payer</h2><p className="support-copy">Current Financed invoices, grouped with Solidity's ASCII-only lower-casing. Whitespace remains significant. Contract cap per payer: {money(data.maxPayerExposure * 100n)}.</p>
        {summary.payers.length ? <div className="table-scroll"><table><thead><tr><th>Payer</th><th>Invoices</th><th>Outstanding</th><th>% of fund capital</th><th>Overdue principal</th><th>Cap headroom</th></tr></thead><tbody>{summary.payers.map(row => <tr key={row.key}><td>{row.name}</td><td>{row.count}</td><td>{money(row.outstandingCents)}</td><td>{data.totalFundSize > 0n ? `${(row.outstandingCents * 10000n / (data.totalFundSize * 100n) / 100n).toString()}.${String(row.outstandingCents * 10000n / (data.totalFundSize * 100n) % 100n).padStart(2, '0')}%` : 'Not defined'}</td><td>{money(row.overdueCents)}</td><td>{money(data.maxPayerExposure * 100n - row.outstandingCents)}</td></tr>)}</tbody></table></div> : <p className="empty-state compact">No outstanding financed invoices. No payer exposure is invented.</p>}
      </section>
      <NavIllustration snapshot={data} />
      <section className="section-block"><h2>Review an actual financing request</h2>{selected ? <><label className="filter-label">Invoice<select value={selected.id.toString()} onChange={event => setSelectedId(event.target.value)}>{candidates.map(row => <option key={row.id.toString()} value={row.id.toString()}>#{row.id.toString()} · {row.payer} · {row.status}</option>)}</select></label><InvoiceAssessment key={selected.id.toString()} invoice={selected} /></> : <p className="empty-state compact">There are no Submitted or Approved invoices at this block. Use the standalone calculator below to explore terms without creating a blockchain record.</p>}</section>
    </>}
    <FeeCalculator />
  </>;
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
