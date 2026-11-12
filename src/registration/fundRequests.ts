import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegistry } from './RegistryContext';
import { userFacingError } from '../errors';
import type { FundRequest, FundRequestKind } from '../../supabase/functions/_shared/domain';

export type { FundRequest, FundRequestKind };
export const isOpen = (request: FundRequest) => request.status === 'pending' || request.status === 'approved';
export const requestAmount = (request: FundRequest) => BigInt(request.amount);
export const STATUS_LABELS: Record<FundRequest['status'], string> = { pending: 'Pending review', approved: 'Approved', completed: 'Completed', rejected: 'Rejected', cancelled: 'Cancelled' };

/**
 * Subscription / redemption requests from the private registry. Investors get their own;
 * the fund manager gets everyone's. Nothing loads until the wallet is signed in.
 */
export function useFundRequests() {
  const { authenticated, request } = useRegistry();
  const requestRef = useRef(request); requestRef.current = request;
  const [requests, setRequests] = useState<FundRequest[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!authenticated) { setRequests(null); return; }
    setLoading(true); setError('');
    try { setRequests(await requestRef.current<FundRequest[]>({ action: 'fund_requests' })); }
    catch (cause) { setError(userFacingError(cause)); }
    finally { setLoading(false); }
  }, [authenticated]);
  useEffect(() => { void reload(); }, [reload]);
  const call = useCallback(async (input: Record<string, unknown>) => { await requestRef.current(input); await reload(); }, [reload]);
  return {
    requests, error, loading, reload, authenticated,
    create: (kind: FundRequestKind, amount: bigint) => call({ action: 'request_fund', kind, amount: amount.toString() }),
    cancel: (id: string) => call({ action: 'cancel_fund_request', id }),
    decide: (item: FundRequest, decision: 'approved' | 'rejected' | 'completed', note = '', txHash: string | null = null) =>
      call({ action: 'decide_fund_request', id: item.id, version: item.version, decision, note, tx_hash: txHash }),
  };
}
