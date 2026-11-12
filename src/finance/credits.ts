import { useEffect, useSyncExternalStore } from 'react';
import { registryClient } from '../registration/client';
import type { CreditStatus } from '../../supabase/functions/_shared/financing';
import type { InvoiceCredit } from '../../supabase/functions/_shared/domain';

export type { CreditStatus };
type Credits = ReadonlyMap<string, CreditStatus>;

/** Public bad-debt records (impaired / written-off invoices), shared by every page. No sign-in needed. */
const EMPTY: Credits = new Map();
let current: Credits = EMPTY;
let loadedAt = 0;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function toCreditMap(rows: readonly InvoiceCredit[]): Credits {
  return new Map(rows.map(row => [row.invoice_id, {
    stage: row.stage, expectedRecoveryBps: row.expected_recovery_bps,
    recoveredCents: BigInt(row.recovered_cents ?? 0), effectiveAt: BigInt(Math.floor(Date.parse(row.effective_at) / 1000)), version: row.version,
  }]));
}

/** Reload now (e.g. right after the manager changes a record). Safe to call when Supabase is not configured. */
export function refreshCredits(client = registryClient): Promise<void> {
  if (!client) return Promise.resolve();
  inFlight ??= (async () => {
    try {
      const { data, error } = await client.from('rl_invoice_credit').select('invoice_id,stage,expected_recovery_bps,recovered_cents,effective_at,version');
      if (!error && data) { current = toCreditMap(data as InvoiceCredit[]); loadedAt = Date.now(); listeners.forEach(listener => listener()); }
    } catch { /* keep the last known records */ } finally { inFlight = null; }
  })();
  return inFlight;
}

/** Test helper. */
export function setCreditsForTest(credits: Credits) { current = credits; loadedAt = Date.now(); listeners.forEach(listener => listener()); }

export function useInvoiceCredits(): Credits {
  const credits = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => current, () => EMPTY);
  useEffect(() => {
    if (Date.now() - loadedAt > 60_000) void refreshCredits();
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void refreshCredits(); }, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return credits;
}
