import { useEffect, useRef, useState } from 'react';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { assertReviewable, type Application, type PrivateDocument } from '../../supabase/functions/_shared/domain';
import { PrivateAccess } from './Registration';
import { DocumentsPanel } from './Documents';

export function Applications() {
  const { role } = useLedger();
  if (role !== 'manager') return <div className="notice error">Fund manager access required.</div>;
  return <PrivateAccess><ApplicationList /></PrivateAccess>;
}
function ApplicationList() {
  const { isManager, request, reload } = useRegistry();
  const [rows, setRows] = useState<Application[]>([]); const [filter, setFilter] = useState('pending');
  const [selected, setSelected] = useState<string | null>(null); const [error, setError] = useState('');
  const requestRef = useRef(request); requestRef.current = request;
  const mounted = useRef(true);
  async function load() { const apps = await requestRef.current<Application[]>({ action: 'applications' }); if (mounted.current) setRows(apps); }
  useEffect(() => { mounted.current = true; if (isManager) void load().catch(cause => { if (mounted.current) setError(cause.message); }); return () => { mounted.current = false; }; }, [isManager]);
  if (!isManager) return <div className="notice error">Your signed session is not the contract's fund manager.</div>;
  const app = rows.find(row => row.id === selected);
  return <><section className="section-block"><div className="section-heading"><h2>Registration applications</h2><div className="history-controls"><label>Status<select value={filter} onChange={event => setFilter(event.target.value)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All</option></select></label><button className="btn o small" onClick={() => void load().catch(cause => setError(cause.message))}>Refresh applications</button></div></div>
    <p className="support-copy">Latest 200 applications. Verify fictional KYC before approval. Investor access is approved through the existing Sepolia contract; SME verification remains off-chain.</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="table-scroll"><table><thead><tr><th>Name / company</th><th>Wallet</th><th>Application</th><th>Status</th><th>Review</th></tr></thead><tbody>{rows.filter(row => filter === 'all' || row.status === filter).map(row => <tr key={row.id}><td>{row.display_name}</td><td className="mono">{row.wallet}</td><td>{row.kind === 'sme' ? 'SME' : 'Investor'}</td><td>{row.status}</td><td><button className="btn o small" onClick={() => setSelected(row.id)}>Review details</button></td></tr>)}</tbody></table></div>
  </section>{app && <ApplicationReview key={`${app.id}:${app.version}`} application={app} onChanged={async () => { await load(); await reload(); }} />}</>;
}
function ApplicationReview({ application: app, onChanged }: { application: Application; onChanged: () => Promise<void> }) {
  const { runTransaction, transactionPending, account } = useLedger();
  const { request } = useRegistry();
  const [note, setNote] = useState(''); const [hash, setHash] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const mounted = useRef(true); const signingAccount = useRef(account);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function review(decision: 'approved' | 'rejected') {
    setBusy(true); setError(''); setMessage(''); let confirmedHash = hash.trim(); let recorded = false;
    try {
      assertReviewable(app.status, app.version, app.version);
      if (!note.trim()) throw new Error('Enter a review note.');
      if (decision === 'approved') {
        const docs = await request<PrivateDocument[]>({ action: 'documents', application_id: app.id });
        if (!docs.some(doc => doc.status === 'verified' && doc.purpose === 'kyc')) throw new Error('Verify a fictional KYC document first, then approve.');
        if (app.kind === 'investor' && !confirmedHash) {
          const receipt = await runTransaction('manager', ledger => ledger.approveInvestor(app.wallet));
          confirmedHash = receipt.hash;
          if (!mounted.current || signingAccount.current !== account) return;
          setHash(confirmedHash);
        }
      }
      await request({ action: 'review_application', id: app.id, version: app.version, decision, note, tx_hash: confirmedHash || null });
      recorded = true;
      if (!mounted.current) return;
      setMessage(app.kind === 'sme' && decision === 'approved' ? 'SME verified off-chain. No Solidity permission changed.' : 'Application review recorded.');
      await onChanged();
    } catch (cause) {
      if (mounted.current) setError(`${recorded ? 'Review was saved, but the page could not be refreshed. ' : confirmedHash && decision === 'approved' ? `On-chain approval hash: ${confirmedHash}. Application finalization is still pending; wait for two confirmations and retry using this hash. ` : ''}${(cause as Error).message}`);
    } finally { if (mounted.current) setBusy(false); }
  }
  return <><section className="section-block"><h2>{app.display_name}</h2><dl className="detail-list"><div><dt>Wallet</dt><dd className="mono">{app.wallet}</dd></div><div><dt>Application</dt><dd>{app.kind} · {app.status}</dd></div><div><dt>Contact email</dt><dd>{app.contact_email}</dd></div><div><dt>Contact phone</dt><dd>{app.contact_phone || 'Not supplied'}</dd></div>{app.kind === 'sme' && <div><dt>Company registration</dt><dd>{app.company_number}</dd></div>}{app.review_note && <div><dt>Review note</dt><dd>{app.review_note}</dd></div>}{app.approval_tx_hash && <div><dt>Approval transaction</dt><dd className="mono">{app.approval_tx_hash}</dd></div>}</dl>
    {app.status === 'pending' && <div className="registration-form"><label>Review note<textarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)} /></label>
      {app.kind === 'investor' && <label>Approval transaction hash (for finalization retry)<input className="mono" value={hash} onChange={event => setHash(event.target.value)} placeholder="Leave empty to approve through MetaMask" /></label>}
      <div className="form-row"><button className="btn" disabled={busy || transactionPending} onClick={() => void review('approved')}>{busy ? 'Processing…' : app.kind === 'investor' ? hash ? 'Retry application finalization' : 'Approve investor on Sepolia' : 'Verify SME off-chain'}</button><button className="btn o" disabled={busy || transactionPending} onClick={() => void review('rejected')}>Reject application</button></div>
      <p className="footnote">Rejecting an application does not revoke existing investor approval. Use the Investors page for on-chain revocation.</p></div>}
    {error && <p className="inline-error" role="alert">{error}</p>}{message && <p className="notice info" role="status">{message}</p>}
  </section><DocumentsPanel applicationId={app.id} /></>;
}
