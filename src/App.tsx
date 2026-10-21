import { useEffect, useState } from 'react';
import { LedgerProvider, useLedger } from './chain/LedgerContext';
import { canAccessPage, ROLE_PAGES, type PageId } from './chain/access';
import { Dashboard } from './pages/Dashboard';
import { History } from './pages/History';
import { Investors } from './pages/Investors';
import { Invoices } from './pages/Invoices';

function LedgerApp() {
  const [page, setPage] = useState<PageId>('dashboard');
  const { account, role, networkOk, walletAvailable, walletChecking, eventIndexComplete, eventsLoading, connect, loading, transactionPending, error, eventsError, refresh } = useLedger();
  const navigation = role ? ROLE_PAGES[role] : [];
  const pageAllowed = canAccessPage(role, page);
  const activePage = pageAllowed ? page : 'dashboard';
  const activeTitle = navigation.find(item => item.id === activePage)?.title ?? 'Dashboard';

  useEffect(() => {
    if (role && !navigation.some(item => item.id === page)) setPage('dashboard');
  }, [role, page, navigation]);

  let content = <div className="empty-state">{loading || walletChecking ? 'Checking the connected wallet role…' : 'Connect a wallet on Sepolia to open your role-specific view.'}</div>;
  if (role && pageAllowed) {
    if (activePage === 'dashboard') content = <Dashboard />;
    else if (activePage === 'invoices' && (role === 'manager' || role === 'sme' || role === 'provisional')) content = <Invoices />;
    else if (activePage === 'investors' && role === 'manager') content = <Investors />;
    else if (activePage === 'transfer' && role === 'investor') content = <Investors investorTransferOnly />;
    else if (activePage === 'history') content = <History />;
    else content = <div className="notice error" role="alert">This view is not available for the current wallet role.</div>;
  }

  return <div className="app">
    <aside className="side">
      <div className="logo"><i>R</i><span>ReceivLedger</span></div>
      <nav aria-label="Main navigation">{navigation.map(item => <button key={item.id} className={`nav${activePage === item.id ? ' on' : ''}`} onClick={() => setPage(item.id)}>
        <span aria-hidden="true">{item.icon}</span>{item.title}
      </button>)}</nav>
      <div className="side-note">Sepolia · RLU has 0 decimals</div>
    </aside>
    <main className="main">
      <header className="top">
        <div><h1>{activeTitle}</h1><span className="sub">{role === 'manager' ? 'Fund manager · S$ values are simulated accounting' : role === 'investor' ? 'Approved investor · personal wallet view' : role === 'inactiveInvestor' ? 'Inactive investor · personal holdings and history' : role === 'sme' ? 'Invoice wallet · verified by stored invoice records' : role === 'provisional' ? 'Unregistered wallet · no verified contract role' : 'ReceivLedger · Sepolia'}</span></div>
        <div className="wallet-controls">
          <span className={`network-pill ${networkOk ? 'connected' : 'disconnected'}`}>{walletChecking ? 'Checking wallet…' : !walletAvailable ? 'Wallet unavailable' : networkOk ? 'Sepolia' : 'Wrong network'}</span>
          <button className="btn" onClick={() => void connect()} disabled={!walletAvailable || walletChecking || transactionPending}>
            {walletChecking ? 'Checking wallet…' : !walletAvailable ? 'MetaMask unavailable' : account ? `${account.slice(0, 6)}…${account.slice(-4)}` : 'Connect wallet'}
          </button>
          {account && <button className="btn o" title="Refresh wallet-specific on-chain data" onClick={() => void refresh()} disabled={loading || transactionPending}>Refresh</button>}
        </div>
      </header>
      <p className="prototype-disclosure">University prototype · Ethereum Sepolia. RLU has no real monetary value; fund capital and repayment are simulated, with no SGD/ETH payments, redemption, dividends or settlement. Blockchain activity remains public; role-scoped views are not private.</p>
      {!walletAvailable && <div className="notice error">MetaMask was not detected. Install or enable the browser wallet to read Sepolia data.</div>}
      {walletAvailable && !networkOk && <div className="notice warning">Switch MetaMask to Sepolia (chain ID 11155111). No other network is queried or written to.</div>}
      {role === 'inactiveInvestor' && <div className="notice warning"><b>Investor approval revoked.</b> RLU remains in the wallet; the contract does not automatically redeem or burn units.</div>}
      {role === 'provisional' && !eventIndexComplete && !eventsError && <div className="notice pending" role="status">Historical role evidence is still indexing. This wallet may be reclassified when the scan completes.</div>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {eventsError && role !== 'manager' && <div className="notice error" role="alert">Personal history could not be loaded: {eventsError}</div>}
      {transactionPending && <div className="notice pending" role="status">Waiting for MetaMask transaction confirmation. Keep this tab open.</div>}
      {content}
    </main>
  </div>;
}

export default function App() {
  return <LedgerProvider><LedgerApp /></LedgerProvider>;
}