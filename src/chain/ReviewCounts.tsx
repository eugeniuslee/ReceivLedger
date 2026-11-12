import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLedger } from './LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { useFinance } from '../finance/FinanceContext';
import { useFundRequests } from '../registration/fundRequests';
import { DAY } from '../finance/models';
import type { PageId } from './access';
import type { ChainInvoice } from './chainLedger';
import type { Application, PrivateDocument } from '../../supabase/functions/_shared/domain';

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
export function invoiceWork(invoices: readonly ChainInvoice[], now: bigint) {
  const financed = invoices.filter(invoice => invoice.status === 'Financed');
  const overdueInvoices = financed.filter(invoice => invoice.maturity < now);
  return {
    invoicesToApprove: invoices.filter(invoice => invoice.status === 'Submitted').length,
    invoicesToFinance: invoices.filter(invoice => invoice.status === 'Approved' && invoice.maturity > now).length,
    overdue: overdueInvoices.length,
    dueSoon: financed.filter(invoice => invoice.maturity >= now && invoice.maturity <= now + 7n * DAY).length,
    smesWithOverdue: new Set(overdueInvoices.map(invoice => invoice.sme.toLowerCase())).size,
  };
}

/** Manager only: repayment proofs SMEs have uploaded that still need checking. */
function usePendingProofs(enabled: boolean) {
  const { authenticated, request } = useRegistry();
  const requestRef = useRef(request); requestRef.current = request;
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || !authenticated || !requestRef.current) { setCount(null); return; }
    let active = true;
    requestRef.current<PrivateDocument[]>({ action: 'documents' })
      .then(rows => { if (active) setCount(rows.filter(row => row.purpose === 'repayment' && row.status === 'pending').length); })
      .catch(() => { if (active) setCount(null); });
    return () => { active = false; };
  }, [enabled, authenticated]);
  return count;
}

function usePendingApplications(enabled: boolean) {
  const { authenticated, request } = useRegistry();
  const requestRef = useRef(request); requestRef.current = request;
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled || !authenticated || !requestRef.current) { setCount(null); return; }
    let active = true;
    requestRef.current<Application[]>({ action: 'applications' })
      .then(rows => { if (active) setCount(rows.filter(row => row.status === 'pending').length); })
      .catch(() => { if (active) setCount(null); });
    return () => { active = false; };
  }, [enabled, authenticated]);
  return count;
}

export function ReviewCountsProvider({ children }: { children: ReactNode }) {
  const { role, snapshot } = useLedger();
  const { now } = useFinance();
  const manager = role === 'manager';
  const applications = usePendingApplications(manager);
  const repaymentProofs = usePendingProofs(manager);
  const { requests } = useFundRequests();
  const pending = (kind: 'subscription' | 'redemption') => manager && requests ? requests.filter(item => item.kind === kind && (item.status === 'pending' || item.status === 'approved')).length : null;
  const invoices = snapshot && (snapshot.role === 'manager' || snapshot.role === 'sme') ? snapshot.invoices : [];
  const work = invoiceWork(invoices, now);
  const subscriptions = pending('subscription'), redemptions = pending('redemption');
  const badges: Partial<Record<PageId, number>> = manager
    ? { invoices: work.invoicesToApprove + work.invoicesToFinance + work.overdue + (repaymentProofs ?? 0), applications: applications ?? 0, funds: (subscriptions ?? 0) + (redemptions ?? 0), smes: work.smesWithOverdue }
    : role === 'sme' ? { repayments: work.overdue + work.dueSoon, invoices: work.invoicesToFinance } : {};
  return <ReviewCountsContext.Provider value={{ ...work, applications, subscriptions, redemptions, repaymentProofs, badges }}>{children}</ReviewCountsContext.Provider>;
}
