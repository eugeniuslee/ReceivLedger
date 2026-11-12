import { useState } from 'react';
import { useLedger } from '../chain/LedgerContext';
import { RECEIVLEDGER_ADDRESS, SEPOLIA_CHAIN_ID, SEPOLIA_EXPLORER } from '../chain/abi';
import { walletIdentity } from '../chain/navigation';
import { compactAddress, formatInteger } from '../chain/presentation';
import { eventCacheKey } from '../chain/eventCache';
import { useRegistry } from '../registration/RegistryContext';
import { PrivateAccess } from '../components/PrivateAccess';
import { DocumentsPanel } from './Documents';
import { ApplicationDetails } from '../components/ApplicationDetails';
import { ApplicationStatus } from './Registration';
import { AVATAR_CHOICES, initialsOf, useAvatar, type AvatarChoice } from '../settings/avatar';
import { usePreferences } from '../settings/preferences';
import { termsAt } from '../finance/financing';
import { userFacingError } from '../errors';
import { version } from '../../package.json';

const rate = (bps: number) => `${(bps / 100).toLocaleString('en-SG', { maximumFractionDigits: 2 })}%`;

function ContractDetails() {
  return <dl className="detail-list">
    <div><dt>Network</dt><dd>Ethereum Sepolia testnet · chain ID {SEPOLIA_CHAIN_ID}</dd></div>
    <div><dt>Ledger contract</dt><dd><a className="mono tx-link" href={`${SEPOLIA_EXPLORER}/address/${RECEIVLEDGER_ADDRESS}`} target="_blank" rel="noreferrer">{RECEIVLEDGER_ADDRESS}</a></dd></div>
    <div><dt>Fund unit</dt><dd>RLU · whole units (0 decimals)</dd></div>
  </dl>;
}

// ───────────────────────────── My Profile ─────────────────────────────

export function MyProfile({ onApplication }: { onApplication?: () => void }) {
  const { account, role, snapshot } = useLedger();
  const { registeredName, application, authenticated, configured, signOut, busy, error } = useRegistry();
  const { avatar, setAvatar } = useAvatar(account);
  const [iconMessage, setIconMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const identity = walletIdentity(role);
  if (!account || !role) return <div className="empty-state">Connect your wallet on Sepolia to view its profile.</div>;
  const name = registeredName ?? identity.name;
  const choose = (choice: AvatarChoice) => setIconMessage(setAvatar(choice) ? 'Profile icon saved on this browser.' : 'Browser storage is unavailable, so the icon applies until the page closes.');
  const copy = () => { void navigator.clipboard?.writeText(account).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => setCopied(false)); };

  return <div className="account-page">
    <section className="section-block">
      <div className="profile-heading"><span className="avatar avatar-large" aria-hidden="true">{avatar === 'initials' ? initialsOf(name) : avatar}</span>
        <div><h2>{name}</h2><p className="support-copy">{identity.name} · <span className="mono" title={account}>{compactAddress(account)}</span> <button className="text-button" onClick={copy}>{copied ? 'Copied' : 'Copy address'}</button></p></div></div>
    </section>

    <section className="section-block" aria-labelledby="profile-icon-title"><h3 id="profile-icon-title">Profile icon</h3>
      <p className="support-copy">Choose how you appear in the top-right menu. Saved on this browser.</p>
      <div className="avatar-picker" role="group" aria-label="Profile icon">{AVATAR_CHOICES.map(choice => <button key={choice} type="button" className="avatar-choice" aria-pressed={avatar === choice} aria-label={choice === 'initials' ? `Initials (${initialsOf(name)})` : `Icon ${choice}`} onClick={() => choose(choice)}>{choice === 'initials' ? <b>{initialsOf(name)}</b> : choice}</button>)}</div>
      {iconMessage && <p className="support-copy" role="status">{iconMessage}</p>}
    </section>

    <section className="section-block" aria-labelledby="profile-name-title"><h3 id="profile-name-title">Registered name</h3>
      <dl className="detail-list"><div><dt>Registered name</dt><dd>{registeredName ?? 'No registration profile is connected yet.'}</dd></div></dl>
      {role === 'manager' ? <p className="support-copy">The fund manager is identified by the contract owner wallet and has no registered name.</p>
        : configured ? <PrivateAccess compact>{application ? <RenameForm current={application.display_name} /> : <p className="support-copy">Submit an application to choose a registered name.</p>}</PrivateAccess>
        : <p className="support-copy">Registered names need the private registration service, which is not configured here.</p>}
    </section>

    <section className="section-block"><h3>Account details</h3>
      <dl className="detail-list">
        <div><dt>Wallet address</dt><dd className="mono selectable-address">{account}</dd></div>
        <div><dt>Current role</dt><dd>{identity.name}</dd></div>
        {application?.kind === 'sme' && <div><dt>UEN / company registration number</dt><dd>{application.company_number}</dd></div>}
        <div><dt>Private session</dt><dd>{authenticated ? 'Signed in with this wallet' : 'Not signed in'}</dd></div>
        {application && <div><dt>Application</dt><dd>{application.kind} · {application.status}</dd></div>}
        {snapshot && 'connectedBalance' in snapshot && <div><dt>RLU holdings</dt><dd>{formatInteger(snapshot.connectedBalance)} RLU</dd></div>}
      </dl>
      <div className="form-row">
        {configured && authenticated && <button className="btn o" disabled={busy} onClick={() => void signOut()}>Sign out of private profile</button>}
        {onApplication && role !== 'manager' && <button className="btn o" onClick={onApplication}>{application ? 'Review your application' : 'Register or restore account'}</button>}
      </div>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </section>
    <PrivateAccess>{application && <details className="help-item"><summary>Application details</summary><ApplicationStatus application={application} /><ApplicationDetails application={application} /></details>}<DocumentsPanel /></PrivateAccess>
  </div>;
}

/** Change the registered name. Names must be unique; the server enforces this for every applicant. */
function RenameForm({ current }: { current: string }) {
  const { request, reload, nameInUse } = useRegistry();
  const [draft, setDraft] = useState(current);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const name = draft.trim();
  const unchanged = name.toLowerCase() === current.trim().toLowerCase() && name === current.trim();
  const problem = !name ? 'Enter a name.' : name.length < 2 ? 'Use at least 2 characters.' : name.length > 100 ? 'Use at most 100 characters.' : nameInUse?.(name) ? 'That name is already used. Choose a different name.' : '';
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(''); setError('');
    if (problem || unchanged) return;
    setSaving(true);
    try {
      await request({ action: 'rename', display_name: name });
      await reload();
      setMessage('Registered name updated.');
    } catch (cause) { setError(userFacingError(cause)); }
    finally { setSaving(false); }
  }
  return <form className="registration-form" onSubmit={event => void save(event)}>
    <label>New registered name<input value={draft} maxLength={100} onChange={event => { setDraft(event.target.value); setMessage(''); setError(''); }} aria-invalid={Boolean(problem) && !unchanged} aria-describedby="rename-help" /></label>
    <small id="rename-help" className={problem && !unchanged ? 'inline-error' : 'document-meta'}>{problem && !unchanged ? problem : 'Must be unique across ReceivLedger. Approved names are visible to other signed-in participants.'}</small>
    <div><button className="btn" disabled={saving || unchanged || Boolean(problem)}>{saving ? 'Saving…' : 'Save name'}</button></div>
    {message && <p className="notice info" role="status">{message}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </form>;
}

// ───────────────────────────── Settings ─────────────────────────────

export function Settings({ rememberPage, onRememberPage }: { rememberPage: boolean; onRememberPage: (value: boolean) => boolean }) {
  const { account, networkOk, walletAvailable, walletChecking, transactionPending, disconnect, connect } = useLedger();
  const { authenticated, configured, signOut } = useRegistry();
  const { preferences, update, reset } = usePreferences();
  const [message, setMessage] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const saved = (ok: boolean) => setMessage(ok ? 'Saved on this browser.' : 'Browser storage is unavailable. This applies until the page is closed.');
  function clearHistory() {
    try { window.localStorage.removeItem(eventCacheKey(RECEIVLEDGER_ADDRESS, SEPOLIA_CHAIN_ID)); } catch { /* nothing cached */ }
    window.location.reload();
  }

  return <div className="account-page settings-grid">
    <section className="section-block"><h2>Appearance</h2>
      <div className="setting-row"><span><strong>Text size</strong><small>Make text and tables larger on this browser.</small></span>
        <div className="segmented" role="group" aria-label="Text size">{(['default', 'large'] as const).map(size => <button key={size} type="button" aria-pressed={preferences.textSize === size} onClick={() => saved(update({ textSize: size }))}>{size === 'default' ? 'Default' : 'Large'}</button>)}</div></div>
      <label className="setting-row"><span><strong>Reduce motion</strong><small>Turn off animations and transitions.</small></span><input type="checkbox" checked={preferences.reduceMotion} onChange={event => saved(update({ reduceMotion: event.target.checked }))} /></label>
    </section>

    <section className="section-block"><h2>Notifications</h2>
      <label className="setting-row"><span><strong>Show notification badges on tabs</strong><small>Red counts on tabs with items to review, such as invoices to approve.</small></span><input type="checkbox" checked={preferences.showBadges} onChange={event => saved(update({ showBadges: event.target.checked }))} /></label>
    </section>

    <section className="section-block"><h2>Navigation</h2>
      <label className="setting-row"><span><strong>Remember my page in this tab</strong><small>Reopening the same wallet keeps your page. A different wallet always opens Home.</small></span><input type="checkbox" checked={rememberPage} onChange={event => saved(onRememberPage(event.target.checked))} /></label>
    </section>

    <section className="section-block"><h2>Wallet and privacy</h2>
      <dl className="detail-list">
        <div><dt>Connected wallet</dt><dd className="mono">{account ? compactAddress(account) : 'Not connected'}</dd></div>
        <div><dt>Network</dt><dd>{!account ? '—' : networkOk ? 'Sepolia' : 'Wrong network: switch to Sepolia in MetaMask'}</dd></div>
        <div><dt>Private session</dt><dd>{!configured ? 'Not configured' : authenticated ? 'Signed in with this wallet' : 'Not signed in'}</dd></div>
      </dl>
      <label className="setting-row"><span><strong>Sign in automatically when I connect</strong><small>MetaMask asks for the free sign-in signature right after you connect. You stay signed in on this browser until you sign out or switch wallet.</small></span><input type="checkbox" checked={preferences.autoSignIn} onChange={event => saved(update({ autoSignIn: event.target.checked }))} /></label>
      <div className="form-row">
        <button className="btn o" disabled={!walletAvailable || walletChecking || transactionPending} onClick={() => { if (account) { void disconnect(); void signOut(); } else void connect(); }}>{account ? 'Disconnect wallet' : 'Connect wallet'}</button>
        {authenticated && <button className="btn o" onClick={() => void signOut()}>Sign out of private session</button>}
      </div>
      <p className="footnote">You can also remove this site from MetaMask’s connected sites. ReceivLedger never asks for your seed phrase or private key.</p>
    </section>

    <section className="section-block"><h2>Data on this browser</h2>
      <div className="setting-row"><span><strong>Cached blockchain history</strong><small>Clear the saved event history and re-read it from Sepolia. The first load afterwards is slower.</small></span>
        {confirmClear ? <span className="form-row"><button className="btn" onClick={clearHistory}>Clear and reload</button><button className="btn o" onClick={() => setConfirmClear(false)}>Cancel</button></span> : <button className="btn o" onClick={() => setConfirmClear(true)}>Clear cache</button>}</div>
      <div className="setting-row"><span><strong>Display preferences</strong><small>Restore text size, motion and badge settings to their defaults.</small></span><button className="btn o" onClick={() => saved(reset())}>Reset</button></div>
    </section>

    {message && <p className="support-copy" role="status">{message}</p>}
    <section className="section-block"><h2>Network details</h2><ContractDetails /><p className="footnote">These are fixed by the deployed contract and cannot be changed here.</p></section>
  </div>;
}

// ───────────────────────────── Help & Support ─────────────────────────────

interface Faq { q: string; a: React.ReactNode; text: string }
const faq = (q: string, a: string): Faq => ({ q, a, text: `${q} ${a}`.toLowerCase() });
const terms = termsAt(Math.floor(Date.now() / 1000));
const HELP: { title: string; items: Faq[] }[] = [
  { title: 'Getting started', items: [
    faq('How do I connect my wallet?', 'Install MetaMask, select the Sepolia test network, then press Connect MetaMask at the top right. Choose the account you want in MetaMask; switching account reloads that wallet’s own view.'),
    faq('How do I register as an investor or SME?', 'Connect your wallet, choose Investor or SME, sign the ReceivLedger sign-in message, and complete the form. Upload a supporting PDF in Documents. The fund manager reviews applications; investors are then approved on-chain.'),
    faq('Why do I need to sign in with my wallet?', 'Signing a message (not a transaction, and free) proves you control the wallet. It protects private applications, documents and names. Connecting alone does not prove ownership.'),
  ] },
  { title: 'Fund, NAV and RLU', items: [
    faq('What is RLU?', 'RLU are ReceivLedger fund units. Each represents a share of the fund. They are issued at S$1.00 each when an investor subscribes and are whole units only.'),
    faq('How is the Fund NAV calculated?', 'NAV = fund capital + income earned. Income is service fees and daily interest on financed invoices, including income already collected on repaid invoices. The Finances tab shows the full breakdown.'),
    faq('What is NAV per RLU?', 'Fund NAV divided by the number of RLU in issue, rounded to the cent. It shows what one unit is worth today.'),
    faq('Can I redeem RLU?', 'The current ledger contract has no on-chain redemption, so redemptions are settled off-chain by the fund manager.'),
  ] },
  { title: 'Invoices and financing', items: [
    faq('How much cash does an SME receive?', `The SME receives ${rate(terms.advanceBps)} of the invoice amount upfront. The remaining ${rate(10000 - terms.advanceBps)} is held back until the invoice is settled.`),
    faq('What does financing cost?', `A one-time ${rate(terms.serviceFeeBps)} service fee on the invoice amount, plus ${rate(terms.annualInterestBps)} a year simple interest on the cash advanced, charged daily. Repaying early reduces the interest; the fee does not change.`),
    faq('What happens to the holdback?', 'Once the invoice is paid in full, the holdback is released to the SME after deducting the service fee and interest.'),
    faq('Why is my invoice overdue?', 'An invoice is overdue when it is financed and its due date has passed without a recorded repayment. Contact the fund manager to arrange repayment.'),
  ] },
  { title: 'Wallet and security', items: [
    faq('MetaMask shows a security warning', 'Cancel the request and do not sign or bypass the warning. Report it through the official MetaMask Help Center.'),
    faq('Is any real money involved?', 'No. ReceivLedger runs on the Sepolia test network. RLU and SGD amounts have no real monetary value, and no real payments are made.'),
    faq('How do I check a transaction?', 'Open Transaction History and follow the Sepolia Etherscan link. A cancelled MetaMask prompt is not a transaction. Never approve a prompt you did not start.'),
  ] },
  { title: 'Troubleshooting', items: [
    faq('My records are missing or out of date', 'Press Refresh blockchain at the top of the page. The first visit can take longer while history is indexed. If it persists, clear the cached history in Settings.'),
    faq('Some figures show “—” or “Name unavailable”', 'Names, applications and documents are private: sign in with your wallet to see them. Other figures appear once Sepolia records finish loading.'),
  ] },
];
const GLOSSARY: [string, string][] = [
  ['NAV', 'Net asset value: what the fund is worth today.'], ['RLU', 'ReceivLedger fund unit, issued at S$1.00.'],
  ['Advance', `Cash paid to the SME upfront (${rate(terms.advanceBps)} of the invoice).`], ['Holdback', 'The part of the invoice kept back until settlement.'],
  ['Service fee', `One-time ${rate(terms.serviceFeeBps)} fee on the invoice amount.`], ['Receivables', 'Money owed to the fund by SMEs on financed invoices.'],
];

export function Help() {
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const sections = HELP.map(section => ({ ...section, items: term ? section.items.filter(item => item.text.includes(term)) : section.items })).filter(section => section.items.length);
  return <div className="account-page">
    <section className="section-block"><h2>Help & Support</h2>
      <p className="support-copy">Find answers to common questions. Never share your seed phrase or private key with anyone.</p>
      <label><span className="sr-only">Search help</span><input type="search" className="help-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search help, e.g. NAV, holdback, MetaMask" /></label>
      {sections.length ? sections.map(section => <div className="help-category" key={section.title}><h3>{section.title}</h3>
        {section.items.map((item, index) => <details className="help-item" key={item.q} open={Boolean(term) || (section.title === 'Getting started' && index === 0)}><summary>{item.q}</summary><p>{item.a}</p></details>)}</div>)
        : <p className="empty-state compact">No help topics match “{query.trim()}”.</p>}
    </section>
    <section className="section-block"><h2>Financing terms</h2>
      <dl className="detail-list">
        <div><dt>Advance to SME</dt><dd>{rate(terms.advanceBps)} of the invoice amount</dd></div>
        <div><dt>Holdback</dt><dd>{rate(10000 - terms.advanceBps)}, released after settlement less charges</dd></div>
        <div><dt>Service fee</dt><dd>{rate(terms.serviceFeeBps)} of the invoice amount, once</dd></div>
        <div><dt>Interest</dt><dd>{rate(terms.annualInterestBps)} a year, simple, on the cash advanced</dd></div>
      </dl>
    </section>
    <section className="section-block"><h2>Glossary</h2><dl className="glossary">{GLOSSARY.map(([word, meaning]) => <div key={word}><dt>{word}</dt><dd>{meaning}</dd></div>)}</dl></section>
    <section className="section-block"><h2>Contact support</h2>
      <p>No project support contact has been configured. For wallet troubleshooting, use the official <a className="tx-link" href="https://support.metamask.io/" target="_blank" rel="noreferrer">MetaMask Help Center</a>.</p>
      <p className="footnote">When reporting an issue, describe the page, what you expected and the error shown. Do not include personal documents, seed phrases or private keys.</p>
    </section>
  </div>;
}

// ───────────────────────────── About ─────────────────────────────

export function About() {
  return <div className="account-page">
    <section className="section-block"><h2>About ReceivLedger</h2>
      <p>ReceivLedger is a tokenised invoice financing fund. Investors buy fund units (RLU); the fund uses that capital to advance cash to SMEs against their unpaid invoices, and earns fees and interest when the invoices are paid.</p>
    </section>
    <section className="section-block"><h2>How it works</h2>
      <ol className="steps">
        <li><b>Investors subscribe</b>Approved investors receive RLU at S$1.00 each, growing the fund’s capital.</li>
        <li><b>SMEs submit invoices</b>An SME submits an unpaid invoice with its PDF. The fund manager reviews and approves it.</li>
        <li><b>The fund advances cash</b>The SME receives {rate(terms.advanceBps)} upfront; {rate(10000 - terms.advanceBps)} is held back.</li>
        <li><b>Repayment and income</b>When the invoice is paid, the fund collects its advance plus a {rate(terms.serviceFeeBps)} fee and {rate(terms.annualInterestBps)} a year interest, lifting the NAV.</li>
      </ol>
    </section>
    <section className="section-block"><h2>What ReceivLedger represents</h2>
      <p>Balances, invoice records and transactions are real records on the Ethereum Sepolia test network. Fund capital and repayments are SGD accounting entries. RLU and SGD amounts have no real monetary value, and no real payments are made.</p>
      <p className="footnote">Blockchain records are public. Registration details and documents are kept in a separate private service and are visible only to the applicant and the fund manager.</p>
    </section>
    <section className="section-block"><h2>Contract and version</h2><ContractDetails />
      <dl className="detail-list"><div><dt>Website version</dt><dd>{version}</dd></div></dl>
    </section>
  </div>;
}
