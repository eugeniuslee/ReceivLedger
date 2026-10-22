import { useEffect, useState } from 'react';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { registrationInput, type Application, type RegistrationInput } from '../../supabase/functions/_shared/domain';
import type { PageId } from '../chain/access';

export function PrivateAccess({ children }: { children: React.ReactNode }) {
  const { account, networkOk, transactionPending } = useLedger();
  const { configured, authenticated, busy, signIn, error } = useRegistry();
  if (authenticated) return <>{children}</>;
  return <section className="section-block private-access"><h2>Sign in with your wallet</h2>
    <p>Sign a ReceiveLedger sign-in message to access private applications and documents. Signing in does not send a blockchain transaction or grant investor approval.</p>
    {!configured && <p className="notice info">Private registration is not configured yet. Existing blockchain features remain available.</p>}
    {!account && <p className="support-copy">Connect MetaMask first using the button above.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <button className="btn" disabled={!configured || !account || !networkOk || busy || transactionPending} onClick={() => void signIn()}>{busy ? 'Waiting for wallet sign-in…' : 'Sign in with this wallet'}</button>
  </section>;
}

export function Welcome({ onApply }: { onApply: (kind: 'investor' | 'sme') => void }) {
  return <section className="section-block welcome-panel"><span className="section-kicker">Receivables, connected</span><h2>A clearer view of invoice financing.</h2>
    <p>ReceiveLedger brings fund units, invoice workflows and financing records into one wallet-connected workspace.</p>
    <div className="welcome-options"><div><h3>For investors</h3><p>Apply to join the fund, review your RLU holdings and follow confirmed activity.</p><button className="btn" onClick={() => onApply('investor')}>Apply as an Investor</button></div>
      <div><h3>For SMEs</h3><p>Register your company and share fictional invoice documents for manager review.</p><button className="btn o" onClick={() => onApply('sme')}>Register as an SME</button></div></div>
    <p className="footnote">Connect MetaMask to begin. This university prototype uses Sepolia and simulated SGD accounting.</p>
  </section>;
}

export function RegistrationSummary({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { role } = useLedger();
  const { application, authenticated } = useRegistry();
  if (role === 'manager') return <section className="section-block"><div className="section-heading"><h2>Application & document review</h2><button className="btn o small" onClick={() => onNavigate('applications')}>Review applications</button></div><p className="support-copy">Review fictional KYC, approve investor access on Sepolia, and verify SMEs off-chain.</p></section>;
  return <section className="section-block"><div className="section-heading"><h2>{application?.display_name ?? 'Your ReceiveLedger profile'}</h2><button className="btn o small" onClick={() => onNavigate('registration')}>{application ? 'View application' : 'Register or sign in'}</button></div>
    <p className="support-copy">{application ? `${application.kind === 'sme' ? 'SME' : 'Investor'} application: ${application.status}. ${application.kind === 'sme' ? 'SME verification is off-chain.' : 'Live investor permissions are determined by the contract.'}` : authenticated ? 'Submit an Investor or SME application using fictional demonstration details.' : 'Sign in to access your wallet-linked registration and private documents. Existing blockchain access is preserved.'}</p>
  </section>;
}

export function Registration({ initialKind = 'investor' }: { initialKind?: 'investor' | 'sme' }) {
  return <PrivateAccess><RegistrationForm initialKind={initialKind} /></PrivateAccess>;
}
function RegistrationForm({ initialKind }: { initialKind: 'investor' | 'sme' }) {
  const { account, role } = useLedger();
  const { application, request, reload, error: registryError } = useRegistry();
  const [form, setForm] = useState<RegistrationInput>({ kind: initialKind, display_name: '', company_number: '', contact_email: '', contact_phone: '' });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => {
    if (application) setForm({ kind: application.kind, display_name: application.display_name, company_number: application.company_number, contact_email: application.contact_email, contact_phone: application.contact_phone });
  }, [application]);
  if (role === 'manager') return <section className="section-block">Use Applications to review submissions. The manager cannot apply to their own fund.</section>;
  const locked = application?.status === 'approved';
  function field(key: keyof RegistrationInput, value: string) { setForm(previous => ({ ...previous, [key]: value })); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const validated = registrationInput(form);
      await request<Application>({ action: 'submit', application: validated, demo_consent: consent });
      await reload(); setMessage('Application submitted for manager review. No on-chain approval was granted.');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="section-block account-page"><div className="section-heading"><h2>{application ? 'Your application' : 'Create your wallet-linked profile'}</h2><button className="btn o small" disabled={busy} onClick={() => void reload()}>Refresh application</button></div>
    {application && <div className={`notice ${application.status === 'rejected' ? 'warning' : 'info'}`}><b>Application: {application.status}</b>{application.review_note && <p>Manager note: {application.review_note}</p>}{application.kind === 'sme' && <p>SME verification is off-chain and does not alter Solidity permissions.</p>}{application.kind === 'investor' && <p>Live contract approval takes precedence. An approved application does not override a later revocation.</p>}</div>}
    <p className="support-copy">Use fictional names, contact details and company information for this university demonstration. Approved display names are shared with signed-in participants; contact details and company registration numbers remain private to you and the manager.</p>
    <form className="registration-form" onSubmit={submit}>
      <label>Application type<select value={form.kind} disabled={Boolean(application) || busy} onChange={event => field('kind', event.target.value)}><option value="investor">Investor</option><option value="sme">SME</option></select></label>
      <label>{form.kind === 'sme' ? 'Registered company name' : 'Display name'}<input required minLength={2} maxLength={100} disabled={locked || busy} value={form.display_name} onChange={event => field('display_name', event.target.value)} /></label>
      {form.kind === 'sme' && <label>Company registration number<input required maxLength={60} disabled={locked || busy} value={form.company_number} onChange={event => field('company_number', event.target.value)} /></label>}
      <label>Contact email<input type="email" required maxLength={254} disabled={locked || busy} value={form.contact_email} onChange={event => field('contact_email', event.target.value)} /></label>
      <label>Contact phone (optional)<input type="tel" maxLength={40} disabled={locked || busy} value={form.contact_phone} onChange={event => field('contact_phone', event.target.value)} /></label>
      <label>Authenticated wallet<input readOnly value={account ?? ''} className="mono" /></label>
      {!locked && <><label className="consent-row"><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} />I am using fictional demonstration details and agree to share my approved display name with signed-in participants.</label><button className="btn" disabled={busy || !consent}>{busy ? 'Submitting…' : application ? 'Resubmit for review' : 'Submit application'}</button></>}
    </form>
    {application?.status === 'pending' && <p className="footnote">Next, open Documents to upload fictional KYC. The manager must verify that PDF before approving your application.</p>}
    {(error || registryError) && <p className="inline-error" role="alert">{error || registryError}</p>}{message && <p className="notice info" role="status">{message}</p>}
  </section>;
}
