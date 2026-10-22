import { userFacingError } from '../errors';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAddress } from 'ethers';
import { useLedger } from '../chain/LedgerContext';
import { discoverInvestorAddresses, ownershipDisplay, type InvestorAccount } from '../chain/chainLedger';
import { formatInteger } from '../chain/presentation';
import { WalletName } from '../components/WalletName';

interface ActionNotice {
  tone: 'success' | 'error' | 'neutral';
  message: string;
}

export function InvestorAdmin() {
  const { account, role, networkOk, snapshot, events, eventsLoading, eventsError, eventIndexComplete, ledger, transactionPending, runTransaction } = useLedger();
  const [manualAddresses, setManualAddresses] = useState<string[]>([]);
  const [addressInput, setAddressInput] = useState('');
  const [accounts, setAccounts] = useState<InvestorAccount[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [loadingAddresses, setLoadingAddresses] = useState<Set<string>>(new Set());
  const [lookupBusy, setLookupBusy] = useState(false);
  const [pageError, setPageError] = useState('');
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
  const [issueAmount, setIssueAmount] = useState('');
  const accountsRef = useRef<InvestorAccount[]>([]);
  const activeAccountRef = useRef(account);
  const requestVersions = useRef(new Map<string, number>());
  const pendingReads = useRef(new Map<string, Promise<InvestorAccount | null>>());
  activeAccountRef.current = account;

  const managerSnapshot = snapshot?.role === 'manager' ? snapshot : null;
  const addresses = useMemo(() => discoverInvestorAddresses(events, manualAddresses), [events, manualAddresses]);
  const selected = selectedAddress ? accounts.find(item => item.address.toLowerCase() === selectedAddress.toLowerCase()) : undefined;
  const holdingsComplete = eventIndexComplete && !eventsError;

  useEffect(() => {
    accountsRef.current = accounts;
  }, [accounts]);

  const fetchInvestor = useCallback(async (address: string, force = false): Promise<InvestorAccount | null> => {
    if (!ledger || !networkOk || role !== 'manager') return null;
    const key = address.toLowerCase();
    const cached = accountsRef.current.find(item => item.address.toLowerCase() === key);
    if (cached && !force) return cached;
    const currentRead = pendingReads.current.get(key);
    if (currentRead && !force) return currentRead;

    const requestVersion = (requestVersions.current.get(key) ?? 0) + 1;
    requestVersions.current.set(key, requestVersion);
    const requestAccount = account;
    setLoadingAddresses(previous => new Set(previous).add(key));
    setPageError('');
    const read = ledger.readInvestorAccounts([address]).then(rows => {
      const result = rows[0];
      if (!result || requestVersions.current.get(key) !== requestVersion || activeAccountRef.current?.toLowerCase() !== requestAccount?.toLowerCase()) return null;
      const next = new Map(accountsRef.current.map(item => [item.address.toLowerCase(), item]));
      next.set(key, result);
      const updated = [...next.values()].sort((left, right) => left.address.toLowerCase().localeCompare(right.address.toLowerCase()));
      accountsRef.current = updated;
      setAccounts(updated);
      return result;
    }).catch(cause => {
      if (requestVersions.current.get(key) === requestVersion && activeAccountRef.current?.toLowerCase() === requestAccount?.toLowerCase()) {
        setPageError(userFacingError(cause));
      }
      return null;
    }).finally(() => {
      if (pendingReads.current.get(key) === read) pendingReads.current.delete(key);
      if (requestVersions.current.get(key) === requestVersion && activeAccountRef.current?.toLowerCase() === requestAccount?.toLowerCase()) {
        setLoadingAddresses(previous => {
          const next = new Set(previous);
          next.delete(key);
          return next;
        });
      }
    });
    pendingReads.current.set(key, read);
    return read;
  }, [ledger, networkOk, role, account]);

  useEffect(() => {
    if (role !== 'manager' || !networkOk || !addresses.length) return;
    let cancelled = false;
    const missing = addresses.filter(address => !accountsRef.current.some(item => item.address.toLowerCase() === address.toLowerCase()));
    if (!missing.length) return;
    void (async () => {
      for (let index = 0; index < missing.length; index += 10) {
        if (cancelled) return;
        await Promise.all(missing.slice(index, index + 10).map(address => fetchInvestor(address)));
      }
    })();
    return () => { cancelled = true; };
  }, [addresses, role, networkOk, fetchInvestor]);

  const knownAddressSet = useMemo(() => new Set(addresses.map(address => address.toLowerCase())), [addresses]);
  const visibleAccounts = accounts.filter(item => knownAddressSet.has(item.address.toLowerCase()));

  async function lookUpAddress(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPageError('');
    setActionNotice(null);
    const candidate = addressInput.trim();
    if (!isAddress(candidate)) { setPageError('Enter a valid Ethereum wallet address.'); return; }
    if (candidate.toLowerCase() === '0x0000000000000000000000000000000000000000') { setPageError('The zero address is not an investor wallet.'); return; }
    setManualAddresses(previous => previous.some(item => item.toLowerCase() === candidate.toLowerCase()) ? previous : [...previous, candidate]);
    setSelectedAddress(candidate);
    setLookupBusy(true);
    try {
      const result = await fetchInvestor(candidate, true);
      if (!result) setPageError(previous => previous || 'Could not read this wallet from Sepolia. Retry the lookup.');
    } finally {
      setLookupBusy(false);
    }
  }

  async function refreshSelected(): Promise<InvestorAccount> {
    if (!selectedAddress || !ledger) throw new Error('Select an investor wallet first.');
    const result = await fetchInvestor(selectedAddress, true);
    if (!result) throw new Error('Could not refresh this wallet from Sepolia.');
    return result;
  }

  function cancellationNotice(message: string): ActionNotice {
    const cancelled = message.toLowerCase().includes('cancelled') || message.toLowerCase().includes('rejected');
    return { tone: cancelled ? 'neutral' : 'error', message };
  }

  async function approveInvestor() {
    setActionNotice(null);
    try {
      if (role !== 'manager' || !selected) throw new Error('Only the Fund Manager can approve an investor.');
      const current = await refreshSelected();
      if (current.approved) throw new Error('This wallet is already approved.');
      if (!window.confirm(`Approve ${current.address} as an investor? This changes approval status only and does not collect SGD or SepoliaETH.`)) {
        setActionNotice({ tone: 'neutral', message: 'Approval cancelled. No transaction was sent.' }); return;
      }
      setActionNotice({ tone: 'neutral', message: 'Confirm investor approval in MetaMask…' });
      await runTransaction('manager', activeLedger => activeLedger.approveInvestor(current.address));
      const refreshed = await fetchInvestor(current.address, true);
      setActionNotice(refreshed?.approved
        ? { tone: 'success', message: 'Investor approval confirmed and status refreshed from Sepolia.' }
        : { tone: 'error', message: 'Transaction confirmed, but the approval status refresh failed. Use Refresh wallet to retry.' });
    } catch (cause) { setActionNotice(cancellationNotice(userFacingError(cause))); }
  }

  async function revokeInvestor() {
    setActionNotice(null);
    try {
      if (role !== 'manager' || !selected) throw new Error('Only the Fund Manager can revoke approval.');
      const current = await refreshSelected();
      if (!current.approved) throw new Error('This wallet is not currently approved.');
      const retained = current.balance > 0n ? ` This wallet will retain its ${formatInteger(current.balance)} RLU.` : '';
      if (!window.confirm(`Revoke approval for ${current.address}?${retained} Revocation does not destroy previously issued fund units.`)) {
        setActionNotice({ tone: 'neutral', message: 'Revocation cancelled. No transaction was sent.' }); return;
      }
      setActionNotice({ tone: 'neutral', message: 'Confirm investor revocation in MetaMask…' });
      await runTransaction('manager', activeLedger => activeLedger.revokeInvestor(current.address));
      const refreshed = await fetchInvestor(current.address, true);
      setActionNotice(refreshed && !refreshed.approved
        ? { tone: 'success', message: 'Investor revocation confirmed. Current token holdings are unchanged.' }
        : { tone: 'error', message: 'Transaction confirmed, but the approval refresh failed. Use Refresh wallet to retry.' });
    } catch (cause) { setActionNotice(cancellationNotice(userFacingError(cause))); }
  }

  async function issueFundUnits() {
    setActionNotice(null);
    try {
      if (role !== 'manager' || !selected || !ledger) throw new Error('Only the Fund Manager can issue fund units.');
      if (!/^[1-9]\d*$/.test(issueAmount)) throw new Error('Enter a positive whole number of RLU.');
      const current = await refreshSelected();
      if (!current.approved) throw new Error('Approve this investor before issuing RLU.');
      const amount = BigInt(issueAmount);
      const [totalFundSize, maxFundSize] = await Promise.all([ledger.totalFundSize(), ledger.getMaxFundSize()]);
      if (totalFundSize + amount > maxFundSize) throw new Error(`Issuance exceeds the contract's remaining cap of ${formatInteger(maxFundSize - totalFundSize)} RLU.`);
      if (!window.confirm(`Issue ${formatInteger(amount)} RLU to ${current.address}? RLU are fund units; this does not collect SGD or SepoliaETH.`)) {
        setActionNotice({ tone: 'neutral', message: 'Issuance cancelled. No transaction was sent.' }); return;
      }
      setActionNotice({ tone: 'neutral', message: 'Confirm RLU issuance in MetaMask…' });
      await runTransaction('manager', activeLedger => activeLedger.issueFundUnits(current.address, amount));
      setIssueAmount('');
      const refreshed = await fetchInvestor(current.address, true);
      setActionNotice(refreshed
        ? { tone: 'success', message: `${formatInteger(amount)} RLU issuance confirmed; current balance refreshed from Sepolia.` }
        : { tone: 'error', message: 'Issuance confirmed, but the balance refresh failed. Use Refresh wallet to retry.' });
    } catch (cause) { setActionNotice(cancellationNotice(userFacingError(cause))); }
  }

  if (!networkOk) return <div className="empty-state">Switch to Sepolia to load investor ownership data.</div>;
  if (role !== 'manager') return <div className="notice error" role="alert">Investor administration is available only to the Fund Manager.</div>;
  if (!managerSnapshot) return <div className="empty-state">Loading fund manager investor data…</div>;

  const indexMessage = eventsError
    ? `History indexing failed: ${eventsError}. Known wallets are partial and ownership percentages are hidden.`
    : eventIndexComplete
      ? 'Contract events are indexed through the current chain head. Wallet discovery is based on historical approval, issuance and transfer events; the contract has no enumerable investor registry.'
      : eventsLoading
        ? 'Indexing contract history in the background. Discovered wallets are partial until indexing reaches the current chain head.'
        : 'Historical event indexing is incomplete. Discovered wallets and balances are partial; ownership percentages are hidden.';

  return <>
    <section className="metric-grid investor-metrics">
      <div className="metric emphasis"><span>Total RLU supply</span><strong>{formatInteger(managerSnapshot.totalSupply)} RLU</strong><small>On-chain ERC-20 totalSupply · 0 decimals</small></div>
      <div className="metric"><span>Discovered wallets</span><strong>{visibleAccounts.length}</strong><small>Known wallets, not an enumerable registry</small></div>
      <div className="metric"><span>Index status</span><strong>{eventIndexComplete ? 'Indexed' : eventsLoading ? 'Indexing' : 'Partial'}</strong><small>Approval, issuance and Transfer event history</small></div>
    </section>
    <section className="section-block">
      <div className="section-heading"><div><span className="eyebrow">RLU fund units</span><h2>Investor ownership</h2></div>
        <form className="investor-lookup-form" onSubmit={event => void lookUpAddress(event)}>
          <label className="sr-only" htmlFor="investor-wallet-address">Investor wallet address</label>
          <input id="investor-wallet-address" value={addressInput} onChange={event => setAddressInput(event.target.value)} placeholder="Look up any wallet · 0x…" />
          <button className="btn" type="submit" disabled={lookupBusy}>{lookupBusy ? 'Looking up…' : 'Look up wallet'}</button>
        </form>
      </div>
      <p className="support-copy">{indexMessage} RLU is a 0-decimal fund-unit token. Issuance does not collect SGD or SepoliaETH.</p>
      {pageError && <div className="notice error" role="alert">{pageError}</div>}
      {actionNotice && <div className={`notice ${actionNotice.tone === 'success' ? 'info' : actionNotice.tone === 'error' ? 'error' : 'pending'}`} role="status">{actionNotice.message}</div>}
      {eventsLoading && <p className="sub" role="status">Updating cached investor discovery… Current rows remain visible.</p>}
      {visibleAccounts.length ? <div className="table-scroll"><table className="investor-table"><thead><tr><th>Investor wallet</th><th>Approval</th><th>RLU balance</th><th>Supply ownership</th><th>Action</th></tr></thead>
        <tbody>{visibleAccounts.map(item => <tr key={item.address} className="investor-row" tabIndex={0} onClick={() => setSelectedAddress(item.address)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedAddress(item.address); } }}>
          <td><button className="investor-address" onClick={event => { event.stopPropagation(); setSelectedAddress(item.address); }}><WalletName address={item.address} full /></button></td>
          <td><span className={`status ${item.approved ? 'approved' : 'rejected'}`}>{item.approved ? 'Approved' : 'Revoked / not approved'}</span></td>
          <td>{formatInteger(item.balance)} RLU</td>
          <td>{ownershipDisplay(item.balance, managerSnapshot.totalSupply, holdingsComplete) ?? 'Partial index'}</td>
          <td><button className="btn small outline" onClick={event => { event.stopPropagation(); setSelectedAddress(item.address); }}>Details</button></td>
        </tr>)}</tbody>
      </table></div> : <div className="empty-state compact">{eventsLoading ? 'Loading cached wallet history…' : 'No investor wallets have been discovered yet. Enter an address above to look it up.'}</div>}
      {visibleAccounts.some(item => loadingAddresses.has(item.address.toLowerCase())) && <p className="sub" role="status">Refreshing current approval and RLU balances…</p>}
      {pageError && <p className="inline-error" role="alert">{pageError}</p>}
    </section>
    {selectedAddress && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedAddress(null); }}>
      <InvestorDetails
        address={selectedAddress}
        investor={selected}
        loading={loadingAddresses.has(selectedAddress.toLowerCase())}
        complete={holdingsComplete}
        totalSupply={managerSnapshot.totalSupply}
        issueAmount={issueAmount}
        setIssueAmount={setIssueAmount}
        transactionPending={transactionPending}
        onClose={() => setSelectedAddress(null)}
        onRefresh={() => void fetchInvestor(selectedAddress, true)}
        onApprove={() => void approveInvestor()}
        onRevoke={() => void revokeInvestor()}
        onIssue={() => void issueFundUnits()}
      />
    </div>}
  </>;
}

function InvestorDetails({ address, investor, loading, complete, totalSupply, issueAmount, setIssueAmount, transactionPending, onClose, onRefresh, onApprove, onRevoke, onIssue }: {
  address: string;
  investor?: InvestorAccount;
  loading: boolean;
  complete: boolean;
  totalSupply: bigint;
  issueAmount: string;
  setIssueAmount: (value: string) => void;
  transactionPending: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onApprove: () => void;
  onRevoke: () => void;
  onIssue: () => void;
}) {
  return <section className="invoice-modal investor-details" role="dialog" aria-modal="true" aria-labelledby="investor-details-title">
    <div className="section-heading"><div><span className="eyebrow">Current contract state</span><h2 id="investor-details-title">Investor details</h2></div><button className="btn outline" onClick={onClose}>Close</button></div>
    <dl className="detail-list">
      <div><dt>Wallet address</dt><dd className="mono">{address}</dd></div>
      <div><dt>Approval status</dt><dd>{investor ? <span className={`status ${investor.approved ? 'approved' : 'rejected'}`}>{investor.approved ? 'Approved' : 'Not approved'}</span> : loading ? 'Loading…' : 'Not loaded'}</dd></div>
      <div><dt>RLU holdings</dt><dd>{investor ? `${formatInteger(investor.balance)} RLU` : loading ? 'Loading…' : 'Not loaded'}</dd></div>
      <div><dt>Percentage of RLU supply</dt><dd>{investor ? ownershipDisplay(investor.balance, totalSupply, complete) ?? 'Partial index' : '—'}</dd></div>
      <div><dt>Total RLU supply</dt><dd>{formatInteger(totalSupply)} RLU · 0 decimals</dd></div>
    </dl>
    {investor && <div className="investor-detail-actions">
      <button className="btn outline" onClick={onRefresh} disabled={loading}>Refresh wallet</button>
          {investor.approved
        ? <button className="btn danger" onClick={onRevoke} disabled={transactionPending || loading}>Revoke approval</button>
        : <button className="btn" onClick={onApprove} disabled={transactionPending || loading}>Approve investor</button>}
      {investor.approved && <div className="issue-inline"><label>Issue RLU<input type="number" min="1" step="1" value={issueAmount} onChange={event => setIssueAmount(event.target.value)} /></label><button className="btn" onClick={onIssue} disabled={transactionPending || loading}>Issue fund units</button></div>}
    </div>}
    {loading && <p className="sub" role="status">Reading current status and holdings from Sepolia…</p>}
    <p className="footnote">Approval and ownership are separate: revoking approval does not remove previously issued RLU. RLU issuance updates simulated accounting only; it does not collect SGD or SepoliaETH.</p>
  </section>;
}
