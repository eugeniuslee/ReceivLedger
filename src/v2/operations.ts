import type { V2Ledger } from './V2Ledger';
import { percentage } from './reporting';

export type FundReport = Awaited<ReturnType<V2Ledger['readReport']>>;
export const investmentStatuses = ['Pending funding', 'Pending review', 'Ready to process', 'Processed', 'Cancelled', 'Refund pending', 'Refunded', 'Rejected'];
export const redemptionStatuses = ['Pending review', 'Pending liquidity', 'Allocated', 'Settled', 'Cancelled', 'Rejected'];
export const invoiceStatuses = ['Submitted', 'Auto-approved', 'Approved', 'Financed', 'Rejected', 'Repaid'];
export const statusLabel = (labels: string[], value: bigint) => labels[Number(value)] ?? 'Unknown status';
export const rluUnits = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, '0')} RLU2`;
export const pendingInvestment = (status: bigint) => [0n, 1n, 2n, 5n].includes(status);
export const pendingRedemption = (status: bigint) => [0n, 1n, 2n].includes(status);
export const pendingInvoice = (status: bigint) => [0n, 1n, 2n].includes(status);
export function requestAction(kind: 'investment' | 'redemption' | 'invoice', status: bigint) {
  const actions: Record<string, Record<string, string>> = {
    investment: {0: 'Confirm simulated funding', 1: 'Approve investment', 2: 'Process investment', 5: 'Record refund'},
    redemption: {0: 'Approve redemption', 1: 'Allocate redemption liquidity', 2: 'Settle redemption'},
    invoice: {0: 'Review and approve invoice', 1: 'Finance invoice', 2: 'Finance invoice', 3: 'Record collection / repayment'},
  };
  return actions[kind][String(status)] ?? null;
}

/** Snapshot-only indicators. Proposals never become reserved cash or funding. */
export function operationsSummary(report: FundReport) {
  const nav = BigInt(report.fund.navCents), pricingUnits = BigInt(report.fund.pricingUnits);
  const freeLiquidity = BigInt(report.fund.freeLiquidityCents);
  const commitments = BigInt(report.fund.financingCommitmentsCents);
  const reservedExits = BigInt(report.fund.reservedRedemptionCents);
  const awaitingRedemptions = report.redemptions.filter(r => r.status === 0n || r.status === 1n);
  const proposedExitValue = !awaitingRedemptions.length ? 0n : pricingUnits > 0n ? awaitingRedemptions.reduce((sum, r) => sum + r.units * nav / pricingUnits, 0n) : null;
  const overdue = report.invoices.filter(i => i.status === 3n && i.maturity < report.timestamp && i.principal > 0n);
  const payers = new Map<string, bigint>();
  for (const i of report.invoices) payers.set(i.payer, (payers.get(i.payer) ?? 0n) + i.principal + (i.commitment > 0n ? i.advance : 0n));
  const payerExposures = [...payers].filter(([, total]) => total > 0n).map(([payer, total]) => ({ payer, total, percentage: percentage(total, nav), exceedsLimit: total > nav / 10n }));
  const warnings: string[] = [];
  if (report.fund.paused) warnings.push('The V2 contract is paused.');
  if (BigInt(report.fund.liquidCents) < commitments + reservedExits) warnings.push('Fund cash is below approved financing commitments and allocated exits.');
  if (proposedExitValue !== null && proposedExitValue > freeLiquidity) warnings.push('Indicative pending redemption value exceeds available liquidity. Pending requests do not reserve cash.');
  if (awaitingRedemptions.length && proposedExitValue === null) warnings.push('Pending redemptions cannot be valued because there are no active pricing units.');
  if (overdue.length) warnings.push(`${overdue.length} financed invoice${overdue.length === 1 ? ' is' : 's are'} overdue with principal outstanding.`);
  if (report.concentrations.some(c => (c.outstanding + c.commitments) > 0n && (c.outstanding + c.commitments) * 100n >= nav)) warnings.push('SME exposure is at or above 1% of NAV. Financing requires the contract’s concentration acknowledgement.');
  if (report.concentrations.some(c => c.outstanding + c.commitments > BigInt(report.fund.SME_CAP_CENTS))) warnings.push('An SME exceeds the S$100,000 combined principal and approved gross commitment cap.');
  if (payerExposures.some(p => p.exceedsLimit)) warnings.push('A payer exceeds the 10% of NAV financing limit.');
  if ((BigInt(report.fund.outstandingCents) + BigInt(report.fund.accruedInterestCents)) > 0n && BigInt(report.fund.valuationValidUntil) < report.timestamp) warnings.push('Manager valuation has expired. NAV-priced execution requires a fresh valuation.');
  return {
    navPerUnit: pricingUnits === 0n ? null : nav * 100n / pricingUnits,
    investmentCount: report.subscriptions.filter(r => pendingInvestment(r.status)).length,
    redemptionCount: report.redemptions.filter(r => pendingRedemption(r.status)).length,
    invoiceCount: report.invoices.filter(r => pendingInvoice(r.status)).length,
    commitments, reservedExits, proposedExitValue, payerExposures, overdue, warnings,
    overduePrincipal: overdue.reduce((sum, i) => sum + i.principal, 0n),
  };
}
