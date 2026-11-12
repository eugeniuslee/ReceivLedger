import { useMemo, useState } from 'react';
import { useInvoiceCredits } from '../finance/credits';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { useFinance } from '../finance/FinanceContext';
import { invoiceIncome } from '../finance/financing';
import { maturityState, money } from '../finance/models';
import { financialDate } from '../finance/presentation';
import { compactAddress, formatMoney } from '../chain/presentation';
import type { ChainInvoice } from '../chain/chainLedger';

interface SmeRow {
  wallet: string; invoices: ChainInvoice[]; outstandingCents: bigint; receivableCents: bigint;
  financedTotalCents: bigint; incomeCents: bigint; overdue: number; pending: number;
}

/** Manager's SME tab: every invoice-submitting wallet, its exposure and payment record. */
export function Smes() {
  const { role, networkOk, snapshot, events } = useLedger();
  const { now } = useFinance();
  const credits = useInvoiceCredits();
  const { displayName } = useRegistry();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const invoices = snapshot?.role === 'manager' ? snapshot.invoices : [];
  const rows = useMemo(() => {
    const income = new Map(invoiceIncome(invoices, events ?? [], now, credits).map(row => [row.invoice.id.toString(), row]));
    const bySme = new Map<string, SmeRow>();
    for (const invoice of invoices) {
      const key = invoice.sme.toLowerCase();
      const row = bySme.get(key) ?? { wallet: invoice.sme, invoices: [], outstandingCents: 0n, receivableCents: 0n, financedTotalCents: 0n, incomeCents: 0n, overdue: 0, pending: 0 };
      row.invoices.push(invoice);
      const earned = income.get(invoice.id.toString());
      if (invoice.status === 'Financed') { row.outstandingCents += invoice.amount * 100n; row.receivableCents += earned?.navContributionCents ?? invoice.amount * 100n; }
      if (invoice.status === 'Financed' || invoice.status === 'Repaid') row.financedTotalCents += invoice.amount * 100n;
      if (earned) row.incomeCents += earned.profitCents;
      if (maturityState(invoice, now).overdue) row.overdue++;
      if (invoice.status === 'Submitted' || invoice.status === 'Approved') row.pending++;
      bySme.set(key, row);
    }
    return [...bySme.values()].sort((a, b) => b.overdue - a.overdue || (b.receivableCents > a.receivableCents ? 1 : b.receivableCents < a.receivableCents ? -1 : 0));
  }, [invoices, events, now, credits]);

  if (role !== 'manager') return <div className="notice error" role="alert">The SME overview is available only to the fund manager.</div>;
  if (!networkOk) return <div className="empty-state">Switch to Sepolia to load SME records.</div>;
  if (!snapshot) return <div className="empty-state">Loading SME records…</div>;

  const term = query.trim().toLowerCase();
  const visible = term ? rows.filter(row => row.wallet.toLowerCase().includes(term) || (displayName(row.wallet) ?? '').toLowerCase().includes(term)) : rows;
  const totals = rows.reduce((sum, row) => ({ outstanding: sum.outstanding + row.outstandingCents, receivable: sum.receivable + row.receivableCents, overdue: sum.overdue + (row.overdue ? 1 : 0) }), { outstanding: 0n, receivable: 0n, overdue: 0 });
  const detail = selected ? rows.find(row => row.wallet.toLowerCase() === selected) : undefined;

  return <>
    <section className="metric-grid" aria-label="SME summary">
      <div className="metric emphasis"><span>SMEs</span><strong>{rows.length}</strong><small>Wallets that submitted invoices</small></div>
      <div className="metric"><span>Outstanding financing</span><strong>{money(totals.outstanding)}</strong><small>Invoice amounts financed</small></div>
      <div className="metric"><span>Receivables from SMEs</span><strong>{money(totals.receivable)}</strong><small>Including fees and interest to date</small></div>
      <div className="metric"><span>SMEs with overdue invoices</span><strong>{totals.overdue}</strong><small>Need follow-up</small></div>
    </section>
    <section className="section-block">
      <div className="section-heading"><h2>SME overview</h2>
        <label className="investor-lookup-form"><span className="sr-only">Search SMEs by name or wallet</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or wallet · 0x…" /></label>
      </div>
      {!rows.length ? <p className="empty-state compact">No SME has submitted an invoice yet.</p>
        : !visible.length ? <p className="empty-state compact">No SMEs match “{query.trim()}”.</p>
        : <div className="table-scroll"><table><thead><tr><th>SME name</th><th>Wallet</th><th>Invoices</th><th>Outstanding</th><th>Receivable</th><th>Income earned</th><th>Overdue</th><th>Action</th></tr></thead>
          <tbody>{visible.map(row => <tr key={row.wallet}>
            <td>{displayName(row.wallet) ?? <span className="sub">Name unavailable</span>}</td>
            <td><span className="mono" title={row.wallet}>{compactAddress(row.wallet)}</span></td>
            <td>{row.invoices.length}{row.pending ? <small className="document-meta">{row.pending} awaiting review</small> : null}</td>
            <td>{money(row.outstandingCents)}</td>
            <td>{money(row.receivableCents)}</td>
            <td>{money(row.incomeCents)}</td>
            <td>{row.overdue ? <span className="status rejected">{row.overdue} overdue</span> : <span className="status approved">None</span>}</td>
            <td><button className="btn small outline" aria-expanded={selected === row.wallet.toLowerCase()} onClick={() => setSelected(value => value === row.wallet.toLowerCase() ? null : row.wallet.toLowerCase())}>{selected === row.wallet.toLowerCase() ? 'Hide' : 'Details'}</button></td>
          </tr>)}</tbody></table></div>}
    </section>
    {detail && <section className="section-block" aria-label="SME details">
      <div className="section-heading"><h3>{displayName(detail.wallet) ?? compactAddress(detail.wallet)}</h3><button className="btn o small" onClick={() => setSelected(null)}>Close</button></div>
      <dl className="detail-list">
        <div><dt>Wallet</dt><dd className="mono selectable-address">{detail.wallet}</dd></div>
        <div><dt>Total financed to date</dt><dd>{money(detail.financedTotalCents)}</dd></div>
        <div><dt>Income earned from this SME</dt><dd>{money(detail.incomeCents)}</dd></div>
      </dl>
      <div className="table-scroll"><table><thead><tr><th>Invoice</th><th>Payer</th><th>Amount</th><th>Due (SGT)</th><th>Status</th></tr></thead>
        <tbody>{detail.invoices.slice().reverse().map(invoice => <tr key={invoice.id.toString()}><td>#{invoice.id.toString()}</td><td>{invoice.payer}</td><td>{formatMoney(invoice.amount)}</td><td>{financialDate(invoice.maturity)}</td>
          <td><span className={`status ${invoice.status.toLowerCase()}`}>{invoice.status}</span><small className={`timing-label${maturityState(invoice, now).overdue ? ' late' : ''}`}>{maturityState(invoice, now).label}</small></td></tr>)}</tbody></table></div>
    </section>}
  </>;
}
