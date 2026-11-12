import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegistry } from '../registration/RegistryContext';
import { MAX_PDF_BYTES, type PrivateDocument } from '../../supabase/functions/_shared/domain';
import { userFacingError } from '../errors';

export type ProofLink = { purpose: 'repayment' | 'invoice'; invoice_id: string } | { purpose: 'subscription'; fund_request_id: string };

/** Upload a payment-proof PDF linked to an invoice (SME repayment) or a subscription request (investor). */
export function ProofUpload({ link, onDone, onCancel }: { link: ProofLink; onDone: () => void; onCancel: () => void }) {
  const { request } = useRegistry();
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!file || (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))) { setError('Choose a PDF file.'); return; }
    if (file.size > MAX_PDF_BYTES) { setError('The PDF must be 5 MB or smaller.'); return; }
    setBusy(true);
    try {
      const body = new FormData(); body.set('file', file); body.set('demo_consent', 'true');
      for (const [key, value] of Object.entries(link)) body.set(key, value);
      await request(body); onDone();
    } catch (cause) { setError(userFacingError(cause)); }
    finally { setBusy(false); }
  }
  return <form className="registration-form" onSubmit={event => void upload(event)}>
    <label>Payment proof (PDF)<input type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
    <label className="consent-row"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />This PDF contains fictional demonstration information.</label>
    <span className="form-row"><button className="btn small" disabled={!file || !consent || busy}>{busy ? 'Uploading…' : 'Send proof'}</button><button type="button" className="btn o small" onClick={onCancel}>Cancel</button></span>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </form>;
}

/** The most recent proof for a record, if any. */
export function latestProof(documents: readonly PrivateDocument[] | null | undefined, match: (doc: PrivateDocument) => boolean) {
  return documents?.filter(match).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

/** Status badge plus the manager's note for a payment proof. */
export function ProofStatus({ proof }: { proof: PrivateDocument }) {
  return <><span className={`status ${proof.status === 'verified' ? 'approved' : proof.status === 'rejected' ? 'rejected' : 'submitted'}`}>{proof.status === 'pending' ? 'Proof under review' : proof.status === 'verified' ? 'Payment accepted' : 'Proof rejected'}</span>{proof.review_note && <small className="document-meta">{proof.review_note}</small>}</>;
}

/** Private documents visible to the signed-in wallet (own documents; the manager sees all). */
export function useDocuments() {
  const { authenticated, request } = useRegistry();
  const requestRef = useRef(request); requestRef.current = request;
  const [documents, setDocuments] = useState<PrivateDocument[] | null>(null);
  const reload = useCallback(async () => {
    if (!authenticated) { setDocuments(null); return; }
    try { const rows = await requestRef.current<PrivateDocument[]>({ action: 'documents' }); setDocuments(Array.isArray(rows) ? rows : []); } catch { /* keep the last list */ }
  }, [authenticated]);
  useEffect(() => { void reload(); }, [reload]);
  return { documents, reload };
}

/** Payment reference an investor quotes when paying for a subscription. */
export const paymentReference = (requestId: string) => `SUB-${requestId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
