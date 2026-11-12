import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useInvoiceCredits } from '../finance/credits';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { useFinance } from '../finance/FinanceContext';
import { SEPOLIA_EXPLORER } from '../chain/abi';
import { compactAddress, formatInteger, formatMoney } from '../chain/presentation';
import { financialDate } from '../finance/presentation';
import { money } from '../finance/models';
import { userFacingError } from '../errors';
import { ledgerFigures } from '../v2/ManagerOperations';
import { PrivateAccess } from '../components/PrivateAccess';
import { isOpen, requestAmount, STATUS_LABELS, useFundRequests, type FundRequest } from '../registration/fundRequests';
import { navPriceText, unitsForAmount, unitValueCents } from '../finance/useFundNav';
import { latestProof, paymentReference, ProofStatus, useDocuments } from '../components/ProofUpload';
import type { Application, PrivateDocument } from '../../supabase/functions/_shared/domain';

/** Manager's Funds tab: fund units, investor subscription/redemption requests and RLU issuance. */
export function Funds() {
  const { role, networkOk } = useLedger();
  if (role !== 'manager') return <div className="notice error" role="alert">Fund administration is available only to the fund manager.</div>;
  if (!networkOk) return <div className="empty-state">Switch to Sepolia to manage RLU subscriptions and redemptions.</div>;
  return <>
    <FundUnitSummary />
    <PrivateAccess compact message="Verify your fund manager wallet to see investor subscription and redemption requests."><FundRequestsManager /></PrivateAccess>
    <RecentIssuances />
  </>;
}

function useFundFigures() {
  const { events, lifecycleEvents } = useLedger();
  const { data, now } = useFinance();
  const credits = useInvoiceCredits();
  const figures = data ? ledgerFigures(data, lifecycleEvents?.length ? lifecycleEvents : events ?? [], now, credits) : null;
  return { data, figures };
}

function FundUnitSummary() {
  const { data, figures } = useFundFigures();
  return <section className="metric-grid" aria-label="Fund unit summary">
    <div className="metric emphasis"><span>RLU in issue</span><strong>{data ? `${formatInteger(data.totalSupply)} RLU` : '—'}</strong><small>On-chain</small></div>
    <div className="metric"><span>NAV per RLU</span><strong>{data && figures ? navPriceText(figures.navCents, data.totalSupply) : '—'}</strong><small>Subscription and redemption price</small></div>
    <div className="metric"><span>Fund NAV</span><strong>{figures ? money(figures.navCents) : '—'}</strong><small>Cash + receivables − bad debt</small></div>
    <div className="metric"><span>Fund capital</span><strong>{data ? formatMoney(data.totalFundSize) : '—'}</strong><small>Raised from subscriptions</small></div>
  </section>;
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
  const { displayName, request } = useRegistry();
  const { data, figures } = useFundFigures();
  const { requests, error, loading, reload, decide } = useFundRequests();
  const { documents, reload: reloadDocuments } = useDocuments();
  const [askingProof, setAskingProof] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [proofNote, setProofNote] = useState('');
  const proofFor = (id: string) => latestProof(documents, doc => doc.purpose === 'subscription' && doc.fund_request_id === id);
  async function viewProof(doc: PrivateDocument) {
    try {
      const blob = await request<Blob>({ action: 'download', id: doc.id });
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = doc.filename || `${doc.id}.pdf`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) { setActionError(userFacingError(cause)); }
  }
  // Accept the payment proof (unlocks Issue RLU) or reject it so the investor uploads another.
  const reviewProof = (item: FundRequest, doc: PrivateDocument, decision: 'verified' | 'rejected') => run(item, async () => {
    await request({ action: 'review_document', id: doc.id, version: doc.version, decision, note: decision === 'verified' ? 'Payment received' : proofNote.trim() });
    await reloadDocuments(); setAskingProof(null); setProofNote('');
    return decision === 'verified' ? `Payment from ${who(item)} accepted. You can now issue the RLU.` : `${who(item)} has been asked for a new payment proof.`;
  });
  const [showPast, setShowPast] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const open = (requests ?? []).filter(isOpen);
  const past = (requests ?? []).filter(item => !isOpen(item));

  async function run(item: FundRequest, action: () => Promise<string>) {
    setBusy(item.id); setMessage(''); setActionError('');
    try { setMessage(await action()); setRejecting(null); setNote(''); }
    catch (cause) { setActionError(userFacingError(cause)); }
    finally { setBusy(null); }
  }
  const who = (item: FundRequest) => displayName(item.wallet) ?? compactAddress(item.wallet);
  // Subscription: issue RLU on-chain (S$1 = 1 RLU), then record the transaction against the request.
  // Subscriptions deal at today's NAV per RLU; RLU has no decimals, so the investor receives the whole units their payment buys.
  const issue = (item: FundRequest) => run(item, async () => {
    const paid = requestAmount(item);
    if (!data || !figures) throw new Error('Fund NAV is still loading. Try again in a moment.');
    const units = unitsForAmount(paid, figures.navCents, data.totalSupply);
    if (units <= 0n) throw new Error('The payment is too small to buy one RLU at today’s NAV.');
    if (!window.confirm(`Issue ${formatInteger(units)} RLU to ${who(item)} for their ${formatMoney(paid)} subscription at ${navPriceText(figures.navCents, data.totalSupply)} per RLU (NAV)? Confirm you have received the payment.`)) return 'Cancelled. No transaction was sent.';
    const receipt = await runTransaction('manager', ledger => ledger.issueFundUnits(item.wallet, units)) as { hash?: string } | null;
    try { await decide(item, 'completed', 'RLU issued', receipt?.hash ?? null); }
    catch (cause) { throw new Error(`The RLU WAS issued on-chain${receipt?.hash ? ` (${receipt.hash})` : ''}, but the request could not be marked completed: ${userFacingError(cause)} Do not issue again; retry by refreshing and using Mark completed.`); }
    return `${formatInteger(units)} RLU issued to ${who(item)} at ${navPriceText(figures.navCents, data.totalSupply)} per RLU; request completed.`;
  });
  const markIssued = (item: FundRequest) => run(item, async () => { await decide(item, 'completed', 'RLU issued (recorded manually)'); return `Subscription for ${who(item)} marked as completed.`; });
  const settle = (item: FundRequest) => run(item, async () => { await decide(item, 'completed', 'Redemption paid off-chain'); return `Redemption for ${who(item)} marked as settled.`; });
  const approve = (item: FundRequest) => run(item, async () => { await decide(item, 'approved', item.kind === 'subscription' ? 'Awaiting payment' : 'Approved for settlement'); return `Request from ${who(item)} approved.`; });
  const reject = (item: FundRequest) => run(item, async () => { await decide(item, 'rejected', note); return `Request from ${who(item)} rejected.`; });

  // Look the open request up by id so the window shows fresh data after each action reloads the list.
  const viewing = viewingId ? (requests ?? []).find(row => row.id === viewingId) ?? null : null;
  const openDetails = (item: FundRequest) => { setViewingId(item.id); setMessage(''); setActionError(''); setRejecting(null); setAskingProof(null); };
  const feedback = <>{message && <p className="notice info" role="status">{message}</p>}{actionError && <p className="inline-error" role="alert">{actionError}</p>}</>;

  const requestTable = (rows: FundRequest[], label: string) => <div className="table-scroll"><table className="requests-table" aria-label={label}><thead><tr><th>Investor</th><th>Request</th><th>Amount</th><th>Requested</th><th>Status</th><th><span className="sr-only">Details</span></th></tr></thead>
    <tbody>{rows.map(item => { const amount = requestAmount(item); const step = nextStep(item, proofFor(item.id)); return <tr key={item.id}>
      <td><strong>{who(item)}</strong>{displayName(item.wallet) && <small className="document-meta mono">{compactAddress(item.wallet)}</small>}</td>
      <td>{item.kind === 'subscription' ? 'Subscribe' : 'Redeem'}</td>
      <td>{item.kind === 'subscription' ? formatMoney(amount) : `${formatInteger(amount)} RLU`}
        {item.kind === 'redemption' && isOpen(item) && data && figures && <small className="document-meta">≈ {money(unitValueCents(amount, figures.navCents, data.totalSupply))}</small>}</td>
      <td>{new Date(item.created_at).toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium' })}</td>
      <td><span className={`status ${item.status === 'completed' ? 'approved' : item.status === 'rejected' || item.status === 'cancelled' ? 'rejected' : 'submitted'}`}>{STATUS_LABELS[item.status]}</span>
        {step && <small className={`document-meta${step.yours ? ' next-step-yours' : ''}`}>{step.label}</small>}</td>
      <td><button className="btn o small" onClick={() => openDetails(item)}>Details</button></td>
    </tr>; })}</tbody></table></div>;

  return <section className="section-block">
    <div className="section-heading"><h2>Subscription and redemption requests</h2>
      <button className="btn o small" disabled={loading} onClick={() => void reload()}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {requests === null ? <p className="empty-state compact">{loading ? 'Loading requests…' : 'Requests are unavailable.'}</p> : <>
      {open.length ? requestTable(open, 'Open requests') : <p className="empty-state compact">No open requests.</p>}
      {past.length > 0 && <div className="past-requests">
        <button className="btn o small" aria-expanded={showPast} onClick={() => setShowPast(value => !value)}>{showPast ? 'Hide past requests' : `View past requests (${past.length})`}</button>
        {showPast && requestTable(past, 'Past requests')}
      </div>}
    </>}
    {!viewing && feedback}
    {viewing && <InvestorDetails item={viewing} requests={requests ?? []} documents={documents} onClose={() => setViewingId(null)}>
      {isOpen(viewing) && <section className="request-next-step" aria-label="Next step">
        <h3>Next step</h3>
        {nextStep(viewing, proofFor(viewing.id)) && <p className="support-copy">{nextStep(viewing, proofFor(viewing.id))!.hint}</p>}
        {rejecting === viewing.id
          ? <div className="form-row"><input aria-label="Reason for rejecting" value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="Reason the investor will see" />
              <button className="btn small" disabled={!note.trim() || busy === viewing.id} onClick={() => void reject(viewing)}>Confirm reject</button><button className="btn o small" onClick={() => { setRejecting(null); setNote(''); }}>Cancel</button></div>
          : <div className="subscription-actions">
              {viewing.status === 'pending' && <button className="btn small" disabled={busy === viewing.id} onClick={() => void approve(viewing)}>Approve request</button>}
              {viewing.kind === 'subscription'
                ? <SubscriptionActions item={viewing} proof={proofFor(viewing.id)} busy={busy === viewing.id || transactionPending} asking={askingProof === viewing.id} proofNote={proofNote}
                    onProofNote={setProofNote} onAsk={() => { setAskingProof(viewing.id); setProofNote(''); }} onCancelAsk={() => setAskingProof(null)}
                    onView={doc => void viewProof(doc)} onReview={(doc, decision) => void reviewProof(viewing, doc, decision)} onIssue={() => void issue(viewing)} onMarkIssued={() => void markIssued(viewing)} />
                : viewing.status === 'approved' && <button className="btn small" disabled={busy === viewing.id} onClick={() => void settle(viewing)}>Mark settled</button>}
              <button className="btn o small" disabled={busy === viewing.id} onClick={() => setRejecting(viewing.id)}>Reject</button>
            </div>}
        {feedback}
      </section>}
      {!isOpen(viewing) && feedback}
    </InvestorDetails>}
    <p className="footnote">Issue RLU only after the investor’s payment has arrived. Redemptions are paid off-chain; RLU stays in issue because the ledger cannot cancel units.</p>
  </section>;
}

/** What has to happen next on a request, and whether it is the manager's move. */
function nextStep(item: FundRequest, proof: PrivateDocument | undefined): { label: string; hint: string; yours: boolean } | null {
  if (item.status === 'pending') return { label: 'Needs your approval', hint: 'Check the investor below, then approve or reject the request.', yours: true };
  if (item.status !== 'approved') return null;
  if (item.kind === 'redemption') return { label: 'Pay, then mark settled', hint: 'Pay the investor off-chain at today’s NAV, then mark the redemption settled.', yours: true };
  if (!proof) return { label: 'Waiting for payment proof', hint: `The investor has been asked to pay and quote reference ${paymentReference(item.id)}. Nothing to do until they upload a proof.`, yours: false };
  if (proof.status === 'pending') return { label: 'Payment proof to check', hint: `Check the proof shows the payment with reference ${paymentReference(item.id)}, then accept it or ask for a new one.`, yours: true };
  if (proof.status === 'verified') return { label: 'Ready to issue RLU', hint: 'The payment is accepted. Issue the RLU on-chain to complete the subscription.', yours: true };
  return { label: 'New proof requested', hint: 'You asked the investor for a new payment proof. Nothing to do until they upload it.', yours: false };
}

/** Subscription flow for the manager: approve → investor pays and uploads proof → accept or ask again → issue RLU. */
function SubscriptionActions({ item, proof, busy, asking, proofNote, onProofNote, onAsk, onCancelAsk, onView, onReview, onIssue, onMarkIssued }: {
  item: FundRequest; proof: PrivateDocument | undefined; busy: boolean; asking: boolean; proofNote: string; onProofNote: (value: string) => void;
  onAsk: () => void; onCancelAsk: () => void; onView: (doc: PrivateDocument) => void; onReview: (doc: PrivateDocument, decision: 'verified' | 'rejected') => void; onIssue: () => void; onMarkIssued: () => void;
}) {
  if (item.status !== 'approved') return null;
  const accepted = proof?.status === 'verified';
  return <>
    {proof && <button className="btn o small" onClick={() => onView(proof)}>View proof</button>}
    {proof?.status === 'pending' && (asking
      ? <span className="form-row"><input aria-label="What is wrong with the proof" value={proofNote} maxLength={500} onChange={event => onProofNote(event.target.value)} placeholder="e.g. Amount does not match" />
          <button className="btn small" disabled={busy || !proofNote.trim()} onClick={() => onReview(proof, 'rejected')}>Send request</button><button className="btn o small" onClick={onCancelAsk}>Cancel</button></span>
      : <><button className="btn small" disabled={busy} onClick={() => onReview(proof, 'verified')}>Accept payment</button><button className="btn o small" disabled={busy} onClick={onAsk}>Ask for new proof</button></>)}
    <button className="btn small" disabled={busy || !accepted} title={accepted ? 'Issue the RLU on-chain' : 'Accept the payment proof first'} onClick={onIssue}>Issue RLU</button>
    <button className="btn o small" disabled={busy} title="Use only if the RLU was already issued" onClick={onMarkIssued}>Mark completed</button>
  </>;
}

/** Everything the manager needs to decide on an investor's request: on-chain position, application and history. */
function InvestorDetails({ item, requests, documents, onClose, children }: {
  item: FundRequest; requests: FundRequest[]; documents: PrivateDocument[] | null; onClose: () => void; children: ReactNode;
}) {
  const { ledger } = useLedger();
  const { request, displayName } = useRegistry();
  const requestRef = useRef(request); requestRef.current = request;
  const { data, figures } = useFundFigures();
  const [chain, setChain] = useState<{ approved: boolean; units: bigint } | null>(null);
  const [application, setApplication] = useState<Application | null | undefined>(undefined);
  const wallet = item.wallet.toLowerCase();
  useEffect(() => {
    let active = true;
    if (ledger) void Promise.resolve().then(() => Promise.all([ledger.isApproved(item.wallet), ledger.balanceOf(item.wallet)])).then(([approved, units]) => { if (active) setChain({ approved, units }); }).catch(() => {});
    void requestRef.current<Application[]>({ action: 'applications' }).then(rows => { if (active) setApplication(rows.find(row => row.wallet.toLowerCase() === wallet && row.kind === 'investor') ?? null); }).catch(() => { if (active) setApplication(null); });
    return () => { active = false; };
  }, [ledger, item.wallet, wallet]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const amount = requestAmount(item);
  const supply = data?.totalSupply ?? 0n;
  const ownership = (units: bigint, total: bigint) => total > 0n ? `${(Number(units * 10_000n / total) / 100).toFixed(2)}%` : '—';
  const price = data && figures ? navPriceText(figures.navCents, data.totalSupply) : '—';
  const buyUnits = item.kind === 'subscription' ? unitsForAmount(amount, figures?.navCents, data?.totalSupply) : 0n;
  const after = chain && item.kind === 'subscription' ? ownership(chain.units + buyUnits, supply + buyUnits) : chain && item.kind === 'redemption' ? ownership(chain.units > amount ? chain.units - amount : 0n, supply) : '—';
  const history = requests.filter(row => row.wallet.toLowerCase() === wallet).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const kyc = (documents ?? []).filter(doc => doc.purpose === 'kyc' && application && doc.application_id === application.id);
  const proof = item.kind === 'subscription' ? latestProof(documents, doc => doc.purpose === 'subscription' && doc.fund_request_id === item.id) : undefined;
  const name = displayName(item.wallet) ?? application?.display_name ?? compactAddress(item.wallet);
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="invoice-modal" role="dialog" aria-modal="true" aria-labelledby="investor-details-title">
      <div className="section-heading"><div><span className="eyebrow">Investor</span><h2 id="investor-details-title">{name}</h2><p className="mono selectable-address">{item.wallet}</p></div><button className="btn outline" onClick={onClose}>Close</button></div>
      <section className="at-a-glance" aria-label="Investor at a glance">
        <p className="glance-sentence">{item.kind === 'subscription' ? <>Wants to <b>subscribe {formatMoney(amount)}</b>, about <b>{formatInteger(buyUnits)} RLU</b> at {price} per RLU (NAV).</> : <>Wants to <b>redeem {formatInteger(amount)} RLU</b>{data && figures ? <> worth about <b>{money(unitValueCents(amount, figures.navCents, data.totalSupply))}</b> at {price} per RLU (NAV)</> : null}.</>} Ownership would become <b>{after}</b>.</p>
        <div className="glance-grid">
          <div><span>Approved on-chain</span><strong>{chain === null ? '…' : chain.approved ? 'Yes' : 'No'}</strong>{chain && !chain.approved && <small className="late">Cannot receive RLU</small>}</div>
          <div><span>RLU held</span><strong>{chain === null ? '…' : `${formatInteger(chain.units)} RLU`}</strong></div>
          <div><span>Holding value</span><strong>{chain && data && figures ? money(unitValueCents(chain.units, figures.navCents, data.totalSupply)) : '…'}</strong></div>
          <div><span>Ownership now</span><strong>{chain ? ownership(chain.units, supply) : '…'}</strong></div>
        </div>
      </section>
      {children}
      <h3>This request</h3>
      <dl className="detail-list">
        <div><dt>Request</dt><dd>{item.kind === 'subscription' ? `Subscribe ${formatMoney(amount)} (≈ ${formatInteger(buyUnits)} RLU at today’s NAV)` : `Redeem ${formatInteger(amount)} RLU`}</dd></div>
        <div><dt>Status</dt><dd>{STATUS_LABELS[item.status]}{item.manager_note ? ` · ${item.manager_note}` : ''}</dd></div>
        {item.tx_hash && <div><dt>Transaction</dt><dd><a className="tx-link" href={`${SEPOLIA_EXPLORER}/tx/${item.tx_hash}`} target="_blank" rel="noreferrer">View transaction</a></dd></div>}
        <div><dt>Requested</dt><dd>{new Date(item.created_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' })} SGT</dd></div>
        {item.kind === 'subscription' && <div><dt>Payment reference</dt><dd className="mono">{paymentReference(item.id)}</dd></div>}
        {item.kind === 'subscription' && item.status !== 'pending' && <div><dt>Payment proof</dt><dd>{proof ? <ProofStatus proof={proof} /> : 'Not uploaded yet'}</dd></div>}
      </dl>
      <h3>Application</h3>
      {application === undefined ? <p className="support-copy">Loading application…</p> : application === null ? <p className="notice warning">No investor application was found for this wallet.</p> : <dl className="detail-list">
        <div><dt>Name</dt><dd>{application.display_name}</dd></div>
        <div><dt>Application status</dt><dd>{application.status}</dd></div>
        <div><dt>Email</dt><dd>{application.contact_email}</dd></div>
        <div><dt>Phone</dt><dd>{application.contact_phone || '—'}</dd></div>
        <div><dt>Country</dt><dd>{application.details?.country || '—'}</dd></div>
        <div><dt>Applied</dt><dd>{new Date(application.submitted_at ?? application.created_at).toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium' })}</dd></div>
        <div><dt>KYC documents</dt><dd>{kyc.length ? `${kyc.filter(doc => doc.status === 'verified').length} of ${kyc.length} verified` : 'None uploaded'}</dd></div>
      </dl>}
      <h3>Request history</h3>
      {history.length ? <div className="table-scroll"><table><thead><tr><th>Request</th><th>Requested</th><th>Status</th></tr></thead>
        <tbody>{history.map(row => <tr key={row.id} className={row.id === item.id ? 'current-row' : ''}><td>{row.kind === 'subscription' ? `Subscribe ${formatMoney(requestAmount(row))}` : `Redeem ${formatInteger(requestAmount(row))} RLU`}{row.id === item.id && <small className="document-meta">This request</small>}</td>
          <td>{new Date(row.created_at).toLocaleDateString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium' })}</td><td>{STATUS_LABELS[row.status]}</td></tr>)}</tbody></table></div> : <p className="support-copy">No other requests.</p>}
    </section>
  </div>;
}
