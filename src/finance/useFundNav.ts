import { useOptionalLedger } from '../chain/LedgerContext';
import { useFinance } from './FinanceContext';
import { ledgerNav } from './financing';
import { useInvoiceCredits } from './credits';

/** Fund NAV for any role. Uses public invoice lifecycle events, so investors see the same NAV as the manager. */
export function useFundNav() {
  const ledger = useOptionalLedger();
  const { data, now, loading, error, refresh } = useFinance();
  const credits = useInvoiceCredits();
  const events = ledger?.lifecycleEvents?.length ? ledger.lifecycleEvents : ledger?.events ?? [];
  const nav = data ? ledgerNav(data, events, now, credits) : null;
  const navPerRluCents = data && nav && data.totalSupply > 0n ? (nav.navCents * 2n + data.totalSupply) / (data.totalSupply * 2n) : null;
  return { data, nav, navPerRluCents, now, loading, error, refresh, credits };
}

/** Value of `units` RLU at today's NAV (exact share of NAV, rounded to the cent). */
export function unitValueCents(units: bigint, navCents: bigint, totalSupply: bigint) {
  return totalSupply > 0n ? (units * navCents * 2n + totalSupply) / (totalSupply * 2n) : 0n;
}

/**
 * Dealing price: subscriptions and redemptions are priced at NAV per RLU. Before any RLU exists the price is S$1.0000.
 * Shown to 4 decimal places so small movements in NAV are visible.
 */
export function navPriceText(navCents: bigint | null | undefined, totalSupply: bigint | null | undefined) {
  if (navCents == null || totalSupply == null) return '—';
  if (totalSupply <= 0n || navCents <= 0n) return 'S$1.0000';
  // 4 decimals of dollars = 6 decimals of cents' hundredths; round half up.
  const scaled = (navCents * 10_000n * 2n + totalSupply * 100n) / (totalSupply * 100n * 2n);
  const whole = scaled / 10_000n, frac = (scaled % 10_000n).toString().padStart(4, '0');
  return `S$${whole.toLocaleString('en-SG')}.${frac}`;
}

/** Whole RLU a subscription of `amountDollars` buys at NAV (RLU has 0 decimals, so the fraction is not issued). */
export function unitsForAmount(amountDollars: bigint, navCents: bigint | null | undefined, totalSupply: bigint | null | undefined) {
  if (navCents == null || totalSupply == null || totalSupply <= 0n || navCents <= 0n) return amountDollars;
  return amountDollars * 100n * totalSupply / navCents;
}
