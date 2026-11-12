import type { ChainEvent, ChainInvoice } from '../chain/chainLedger';
import { calculateFinancing, financedInvoiceCharges, fundNav, termsAt } from '../../supabase/functions/_shared/financing';
export * from '../../supabase/functions/_shared/financing';

/** Confirmed InvoiceFinanced / InvoiceRepaid block times by invoice ID. */
export function lifecycleTimes(events: readonly ChainEvent[]) {
  const financedAt = new Map<string, bigint>(), repaidAt = new Map<string, bigint>();
  for (const event of events) {
    if (event.invoiceId === undefined || !event.timestamp) continue;
    const key = event.invoiceId.toString(), at = BigInt(event.timestamp);
    // Keep the latest confirmed event of each kind.
    if (event.name === 'InvoiceFinanced' && (financedAt.get(key) ?? -1n) < at) financedAt.set(key, at);
    if (event.name === 'InvoiceRepaid' && (repaidAt.get(key) ?? -1n) < at) repaidAt.set(key, at);
  }
  return { financedAt, repaidAt };
}

/** NAV for the invoice ledger, which stores whole-S$ amounts. */
export function ledgerNav(snapshot: { availableFunds: bigint; invoices: readonly ChainInvoice[] }, events: readonly ChainEvent[], asOf: bigint) {
  return fundNav({
    availableFundsCents: snapshot.availableFunds * 100n,
    invoices: snapshot.invoices.map(invoice => ({ id: invoice.id, invoiceCents: invoice.amount * 100n, dueDate: invoice.maturity, financed: invoice.status === 'Financed', repaid: invoice.status === 'Repaid' })),
    ...lifecycleTimes(events),
    asOf,
  });
}

export interface InvoiceIncomeRow {
  invoice: ChainInvoice;
  financedAt: bigint | null;
  repaidAt: bigint | null;
  advanceCents: bigint;
  serviceFeeCents: bigint;
  interestCents: bigint;
  /** Service fee + interest: what the fund earns on this invoice. */
  profitCents: bigint;
  days: bigint | null;
  /** Amount this invoice adds to NAV today. */
  navContributionCents: bigint;
  datesPending: boolean;
}

/** Per-invoice income for financed and repaid invoices (newest first), using the same rules as ledgerNav. */
export function invoiceIncome(invoices: readonly ChainInvoice[], events: readonly ChainEvent[], asOf: bigint): InvoiceIncomeRow[] {
  const { financedAt, repaidAt } = lifecycleTimes(events);
  return invoices.filter(invoice => invoice.status === 'Financed' || invoice.status === 'Repaid').slice().reverse().map(invoice => {
    const key = invoice.id.toString(), repaid = invoice.status === 'Repaid';
    const financed = financedAt.get(key) ?? null, settled = repaid ? repaidAt.get(key) ?? null : null;
    const cents = invoice.amount * 100n;
    const datesPending = financed === null || (repaid && settled === null);
    const charges = datesPending
      ? calculateFinancing(cents, 0n, termsAt(financed ?? asOf))
      : financedInvoiceCharges({ invoiceCents: cents, dueDate: invoice.maturity, financedAt: financed!, repaidAt: settled }, asOf);
    const profitCents = charges.serviceFeeCents + charges.interestCents;
    return { invoice, financedAt: financed, repaidAt: settled, advanceCents: charges.advanceCents, serviceFeeCents: charges.serviceFeeCents,
      interestCents: charges.interestCents, profitCents, days: datesPending ? null : charges.days, datesPending,
      navContributionCents: repaid ? profitCents : cents + profitCents };
  });
}
