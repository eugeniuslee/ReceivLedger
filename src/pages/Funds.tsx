import { useEffect, useMemo, useState } from 'react';
import { isAddress } from 'ethers';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { useFinance } from '../finance/FinanceContext';
import { discoverInvestorAddresses } from '../chain/chainLedger';
import { SEPOLIA_EXPLORER } from '../chain/abi';
import { compactAddress, formatInteger, formatMoney } from '../chain/presentation';
import { financialDate } from '../finance/presentation';
import { money } from '../finance/models';
import { userFacingError } from '../errors';
import { ledgerFigures } from '../v2/ManagerOperations';
import { PrivateAccess } from '../components/PrivateAccess';
import { isOpen, requestAmount, STATUS_LABELS, useFundRequests, type FundRequest } from '../registration/fundRequests';
import { unitValueCents } from '../finance/useFundNav';

/** The invoice ledger issues RLU at a fixed S$1.00 per unit (issueFundUnits adds the same amount to fund capital). */
const ISSUE_PRICE_CENTS = 100n;

/** Manager's Funds tab: RLU subscriptions (issuance) and redemption checks. */
export function Funds() {
  const { role, networkOk } = useLedger();
  if (role !== 'manager') return <div className="notice error" role="alert">Fund administration is available only to the fund manager.</div>;
  if (!networkOk) return <div className="empty-state">Switch to Sepolia to manage RLU subscriptions and redemptions.</div>;
  return <>
    <FundUnitSummary />
    <section className="dashboard-grid">
      <ProcessSubscription />
      <RedemptionCheck />
    </section>
    <PrivateAccess compact message="Verify your fund manager wallet to see investor subscription and redemption requests."><FundRequestsManager /></PrivateAccess>
    <RecentIssuances />
  </>;
}

function useFundFigures() {
  const { events, lifecycleEvents, ledger } = useLedger();
  const { data, now } = useFinance();
  const figures = data ? ledgerFigures(data, lifecycleEvents?.length ? lifecycleEvents : events ?? [], now) : null;
  const [maxFundSize, setMaxFundSize] = useState<bigint | null>(null);
  useEffect(() => {
    if (!ledger) return;
    let active = true;
    ledger.getMaxFundSize().then(value => { if (active) setMaxFundSize(value); }).catch(() => { if (active) setMaxFundSize(null); });
    return () => { active = false; };
  }, [ledger]);
  return { data, figures, maxFundSize };
}

function FundUnitSummary() {
  const { data, figures, maxFundSize } = useFundFigures();
  const remaining = data && maxFundSize !== null ? maxFundSize - data.totalFundSize : null;
  return <section className="metric-grid" aria-label="Fund unit summary">
    <div className="metric emphasis"><span>RLU in issue</span><strong>{data ? `${formatInteger(data.totalSupply)} RLU` : '—'}</strong><small>On-chain</small></div>
    <div className="metric"><span>NAV per RLU</span><strong>{figures?.navPerRluCents != null ? money(figures.navPerRluCents) : '—'}</strong><small>Issue price {money(ISSUE_PRICE_CENTS)}</small></div>
    <div className="metric"><span>Fund capital</span><strong>{data ? formatMoney(data.totalFundSize) : '—'}</strong><small>Raised from subscriptions</small></div>
    <div className="metric"><span>Remaining capacity</span><strong>{remaining !== null ? formatMoney(remaining) : '—'}</strong><small>{maxFundSize !== null ? `Before the ${formatMoney(maxFundSize)} fund cap` : 'Fund cap'}</small></div>
  </section>;
}

function InvestorOptions() {
  const { events } = useLedger();
  const { displayName } = useRegistry();
  const addresses = useMemo(() => discoverInvestorAddresses(events ?? []), [events]);
  return <datalist id="known-investors">{addresses.map(address => <option key={address} value={address}>{displayName(address) ?? compactAddress(address)}</option>)}</datalist>;
}

function ProcessSubscription() {
  const { ledger, runTransaction, transactionPending } = useLedger();
  const { refresh } = useFinance();
  const { data, figures, maxFundSize } = useFundFigures();
  const { displayName } = useRegistry();
  const [investor, setInvestor] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const validAmount = /^[1-9]\d*$/.test(amount);
  const units = validAmount ? BigInt(amount) * 100n / ISSUE_PRICE_CENTS : null;
  const preview = units !== null && data && figures ? {
    capitalAfter: data.totalFundSize + units,
    navPerRluAfter: (figures.navCents + units * ISSUE_PRICE_CENTS) / (data.totalSupply + units),
    overCap: maxFundSize !== null && data.totalFundSize + units > maxFundSize,
  } : null;

  async function issue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage('');
    try {
      const wallet = investor.trim();
      if (!isAddress(wallet)) throw new Error('Enter the investor’s wallet address.');
      if (units === null) throw new Error('Enter a whole-dollar subscription amount greater than zero.');
      if (!ledger) throw new Error('Sepolia connection is unavailable.');
      if (!(await ledger.isApproved(wallet))) throw new Error('This wallet is not an approved investor. Approve it in the Investors tab first.');
      const [totalFundSize, max] = await Promise.all([ledger.totalFundSize(), ledger.getMaxFundSize()]);
      if (totalFundSize + units > max) throw new Error(`This subscription exceeds the remaining fund capacity of ${formatMoney(max - totalFundSize)}.`);
      if (!window.confirm(`Issue ${formatInteger(units)} RLU to ${displayName(wallet) ?? wallet} for a S$${formatInteger(BigInt(amount))} subscription?`)) { setMessage('Cancelled. No transaction was sent.'); return; }
      await runTransaction('manager', active => active.issueFundUnits(wallet, units));
      setAmount('');
      setMessage(`${formatInteger(units)} RLU issued to ${displayName(wallet) ?? compactAddress(wallet)} on Sepolia.`);
      void refresh();
    } catch (cause) { setError(userFacingError(cause)); }
  }

  return <div className="section-block"><h3>Process a subscription</h3>
    <p className="support-copy">After an approved investor has paid, issue their RLU here.</p>
    <form className="registration-form" onSubmit={event => void issue(event)}>
      <label>Investor wallet<input list="known-investors" value={investor} onChange={event => setInvestor(event.target.value)} placeholder="0x…" className="mono" /></label>
      <InvestorOptions />
      <label>Subscription amount (S$)<input type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} /></label>
      {preview && units !== null && <dl className="detail-list">
        <div><dt>RLU to issue</dt><dd>{formatInteger(units)} RLU at {money(ISSUE_PRICE_CENTS)}</dd></div>
        <div><dt>Fund capital after</dt><dd>{formatMoney(preview.capitalAfter)}</dd></div>
        <div><dt>NAV per RLU after</dt><dd>{money(preview.navPerRluAfter)}</dd></div>
      </dl>}
      {preview?.overCap && <p className="notice warning">This amount is above the remaining fund capacity.</p>}
      {figures?.navPerRluCents != null && figures.navPerRluCents > ISSUE_PRICE_CENTS && <p className="footnote">NAV per RLU is above the {money(ISSUE_PRICE_CENTS)} issue price, so new units slightly dilute existing holders.</p>}
      <button className="btn" disabled={transactionPending || !investor || !amount}>{transactionPending ? 'Waiting for confirmation…' : 'Issue RLU'}</button>
    </form>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {message && <p className="notice info" role="status">{message}</p>}
  </div>;
}

function RedemptionCheck() {
  const { ledger } = useLedger();
  const { data, figures } = useFundFigures();
  const [investor, setInvestor] = useState('');
  const [units, setUnits] = useState('');
  const [balance, setBalance] = useState<bigint | null>(null);
  const [balanceError, setBalanceError] = useState('');
  const wallet = investor.trim();
  useEffect(() => {
    setBalance(null); setBalanceError('');
    if (!ledger || !isAddress(wallet)) return;
    let active = true;
    ledger.balanceOf(wallet).then(value => { if (active) setBalance(value); }).catch(cause => { if (active) setBalanceError(userFacingError(cause)); });
    return () => { active = false; };
  }, [ledger, wallet]);
  const requested = /^[1-9]\d*$/.test(units) ? BigInt(units) : null;
  const payoutCents = requested !== null && data && figures && data.totalSupply > 0n ? requested * figures.navCents / data.totalSupply : null;
  const available = figures?.availableFundsCents ?? null;

  return <div className="section-block"><h3>Redemption check</h3>
    <p className="support-copy">Value a redemption at today’s NAV and check it against available funds.</p>
    <div className="registration-form">
      <label>Investor wallet<input list="known-investors" value={investor} onChange={event => setInvestor(event.target.value)} placeholder="0x…" className="mono" /></label>
      <label>RLU to redeem<input type="number" min="1" step="1" inputMode="numeric" value={units} onChange={event => setUnits(event.target.value)} /></label>
      {balance !== null && <button type="button" className="btn o small" onClick={() => setUnits(balance.toString())} disabled={balance === 0n}>Use full balance ({formatInteger(balance)} RLU)</button>}
    </div>
    {balanceError && <p className="inline-error" role="alert">{balanceError}</p>}
    {payoutCents !== null && requested !== null && <dl className="detail-list">
      <div><dt>Redemption value</dt><dd>{money(payoutCents)}</dd></div>
      {balance !== null && <div><dt>Investor holding</dt><dd>{formatInteger(balance)} RLU{requested > balance ? ' · less than requested' : ''}</dd></div>}
      {available !== null && <div><dt>Available funds</dt><dd>{money(available)} · {payoutCents <= available ? 'covers this redemption' : `short by ${money(payoutCents - available)}`}</dd></div>}
      {data && <div><dt>Investor ownership after</dt><dd>{balance !== null && requested <= balance && data.totalSupply > requested ? `${((Number(balance - requested) / Number(data.totalSupply - requested)) * 100).toFixed(2)}%` : '—'}</dd></div>}
    </dl>}
    <p className="footnote">The invoice ledger has no on-chain redemption, so redeemed RLU stays in issue. Settle the payment off-chain and keep a record.</p>
  </div>;
}

function RecentIssuances() {
  const { events } = useLedger();
  const { displayName } = useRegistry();
  const [expanded, setExpanded] = useState(false);
  const issued = (events ?? []).filter(event => event.name === 'FundUnitsIssued').slice().sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  const rows = expanded ? issued : issued.slice(0, 5);
  return <section className="section-block"><div className="section-heading"><h3>Recent RLU issuance</h3>{issued.length > 5 && <button className="btn o small" aria-expanded={expanded} aria-label={expanded ? 'Show latest 5 issuances' : `Show all ${issued.length} issuances`} title={expanded ? 'Collapse' : 'Expand'} onClick={() => setExpanded(value => !value)}><span aria-hidden="true">{expanded ? '˅' : '<'}</span></button>}</div>
    {rows.length ? <div className="table-scroll"><table><thead><tr><th>Date (SGT)</th><th>Investor</th><th>RLU issued</th><th>Transaction</th></tr></thead>
      <tbody>{rows.map(event => { const wallet = event.participants[0] ?? ''; return <tr key={`${event.transactionHash}:${event.logIndex}`}>
        <td>{event.timestamp ? financialDate(BigInt(event.timestamp)) : '—'}</td>
        <td>{displayName(wallet) ?? <span className="mono" title={wallet}>{compactAddress(wallet)}</span>}</td>
        <td>{event.amount !== undefined ? `${formatInteger(event.amount)} RLU` : '—'}</td>
        <td><a className="tx-link" href={`${SEPOLIA_EXPLORER}/tx/${event.transactionHash}`} target="_blank" rel="noreferrer">View</a></td>
      </tr>; })}</tbody></table></div> : <p className="empty-state compact">No RLU has been issued yet.</p>}
  </section>;
}

/** Investor subscription and redemption requests, decided by the fund manager. */
function FundRequestsManager() {
  const { runTransaction, transactionPending } = useLedger();
  const { displayName } = useRegistry();
  const { data, figures } = useFundFigures();
  const { requests, error, loading, reload, decide } = useFundRequests();
  const [showAll, setShowAll] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const visible = (requests ?? []).filter(item => showAll || isOpen(item));

  async function run(item: FundRequest, action: () => Promise<string>) {
    setBusy(item.id); setMessage(''); setActionError('');
    try { setMessage(await action()); setRejecting(null); setNote(''); }
    catch (cause) { setActionError(userFacingError(cause)); }
    finally { setBusy(null); }
  }
  const who = (item: FundRequest) => displayName(item.wallet) ?? compactAddress(item.wallet);
  // Subscription: issue RLU on-chain (S$1 = 1 RLU), then record the transaction against the request.
  const issue = (item: FundRequest) => run(item, async () => {
    const units = requestAmount(item);
    if (!window.confirm(`Issue ${formatInteger(units)} RLU to ${who(item)} for their S$${formatInteger(units)} subscription? Confirm you have received the payment.`)) return 'Cancelled. No transaction was sent.';
    const receipt = await runTransaction('manager', ledger => ledger.issueFundUnits(item.wallet, units)) as { hash?: string } | null;
    try { await decide(item, 'completed', 'RLU issued', receipt?.hash ?? null); }
    catch (cause) { throw new Error(`The RLU WAS issued on-chain${receipt?.hash ? ` (${receipt.hash})` : ''}, but the request could not be marked completed: ${userFacingError(cause)} Do not issue again; retry by refreshing and using Mark completed.`); }
    return `${formatInteger(units)} RLU issued to ${who(item)}; request completed.`;
  });
  const markIssued = (item: FundRequest) => run(item, async () => { await decide(item, 'completed', 'RLU issued (recorded manually)'); return `Subscription for ${who(item)} marked as completed.`; });
  const settle = (item: FundRequest) => run(item, async () => { await decide(item, 'completed', 'Redemption paid off-chain'); return `Redemption for ${who(item)} marked as settled.`; });
  const approve = (item: FundRequest) => run(item, async () => { await decide(item, 'approved', item.kind === 'subscription' ? 'Awaiting payment' : 'Approved for settlement'); return `Request from ${who(item)} approved.`; });
  const reject = (item: FundRequest) => run(item, async () => { await decide(item, 'rejected', note); return `Request from ${who(item)} rejected.`; });

  return <section className="section-block">
    <div className="section-heading"><h2>Subscription and redemption requests</h2>
      <div className="form-row"><label className="operations-filter"><input type="checkbox" checked={!showAll} onChange={event => setShowAll(!event.target.checked)} />Open only</label><button className="btn o small" disabled={loading} onClick={() => void reload()}>{loading ? 'Refreshing…' : 'Refresh'}</button></div></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {requests === null ? <p className="empty-state compact">{loading ? 'Loading requests…' : 'Requests are unavailable.'}</p>
      : !visible.length ? <p className="empty-state compact">{showAll ? 'No requests yet.' : 'No open requests.'}</p>
      : <div className="table-scroll"><table><thead><tr><th>Investor</th><th>Request</th><th>Amount</th><th>Value today</th><th>Requested</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{visible.map(item => { const amount = requestAmount(item); return <tr key={item.id}>
          <td>{who(item)}</td>
          <td>{item.kind === 'subscription' ? 'Subscribe' : 'Redeem'}</td>
          <td>{item.kind === 'subscription' ? `${formatMoney(amount)} → ${formatInteger(amount)} RLU` : `${formatInteger(amount)} RLU`}</td>
          <td>{item.kind === 'redemption' && data && figures ? money(unitValueCents(amount, figures.navCents, data.totalSupply)) : formatMoney(amount)}</td>
          <td>{new Date(item.created_at).toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium' })}</td>
          <td><span className={`status ${item.status === 'completed' ? 'approved' : item.status === 'rejected' || item.status === 'cancelled' ? 'rejected' : 'submitted'}`}>{STATUS_LABELS[item.status]}</span>{item.manager_note && <small className="document-meta">{item.manager_note}</small>}</td>
          <td>{isOpen(item) && (rejecting === item.id
            ? <span className="form-row"><input aria-label="Reason for rejecting" value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="Reason" /><button className="btn small" disabled={!note.trim() || busy === item.id} onClick={() => void reject(item)}>Confirm reject</button><button className="btn o small" onClick={() => { setRejecting(null); setNote(''); }}>Cancel</button></span>
            : <span className="form-row">
              {item.kind === 'subscription'
                ? <><button className="btn small" disabled={busy === item.id || transactionPending} onClick={() => void issue(item)}>Issue RLU</button><button className="btn o small" disabled={busy === item.id} title="Use only if the RLU was already issued" onClick={() => void markIssued(item)}>Mark completed</button></>
                : <button className="btn small" disabled={busy === item.id} onClick={() => void settle(item)}>Mark settled</button>}
              {item.status === 'pending' && <button className="btn o small" disabled={busy === item.id} onClick={() => void approve(item)}>Approve</button>}
              <button className="btn o small" disabled={busy === item.id} onClick={() => setRejecting(item.id)}>Reject</button>
            </span>)}{item.tx_hash && <a className="tx-link" href={`${SEPOLIA_EXPLORER}/tx/${item.tx_hash}`} target="_blank" rel="noreferrer">View transaction</a>}</td>
        </tr>; })}</tbody></table></div>}
    {message && <p className="notice info" role="status">{message}</p>}
    {actionError && <p className="inline-error" role="alert">{actionError}</p>}
    <p className="footnote">Issue RLU only after the investor’s payment has arrived. Redemptions are paid off-chain; RLU stays in issue because the ledger cannot cancel units.</p>
  </section>;
}
