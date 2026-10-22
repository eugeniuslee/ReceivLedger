import { useLedger } from '../chain/LedgerContext';
import type { ChainInvoice, FundSnapshot, InactiveInvestorSnapshot, InvestorSnapshot, ProvisionalSnapshot, SmeSnapshot } from '../chain/chainLedger';
import { formatInteger, formatMoney } from '../chain/presentation';
import { WalletName } from '../components/WalletName';
import { InvestorReporting, SmeFinancingAssessment } from './Reports';
import { maturityState } from '../finance/models';
import { useFinance } from '../finance/FinanceContext';
import { financialDate } from '../finance/presentation';

export function Dashboard() {
  const { snapshot, loading, networkOk } = useLedger();
  if (!networkOk) return <div className="empty-state">Connect to Sepolia to read your ReceivLedger view.</div>;
  if (loading && !snapshot) return <div className="empty-state">Loading wallet-specific contract data…</div>;
  if (!snapshot) return <div className="empty-state">Wallet data is unavailable. Refresh after checking your RPC connection.</div>;
  if (snapshot.role === 'manager') return <ManagerDashboard snapshot={snapshot} />;
  if (snapshot.role === 'investor') return <InvestorDashboard snapshot={snapshot} />;
  if (snapshot.role === 'inactiveInvestor') return <InactiveInvestorDashboard snapshot={snapshot} />;
  if (snapshot.role === 'provisional') return <ProvisionalDashboard snapshot={snapshot} />;
  return <SmeDashboard snapshot={snapshot} />;
}

function ManagerDashboard({ snapshot }: { snapshot: FundSnapshot }) {
  const outstanding = snapshot.totalFundSize - snapshot.availableFunds;
  const financed = snapshot.invoices.filter(invoice => invoice.status === 'Financed').length;
  const repaid = snapshot.invoices.filter(invoice => invoice.status === 'Repaid').length;
  const pending = snapshot.invoices.filter(invoice => invoice.status === 'Submitted').length;
  const latest = [...snapshot.invoices].reverse().slice(0, 5);
  const metrics = [
    ['Total fund size', formatMoney(snapshot.totalFundSize), 'Simulated S$ capital'],
    ['Available funds', formatMoney(snapshot.availableFunds), 'Available for simulated financing'],
    ['Outstanding', formatMoney(outstanding), 'Total fund size less available funds'],
    ['Invoices', snapshot.invoiceCount.toString(), `${pending} awaiting review`],
  ];
  return <>
    <section className="metric-grid" aria-label="Fund summary">{metrics.map(([label, value, detail], index) => <div className={`metric${index === 0 ? ' emphasis' : ''}`} key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>)}</section>
    <section className="dashboard-grid">
      <div className="section-block"><h3>Fund manager overview</h3><dl className="detail-list">
        <div><dt>Fund manager wallet</dt><dd className="mono">{snapshot.manager}</dd></div>
        <div><dt>Connected RLU balance</dt><dd>{formatInteger(snapshot.connectedBalance)} RLU</dd></div>
        <div><dt>Financed invoices</dt><dd>{financed}</dd></div><div><dt>Repaid invoices</dt><dd>{repaid}</dd></div>
      </dl></div>
      <div className="section-block"><h3>Fund accounting</h3><p className="support-copy">Financing and repayment update simulated S$ balances only. No SGD or ETH is transferred. RLU has 0 decimals.</p>
        <div className="accounting-bar"><div style={{ width: snapshot.totalFundSize > 0n ? `${Number(snapshot.availableFunds * 100n / snapshot.totalFundSize)}%` : '0%' }} /></div>
        <div className="bar-legend"><span>Available {formatMoney(snapshot.availableFunds)}</span><span>Outstanding {formatMoney(outstanding)}</span></div>
      </div>
    </section>
    <InvoiceSummary invoices={latest} title="Latest invoices" empty="No invoices have been submitted on this contract." />
  </>;
}

function InvestorDashboard({ snapshot }: { snapshot: InvestorSnapshot }) {
  return <>
    <section className="metric-grid investor-metrics">
      <div className="metric emphasis"><span>Your RLU balance</span><strong>{formatInteger(snapshot.connectedBalance)} RLU</strong><small>Connected wallet · 0 decimals</small></div>
      <div className="metric"><span>Investor approval</span><strong>{snapshot.approved ? 'Approved' : 'Not approved'}</strong><small>Read from approvedInvestors(your wallet)</small></div>
    </section>
    <section className="section-block"><h3>Investor account</h3><p className="support-copy">Use the Transfer RLU page to send tokens from this wallet. Transfer rules require both wallets to be approved investors.</p></section>
    <InvestorReporting />
  </>;
}

function SmeDashboard({ snapshot }: { snapshot: SmeSnapshot }) {
  const submitted = snapshot.invoices.length;
  const active = snapshot.invoices.filter(invoice => invoice.status === 'Submitted' || invoice.status === 'Approved' || invoice.status === 'Financed').length;
  const outstanding = snapshot.invoices.filter(invoice => invoice.status === 'Financed').reduce((sum, invoice) => sum + invoice.amount, 0n);
  const repaid = snapshot.invoices.filter(invoice => invoice.status === 'Repaid').length;
  return <>
    <section className="metric-grid">
      <div className="metric emphasis"><span>Your submitted invoices</span><strong>{submitted}</strong><small>Matched to this wallet from contract mappings</small></div>
      <div className="metric"><span>Invoices in progress</span><strong>{active}</strong><small>Submitted, approved or financed</small></div>
      <div className="metric"><span>Outstanding financed principal</span><strong>{formatMoney(outstanding)}</strong><small>Financed face value only · simulated accounting</small></div>
      <div className="metric"><span>Repaid invoices</span><strong>{repaid}</strong><small>Closed records · excluded from outstanding</small></div>
    </section>
    <InvoiceSummary invoices={snapshot.invoices.slice().reverse().slice(0, 8)} title="Your invoice status" empty="No invoices submitted by this wallet were found in contract mappings." />
    <p className="footnote">Invoice ownership is matched to the SME address stored in the contract; this does not verify a real-world identity.</p>
    <SmeFinancingAssessment />
  </>;
}

function InvoiceSummary({ invoices, title, empty }: { invoices: ChainInvoice[]; title: string; empty: string }) {
  const { now } = useFinance();
  return <section className="section-block invoice-preview"><h3>{title}</h3>
    {invoices.length ? <div className="table-scroll"><table><thead><tr><th>ID</th><th>Payer</th><th>Invoice face value</th><th>Maturity (SGT)</th><th>Status</th><th>SME wallet</th></tr></thead>
      <tbody>{invoices.map(invoice => <tr key={invoice.id.toString()}><td>#{invoice.id.toString()}</td><td>{invoice.payer}</td><td>{formatMoney(invoice.amount)}</td><td>{financialDate(invoice.maturity)}</td><td><span className={`status ${invoice.status.toLowerCase()}`}>{invoice.status}</span><small className={`timing-label${maturityState(invoice, now).overdue ? ' late' : ''}`}>{maturityState(invoice, now).label}</small></td><td><WalletName address={invoice.sme} /></td></tr>)}</tbody>
    </table></div> : <div className="empty-state compact">{empty}</div>}
  </section>;
}

function InactiveInvestorDashboard({ snapshot }: { snapshot: InactiveInvestorSnapshot }) {
  return <>
    <section className="metric-grid investor-metrics">
      <div className="metric emphasis"><span>Remaining RLU holdings</span><strong>{formatInteger(snapshot.connectedBalance)} RLU</strong><small>On-chain balance · RLU has 0 decimals</small></div>
      <div className="metric"><span>Investor approval</span><strong>Not approved</strong><small>Read from approvedInvestors(your wallet)</small></div>
    </section>
    <section className="section-block"><h3>Investor account status</h3>
      <p className="support-copy">This wallet is not currently approved. Revoking approval does not automatically redeem, transfer or burn RLU. Current approval alone does not establish whether approval was previously revoked. The contract does not provide an investor redemption function.</p>
    </section>
    <InvestorReporting />
  </>;
}

function ProvisionalDashboard({ snapshot }: { snapshot: ProvisionalSnapshot }) {
  return <section className="section-block">
    <h3>Wallet role not established</h3>
    <p className="support-copy">This wallet is not the fund manager, has no current investor approval, and has no verified investor or invoice history in the indexed records. ReceivLedger does not register user roles on-chain.</p>
    <p className="footnote">No SME registration is implied. Existing roles can be identified only from the contract manager, current investor approval, historical investor events or invoices stored for this wallet.</p>
  </section>;
}
