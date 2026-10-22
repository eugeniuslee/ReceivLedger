import { useEffect, useState } from 'react';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { registrationInput, type Application, type RegistrationInput } from '../../supabase/functions/_shared/domain';
import type { PageId } from '../chain/access';
import { ApplicationDetails } from '../components/ApplicationDetails';
import { registrationAccess } from '../registration/access';
import { userFacingError } from '../errors';
import { SmeFinancingAssessment } from './Reports';

const statusLabels = { pending: 'Pending Review', needs_info: 'Additional information requested', approved: 'Approved', rejected: 'Rejected', suspended: 'Suspended', revoked: 'Revoked (off-chain)' };

export function ApplicationStatus({ application: app }: { application: Application }) {
  return <div className={`notice ${['rejected', 'suspended', 'revoked'].includes(app.status) ? 'warning' : 'info'}`}>
    <b>Application: {statusLabels[app.status]}</b>
    {app.review_note && <p>Manager note: {app.review_note}</p>}
    {['pending', 'needs_info'].includes(app.status) && <p>Estimated demo review target: up to 3 working days. This is illustrative and is not a guaranteed service commitment.</p>}
    <p>{app.kind === 'sme' ? 'SME verification is off-chain. Website restrictions do not prevent direct submitInvoice calls to Solidity.' : 'Live contract approval is required for RLU transfers. Off-chain approval never overrides on-chain revocation.'}</p>
  </div>;
}

export function ApplicationDashboard({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { application, authenticated } = useRegistry(); const { role } = useLedger();
  if (!application) return <section className="section-block"><h2>Restore your application</h2><p>No saved application was returned. Open Registration to review your account or contact the manager.</p><button className="btn o" onClick={() => onNavigate('registration')}>Open Registration</button></section>;
  const access = registrationAccess(role, application, authenticated);
  return <section className="section-block"><h2>{application.kind === 'investor' ? 'Investor' : 'SME'} application dashboard</h2>
    <h3>{application.display_name}</h3><ApplicationStatus application={application} /><ApplicationDetails application={application} hideNote />
    <div className="form-row"><button className="btn o" onClick={() => onNavigate('registration')}>Review submitted information</button><button className="btn o" onClick={() => onNavigate('documents')}>Your fictional documents</button>
      <button className="btn" disabled={!(application.kind === 'sme' ? access.invoiceAllowed : access.transferAllowed)} aria-describedby="application-access-reason" onClick={() => onNavigate(application.kind === 'sme' ? 'invoices' : 'transfer')}>{application.kind === 'sme' ? 'Invoice workspace' : 'Transfer RLU'}</button></div>
    {!(application.kind === 'sme' ? access.invoiceAllowed : access.transferAllowed) && <p id="application-access-reason" className="notice warning">{access.reason}</p>}
    {application.kind === 'investor' && <p className="footnote">Only the fund manager can issue RLU. An application creates no units or investment balance.</p>}
    {application.kind === 'sme' && application.status === 'approved' && <SmeFinancingAssessment />}
  </section>;
}

export function PrivateAccess({ children }: { children: React.ReactNode }) {
  const { account, networkOk, transactionPending } = useLedger();
  const { configured, authenticated, busy, signIn, error, frontendConfigurationError } = useRegistry();
  if (authenticated) return <>{children}</>;
  return <section className="section-block private-access"><h2>Sign in with your wallet</h2>
    <p>Sign a ReceivLedger sign-in message to access private applications and documents. Signing in does not send a blockchain transaction or grant investor approval.</p>
    {!configured ? <div className="notice info"><b>Frontend Supabase configuration unavailable</b><p>{frontendConfigurationError ?? 'This build must include VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY. Check the Vercel Preview build environment or local .env.local configuration.'}</p><p>Existing blockchain features remain available.</p></div>
      : <p className="notice info" role="status">Frontend Supabase configuration loaded. Wallet authentication and the registration service still need to be verified by signing in.</p>}
    {!account && <p className="support-copy">Connect MetaMask first using the button above.</p>}
    {account && !networkOk && <p className="support-copy">Switch the connected wallet to Sepolia before signing in.</p>}
    {transactionPending && <p className="support-copy">Wait for the current wallet transaction to finish before signing in.</p>}
    {configured && error && <p className="inline-error" role="alert">{error}</p>}
    <button className="btn" disabled={!configured || !account || !networkOk || busy || transactionPending} onClick={() => void signIn()}>{busy ? 'Waiting for wallet sign-in…' : 'Sign in with this wallet'}</button>
  </section>;
}

export function Welcome({ onApply }: { onApply: (kind: 'investor' | 'sme') => void }) {
  const { account, walletAvailable, walletChecking, transactionPending, connect } = useLedger();
  return <section className="section-block welcome-panel"><span className="section-kicker">Receivables, connected</span><h2>A clearer view of invoice financing.</h2>
    <p>ReceivLedger brings fund units, invoice workflows and financing records into one wallet-connected workspace.</p>
    {!account && <div className="welcome-connect"><button className="btn" disabled={!walletAvailable || walletChecking || transactionPending} onClick={() => void connect()}>Connect wallet to get started</button>
      <p className="support-copy">{walletAvailable ? 'Unlock MetaMask, select your intended account and connect. Signing in is a separate step that you choose.' : <>MetaMask is not available. Install or enable it using the <a className="tx-link" href="https://metamask.io/download/" target="_blank" rel="noreferrer">official MetaMask website</a>, or open Help & Support.</>}</p></div>}
    <div className="welcome-options"><div><h3>For investors</h3><p>Apply to join the fund, review your RLU holdings and follow confirmed activity.</p><button className="btn" onClick={() => onApply('investor')}>Apply as an Investor</button></div>
      <div><h3>For SMEs</h3><p>Register your company and share fictional invoice documents for manager review.</p><button className="btn o" onClick={() => onApply('sme')}>Register as an SME</button></div></div>
    <p className="footnote">Connect MetaMask to begin. This university prototype uses Sepolia and simulated SGD accounting. Already applied? Sign in with the same wallet to restore your saved application; private details are not cached in this browser.</p>
  </section>;
}

export function RegistrationSummary({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { role } = useLedger();
  const { application, authenticated, requiresRegistrationSession } = useRegistry();
  const access = registrationAccess(role, application, authenticated, requiresRegistrationSession);
  if (role === 'manager') return <section className="section-block"><div className="section-heading"><h2>Application & document review</h2><button className="btn o small" onClick={() => onNavigate('applications')}>Review applications</button></div><p className="support-copy">Review fictional KYC, approve investor access on Sepolia, and verify SMEs off-chain.</p></section>;
  return <section className="section-block"><div className="section-heading"><h2>{application?.display_name ?? 'Your ReceivLedger profile'}</h2><button className="btn o small" onClick={() => onNavigate('registration')}>{application ? 'View application' : 'Register or sign in'}</button></div>
    {application && <ApplicationStatus application={application} />}
    {application && application.status !== 'approved' && <p className="notice warning">{access.reason}</p>}
    <p className="support-copy">{application ? `${application.kind === 'sme' ? 'SME' : 'Investor'} application: ${application.status}. ${application.kind === 'sme' ? 'SME verification is off-chain.' : 'Live investor permissions are determined by the contract.'}` : authenticated ? 'Submit an Investor or SME application using fictional demonstration details.' : 'Sign in to access your wallet-linked registration and private documents. Existing blockchain access is preserved.'}</p>
  </section>;
}

export function Registration({ initialKind = 'investor', onSubmitted }: { initialKind?: 'investor' | 'sme'; onSubmitted?: () => void }) {
  return <PrivateAccess><RegistrationForm initialKind={initialKind} onSubmitted={onSubmitted} /></PrivateAccess>;
}
function RegistrationForm({ initialKind, onSubmitted }: { initialKind: 'investor' | 'sme'; onSubmitted?: () => void }) {
  const { account, role } = useLedger();
  const { application, request, reload, error: registryError } = useRegistry();
  const blankDetails = { country: '', website: '', business_address: '', contact_name: '' };
  const [form, setForm] = useState<RegistrationInput>({ kind: initialKind, display_name: '', company_number: '', contact_email: '', contact_phone: '', details: blankDetails });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  async function refreshApplication() {
    setBusy(true); setError(''); setMessage('');
    try { await reload(); setMessage('Application refreshed from the registration service.'); }
    catch (cause) { setError(userFacingError(cause, 'Application could not be refreshed. Please try again.')); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (application) setForm({ kind: application.kind, display_name: application.display_name, company_number: application.company_number, contact_email: application.contact_email, contact_phone: application.contact_phone, details: application.details ?? blankDetails });
  }, [application]);
  if (role === 'manager') return <section className="section-block">Use Applications to review submissions. The manager cannot apply to their own fund.</section>;
  const locked = Boolean(application && ['approved', 'suspended', 'revoked'].includes(application.status));
  function field(key: keyof RegistrationInput, value: string) { setForm(previous => ({ ...previous, [key]: value })); }
  function detail(key: keyof NonNullable<RegistrationInput['details']>, value: string) { setForm(previous => ({ ...previous, details: { ...blankDetails, ...previous.details, [key]: value } })); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    let saved = false;
    try {
      const validated = registrationInput(form);
      await request<Application>({ action: 'submit', application: validated, demo_consent: consent });
      saved = true;
      await reload(); setMessage('Application submitted for manager review. No on-chain approval was granted.'); onSubmitted?.();
    } catch (cause) { setError(`${saved ? 'Application saved, but the page could not be refreshed. Use Refresh application before resubmitting. ' : ''}${userFacingError(cause)}`); }
    finally { setBusy(false); }
  }
  return <section className="section-block account-page"><div className="section-heading"><h2>{application ? 'Your application' : 'Create your wallet-linked profile'}</h2><button className="btn o small" disabled={busy} onClick={() => void refreshApplication()}>{busy ? 'Working…' : 'Refresh application'}</button></div>
    {application && <><ApplicationStatus application={application} /><details><summary>Submitted information and review dates</summary><ApplicationDetails application={application} hideNote /></details></>}
    <p className="support-copy">Use fictional names, contact details and company information for this university demonstration. Approved display names are shared with signed-in participants; contact details and company registration numbers remain private to you and the manager.</p>
    <form className="registration-form" onSubmit={submit}>
      <label>Application type<select value={form.kind} disabled={Boolean(application) || busy} onChange={event => field('kind', event.target.value)}><option value="investor">Investor</option><option value="sme">SME</option></select></label>
      <label>{form.kind === 'sme' ? 'Registered company name' : 'Full name'}<input required minLength={2} maxLength={100} disabled={locked || busy} value={form.display_name} onChange={event => field('display_name', event.target.value)} /></label>
      {form.kind === 'sme' && <label>UEN / company registration number<input required maxLength={60} disabled={locked || busy} value={form.company_number} onChange={event => field('company_number', event.target.value)} /></label>}
      <label>{form.kind === 'sme' ? 'Business email' : 'Email address'}<input type="email" required maxLength={254} disabled={locked || busy} value={form.contact_email} onChange={event => field('contact_email', event.target.value)} /></label>
      <label>{form.kind === 'sme' ? "Contact person's phone number" : 'Contact number'}<input type="tel" required minLength={2} maxLength={40} disabled={locked || busy} value={form.contact_phone} onChange={event => field('contact_phone', event.target.value)} /></label>
      {form.kind === 'investor' ? <label>Country of residence<input required minLength={2} maxLength={100} disabled={locked || busy} value={form.details?.country ?? ''} onChange={event => detail('country', event.target.value)} /></label> : <>
        <label>Company website (optional)<input type="url" placeholder="https://example.test" maxLength={300} disabled={locked || busy} value={form.details?.website ?? ''} onChange={event => detail('website', event.target.value)} /></label>
        <label>Registered business address<textarea required minLength={2} maxLength={500} disabled={locked || busy} value={form.details?.business_address ?? ''} onChange={event => detail('business_address', event.target.value)} /></label>
        <label>Contact person's name<input required minLength={2} maxLength={100} disabled={locked || busy} value={form.details?.contact_name ?? ''} onChange={event => detail('contact_name', event.target.value)} /></label>
      </>}
      <label>Authenticated wallet<input readOnly value={account ?? ''} className="mono" /></label>
      {!locked && <><label className="consent-row"><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} />I am using fictional demonstration details and agree to share my approved display name with signed-in participants.</label><button className="btn" disabled={busy || !consent}>{busy ? 'Submitting…' : application ? 'Resubmit for review' : 'Submit application'}</button></>}
    </form>
    {application && ['pending', 'needs_info'].includes(application.status) && <p className="footnote">Open Documents to share a fictional verification PDF. Never upload real identity documents. The manager must verify a fictional PDF before approval.</p>}
    {(error || registryError) && <p className="inline-error" role="alert">{error || registryError}</p>}{message && <p className="notice info" role="status">{message}</p>}
  </section>;
}
