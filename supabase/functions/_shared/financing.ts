/**
 * ReceivLedger invoice financing calculations, shared by the website and the
 * Edge Functions so both always use the same formulas. No imports: this file
 * must stay valid in both the Vite (browser) and Deno runtimes.
 *
 * Money is bigint cents. Each displayed component is rounded half-up to the cent
 * exactly once from unrounded inputs; totals are sums of the displayed parts so
 * a breakdown always adds up.
 */

export interface FinancingTerms {
  /** Stable identifier recorded with every calculation. */
  version: string;
  /** Unix seconds from which these terms apply to newly financed invoices. */
  effectiveFrom: number;
  advanceBps: number;        // 9000 = 90%
  serviceFeeBps: number;     // 10 = 0.1%
  annualInterestBps: number; // 500 = 5% p.a.
}

/**
 * Append-only. To change rates, add a new entry with a later effectiveFrom;
 * never edit an existing entry. Invoices keep the terms in force on the day they
 * were financed (or, for estimates, the day they are quoted), so historical
 * invoices do not change when rates are updated.
 */
export const FINANCING_TERMS: readonly FinancingTerms[] = Object.freeze([
  Object.freeze({ version: '2026-11-standard', effectiveFrom: 0, advanceBps: 9000, serviceFeeBps: 10, annualInterestBps: 500 }),
]);

export function termsAt(seconds: bigint | number, schedule: readonly FinancingTerms[] = FINANCING_TERMS): FinancingTerms {
  const at = Number(seconds);
  const applicable = schedule.filter(terms => terms.effectiveFrom <= at).sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0];
  if (!applicable) throw new Error('No financing terms apply to this date.');
  return applicable;
}

const BPS = 10_000n;
const DAY_SECONDS = 86_400n;
const SGT_OFFSET_SECONDS = 8n * 3_600n;
const MAX_DAYS = 36_500n;

function roundHalfUp(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) throw new Error('Invalid financing denominator.');
  if (numerator < 0n) throw new Error('Financing amounts cannot be negative.');
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Calendar day number in Singapore time. */
export function sgtDay(seconds: bigint) { return (seconds + SGT_OFFSET_SECONDS) / DAY_SECONDS; }

/** Whole Singapore calendar days from start to end; never negative. */
export function financingDays(startSeconds: bigint, endSeconds: bigint) {
  const days = sgtDay(endSeconds) - sgtDay(startSeconds);
  return days > 0n ? days : 0n;
}

/** 'YYYY-MM-DD' → 23:59:59 SGT on that date, as Unix seconds. Null when invalid. */
export function endOfSgtDate(date: string): bigint | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const utc = Date.UTC(year, month - 1, day, 23, 59, 59);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return BigInt(utc / 1000) - SGT_OFFSET_SECONDS;
}

export interface FinancingBreakdown {
  terms: FinancingTerms;
  invoiceCents: bigint;
  days: bigint;
  advanceCents: bigint;          // A. cash the SME receives upfront
  holdbackCents: bigint;         // B. reserve retained until settlement
  serviceFeeCents: bigint;       // C. one-time fee on the full invoice amount
  interestCents: bigint;         // D. simple daily interest on the advance
  payableCents: bigint;          // E. advance + service fee + interest
  holdbackReleasedCents: bigint; // F. holdback − service fee − interest (never below zero)
  smeTopUpCents: bigint;         // charges exceeding the holdback, if any
}

/**
 * A–F. Interest = advance × annual rate × days / 365, simple (never compounds),
 * calculated from the unrounded advance.
 */
export function calculateFinancing(invoiceCents: bigint, days: bigint, terms: FinancingTerms): FinancingBreakdown {
  if (invoiceCents <= 0n) throw new Error('Invoice amount must be greater than zero.');
  if (days < 0n) throw new Error('The financing period cannot be negative.');
  if (days > MAX_DAYS) throw new Error('The financing period is too long.');
  const advanceBps = BigInt(terms.advanceBps), feeBps = BigInt(terms.serviceFeeBps), rateBps = BigInt(terms.annualInterestBps);
  if (advanceBps <= 0n || advanceBps > BPS || feeBps < 0n || feeBps > BPS || rateBps < 0n || rateBps > BPS) throw new Error('Invalid financing terms.');
  const advanceCents = roundHalfUp(invoiceCents * advanceBps, BPS);
  const holdbackCents = invoiceCents - advanceCents;
  const serviceFeeCents = roundHalfUp(invoiceCents * feeBps, BPS);
  const interestCents = roundHalfUp(invoiceCents * advanceBps * rateBps * days, BPS * BPS * 365n);
  const remaining = holdbackCents - serviceFeeCents - interestCents;
  return {
    terms, invoiceCents, days, advanceCents, holdbackCents, serviceFeeCents, interestCents,
    payableCents: advanceCents + serviceFeeCents + interestCents,
    holdbackReleasedCents: remaining > 0n ? remaining : 0n,
    smeTopUpCents: remaining < 0n ? -remaining : 0n,
  };
}

export interface SubmissionEstimate {
  errors: string[];
  warnings: string[];
  /** Days from today to the invoice due date. */
  maximumDays: bigint | null;
  /** Days from today to the expected payment date, capped at the due date. */
  estimatedDays: bigint | null;
  breakdown: FinancingBreakdown | null;
}

/** Live estimate for the submission form. Dates are Unix seconds (end of the chosen SGT day). */
export function estimateSubmission(input: { invoiceCents: bigint | null; dueDate: bigint | null; expectedPaymentDate: bigint | null; now: bigint }): SubmissionEstimate {
  const errors: string[] = [], warnings: string[] = [];
  const today = sgtDay(input.now);
  if (input.invoiceCents === null || input.invoiceCents <= 0n) errors.push('Enter an invoice amount greater than zero.');
  if (input.dueDate === null) errors.push('Choose the invoice due date.');
  else if (sgtDay(input.dueDate) <= today) errors.push('The invoice due date must be in the future.');
  if (input.expectedPaymentDate === null) errors.push('Choose the expected payment received date.');
  else if (sgtDay(input.expectedPaymentDate) < today) errors.push('The expected payment date cannot be earlier than today.');
  const dueValid = input.dueDate !== null && sgtDay(input.dueDate) > today;
  const maximumDays = dueValid ? financingDays(input.now, input.dueDate!) : null;
  let estimatedDays: bigint | null = null;
  if (dueValid && input.expectedPaymentDate !== null && sgtDay(input.expectedPaymentDate) >= today) {
    const expectedDays = financingDays(input.now, input.expectedPaymentDate);
    if (expectedDays > maximumDays!) warnings.push('The expected payment date is after the invoice due date. The estimate is capped at the due date.');
    estimatedDays = expectedDays < maximumDays! ? expectedDays : maximumDays!;
  }
  let breakdown: FinancingBreakdown | null = null;
  if (!errors.length && estimatedDays !== null) {
    try { breakdown = calculateFinancing(input.invoiceCents!, estimatedDays, termsAt(input.now)); }
    catch (cause) { errors.push((cause as Error).message); }
  }
  return { errors, warnings, maximumDays, estimatedDays, breakdown };
}

export interface FinancedInvoiceInput {
  invoiceCents: bigint;
  dueDate: bigint;
  financedAt: bigint;
  /** Confirmed repayment time; when absent, interest accrues to `asOf`. */
  repaidAt?: bigint | null;
}

/**
 * Early repayment: once repayment is confirmed, interest uses the actual days
 * outstanding. Before that, interest accrues to `asOf`. Either way it never
 * runs past the invoice due date (the maximum financing period).
 */
export function financedInvoiceCharges(invoice: FinancedInvoiceInput, asOf: bigint) {
  const end = invoice.repaidAt ?? asOf;
  const capped = end < invoice.dueDate ? end : invoice.dueDate;
  const terms = termsAt(invoice.financedAt);
  const breakdown = calculateFinancing(invoice.invoiceCents, financingDays(invoice.financedAt, capped), terms);
  return { ...breakdown, actual: Boolean(invoice.repaidAt), cappedAtDueDate: end > invoice.dueDate };
}

/**
 * Fund NAV as of `asOf` = fund capital + all income earned:
 *   available funds
 * + for each financed invoice: invoice amount + service fee + interest accrued to date
 * + for each repaid invoice: service fee + interest actually earned (realised income).
 * The ledger commits the full invoice amount on financing and restores only that
 * principal on repayment, so the unpaid holdback is still fund cash and realised
 * income is not in the on-chain available funds; both are added here.
 */
export function fundNav(input: { availableFundsCents: bigint; invoices: { id: bigint; invoiceCents: bigint; dueDate: bigint; financed: boolean; repaid?: boolean }[]; financedAt: ReadonlyMap<string, bigint>; repaidAt?: ReadonlyMap<string, bigint>; asOf: bigint }) {
  let outstandingCents = 0n, serviceFeesCents = 0n, accruedInterestCents = 0n, realisedFeesCents = 0n, realisedInterestCents = 0n, missingFinancingDates = 0;
  for (const invoice of input.invoices) {
    if (!invoice.financed && !invoice.repaid) continue;
    const key = invoice.id.toString();
    const financedAt = input.financedAt.get(key);
    const repaidAt = invoice.repaid ? input.repaidAt?.get(key) : undefined;
    if (invoice.financed) outstandingCents += invoice.invoiceCents;
    if (financedAt === undefined || (invoice.repaid && repaidAt === undefined)) {
      // Lifecycle dates not indexed yet: the fee is still known; interest is omitted and reported.
      missingFinancingDates++;
      const fee = calculateFinancing(invoice.invoiceCents, 0n, termsAt(financedAt ?? input.asOf)).serviceFeeCents;
      if (invoice.repaid) realisedFeesCents += fee; else serviceFeesCents += fee;
      continue;
    }
    const charges = financedInvoiceCharges({ invoiceCents: invoice.invoiceCents, dueDate: invoice.dueDate, financedAt, repaidAt: repaidAt ?? null }, input.asOf);
    if (invoice.repaid) { realisedFeesCents += charges.serviceFeeCents; realisedInterestCents += charges.interestCents; }
    else { serviceFeesCents += charges.serviceFeeCents; accruedInterestCents += charges.interestCents; }
  }
  const realisedIncomeCents = realisedFeesCents + realisedInterestCents;
  return {
    availableFundsCents: input.availableFundsCents, outstandingCents, serviceFeesCents, accruedInterestCents,
    realisedFeesCents, realisedInterestCents, realisedIncomeCents, missingFinancingDates,
    totalIncomeCents: serviceFeesCents + accruedInterestCents + realisedIncomeCents,
    navCents: input.availableFundsCents + outstandingCents + serviceFeesCents + accruedInterestCents + realisedIncomeCents,
  };
}
