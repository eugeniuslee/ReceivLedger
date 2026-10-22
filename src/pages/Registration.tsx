import { useEffect, useState } from 'react';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { registrationInput, type Application, type RegistrationInput } from '../../supabase/functions/_shared/domain';
import type { PageId } from '../chain/access';
import { ApplicationDetails } from '../components/ApplicationDetails';
import { registrationAccess } from '../registration/access';
import { userFacingError } from '../errors';
import { SmeCapacity, SmeFinancingAssessment } from './Reports';
import { PrivateAccess } from '../components/PrivateAccess';
import { DocumentsPanel } from './Documents';

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
    <div className="form-row"><button className="btn o" onClick={() => onNavigate('registration')}>Review submitted information</button>
      <button className="btn" disabled={!(application.kind === 'sme' ? access.invoiceAllowed : access.transferAllowed)} aria-describedby="application-access-reason" onClick={() => onNavigate(application.kind === 'sme' ? 'submitInvoice' : 'assets')}>{application.kind === 'sme' ? 'Invoice workspace' : 'Transfer RLU'}</button></div>
    {!(application.kind === 'sme' ? access.invoiceAllowed : access.transferAllowed) && <p id="application-access-reason" className="notice warning">{access.reason}</p>}
    {application.kind === 'investor' && <p className="footnote">Only the fund manager can issue RLU. An application creates no units or investment balance.</p>}
    <DocumentsPanel applicationId={application.id} allowUpload />
    {application.kind === 'sme' && application.status === 'approved' && <><SmeCapacity /><SmeFinancingAssessment /></>}
  </section>;
}

export { PrivateAccess } from '../components/PrivateAccess';

export function Welcome() {
  const { walletAvailable, walletChecking, transactionPending, connect } = useLedger();
  return <section className="welcome-panel public-welcome">
    <h1>Register your ReceivLedger Account</h1><p>Connect your wallet to get started.</p>
    <button className="btn connect-primary" disabled={!walletAvailable || walletChecking || transactionPending} onClick={() => void connect()}>{walletChecking ? 'Checking wallet...' : 'Connect Your Wallet'}</button>
    {!walletAvailable && <p className="support-copy">MetaMask is unavailable. Install or enable it from the <a className="tx-link" href="https://metamask.io/download/" target="_blank" rel="noreferrer">official MetaMask website</a>.</p>}
    <p className="footnote">University demonstration on Ethereum Sepolia</p>
  </section>;
}

export function AccountChoice({ onChoose }: { onChoose: (kind: 'investor' | 'sme') => void }) {
  const { account, eventIndexComplete, eventsError } = useLedger();
  const { authenticated, configured, busy, signIn, error } = useRegistry();
  return <section className="section-block account-choice"><span className="section-kicker">Your connected wallet</span>
    <p className="mono selectable-address">{account}</p>
    <h2>What type of account would you like to register?</h2>
    {!eventIndexComplete ? <p role="status">{eventsError ? 'Blockchain account recognition could not finish. Refresh before choosing a new account type.' : 'Checking existing blockchain records before offering a new account...'}</p> : <div className="welcome-options">
      <div><h3>Investor</h3><p>Apply to hold RLU and view your investment illustrations.</p><button className="btn" onClick={() => onChoose('investor')}>Investor</button></div>
      <div><h3>SME</h3><p>Register your company and follow its invoice financing.</p><button className="btn o" onClick={() => onChoose('sme')}>SME</button></div>
    </div>}
    {!authenticated && <><p className="support-copy">Already registered? Private accounts can only be recognised after secure wallet sign-in. An existing application takes precedence over a new selection.</p>
      <button className="btn o" disabled={!configured || busy} onClick={() => void signIn()}>{busy ? 'Waiting for sign-in...' : 'Sign in to restore account'}</button></>}
    {authenticated && <p className="notice info">No application was returned for this signed-in wallet. Choose an account type to continue without another signature.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
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
    <p className="support-copy">Fields marked with * are required. Your wallet is filled automatically. Supporting PDFs can be attached after saving.</p>
    <form className="registration-form" onSubmit={submit}>
      <label>Application type<select value={form.kind} disabled={Boolean(application) || busy} onChange={event => field('kind', event.target.value)}><option value="investor">Investor</option><option value="sme">SME</option></select></label>
      <label>{form.kind === 'sme' ? 'Registered company name' : 'Full name'}<span className="required-marker" aria-hidden="true" /><input required minLength={2} maxLength={100} disabled={locked || busy} value={form.display_name} onChange={event => field('display_name', event.target.value)} /></label>
      {form.kind === 'sme' && <label>UEN / company registration number<span className="required-marker" aria-hidden="true" /><input required maxLength={60} disabled={locked || busy} value={form.company_number} onChange={event => field('company_number', event.target.value)} /></label>}
      <label>{form.kind === 'sme' ? 'Business email' : 'Email address'}<span className="required-marker" aria-hidden="true" /><input type="email" required maxLength={254} disabled={locked || busy} value={form.contact_email} onChange={event => field('contact_email', event.target.value)} /></label>
      <label>{form.kind === 'sme' ? "Contact person's phone number" : 'Contact number'}<span className="required-marker" aria-hidden="true" /><input type="tel" required minLength={2} maxLength={40} disabled={locked || busy} value={form.contact_phone} onChange={event => field('contact_phone', event.target.value)} /></label>
      {form.kind === 'investor' ? <label>Country of residence<span className="required-marker" aria-hidden="true" /><input required minLength={2} maxLength={100} disabled={locked || busy} value={form.details?.country ?? ''} onChange={event => detail('country', event.target.value)} /></label> : <>
        <label>Company website (optional)<input type="url" placeholder="https://example.test" maxLength={300} disabled={locked || busy} value={form.details?.website ?? ''} onChange={event => detail('website', event.target.value)} /></label>
        <label>Registered business address<span className="required-marker" aria-hidden="true" /><textarea required minLength={2} maxLength={500} disabled={locked || busy} value={form.details?.business_address ?? ''} onChange={event => detail('business_address', event.target.value)} /></label>
        <label>Contact person's name<span className="required-marker" aria-hidden="true" /><input required minLength={2} maxLength={100} disabled={locked || busy} value={form.details?.contact_name ?? ''} onChange={event => detail('contact_name', event.target.value)} /></label>
      </>}
      <label>Authenticated wallet<input readOnly value={account ?? ''} className="mono" /></label>
      {!locked && <><label className="consent-row"><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} />I am using fictional demonstration details and agree to share my approved display name with signed-in participants.</label><button className="btn" disabled={busy || !consent}>{busy ? 'Submitting…' : application ? 'Resubmit for review' : 'Submit application'}</button></>}
    </form>
    {application && <DocumentsPanel applicationId={application.id} allowUpload />}
    {application && ['pending', 'needs_info'].includes(application.status) && <p className="footnote">Use the supporting document section to attach a fictional verification PDF. Never upload real identity documents. Supporting uploads can be added after submission; the manager must verify fictional KYC before approval.</p>}
    {(error || registryError) && <p className="inline-error" role="alert">{error || registryError}</p>}{message && <p className="notice info" role="status">{message}</p>}
  </section>;
}
