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
import { invoiceReceiptOutcome } from '../chain/invoiceReceipt';

function InvoiceDocuments({ invoiceId }: { invoiceId: string }) {
  const [open, setOpen] = useState(false);
  return <section className="section-block"><div className="section-heading"><h3>Supporting documents</h3>
    <button className="btn o small" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Hide private documents' : 'View private documents'}</button></div>
    {open && <><p className="support-copy">Sign in with your wallet to view private PDFs.</p><PrivateAccess compact><DocumentsPanel invoiceId={invoiceId} /></PrivateAccess></>}
  </section>;
}

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

  async function act(kind: 'approve' | 'finance' | 'repay', invoiceId: bigint, action: (ledger: ChainLedger) => Promise<unknown>) {
    setFormError(''); setMessage('');
    try {
      const receipt = await runTransaction('manager', action);
      const outcome = invoiceReceiptOutcome(receipt, kind, invoiceId);
      if (outcome.rejected) setFormError(outcome.message); else setMessage(outcome.message);
    }
    catch (cause) { setFormError(`${kind === 'approve' ? 'Invoice approval' : kind === 'finance' ? 'Invoice financing' : 'Repayment recording'} was not confirmed: ${userFacingError(cause)}`); }
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
  if (role === 'manager' && snapshot && snapshot.role !== 'manager' && !loading) return <section className="notice info" role="status">
    <h2>RLU invoice manager access required</h2>
    <p>The connected wallet cannot manage RLU invoices. Fund reporting access does not grant invoice approval, financing or repayment permissions.</p>
    <p>Connect the RLU manager wallet <code>{snapshot.manager}</code> in MetaMask, then refresh blockchain.</p>
  </section>;
  const invoiceDataAvailable = role === 'provisional' || snapshot?.role === role;

  return <>
    {message && <p className="notice info" role="status">{message}</p>}
    {mode !== 'list' && (role === 'sme' || role === 'provisional') && account && <section className="section-block form-section">
      <div className="section-heading"><h2>Submit an invoice</h2></div>
      <p className="support-copy">Enter the payer, invoice value, and due date for manager review.</p>
      <details className="model-controls"><summary>Who can submit?</summary><p className="support-copy">New applicants need manager verification. Existing invoice wallets can continue submitting. This website check is not enforced by the contract.</p></details>
      {!registration.invoiceAllowed && <p className="notice warning" role="status">{registration.reason}</p>}
      <form className="form-row" onSubmit={submitInvoice}>
        <label>Payer name<input value={payer} onChange={event => setPayer(event.target.value)} maxLength={100} required placeholder="Company or payer" /></label>
        <label>Invoice face value (S$)<input type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} required /></label>
        <label>Maturity date<input type="date" value={maturity} onChange={event => setMaturity(event.target.value)} required /></label>
        <button className="btn" disabled={transactionPending || !registration.invoiceAllowed}>Submit invoice</button>
      </form>
      {formError && <p className="inline-error" role="alert">{formError}</p>}
    </section>}
    {mode !== 'submit' && role === 'provisional' && <div className="notice info">Your invoices will appear here once the connected wallet is recognised.</div>}

    {mode !== 'submit' && (!invoiceDataAvailable ? <div className="empty-state">Invoice records are unavailable. Refresh blockchain after checking the connection; missing records are not treated as zero invoices.</div> : <section className="section-block">
      <div className="section-heading table-heading">
        <h2>{role === 'sme' ? 'My invoices' : 'Invoices'}</h2>
        <label className="filter-label">Status<select value={filter} onChange={event => setFilter(event.target.value)}>{['All', 'Submitted', 'Approved', 'Financed', 'Overdue', 'Rejected', 'Repaid'].map(status => <option key={status}>{status}</option>)}</select></label>
      </div>
      <div className="status-breakdown invoice-breakdown">{['Submitted', 'Approved', 'Financed', 'Overdue', 'Repaid'].map(status => <div key={status}><span>{status}</span><strong>{roleInvoices.filter(row => status === 'Overdue' ? maturityState(row, now).overdue : row.status === status).length}</strong></div>)}</div>
      {invoices.length ? <div className="table-scroll"><table><thead><tr><th>Invoice</th>{role === 'manager' && <th>SME</th>}<th>Payer</th><th>Amount</th><th>Due date (SGT)</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{invoices.map(invoice => <tr key={invoice.id.toString()}>
          <td><button className="invoice-id" onClick={() => { setSelectedId(invoice.id); setFormError(''); }}>#{invoice.id.toString()}</button></td>{role === 'manager' && <td><WalletName address={invoice.sme} /></td>}<td>{invoice.payer}</td><td>{formatMoney(invoice.amount)}</td><td>{financialDate(invoice.maturity)}</td>
          <td><span className={`status ${invoice.status.toLowerCase()}`}>{invoice.status}</span><small className={`timing-label${maturityState(invoice, now).overdue ? ' late' : ''}`}>{maturityState(invoice, now).label}</small></td>
          <td><button className="btn small outline" onClick={() => { setSelectedId(invoice.id); setFormError(''); }}>{role === 'manager' ? 'Review' : 'View details'}</button>
          </td>
        </tr>)}</tbody>
      </table></div> : <div className="empty-state compact">{role === 'sme' ? 'No invoices submitted by this wallet were found in contract mappings.' : role === 'provisional' ? 'No invoices are currently mapped to this wallet.' : 'No invoices match this status.'}</div>}
      {formError && <p className="inline-error" role="alert">{formError}</p>}
    </section>)}
    {invoiceDataAvailable && (role === 'manager' || role === 'sme') && selectedInvoice && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedId(null); }}>
      <section className="invoice-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-modal-title">
        <div className="section-heading"><h2 id="invoice-modal-title">Invoice #{selectedInvoice.id.toString()}</h2><button className="btn outline" onClick={() => setSelectedId(null)} aria-label="Close invoice details">Close</button></div>
        <div className="metric-grid">
          <div className="metric"><span>Invoice amount</span><strong>{formatMoney(selectedInvoice.amount)}</strong></div>
          <div className="metric"><span>Status</span><strong><span className={`status ${selectedInvoice.status.toLowerCase()}`}>{selectedInvoice.status}</span></strong><small>{maturityState(selectedInvoice, now).label}</small></div>
        </div>
        <dl className="detail-list">
          <div><dt>Payer</dt><dd>{selectedInvoice.payer}</dd></div>
          <div><dt>SME</dt><dd><WalletName address={selectedInvoice.sme} /></dd></div>
          <div><dt>Due date</dt><dd>{financialDate(selectedInvoice.maturity)} SGT</dd></div>
          {selectedInvoice.rejectionReason && <div><dt>Rejection reason</dt><dd>{selectedInvoice.rejectionReason}</dd></div>}
          {snapshot?.role === 'manager' && (selectedAction === 'approve' || selectedAction === 'finance') && <><div><dt>Available funds</dt><dd>{formatMoney(snapshot.availableFunds)}</dd></div>
          <div><dt>Payer exposure</dt><dd>{exposureLoading ? 'Loading…' : payerExposure?.payer === selectedInvoice.payer ? `${formatMoney(payerExposure.exposure)} of ${formatMoney(payerExposure.maximum)}` : '—'}</dd></div></>}
        </dl>
        {snapshot?.role === 'manager' && (selectedAction === 'approve' || selectedAction === 'finance') && payerExposure?.payer === selectedInvoice.payer && payerExposure.exposure + selectedInvoice.amount > payerExposure.maximum && <p className="notice warning">
          Financing would exceed this payer’s {formatMoney(payerExposure.maximum)} limit. Current exposure plus this invoice: {formatMoney(payerExposure.exposure + selectedInvoice.amount)}.
        </p>}
        {exposureError && <p className="inline-error" role="alert">Payer exposure unavailable: {exposureError}</p>}
        {formError && <p className="inline-error" role="alert">{formError}</p>}
        {role === 'manager' && <div className="modal-actions">
          {selectedAction === 'approve' && <button className="btn" disabled={transactionPending} onClick={() => void act('approve', selectedInvoice.id, ledger => ledger.approveInvoice(selectedInvoice.id))}>{transactionPending ? 'Waiting for confirmation…' : 'Approve invoice'}</button>}
          {selectedAction === 'finance' && <button className="btn" disabled={transactionPending} onClick={() => void act('finance', selectedInvoice.id, ledger => ledger.financeInvoice(selectedInvoice.id))}>{transactionPending ? 'Waiting for confirmation…' : `Finance ${formatMoney(selectedInvoice.amount)}`}</button>}
          {selectedAction === 'repay' && <button className="btn" disabled={transactionPending} onClick={() => void act('repay', selectedInvoice.id, ledger => ledger.recordRepayment(selectedInvoice.id))}>{transactionPending ? 'Waiting for confirmation…' : 'Record repayment'}</button>}
          {!selectedAction && <span className="sub">No further action required</span>}
        </div>}
        {role === 'manager' && selectedAction && <p className="footnote">{selectedAction === 'approve' ? 'Approval does not reserve funds.' : selectedAction === 'finance' ? 'Records the full invoice amount as financed. It does not send cash to the SME.' : 'Records full principal repayment. It does not collect cash or fees.'}</p>}
        <InvoiceDocuments key={`documents:${selectedInvoice.id}`} invoiceId={selectedInvoice.id.toString()} />
        {(selectedInvoice.status === 'Submitted' || selectedInvoice.status === 'Approved') && <details className="model-controls" key={`assessment:${selectedInvoice.id}`}><summary>Financing estimate</summary><InvoiceAssessment invoice={selectedInvoice} /></details>}
        <details className="model-controls" key={`history:${selectedInvoice.id}`}><summary>Activity history</summary><InvoiceTimeline invoiceId={selectedInvoice.id} /></details>
      </section>
    </div>}
  </>;
}
