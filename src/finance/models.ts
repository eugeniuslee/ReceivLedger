import type { ChainEvent, ChainInvoice } from '../chain/chainLedger';

export const DAY = 86400n;
export const BPS = 10000n;
export interface FinancialSnapshot {
  blockNumber: number; blockTimestamp: bigint; totalSupply: bigint; connectedBalance: bigint;
  totalFundSize: bigint; availableFunds: bigint; maxPayerExposure: bigint; maxMaturityDays: bigint;
  invoices: ChainInvoice[];
}
export interface Assumptions {
  advanceBps: number; annualFeeBps: number; serviceFeeBps: number;
  smeCapBps: number; liquidityReserveBps: number; salesCapBps: number; annualSalesCents: bigint | null;
}
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  advanceBps: 8000, annualFeeBps: 1200, serviceFeeBps: 100,
  smeCapBps: 2000, liquidityReserveBps: 2000, salesCapBps: 1000, annualSalesCents: null,
};
export type RiskTier = 'unassessed' | 'low' | 'moderate' | 'high';
export const RISK_POLICY: Record<RiskTier, { factorBps: number; label: string }> = {
  unassessed: { factorBps: 5000, label: 'Unassessed · no credit evidence' },
  low: { factorBps: 10000, label: 'Demo low-risk assumption' },
  moderate: { factorBps: 7500, label: 'Demo moderate-risk assumption' },
  high: { factorBps: 5000, label: 'Demo high-risk assumption' },
};
export function validateAssumptions(a: Assumptions) {
  for (const [key, value] of Object.entries(a)) {
    if (key.endsWith('Bps') && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10000)) throw new Error('Percentages must be between 0 and 100, with at most two decimal places.');
  }
  if (a.advanceBps < 7000 || a.advanceBps > 9000) throw new Error('The demonstration advance rate must be 70%–90%.');
  if (a.annualSalesCents !== null && a.annualSalesCents < 0n) throw new Error('Assumed annual sales cannot be negative.');
}
export const positivePart = (value: bigint) => value > 0n ? value : 0n;
const min = (...values: bigint[]) => values.reduce((a, b) => a < b ? a : b);
export function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('A positive denominator is required.');
  return numerator < 0n ? -roundRatio(-numerator, denominator) : (numerator + denominator / 2n) / denominator;
}
export function moneyInput(text: string): bigint {
  if (!/^\d{1,24}(\.\d{1,2})?$/.test(text)) throw new Error('Enter a non-negative S$ amount with at most two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function percentInput(text: string): number {
  const value = moneyInput(text);
  if (value > 10000n) throw new Error('Percentages cannot exceed 100%.');
  return Number(value);
}
export function money(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}S$${new Intl.NumberFormat('en-SG').format(absolute / 100n)}.${String(absolute % 100n).padStart(2, '0')}`;
}
export function perUnit(micros: bigint | null): string {
  if (micros === null) return 'Not defined';
  const absolute = micros < 0n ? -micros : micros;
  return `${micros < 0n ? '-' : ''}S$${new Intl.NumberFormat('en-SG').format(absolute / 1000000n)}.${String(absolute % 1000000n).padStart(6, '0')}`;
}
export function payerKey(name: string) { return name.replace(/[A-Z]/g, letter => letter.toLowerCase()); }
export function durationDays(start: bigint, maturity: bigint) {
  const seconds = positivePart(maturity - start);
  return (seconds + DAY - 1n) / DAY;
}
export function maturityState(invoice: ChainInvoice, now: bigint) {
  const remaining = invoice.maturity - now;
  const overdue = invoice.status === 'Financed' && remaining < 0n;
  return { overdue, daysRemaining: durationDays(now, invoice.maturity), overdueDays: positivePart(-remaining) / DAY,
    label: invoice.status === 'Repaid' ? 'Repaid on-chain' : overdue ? `${-remaining < DAY ? '<1' : String(-remaining / DAY)} day(s) overdue`
      : invoice.status === 'Rejected' ? 'Rejected on-chain' : remaining > 0n ? `${durationDays(now, invoice.maturity)} day(s) remaining`
      : invoice.status === 'Financed' && remaining === 0n ? 'Due now' : 'Maturity reached · not financed' };
}

/** Proposal only. Fees are withheld from the reserve at settlement, not the
 * initial advance. No fees or hypothetical principal are written to the chain. */
export function financingQuote(faceCents: bigint, days: bigint, a: Assumptions) {
  validateAssumptions(a);
  if (faceCents <= 0n || days < 0n || days > 36500n) throw new Error('Use a positive face value and a duration of 0–36,500 days.');
  const advanceCents = faceCents * BigInt(a.advanceBps) / BPS;
  const reserveCents = faceCents - advanceCents;
  const discountCents = roundRatio(advanceCents * BigInt(a.annualFeeBps) * days, BPS * 365n);
  const serviceFeeCents = roundRatio(faceCents * BigInt(a.serviceFeeBps), BPS);
  const incomeCents = discountCents + serviceFeeCents;
  const smeSettlementCents = reserveCents - incomeCents;
  return { faceCents, days, advanceCents, reserveCents, discountCents, serviceFeeCents, incomeCents,
    expectedPayerSettlementCents: faceCents, fundRetainedCents: advanceCents + incomeCents,
    smeSettlementCents, totalSmeProceedsCents: faceCents - incomeCents, feesFitReserve: smeSettlementCents >= 0n };
}

export function portfolio(snapshot: FinancialSnapshot, now: bigint) {
  const counts: Record<string, number> = { Submitted: 0, Approved: 0, Financed: 0, Rejected: 0, Repaid: 0, Unknown: 0 };
  const payers = new Map<string, { key: string; name: string; outstandingCents: bigint; count: number; overdueCents: bigint }>();
  let outstandingCents = 0n; let repaidPrincipalCents = 0n; let overdueCents = 0n; let overdueCount = 0;
  for (const invoice of snapshot.invoices) {
    counts[invoice.status] = (counts[invoice.status] ?? 0) + 1;
    if (invoice.status === 'Repaid') repaidPrincipalCents += invoice.amount * 100n;
    if (invoice.status !== 'Financed') continue;
    outstandingCents += invoice.amount * 100n;
    const key = payerKey(invoice.payer);
    const row = payers.get(key) ?? { key, name: invoice.payer, outstandingCents: 0n, count: 0, overdueCents: 0n };
    row.outstandingCents += invoice.amount * 100n; row.count++;
    if (maturityState(invoice, now).overdue) { overdueCount++; overdueCents += invoice.amount * 100n; row.overdueCents += invoice.amount * 100n; }
    payers.set(key, row);
  }
  return { counts, payers: [...payers.values()].sort((a, b) => a.name.localeCompare(b.name)), outstandingCents,
    overdueCents, overdueCount, repaidPrincipalCents,
    reconciliationCents: snapshot.totalFundSize * 100n - snapshot.availableFunds * 100n - outstandingCents };
}

export function assessInvoice(invoice: ChainInvoice, snapshot: FinancialSnapshot, now: bigint, a: Assumptions, risk: RiskTier) {
  validateAssumptions(a);
  const policy = RISK_POLICY[risk]; if (!policy) throw new Error('Choose a known demonstration risk tier.');
  const active = snapshot.invoices.filter(row => row.status === 'Financed');
  const smeLoans = active.filter(row => row.sme.toLowerCase() === invoice.sme.toLowerCase());
  const smeOutstandingCents = smeLoans.reduce((sum, row) => sum + row.amount * 100n, 0n);
  const payerLoans = active.filter(row => payerKey(row.payer) === payerKey(invoice.payer));
  const payerExposureCents = payerLoans.reduce((sum, row) => sum + row.amount * 100n, 0n);
  const fundPolicyCapCents = snapshot.totalFundSize * 100n * BigInt(a.smeCapBps) / BPS;
  const salesPolicyCapCents = a.annualSalesCents === null ? null : a.annualSalesCents * BigInt(a.salesCapBps) / BPS;
  const borrowingLimitCents = (salesPolicyCapCents === null ? fundPolicyCapCents : min(fundPolicyCapCents, salesPolicyCapCents)) * BigInt(policy.factorBps) / BPS;
  const remainingBorrowingCents = positivePart(borrowingLimitCents - smeOutstandingCents);
  const reserveTargetCents = snapshot.totalFundSize * 100n * BigInt(a.liquidityReserveBps) / BPS;
  const liquidAfterReserveCents = positivePart(snapshot.availableFunds * 100n - reserveTargetCents);
  const remainingPayerCents = positivePart(snapshot.maxPayerExposure * 100n - payerExposureCents);
  const maximumProposedAdvanceCents = min(remainingBorrowingCents, liquidAfterReserveCents, remainingPayerCents);
  const contractReasons: string[] = [];
  if (invoice.status !== 'Approved') contractReasons.push(invoice.status === 'Submitted' ? 'Manager approval is required before financeInvoice().' : `Status ${invoice.status} is not financeable.`);
  if (invoice.maturity <= now) contractReasons.push('Invoice has reached maturity.');
  if (invoice.maturity > now + snapshot.maxMaturityDays * DAY) contractReasons.push(`Remaining maturity exceeds the contract's ${snapshot.maxMaturityDays}-day limit.`);
  if (invoice.amount > snapshot.availableFunds) contractReasons.push('The full invoice face value exceeds available contract funds.');
  if (payerExposureCents + invoice.amount * 100n > snapshot.maxPayerExposure * 100n) contractReasons.push('Full face value plus existing payer exposure exceeds the contract cap.');
  const days = durationDays(now, invoice.maturity);
  const quote = days <= 36500n && invoice.amount > 0n ? financingQuote(invoice.amount * 100n, days, a) : null;
  const modelReasons: string[] = [];
  if (invoice.status !== 'Submitted' && invoice.status !== 'Approved') modelReasons.push('This is a closed or already-financed record, not a new financing request.');
  if (invoice.maturity <= now) modelReasons.push('No future financing period remains.');
  if (smeLoans.some(row => maturityState(row, now).overdue)) modelReasons.push('Demo policy pauses new financing while this SME has overdue principal.');
  if (quote && quote.advanceCents > maximumProposedAdvanceCents) modelReasons.push('Proposed advance exceeds SME, payer or reserve-adjusted liquidity capacity.');
  if (quote && !quote.feesFitReserve) modelReasons.push('Proposed fees exceed the reserve; extra SME payment would be required.');
  if (!quote) modelReasons.push('A quote could not be calculated for this amount or duration.');
  return { quote, contractReasons, contractEligible: contractReasons.length === 0, modelReasons,
    modelWithinPolicy: modelReasons.length === 0, fundPolicyCapCents, salesPolicyCapCents, borrowingLimitCents,
    remainingBorrowingCents, smeOutstandingCents, reserveTargetCents, liquidAfterReserveCents,
    payerExposureCents, remainingPayerCents, maximumProposedAdvanceCents,
    payerOverdueCount: payerLoans.filter(row => maturityState(row, now).overdue).length,
    missingFinancialEvidence: a.annualSalesCents === null, riskLabel: policy.label, riskFactorBps: policy.factorBps };
}

export function navScenario(snapshot: FinancialSnapshot, adjustments: { incomeCents: bigint; liabilitiesCents: bigint; impairmentBps: number }) {
  const { incomeCents, liabilitiesCents, impairmentBps } = adjustments;
  if (incomeCents < 0n || liabilitiesCents < 0n || !Number.isInteger(impairmentBps) || impairmentBps < 0 || impairmentBps > 10000) throw new Error('Use non-negative income/liabilities and an impairment assumption of 0%–100%.');
  if (snapshot.totalSupply < 0n || snapshot.connectedBalance < 0n || snapshot.connectedBalance > snapshot.totalSupply) throw new Error('Holdings and supply are inconsistent. Refresh the blockchain records.');
  const principalCents = snapshot.invoices.filter(row => row.status === 'Financed').reduce((sum, row) => sum + row.amount * 100n, 0n);
  const impairmentCents = roundRatio(principalCents * BigInt(impairmentBps), BPS);
  const baseAssetsCents = snapshot.availableFunds * 100n + principalCents;
  const navCents = baseAssetsCents - impairmentCents + incomeCents - liabilitiesCents;
  const supply = snapshot.totalSupply;
  return { baseAssetsCents, principalCents, impairmentCents, navCents,
    navPerRluMicros: supply > 0n ? roundRatio(navCents * 10000n, supply) : null,
    holdingsValueCents: supply > 0n ? roundRatio(navCents * snapshot.connectedBalance, supply) : null,
    ownershipHundredths: supply > 0n ? roundRatio(snapshot.connectedBalance * 10000n, supply) : null };
}

/** A forward scenario on actual outstanding principal over remaining time.
 * Historical repaid records never produce "earned income" in this model. */
export function prospectiveIncome(snapshot: FinancialSnapshot, now: bigint, annualFeeBps: number) {
  if (!Number.isInteger(annualFeeBps) || annualFeeBps < 0 || annualFeeBps > 10000) throw new Error('Invalid annual fee assumption.');
  return snapshot.invoices.filter(row => row.status === 'Financed' && row.maturity > now && row.maturity <= now + 36500n * DAY)
    .reduce((sum, row) => sum + roundRatio(row.amount * 100n * BigInt(annualFeeBps) * durationDays(now, row.maturity), BPS * 365n), 0n);
}
export function invoiceHistory(events: ChainEvent[], id: bigint) {
  return events.filter(event => event.invoiceId === id).slice().sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}
