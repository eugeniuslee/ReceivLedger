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
import { invoiceReceiptOutcome, submittedInvoiceId } from '../chain/invoiceReceipt';
import { useRegistry } from '../registration/RegistryContext';
import { endOfSgtDate, estimateSubmission, financedInvoiceCharges, lifecycleTimes } from '../finance/financing';
import type { ChainInvoice } from '../chain/chainLedger';
import { FinancingBreakdownList } from '../components/FinancialModels';
import { EligibilityPanel } from './Sme';
import { MAX_PDF_BYTES } from '../../supabase/functions/_shared/domain';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const sgtToday = (now: bigint) => new Date(Number(now) * 1000 + 8 * 3_600_000).toISOString().slice(0, 10);

/** Before repayment: charges accrued to today. After confirmed repayment: actual charges for the days outstanding. */
function FinancedCharges({ invoice }: { invoice: ChainInvoice }) {
  const { events, eventsLoading } = useLedger();
  const { now } = useFinance();
  const times = lifecycleTimes(events);
  const financedAt = times.financedAt.get(invoice.id.toString());
  const repaidAt = invoice.status === 'Repaid' ? times.repaidAt.get(invoice.id.toString()) : undefined;
  const pending = !financedAt || (invoice.status === 'Repaid' && !repaidAt);
  const charges = pending ? null : financedInvoiceCharges({ invoiceCents: invoice.amount * 100n, dueDate: invoice.maturity, financedAt: financedAt!, repaidAt: repaidAt ?? null }, now);
  return <details className="fee-details" open><summary>{invoice.status === 'Repaid' ? 'Financing charges · repaid' : 'Financing charges accrued to date'}</summary>
    {charges ? <>
      <p className="support-copy">Financed {financialDate(financedAt!)} SGT{repaidAt ? ` · repaid ${financialDate(repaidAt)} SGT` : ''}.{charges.cappedAtDueDate ? ' Interest stops at the invoice due date.' : ''}</p>
      <FinancingBreakdownList breakdown={charges} heading={charges.actual ? 'Actual' : 'Accrued'} durationLabel={charges.actual ? 'Days outstanding' : 'Days financed so far'} />
    </> : <p className="support-copy">{eventsLoading ? 'Loading the financing date…' : 'The financing date for this invoice has not been indexed yet. Refresh blockchain records.'}</p>}
  </details>;
}

function InvoiceDocuments({ invoiceId }: { invoiceId: string }) {
  const [open, setOpen] = useState(false);
  return <section className="section-block"><h3>Private supporting documents</h3>
    <p className="support-copy">On-chain invoice details and history above are public. Supporting PDFs require a separate private wallet session.</p>
    <button className="btn o small" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Hide private documents' : 'View private documents'}</button>
    {open && <PrivateAccess compact><DocumentsPanel invoiceId={invoiceId} /></PrivateAccess>}
  </section>;
}

export function Invoices({ mode = 'workspace' }: { mode?: 'workspace' | 'list' | 'submit' }) {
  const { account, role, networkOk, snapshot, loading, transactionPending, ledger, runTransaction } = useLedger();
  const { now } = useFinance();
  const registration = useRegistrationAccess();
  const registry = useRegistry();
  const [payer, setPayer] = useState('');
  const [amount, setAmount] = useState('');
  const [maturity, setMaturity] = useState('');
  const [expectedPayment, setExpectedPayment] = useState('');
  const [invoicePdf, setInvoicePdf] = useState<File | null>(null);
  const [pdfConsent, setPdfConsent] = useState(false);
  const [formKey, setFormKey] = useState(0);
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

  const wholeAmount = /^[1-9]\d*$/.test(amount);
  const estimate = estimateSubmission({ invoiceCents: wholeAmount ? BigInt(amount) * 100n : null, dueDate: endOfSgtDate(maturity), expectedPaymentDate: endOfSgtDate(expectedPayment), now });
  const estimateStarted = Boolean(amount || maturity || expectedPayment);

  /** The server only accepts a PDF for an invoice already on-chain under this wallet; allow for RPC lag. */
  async function uploadInvoicePdf(invoiceId: bigint, file: File) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const body = new FormData(); body.set('file', file); body.set('purpose', 'invoice'); body.set('invoice_id', invoiceId.toString()); body.set('demo_consent', 'true');
        await registry.request(body); return;
      } catch (cause) { lastError = cause; if (attempt < 2) await wait(4000); }
    }
    throw lastError;
  }

  async function submitInvoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    setMessage('');
    try {
      await registration.authorize('invoice');
      if (!payer.trim()) throw new Error('Enter the payer name.');
      if (!wholeAmount) throw new Error('Enter a whole-dollar invoice amount greater than zero.');
      if (estimate.errors.length) throw new Error(estimate.errors[0]);
      if (!invoicePdf) throw new Error('Attach the invoice PDF.');
      if (invoicePdf.type !== 'application/pdf' && !invoicePdf.name.toLowerCase().endsWith('.pdf')) throw new Error('The invoice file must be a PDF.');
      if (invoicePdf.size > MAX_PDF_BYTES) throw new Error('The invoice PDF must be 5 MB or smaller.');
      if (!pdfConsent) throw new Error('Confirm that the PDF contains fictional demonstration information.');
      if (!registry.configured) throw new Error('Private document storage is not configured, so the invoice PDF cannot be stored.');
      if (!registry.authenticated) throw new Error('Sign in with this wallet first so the invoice PDF can be stored privately.');
      const maturitySeconds = endOfSgtDate(maturity)!;
      const file = invoicePdf;
      const submitRole = role === 'sme' ? 'sme' : 'provisional';
      const receipt = await runTransaction(submitRole, ledger => ledger.submitInvoice(payer.trim(), BigInt(amount), maturitySeconds));
      setPayer(''); setAmount(''); setMaturity(''); setExpectedPayment(''); setInvoicePdf(null); setPdfConsent(false); setFormKey(key => key + 1);
      const invoiceId = submittedInvoiceId(receipt);
      if (invoiceId === null) { setFormError('Invoice submission confirmed on Sepolia, but its invoice ID could not be read. Upload the PDF from the invoice’s Private documents section.'); return; }
      try {
        await uploadInvoicePdf(invoiceId, file);
        setMessage(`Invoice #${invoiceId} submitted on Sepolia and its PDF was stored privately.`);
      } catch (cause) {
        setFormError(`Invoice #${invoiceId} was submitted on Sepolia, but its PDF could not be uploaded: ${userFacingError(cause)} Upload it from the invoice’s Private documents section.`);
      }
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
  const invoiceDataAvailable = role === 'provisional' || snapshot?.role === role;

  return <>
    {message && <p className="notice info" role="status">{message}</p>}
    {mode !== 'list' && (role === 'sme' || role === 'provisional') && account && <section className="section-block form-section">
      <div className="section-heading"><div><span className="eyebrow">Open contract function</span><h2>Submit an invoice</h2></div></div>
      <p className="support-copy">New applicants require manager SME verification to submit through this website. Solidity permits direct submitInvoice calls from arbitrary wallets; this website restriction is not enforced by the contract. Existing invoice wallets without applications retain their blockchain access.</p>
      {!registration.invoiceAllowed && <p className="notice warning" role="status">{registration.reason}</p>}
      <form className="form-row" onSubmit={submitInvoice} key={formKey}>
        <label>Payer name<input value={payer} onChange={event => setPayer(event.target.value)} maxLength={100} required placeholder="Company or payer" /></label>
        <label>Invoice amount (SGD)<input type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} required /></label>
        <label>Invoice due date<input type="date" min={sgtToday(now)} value={maturity} onChange={event => setMaturity(event.target.value)} required /></label>
        <label>Expected payment received date<input type="date" min={sgtToday(now)} value={expectedPayment} onChange={event => setExpectedPayment(event.target.value)} required /></label>
        <label>Invoice PDF<input type="file" accept="application/pdf,.pdf" onChange={event => setInvoicePdf(event.target.files?.[0] ?? null)} required /></label>
        <label className="consent-row"><input type="checkbox" required checked={pdfConsent} onChange={event => setPdfConsent(event.target.checked)} />This PDF contains fictional demonstration information.</label>
        <button className="btn" disabled={transactionPending || !registration.invoiceAllowed}>Submit invoice</button>
      </form>
      {registry.configured && !registry.authenticated && <p className="support-copy">Sign in with this wallet before submitting so the invoice PDF can be stored privately.</p>}
      {formError && <p className="inline-error" role="alert">{formError}</p>}
      {estimateStarted && <section className="fee-details" aria-label="Live financing breakdown"><h3>Financing breakdown</h3>
        {estimate.warnings.map(warning => <p className="notice warning" key={warning}>{warning}</p>)}
        <h4>Invoice details</h4><dl className="detail-list">
          <div><dt>Invoice amount</dt><dd>{wholeAmount ? formatMoney(BigInt(amount)) : '—'}</dd></div>
          <div><dt>Invoice due date</dt><dd>{endOfSgtDate(maturity) ? `${financialDate(endOfSgtDate(maturity)!)} SGT` : '—'}</dd></div>
          <div><dt>Expected payment date</dt><dd>{endOfSgtDate(expectedPayment) ? `${financialDate(endOfSgtDate(expectedPayment)!)} SGT` : '—'}</dd></div>
          <div><dt>Maximum financing period</dt><dd>{estimate.maximumDays === null ? '—' : `${estimate.maximumDays} day(s)`}</dd></div>
        </dl>
        {estimate.breakdown ? <FinancingBreakdownList breakdown={estimate.breakdown} /> : <p className="support-copy">{estimate.errors[0]}</p>}
      </section>}
      {estimateStarted && <EligibilityPanel invoiceCents={wholeAmount ? BigInt(amount) * 100n : null} days={estimate.maximumDays} payer={payer} />}
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
      <p className="footnote">Finance and repayment update contract accounting only. No SGD or ETH is transferred. A finance attempt may succeed as a transaction while the contract changes the invoice to Rejected; the row will show the recorded reason.</p>
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
        {snapshot?.role === 'manager' && payerExposure?.payer === selectedInvoice.payer && <p className={`notice ${payerExposure.exposure + selectedInvoice.amount > payerExposure.maximum ? 'warning' : 'info'}`}>
          The payer cap is 10% of total fund size, rounded down: {formatMoney(payerExposure.maximum)}. Existing exposure {formatMoney(payerExposure.exposure)} + full invoice {formatMoney(selectedInvoice.amount)} = {formatMoney(payerExposure.exposure + selectedInvoice.amount)}.
          {payerExposure.exposure + selectedInvoice.amount > payerExposure.maximum ? ' This exceeds the payer cap; financing would record Rejected under these observed limits, without deducting funds.' : ' This passes the observed payer cap; available funds and execution-time maturity checks must also pass.'}
        </p>}
        {(selectedInvoice.status === 'Financed' || selectedInvoice.status === 'Repaid') && <FinancedCharges invoice={selectedInvoice} />}
        <InvoiceTimeline invoiceId={selectedInvoice.id} />
        <InvoiceDocuments key={`documents:${selectedInvoice.id}`} invoiceId={selectedInvoice.id.toString()} />
        {(selectedInvoice.status === 'Submitted' || selectedInvoice.status === 'Approved') && <InvoiceAssessment key={`assessment:${selectedInvoice.id}`} invoice={selectedInvoice} />}
        {exposureError && <p className="inline-error" role="alert">Payer exposure unavailable: {exposureError}</p>}
        {formError && <p className="inline-error" role="alert">{formError}</p>}
        {role === 'manager' && <div className="modal-actions">
          {selectedAction === 'approve' && <button className="btn" disabled={transactionPending} onClick={() => void act('approve', selectedInvoice.id, ledger => ledger.approveInvoice(selectedInvoice.id))}>{transactionPending ? 'Waiting for confirmation…' : 'Approve invoice'}</button>}
          {selectedAction === 'finance' && <button className="btn" disabled={transactionPending} onClick={() => void act('finance', selectedInvoice.id, ledger => ledger.financeInvoice(selectedInvoice.id))}>{transactionPending ? 'Waiting for confirmation…' : `Finance full ${formatMoney(selectedInvoice.amount)} on-chain`}</button>}
          {selectedAction === 'repay' && <button className="btn" disabled={transactionPending} onClick={() => void act('repay', selectedInvoice.id, ledger => ledger.recordRepayment(selectedInvoice.id))}>{transactionPending ? 'Waiting for confirmation…' : 'Record repayment'}</button>}
          {!selectedAction && <span className="sub">Read-only invoice state</span>}
        </div>}
        <p className="footnote">Submitted → Approved → Financed → Repaid. Approval does not reserve or deduct funds. Financing commits the full invoice face value; repayment restores that principal. The contract stores no PDF. Financing changes contract accounting and does not transfer SGD or ETH.</p>
      </section>
    </div>}
  </>;
}
