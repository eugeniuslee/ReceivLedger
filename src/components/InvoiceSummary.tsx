import { useState } from 'react';
import type { ChainInvoice } from '../chain/chainLedger';
import { formatMoney } from '../chain/presentation';
import { useFinance } from '../finance/FinanceContext';
import { maturityState } from '../finance/models';
import { financialDate } from '../finance/presentation';
import { WalletName } from './WalletName';

/** Invoice table; with `collapsedCount`, shows the newest few and expands to all. */
export function InvoiceSummary({ invoices: all, title, empty, collapsedCount }: { invoices: ChainInvoice[]; title: string; empty: string; collapsedCount?: number }) {
  const { now } = useFinance();
  const [expanded, setExpanded] = useState(false);
  const collapsible = collapsedCount !== undefined && all.length > collapsedCount;
  const invoices = collapsible && !expanded ? all.slice(0, collapsedCount) : all;
  return <section className="section-block invoice-preview"><div className="section-heading"><h3>{title}</h3>{collapsible && <button className="btn o small" aria-expanded={expanded} aria-label={expanded ? `Show latest ${collapsedCount} invoices` : `Show all ${all.length} invoices`} title={expanded ? 'Collapse' : 'Expand'} onClick={() => setExpanded(value => !value)}><span aria-hidden="true">{expanded ? '˅' : '<'}</span></button>}</div>
    {invoices.length ? <div className="table-scroll"><table><thead><tr><th>ID</th><th>Payer</th><th>Invoice face value</th><th>Maturity (SGT)</th><th>Status</th><th>SME wallet</th></tr></thead>
      <tbody>{invoices.map(invoice => <tr key={invoice.id.toString()}><td>#{invoice.id.toString()}</td><td>{invoice.payer}</td><td>{formatMoney(invoice.amount)}</td><td>{financialDate(invoice.maturity)}</td><td><span className={`status ${invoice.status.toLowerCase()}`}>{invoice.status}</span><small className={`timing-label${maturityState(invoice, now).overdue ? ' late' : ''}`}>{maturityState(invoice, now).label}</small></td><td><WalletName address={invoice.sme} /></td></tr>)}</tbody>
    </table></div> : <div className="empty-state compact">{empty}</div>}
  </section>;
}
