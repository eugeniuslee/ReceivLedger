import { useInvoiceReviews } from '../registration/invoiceReviews';
import { useRegistry } from '../registration/RegistryContext';
import { invoiceWork, useReviewCounts } from '../chain/ReviewCounts';
import { useLedger } from '../chain/LedgerContext';
import type { PageId } from '../chain/access';
import { PublicManagerDashboard } from '../v2/ManagerDashboard';
import type { FundSnapshot, ProvisionalSnapshot } from '../chain/chainLedger';
import { formatMoney } from '../chain/presentation';
import { InvoiceSummary } from '../components/InvoiceSummary';
import { SmeHome } from './Sme';
import { InvestorHome } from './Investor';
import { useFinance } from '../finance/FinanceContext';

export function Dashboard({ onNavigate }: { onNavigate?: (page: PageId) => void } = {}) {
  const { snapshot, loading, networkOk, isV2Manager } = useLedger();
  // One manager Home layout; fund NAV and receivables live on Fund & Financing.
  if (networkOk && snapshot?.role === 'manager') return <ManagerDashboard snapshot={snapshot} onNavigate={onNavigate} />;
  if (networkOk && isV2Manager) return <PublicManagerDashboard />;
  if (!networkOk) return <div className="empty-state">Connect to Sepolia to read your ReceivLedger view.</div>;
  if (loading && !snapshot) return <div className="empty-state">Loading wallet-specific contract data…</div>;
  if (!snapshot) return <div className="empty-state">Wallet data is unavailable. Refresh after checking your RPC connection.</div>;
  if (snapshot.role === 'manager') return <ManagerDashboard snapshot={snapshot} />;
  if (snapshot.role === 'investor') return <InvestorHome onNavigate={onNavigate} />;
  if (snapshot.role === 'inactiveInvestor') return <InvestorHome onNavigate={onNavigate} inactive />;
  if (snapshot.role === 'provisional') return <ProvisionalDashboard snapshot={snapshot} />;
  return <SmeHome onNavigate={onNavigate} />;
}

function ManagerDashboard({ snapshot, onNavigate }: { snapshot: FundSnapshot; onNavigate?: (page: PageId) => void }) {
  const { now } = useFinance();
  const counts = useReviewCounts();
  const { authenticated } = useRegistry();
  const outstanding = snapshot.totalFundSize - snapshot.availableFunds;
  const { reviews } = useInvoiceReviews();
  const { invoicesToApprove: pending, invoicesToFinance: readyToFinance, overdue, dueSoon } = invoiceWork(snapshot.invoices, now, reviews);
  const latest = [...snapshot.invoices].reverse();
  const reviewItems: [string, string, number | null, PageId][] = [
    ['Investor & SME applications', authenticated ? 'Pending KYC and company review' : 'Verify your wallet in Applications to see this count', counts.applications, 'applications'],
    ['RLU subscription requests', 'Investors asking to buy RLU', counts.subscriptions, 'funds'],
    ['RLU redemption requests', 'Investors asking to redeem RLU', counts.redemptions, 'funds'],
    ['Repayment proofs to check', authenticated ? 'Uploaded by SMEs; verify, then record repayment' : 'Verify your wallet in Applications to see this count', counts.repaymentProofs ?? null, 'invoices'],
    ['Invoices awaiting approval', 'Submitted by SMEs', pending, 'invoices'],
    ['Approved invoices to finance', 'Approved, not yet financed', readyToFinance, 'invoices'],
    ['Overdue invoices', 'Financed and past the due date', overdue, 'invoices'],
    ['Repayments due within 7 days', 'Financed invoices nearing their due date', dueSoon, 'invoices'],
  ];
  const outstandingItems = reviewItems.filter(([, , count]) => count !== null && count > 0).length;
  const availablePercent = snapshot.totalFundSize > 0n ? Number(snapshot.availableFunds * 100n / snapshot.totalFundSize) : 0;
  const metrics = [
    ['Total fund size', formatMoney(snapshot.totalFundSize), 'Issued S$ capital'],
    ['Available funds', formatMoney(snapshot.availableFunds), 'Available for financing'],
    ['Outstanding', formatMoney(outstanding), 'Currently financed'],
    ['Invoices', snapshot.invoiceCount.toString(), `${pending} awaiting review`],
  ];
  return <>
    <section className="metric-grid" aria-label="Fund summary">{metrics.map(([label, value, detail], index) => <div className={`metric${index === 0 ? ' emphasis' : ''}`} key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>)}</section>
    <section className="section-block fund-accounting" aria-labelledby="fund-accounting-title"><h3 id="fund-accounting-title">Fund accounting</h3>
      <div className="accounting-bar" role="img" aria-label={`${availablePercent}% available, ${100 - availablePercent}% financed`}><div style={{ width: `${availablePercent}%` }} /></div>
      <div className="bar-legend"><span><i className="legend-dot available" />Available {formatMoney(snapshot.availableFunds)} · {availablePercent}%</span><span><i className="legend-dot financed" />Financed {formatMoney(outstanding)} · {100 - availablePercent}%</span></div>
    </section>
    <section className="section-block" aria-labelledby="manager-review-title"><h3 id="manager-review-title">Needs your review</h3>
      {outstandingItems === 0 && <p className="support-copy">Nothing needs your review right now.</p>}
      <div className="review-grid">
        {reviewItems.map(([label, detail, count, page]) => { const active = count === null ? page === 'applications' : count > 0; return <div key={label} className={`review-card${count ? ' active' : ''}`}>
          <span className="review-label">{label}</span><strong>{count ?? '—'}</strong><small className="document-meta">{detail}</small>
          {active && onNavigate && <button className="btn o small" onClick={() => onNavigate(page)} aria-label={`Review ${label.toLowerCase()}`}>Review</button>}
        </div>; })}
      </div>
    </section>
    <InvoiceSummary invoices={latest} title="Latest invoices" empty="No invoices have been submitted on this contract." collapsedCount={3} />
  </>;
}

function ProvisionalDashboard({ snapshot }: { snapshot: ProvisionalSnapshot }) {
  return <section className="section-block">
    <h3>Wallet role not established</h3>
    <p className="support-copy">This wallet has no fund manager, investor or SME role yet.</p>
  </section>;
}
