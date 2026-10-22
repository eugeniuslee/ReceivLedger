import { useLedger } from '../chain/LedgerContext';
import { invoiceHistory } from '../finance/models';
import { financialDate } from '../finance/presentation';
import { SEPOLIA_EXPLORER } from '../chain/abi';

export function InvoiceTimeline({ invoiceId }: { invoiceId: bigint }) {
  const { events, eventsLoading, eventsError, eventIndexComplete } = useLedger();
  const rows = invoiceHistory(events, invoiceId);
  return <section className="invoice-timeline"><h3>Confirmed lifecycle and repayment history</h3>
    {(!eventIndexComplete || eventsError) && <p className="support-copy">{eventsError ? 'Event history is incomplete because the query failed.' : eventsLoading ? 'Event history is indexing.' : 'The full event history has not been indexed.'} Missing dates are not inferred from maturity.</p>}
    {rows.length ? <ol>{rows.map(row => <li key={`${row.transactionHash}:${row.logIndex}`}><b>{row.name}</b><span>{row.timestamp ? `${financialDate(BigInt(row.timestamp))} SGT` : 'Block timestamp unavailable'}</span><a className="tx-link" href={`${SEPOLIA_EXPLORER}/tx/${row.transactionHash}`} target="_blank" rel="noreferrer">View confirmed transaction</a></li>)}</ol> : <p className="support-copy">No lifecycle events have been loaded for this invoice. Its status still comes from the stored contract record.</p>}
  </section>;
}
