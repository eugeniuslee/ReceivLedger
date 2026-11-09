import { useLedger } from '../chain/LedgerContext';
import { PublicManagerDashboard } from '../v2/ManagerDashboard';
import type { ChainInvoice, FundSnapshot, InactiveInvestorSnapshot, InvestorSnapshot, ProvisionalSnapshot, SmeSnapshot } from '../chain/chainLedger';
import { formatInteger, formatMoney } from '../chain/presentation';
import { WalletName } from '../components/WalletName';
import { InvestorReporting, SmeCapacity, SmeFinancingAssessment } from './Reports';
import { maturityState } from '../finance/models';
import { useFinance } from '../finance/FinanceContext';
import { financialDate } from '../finance/presentation';
import type { PageId } from '../chain/access';

type Navigate = (page: PageId) => void;

export function Dashboard({ onNavigate }: { onNavigate?: Navigate } = {}) {
  const { snapshot, loading, networkOk, isV2Manager } = useLedger();
  if (networkOk && isV2Manager) return <>{snapshot && snapshot.role !== 'provisional' && <HomeActions role={snapshot.role} onNavigate={onNavigate} />}<PublicManagerDashboard title="RLU2 fund overview" />{snapshot?.role === 'manager' && <details className="home-details"><summary>RLU fund records</summary><ManagerDashboard snapshot={snapshot} /></details>}</>;
  if (!networkOk) return <div className="empty-state">Connect to Sepolia to read your ReceivLedger view.</div>;
  if (loading && !snapshot) return <div className="empty-state">Loading wallet-specific contract data…</div>;
  if (!snapshot) return <div className="empty-state">Wallet data is unavailable. Refresh after checking your RPC connection.</div>;
  if (snapshot.role === 'manager') return <><HomeActions role="manager" onNavigate={onNavigate} /><ManagerDashboard snapshot={snapshot} /></>;
  if (snapshot.role === 'investor') return <><HomeActions role="investor" onNavigate={onNavigate} /><InvestorDashboard snapshot={snapshot} /></>;
  if (snapshot.role === 'inactiveInvestor') return <><HomeActions role="inactiveInvestor" onNavigate={onNavigate} /><InactiveInvestorDashboard snapshot={snapshot} /></>;
  if (snapshot.role === 'provisional') return <ProvisionalDashboard snapshot={snapshot} />;
  return <><HomeActions role="sme" onNavigate={onNavigate} /><SmeDashboard snapshot={snapshot} /></>;
}

function HomeActions({ role, onNavigate }: { role: 'manager' | 'investor' | 'inactiveInvestor' | 'sme'; onNavigate?: Navigate }) {
  if (!onNavigate) return null;
  const actions: { page: PageId; label: string }[] = role === 'manager'
    ? [{ page: 'purchases', label: 'Review purchases' }, { page: 'invoices', label: 'Review invoices' }, { page: 'applications', label: 'Review applications' }]
    : role === 'sme'
      ? [{ page: 'submitInvoice', label: 'Submit invoice' }, { page: 'invoices', label: 'View my invoices' }]
      : role === 'investor'
        ? [{ page: 'purchases', label: 'Buy RLU' }, { page: 'assets', label: 'Manage my tokens' }]
        : [{ page: 'assets', label: 'View my holdings' }];
  return <div className="home-actions" aria-label="Quick actions">{actions.map(({ page, label }, index) => <button key={page} className={`btn${index ? ' o' : ''}`} onClick={() => onNavigate(page)}>{label}</button>)}</div>;
}

function ManagerDashboard({ snapshot }: { snapshot: FundSnapshot }) {
  const outstanding = snapshot.totalFundSize - snapshot.availableFunds;
  const financed = snapshot.invoices.filter(invoice => invoice.status === 'Financed').length;
  const repaid = snapshot.invoices.filter(invoice => invoice.status === 'Repaid').length;
  const pending = snapshot.invoices.filter(invoice => invoice.status === 'Submitted').length;
  const latest = [...snapshot.invoices].reverse().slice(0, 5);
  const metrics = [
    ['Total fund size', formatMoney(snapshot.totalFundSize), 'Recorded capital'],
    ['Available funds', formatMoney(snapshot.availableFunds), 'Available for financing'],
    ['Outstanding', formatMoney(outstanding), `${financed} financed invoice${financed === 1 ? '' : 's'}`],
    ['Invoices', snapshot.invoiceCount.toString(), `${pending} awaiting review`],
  ];
  return <>
    <section className="metric-grid" aria-label="Fund summary">{metrics.map(([label, value, detail], index) => <div className={`metric${index === 0 ? ' emphasis' : ''}`} key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>)}</section>
    <section className="section-block"><h3>Capital allocation</h3>
        <div className="accounting-bar"><div style={{ width: snapshot.totalFundSize > 0n ? `${Number(snapshot.availableFunds * 100n / snapshot.totalFundSize)}%` : '0%' }} /></div>
        <div className="bar-legend"><span>Available {formatMoney(snapshot.availableFunds)}</span><span>Outstanding {formatMoney(outstanding)}</span></div>
    </section>
    <InvoiceSummary invoices={latest} title="Latest invoices" empty="No invoices have been submitted yet." />
    <details className="home-details"><summary>Fund account details</summary><dl className="detail-list">
      <div><dt>Fund manager wallet</dt><dd className="mono">{snapshot.manager}</dd></div>
      <div><dt>Your RLU balance</dt><dd>{formatInteger(snapshot.connectedBalance)} RLU</dd></div>
      <div><dt>Repaid invoices</dt><dd>{repaid}</dd></div>
    </dl><p className="footnote">Recorded financing and repayments track balances; they do not move SGD or ETH.</p></details>
  </>;
}

function InvestorDashboard({ snapshot }: { snapshot: InvestorSnapshot }) {
  return <>
    <section className="metric-grid investor-metrics">
      <div className="metric emphasis"><span>Your RLU balance</span><strong>{formatInteger(snapshot.connectedBalance)} RLU</strong><small>Current holdings</small></div>
      <div className="metric"><span>Investor approval</span><strong>{snapshot.approved ? 'Approved' : 'Not approved'}</strong><small>Wallet status</small></div>
    </section>
    <details className="home-details"><summary>Investment details and scenarios</summary><InvestorReporting /></details>
  </>;
}

function SmeDashboard({ snapshot }: { snapshot: SmeSnapshot }) {
  const { now } = useFinance();
  const submitted = snapshot.invoices.length;
  const active = snapshot.invoices.filter(invoice => invoice.status === 'Submitted' || invoice.status === 'Approved' || invoice.status === 'Financed').length;
  const outstanding = snapshot.invoices.filter(invoice => invoice.status === 'Financed').reduce((sum, invoice) => sum + invoice.amount, 0n);
  const repaid = snapshot.invoices.filter(invoice => invoice.status === 'Repaid').length;
  const upcoming = snapshot.invoices.filter(invoice => invoice.status === 'Financed' && invoice.maturity > now).sort((a, b) => a.maturity < b.maturity ? -1 : a.maturity > b.maturity ? 1 : 0).slice(0, 5);
  return <>
    <section className="metric-grid">
      <div className="metric emphasis"><span>Your submitted invoices</span><strong>{submitted}</strong><small>All invoices</small></div>
      <div className="metric"><span>Invoices in progress</span><strong>{active}</strong><small>Submitted, approved or financed</small></div>
      <div className="metric"><span>Outstanding financed principal</span><strong>{formatMoney(outstanding)}</strong><small>Financed invoices awaiting repayment</small></div>
      <div className="metric"><span>Repaid invoices</span><strong>{repaid}</strong><small>Completed repayments</small></div>
    </section>
    <InvoiceSummary invoices={snapshot.invoices.slice().reverse().slice(0, 5)} title="Your latest invoices" empty="You have not submitted any invoices yet." showSme={false} />
    {upcoming.length > 0 && <section className="section-block"><h3>Upcoming repayments</h3><ul className="upcoming-repayments">{upcoming.map(invoice => <li key={invoice.id.toString()}><span>Invoice #{invoice.id.toString()}<small>{financialDate(invoice.maturity)} SGT</small></span><strong>{formatMoney(invoice.amount)}</strong></li>)}</ul></section>}
    <details className="home-details"><summary>Financing estimates and capacity</summary><SmeCapacity /><SmeFinancingAssessment /></details>
  </>;
}

function InvoiceSummary({ invoices, title, empty, showSme = true }: { invoices: ChainInvoice[]; title: string; empty: string; showSme?: boolean }) {
  const { now } = useFinance();
  return <section className="section-block invoice-preview"><h3>{title}</h3>
    {invoices.length ? <div className="table-scroll"><table><thead><tr><th>ID</th><th>Payer</th><th>Invoice face value</th><th>Maturity (SGT)</th><th>Status</th>{showSme && <th>SME wallet</th>}</tr></thead>
      <tbody>{invoices.map(invoice => <tr key={invoice.id.toString()}><td>#{invoice.id.toString()}</td><td>{invoice.payer}</td><td>{formatMoney(invoice.amount)}</td><td>{financialDate(invoice.maturity)}</td><td><span className={`status ${invoice.status.toLowerCase()}`}>{invoice.status}</span><small className={`timing-label${maturityState(invoice, now).overdue ? ' late' : ''}`}>{maturityState(invoice, now).label}</small></td>{showSme && <td><WalletName address={invoice.sme} /></td>}</tr>)}</tbody>
    </table></div> : <div className="empty-state compact">{empty}</div>}
  </section>;
}

function InactiveInvestorDashboard({ snapshot }: { snapshot: InactiveInvestorSnapshot }) {
  return <>
    <section className="metric-grid investor-metrics">
      <div className="metric emphasis"><span>Remaining RLU holdings</span><strong>{formatInteger(snapshot.connectedBalance)} RLU</strong><small>Current holdings</small></div>
      <div className="metric"><span>Investor approval</span><strong>Not approved</strong><small>Wallet status</small></div>
    </section>
    <section className="section-block"><h3>Investor account status</h3>
      <p className="support-copy">Your holdings remain in this wallet. Transfers are unavailable until the fund manager approves your account.</p>
    </section>
    <details className="home-details"><summary>Investment details and scenarios</summary><InvestorReporting /></details>
  </>;
}

function ProvisionalDashboard({ snapshot }: { snapshot: ProvisionalSnapshot }) {
  return <section className="section-block">
    <h3>Complete your account setup</h3>
    <p className="support-copy">Choose an Investor or SME account to submit your application for review.</p>
  </section>;
}
