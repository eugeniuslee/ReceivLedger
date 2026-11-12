import { useOptionalLedger } from '../chain/LedgerContext';
import { useFinance } from './FinanceContext';
import { ledgerNav } from './financing';

/** Fund NAV for any role. Uses public invoice lifecycle events, so investors see the same NAV as the manager. */
export function useFundNav() {
  const ledger = useOptionalLedger();
  const { data, now, loading, error, refresh } = useFinance();
  const events = ledger?.lifecycleEvents?.length ? ledger.lifecycleEvents : ledger?.events ?? [];
  const nav = data ? ledgerNav(data, events, now) : null;
  const navPerRluCents = data && nav && data.totalSupply > 0n ? (nav.navCents * 2n + data.totalSupply) / (data.totalSupply * 2n) : null;
  return { data, nav, navPerRluCents, now, loading, error, refresh };
}

/** Value of `units` RLU at today's NAV (exact share of NAV, rounded to the cent). */
export function unitValueCents(units: bigint, navCents: bigint, totalSupply: bigint) {
  return totalSupply > 0n ? (units * navCents * 2n + totalSupply) / (totalSupply * 2n) : 0n;
}
