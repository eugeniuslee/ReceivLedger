import { useState } from 'react';
import { useLedger } from '../chain/LedgerContext';
import { RECEIVLEDGER_ADDRESS, SEPOLIA_CHAIN_ID, SEPOLIA_EXPLORER } from '../chain/abi';
import { walletIdentity } from '../chain/navigation';
import { formatInteger } from '../chain/presentation';
import { useRegistry } from '../registration/RegistryContext';
import { PrivateAccess } from '../components/PrivateAccess';
import { DocumentsPanel } from './Documents';
import { ApplicationDetails } from '../components/ApplicationDetails';
import { ApplicationStatus } from './Registration';

function ContractDetails() {
  return <dl className="detail-list">
    <div><dt>Network</dt><dd>Ethereum Sepolia · {SEPOLIA_CHAIN_ID}</dd></div>
    <div><dt>Contract</dt><dd><a className="mono tx-link" href={`${SEPOLIA_EXPLORER}/address/${RECEIVLEDGER_ADDRESS}`} target="_blank" rel="noreferrer">{RECEIVLEDGER_ADDRESS}</a></dd></div>
    <div><dt>Fund unit</dt><dd>RLU · 0 decimals</dd></div>
  </dl>;
}

export function MyProfile({ onApplication }: { onApplication?: () => void }) {
  const { account, role, snapshot } = useLedger();
  const { registeredName, application, authenticated, configured, signOut, busy, error } = useRegistry();
  const identity = walletIdentity(role);
  if (!account || !role) return <div className="empty-state">Connect your wallet on Sepolia to view its profile.</div>;
  return <section className="section-block account-page">
    <div className="profile-heading"><span className="avatar avatar-large" aria-hidden="true">{identity.initials}</span><div><h2>{identity.name}</h2><p className="support-copy">Your connected wallet</p></div></div>
    <dl className="detail-list">
      <div><dt>Wallet address</dt><dd className="mono selectable-address">{account}</dd></div>
      <div><dt>Current role</dt><dd>{identity.name}</dd></div>
      <div><dt>Registered name</dt><dd>{registeredName ?? 'No registration profile is connected yet.'}</dd></div>
      {application?.kind === 'sme' && <div><dt>UEN / company registration number</dt><dd>{application.company_number}</dd></div>}
      <div><dt>Private session</dt><dd>{authenticated ? 'Signed in with this wallet' : 'Not signed in'}</dd></div>
      {application && <div><dt>Application</dt><dd>{application.kind} · {application.status}{application.kind === 'sme' ? ' (off-chain)' : ''}</dd></div>}
      {snapshot && 'connectedBalance' in snapshot && <div><dt>RLU holdings</dt><dd>{formatInteger(snapshot.connectedBalance)} RLU</dd></div>}
    </dl>
    {configured && authenticated && <button className="btn o" disabled={busy} onClick={() => void signOut()}>Sign out of private profile</button>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {onApplication && role !== 'manager' && <button className="btn o" onClick={onApplication}>{application ? 'Review your application' : 'Register or restore account'}</button>}
    <PrivateAccess>{application && <details className="help-item"><summary>Application details</summary><ApplicationStatus application={application} /><ApplicationDetails application={application} /></details>}<DocumentsPanel /></PrivateAccess>
    <p className="footnote">Connecting a wallet does not verify a person's identity or a company. Registration and document decisions are private off-chain records; contract permissions remain separate.</p>
  </section>;
}

export function Settings({ rememberPage, onRememberPage }: { rememberPage: boolean; onRememberPage: (value: boolean) => boolean }) {
  const { account, walletAvailable, walletChecking, transactionPending, disconnect, connect } = useLedger();
  const { signOut } = useRegistry();
  const [message, setMessage] = useState('');
  return <div className="account-page">
    <section className="section-block"><h2>Browser preferences</h2>
      <label className="preference-toggle"><input type="checkbox" checked={rememberPage} onChange={event => {
        const value = event.target.checked;
        const saved = onRememberPage(value);
        setMessage(saved ? 'Preference saved on this browser.' : 'Browser storage is unavailable. This preference applies until the page is closed.');
      }} /><span><strong>Remember my page in this tab</strong><small>Reopening the same wallet keeps your page. Changing to a different wallet always opens Home.</small></span></label>
      {message && <p className="support-copy" role="status">{message}</p>}
    </section>
    <section className="section-block"><h2>Wallet connection</h2><p className="support-copy">Manage the connection to this browser tab. You can also remove this site in MetaMask's permissions.</p>
      <button className="btn o" disabled={!walletAvailable || walletChecking || transactionPending} onClick={() => { if (account) { void disconnect(); void signOut(); } else void connect(); }}>{account ? 'Disconnect wallet' : 'Connect wallet'}</button>
    </section>
    <section className="section-block"><h2>Blockchain configuration</h2><ContractDetails /><p className="footnote">This prototype uses the existing deployed contract. These values cannot be changed from Settings.</p></section>
  </div>;
}

export function Help() {
  return <div className="account-page">
    <section className="section-block"><h2>Help & Support</h2><p className="support-copy">Start with these checks. Never share a seed phrase or private key to troubleshoot a connection.</p>
      <details className="help-item" open><summary>Connect or change wallets</summary><p>Enable MetaMask, connect this site and select Sepolia. Use MetaMask to select the account you want. A different wallet opens Home and loads its own records.</p></details>
      <details className="help-item"><summary>My records are loading or look outdated</summary><p>Use Refresh blockchain above the current page. A first visit can take longer while historical events are indexed. Check the displayed RPC error, confirm Sepolia is selected, and retry. Wallet role and invoice records are read from the contract.</p></details>
      <details className="help-item"><summary>Why is my investor account inactive?</summary><p>The wallet is no longer approved to transfer RLU. Existing holdings and history remain visible. The contract has no automatic redemption or token burn when approval is revoked.</p></details>
      <details className="help-item"><summary>Check a transaction</summary><p>Open Transaction history or My history and follow its Sepolia Etherscan link. A cancelled wallet prompt is not a confirmed transaction. Never approve a prompt you did not initiate.</p></details>
      <details className="help-item"><summary>Invoice wallets and registration</summary><p>The invoice-wallet view comes from invoices stored for that wallet. Use Registration to sign in and apply, and Documents to upload fictional PDFs. The manager's SME and document verification decisions are off-chain and do not change contract permissions.</p></details>
      <details className="help-item"><summary>Registration and pending review</summary><p>Connect your wallet, choose Investor or SME, then sign in only if MetaMask shows no security warning. Complete the fictional registration form and submit a fictional verification PDF in Documents. Pending applicants can view their application and files; financial actions remain restricted. The review target of up to 3 working days is illustrative. If more information is requested or your application is rejected, read the manager note, update your details and resubmit. Suspended or revoked applications require manager review.</p></details>
      <details className="help-item"><summary>MetaMask displays a security warning</summary><p>Cancel the request and do not sign or bypass the warning. Report the existing warning through the official MetaMask Help Center. Connecting a wallet, signing in, off-chain registration review and sending a blockchain transaction are separate steps.</p></details>
      <details className="help-item"><summary>Understanding financial estimates</summary><p>Invoice face value is the full amount recorded on Sepolia. Proposed advances, fees, borrowing capacity, NAV and holding values are illustrative calculations. The current contract finances face value, does not collect these fees and does not pay SGD or support cash redemption. Repaid invoices remain historical records and do not count as outstanding principal.</p></details>
      <details className="help-item"><summary>Where can I get support?</summary><p>No project support contact has been configured. For wallet troubleshooting, use the official <a className="tx-link" href="https://support.metamask.io/" target="_blank" rel="noreferrer">MetaMask Help Center</a>. Describe the page, error and browser when reporting an issue to your project administrator; omit personal documents and credentials.</p></details>
    </section>
  </div>;
}

export function About() {
  return <div className="account-page"><section className="section-block"><span className="section-kicker">University prototype</span><h2>About ReceivLedger</h2>
    <p>ReceivLedger demonstrates a tokenised receivables financing fund, with role-specific tools for the fund manager, investors and invoice-submitting wallets.</p>
    <p>The manager approves investors and records invoice financing and repayments. Approved investors can hold and transfer RLU. Invoice wallets can follow their submitted invoices through the on-chain lifecycle.</p>
    <ContractDetails />
  </section><section className="section-block"><h2>What the prototype represents</h2><p>Blockchain balances, invoice records and confirmed transaction hashes come from Sepolia. Fund capital and repayments are simulated SGD accounting. No SGD/ETH subscriptions, financing payments, redemption, dividends or trading are implemented. RLU has no real monetary value.</p><p className="footnote">Blockchain records are public. Registration and document records use a separately configured private Supabase service. Fictional KYC and company verification are demonstration review workflows, not real identity checks or new Solidity permissions.</p></section></div>;
}
