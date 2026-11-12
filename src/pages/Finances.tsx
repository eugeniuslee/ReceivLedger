import { useState } from 'react';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { useFinance } from '../finance/FinanceContext';
import { calculateFinancing, financingDays, invoiceIncome, ledgerNav, termsAt, type InvoiceIncomeRow } from '../finance/financing';
import { money } from '../finance/models';
import { financialDate } from '../finance/presentation';
import { compactAddress, formatInteger } from '../chain/presentation';

type Filter = 'All' | 'Financed' | 'Repaid';
const date = (seconds: bigint | null) => seconds === null ? '—' : financialDate(seconds).replace(/,\s*\d{1,2}:\d{2}\s*[ap]m$/i, '');

/** Manager's Finances tab: what makes up the Fund NAV, and what each invoice earns. */
export function Finances() {
  const { events } = useLedger();
  const { data, now, loading, error, refresh } = useFinance();
  if (!data) return <section className="section-block"><h2>Finances</h2><p className="empty-state compact">{loading ? 'Reading fund records from Sepolia…' : error ? `Fund records could not be loaded: ${error}` : 'Fund records are unavailable. Refresh after checking your connection.'}</p>{!loading && <button className="btn o small" onClick={() => void refresh()}>Retry</button>}</section>;

  const nav = ledgerNav(data, events ?? [], now);
  const rows = invoiceIncome(data.invoices, events ?? [], now);
  const capitalCents = data.totalFundSize * 100n;
  const feesCents = nav.serviceFeesCents + nav.realisedFeesCents;
  const interestCents = nav.accruedInterestCents + nav.realisedInterestCents;
  const unreconciledCents = nav.availableFundsCents + nav.outstandingCents - capitalCents;
  const receivableCents = nav.outstandingCents + nav.serviceFeesCents + nav.accruedInterestCents;
  const navPerRlu = data.totalSupply > 0n ? (nav.navCents * 2n + data.totalSupply) / (data.totalSupply * 2n) : null;
  // Income the currently financed invoices will have earned by their due dates, less what has accrued so far.
  const stillToEarnCents = rows.filter(row => row.invoice.status === 'Financed' && row.financedAt !== null).reduce((sum, row) => {
    const atDue = calculateFinancing(row.invoice.amount * 100n, financingDays(row.financedAt!, row.invoice.maturity), termsAt(row.financedAt!));
    return sum + atDue.serviceFeeCents + atDue.interestCents - row.profitCents;
  }, 0n);
  const terms = termsAt(now);

  return <>
    <section className="metric-grid" aria-label="Fund summary">
      <div className="metric emphasis"><span>Fund NAV</span><strong>{money(nav.navCents)}</strong><small>Fund capital + income earned</small></div>
      <div className="metric"><span>NAV per RLU</span><strong>{navPerRlu === null ? 'No RLU issued' : money(navPerRlu)}</strong><small>{formatInteger(data.totalSupply)} RLU in issue</small></div>
      <div className="metric"><span>Fund capital</span><strong>{money(capitalCents)}</strong><small>Raised from subscriptions</small></div>
      <div className="metric"><span>Income earned</span><strong>{money(nav.totalIncomeCents)}</strong><small>Service fees + interest to date</small></div>
    </section>
    <section className="metric-grid two-up" aria-label="Where the fund's money is">
      <div className="metric"><span>Available funds</span><strong>{money(nav.availableFundsCents)}</strong><small>Ready for financing</small></div>
      <div className="metric"><span>Receivables from SMEs</span><strong>{money(receivableCents)}</strong><small>Financed invoices + fees + interest</small></div>
    </section>

    <section className="dashboard-grid">
      <div className="section-block" aria-labelledby="nav-bridge-title"><h3 id="nav-bridge-title">How the NAV is built</h3>
        <dl className="detail-list">
          <div><dt>Fund capital</dt><dd>{money(capitalCents)}</dd></div>
          <div><dt>+ Service fees earned</dt><dd>{money(feesCents)}</dd></div>
          <div><dt>+ Interest earned</dt><dd>{money(interestCents)}</dd></div>
          {unreconciledCents !== 0n && <div><dt>+ Unreconciled ledger difference</dt><dd>{money(unreconciledCents)}</dd></div>}
          <div><dt><b>= Fund NAV</b></dt><dd><b>{money(nav.navCents)}</b></dd></div>
        </dl>
        {unreconciledCents !== 0n && <p className="notice warning">Available funds plus outstanding financing differ from fund capital by {money(unreconciledCents)}. Check the ledger records.</p>}
        <p className="footnote">Income is earned at {terms.serviceFeeBps / 100}% service fee on each invoice and {terms.annualInterestBps / 100}% a year simple interest on the {terms.advanceBps / 100}% cash advance, counted daily until repayment or the due date.</p>
      </div>
      <div className="section-block" aria-labelledby="nav-assets-title"><h3 id="nav-assets-title">Where the NAV sits</h3>
        <dl className="detail-list">
          <div><dt>Available funds</dt><dd>{money(nav.availableFundsCents)}</dd></div>
          <div><dt>+ Invoice amounts financed</dt><dd>{money(nav.outstandingCents)}</dd></div>
          <div><dt>+ Fees and interest due on financed invoices</dt><dd>{money(nav.serviceFeesCents + nav.accruedInterestCents)}</dd></div>
          <div><dt>+ Income collected on repaid invoices</dt><dd>{money(nav.realisedIncomeCents)}</dd></div>
          <div><dt><b>= Fund NAV</b></dt><dd><b>{money(nav.navCents)}</b></dd></div>
        </dl>
        <dl className="detail-list">
          <div><dt>Still to earn on current financing</dt><dd>{money(stillToEarnCents)}</dd></div>
        </dl>
        <p className="footnote">“Still to earn” is the further interest the financed invoices add if repaid on their due dates. It is not in the NAV yet.</p>
      </div>
    </section>
    {nav.missingFinancingDates > 0 && <p className="footnote">Interest is not yet included for {nav.missingFinancingDates} invoice(s) whose financing or repayment date is still loading.</p>}
    <InvoiceIncomeTable rows={rows} />
  </>;
}

function InvoiceIncomeTable({ rows }: { rows: InvoiceIncomeRow[] }) {
  const { displayName } = useRegistry();
  const [filter, setFilter] = useState<Filter>('All');
  const visible = rows.filter(row => filter === 'All' || row.invoice.status === filter);
  const total = visible.reduce((sum, row) => ({ amount: sum.amount + row.invoice.amount * 100n, fee: sum.fee + row.serviceFeeCents, interest: sum.interest + row.interestCents, profit: sum.profit + row.profitCents, nav: sum.nav + row.navContributionCents }), { amount: 0n, fee: 0n, interest: 0n, profit: 0n, nav: 0n });
  return <section className="section-block">
    <div className="section-heading"><h2>Invoice income</h2>
      <div className="operations-tabs" role="group" aria-label="Invoice filter">{(['All', 'Financed', 'Repaid'] as Filter[]).map(value => <button key={value} className={`btn small ${filter === value ? '' : 'o'}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div>
    </div>
    <p className="support-copy">Financed invoices show income to date; repaid invoices show what was actually earned. Profit = service fee + interest.</p>
    {visible.length ? <div className="table-scroll"><table className="income-table"><thead><tr><th>Invoice</th><th>SME</th><th>Status</th><th>Invoice amount</th><th>Cash advanced</th><th>Financed</th><th>Repaid / due</th><th>Days</th><th>Service fee</th><th>Interest</th><th>Profit</th><th>Adds to NAV</th></tr></thead>
      <tbody>{visible.map(row => <tr key={row.invoice.id.toString()}>
        <td>#{row.invoice.id.toString()}<small className="document-meta">{row.invoice.payer}</small></td>
        <td>{displayName(row.invoice.sme) ?? <span className="mono" title={row.invoice.sme}>{compactAddress(row.invoice.sme)}</span>}</td>
        <td><span className={`status ${row.invoice.status.toLowerCase()}`}>{row.invoice.status}</span></td>
        <td>{money(row.invoice.amount * 100n)}</td>
        <td>{money(row.advanceCents)}</td>
        <td>{date(row.financedAt)}</td>
        <td>{row.repaidAt !== null ? date(row.repaidAt) : `Due ${date(row.invoice.maturity)}`}</td>
        <td>{row.days === null ? '—' : row.days.toString()}</td>
        <td>{money(row.serviceFeeCents)}</td>
        <td>{row.datesPending ? '—' : money(row.interestCents)}</td>
        <td><b>{money(row.profitCents)}</b></td>
        <td>{money(row.navContributionCents)}</td>
      </tr>)}</tbody>
      <tfoot><tr><th scope="row" colSpan={3}>Total</th><td>{money(total.amount)}</td><td colSpan={4} /><td>{money(total.fee)}</td><td>{money(total.interest)}</td><td><b>{money(total.profit)}</b></td><td>{money(total.nav)}</td></tr></tfoot>
    </table></div> : <p className="empty-state compact">{filter === 'All' ? 'No invoices have been financed yet.' : `No ${filter.toLowerCase()} invoices.`}</p>}
    <p className="footnote">“Adds to NAV” is the invoice amount plus income for financed invoices, and the income collected for repaid invoices (their principal is already back in available funds).</p>
  </section>;
}
