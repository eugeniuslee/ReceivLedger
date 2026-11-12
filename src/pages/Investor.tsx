import { useState } from 'react';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import type { PageId } from '../chain/access';
import type { ChainEvent } from '../chain/chainLedger';
import { SEPOLIA_EXPLORER } from '../chain/abi';
import { compactAddress, formatInteger, formatMoney } from '../chain/presentation';
import { financialDate } from '../finance/presentation';
import { maturityState, money } from '../finance/models';
import { termsAt } from '../finance/financing';
import { unitValueCents, useFundNav } from '../finance/useFundNav';
import { PrivateAccess } from '../components/PrivateAccess';
import { isOpen, requestAmount, STATUS_LABELS, useFundRequests, type FundRequest } from '../registration/fundRequests';
import { userFacingError } from '../errors';
import { Investors } from './Investors';

/** Investors buy RLU at this fixed price (the ledger issues 1 RLU per S$1). */
const ISSUE_PRICE_CENTS = 100n;
const ZERO = '0x0000000000000000000000000000000000000000';
const rate = (bps: number) => `${(bps / 100).toLocaleString('en-SG', { maximumFractionDigits: 2 })}%`;
const percent = (part: bigint, whole: bigint) => whole > 0n ? `${(Number(part * 10000n / whole) / 100).toFixed(2)}%` : '—';
const signedPercent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

/** The connected investor's RLU and activity, from on-chain balances and this wallet's own events. */
function useHoldings() {
  const { account, snapshot, events } = useLedger();
  const { nav, navPerRluCents, data } = useFundNav();
  const units = snapshot && 'connectedBalance' in snapshot ? snapshot.connectedBalance : null;
  const me = account?.toLowerCase() ?? '';
  const activity: { event: ChainEvent; type: 'Issued' | 'Received' | 'Sent'; counterparty: string | null }[] = [];
  for (const event of events ?? []) {
    if (event.name === 'FundUnitsIssued' && event.participants[0]?.toLowerCase() === me) activity.push({ event, type: 'Issued', counterparty: null });
    if (event.name === 'Transfer') {
      const [from = '', to = ''] = event.participants.map(address => address.toLowerCase());
      if (from === ZERO || to === ZERO) continue; // minting is shown as Issued
      if (to === me) activity.push({ event, type: 'Received', counterparty: event.participants[0] });
      else if (from === me) activity.push({ event, type: 'Sent', counterparty: event.participants[1] });
    }
  }
  activity.sort((a, b) => b.event.blockNumber - a.event.blockNumber || b.event.logIndex - a.event.logIndex);
  const valueCents = units !== null && nav && data ? unitValueCents(units, nav.navCents, data.totalSupply) : null;
  return { units, valueCents, navPerRluCents, activity, ownership: units !== null && data ? percent(units, data.totalSupply) : '—',
    gainCents: units !== null && valueCents !== null ? valueCents - units * ISSUE_PRICE_CENTS : null };
}

function HoldingMetrics() {
  const { units, valueCents, ownership, navPerRluCents } = useHoldings();
  return <section className="metric-grid" aria-label="Your holding">
    <div className="metric emphasis"><span>Your RLU</span><strong>{units === null ? '—' : `${formatInteger(units)} RLU`}</strong><small>On-chain balance</small></div>
    <div className="metric"><span>Holding value</span><strong>{valueCents === null ? '—' : money(valueCents)}</strong><small>At today’s NAV</small></div>
    <div className="metric"><span>Your ownership</span><strong>{ownership}</strong><small>Share of all RLU</small></div>
    <div className="metric"><span>NAV per RLU</span><strong>{navPerRluCents === null ? '—' : money(navPerRluCents)}</strong><small>Issued at {money(ISSUE_PRICE_CENTS)}</small></div>
  </section>;
}

function RequestStatus({ item }: { item: FundRequest }) {
  return <><span className={`status ${item.status === 'completed' ? 'approved' : item.status === 'rejected' || item.status === 'cancelled' ? 'rejected' : 'submitted'}`}>{STATUS_LABELS[item.status]}</span>{item.manager_note && <small className="document-meta">{item.manager_note}</small>}</>;
}
const describe = (item: FundRequest) => item.kind === 'subscription' ? `Subscribe ${formatMoney(requestAmount(item))}` : `Redeem ${formatInteger(requestAmount(item))} RLU`;
const requested = (item: FundRequest) => new Date(item.created_at).toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium' });

// ───────────────────────────── Home ─────────────────────────────

export function InvestorHome({ onNavigate, inactive = false }: { onNavigate?: (page: PageId) => void; inactive?: boolean }) {
  const { activity } = useHoldings();
  const { navPerRluCents } = useFundNav();
  const { requests, authenticated } = useFundRequests();
  const open = (requests ?? []).filter(isOpen);
  const returnPct = navPerRluCents === null ? null : (Number(navPerRluCents) - Number(ISSUE_PRICE_CENTS)) / Number(ISSUE_PRICE_CENTS) * 100;
  return <>
    <HoldingMetrics />
    {inactive && <p className="notice warning">This wallet is not currently an approved investor. You can view your holdings, but cannot subscribe, redeem or transfer.</p>}
    {!inactive && <section className="section-block"><h3>Quick actions</h3>
      <div className="form-row">{(['Subscribe', 'Redeem', 'Transfer'] as const).map(action => <button key={action} className="btn" onClick={() => onNavigate?.('invest')}>{action} RLU</button>)}</div>
    </section>}
    <section className="dashboard-grid">
      <div className="section-block"><h3>Fund at a glance</h3>
        <dl className="detail-list">
          <div><dt>NAV per RLU</dt><dd>{navPerRluCents === null ? '—' : money(navPerRluCents)}</dd></div>
          <div><dt>Return since issue</dt><dd>{returnPct === null ? '—' : signedPercent(returnPct)}</dd></div>
        </dl>
        {onNavigate && <button className="btn o small" onClick={() => onNavigate('performance')}>View fund performance</button>}
      </div>
      <div className="section-block"><h3>Your open requests</h3>
        {!authenticated ? <p className="support-copy">Sign in with your wallet on the Invest tab to see your requests.</p>
          : open.length ? <ul className="plain-list">{open.slice(0, 3).map(item => <li key={item.id}>{describe(item)} · <RequestStatus item={item} /></li>)}</ul>
          : <p className="support-copy">No open requests.</p>}
      </div>
    </section>
    <section className="section-block"><h3>Recent activity</h3>
      {activity.length ? <ActivityTable rows={activity.slice(0, 3)} /> : <p className="empty-state compact">No RLU activity for this wallet yet.</p>}
    </section>
  </>;
}

// ───────────────────────────── Portfolio ─────────────────────────────

function ActivityTable({ rows }: { rows: ReturnType<typeof useHoldings>['activity'] }) {
  return <div className="table-scroll"><table><thead><tr><th>Date (SGT)</th><th>Activity</th><th>RLU</th><th>Counterparty</th><th>Transaction</th></tr></thead>
    <tbody>{rows.map(({ event, type, counterparty }) => <tr key={`${event.transactionHash}:${event.logIndex}`}>
      <td>{event.timestamp ? financialDate(BigInt(event.timestamp)) : '—'}</td>
      <td>{type === 'Issued' ? 'Issued by the fund' : type === 'Received' ? 'Received by transfer' : 'Sent by transfer'}</td>
      <td>{type === 'Sent' ? '−' : '+'}{event.amount !== undefined ? formatInteger(event.amount) : '—'}</td>
      <td>{counterparty ? <span className="mono" title={counterparty}>{compactAddress(counterparty)}</span> : 'ReceivLedger fund'}</td>
      <td><a className="tx-link" href={`${SEPOLIA_EXPLORER}/tx/${event.transactionHash}`} target="_blank" rel="noreferrer">View</a></td>
    </tr>)}</tbody></table></div>;
}

export function Portfolio() {
  const { account, role } = useLedger();
  const { registeredName } = useRegistry();
  const { units, valueCents, gainCents, activity } = useHoldings();
  const [expanded, setExpanded] = useState(false);
  if (role !== 'investor' && role !== 'inactiveInvestor') return <p className="notice error">An investor wallet is required to view a portfolio.</p>;
  const sum = (type: 'Issued' | 'Received' | 'Sent') => activity.filter(row => row.type === type).reduce((total, row) => total + (row.event.amount ?? 0n), 0n);
  const rows = expanded ? activity : activity.slice(0, 5);
  return <>
    <HoldingMetrics />
    <section className="dashboard-grid">
      <div className="section-block"><h3>Your holding</h3>
        <dl className="detail-list">
          <div><dt>Issued to you by the fund</dt><dd>{formatInteger(sum('Issued'))} RLU</dd></div>
          <div><dt>Received by transfer</dt><dd>{formatInteger(sum('Received'))} RLU</dd></div>
          <div><dt>Sent by transfer</dt><dd>{formatInteger(sum('Sent'))} RLU</dd></div>
          <div><dt><b>Current holding</b></dt><dd><b>{units === null ? '—' : `${formatInteger(units)} RLU`}</b></dd></div>
        </dl>
      </div>
      <div className="section-block"><h3>Value</h3>
        <dl className="detail-list">
          <div><dt>Value at issue price</dt><dd>{units === null ? '—' : money(units * ISSUE_PRICE_CENTS)}</dd></div>
          <div><dt>Value today</dt><dd>{valueCents === null ? '—' : money(valueCents)}</dd></div>
          <div><dt>Gain since issue</dt><dd>{gainCents === null ? '—' : `${gainCents >= 0n ? '+' : ''}${money(gainCents)}`}</dd></div>
        </dl>
        <p className="footnote">Value grows as the fund earns fees and interest on financed invoices. It is not paid out until you redeem.</p>
      </div>
    </section>
    <section className="section-block"><div className="section-heading"><h3>RLU activity</h3>{activity.length > 5 && <button className="btn o small" aria-expanded={expanded} aria-label={expanded ? 'Show latest 5' : `Show all ${activity.length}`} title={expanded ? 'Collapse' : 'Expand'} onClick={() => setExpanded(value => !value)}><span aria-hidden="true">{expanded ? '˅' : '<'}</span></button>}</div>
      {rows.length ? <ActivityTable rows={rows} /> : <p className="empty-state compact">No RLU activity for this wallet yet.</p>}
    </section>
    <section className="section-block"><h3>Account</h3>
      <dl className="detail-list">
        <div><dt>Name</dt><dd>{registeredName ?? '—'}</dd></div>
        <div><dt>Wallet</dt><dd className="mono selectable-address">{account}</dd></div>
        <div><dt>Investor status</dt><dd>{role === 'investor' ? <span className="status approved">Approved</span> : <span className="status rejected">Not currently approved</span>}</dd></div>
      </dl>
    </section>
  </>;
}

// ───────────────────────────── Fund performance (public) ─────────────────────────────

export function FundPerformance() {
  const { data, nav, navPerRluCents, now, loading } = useFundNav();
  if (!data || !nav) return <p className="empty-state">{loading ? 'Loading fund performance…' : 'Fund records are unavailable. Refresh after checking your connection.'}</p>;
  const terms = termsAt(now);
  const financed = data.invoices.filter(invoice => invoice.status === 'Financed');
  const repaid = data.invoices.filter(invoice => invoice.status === 'Repaid');
  const overdue = financed.filter(invoice => maturityState(invoice, now).overdue).length;
  const everFinanced = [...financed, ...repaid];
  const average = everFinanced.length ? everFinanced.reduce((sum, invoice) => sum + invoice.amount, 0n) * 100n / BigInt(everFinanced.length) : 0n;
  const returnPct = navPerRluCents === null ? null : (Number(navPerRluCents) - Number(ISSUE_PRICE_CENTS)) / Number(ISSUE_PRICE_CENTS) * 100;
  const deployedPct = data.totalFundSize > 0n ? Number((data.totalFundSize - data.availableFunds) * 100n / data.totalFundSize) : 0;
  return <>
    <section className="metric-grid" aria-label="Fund performance">
      <div className="metric emphasis"><span>NAV per RLU</span><strong>{navPerRluCents === null ? '—' : money(navPerRluCents)}</strong><small>Issued at {money(ISSUE_PRICE_CENTS)}</small></div>
      <div className="metric"><span>Return since issue</span><strong>{returnPct === null ? '—' : signedPercent(returnPct)}</strong><small>Growth of NAV per RLU</small></div>
      <div className="metric"><span>Fund NAV</span><strong>{money(nav.navCents)}</strong><small>{formatInteger(data.totalSupply)} RLU in issue</small></div>
      <div className="metric"><span>Income earned</span><strong>{money(nav.totalIncomeCents)}</strong><small>Fees and interest to date</small></div>
    </section>
    <section className="section-block fund-accounting"><h3>How the fund’s money is used</h3>
      <div className="accounting-bar" role="img" aria-label={`${100 - deployedPct}% available, ${deployedPct}% financing invoices`}><div style={{ width: `${100 - deployedPct}%` }} /></div>
      <div className="bar-legend"><span><i className="legend-dot available" />Available {formatMoney(data.availableFunds)} · {100 - deployedPct}%</span><span><i className="legend-dot financed" />Financing invoices {formatMoney(data.totalFundSize - data.availableFunds)} · {deployedPct}%</span></div>
    </section>
    <section className="dashboard-grid">
      <div className="section-block"><h3>Invoice portfolio</h3>
        <dl className="detail-list">
          <div><dt>Invoices being financed</dt><dd>{financed.length}</dd></div>
          <div><dt>Invoices repaid</dt><dd>{repaid.length}</dd></div>
          <div><dt>Overdue invoices</dt><dd>{overdue}</dd></div>
          <div><dt>Average invoice size</dt><dd>{everFinanced.length ? money(average) : '—'}</dd></div>
        </dl>
        <p className="footnote">Individual SMEs and payers are kept private.</p>
      </div>
      <div className="section-block"><h3>Where income comes from</h3>
        <dl className="detail-list">
          <div><dt>Service fees</dt><dd>{money(nav.serviceFeesCents + nav.realisedFeesCents)}</dd></div>
          <div><dt>Interest</dt><dd>{money(nav.accruedInterestCents + nav.realisedInterestCents)}</dd></div>
          <div><dt>Fund capital</dt><dd>{money(data.totalFundSize * 100n)}</dd></div>
        </dl>
        <p className="footnote">The fund advances {rate(terms.advanceBps)} of each invoice, charging a {rate(terms.serviceFeeBps)} fee and {rate(terms.annualInterestBps)} a year interest on the cash advanced.</p>
      </div>
    </section>
  </>;
}

// ───────────────────────────── Invest ─────────────────────────────

export function Invest() {
  const { role } = useLedger();
  if (role !== 'investor') return <p className="notice error">Only approved investors can subscribe, redeem or transfer RLU.</p>;
  return <>
    <HoldingMetrics />
    <section className="dashboard-grid">
      <PrivateAccess compact message="Sign in with your wallet to request a subscription."><SubscribeCard /></PrivateAccess>
      <PrivateAccess compact message="Sign in with your wallet to request a redemption."><RedeemCard /></PrivateAccess>
    </section>
    <Investors investorTransferOnly />
    <PrivateAccess compact message="Sign in with your wallet to see your requests."><MyRequests /></PrivateAccess>
  </>;
}

function useRequestForm() {
  const requests = useFundRequests();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function submit(action: () => Promise<void>, success: string) {
    setBusy(true); setMessage(''); setError('');
    try { await action(); setMessage(success); return true; }
    catch (cause) { setError(userFacingError(cause)); return false; }
    finally { setBusy(false); }
  }
  return { ...requests, busy, message, error, submit };
}

function SubscribeCard() {
  const form = useRequestForm();
  const [amount, setAmount] = useState('');
  const valid = /^[1-9]\d{0,9}$/.test(amount);
  return <div className="section-block"><h3>Subscribe</h3>
    <p className="support-copy">Buy RLU at {money(ISSUE_PRICE_CENTS)} each. The fund manager confirms your payment, then issues your RLU.</p>
    <form className="registration-form" onSubmit={async event => { event.preventDefault(); if (valid && await form.submit(() => form.create('subscription', BigInt(amount)), `Subscription request for ${formatMoney(BigInt(amount))} sent.`)) setAmount(''); }}>
      <label>Amount (S$)<input type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} /></label>
      {valid && <p className="support-copy">You will receive <b>{formatInteger(BigInt(amount))} RLU</b>.</p>}
      <button className="btn" disabled={!valid || form.busy}>{form.busy ? 'Sending…' : 'Request subscription'}</button>
    </form>
    {form.message && <p className="notice info" role="status">{form.message}</p>}
    {form.error && <p className="inline-error" role="alert">{form.error}</p>}
  </div>;
}

function RedeemCard() {
  const form = useRequestForm();
  const { units, navPerRluCents } = useHoldings();
  const { nav, data } = useFundNav();
  const [amount, setAmount] = useState('');
  const requestedUnits = /^[1-9]\d{0,9}$/.test(amount) ? BigInt(amount) : null;
  const tooMany = requestedUnits !== null && units !== null && requestedUnits > units;
  const value = requestedUnits !== null && nav && data ? unitValueCents(requestedUnits, nav.navCents, data.totalSupply) : null;
  return <div className="section-block"><h3>Redeem</h3>
    <p className="support-copy">Sell RLU back to the fund at NAV{navPerRluCents !== null ? ` (${money(navPerRluCents)} per RLU today)` : ''}. The fund manager pays you once approved.</p>
    <form className="registration-form" onSubmit={async event => { event.preventDefault(); if (requestedUnits !== null && !tooMany && await form.submit(() => form.create('redemption', requestedUnits), `Redemption request for ${formatInteger(requestedUnits)} RLU sent.`)) setAmount(''); }}>
      <label>RLU to redeem<input type="number" min="1" step="1" inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} /></label>
      {units !== null && units > 0n && <button type="button" className="btn o small" onClick={() => setAmount(units.toString())}>Use full balance ({formatInteger(units)} RLU)</button>}
      {value !== null && !tooMany && <p className="support-copy">Estimated value today: <b>{money(value)}</b>. The final amount uses NAV when paid.</p>}
      {tooMany && <p className="inline-error">You hold {formatInteger(units!)} RLU.</p>}
      <button className="btn" disabled={requestedUnits === null || tooMany || form.busy}>{form.busy ? 'Sending…' : 'Request redemption'}</button>
    </form>
    {form.message && <p className="notice info" role="status">{form.message}</p>}
    {form.error && <p className="inline-error" role="alert">{form.error}</p>}
  </div>;
}

function MyRequests() {
  const form = useRequestForm();
  const items = form.requests ?? [];
  return <section className="section-block"><div className="section-heading"><h3>Your requests</h3><button className="btn o small" disabled={form.loading} onClick={() => void form.reload()}>{form.loading ? 'Refreshing…' : 'Refresh'}</button></div>
    {form.requests === null ? <p className="empty-state compact">{form.loading ? 'Loading your requests…' : form.error || 'Requests are unavailable.'}</p>
      : items.length ? <div className="table-scroll"><table><thead><tr><th>Request</th><th>Requested</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{items.map(item => <tr key={item.id}><td>{describe(item)}{item.kind === 'subscription' && <small className="document-meta">{formatInteger(requestAmount(item))} RLU</small>}</td><td>{requested(item)}</td><td><RequestStatus item={item} /></td>
          <td>{item.status === 'pending' ? <button className="btn o small" disabled={form.busy} onClick={() => void form.submit(() => form.cancel(item.id), 'Request cancelled.')}>Cancel</button> : item.tx_hash ? <a className="tx-link" href={`${SEPOLIA_EXPLORER}/tx/${item.tx_hash}`} target="_blank" rel="noreferrer">View transaction</a> : '—'}</td></tr>)}</tbody></table></div>
      : <p className="empty-state compact">You have not made any requests yet.</p>}
    {form.message && <p className="notice info" role="status">{form.message}</p>}
    {form.error && form.requests !== null && <p className="inline-error" role="alert">{form.error}</p>}
  </section>;
}
