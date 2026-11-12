import { useEffect, useRef, useState } from 'react';
import type { ChainInvoice } from '../chain/chainLedger';
import { useOptionalLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { useFinance } from '../finance/FinanceContext';
import { useInvoiceCredits } from '../finance/credits';
import { calculateFinancing, financingDays, invoiceIncome, lifecycleTimes, termsAt } from '../finance/financing';
import { maturityState, money } from '../finance/models';
import type { Guideline } from '../finance/eligibility';
import { compactAddress } from '../chain/presentation';
import { latestProof, ProofStatus, ProofUpload, useDocuments } from './ProofUpload';
import type { Application, PrivateDocument } from '../../supabase/functions/_shared/domain';
import { REVIEW_LABELS, useInvoiceReviews, type InvoiceReview } from '../registration/invoiceReviews';
import { userFacingError } from '../errors';

const day = (seconds: bigint) => new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium' }).format(new Date(Number(seconds) * 1000));

/** The key numbers for an invoice in plain language: what the fund pays, when it comes back, and what it earns. */
export function InvoiceAtAGlance({ invoice }: { invoice: ChainInvoice }) {
  const ledger = useOptionalLedger();
  const { now } = useFinance();
  const credits = useInvoiceCredits();
  const { displayName } = useRegistry();
  const sme = displayName(invoice.sme) ?? compactAddress(invoice.sme);
  const cents = invoice.amount * 100n;
  const state = maturityState(invoice, now);
  const daysLeft = invoice.maturity > now ? financingDays(now, invoice.maturity) : 0n;
  const events = ledger?.lifecycleEvents?.length ? ledger.lifecycleEvents : ledger?.events ?? [];
  const financed = invoice.status === 'Financed' || invoice.status === 'Repaid';
  const row = financed ? invoiceIncome([invoice], events, now, credits)[0] : undefined;
  // Not yet financed: estimate as if financed today and repaid on the due date.
  const estimate = calculateFinancing(cents, daysLeft, termsAt(now));
  const atDue = row?.financedAt ? calculateFinancing(cents, financingDays(row.financedAt, invoice.maturity), termsAt(row.financedAt)) : estimate;

  if (invoice.status === 'Repaid' && row) return <section className="at-a-glance" aria-label="Invoice at a glance">
    <p className="glance-sentence"><b>{sme}</b> repaid this invoice. The fund advanced <b>{money(row.advanceCents)}</b> and earned <b>{money(row.profitCents)}</b>.</p>
  </section>;
  if (invoice.status === 'Rejected') return <section className="at-a-glance" aria-label="Invoice at a glance">
    <p className="glance-sentence">This invoice from <b>{sme}</b> was rejected{invoice.rejectionReason ? `: ${invoice.rejectionReason}` : '.'}</p>
  </section>;
  if (invoice.status === 'Financed' && row) {
    const owed = row.advanceCents + row.profitCents;
    return <section className="at-a-glance" aria-label="Invoice at a glance">
      <p className="glance-sentence">The fund advanced <b>{money(row.advanceCents)}</b> to <b>{sme}</b>. {state.overdue ? <>It was due on <b>{day(invoice.maturity)}</b> and is <b className="late">{state.label}</b>.</> : <>It is due back by <b>{day(invoice.maturity)}</b> ({daysLeft.toString()} days).</>}</p>
      <div className="glance-grid">
        <div><span>Cash advanced</span><strong>{money(row.advanceCents)}</strong></div>
        <div><span>SME owes today</span><strong>{money(owed)}</strong></div>
        <div><span>Due back by</span><strong>{day(invoice.maturity)}</strong><small className={state.overdue ? 'late' : ''}>{state.label}</small></div>
        <div><span>Fund earns by due date</span><strong>{money(atDue.serviceFeeCents + atDue.interestCents)}</strong></div>
      </div>
    </section>;
  }
  return <section className="at-a-glance" aria-label="Invoice at a glance">
    <p className="glance-sentence">If funded today, the fund pays <b>{sme}</b> <b>{money(estimate.advanceCents)}</b> and gets <b>{money(estimate.payableCents)}</b> back by <b>{day(invoice.maturity)}</b> ({daysLeft.toString()} days), earning <b>{money(estimate.serviceFeeCents + estimate.interestCents)}</b>.</p>
    <div className="glance-grid">
      <div><span>Invoice amount</span><strong>{money(cents)}</strong></div>
      <div><span>Cash to advance</span><strong>{money(estimate.advanceCents)}</strong><small>{termsAt(now).advanceBps / 100}% · holdback {money(estimate.holdbackCents)}</small></div>
      <div><span>Repaid by</span><strong>{day(invoice.maturity)}</strong><small>{daysLeft.toString()} days from today</small></div>
      <div><span>Fund earns</span><strong>{money(estimate.serviceFeeCents + estimate.interestCents)}</strong><small>Fee {money(estimate.serviceFeeCents)} + interest {money(estimate.interestCents)}</small></div>
    </div>
  </section>;
}

/** The four risk checks before approving or financing, plus the contract's own payer limit when it would reject. */
export function RiskChecks({ invoice, guidelines, payerExposure }: { invoice: ChainInvoice; guidelines: Guideline[]; payerExposure: { exposure: bigint; maximum: bigint } | null }) {
  const failing = guidelines.filter(guideline => !guideline.ok).length;
  const payerTotal = payerExposure ? payerExposure.exposure + invoice.amount : null;
  return <section className="invoice-checks" aria-label="Checks">
    <h3>{!guidelines.length ? 'Risk checks' : failing ? `${failing} of ${guidelines.length} risk checks need attention` : `All ${guidelines.length} risk checks passed`}</h3>
    <ul>{guidelines.map(guideline => <li key={guideline.id} className={guideline.ok ? 'ok' : 'bad'}><span aria-hidden="true">{guideline.ok ? '✓' : '⚠'}</span> <b>{guideline.rule}</b> · {guideline.summary}</li>)}</ul>
    {payerExposure && payerTotal !== null && payerTotal > payerExposure.maximum && <p className="inline-error contract-limit">The contract will reject financing: this payer’s exposure would be {money(payerTotal * 100n)}, above the contract’s {money(payerExposure.maximum * 100n)} payer limit (10% of fund capital).</p>}
  </section>;
}

/** Manager: reject an invoice or ask the SME for more documents. Recorded off-chain; the SME is notified. */
export function InvoiceDecisionPanel({ invoice, review }: { invoice: ChainInvoice; review: InvoiceReview | undefined }) {
  const { request } = useRegistry();
  const { reload } = useInvoiceReviews();
  const [mode, setMode] = useState<'needs_info' | 'rejected' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function decide(decision: 'needs_info' | 'rejected' | 'cleared') {
    setBusy(true); setError(''); setMessage('');
    try {
      await request({ action: 'review_invoice', invoice_id: invoice.id.toString(), decision, note: note.trim(), version: review?.version ?? null });
      await reload();
      setMessage(decision === 'needs_info' ? 'The SME has been asked for more information.' : decision === 'rejected' ? 'Invoice rejected. The SME has been told why.' : 'Decision undone.');
      setMode(null); setNote('');
    } catch (cause) { setError(userFacingError(cause)); }
    finally { setBusy(false); }
  }
  return <section className="invoice-decision" aria-label="Invoice decision">
    {review && <p className={`notice ${review.status === 'rejected' ? 'warning' : 'info'}`}><b>{REVIEW_LABELS[review.status]}</b>{review.status === 'info_provided' ? ' — check the new documents under More details.' : ''} {review.status !== 'info_provided' && <>Your note: “{review.note}”</>}</p>}
    {mode ? <div className="decision-form">
      <label>{mode === 'needs_info' ? 'What should the SME send?' : 'Reason for rejecting (the SME will see this)'}
        <textarea value={note} maxLength={1000} rows={3} onChange={event => setNote(event.target.value)} placeholder={mode === 'needs_info' ? 'e.g. Upload the signed purchase order and delivery note' : 'e.g. Payer is not an approved customer'} /></label>
      <div className="form-row"><button className="btn small" disabled={busy || !note.trim()} onClick={() => void decide(mode)}>{busy ? 'Sending…' : mode === 'needs_info' ? 'Send request' : 'Reject invoice'}</button>
        <button className="btn o small" disabled={busy} onClick={() => { setMode(null); setNote(''); }}>Cancel</button></div>
    </div> : <div className="form-row">
      {review?.status !== 'rejected' && <button className="btn o small" onClick={() => setMode('needs_info')}>{review ? 'Ask for more information again' : 'Request more information'}</button>}
      {review?.status !== 'rejected' && <button className="btn o small danger" onClick={() => setMode('rejected')}>Reject invoice</button>}
      {review?.status === 'rejected' && <button className="btn o small" disabled={busy} onClick={() => void decide('cleared')}>Undo rejection</button>}
    </div>}
    {message && <p className="notice info" role="status">{message}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}

/** SME: the fund manager's decision on its invoice, and where to send the documents requested. */
export function SmeInvoiceReviewPanel({ invoice, review }: { invoice: ChainInvoice; review: InvoiceReview }) {
  const { reload } = useInvoiceReviews();
  const { reload: reloadDocuments } = useDocuments();
  const [uploading, setUploading] = useState(false);
  const [sent, setSent] = useState(false);
  return <section className={`repayment-proof${review.status === 'needs_info' ? ' attention' : ''}`} aria-label="Fund manager decision">
    <h3>{REVIEW_LABELS[review.status]}</h3>
    <p>{review.status === 'info_provided' ? 'Thanks — the fund manager will review the documents you sent.' : <>Fund manager’s note: “{review.note}”</>}</p>
    {review.status !== 'rejected' && (uploading
      ? <ProofUpload link={{ purpose: 'invoice', invoice_id: invoice.id.toString() }} onDone={() => { setUploading(false); setSent(true); void reload(); void reloadDocuments(); }} onCancel={() => setUploading(false)} />
      : <button className="btn small" onClick={() => setUploading(true)}>{review.status === 'needs_info' ? 'Upload documents' : 'Upload another document'}</button>)}
    {sent && <p className="notice info" role="status">Document sent to the fund manager.</p>}
  </section>;
}

/** Download a private document the signed-in user can access. */
function useViewDocument() {
  const { request } = useRegistry();
  const [error, setError] = useState('');
  async function view(doc: PrivateDocument) {
    setError('');
    try {
      const blob = await request<Blob>({ action: 'download', id: doc.id });
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = doc.filename || `${doc.id}.pdf`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) { setError(userFacingError(cause)); }
  }
  return { view, error };
}

/** The SME's registration, for the manager reviewing its invoice. */
function useSmeApplication(wallet: string, enabled: boolean) {
  const { authenticated, request } = useRegistry();
  const requestRef = useRef(request); requestRef.current = request;
  const [application, setApplication] = useState<Application | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled || !authenticated) { setApplication(null); return; }
    let active = true;
    requestRef.current<Application[]>({ action: 'applications' })
      .then(rows => { if (active) setApplication((Array.isArray(rows) ? rows : []).find(row => row.wallet.toLowerCase() === wallet.toLowerCase() && row.kind === 'sme') ?? null); })
      .catch(() => { if (active) setApplication(null); });
    return () => { active = false; };
  }, [wallet, enabled, authenticated]);
  return application;
}

/** "More details": documents, SME profile, cash disbursement breakdown and the guidelines with their figures. */
export function InvoiceMoreDetails({ invoice, manager, guidelines }: { invoice: ChainInvoice; manager: boolean; guidelines: Guideline[] }) {
  const ledger = useOptionalLedger();
  const { data, now } = useFinance();
  const { displayName } = useRegistry();
  const { documents } = useDocuments();
  const { view, error } = useViewDocument();
  const application = useSmeApplication(invoice.sme, manager);
  const docs = (documents ?? []).filter(doc => doc.purpose === 'invoice' && doc.invoice_id === invoice.id.toString()).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const smeInvoices = (data?.invoices ?? []).filter(row => row.sme.toLowerCase() === invoice.sme.toLowerCase());
  const count = (status: ChainInvoice['status']) => smeInvoices.filter(row => row.status === status).length;
  // Cash flows: actual terms from the financing date once financed; otherwise as if financed today.
  const events = ledger?.lifecycleEvents?.length ? ledger.lifecycleEvents : ledger?.events ?? [];
  const financedAt = lifecycleTimes(events).financedAt.get(invoice.id.toString());
  const from = financedAt ?? now;
  const days = invoice.maturity > from ? financingDays(from, invoice.maturity) : 0n;
  const terms = termsAt(from);
  const flows = calculateFinancing(invoice.amount * 100n, days, terms);
  const uploaded = (iso: string) => new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  return <div className="invoice-detail-sections">
    <section aria-label="Documents"><h3>Documents</h3>
      {documents === null ? <p className="support-copy">Sign in with your wallet to see the invoice documents.</p>
        : docs.length ? <ul className="document-list">{docs.map((doc, index) => <li key={doc.id}>
            <span><b>{index === 0 ? 'Invoice PDF' : 'Supporting document'}</b> · {doc.filename} <small className="document-meta">Uploaded {uploaded(doc.created_at)} SGT</small></span>
            <button className="btn o small" onClick={() => void view(doc)}>View document</button></li>)}</ul>
        : <p className="support-copy">No documents uploaded for this invoice.</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </section>
    {manager && <section aria-label="SME profile"><h3>SME profile</h3>
      <dl className="detail-list">
        <div><dt>Name</dt><dd>{application?.display_name ?? displayName(invoice.sme) ?? '—'}</dd></div>
        <div><dt>Wallet</dt><dd className="mono selectable-address">{invoice.sme}</dd></div>
        {application === undefined ? <div><dt>Registration</dt><dd>Loading…</dd></div> : application === null ? <div><dt>Registration</dt><dd>No SME application found for this wallet</dd></div> : <>
          <div><dt>Registration</dt><dd>{application.status === 'approved' ? 'Approved' : application.status}</dd></div>
          <div><dt>Company number</dt><dd>{application.company_number || '—'}</dd></div>
          <div><dt>Contact</dt><dd>{application.details?.contact_name || '—'} · {application.contact_email}{application.contact_phone ? ` · ${application.contact_phone}` : ''}</dd></div>
          <div><dt>Address</dt><dd>{[application.details?.business_address, application.details?.country].filter(Boolean).join(', ') || '—'}</dd></div>
        </>}
        <div><dt>Invoices with the fund</dt><dd>{smeInvoices.length} total · {count('Repaid')} repaid · {count('Financed')} outstanding · {count('Rejected')} rejected on-chain</dd></div>
      </dl>
    </section>}
    <section aria-label="Cash disbursement breakdown"><h3>Cash disbursement breakdown</h3>
      <p className="support-copy">{financedAt ? `Financed ${day(financedAt)}; repaid by ${day(invoice.maturity)} (${days} days).` : `If financed today and repaid by ${day(invoice.maturity)} (${days} days).`}</p>
      <dl className="detail-list money-list">
        <div><dt>Invoice amount</dt><dd>{money(flows.invoiceCents)}</dd></div>
        <div><dt>Paid to the SME now ({terms.advanceBps / 100}% advance)</dt><dd><b>{money(flows.advanceCents)}</b></dd></div>
        <div><dt>Held back until the payer pays ({(10_000 - terms.advanceBps) / 100}%)</dt><dd>{money(flows.holdbackCents)}</dd></div>
        <div><dt>Less service fee ({terms.serviceFeeBps / 100}%)</dt><dd>−{money(flows.serviceFeeCents)}</dd></div>
        <div><dt>Less interest ({terms.annualInterestBps / 100}% a year on the advance, {days.toString()} days)</dt><dd>−{money(flows.interestCents)}</dd></div>
        <div><dt>{flows.smeTopUpCents > 0n ? 'SME pays in extra when the payer pays' : 'Paid to the SME when the payer pays'}</dt><dd>{money(flows.smeTopUpCents > 0n ? flows.smeTopUpCents : flows.holdbackReleasedCents)}</dd></div>
        <div><dt>Fund gets back in total</dt><dd><b>{money(flows.payableCents)}</b></dd></div>
      </dl>
    </section>
    {manager && guidelines.length > 0 && <section aria-label="Risk management guidelines"><h3>Risk management guidelines</h3>
      <div className="guideline-grid">{guidelines.map(guideline => <div key={guideline.id} className={`guideline ${guideline.ok ? 'ok' : 'bad'}`}>
        <div className="guideline-head"><b>{guideline.rule}</b><span className={`status ${guideline.ok ? 'approved' : 'rejected'}`}>{guideline.ok ? 'Within limit' : 'Breached'}</span></div>
        <dl>{guideline.figures.map(figure => <div key={figure.label}><dt>{figure.label}</dt><dd>{figure.value}</dd></div>)}</dl>
      </div>)}</div>
    </section>}
  </div>;
}

/** Manager: an SME's repayment proof for a financed invoice — view it, accept and record repayment, or ask again. */
export function RepaymentProofPanel({ invoice, onRecordRepayment, busy }: { invoice: ChainInvoice; onRecordRepayment: () => Promise<void>; busy: boolean }) {
  const { request } = useRegistry();
  const { documents, reload } = useDocuments();
  const proof = latestProof(documents, doc => doc.purpose === 'repayment' && doc.invoice_id === invoice.id.toString());
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  async function view(doc: PrivateDocument) {
    try {
      const blob = await request<Blob>({ action: 'download', id: doc.id });
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = doc.filename || `${doc.id}.pdf`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) { setError(userFacingError(cause)); }
  }
  async function review(decision: 'verified' | 'rejected') {
    if (!proof) return;
    setWorking(true); setError('');
    try {
      await request({ action: 'review_document', id: proof.id, version: proof.version, decision, note: decision === 'verified' ? 'Repayment received' : note.trim() });
      await reload();
      if (decision === 'verified') await onRecordRepayment();
      setAsking(false); setNote('');
    } catch (cause) { setError(userFacingError(cause)); }
    finally { setWorking(false); }
  }
  return <section className={`repayment-proof${proof?.status === 'pending' ? ' attention' : ''}`} aria-label="Repayment proof">
    <h3>Repayment</h3>
    {!proof ? <p className="support-copy">The SME has not sent a payment proof yet. You can still record the repayment once the money arrives.</p>
      : <div className="form-row"><ProofStatus proof={proof} /><button className="btn o small" onClick={() => void view(proof)}>View proof</button></div>}
    {proof?.status === 'pending' && <p><b>The SME says it has repaid.</b> Check the proof, then accept it to record the repayment on-chain.</p>}
    {proof?.status === 'pending' && (asking
      ? <span className="form-row"><input aria-label="What is wrong with the proof" value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="e.g. Amount does not match" />
          <button className="btn small" disabled={working || !note.trim()} onClick={() => void review('rejected')}>Send request</button><button className="btn o small" onClick={() => setAsking(false)}>Cancel</button></span>
      : <span className="form-row"><button className="btn" disabled={working || busy} onClick={() => void review('verified')}>{working || busy ? 'Working…' : 'Accept & record repayment'}</button><button className="btn o" disabled={working} onClick={() => setAsking(true)}>Ask for new proof</button></span>)}
    {proof?.status === 'rejected' && <p className="support-copy">Waiting for the SME to upload a new proof.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}

/** Invoice IDs with a repayment proof awaiting the manager's review. */
export function invoicesWithPendingProof(documents: readonly PrivateDocument[] | null) {
  return new Set((documents ?? []).filter(doc => doc.purpose === 'repayment' && doc.status === 'pending' && doc.invoice_id).map(doc => doc.invoice_id!));
}
