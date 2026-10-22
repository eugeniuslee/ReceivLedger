import { useState } from 'react';
import { useLedger } from '../chain/LedgerContext';

export function BlockchainRefresh() {
  const { account, networkOk, role, refresh, refreshEvents, loading, eventsLoading, transactionPending, error, eventsError } = useLedger();
  const [requested, setRequested] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = requested || loading || eventsLoading;
  async function reload() {
    setRequested(true);
    setFailed(false); setCompleted(false);
    try { await refresh(true); await refreshEvents(true); setCompleted(true); }
    catch { setFailed(true); }
    finally { setRequested(false); }
  }
  return <div className="blockchain-refresh">
    <span className="refresh-description">Live blockchain records</span>
    <button className="btn o small" disabled={!account || !networkOk || !role || busy || transactionPending} onClick={() => void reload()}>
      <span aria-hidden="true">↻ </span>{busy ? 'Refreshing…' : 'Refresh blockchain'}
    </button>
    <span role="status" aria-live="polite">{busy ? 'Reading Sepolia…' : error || eventsError || failed ? 'Some data could not be refreshed. See the error message.' : completed ? 'Blockchain refresh completed.' : 'Balances, invoices and event history'}</span>
  </div>;
}
