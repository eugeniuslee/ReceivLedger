import type { ChainInvoice } from '../chain/chainLedger';
import { money, payerKey } from './models';
import { termsAt } from './financing';

/** SME financing rules. Amounts in cents; concentration limits in basis points of active fund NAV. */
export const SME_RULES = {
  maxExposureCents: 10_000_000n,     // S$100,000 maximum SME borrowing exposure
  autoFacilityCents: 5_000_000n,     // S$50,000 automatic financing facility
  autoInvoiceCents: 500_000n,        // automatic invoices up to S$5,000
  autoMaxDays: 30n,                  // automatic maturity within 30 days
  reviewedMaxDays: 90n,              // manager-reviewed maturity within 90 days
  autoConcentrationBps: 100n,        // automatic SME exposure below 1% of NAV
  payerConcentrationBps: 1_000n,     // common payer at most 10% of NAV
} as const;

export type CheckStatus = 'pass' | 'review' | 'fail';
export type Decision = 'automatic' | 'review' | 'blocked';
export interface RuleCheck { rule: string; requirement: string; detail: string; status: CheckStatus }

const BPS = 10_000n;
const min = (...values: bigint[]) => values.reduce((a, b) => a < b ? a : b);
const positive = (value: bigint) => value > 0n ? value : 0n;
const s$ = (cents: bigint) => `S$${new Intl.NumberFormat('en-SG').format(Number(cents / 100n))}`;
/** Committed exposure: approved invoices awaiting financing and financed invoices not yet repaid. */
const open = (invoice: ChainInvoice) => invoice.status === 'Financed' || invoice.status === 'Approved';

/** The SME's limits before any new invoice. `invoices` is every invoice on the ledger (public), so payer exposure spans SMEs. */
export function smeLimits(input: { sme: string; invoices: readonly ChainInvoice[]; navCents: bigint; availableFundsCents: bigint; asOf: number }) {
  const own = input.invoices.filter(invoice => open(invoice) && invoice.sme.toLowerCase() === input.sme.toLowerCase());
  const exposureCents = own.reduce((sum, invoice) => sum + invoice.amount * 100n, 0n);
  const autoUsedCents = own.filter(invoice => invoice.amount * 100n <= SME_RULES.autoInvoiceCents).reduce((sum, invoice) => sum + invoice.amount * 100n, 0n);
  const exposureRemainingCents = positive(SME_RULES.maxExposureCents - exposureCents);
  // Strictly below 1% of NAV: the largest whole-cent total that stays under the limit.
  const concentrationRoomCents = positive((input.navCents * SME_RULES.autoConcentrationBps - 1n) / BPS - exposureCents);
  const maxInvoiceCents = min(exposureRemainingCents, positive(input.availableFundsCents));
  const autoMaxInvoiceCents = min(SME_RULES.autoInvoiceCents, positive(SME_RULES.autoFacilityCents - autoUsedCents), concentrationRoomCents, maxInvoiceCents);
  const advanceBps = BigInt(termsAt(input.asOf).advanceBps);
  return {
    exposureCents, autoUsedCents, exposureRemainingCents, maxInvoiceCents, autoMaxInvoiceCents,
    /** Most cash the SME could receive upfront now, on one or more invoices. */
    cashAdvanceLimitCents: maxInvoiceCents * advanceBps / BPS,
    autoCashAdvanceLimitCents: autoMaxInvoiceCents * advanceBps / BPS,
  };
}

/** Check a proposed invoice against every rule. Any fail blocks it; any review sends it to the fund manager. */
export function assessFinancing(input: {
  /** null when the SME's off-chain registration could not be checked (e.g. manager not signed in). */
  invoiceCents: bigint; days: bigint | null; payer: string; sme: string; registrationApproved: boolean | null;
  invoices: readonly ChainInvoice[]; navCents: bigint; availableFundsCents: bigint; asOf: number;
}) {
  const limits = smeLimits(input);
  const { invoiceCents: amount, days, navCents } = input;
  const payer = payerKey(input.payer.trim());
  const payerExposureCents = payer ? input.invoices.filter(invoice => open(invoice) && payerKey(invoice.payer) === payer).reduce((sum, invoice) => sum + invoice.amount * 100n, 0n) : 0n;
  const checks: RuleCheck[] = [
    { rule: 'SME registration', requirement: 'Must be approved', status: input.registrationApproved === null ? 'review' : input.registrationApproved ? 'pass' : 'fail',
      detail: input.registrationApproved === null ? 'Not checked: sign in to see the SME’s registration.' : input.registrationApproved ? 'Approved' : 'Registration is not approved.' },
    { rule: 'Maximum SME borrowing exposure', requirement: 'S$100,000', status: limits.exposureCents + amount <= SME_RULES.maxExposureCents ? 'pass' : 'fail',
      detail: `${s$(limits.exposureCents)} already committed + ${s$(amount)} = ${s$(limits.exposureCents + amount)}` },
    { rule: 'Automatic financing facility', requirement: 'S$50,000 maximum', status: limits.autoUsedCents + amount <= SME_RULES.autoFacilityCents ? 'pass' : 'review',
      detail: `${s$(limits.autoUsedCents)} of S$50,000 used` },
    { rule: 'Automatic invoice size', requirement: 'Up to S$5,000', status: amount <= SME_RULES.autoInvoiceCents ? 'pass' : 'review',
      detail: amount <= SME_RULES.autoInvoiceCents ? 'Within the automatic size' : 'Larger invoices are reviewed by the fund manager' },
    days === null
      ? { rule: 'Maturity', requirement: 'Automatic within 30 days; reviewed within 90 days', status: 'fail', detail: 'Choose the invoice due date.' }
      : { rule: 'Maturity', requirement: 'Automatic within 30 days; reviewed within 90 days',
        status: days <= SME_RULES.autoMaxDays ? 'pass' : days <= SME_RULES.reviewedMaxDays ? 'review' : 'fail',
        detail: `${days} day(s) to the due date` },
    { rule: 'Automatic risk requirement', requirement: 'Low risk, independently verified', status: input.registrationApproved === true ? 'pass' : 'review',
      detail: input.registrationApproved === true ? 'Verified by the fund manager at registration' : 'Verified when the registration is approved' },
    { rule: 'Automatic SME concentration', requirement: 'Below 1% of active fund NAV', status: (limits.exposureCents + amount) * BPS < navCents * SME_RULES.autoConcentrationBps ? 'pass' : 'review',
      detail: `${s$(limits.exposureCents + amount)} vs 1% of NAV = ${s$(navCents * SME_RULES.autoConcentrationBps / BPS)}` },
    { rule: 'Common customer/payer concentration', requirement: 'Maximum 10% of active fund NAV', status: !payer ? 'review' : (payerExposureCents + amount) * BPS <= navCents * SME_RULES.payerConcentrationBps ? 'pass' : 'fail',
      detail: !payer ? 'Enter the payer to check this rule.' : `${s$(payerExposureCents + amount)} with this payer vs 10% of NAV = ${s$(navCents * SME_RULES.payerConcentrationBps / BPS)}` },
    { rule: 'Funding availability', requirement: 'Fund must have sufficient unreserved cash', status: amount <= input.availableFundsCents ? 'pass' : 'fail',
      detail: `${s$(input.availableFundsCents)} available` },
  ];
  const decision: Decision = checks.some(check => check.status === 'fail') ? 'blocked' : checks.some(check => check.status === 'review') ? 'review' : 'automatic';
  return { decision, checks, limits, payerExposureCents };
}

export const DECISION_LABELS: Record<Decision, string> = {
  automatic: 'Eligible for automatic financing',
  review: 'Eligible with fund manager review',
  blocked: 'Not eligible as entered',
};

/**
 * The fund manager's four risk management guidelines for approving or financing an invoice.
 * Loans are measured as cash advanced to the SME (the advance rate of the invoice). Not enforced by the contract,
 * except that financing reserves the full invoice amount and the contract rejects invoices due in more than 90 days.
 */
export type GuidelineId = 'funds' | 'maturity' | 'maxLoan' | 'concentration';
export interface Guideline {
  id: GuidelineId; rule: string; ok: boolean;
  /** One short line for the checklist. */
  summary: string;
  /** What breaking it means for this invoice (shown in the Risk Management Guidelines box). */
  breach: string;
  /** Figures for the detailed view. */
  figures: { label: string; value: string }[];
}
export const RISK_GUIDELINES = { maxDays: 90n, maxLoanCents: 10_000_000n, smeConcentrationBps: 100n } as const;

export function riskGuidelines(input: { invoice: ChainInvoice; invoices: readonly ChainInvoice[]; navCents: bigint; availableFundsCents: bigint; days: bigint; asOf: number }): Guideline[] {
  const { invoice, navCents, availableFundsCents, days } = input;
  const advanceBps = BigInt(termsAt(input.asOf).advanceBps);
  const advanceOf = (row: ChainInvoice) => row.amount * 100n * advanceBps / BPS;
  const invoiceCents = invoice.amount * 100n;
  const advance = advanceOf(invoice);
  const existing = input.invoices.filter(row => row.id !== invoice.id && open(row) && row.sme.toLowerCase() === invoice.sme.toLowerCase()).reduce((sum, row) => sum + advanceOf(row), 0n);
  const total = existing + advance;
  const concentrationLimit = navCents * RISK_GUIDELINES.smeConcentrationBps / BPS;
  const plusExisting = existing > 0n ? ` plus ${money(existing)} already advanced to this SME = ${money(total)}` : '';
  return [
    { id: 'funds', rule: 'Sufficient funds', ok: invoiceCents <= availableFundsCents,
      summary: `${money(availableFundsCents)} available; financing reserves ${money(invoiceCents)}`,
      breach: `Financing reserves the full invoice amount of ${money(invoiceCents)}, but only ${money(availableFundsCents)} is available. The contract will reject the financing.`,
      figures: [{ label: 'Funds available', value: money(availableFundsCents) }, { label: 'Reserved when financed (full invoice)', value: money(invoiceCents) }, { label: 'Cash paid to the SME', value: money(advance) }, { label: 'Left after financing', value: money(availableFundsCents - invoiceCents) }] },
    { id: 'maturity', rule: 'Maturity less than 90 days', ok: days > 0n && days <= RISK_GUIDELINES.maxDays,
      summary: days > 0n ? `${days} days to the due date` : 'Already past the due date',
      breach: days > 0n ? `The invoice is due in ${days} days, more than the 90-day limit. The contract will reject the financing.` : 'The invoice is already past its due date. The contract will reject the financing.',
      figures: [{ label: 'Days to the due date', value: days > 0n ? `${days} days` : 'Past due' }, { label: 'Limit', value: '90 days' }] },
    { id: 'maxLoan', rule: 'Max loan of S$100,000', ok: total <= RISK_GUIDELINES.maxLoanCents,
      summary: `${money(total)} of ${money(RISK_GUIDELINES.maxLoanCents)} lent to this SME`,
      breach: `Cash to advance ${money(advance)}${plusExisting} is more than the maximum loan of ${money(RISK_GUIDELINES.maxLoanCents)} per SME.`,
      figures: [{ label: 'Already advanced to this SME', value: money(existing) }, { label: 'This advance', value: money(advance) }, { label: 'Total loan', value: money(total) }, { label: 'Maximum', value: money(RISK_GUIDELINES.maxLoanCents) }] },
    { id: 'concentration', rule: 'SME concentration of 1% of NAV', ok: total <= concentrationLimit,
      summary: `${money(total)} vs ${money(concentrationLimit)} (1% of NAV)`,
      breach: `Cash to advance ${money(advance)}${plusExisting} is more than the SME concentration limit of ${money(concentrationLimit)} (1% of NAV ${money(navCents)}).`,
      figures: [{ label: 'Fund NAV', value: money(navCents) }, { label: 'Limit (1% of NAV)', value: money(concentrationLimit) }, { label: 'Lent to this SME after this advance', value: money(total) }] },
  ];
}
