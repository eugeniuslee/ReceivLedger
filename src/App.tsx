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
import { Registration, RegistrationSummary, Welcome } from './pages/Registration';
import { Applications } from './pages/Applications';
import { Documents } from './pages/Documents';
import { FinanceProvider } from './finance/FinanceContext';
import { Reports } from './pages/Reports';

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
  const [registrationKind, setRegistrationKind] = useState<'investor' | 'sme'>('investor');
  const { account, role, networkOk, walletAvailable, walletChecking, eventIndexComplete, connect, loading, transactionPending, error, eventsError, connectionNotice } = useLedger();
  const { registeredName, application } = useRegistry();
  const navigation = navigationForRole(role);
  const resolved = resolveWalletNavigation(navigationState, account, role);
  const page = resolved.page;
  const pageAllowed = canAccessPage(role, page);
  const activeTitle = [...navigation, ...SUPPORT_PAGES, { id: 'profile', title: 'My Profile' }].find(item => item.id === page)?.title ?? 'Home';

  useEffect(() => {
    setNavigationState(previous => {
      const next = resolveWalletNavigation(previous, account, role);
      return previous.account === next.account && previous.page === next.page ? previous : next;
    });
  }, [account, role]);

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

  let content = loading || walletChecking ? <div className="empty-state">Checking the connected wallet role…</div> : <Welcome onApply={kind => { setRegistrationKind(kind); navigate('registration'); }} />;
  if (pageAllowed) {
    if (page === 'settings') content = <Settings rememberPage={rememberPage} onRememberPage={updateRememberPage} />;
    else if (page === 'help') content = <Help />;
    else if (page === 'about') content = <About />;
    else if (page === 'registration') content = <Registration initialKind={registrationKind} />;
    else if (role) {
      if (page === 'profile') content = <MyProfile />;
      else if (page === 'dashboard') content = <><RegistrationSummary onNavigate={navigate} /><Dashboard /></>;
      else if (page === 'applications') content = <Applications />;
      else if (page === 'documents') content = <Documents />;
      else if (page === 'reports') content = <Reports />;
      else if (page === 'invoices') content = <Invoices />;
      else if (page === 'investors') content = <Investors />;
      else if (page === 'transfer') content = <Investors investorTransferOnly />;
      else if (page === 'history') content = <History />;
    }
  }
  const blockchainPage = ['dashboard', 'invoices', 'investors', 'transfer', 'history', 'profile', 'reports'].includes(page);
  const identity = walletIdentity(role);

  return <div className="app">
    <aside className="side">
      <div className="logo"><i>R</i><span>ReceivLedger</span></div>
      <nav aria-label="Main navigation">{navigation.map(item => <button key={item.id} className={`nav${page === item.id ? ' on' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>
        <span aria-hidden="true">{item.icon}</span>{item.title}
      </button>)}</nav>
      <nav className="support-navigation" aria-label="Support navigation">{SUPPORT_PAGES.map(item => <button key={item.id} className={`nav${page === item.id ? ' on' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><span aria-hidden="true">{item.icon}</span>{item.title}</button>)}</nav>
      <div className="side-note">Ethereum Sepolia · University prototype</div>
    </aside>
    <main className="main">
      <header className="top">
        <div><span className="section-kicker">Your fund workspace</span><h1>{activeTitle}</h1><span className="sub">{account ? role ? `${registeredName ? `${registeredName} · ` : ''}${application?.kind === 'sme' && application.status === 'approved' && role === 'provisional' ? 'Verified SME (off-chain)' : identity.name}` : 'Resolving wallet access…' : 'Connect your wallet to get started'}</span></div>
        <div className="wallet-controls">
          <span className={`network-pill ${networkOk ? 'connected' : 'disconnected'}`}>{walletChecking ? 'Checking wallet…' : !walletAvailable ? 'Wallet unavailable' : !account ? 'Not connected' : networkOk ? 'Sepolia' : 'Wrong network'}</span>
          {account ? <ProfileMenu key={account.toLowerCase()} onNavigate={navigate} /> : <button className="btn" onClick={() => void connect()} disabled={!walletAvailable || walletChecking || transactionPending}>{walletChecking ? 'Checking wallet…' : 'Connect MetaMask'}</button>}
        </div>
      </header>
      <p className="prototype-disclosure">University prototype on Sepolia. RLU has no real monetary value; SGD accounting is simulated, with no real payments or redemption. Blockchain records are public.</p>
      {!walletAvailable && <div className="notice info">Enable MetaMask in your browser to connect. Help & Support is available without a wallet.</div>}
      {account && walletAvailable && !networkOk && <div className="notice warning">Select Sepolia in MetaMask (chain ID 11155111) to load your blockchain records.</div>}
      {role === 'inactiveInvestor' && <div className="notice warning"><b>Investor approval revoked.</b> Your RLU remains in this wallet; transfers are unavailable.</div>}
      {role === 'provisional' && !eventIndexComplete && !eventsError && <div className="notice pending" role="status">Historical role evidence is still indexing. This wallet may be reclassified when the scan completes.</div>}
      {connectionNotice && <div className="notice info" role="status">{connectionNotice}</div>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {eventsError && page !== 'history' && <div className="notice error" role="alert">Blockchain history could not be loaded: {eventsError}</div>}
      {transactionPending && <div className="notice pending" role="status">Waiting for MetaMask transaction confirmation. Keep this tab open.</div>}
      {blockchainPage && role && <BlockchainRefresh key={`refresh:${account}`} />}
      <div key={`content:${account?.toLowerCase() ?? 'disconnected'}`}>{content}</div>
    </main>
  </div>;
}

export default function App() {
  return <LedgerProvider><FinanceProvider><RegistryProvider><LedgerApp /></RegistryProvider></FinanceProvider></LedgerProvider>;
}
