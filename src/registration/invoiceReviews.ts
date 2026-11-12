import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useRegistry } from './RegistryContext';
import type { InvoiceReview } from '../../supabase/functions/_shared/domain';

export type { InvoiceReview };
type Reviews = ReadonlyMap<string, InvoiceReview>;

/**
 * Off-chain invoice decisions (rejected / more information requested), shared by every page that shows invoices.
 * The fund manager sees all of them; an SME sees only its own. Signed-out users see none.
 */
const EMPTY: Reviews = new Map();
let current: Reviews = EMPTY;
const listeners = new Set<() => void>();
const publish = (next: Reviews) => { current = next; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function setInvoiceReviewsForTest(rows: readonly InvoiceReview[]) { publish(new Map(rows.map(row => [row.invoice_id, row]))); }

export function useInvoiceReviews() {
  const { authenticated, request } = useRegistry();
  const requestRef = useRef(request); requestRef.current = request;
  const reviews = useSyncExternalStore(subscribe, () => current, () => EMPTY);
  const reload = useCallback(async () => {
    if (!authenticated) { if (current.size) publish(EMPTY); return; }
    try {
      const rows = await requestRef.current<InvoiceReview[]>({ action: 'invoice_reviews' });
      if (Array.isArray(rows)) publish(new Map(rows.map(row => [row.invoice_id, row])));
    } catch { /* keep the last known decisions */ }
  }, [authenticated]);
  useEffect(() => { void reload(); }, [reload]);
  return { reviews, reload };
}

/** Plain label for an off-chain decision on a still-Submitted invoice. */
export const REVIEW_LABELS: Record<InvoiceReview['status'], string> = {
  needs_info: 'More information requested',
  info_provided: 'SME sent more documents',
  rejected: 'Rejected by fund manager',
};

/** Off-chain decisions only apply while the invoice is still Submitted on-chain. */
export function activeReview(reviews: Reviews, invoice: { id: bigint; status: string }) {
  return invoice.status === 'Submitted' ? reviews.get(invoice.id.toString()) : undefined;
}
