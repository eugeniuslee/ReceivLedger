import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLedger } from './LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { useFinance } from '../finance/FinanceContext';
import { useFundRequests } from '../registration/fundRequests';
import { useRefreshTick } from '../registration/notifications';
import { useInvoiceReviews, type InvoiceReview } from '../registration/invoiceReviews';
import { DAY } from '../finance/models';
import type { PageId } from './access';
import type { ChainInvoice } from './chainLedger';
import type { Application, FundRequest, PrivateDocument } from '../../supabase/functions/_shared/domain';

export interface ReviewCounts {
  /** Pending applications; null until the manager wallet is signed in. */
  applications: number | null;
  /** Pending RLU subscription / redemption requests; null until the manager wallet is signed in. */
  subscriptions: number | null;
  redemptions: number | null;
  invoicesToApprove: number;
  invoicesToFinance: number;
  overdue: number;
  dueSoon: number;
  smesWithOverdue: number;
  /** Repayment proofs awaiting manager review; null until the manager wallet is signed in. */
  repaymentProofs: number | null;
  /** Tab badge counts. */
  badges: Partial<Record<PageId, number>>;
}

const empty: ReviewCounts = { applications: null, subscriptions: null, redemptions: null, invoicesToApprove: 0, invoicesToFinance: 0, overdue: 0, dueSoon: 0, smesWithOverdue: 0, repaymentProofs: null, badges: {} };
const ReviewCountsContext = createContext<ReviewCounts>(empty);
export const useReviewCounts = () => useContext(ReviewCountsContext);

/** Invoice work for a set of invoices at time `now`. */
export function invoiceWork(invoices: readonly ChainInvoice[], now: bigint, reviews: ReadonlyMap<string, InvoiceReview> = new Map()) {
  const financed = invoices.filter(invoice => invoice.status === 'Financed');
  const overdueInvoices = financed.filter(invoice => invoice.maturity < now);
  const submitted = invoices.filter(invoice => invoice.status === 'Submitted');
  const reviewOf = (invoice: ChainInvoice) => reviews.get(invoice.id.toString())?.status;
  return {
    // Rejected invoices and ones waiting on the SME's documents are not the manager's move.
    invoicesToApprove: submitted.filter(invoice => reviewOf(invoice) !== 'rejected' && reviewOf(invoice) !== 'needs_info').length,
    /** SME: invoices where the fund manager asked for more information. */
    invoicesNeedingInfo: submitted.filter(invoice => reviewOf(invoice) === 'needs_info').length,
    invoicesToFinance: invoices.filter(invoice => invoice.status === 'Approved' && invoice.maturity > now).length,
    overdue: overdueInvoices.length,
    dueSoon: financed.filter(invoice => invoice.maturity >= now && invoice.maturity <= now + 7n * DAY).length,
    smesWithOverdue: new Set(overdueInvoices.map(invoice => invoice.sme.toLowerCase())).size,
  };
}

/** Applications needing the manager: new or resubmitted applications, or ones with newly uploaded KYC documents. */
export function applicationsNeedingReview(applications: readonly Application[], documents: readonly PrivateDocument[]) {
  const withNewDocuments = new Set(documents.filter(doc => doc.purpose === 'kyc' && doc.status === 'pending' && doc.application_id).map(doc => doc.application_id!));
  return applications.filter(app => app.status === 'pending' || (app.status === 'needs_info' && withNewDocuments.has(app.id)));
}

/**
 * Fund requests the manager can act on now. An approved subscription waits on the investor until they
 * upload a payment proof; it needs the manager again once a proof arrives (check it) or is accepted (issue RLU).
 */
export function fundRequestsNeedingManager(requests: readonly FundRequest[], documents: readonly PrivateDocument[]) {
  const latestProof = new Map<string, PrivateDocument>();
  for (const doc of documents) {
    if (doc.purpose !== 'subscription' || !doc.fund_request_id) continue;
    const current = latestProof.get(doc.fund_request_id);
    if (!current || doc.created_at > current.created_at) latestProof.set(doc.fund_request_id, doc);
  }
  return requests.filter(request => {
    if (request.status === 'pending') return true;
    if (request.status !== 'approved') return false;
    if (request.kind === 'redemption') return true; // approved redemption: the manager pays and settles it
    const proof = latestProof.get(request.id);
    return proof !== undefined && proof.status !== 'rejected';
  });
}

/** Manager only: the private review queue, refreshed every minute and when the tab regains focus. */
function useManagerQueue(enabled: boolean, tick: number) {
  const { authenticated, request } = useRegistry();
  const requestRef = useRef(request); requestRef.current = request;
  const [queue, setQueue] = useState<{ applications: number | null; proofs: number | null; documents: PrivateDocument[] }>({ applications: null, proofs: null, documents: [] });
  useEffect(() => {
    if (!enabled || !authenticated || !requestRef.current) { setQueue({ applications: null, proofs: null, documents: [] }); return; }
    let active = true;
    void Promise.all([requestRef.current<Application[]>({ action: 'applications' }), requestRef.current<PrivateDocument[]>({ action: 'documents' })])
      .then(([applications, documents]) => { if (active) setQueue({
        applications: applicationsNeedingReview(applications, documents).length,
        proofs: documents.filter(doc => doc.purpose === 'repayment' && doc.status === 'pending').length,
        documents,
      }); })
      .catch(() => { /* keep the last known counts */ });
    return () => { active = false; };
  }, [enabled, authenticated, tick]);
  return queue;
}

export function ReviewCountsProvider({ children }: { children: ReactNode }) {
  const { role, snapshot } = useLedger();
  const { now } = useFinance();
  const manager = role === 'manager';
  const tick = useRefreshTick();
  const { applications, proofs: repaymentProofs, documents } = useManagerQueue(manager, tick);
  const { requests, reload: reloadRequests } = useFundRequests();
  useEffect(() => { if (manager && tick > 0) void reloadRequests(); }, [manager, tick, reloadRequests]);
  const actionable = manager && requests ? fundRequestsNeedingManager(requests, documents) : null;
  const pending = (kind: 'subscription' | 'redemption') => actionable ? actionable.filter(item => item.kind === kind).length : null;
  const invoices = snapshot && (snapshot.role === 'manager' || snapshot.role === 'sme') ? snapshot.invoices : [];
  const { reviews } = useInvoiceReviews();
  const work = invoiceWork(invoices, now, reviews);
  const subscriptions = pending('subscription'), redemptions = pending('redemption');
  const badges: Partial<Record<PageId, number>> = manager
    ? { invoices: work.invoicesToApprove + work.invoicesToFinance + work.overdue + (repaymentProofs ?? 0), applications: applications ?? 0, funds: (subscriptions ?? 0) + (redemptions ?? 0), smes: work.smesWithOverdue }
    : role === 'sme' ? { repayments: work.overdue + work.dueSoon, invoices: work.invoicesNeedingInfo } : {};
  return <ReviewCountsContext.Provider value={{ ...work, applications, subscriptions, redemptions, repaymentProofs, badges }}>{children}</ReviewCountsContext.Provider>;
}
