import { useLedger } from '../chain/LedgerContext';
import { invoiceHistory } from '../finance/models';
import { financialDate } from '../finance/presentation';
import { SEPOLIA_EXPLORER } from '../chain/abi';

export function InvoiceTimeline({ invoiceId }: { invoiceId: bigint }) {
  const { events, eventsLoading, eventsError, eventIndexComplete } = useLedger();
  const rows = invoiceHistory(events, invoiceId);
  const labels: Record<string, string> = { InvoiceSubmitted: 'Submitted', InvoiceApproved: 'Approved', InvoiceFinanced: 'Financed', InvoiceRepaid: 'Repayment recorded', InvoiceRejected: 'Rejected' };
  return <section className="invoice-timeline" aria-label="Invoice activity">
    {(!eventIndexComplete || eventsError) && <p className="support-copy">{eventsError ? 'Event history is incomplete because the query failed.' : eventsLoading ? 'Event history is indexing.' : 'The full event history has not been indexed.'} Missing dates are not inferred from maturity.</p>}
    {rows.length ? <ol>{rows.map(row => <li key={`${row.transactionHash}:${row.logIndex}`}><b>{labels[row.name] ?? row.name}</b><span>{row.timestamp ? `${financialDate(BigInt(row.timestamp))} SGT` : 'Date unavailable'}</span><a className="tx-link" href={`${SEPOLIA_EXPLORER}/tx/${row.transactionHash}`} target="_blank" rel="noreferrer">View confirmed transaction</a></li>)}</ol> : <p className="support-copy">No activity has loaded yet. The invoice status above comes from its stored record.</p>}
  </section>;
}
