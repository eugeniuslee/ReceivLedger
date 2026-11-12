import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from './RegistryContext';
import type { PageId } from '../chain/access';
import type { FundRequest, PrivateDocument } from '../../supabase/functions/_shared/domain';
import { useInvoiceReviews, type InvoiceReview } from './invoiceReviews';

/** Ticks every minute and whenever the tab regains focus, so private counts and notices stay current. */
export function useRefreshTick(intervalMs = 60_000) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => { if (document.visibilityState !== 'hidden') setTick(value => value + 1); };
    const timer = window.setInterval(bump, intervalMs);
    window.addEventListener('focus', bump);
    document.addEventListener('visibilitychange', bump);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', bump); document.removeEventListener('visibilitychange', bump); };
  }, [intervalMs]);
  return tick;
}

export interface Notice {
  key: string;
  tone: 'action' | 'info';
  title: string;
  message: string;
  page: PageId;
  actionLabel: string;
  at: number;
}

// Seen notices are remembered per wallet in this browser.
const listeners = new Set<() => void>();
const storeKey = (wallet: string) => `receivledger:notices:${wallet.toLowerCase()}`;
interface SeenState { since: number; seen: string[] }
function readSeen(wallet: string | null): SeenState | null {
  if (!wallet) return null;
  try { const value = JSON.parse(window.localStorage.getItem(storeKey(wallet)) ?? 'null'); return value && Array.isArray(value.seen) ? value : null; } catch { return null; }
}
function writeSeen(wallet: string, state: SeenState) {
  try { window.localStorage.setItem(storeKey(wallet), JSON.stringify({ since: state.since, seen: state.seen.slice(-200) })); } catch { /* applies until reload */ }
  listeners.forEach(listener => listener());
}

const time = (value: string | null | undefined) => value ? Date.parse(value) || 0 : 0;
const subscribeSeen = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** The notice key for an application decision, shared by the notice and the Home status box. */
export const applicationNoticeKey = (app: { id: string; version: number; status: string }) => `application:${app.id}:${app.version}:${app.status}`;

/**
 * True once the user has dismissed this notice, or when the decision is older than this browser's first visit
 * (those notices are never shown, so there is nothing left to dismiss).
 */
export function useNoticeDismissed(key: string | null, at: string | null | undefined) {
  const { account } = useLedger();
  const seen = useSyncExternalStore(subscribeSeen, () => JSON.stringify(readSeen(account)), () => 'null');
  const state = JSON.parse(seen) as SeenState | null;
  if (!key || !state) return false;
  return state.seen.includes(key) || time(at) <= state.since;
}

/** Turn the user's private records into notices about decisions the fund manager has made. */
export function buildNotices(input: { application: { id: string; status: string; version: number; review_note: string | null; reviewed_at: string | null; kind: string } | null; documents: PrivateDocument[]; requests: FundRequest[]; invoiceReviews?: readonly InvoiceReview[] }): Notice[] {
  const notices: Notice[] = [];
  const app = input.application;
  if (app && app.reviewed_at) {
    const base = { key: applicationNoticeKey(app), page: 'registration' as PageId, at: time(app.reviewed_at) };
    const note = app.review_note ? ` Manager’s note: “${app.review_note}”` : '';
    if (app.status === 'needs_info') notices.push({ ...base, tone: 'action', title: 'More information requested', message: `The fund manager needs more information for your application.${note} Update your details or upload documents, then resubmit.`, actionLabel: 'Update application' });
    if (app.status === 'rejected') notices.push({ ...base, tone: 'action', title: 'Application rejected', message: `Your application was not approved.${note} You can update it and resubmit.`, actionLabel: 'Review application' });
    if (app.status === 'approved') notices.push({ ...base, tone: 'info', title: 'Application approved', message: `Your ${app.kind === 'sme' ? 'SME' : 'investor'} application has been approved.${note}`, actionLabel: 'Open Home' , page: 'dashboard' });
    if (app.status === 'suspended' || app.status === 'revoked') notices.push({ ...base, tone: 'action', title: `Application ${app.status}`, message: `Your application has been ${app.status}.${note}`, actionLabel: 'Review application' });
  }
  for (const doc of input.documents) {
    if (doc.status === 'pending' || !doc.reviewed_at) continue;
    const what = doc.purpose === 'repayment' ? `Payment proof for invoice #${doc.invoice_id}` : doc.purpose === 'subscription' ? 'Payment proof for your subscription' : doc.purpose === 'invoice' ? `Invoice #${doc.invoice_id} PDF` : `Document “${doc.filename}”`;
    const page: PageId = doc.purpose === 'repayment' ? 'repayments' : doc.purpose === 'subscription' ? 'invest' : doc.purpose === 'invoice' ? 'invoices' : 'registration';
    const note = doc.review_note ? ` Manager’s note: “${doc.review_note}”` : '';
    notices.push(doc.status === 'rejected'
      ? { key: `document:${doc.id}:${doc.version}`, tone: 'action', title: `${what} rejected`, message: `Please upload a new file.${note}`, page, actionLabel: 'Upload again', at: time(doc.reviewed_at) }
      : { key: `document:${doc.id}:${doc.version}`, tone: 'info', title: doc.purpose === 'repayment' || doc.purpose === 'subscription' ? 'Payment confirmed' : `${what} verified`, message: `${what} has been verified.${note}`, page, actionLabel: 'View', at: time(doc.reviewed_at) });
  }
  for (const review of input.invoiceReviews ?? []) {
    if (review.status === 'info_provided') continue; // the SME has already answered
    const key = `invoice-review:${review.invoice_id}:${review.version}:${review.status}`;
    notices.push(review.status === 'needs_info'
      ? { key, tone: 'action', title: `More information requested for invoice #${review.invoice_id}`, message: `The fund manager needs more documents before approving it. Manager’s note: “${review.note}”`, page: 'invoices', actionLabel: 'Upload documents', at: time(review.decided_at) }
      : { key, tone: 'action', title: `Invoice #${review.invoice_id} rejected`, message: `The fund manager did not approve this invoice. Manager’s note: “${review.note}”`, page: 'invoices', actionLabel: 'View invoice', at: time(review.decided_at) });
  }
  for (const request of input.requests) {
    if (request.status === 'pending' || request.status === 'cancelled' || !request.decided_at) continue;
    const what = request.kind === 'subscription' ? `Subscription of S$${request.amount}` : `Redemption of ${request.amount} RLU`;
    const note = request.manager_note ? ` Manager’s note: “${request.manager_note}”` : '';
    const title = request.status === 'rejected' ? `${what} rejected` : request.status === 'completed' ? `${what} completed` : `${what} approved`;
    notices.push({ key: `request:${request.id}:${request.version}`, tone: request.status === 'rejected' ? 'action' : 'info', title, message: `${request.status === 'completed' && request.kind === 'subscription' ? 'Your RLU has been issued.' : request.status === 'approved' && request.kind === 'subscription' ? 'Please make your payment so the fund manager can issue your RLU.' : ''}${note}`.trim(), page: 'invest', actionLabel: 'View requests', at: time(request.decided_at) });
  }
  return notices.sort((a, b) => b.at - a.at);
}

/** Manager: payment proofs uploaded by SMEs (repayments) and investors (subscriptions) that need checking. */
export function buildManagerNotices(documents: PrivateDocument[], requests: FundRequest[], nameOf: (wallet: string) => string | null, invoiceReviews: readonly InvoiceReview[] = []): Notice[] {
  const answered: Notice[] = invoiceReviews.filter(review => review.status === 'info_provided').map(review => ({
    key: `invoice-review:${review.invoice_id}:${review.version}:info_provided`, tone: 'action' as const, title: `${nameOf(review.sme_wallet) ?? 'The SME'} sent more documents for invoice #${review.invoice_id}`,
    message: 'You asked for more information. Review the new documents, then approve or reject the invoice.', page: 'invoices' as PageId, actionLabel: 'Review', at: time(review.responded_at) }));
  const wallets = new Map(requests.map(request => [request.id, request.wallet]));
  return documents.filter(doc => doc.status === 'pending' && (doc.purpose === 'repayment' || doc.purpose === 'subscription')).map((doc): Notice => {
    if (doc.purpose === 'repayment') return { key: `proof:${doc.id}:${doc.version}`, tone: 'action' as const, title: `Repayment proof received for invoice #${doc.invoice_id}`,
      message: 'An SME says it has repaid. Check the proof, then accept it to record the repayment.', page: 'invoices' as PageId, actionLabel: 'Review', at: time(doc.created_at) };
    const wallet = doc.fund_request_id ? wallets.get(doc.fund_request_id) : undefined;
    const who = wallet ? nameOf(wallet) ?? `${wallet.slice(0, 7)}...${wallet.slice(-5)}` : 'An investor';
    return { key: `proof:${doc.id}:${doc.version}`, tone: 'action' as const, title: `Subscription payment proof from ${who}`,
      message: 'Check the payment proof, then accept it to issue the RLU.', page: 'funds' as PageId, actionLabel: 'Review', at: time(doc.created_at) };
  }).concat(answered).sort((a, b) => b.at - a.at);
}

/**
 * Notices for applicants, investors and SMEs; payment proofs to check for the fund manager. Action-required notices stay until dismissed;
 * informational ones only appear for decisions made after this browser first saw the wallet.
 */
export function useNotices() {
  const { account, role } = useLedger();
  const { authenticated, application, request, reload, displayName } = useRegistry();
  const requestRef = useRef(request); requestRef.current = request;
  const reloadRef = useRef(reload); reloadRef.current = reload;
  const { reviews: invoiceReviews, reload: reloadReviews } = useInvoiceReviews();
  const reloadReviewsRef = useRef(reloadReviews); reloadReviewsRef.current = reloadReviews;
  const tick = useRefreshTick();
  const [documents, setDocuments] = useState<PrivateDocument[]>([]);
  const [requests, setRequests] = useState<FundRequest[]>([]);
  const enabled = Boolean(account && authenticated);
  const manager = role === 'manager';
  useEffect(() => {
    if (!enabled) { setDocuments([]); setRequests([]); return; }
    let active = true;
    if (tick > 0 && !manager) void reloadRef.current().catch(() => {});
    if (tick > 0) void reloadReviewsRef.current();
    void requestRef.current<PrivateDocument[]>({ action: 'documents' }).then(rows => { if (active) setDocuments(rows); }).catch(() => {});
    void requestRef.current<FundRequest[]>({ action: 'fund_requests' }).then(rows => { if (active) setRequests(rows); }).catch(() => {});
    return () => { active = false; };
  }, [enabled, manager, account, tick]);
  const seen = useSyncExternalStore(subscribeSeen, () => JSON.stringify(readSeen(account)), () => 'null');
  const state = JSON.parse(seen) as SeenState | null;
  useEffect(() => { if (account && enabled && !state) writeSeen(account, { since: Date.now(), seen: [] }); }, [account, enabled, state]);
  const reviewRows = [...invoiceReviews.values()];
  const all = !enabled ? [] : manager ? buildManagerNotices(documents, requests, displayName, reviewRows) : buildNotices({ application, documents, requests, invoiceReviews: reviewRows });
  const unread = state ? all.filter(notice => !state.seen.includes(notice.key) && (notice.tone === 'action' || notice.at > state.since)) : [];
  const dismiss = useCallback((key: string) => { if (!account) return; const current = readSeen(account) ?? { since: Date.now(), seen: [] }; writeSeen(account, { ...current, seen: [...current.seen, key] }); }, [account]);
  return { unread, dismiss };
}

/** Banner listing unread notices, with a link to act on each. */
export function NoticeBanner({ unread, dismiss, onNavigate }: { unread: Notice[]; dismiss: (key: string) => void; onNavigate: (page: PageId) => void }) {
  if (!unread.length) return null;
  return <section className="notice-stack" aria-label="Notifications">{unread.slice(0, 3).map(notice => <div key={notice.key} className={`notice ${notice.tone === 'action' ? 'warning' : 'info'} notice-item`} role="status">
    <div><b>{notice.title}</b>{notice.message && <p>{notice.message}</p>}</div>
    <span className="form-row"><button className="btn small" onClick={() => { onNavigate(notice.page); }}>{notice.actionLabel}</button><button className="btn o small" onClick={() => dismiss(notice.key)}>Dismiss</button></span>
  </div>)}{unread.length > 3 && <p className="footnote">+{unread.length - 3} more notification(s)</p>}</section>;
}
