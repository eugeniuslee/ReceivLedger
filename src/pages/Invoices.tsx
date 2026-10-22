import { userFacingError } from '../errors';
import { useEffect, useMemo, useState } from 'react';
import { useLedger } from '../chain/LedgerContext';
import { invoiceActionForStatus, type ChainLedger } from '../chain/chainLedger';
import { formatMoney } from '../chain/presentation';
import { WalletName } from '../components/WalletName';
import { useFinance } from '../finance/FinanceContext';
import { maturityState } from '../finance/models';
import { financialDate } from '../finance/presentation';
import { InvoiceAssessment } from '../components/FinancialModels';
import { InvoiceTimeline } from '../components/InvoiceTimeline';
import { useRegistrationAccess } from '../registration/access';
import { PrivateAccess } from '../components/PrivateAccess';
import { DocumentsPanel } from './Documents';

export function Invoices({ mode = 'workspace' }: { mode?: 'workspace' | 'list' | 'submit' }) {
  const { account, role, networkOk, snapshot, loading, transactionPending, ledger, runTransaction } = useLedger();
  const { now } = useFinance();
  const registration = useRegistrationAccess();
  const [payer, setPayer] = useState('');
  const [amount, setAmount] = useState('');
  const [maturity, setMaturity] = useState('');
  const [filter, setFilter] = useState('All');
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedId, setSelectedId] = useState<bigint | null>(null);
  const [payerExposure, setPayerExposure] = useState<{ payer: string; exposure: bigint; maximum: bigint } | null>(null);
  const [exposureLoading, setExposureLoading] = useState(false);
  const [exposureError, setExposureError] = useState('');
  const roleInvoices = snapshot && (snapshot.role === 'manager' || snapshot.role === 'sme') ? snapshot.invoices : [];
  const invoices = useMemo(() => roleInvoices.filter(invoice => filter === 'All' || (filter === 'Overdue' ? maturityState(invoice, now).overdue : invoice.status === filter)).slice().reverse(), [roleInvoices, filter, now]);
  const selectedInvoice = selectedId === null ? undefined : roleInvoices.find(invoice => invoice.id === selectedId);
  const selectedAction = selectedInvoice ? invoiceActionForStatus(selectedInvoice.status) : null;

  useEffect(() => {
    if (!selectedInvoice || role !== 'manager' || snapshot?.role !== 'manager' || !ledger) {
      setPayerExposure(null);
      setExposureError('');
      return;
    }
    let current = true;
    setPayerExposure(null);
    setExposureLoading(true);
    setExposureError('');
    void Promise.all([ledger.getPayerExposure(selectedInvoice.payer), ledger.getMaxPayerExposure()])
      .then(([exposure, maximum]) => {
        if (current) setPayerExposure({ payer: selectedInvoice.payer, exposure, maximum });
      })
      .catch(cause => { if (current) setExposureError(userFacingError(cause)); })
      .finally(() => { if (current) setExposureLoading(false); });
    return () => { current = false; };
  }, [ledger, role, snapshot?.role, selectedInvoice?.id, selectedInvoice?.payer, selectedInvoice?.status]);

  async function submitInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    setMessage('');
    try {
      await registration.authorize('invoice');
      if (!payer.trim()) throw new Error('Enter the payer name.');
      if (!/^[1-9]\d*$/.test(amount)) throw new Error('Enter a positive whole-number S$ amount.');
      if (!maturity) throw new Error('Choose a maturity date.');
      const maturitySeconds = BigInt(Math.floor(new Date(`${maturity}T23:59:59`).getTime() / 1000));
      if (maturitySeconds <= BigInt(Math.floor(Date.now() / 1000))) throw new Error('Maturity must be in the future.');
      const submitRole = role === 'sme' ? 'sme' : 'provisional';
      await runTransaction(submitRole, ledger => ledger.submitInvoice(payer.trim(), BigInt(amount), maturitySeconds));
      setPayer(''); setAmount(''); setMaturity('');
      setMessage('Invoice submission confirmed on Sepolia. Refresh to review its latest status.');
    } catch (cause) {
      setFormError(userFacingError(cause));
    }
  }

  async function act(action: (ledger: ChainLedger) => Promise<unknown>) {
    setFormError(''); setMessage('');
    try { await runTransaction('manager', action); setMessage('Transaction confirmed on Sepolia. Review the updated invoice status: a financing attempt can be recorded as Rejected by the contract.'); }
    catch (cause) { setFormError(userFacingError(cause)); }
  }

  useEffect(() => {
    if (!selectedInvoice) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedId(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedInvoice?.id]);

  if (!networkOk) return <div className="empty-state">Switch to Sepolia to load contract invoices.</div>;
  if (loading && !snapshot) return <div className="empty-state">Loading invoice records…</div>;
  if (role !== 'manager' && role !== 'sme' && role !== 'provisional') return <div className="notice error" role="alert">Invoice access is not available for this wallet role.</div>;
  const invoiceDataAvailable = role === 'provisional' || snapshot?.role === role;

  return <>
    {message && <p className="notice info" role="status">{message}</p>}
    {mode !== 'list' && (role === 'sme' || role === 'provisional') && account && <section className="section-block form-section">
      <div className="section-heading"><div><span className="eyebrow">Open contract function</span><h2>Submit an invoice</h2></div></div>
      <p className="support-copy">New applicants require manager SME verification to submit through this website. Solidity permits direct submitInvoice calls from arbitrary wallets; this website restriction is not enforced by the contract. Existing invoice wallets without applications retain their blockchain access.</p>
      {!registration.invoiceAllowed && <p className="notice warning" role="status">{registration.reason}</p>}
      <form className="form-row" onSubmit={submitInvoice}>
        <label>Payer name<input value={payer} onChange={event => setPayer(event.target.value)} maxLength={100} required placeholder="Company or payer" /></label>
        <label>Invoice face value (S$)<input type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} required /></label>
        <label>Maturity date<input type="date" value={maturity} onChange={event => setMaturity(event.target.value)} required /></label>
        <button className="btn" disabled={transactionPending || !registration.invoiceAllowed}>Submit invoice</button>
      </form>
      {formError && <p className="inline-error" role="alert">{formError}</p>}
    </section>}
    {mode !== 'submit' && role === 'sme' && <div className="notice warning">Invoice-wallet view: these records are stored under this address. The contract does not verify real-world SME identity.</div>}
    {mode !== 'submit' && role === 'provisional' && <div className="notice info">This wallet has no confirmed contract role yet. Existing records, if any, are not exposed as SME invoices until their stored address is verified.</div>}

    {mode !== 'submit' && (!invoiceDataAvailable ? <div className="empty-state">Invoice records are unavailable. Refresh blockchain after checking the connection; missing records are not treated as zero invoices.</div> : <section className="section-block">
      <div className="section-heading table-heading">
        <div><span className="eyebrow">Deployed contract</span><h2>Invoices</h2></div>
        <label className="filter-label">Status<select value={filter} onChange={event => setFilter(event.target.value)}>{['All', 'Submitted', 'Approved', 'Financed', 'Overdue', 'Rejected', 'Repaid'].map(status => <option key={status}>{status}</option>)}</select></label>
      </div>
      <div className="status-breakdown invoice-breakdown">{['Submitted', 'Approved', 'Financed', 'Overdue', 'Repaid'].map(status => <div key={status}><span>{status}{status === 'Overdue' ? ' (within Financed)' : ''}</span><strong>{roleInvoices.filter(row => status === 'Overdue' ? maturityState(row, now).overdue : row.status === status).length}</strong></div>)}</div>
      <p className="support-copy">Expected payer date uses the invoice's stored maturity, displayed in Singapore time. Overdue applies only to still-Financed invoices; passing maturity never records a repayment. Countdown uses the device clock.</p>
      {invoices.length ? <div className="table-scroll"><table><thead><tr><th>ID</th><th>SME wallet</th><th>Payer</th><th>Amount</th><th>Expected payer date (SGT)</th><th>Status / timing</th><th>Rejection reason</th><th>Action</th></tr></thead>
        <tbody>{invoices.map(invoice => <tr key={invoice.id.toString()}>
          <td><button className="invoice-id" onClick={() => { setSelectedId(invoice.id); setFormError(''); }}>#{invoice.id.toString()}</button></td><td><WalletName address={invoice.sme} /></td><td>{invoice.payer}</td><td>{formatMoney(invoice.amount)}</td><td>{financialDate(invoice.maturity)}</td>
          <td><span className={`status ${invoice.status.toLowerCase()}`}>{invoice.status}</span><small className={`timing-label${maturityState(invoice, now).overdue ? ' late' : ''}`}>{maturityState(invoice, now).label}</small></td><td>{invoice.rejectionReason || '—'}</td>
          <td><button className="btn small outline" onClick={() => { setSelectedId(invoice.id); setFormError(''); }}>{role === 'manager' ? 'Review' : 'View details'}</button>
          </td>
        </tr>)}</tbody>
      </table></div> : <div className="empty-state compact">{role === 'sme' ? 'No invoices submitted by this wallet were found in contract mappings.' : role === 'provisional' ? 'No invoices are currently mapped to this wallet.' : 'No invoices match this status.'}</div>}
      {formError && <p className="inline-error" role="alert">{formError}</p>}
      <p className="footnote">Finance and repayment update simulated contract accounting only. No SGD or ETH is transferred. A finance attempt may succeed as a transaction while the contract changes the invoice to Rejected; the row will show the recorded reason.</p>
    </section>)}
    {invoiceDataAvailable && (role === 'manager' || role === 'sme') && selectedInvoice && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedId(null); }}>
      <section className="invoice-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-modal-title">
        <div className="section-heading"><div><span className="eyebrow">On-chain invoice record</span><h2 id="invoice-modal-title">Invoice #{selectedInvoice.id.toString()}</h2></div><button className="btn outline" onClick={() => setSelectedId(null)} aria-label="Close invoice details">Close</button></div>
        <dl className="detail-list">
          <div><dt>Invoice ID</dt><dd>#{selectedInvoice.id.toString()}</dd></div>
          <div><dt>SME wallet</dt><dd><WalletName address={selectedInvoice.sme} full /></dd></div>
          <div><dt>Payer name</dt><dd>{selectedInvoice.payer}</dd></div>
          <div><dt>Invoice amount</dt><dd>{formatMoney(selectedInvoice.amount)}</dd></div>
          <div><dt>Expected payer date</dt><dd>{financialDate(selectedInvoice.maturity)} SGT</dd></div>
          <div><dt>Repayment timing</dt><dd>{maturityState(selectedInvoice, now).label}</dd></div>
          <div><dt>Current status</dt><dd><span className={`status ${selectedInvoice.status.toLowerCase()}`}>{selectedInvoice.status}</span></dd></div>
          <div><dt>Rejection reason</dt><dd>{selectedInvoice.rejectionReason || '—'}</dd></div>
          {snapshot?.role === 'manager' && <><div><dt>Available funds</dt><dd>{formatMoney(snapshot.availableFunds)}</dd></div>
          <div><dt>Payer exposure</dt><dd>{exposureLoading ? 'Loading…' : payerExposure?.payer === selectedInvoice.payer ? `${formatMoney(payerExposure.exposure)} of ${formatMoney(payerExposure.maximum)}` : '—'}</dd></div></>}
        </dl>
        <InvoiceTimeline invoiceId={selectedInvoice.id} />
        <PrivateAccess><DocumentsPanel key={selectedInvoice.id.toString()} invoiceId={selectedInvoice.id.toString()} /></PrivateAccess>
        {(selectedInvoice.status === 'Submitted' || selectedInvoice.status === 'Approved') && <InvoiceAssessment key={selectedInvoice.id.toString()} invoice={selectedInvoice} />}
        {exposureError && <p className="inline-error" role="alert">Payer exposure unavailable: {exposureError}</p>}
        {formError && <p className="inline-error" role="alert">{formError}</p>}
        {role === 'manager' && <div className="modal-actions">
          {selectedAction === 'approve' && <button className="btn" disabled={transactionPending} onClick={() => void act(ledger => ledger.approveInvoice(selectedInvoice.id))}>{transactionPending ? 'Waiting for confirmation…' : 'Approve invoice'}</button>}
          {selectedAction === 'finance' && <button className="btn" disabled={transactionPending} onClick={() => void act(ledger => ledger.financeInvoice(selectedInvoice.id))}>{transactionPending ? 'Waiting for confirmation…' : `Finance full ${formatMoney(selectedInvoice.amount)} on-chain`}</button>}
          {selectedAction === 'repay' && <button className="btn" disabled={transactionPending} onClick={() => void act(ledger => ledger.recordRepayment(selectedInvoice.id))}>{transactionPending ? 'Waiting for confirmation…' : 'Record repayment'}</button>}
          {!selectedAction && <span className="sub">Read-only invoice state</span>}
        </div>}
        <p className="footnote">The contract stores no PDF. Private fictional PDFs above are linked to this invoice ID and require separate wallet authentication. Financing changes simulated accounting and does not transfer SGD or ETH.</p>
      </section>
    </div>}
  </>;
}
