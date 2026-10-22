import { describe, expect, it } from 'vitest';
import { borrowingCapacity, assessInvoice, DAY, DEFAULT_ASSUMPTIONS as defaults, durationDays, financingQuote, invoiceHistory, maturityState, money, moneyInput, navScenario, payerKey, percentInput, perUnit, portfolio, prospectiveIncome, roundRatio } from './models';
import { testInvoice as invoice, testNow as now, testSnapshot as snapshot } from './fixtures';
import type { ChainEvent } from '../chain/chainLedger';

describe('proposed advances and fees', () => {
  it.each([1n, 101n, 100000n, 900719925474099301n])('conserves settlement and SME proceeds at %s cents, including stress fees', face => {
    for (const advanceBps of [7000, 8000, 9000]) {
      for (const days of [0n, 1n, 365n, 36500n]) {
        const q = financingQuote(face, days, { ...defaults, advanceBps });
        expect(q.advanceCents + q.reserveCents).toBe(face);
        expect(q.fundRetainedCents + q.smeSettlementCents).toBe(face);
        expect(q.advanceCents + q.smeSettlementCents).toBe(q.totalSmeProceedsCents);
        expect(q.totalSmeProceedsCents + q.incomeCents).toBe(face);
      }
    }
  });
  it('charges simple interest for exactly 365 days and rounds a half-cent service fee up', () => {
    expect(financingQuote(100000n, 365n, defaults).discountCents).toBe(9600n);
    expect(financingQuote(50n, 0n, defaults)).toMatchObject({ advanceCents: 40n, discountCents: 0n, serviceFeeCents: 1n });
  });
  it('splits advance/reserve and computes simple annual and face-value fees exactly', () => {
    const quote = financingQuote(100000n, 30n, defaults);
    expect(quote).toMatchObject({ advanceCents: 80000n, reserveCents: 20000n, discountCents: 789n, serviceFeeCents: 1000n,
      incomeCents: 1789n, expectedPayerSettlementCents: 100000n, fundRetainedCents: 81789n, smeSettlementCents: 18211n, totalSmeProceedsCents: 98211n, feesFitReserve: true });
    expect(quote.fundRetainedCents + quote.smeSettlementCents).toBe(quote.faceCents);
  });
  it.each([7000, 8000, 9000])('accepts configurable %i bps advances', advanceBps => {
    expect(financingQuote(10001n, 0n, { ...defaults, advanceBps, serviceFeeBps: 0 }).advanceCents).toBe(10001n * BigInt(advanceBps) / 10000n);
  });
  it.each([6999, 9001, NaN, 8000.5])('rejects invalid advance %s', advanceBps => {
    expect(() => financingQuote(10000n, 30n, { ...defaults, advanceBps })).toThrow();
  });
  it('handles zero fees and flags fees exceeding the withheld reserve without hiding losses', () => {
    expect(financingQuote(10000n, 30n, { ...defaults, annualFeeBps: 0, serviceFeeBps: 0 }).incomeCents).toBe(0n);
    const stressed = financingQuote(10000n, 365n, { ...defaults, annualFeeBps: 10000 });
    expect(stressed.feesFitReserve).toBe(false);
    expect(stressed.smeSettlementCents).toBeLessThan(0n);
  });
  it.each([[0n, 30n], [-1n, 30n], [100n, -1n], [100n, 36501n]])('rejects invalid face/duration %s/%s', (face, days) => {
    expect(() => financingQuote(face, days, defaults)).toThrow();
  });
  it('rounds exact halves away from zero and formats large values without Number conversion', () => {
    expect(roundRatio(5n, 2n)).toBe(3n); expect(roundRatio(-5n, 2n)).toBe(-3n);
    expect(() => roundRatio(1n, 0n)).toThrow();
    expect(money(900719925474099301n)).toBe('S$9,007,199,254,740,993.01');
    expect(perUnit(-1234567n)).toBe('-S$1.234567'); expect(perUnit(null)).toBe('Not defined');
  });
  it('strictly parses cent and percentage inputs without exponent or precision loss', () => {
    expect(moneyInput('123.4')).toBe(12340n); expect(percentInput('12.34')).toBe(1234);
    for (const text of ['-1', '1e3', '1.001', '', 'Infinity']) expect(() => moneyInput(text)).toThrow();
    expect(() => percentInput('100.01')).toThrow();
  });
});

describe('SME borrowing recommendations and actual full-face constraints', () => {
  it('distinguishes missing sales from explicit zero sales and accepts exact contract headroom', () => {
    const exact = assessInvoice(invoice(), snapshot({ availableFunds: 100n, maxPayerExposure: 100n }), now, defaults, 'low');
    expect(exact.contractEligible).toBe(true);
    const noSales = assessInvoice(invoice(), snapshot(), now, { ...defaults, annualSalesCents: 0n }, 'low');
    expect(noSales).toMatchObject({ borrowingLimitCents: 0n, maximumProposedAdvanceCents: 0n, missingFinancialEvidence: false, modelWithinPolicy: false });
  });
  it('uses conservative unassessed policy and explains the optional sales constraint', () => {
    const result = assessInvoice(invoice(), snapshot(), now, defaults, 'unassessed');
    expect(result).toMatchObject({ borrowingLimitCents: 10000n, remainingBorrowingCents: 10000n, missingFinancialEvidence: true, riskFactorBps: 5000 });
    const withSales = assessInvoice(invoice(), snapshot(), now, { ...defaults, annualSalesCents: 100000n }, 'moderate');
    expect(withSales.salesPolicyCapCents).toBe(10000n); expect(withSales.borrowingLimitCents).toBe(7500n);
  });
  it('counts only actual active principal for this SME and matches wallet case-insensitively', () => {
    const live = invoice({ id: 2n, status: 'Financed', amount: 60n, sme: invoice().sme.toUpperCase() });
    const data = snapshot({ invoices: [live, invoice({ id: 3n, status: 'Repaid', amount: 99n }), invoice({ id: 4n, status: 'Financed', sme: '0xother', amount: 10n })] });
    const result = assessInvoice(invoice(), data, now, defaults, 'unassessed');
    expect(result.smeOutstandingCents).toBe(6000n); expect(result.remainingBorrowingCents).toBe(4000n);
    expect(result.payerExposureCents).toBe(7000n); expect(result.remainingPayerCents).toBe(3000n);
    expect(result.maximumProposedAdvanceCents).toBe(3000n); expect(result.modelWithinPolicy).toBe(false);
  });
  it('binds new advances by reserve-adjusted liquidity and clamps negative headroom', () => {
    const result = assessInvoice(invoice(), snapshot({ availableFunds: 210n }), now, defaults, 'low');
    expect(result.reserveTargetCents).toBe(20000n); expect(result.liquidAfterReserveCents).toBe(1000n);
    expect(result.maximumProposedAdvanceCents).toBe(1000n);
    expect(assessInvoice(invoice(), snapshot({ availableFunds: 0n, maxPayerExposure: 0n }), now, defaults, 'low').maximumProposedAdvanceCents).toBe(0n);
  });
  it('keeps the partial-advance recommendation separate from the stricter full-face contract check', () => {
    const result = assessInvoice(invoice(), snapshot({ maxPayerExposure: 90n }), now, defaults, 'unassessed');
    expect(result.quote?.advanceCents).toBe(8000n); expect(result.modelWithinPolicy).toBe(true);
    expect(result.contractEligible).toBe(false); expect(result.contractReasons.join(' ')).toContain('Full face value');
    expect(assessInvoice(invoice(), snapshot({ availableFunds: 99n }), now, defaults, 'low').contractReasons.join(' ')).toContain('full invoice face value');
  });
  it('matches inclusive 90-day contract limit and exclusive maturity start', () => {
    expect(assessInvoice(invoice({ maturity: now + 90n * DAY }), snapshot(), now, defaults, 'low').contractEligible).toBe(true);
    expect(assessInvoice(invoice({ maturity: now + 90n * DAY + 1n }), snapshot(), now, defaults, 'low').contractEligible).toBe(false);
    expect(assessInvoice(invoice({ maturity: now }), snapshot(), now, defaults, 'low').contractEligible).toBe(false);
    expect(assessInvoice(invoice({ status: 'Submitted' }), snapshot(), now, defaults, 'low').contractReasons.join(' ')).toContain('approval is required');
  });
  it('pauses demo lending for overdue SME loans and never invents a credit score', () => {
    const result = assessInvoice(invoice(), snapshot({ invoices: [invoice({ id: 2n, status: 'Financed', amount: 1n, maturity: now - 1n })] }), now, defaults, 'unassessed');
    expect(result.modelReasons.join(' ')).toContain('overdue principal'); expect(result.payerOverdueCount).toBe(1);
    expect(result.riskLabel).toContain('no credit evidence');
  });
  it('normalizes payer names exactly like Solidity, preserving spaces and non-ASCII case', () => {
    expect(payerKey(' ACME Ä ')).toBe(' acme Ä '); expect(payerKey('ACME')).not.toBe(payerKey(' ACME '));
  });
});

describe('maturity, portfolio and confirmed history', () => {
  it.each(['Submitted', 'Approved'] as const)('does not imply a repayment obligation for an unfinanced %s invoice at/past maturity', status => {
    for (const maturity of [now, now - 1n]) {
      expect(maturityState(invoice({ status, maturity }), now)).toMatchObject({ overdue: false, label: 'Maturity reached · not financed' });
    }
  });
  it('rounds remaining time up, only marks past-due Financed rows overdue and never changes status', () => {
    const row = Object.freeze(invoice({ status: 'Financed', maturity: now - 1n }));
    expect(maturityState(row, now)).toMatchObject({ overdue: true, overdueDays: 0n, label: '<1 day(s) overdue' });
    expect(row.status).toBe('Financed');
    for (const status of ['Submitted', 'Approved', 'Rejected', 'Repaid'] as const) expect(maturityState({ ...row, status }, now).overdue).toBe(false);
    expect(maturityState({ ...row, maturity: now }, now).label).toBe('Due now');
    expect(durationDays(now, now + DAY + 1n)).toBe(2n); expect(durationDays(now, now - 1n)).toBe(0n);
  });
  it('keeps overdue as a financed subset and repaid turnover out of assets and payer exposure', () => {
    const data = snapshot({ availableFunds: 900n, invoices: [invoice({ status: 'Financed', amount: 60n, maturity: now - DAY }), invoice({ id: 2n, status: 'Financed', amount: 40n, payer: 'EXAMPLE PAYER' }), invoice({ id: 3n, status: 'Repaid', amount: 200n }), invoice({ id: 4n, status: 'Unknown', amount: 900n })] });
    const result = portfolio(data, now);
    expect(result).toMatchObject({ outstandingCents: 10000n, overdueCents: 6000n, overdueCount: 1, repaidPrincipalCents: 20000n, reconciliationCents: 0n });
    expect(result.counts).toMatchObject({ Financed: 2, Repaid: 1, Unknown: 1 }); expect(result.payers).toHaveLength(1);
    expect(result.payers[0]).toMatchObject({ outstandingCents: 10000n, overdueCents: 6000n, count: 2 });
  });
  it('selects actual invoice logs and sorts by block/log index without inventing repayment', () => {
    const event = (blockNumber: number, logIndex: number, invoiceId = 1n): ChainEvent => ({ blockNumber, logIndex, invoiceId, name: 'InvoiceApproved', transactionHash: `0x${blockNumber}`, participants: [], detail: '' });
    const events = [event(3, 1), event(1, 2), event(1, 1), event(2, 1, 2n)];
    expect(invoiceHistory(events, 1n).map(row => [row.blockNumber, row.logIndex])).toEqual([[1, 1], [1, 2], [3, 1]]);
    expect(events[0].blockNumber).toBe(3); expect(invoiceHistory(events, 99n)).toEqual([]);
  });
});

describe('NAV and income scenarios', () => {
  const zero = { incomeCents: 0n, liabilitiesCents: 0n, impairmentBps: 0 };
  it('values holdings from the unrounded NAV ratio instead of rounded NAV per unit', () => {
    const data = snapshot({ availableFunds: 1n, totalSupply: 3000000n, connectedBalance: 1500000n });
    expect(navScenario(data, zero)).toMatchObject({ navPerRluMicros: 0n, holdingsValueCents: 50n, ownershipHundredths: 5000n });
  });
  it('does not double-count repayments and applies full impairment only to active principal', () => {
    const data = snapshot({ availableFunds: 900n, invoices: [invoice({ status: 'Financed' }), invoice({ id: 2n, status: 'Repaid', amount: 400n })] });
    expect(navScenario(data, { ...zero, impairmentBps: 10000 })).toMatchObject({ principalCents: 10000n, impairmentCents: 10000n, navCents: 90000n });
    expect(navScenario(snapshot({ invoices: [invoice({ status: 'Repaid' })] }), zero).navCents).toBe(100000n);
  });
  it('builds NAV from liquidity and active principal with explicit adjustments, never totalFundSize', () => {
    const data = snapshot({ totalFundSize: 9999n, availableFunds: 900n, invoices: [invoice({ status: 'Financed' }), invoice({ id: 2n, status: 'Repaid', amount: 999n })] });
    expect(navScenario(data, { incomeCents: 1000n, liabilitiesCents: 200n, impairmentBps: 1000 })).toMatchObject({ baseAssetsCents: 100000n, impairmentCents: 1000n, navCents: 99800n, navPerRluMicros: 998000n, holdingsValueCents: 24950n, ownershipHundredths: 2500n });
  });
  it('returns undefined ratios at zero supply while retaining asset information', () => {
    expect(navScenario(snapshot({ totalSupply: 0n, connectedBalance: 0n }), zero)).toMatchObject({ navCents: 100000n, navPerRluMicros: null, holdingsValueCents: null, ownershipHundredths: null });
  });
  it('retains negative NAV in stress scenarios and rejects inconsistent holdings', () => {
    expect(navScenario(snapshot(), { ...zero, liabilitiesCents: 200000n }).navCents).toBe(-100000n);
    expect(() => navScenario(snapshot({ connectedBalance: 1001n }), zero)).toThrow('inconsistent');
    expect(() => navScenario(snapshot(), { ...zero, impairmentBps: 10001 })).toThrow();
    expect(() => navScenario(snapshot(), { ...zero, incomeCents: -1n })).toThrow();
  });
  it('handles huge unit supplies and zero holdings without floating-point math', () => {
    const large = 90071992547409939999n;
    expect(navScenario(snapshot({ totalSupply: large, connectedBalance: large / 3n, availableFunds: large }), zero).navPerRluMicros).toBe(1000000n);
    expect(navScenario(snapshot({ connectedBalance: 0n }), zero).holdingsValueCents).toBe(0n);
  });
  it('does not recognize historical or overdue principal as fee income or automatically add a forecast to NAV', () => {
    const data = snapshot({ availableFunds: 900n, invoices: [invoice({ status: 'Financed' }), invoice({ id: 2n, status: 'Repaid', amount: 1000n }), invoice({ id: 3n, status: 'Financed', amount: 10n, maturity: now - DAY })] });
    Object.freeze(data); data.invoices.forEach(Object.freeze); Object.freeze(data.invoices);
    expect(prospectiveIncome(data, now, 1200)).toBe(99n);
    expect(navScenario(data, zero).navCents).toBe(101000n);
    expect(data.availableFunds).toBe(900n); expect(data.totalSupply).toBe(1000n);
    expect(prospectiveIncome(snapshot({ invoices: [invoice({ status: 'Repaid' })] }), now, 1200)).toBe(0n);
  });
});


describe('SME Home capacity uses the invoice assessment policy', () => {
  it('matches assessment headroom without a fabricated invoice or payer assumption', () => {
    const data = snapshot({ invoices: [invoice({ status: 'Financed', amount: 60n }), invoice({ id: 2n, status: 'Repaid', amount: 99n }), invoice({ id: 3n, status: 'Financed', sme: '0xother', amount: 10n })] });
    const capacity = borrowingCapacity(invoice().sme.toUpperCase(), data);
    const assessment = assessInvoice(invoice(), data, now, defaults, 'unassessed');
    expect(capacity.smeOutstandingCents).toBe(6000n);
    expect(capacity.remainingBorrowingCents).toBe(4000n);
    expect(capacity.remainingBorrowingCents).toBe(assessment.remainingBorrowingCents);
    expect(capacity.liquidAfterReserveCents).toBe(assessment.liquidAfterReserveCents);
    expect(capacity.indicativeCapacityCents).toBe(4000n);
  });
  it('clamps unavailable liquidity and explicit zero sales without inventing capacity', () => {
    expect(borrowingCapacity(invoice().sme, snapshot({ availableFunds: 0n })).indicativeCapacityCents).toBe(0n);
    expect(borrowingCapacity(invoice().sme, snapshot(), { ...defaults, annualSalesCents: 0n }).indicativeCapacityCents).toBe(0n);
  });
});


describe('live-testing S$500 invoice against a 10 percent payer cap', () => {
  it('rejects the full S$500 despite S$1100 liquidity and passes the exact S$110 boundary with no other exposure', () => {
    const fund = snapshot({ totalFundSize: 1100n, availableFunds: 1100n, maxPayerExposure: 110n });
    const oversized = assessInvoice(invoice({ amount: 500n }), fund, now, defaults, 'low');
    expect(oversized.contractEligible).toBe(false);
    expect(oversized.contractReasons.join(' ')).toContain('Full face value plus existing payer exposure');
    expect(oversized.contractReasons.join(' ')).not.toContain('exceeds available contract funds');
    expect(assessInvoice(invoice({ amount: 110n }), fund, now, defaults, 'low').contractEligible).toBe(true);
  });
});
