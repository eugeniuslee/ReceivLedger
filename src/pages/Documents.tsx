import { userFacingError } from '../errors';
import { useEffect, useRef, useState } from 'react';
import { useRegistry } from '../registration/RegistryContext';
import { MAX_PDF_BYTES, type PrivateDocument } from '../../supabase/functions/_shared/domain';
import { PrivateAccess } from '../components/PrivateAccess';

export function Documents() { return <PrivateAccess><DocumentsPanel /></PrivateAccess>; }

export function DocumentsPanel({ applicationId, invoiceId, allowUpload = false }: { applicationId?: string; invoiceId?: string; allowUpload?: boolean }) {
  const { application, isManager, request } = useRegistry();
  const [documents, setDocuments] = useState<PrivateDocument[]>([]);
  const [purpose, setPurpose] = useState<'kyc' | 'invoice'>(applicationId ? 'kyc' : invoiceId ? 'invoice' : application && ['pending', 'needs_info'].includes(application.status) ? 'kyc' : 'invoice');
  const [invoice, setInvoice] = useState(invoiceId ?? ''); const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true); const [loaded, setLoaded] = useState(false);
  const loadVersion = useRef(0);
  const mounted = useRef(true); const requestRef = useRef(request); requestRef.current = request;
  async function load() {
    const version = ++loadVersion.current;
    setLoading(true); setError('');
    try {
      const rows = await requestRef.current<PrivateDocument[]>({ action: 'documents', ...(applicationId ? { application_id: applicationId } : {}), ...(invoiceId ? { invoice_id: invoiceId } : {}) });
      if (!Array.isArray(rows)) throw new Error('Private document records were unavailable. Refresh before relying on this list.');
      if (mounted.current && version === loadVersion.current) { setDocuments(rows); setLoaded(true); }
    } finally { if (mounted.current && version === loadVersion.current) setLoading(false); }
  }
  useEffect(() => { let active = true; mounted.current = true; setDocuments([]); setLoaded(false); setInvoice(invoiceId ?? ''); if (applicationId) setPurpose('kyc'); else if (invoiceId) setPurpose('invoice'); void load().catch(cause => { if (active && mounted.current) setError(userFacingError(cause)); }); return () => { active = false; mounted.current = false; loadVersion.current++; }; }, [applicationId, invoiceId]);
  async function perform(operation: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await operation(); } catch (cause) { if (mounted.current) setError(userFacingError(cause)); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget;
    await perform(async () => {
      if (!file || !file.name.toLowerCase().endsWith('.pdf') || file.size > MAX_PDF_BYTES) throw new Error('Choose a fictional PDF up to 5 MB.');
      if (!consent) throw new Error('Confirm that the file contains fictional demonstration information.');
      const body = new FormData(); body.set('file', file); body.set('purpose', purpose); body.set('demo_consent', 'true');
      if (purpose === 'kyc') { if (!application) throw new Error('Submit your application first.'); body.set('application_id', application.id); }
      else body.set('invoice_id', invoice);
      await request<PrivateDocument>(body); await load();
      if (mounted.current) { setFile(null); setConsent(false); formElement.reset(); setMessage('PDF uploaded privately. Document verification is pending.'); }
    });
  }
  async function download(doc: PrivateDocument) {
    await perform(async () => {
      const blob = await request<Blob>({ action: 'download', id: doc.id });
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `${doc.id}.pdf`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    });
  }
  async function review(doc: PrivateDocument, decision: 'verified' | 'rejected') {
    await perform(async () => {
      if (!notes[doc.id]?.trim()) throw new Error('Enter a document review note.');
      await request({ action: 'review_document', id: doc.id, version: doc.version, decision, note: notes[doc.id] });
      await load(); if (mounted.current) setMessage('Document review decision recorded off-chain.');
    });
  }
  const visibleDocuments = applicationId ? documents.filter(doc => doc.application_id === applicationId) : invoiceId ? documents.filter(doc => doc.invoice_id === invoiceId) : documents;
  const canUpload = !isManager && (applicationId ? allowUpload && application?.id === applicationId && ['pending', 'needs_info'].includes(application.status) : true);
  return <section className="section-block"><div className="section-heading"><h2>{applicationId ? 'Supporting application documents' : invoiceId ? `Private documents for invoice #${invoiceId}` : 'Private documents'}</h2><button className="btn o small" disabled={busy || loading} onClick={() => void perform(async () => { await load(); if (mounted.current) setMessage('Documents refreshed.'); })}>{loading ? 'Loading documents…' : 'Refresh documents'}</button></div>
    <p className="support-copy">Fictional PDFs only, up to 5 MB and 100 pages. Files are private to the submitting wallet and fund manager. Document verification is an off-chain review decision, not proof of real identity or on-chain permission.</p>
    {canUpload && <form className="registration-form document-upload" onSubmit={event => void upload(event)}>
      {!applicationId && !invoiceId && <label>Document purpose<select value={purpose} onChange={event => setPurpose(event.target.value as 'kyc' | 'invoice')}><option value="kyc" disabled={!application || !['pending', 'needs_info'].includes(application.status)}>Application KYC</option><option value="invoice">Invoice PDF</option></select></label>}
      {purpose === 'kyc' ? <p className="support-copy">Attached to your pending application. Submit or resubmit an application before uploading KYC.</p> : <label>On-chain invoice ID<input value={invoice} readOnly={Boolean(invoiceId)} required inputMode="numeric" pattern="[1-9][0-9]*" onChange={event => setInvoice(event.target.value)} placeholder="For example, 1" /></label>}
      <label>Fictional PDF<input type="file" required accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
      <label className="consent-row"><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} />This PDF contains fictional demonstration information, not a real identity or confidential document.</label>
      <button className="btn" disabled={busy || !consent || (purpose === 'kyc' && !['pending', 'needs_info'].includes(application?.status ?? ''))}>{busy ? 'Working…' : 'Upload privately'}</button>
    </form>}
    {error && <p className="inline-error" role="alert">{error}</p>}{message && <p className="notice info" role="status">{message}</p>}
    {loading && <p role="status">Loading private documents…</p>}
    <div className="table-scroll"><table><thead><tr><th>Document</th><th>Linked record</th><th>Review status</th><th>Actions</th></tr></thead><tbody>{visibleDocuments.map(doc => <tr key={doc.id}>
      <td><strong>{doc.filename}</strong><small className="document-meta">{(doc.byte_size / 1024).toFixed(0)} KB · SHA-256 {doc.sha256.slice(0, 12)}…</small></td>
      <td>{doc.purpose === 'invoice' ? `Invoice #${doc.invoice_id}` : 'Application KYC'}</td><td>{doc.status}{doc.review_note && <small className="document-meta">{doc.review_note}</small>}</td>
      <td><button className="btn o small" disabled={busy} onClick={() => void download(doc)}>Download PDF</button>
        {isManager && doc.status === 'pending' && <div className="document-review"><label>Review note<input value={notes[doc.id] ?? ''} maxLength={2000} onChange={event => setNotes(previous => ({ ...previous, [doc.id]: event.target.value }))} /></label>
          <button className="btn small" disabled={busy} onClick={() => void review(doc, 'verified')}>Verify demo document</button><button className="btn o small" disabled={busy} onClick={() => void review(doc, 'rejected')}>Reject</button></div>}
      </td></tr>)}</tbody></table></div>{loaded && !loading && !error && !visibleDocuments.length && <p className="empty-state compact">No documents were returned for this view.</p>}
  </section>;
}
