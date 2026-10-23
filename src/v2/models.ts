export const V2_POLICY = { maxFundCents: 1_000_000_000n, smeCapCents: 10_000_000n, automaticSmeCapCents: 5_000_000n, smallInvoiceCents: 500_000n, smallSubscriptionCents: 1_000_000n, processingCents: 2_000n, annualBps: 800n } as const;
export interface EligibilityEvidence { navCents: bigint; freeLiquidityCents: bigint; smeOutstandingCents: bigint; payerOutstandingCents: bigint; smeCommitmentsCents?: bigint; payerCommitmentsCents?: bigint; automaticExposureCents?: bigint; verifiedSme: boolean; documentVerified: boolean; creditCleared: boolean; lowRisk: boolean; remainingDays: number }
export function v2Quote(faceCents: bigint, days: number, overdueDays = 0, overdueBps = 0) {
  if (faceCents <= V2_POLICY.processingCents || faceCents > V2_POLICY.smeCapCents * 100n / 90n) throw new Error('Invoice must exceed S$20 and fit the maximum gross borrowing amount.');
  if (![days, overdueDays, overdueBps].every(Number.isSafeInteger) || days < 0 || days > 36500 || overdueDays < 0 || overdueDays > days || overdueBps < 0 || overdueBps > 300) throw new Error('Enter valid actual/estimated days and an accepted overdue rate from 0% to 3%.');
  const advanceBps = faceCents <= V2_POLICY.smallInvoiceCents ? 10000n : 9000n;
  const grossAdvanceCents = faceCents * advanceBps / 10000n;
  const estimatedInterestCents = grossAdvanceCents * 800n * BigInt(days) / 3650000n;
  const estimatedOverdueCents = grossAdvanceCents * BigInt(overdueBps) * BigInt(overdueDays) / 3650000n;
  const estimatedObligationCents = grossAdvanceCents + estimatedInterestCents + estimatedOverdueCents;
  return { faceCents, advanceBps, grossAdvanceCents, processingFeeCents: V2_POLICY.processingCents,
    upfrontCents: grossAdvanceCents - V2_POLICY.processingCents, holdbackCents: faceCents - grossAdvanceCents,
    estimatedInterestCents, estimatedOverdueCents, estimatedObligationCents,
    estimatedTopUpCents: estimatedObligationCents > faceCents ? estimatedObligationCents - faceCents : 0n,
    estimatedReserveReleaseCents: faceCents > estimatedObligationCents ? faceCents - estimatedObligationCents : 0n };
}
export function v2Eligibility(faceCents: bigint, e: EligibilityEvidence) {
  const quote = v2Quote(faceCents, Math.max(0, Math.min(36500, e.remainingDays)));
  if ([e.navCents,e.freeLiquidityCents,e.smeOutstandingCents,e.payerOutstandingCents,e.smeCommitmentsCents??0n,e.payerCommitmentsCents??0n,e.automaticExposureCents??0n].some(v => v < 0n)) throw new Error('Evidence amounts cannot be negative.');
  if (e.freeLiquidityCents > e.navCents) throw new Error('Unreserved liquidity cannot exceed NAV under this accounting model.');
  const combined=e.smeOutstandingCents+(e.smeCommitmentsCents??0n)+quote.grossAdvanceCents;
  const blocked = [!e.verifiedSme && 'SME verification required', !e.documentVerified && 'Invoice authenticity and duplicate review required', !e.creditCleared && 'Credit review required', (e.remainingDays <= 0 || e.remainingDays > 90) && 'Maturity must be within 90 future days', combined > V2_POLICY.smeCapCents && 'SME S$100,000 cap exceeded', e.payerOutstandingCents + (e.payerCommitmentsCents??0n) + quote.grossAdvanceCents > e.navCents / 10n && 'Payer 10% concentration cap exceeded', quote.upfrontCents > e.freeLiquidityCents && 'Insufficient unreserved liquidity'].filter((x): x is string => Boolean(x));
  const review = [faceCents > V2_POLICY.smallInvoiceCents && 'Invoice exceeds S$5,000', combined * 100n >= e.navCents && 'Combined SME exposure is at or above 1% of current fund NAV; manager acknowledgement required', (e.automaticExposureCents??0n)+quote.grossAdvanceCents>V2_POLICY.automaticSmeCapCents&&'S$50,000 automatic facility exceeded', e.remainingDays>30&&'Automatic financing requires maturity within 30 days', !e.lowRisk && 'Risk requires manager review'].filter((x): x is string => Boolean(x));
  return { quote, blocked, review, highRiskAcknowledgement:combined*100n>=e.navCents, decision: blocked.length ? 'Blocked' : review.length ? 'Pending Manager Review' : 'Eligible for automatic approval' };
}
export function subscriptionPreview(cents: bigint, nav: bigint, pricingUnits: bigint, approved: boolean, confirmed: boolean, reservedLiabilityCents = 0n, lifetimeAutomaticCents=0n) {
  if (cents < 100n || nav < 0n || pricingUnits < 0n || reservedLiabilityCents < 0n || lifetimeAutomaticCents < 0n) throw new Error('Invalid subscription or fund amounts.');
  if (!approved) return { decision: 'Investor approval required', units: null };
  if (!confirmed) return { decision: 'Awaiting simulated funding confirmation', units: null };
  if (nav + reservedLiabilityCents + cents > V2_POLICY.maxFundCents) return { decision: 'Fund maximum exceeded', units: null };
  if ((nav === 0n) !== (pricingUnits === 0n)) return { decision: 'Valuation required', units: null };
  const units = pricingUnits === 0n ? cents : cents * pricingUnits / nav;
  return { decision: units === 0n ? 'Rounds to zero: review required' : cents+lifetimeAutomaticCents <= V2_POLICY.smallSubscriptionCents ? 'Eligible execution queue' : 'Manager review required', units };
}
