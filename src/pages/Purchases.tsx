import { useEffect, useRef, useState } from 'react';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { PrivateAccess } from '../components/PrivateAccess';
import { WalletName } from '../components/WalletName';
import { money } from '../finance/models';
import { userFacingError } from '../errors';
import { MAX_PDF_BYTES } from '../../supabase/functions/_shared/domain';
import type { PurchaseRequest } from '../../supabase/functions/_shared/purchases';
import { PURCHASE_PRICING_BASIS, isPurchasePricing, purchaseAmountCents, purchaseHasPriceMismatch } from '../../supabase/functions/_shared/purchasePricing';

const statusNames: Record<PurchaseRequest['status'], string> = {
  draft: 'Awaiting payment proof', pending: 'Awaiting review', approved: 'Approved · awaiting issuance',
  rejected: 'Rejected', fulfilled: 'Tokens issued',
};
const createdDate = (value: string) => new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeZone: 'Asia/Singapore' }).format(new Date(value));
const serviceUpdateMessage = 'Purchase requests are not available on this server yet. Ask the project owner to update the purchase service, then refresh requests.';
const pricingUpdateMessage = 'Purchase pricing needs a server update before you can continue. You can still view existing requests. Refresh requests after the update.';
function calculatedPayment(units: string) {
  try { return purchaseAmountCents(units); } catch { return null; }
}
function requestStatus(request: PurchaseRequest) {
  if (purchaseHasPriceMismatch(request) && !['fulfilled', 'rejected'].includes(request.status)) return 'Amount needs review';
  return request.status === 'draft' && request.proof_filename ? 'Ready to submit' : statusNames[request.status];
}
function purchaseError(cause: unknown) {
  const message = userFacingError(cause);
  return /^Unknown action\.?$/i.test(message) ? serviceUpdateMessage : message;
}

export function Purchases({ onInvestors }: { onInvestors?: () => void }) {
  const { account, role, snapshot, walletEpoch, networkOk, isV2Manager } = useLedger();
  const { isManager } = useRegistry();
  const scope = `${account}:${walletEpoch}:${networkOk}:${isManager}`;
  const needsManagerAccess = !isManager && (role === 'manager' || isV2Manager && role !== 'investor' && role !== 'inactiveInvestor');
  const knownDifferentManager = needsManagerAccess && isV2Manager && role !== 'manager' && account && snapshot?.manager
    && snapshot.manager.toLowerCase() !== account.toLowerCase();
  // Public contract evidence is enough to explain a wrong manager wallet;
  // private authentication remains required before any purchase records load.
  if (knownDifferentManager) return <PurchaseManagerAccess key={scope} />;
  return <PrivateAccess>{needsManagerAccess
    ? <PurchaseManagerAccess key={scope} />
    : <PurchaseRequestsPanel key={scope} onInvestors={onInvestors} />}</PrivateAccess>;
}

function PurchaseManagerAccess() {
  const { account, snapshot, isV2Manager } = useLedger();
  const { reload, busy, authenticated } = useRegistry();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const mounted = useRef(true), inFlight = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function recheck() {
    if (inFlight.current) return;
    inFlight.current = true; setChecking(true); setError(''); setMessage('');
    try {
      await reload();
      if (mounted.current) setMessage('Manager access rechecked.');
    } catch (cause) {
      if (mounted.current) setError(userFacingError(cause, 'Manager access could not be checked. Please try again.'));
    } finally {
      inFlight.current = false;
      if (mounted.current) setChecking(false);
    }
  }
  return <section className="section-block">
    <h2>RLU purchase manager access required</h2>
    {isV2Manager && <p className="support-copy">This wallet is recognised as the RLU2 fund owner. These purchase requests belong to the separate RLU fund.</p>}
    <p className="notice warning" role="alert">{authenticated ? 'Your signed wallet session is not authorised to review other investors’ RLU purchase requests.' : 'Your connected wallet does not match the RLU fund manager.'} Viewing and accepting them requires the RLU fund manager wallet.</p>
    {account && <p>Connected wallet: <code>{account}</code></p>}
    {snapshot?.manager && <p>RLU fund manager wallet: <code>{snapshot.manager}</code></p>}
    <p>Connect the RLU fund manager wallet in MetaMask and sign in with that wallet. If you are already using it, recheck manager access.</p>
    {authenticated && <button className="btn outline" disabled={checking || busy} onClick={() => void recheck()}>{checking ? 'Checking manager access…' : 'Recheck manager access'}</button>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}

export function PurchaseRequestsPanel({ onInvestors }: { onInvestors?: () => void }) {
  const { account, role, networkOk } = useLedger();
  const { request, isManager } = useRegistry();
  const [rows, setRows] = useState<PurchaseRequest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [units, setUnits] = useState('');
  const [note, setNote] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [txHash, setTxHash] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [serviceReady, setServiceReady] = useState(false);
  const [pricingReady, setPricingReady] = useState(false);
  const [pricingUnavailable, setPricingUnavailable] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const mounted = useRef(true), inFlight = useRef(false), loadVersion = useRef(0);
  const requestRef = useRef(request); requestRef.current = request;
  const draftId = useRef<string | null>(null);
  const nextOffset = useRef(0);
  const selected = rows.find(row => row.id === selectedId);
  const canCreate = !isManager && role === 'investor' && networkOk;
  const owns = selected?.wallet.toLowerCase() === account?.toLowerCase();
  const paymentCents = calculatedPayment(units);
  const paymentDisplay = paymentCents === null ? '' : `${BigInt(paymentCents) / 100n}.${String(BigInt(paymentCents) % 100n).padStart(2, '0')}`;
  const selectedMismatch = selected ? purchaseHasPriceMismatch(selected) : false;
  const selectedExpectedCents = selected ? calculatedPayment(selected.units) : null;
  const pricingBlocked = loading || !serviceReady || !pricingReady;
  const canRejectMismatch = selectedMismatch && selected && ['draft', 'pending', 'approved'].includes(selected.status);

  function requirePricing() {
    if (pricingBlocked) throw new Error(pricingUpdateMessage);
    if (selectedMismatch) throw new Error('This request has a payment mismatch. Resolve the original payment with the fund manager before creating a replacement.');
  }

  function save(row: PurchaseRequest) {
    if (!mounted.current) return;
    loadVersion.current++; setLoading(false);
    setRows(previous => [row, ...previous.filter(item => item.id !== row.id)]);
    setSelectedId(row.id);
  }
  async function load(append = false) {
    const version = ++loadVersion.current;
    setLoading(true); setPricingReady(false); setPricingUnavailable(false);
    try {
      const offset = append ? nextOffset.current : 0;
      const [history, pricing] = await Promise.allSettled([
        requestRef.current<PurchaseRequest[]>({ action: 'purchase_list', offset }),
        requestRef.current<unknown>({ action: 'purchase_pricing' }),
      ]);
      if (mounted.current && version === loadVersion.current) {
        const ready = pricing.status === 'fulfilled' && isPurchasePricing(pricing.value);
        setPricingReady(ready);
        if (history.status === 'rejected') throw history.reason;
        const result = history.value;
        if (!Array.isArray(result)) throw new Error('Purchase requests could not be loaded.');
        setPricingUnavailable(!ready);
        setServiceReady(true);
        setRows(previous => append ? [...new Map([...previous, ...result].map(row => [row.id, row])).values()] : result);
        nextOffset.current = offset + result.length; setHasMore(result.length === 50);
        const recovered = result.find(row => row.id === draftId.current);
        if (recovered) {
          setSelectedId(recovered.id); draftId.current = null; setUnits(''); setNote('');
          setMessage('Your saved request was recovered. Continue from its current status below.');
        }
      }
    } catch (cause) {
      if (mounted.current && version === loadVersion.current) { setServiceReady(false); setError(purchaseError(cause)); }
    } finally { if (mounted.current && version === loadVersion.current) setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; loadVersion.current++; };
  }, []);
  async function perform(operation: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setMessage('');
    try { await operation(); }
    catch (cause) { if (mounted.current) { const message = purchaseError(cause); setError(message); if (message === serviceUpdateMessage) setServiceReady(false); } }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  function select(id: string) { setSelectedId(id); setFile(null); setReviewNote(''); setTxHash(''); setError(''); setMessage(''); }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    await perform(async () => {
      if (!canCreate) throw new Error('An approved investor wallet on Sepolia is required.');
      if (!serviceReady) throw new Error('Refresh requests to check that the purchase service is available.');
      if (!pricingReady || loading) throw new Error(pricingUpdateMessage);
      purchaseAmountCents(units);
      draftId.current ??= crypto.randomUUID();
      const row = await requestRef.current<PurchaseRequest>({ action: 'purchase_create', id: draftId.current, units, pricing_basis: PURCHASE_PRICING_BASIS, note: note.trim() });
      if (!mounted.current) return;
      save(row); draftId.current = null; setUnits(''); setNote(''); setFile(null);
      setMessage('Request saved. Attach your payment proof, then submit it for review.');
    });
  }
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    await perform(async () => {
      if (!selected || !owns) throw new Error('Select your own request.');
      requirePricing();
      if (!file || !file.name.toLowerCase().endsWith('.pdf') || !file.size || file.size > MAX_PDF_BYTES) throw new Error('Choose a PDF up to 5 MB.');
      const body = new FormData();
      body.set('action', 'purchase_upload'); body.set('request_id', selected.id); body.set('version', String(selected.version)); body.set('file', file);
      save(await requestRef.current<PurchaseRequest>(body));
      if (mounted.current) { setFile(null); form.reset(); setMessage('Payment proof attached privately. You can now submit the request.'); }
    });
  }
  async function submit() {
    await perform(async () => {
      if (!selected || !owns) throw new Error('Select your own request.');
      requirePricing();
      save(await requestRef.current<PurchaseRequest>({ action: 'purchase_submit', id: selected.id, version: selected.version }));
      if (mounted.current) setMessage('Purchase request submitted to the fund manager.');
    });
  }
  async function download() {
    await perform(async () => {
      if (!selected) return;
      const blob = await requestRef.current<Blob>({ action: 'purchase_download', id: selected.id });
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = selected.proof_filename ?? 'payment-proof.pdf'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  async function review(decision: 'approved' | 'rejected') {
    await perform(async () => {
      if (!selected || !isManager) return;
      if (decision === 'approved') requirePricing();
      if (!reviewNote.trim()) throw new Error('Enter a review note for the investor.');
      save(await requestRef.current<PurchaseRequest>({ action: 'purchase_review', id: selected.id, version: selected.version, decision, note: reviewNote.trim() }));
      if (mounted.current) setMessage(decision === 'approved' ? 'Request approved. Token issuance is the next step.' : 'Request rejected. The investor can see your note.');
    });
  }
  async function fulfill(event: React.FormEvent) {
    event.preventDefault();
    await perform(async () => {
      if (!selected || !isManager) return;
      requirePricing();
      if (!/^0x[\da-f]{64}$/i.test(txHash.trim())) throw new Error('Enter the confirmed issuance transaction hash.');
      save(await requestRef.current<PurchaseRequest>({ action: 'purchase_fulfill', id: selected.id, version: selected.version, tx_hash: txHash.trim() }));
      if (mounted.current) setMessage('Issuance receipt verified. This purchase request is complete.');
    });
  }

  return <div className="purchase-workspace">
    <section className="section-block"><div className="section-heading"><div><h2>{isManager ? 'Purchase requests' : 'Buy RLU'}</h2><p className="support-copy">{isManager ? 'Review investor contributions to the pool, check payment evidence, then record token issuance.' : 'Invest in the pool that funds SME invoices. Choose your RLU quantity and review the required payment.'}</p></div><button className="btn o small" disabled={busy || loading} onClick={() => void perform(() => load())}>{loading ? 'Loading…' : 'Refresh requests'}</button></div>
      <p className="footnote">Payment proof is private to the investor and fund manager. Uploading a file does not transfer money or issue tokens.</p>
      {pricingUnavailable && <p className="notice warning" role="alert">{pricingUpdateMessage}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice info" role="status">{message}</p>}
    </section>
    {canCreate && <section className="section-block"><h3>1. Choose RLU quantity</h3><form onSubmit={event => void create(event)} className="registration-form"><fieldset disabled={busy}><div className="form-row">
      <label>Requested RLU<input required readOnly={Boolean(draftId.current)} inputMode="numeric" value={units} onChange={event => setUnits(event.target.value)} placeholder="100" /></label>
      <label>Required payment (S$)<input readOnly aria-describedby="purchase-rate" value={paymentDisplay} placeholder="0.00" /></label>
      </div><label>Note to fund manager (optional)<textarea readOnly={Boolean(draftId.current)} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>
      {draftId.current && error && <p className="support-copy">Retrying uses the same request details. Use Refresh requests to recover a request saved before a connection failure.</p>}
      <p className="support-copy" id="purchase-rate">S$1.00 per RLU. Your required payment is calculated automatically.</p><button className="btn" type="submit" disabled={pricingBlocked}>Continue to payment proof</button></fieldset></form></section>}
    {!isManager && !canCreate && <p className="notice info">Your existing requests remain available. New requests require an approved investor wallet on Sepolia.</p>}
    <section className="section-block"><h3>{isManager ? 'Review queue' : 'Your requests'}</h3>
      {loading && <p role="status">Loading purchase requests…</p>}
      {!loading && !rows.length && !error && <p className="empty-state compact">No purchase requests yet.</p>}
      {rows.length > 0 && <div className="table-scroll"><table><thead><tr><th>Created</th>{isManager && <th>Investor</th>}<th>RLU</th><th>Payment</th><th>Status</th><th /></tr></thead><tbody>{rows.map(row => <tr key={row.id}>
        <td>{createdDate(row.created_at)}</td>{isManager && <td><WalletName address={row.wallet} /></td>}<td>{row.units}</td><td>{money(BigInt(row.amount_cents))}</td><td><span className="status">{requestStatus(row)}</span></td><td><button className="btn o small" aria-label={`View request ${row.id}`} onClick={() => select(row.id)}>View request</button></td>
      </tr>)}</tbody></table></div>}
      {hasMore && <button className="btn o" disabled={busy || loading} onClick={() => void perform(() => load(true))}>Load older requests</button>}
    </section>
    {selected && <section className="section-block purchase-detail" aria-label="Purchase request details"><div className="section-heading"><h3>{selected.units} RLU · {requestStatus(selected)}</h3><button className="btn o small" onClick={() => setSelectedId(null)}>Close details</button></div>
      <dl className="detail-list"><div><dt>Investor wallet</dt><dd className="mono">{selected.wallet}</dd></div><div><dt>{selected.pricing_basis === PURCHASE_PRICING_BASIS ? 'Required payment' : 'Originally reported payment'}</dt><dd>{money(BigInt(selected.amount_cents))}</dd></div>{selected.note && <div><dt>Investor note</dt><dd>{selected.note}</dd></div>}{selected.review_note && <div><dt>Manager note</dt><dd>{selected.review_note}</dd></div>}</dl>
      {selectedMismatch && <div className="notice warning" role="status"><p>The original payment differs from the S$1.00-per-RLU rate.{selectedExpectedCents !== null && <> Expected payment: <strong>{money(BigInt(selectedExpectedCents))}</strong>.</>} The recorded amount is preserved.</p>{selected.status === 'approved' ? <><p><strong>This request was already approved. Check for existing token issuance before closing it.</strong></p><p>{isManager ? 'Check transaction history and preserve any existing issuance receipt.' : 'Ask the fund manager to check transaction history and preserve any existing issuance receipt.'} Do not issue tokens again or create a replacement until the payment and any existing token issuance have been reconciled.</p></> : canRejectMismatch && <p>{isManager ? 'Review the original payment and reject this request with a note.' : 'Ask the fund manager to review and reject this request.'} Resolve any existing payment or token issuance before creating a replacement.</p>}</div>}
      {selected.proof_filename ? <div className="purchase-proof"><strong>{selected.proof_filename}</strong><button className="btn o" disabled={busy} onClick={() => void download()}>Download payment proof</button></div> : <p>No payment proof attached.</p>}
      {owns && selected.status === 'draft' && !selected.proof_filename && !selectedMismatch && <form onSubmit={event => void upload(event)} className="registration-form"><h4>2. Attach payment proof</h4><label>Payment proof PDF<input type="file" accept="application/pdf,.pdf" required disabled={busy || pricingBlocked} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label><p className="support-copy">PDF only, up to 5 MB. Check the file before uploading; the attached evidence cannot be replaced.</p><button className="btn" disabled={busy || pricingBlocked || !file}>Upload payment proof</button></form>}
      {owns && selected.status === 'draft' && selected.proof_filename && <div className="purchase-next"><h4>3. Submit for review</h4><button className="btn" disabled={busy || !canCreate || pricingBlocked || selectedMismatch} onClick={() => void submit()}>Submit purchase request</button></div>}
      {isManager && (selected.status === 'pending' || canRejectMismatch) && <div className="purchase-next"><h4>Review payment evidence</h4><label>Review note<textarea maxLength={2000} value={reviewNote} disabled={busy} onChange={event => setReviewNote(event.target.value)} /></label><p className="support-copy">Check the payment against your records before approving. Approval does not issue tokens.</p><div className="v2-actions">{selected.status === 'pending' && <button className="btn" disabled={busy || pricingBlocked || selectedMismatch} onClick={() => void review('approved')}>Approve purchase request</button>}<button className="btn o" disabled={busy} onClick={() => void review('rejected')}>Reject request</button></div></div>}
      {selected.status === 'approved' && !selectedMismatch && <div className="purchase-next"><h4>Token issuance</h4>{isManager ? <><p>Issue {selected.units} RLU to the investor wallet above using Investor administration. If already issued, reuse that transaction receipt.</p>{onInvestors && <button className="btn o" disabled={busy || pricingBlocked} onClick={onInvestors}>Open investor administration</button>}<form className="registration-form" onSubmit={event => void fulfill(event)}><label>Issuance transaction hash<input required value={txHash} disabled={busy || pricingBlocked} onChange={event => setTxHash(event.target.value)} placeholder="0x…" /></label><p className="support-copy">The receipt must match this wallet and quantity and have two confirmations. If verification needs retrying, submit the same hash; do not issue again.</p><button className="btn" disabled={busy || pricingBlocked}>Verify issuance receipt</button></form></> : <p>Your request is approved. The fund manager will issue your tokens and attach the transaction receipt.</p>}</div>}
      {selected.issuance_tx_hash && <p><a href={`https://sepolia.etherscan.io/tx/${selected.issuance_tx_hash}`} target="_blank" rel="noreferrer">View token issuance transaction ↗</a></p>}
    </section>}
  </div>;
}
