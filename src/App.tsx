import { useEffect, useState } from 'react';
import { LedgerProvider, useLedger } from './chain/LedgerContext';
import { canAccessPage, navigationForRole, SUPPORT_PAGES, type PageId } from './chain/access';
import { NAVIGATION_KEY, REMEMBER_PAGE_KEY, readNavigation, resolveWalletNavigation, walletIdentity, type NavigationState } from './chain/navigation';
import { Dashboard } from './pages/Dashboard';
import { History } from './pages/History';
import { Investors } from './pages/Investors';
import { Invoices } from './pages/Invoices';
import { About, Help, MyProfile, Settings } from './pages/Account';
import { ProfileMenu } from './components/ProfileMenu';
import { BlockchainRefresh } from './components/BlockchainRefresh';
import { RegistryProvider, useRegistry } from './registration/RegistryContext';
import { AccountChoice, ApplicationDashboard, PrivateAccess, Registration, RegistrationSummary, Welcome } from './pages/Registration';
import { Applications } from './pages/Applications';
import { Documents } from './pages/Documents';
import { FinanceProvider } from './finance/FinanceContext';
import { Reports } from './pages/Reports';
import { Assets } from './pages/Assets';
import { FundOverview, UnifiedWorkspace } from './v2/UnifiedWorkspace';
import './v2/v2.css';

function initialRememberPage() {
  try { return window.localStorage.getItem(REMEMBER_PAGE_KEY) !== 'false'; } catch { return true; }
}
function initialNavigation(): NavigationState {
  try { return initialRememberPage() ? readNavigation(window.sessionStorage) : { account: null, page: 'dashboard' }; }
  catch { return { account: null, page: 'dashboard' }; }
}

export function LedgerApp() {
  const [navigationState, setNavigationState] = useState(initialNavigation);
  const [rememberPage, setRememberPage] = useState(initialRememberPage);
  const [selection, setSelection] = useState<{ wallet: string; kind: 'investor' | 'sme' } | null>(null);
  const [submittedWallet, setSubmittedWallet] = useState<string | null>(null);
  const { account, role, networkOk, walletAvailable, walletChecking, eventIndexComplete, connect, loading, transactionPending, error, eventsError, connectionNotice, walletEpoch = 0 } = useLedger();
  const { registeredName, application, requiresRegistrationSession, authenticated } = useRegistry();
  const registrationKind = selection?.wallet === account?.toLowerCase() ? selection?.kind : undefined;
  // An application selects an interface, never a chain permission or role.
  const viewRole = role === 'provisional' && application ? application.kind === 'investor' ? 'investor' : 'sme' : role;
  const navigation = navigationForRole(viewRole);
  const resolved = resolveWalletNavigation(navigationState, account, viewRole);
  const page = resolved.page;
  const pageAllowed = canAccessPage(viewRole, page);
  const activeTitle = [...navigation, ...SUPPORT_PAGES, { id: 'profile', title: 'My Profile' }, { id: 'registration', title: 'Your Application' }, { id: 'documents', title: 'Private Documents' }].find(item => item.id === page)?.title ?? 'Home';

  useEffect(() => {
    setSubmittedWallet(null);
  }, [account]);

  useEffect(() => {
    setNavigationState(previous => {
      const next = resolveWalletNavigation(previous, account, viewRole);
      return previous.account === next.account && previous.page === next.page ? previous : next;
    });
  }, [account, viewRole]);

  useEffect(() => {
    if (!account || !role) return;
    try {
      if (rememberPage) window.sessionStorage.setItem(NAVIGATION_KEY, JSON.stringify(resolved));
      else window.sessionStorage.removeItem(NAVIGATION_KEY);
    } catch { /* Navigation storage is optional. */ }
  }, [account, role, page, rememberPage]);

  function navigate(next: PageId) { setNavigationState({ account, page: next }); }
  function updateRememberPage(value: boolean) {
    setRememberPage(value);
    try {
      window.localStorage.setItem(REMEMBER_PAGE_KEY, String(value));
      if (!value) window.sessionStorage.removeItem(NAVIGATION_KEY);
      return true;
    } catch { return false; }
  }

  function chooseAccount(kind: 'investor' | 'sme') { if (account) setSelection({ wallet: account.toLowerCase(), kind }); navigate('registration'); }
  const choice = <AccountChoice onChoose={chooseAccount} />;
  const existingApplication = application ? <ApplicationDashboard onNavigate={navigate} /> : requiresRegistrationSession && !authenticated ? <PrivateAccess>{choice}</PrivateAccess> : choice;

  if (!account) return <main className="public-entry"><div className="public-brand">ReceivLedger</div>
    {navigationState.account === null && page === 'help' ? <Help /> : navigationState.account === null && page === 'about' ? <About /> : <Welcome />}
    {error && <p className="notice error" role="alert">{error}</p>}{connectionNotice && <p className="notice info" role="status">{connectionNotice}</p>}
    <footer className="public-footer"><button className="text-button" onClick={() => navigate('dashboard')}>Welcome</button><button className="text-button" onClick={() => navigate('help')}>Help & Support</button><button className="text-button" onClick={() => navigate('about')}>About ReceivLedger</button></footer>
  </main>;

  let content = <div className="empty-state">{loading || walletChecking ? 'Checking the connected wallet role…' : 'Wallet records are unavailable. Check the connection and refresh.'}</div>;
  if (pageAllowed) {
    if (page === 'settings') content = <Settings rememberPage={rememberPage} onRememberPage={updateRememberPage} />;
    else if (page === 'help') content = <Help />;
    else if (page === 'about') content = <About />;
    else if (page === 'registration') content = registrationKind || application ? <Registration initialKind={application?.kind ?? registrationKind} onSubmitted={() => { setSubmittedWallet(account.toLowerCase()); navigate('dashboard'); }} /> : choice;
    else if (role) {
      if (page === 'profile') content = <MyProfile onApplication={() => navigate('registration')} />;
      else if (page === 'dashboard') content = (role !== 'manager' && application && application.status !== 'approved') || role === 'provisional'
        ? existingApplication
        : <><RegistrationSummary onNavigate={navigate} /><Dashboard /></>;
      else if (page === 'applications') content = <Applications />;
      else if (page === 'documents') content = <Documents />;
      else if (page === 'fund') content = <UnifiedWorkspace />;
      else if (page === 'reports') content = <Reports />;
      else if (page === 'invoices') content = <Invoices mode="list" />;
      else if (page === 'submitInvoice') content = <Invoices mode="submit" />;
      else if (page === 'assets' || page === 'transfer') content = <Assets />;
      else if (page === 'investors') content = <Investors />;
      else if (page === 'history') content = <History />;
    }
  }
  const blockchainPage = ['dashboard', 'assets', 'submitInvoice', 'invoices', 'investors', 'transfer', 'history', 'profile', 'reports'].includes(page);
  const identity = walletIdentity(role);

  return <div className="app">
    <aside className="side">
      <div className="logo"><i>R</i><span>ReceivLedger</span></div>
      <nav className="primary-navigation" aria-label="Main navigation">{navigation.map(item => <button key={item.id} className={`nav${page === item.id ? ' on' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>
        <span aria-hidden="true">{item.icon}</span>{item.title}
      </button>)}</nav>
      <div className="side-footer"><nav className="support-navigation" aria-label="Support navigation">{SUPPORT_PAGES.map(item => <button key={item.id} className={`nav${page === item.id ? ' on' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><span aria-hidden="true">{item.icon}</span>{item.title}</button>)}</nav>
      <div className="side-note">Ethereum Sepolia · University prototype</div>
      </div>
    </aside>
    <main className="main">
      <header className="top">
        <div><span className="section-kicker">Your fund workspace</span><h1>{activeTitle}</h1><span className="sub">{account ? role ? `${registeredName ? `${registeredName} · ` : ''}${application && role === 'provisional' ? `${application.kind === 'sme' ? 'SME' : 'Investor'} application · ${application.status}` : identity.name}` : 'Resolving wallet access…' : 'Connect your wallet to get started'}</span></div>
        <div className="wallet-controls">
          <span className={`network-pill ${networkOk ? 'connected' : 'disconnected'}`}>{walletChecking ? 'Checking wallet…' : !walletAvailable ? 'Wallet unavailable' : !account ? 'Not connected' : networkOk ? 'Sepolia' : 'Wrong network'}</span>
          {account ? <ProfileMenu key={account.toLowerCase()} onNavigate={navigate} /> : <button className="btn" onClick={() => void connect()} disabled={!walletAvailable || walletChecking || transactionPending}>{walletChecking ? 'Checking wallet…' : 'Connect MetaMask'}</button>}
        </div>
      </header>
      <p className="prototype-disclosure">University prototype on Sepolia. RLU has no real monetary value; SGD accounting is simulated, with no real payments or redemption. Blockchain records are public.</p>
      {['assets','invoices','submitInvoice','reports','history'].includes(page)&&<p className="support-copy">V1 records · RLU (0 decimals). V2 fund operations use separate records and RLU2 (2 decimals).</p>}
      {submittedWallet === account.toLowerCase() && <p className="notice info" role="status">Application submitted for review. No on-chain approval was granted.<button className="text-button" onClick={() => setSubmittedWallet(null)}>Dismiss</button></p>}
      {!walletAvailable && <div className="notice info">Enable MetaMask in your browser to connect. Help & Support is available without a wallet.</div>}
      {account && walletAvailable && !networkOk && <div className="notice warning">Select Sepolia in MetaMask (chain ID 11155111) to load your blockchain records.</div>}
      {role === 'inactiveInvestor' && <div className="notice warning"><b>Investor wallet is not currently approved.</b> Any RLU holdings remain in this wallet; transfers are unavailable.</div>}
      {role === 'provisional' && !eventIndexComplete && !eventsError && <div className="notice pending" role="status">Historical role evidence is still indexing. This wallet may be reclassified when the scan completes.</div>}
      {connectionNotice && <div className="notice info" role="status">{connectionNotice}</div>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {eventsError && page !== 'history' && <div className="notice error" role="alert">Blockchain history could not be loaded: {eventsError}</div>}
      {transactionPending && <div className="notice pending" role="status">Waiting for MetaMask transaction confirmation. Keep this tab open.</div>}
      {blockchainPage && role && <BlockchainRefresh key={`refresh:${account}`} />}
      <div key={`content:${account?.toLowerCase() ?? 'disconnected'}:${walletEpoch}`}>{content}{page === 'dashboard' && <FundOverview onOpen={() => navigate('fund')} />}</div>
    </main>
  </div>;
}

export default function App() {
  return <LedgerProvider><FinanceProvider><RegistryProvider><LedgerApp /></RegistryProvider></FinanceProvider></LedgerProvider>;
}
