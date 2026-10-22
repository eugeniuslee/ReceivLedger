import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLedger } from '../chain/LedgerContext';
import type { FinancialSnapshot } from './models';

interface FinanceValue { data: FinancialSnapshot | null; loading: boolean; error: string | null; now: bigint; refresh: () => Promise<void> }
const FinanceContext = createContext<FinanceValue>({ data: null, loading: false, error: null, now: BigInt(Math.floor(Date.now() / 1000)), refresh: async () => {} });
export function FinanceProvider({ children }: { children: ReactNode }) {
  const { account, role, networkOk, ledger, snapshot } = useLedger();
  const key = account && role && networkOk ? `${account.toLowerCase()}:${role}` : '';
  const identity = useRef({ key, version: 0 });
  if (identity.current.key !== key) identity.current = { key, version: identity.current.version + 1 };
  const sequence = useRef(0);
  const [state, setState] = useState<{ key: string; version: number; data: FinancialSnapshot | null; loading: boolean; error: string | null } | null>(null);
  const [now, setNow] = useState(() => BigInt(Math.floor(Date.now() / 1000)));
  useEffect(() => { const timer = window.setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 60000); return () => window.clearInterval(timer); }, []);
  const refresh = useCallback(async () => {
    if (!key || !ledger || !account) return;
    const version = identity.current.version; const request = ++sequence.current;
    const current = () => version === identity.current.version && key === identity.current.key && request === sequence.current;
    setState(previous => ({ key, version, data: previous?.key === key && previous.version === version ? previous.data : null, loading: true, error: null }));
    try {
      const data = await ledger.readFinancialSnapshot(account);
      if (current()) setState({ key, version, data, loading: false, error: null });
    } catch (cause) {
      if (current()) setState(previous => ({ key, version, data: previous?.key === key ? previous.data : null, loading: false, error: (cause as Error).message }));
    }
  }, [key, ledger, account]);
  useEffect(() => { void refresh(); return () => { sequence.current++; }; }, [refresh, snapshot]);
  const visible = state?.key === key && state.version === identity.current.version ? state : null;
  return <FinanceContext.Provider value={{ data: key ? visible?.data ?? null : null, loading: visible?.loading ?? Boolean(key),
    error: visible?.error ?? null, now, refresh }}>{children}</FinanceContext.Provider>;
}
export function useFinance() { return useContext(FinanceContext); }
