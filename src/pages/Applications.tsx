import { userFacingError } from '../errors';
import { useEffect, useRef, useState } from 'react';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { assertApplicationReview, type ApplicationDecision, type Application, type PrivateDocument } from '../../supabase/functions/_shared/domain';
import { PrivateAccess } from './Registration';
import { ApplicationDetails, applicationDate } from '../components/ApplicationDetails';
import { DocumentsPanel } from './Documents';

export function Applications() {
  const { role } = useLedger();
  if (role !== 'manager') return <div className="notice error">Fund manager access required.</div>;
  return <PrivateAccess><ApplicationList /></PrivateAccess>;
}
function ApplicationList() {
  const { isManager, request, reload } = useRegistry();
  const [rows, setRows] = useState<Application[]>([]); const [filter, setFilter] = useState('pending');
  const statusFilters = [{ value: 'pending', title: 'Pending' }, { value: 'approved', title: 'Approved' }, { value: 'rejected', title: 'Rejected' }, { value: 'needs_info', title: 'Requires more information' }];
  const [selected, setSelected] = useState<string | null>(null); const [error, setError] = useState('');
  const [loading, setLoading] = useState(true); const [loaded, setLoaded] = useState(false);
  const requestRef = useRef(request); requestRef.current = request;
  const mounted = useRef(true);
  async function load() {
    setLoading(true); setError('');
    try {
      const apps = await requestRef.current<Application[]>({ action: 'applications' });
      if (mounted.current) { setRows(apps); setLoaded(true); }
    } finally { if (mounted.current) setLoading(false); }
  }
  async function refreshApplications() {
    try { await load(); } catch (cause) { if (mounted.current) setError(userFacingError(cause)); }
  }
  useEffect(() => { mounted.current = true; if (isManager) void refreshApplications(); return () => { mounted.current = false; }; }, [isManager]);
  if (!isManager) return <div className="notice error">Your signed session is not the contract's fund manager.</div>;
  const app = rows.find(row => row.id === selected);
  return <><section className="section-block"><div className="section-heading"><h2>Registration applications</h2><div className="history-controls"><label>Status<select value={filter} onChange={event => setFilter(event.target.value)}><option value="pending">Pending</option><option value="needs_info">Additional information requested</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="suspended">Suspended</option><option value="revoked">Revoked (off-chain)</option><option value="all">All</option></select></label><button className="btn o small" disabled={loading} onClick={() => void refreshApplications()}>{loading ? 'Loading applications…' : 'Refresh applications'}</button></div></div>
    <p className="support-copy">Latest 200 applications. Verify fictional KYC before approval. Investor access is approved through the existing Sepolia contract; SME verification remains off-chain.</p>
    <div className="application-tabs" role="group" aria-label="Application status filters">{statusFilters.map(item => <button className={`btn ${filter === item.value ? '' : 'o'}`} aria-pressed={filter === item.value} key={item.value} onClick={() => setFilter(item.value)}>{item.title} ({rows.filter(row => row.status === item.value).length})</button>)}</div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {loading ? <p role="status">Loading private applications…</p> : loaded && !error && <p className="support-copy" role="status">Applications refreshed. {rows.filter(row => filter === 'all' || row.status === filter).length} match the selected status.</p>}
    {!loading && loaded && !error && !rows.some(row => filter === 'all' || row.status === filter) && <p className="empty-state compact">No applications match this status.</p>}
    <div className="table-scroll"><table><thead><tr><th>Name / company</th><th>Wallet</th><th>Application</th><th>Submitted (SGT)</th><th>Status</th><th>Review</th></tr></thead><tbody>{rows.filter(row => filter === 'all' || row.status === filter).map(row => <tr key={row.id}><td>{row.display_name}</td><td className="mono">{row.wallet}</td><td>{row.kind === 'sme' ? 'SME' : 'Investor'}</td><td>{applicationDate(row.submitted_at ?? row.created_at)}</td><td>{row.status}</td><td><button className="btn o small" onClick={() => setSelected(row.id)}>Review details</button></td></tr>)}</tbody></table></div>
  </section>{app && <ApplicationReview key={`${app.id}:${app.version}`} application={app} onChanged={async () => { await load(); await reload(); }} />}</>;
}
function ApplicationReview({ application: app, onChanged }: { application: Application; onChanged: () => Promise<void> }) {
  const { runTransaction, transactionPending, account } = useLedger();
  const { request } = useRegistry();
  const [note, setNote] = useState(''); const [hash, setHash] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const mounted = useRef(true); const signingAccount = useRef(account);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function review(decision: ApplicationDecision) {
    setBusy(true); setError(''); setMessage(''); let confirmedHash = hash.trim(); let recorded = false;
    try {
      assertApplicationReview(app.status, app.version, app.version, decision);
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
      if (mounted.current) setError(`${recorded ? 'Review was saved, but the page could not be refreshed. ' : confirmedHash && decision === 'approved' ? `On-chain approval hash: ${confirmedHash}. Application finalization is still pending; wait for two confirmations and retry using this hash. ` : ''}${userFacingError(cause)}`);
    } finally { if (mounted.current) setBusy(false); }
  }
  return <><section className="section-block"><h2>{app.display_name}</h2><p>Application status: {app.status}</p><ApplicationDetails application={app} />
    {['pending', 'approved', 'suspended'].includes(app.status) && <div className="registration-form"><label>Review note<textarea value={note} maxLength={2000} onChange={event => setNote(event.target.value)} /></label>
      {app.kind === 'investor' && app.status === 'pending' && <label>Approval transaction hash (for finalization retry)<input className="mono" value={hash} onChange={event => setHash(event.target.value)} placeholder="Leave empty to approve through MetaMask" /></label>}
      <div className="form-row">{app.status === 'pending' ? <><button className="btn" disabled={busy || transactionPending} onClick={() => void review('approved')}>{busy ? 'Processing…' : app.kind === 'investor' ? hash ? 'Retry application finalization' : 'Approve investor on Sepolia' : 'Verify SME off-chain'}</button><button className="btn o" disabled={busy || transactionPending} onClick={() => void review('rejected')}>Reject application</button><button className="btn o" disabled={busy || transactionPending} onClick={() => void review('needs_info')}>Request additional information</button></> : <>
        {app.status === 'approved' ? <button className="btn o" disabled={busy || transactionPending} onClick={() => void review('suspended')}>Suspend off-chain application</button> : <button className="btn o" disabled={busy || transactionPending} onClick={() => void review('needs_info')}>Request updated information</button>}
        <button className="btn o" disabled={busy || transactionPending} onClick={() => void review('revoked')}>Revoke off-chain application</button>
      </>}</div>
      <p className="footnote">Rejecting, suspending or revoking an off-chain application does not change investor approval in Solidity. Use the Investors page for a separately confirmed on-chain revocation. Direct SME contract calls remain possible.</p></div>}
    {error && <p className="inline-error" role="alert">{error}</p>}{message && <p className="notice info" role="status">{message}</p>}
  </section><DocumentsPanel applicationId={app.id} /></>;
}
