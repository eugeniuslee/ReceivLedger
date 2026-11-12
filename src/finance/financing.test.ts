import { describe, expect, it } from 'vitest';
import { calculateFinancing, endOfSgtDate, estimateSubmission, FINANCING_TERMS, financedInvoiceCharges, financingDays, fundNav, ledgerNav, termsAt, type FinancingTerms } from './financing';
import type { ChainEvent, ChainInvoice } from '../chain/chainLedger';

const DAY = 86_400n;
// 12 Nov 2026, 09:00 SGT
const now = BigInt(Date.UTC(2026, 10, 12, 1, 0, 0) / 1000);
const standard = termsAt(now);
const dateIn = (days: number) => endOfSgtDate(new Date(Date.UTC(2026, 10, 12 + days)).toISOString().slice(0, 10))!;

describe('financing formulas', () => {
  it('uses 90% advance, 10% holdback, 0.1% service fee and 5% p.a. by default', () => {
    expect(standard).toMatchObject({ advanceBps: 9000, serviceFeeBps: 10, annualInterestBps: 500 });
  });

  it('matches the S$200 / 60-day worked example', () => {
    const r = calculateFinancing(20_000n, 60n, standard);
    expect(r.advanceCents).toBe(18_000n);
    expect(r.holdbackCents).toBe(2_000n);
    expect(r.serviceFeeCents).toBe(20n);
    expect(r.interestCents).toBe(148n);          // 180 × 0.05 × 60 / 365 = 1.479…
    expect(r.payableCents).toBe(18_168n);        // S$181.68
    expect(r.holdbackReleasedCents).toBe(1_832n); // S$18.32
    expect(r.smeTopUpCents).toBe(0n);
  });

  it('recalculates interest on actual days for early repayment; the fee is unchanged', () => {
    const financedAt = now, dueDate = dateIn(60), repaidAt = now + 30n * DAY;
    const actual = financedInvoiceCharges({ invoiceCents: 20_000n, dueDate, financedAt, repaidAt }, now + 90n * DAY);
    expect(actual.days).toBe(30n);
    expect(actual.interestCents).toBe(74n);  // 180 × 0.05 × 30 / 365 = 0.739…
    expect(actual.serviceFeeCents).toBe(20n);
    expect(actual.payableCents).toBe(18_094n); // S$180.94
    expect(actual.actual).toBe(true);
  });

  it('accrues interest to date before repayment and stops at the due date', () => {
    const financedAt = now - 3n * DAY;
    expect(financedInvoiceCharges({ invoiceCents: 15_000n, dueDate: dateIn(50), financedAt }, now).days).toBe(3n);
    const overdue = financedInvoiceCharges({ invoiceCents: 15_000n, dueDate: dateIn(10), financedAt }, now + 40n * DAY);
    expect(overdue.days).toBe(13n);
    expect(overdue.cappedAtDueDate).toBe(true);
  });

  it('does not compound interest', () => {
    const year = calculateFinancing(100_000n, 365n, standard);
    expect(year.interestCents).toBe(4_500n); // exactly 5% of the S$900 advance
  });

  it('rejects zero/negative amounts and negative periods', () => {
    expect(() => calculateFinancing(0n, 10n, standard)).toThrow(/greater than zero/);
    expect(() => calculateFinancing(-1n, 10n, standard)).toThrow();
    expect(() => calculateFinancing(100n, -1n, standard)).toThrow(/negative/);
  });

  it('reports charges beyond the holdback as an SME top-up rather than a negative release', () => {
    const r = calculateFinancing(10_000n, 36_500n, standard);
    expect(r.holdbackReleasedCents).toBe(0n);
    expect(r.smeTopUpCents).toBeGreaterThan(0n);
  });

  it('keeps historical invoices on the terms in force when they were financed', () => {
    const schedule: FinancingTerms[] = [...FINANCING_TERMS, { version: 'future', effectiveFrom: Number(now), advanceBps: 8000, serviceFeeBps: 50, annualInterestBps: 900 }];
    expect(termsAt(now - DAY, schedule).version).toBe(FINANCING_TERMS[0].version);
    expect(termsAt(now, schedule).version).toBe('future');
  });
});

describe('dates', () => {
  it('counts whole Singapore calendar days and never goes negative', () => {
    expect(financingDays(now, dateIn(60))).toBe(60n);
    expect(financingDays(now, now - DAY)).toBe(0n);
  });

  it('rejects malformed and impossible dates', () => {
    expect(endOfSgtDate('2026-02-30')).toBeNull();
    expect(endOfSgtDate('12/11/2026')).toBeNull();
    expect(endOfSgtDate('')).toBeNull();
  });

  it('validates the submission form inputs', () => {
    expect(estimateSubmission({ invoiceCents: null, dueDate: null, expectedPaymentDate: null, now }).errors).toHaveLength(3);
    expect(estimateSubmission({ invoiceCents: 0n, dueDate: dateIn(30), expectedPaymentDate: dateIn(10), now }).errors[0]).toMatch(/greater than zero/);
    expect(estimateSubmission({ invoiceCents: 100n, dueDate: dateIn(0), expectedPaymentDate: dateIn(0), now }).errors[0]).toMatch(/future/);
    expect(estimateSubmission({ invoiceCents: 100n, dueDate: dateIn(30), expectedPaymentDate: dateIn(-1), now }).errors[0]).toMatch(/earlier than today/);
  });

  it('estimates to the expected payment date and caps it at the due date with a warning', () => {
    const early = estimateSubmission({ invoiceCents: 20_000n, dueDate: dateIn(60), expectedPaymentDate: dateIn(30), now });
    expect(early.maximumDays).toBe(60n);
    expect(early.estimatedDays).toBe(30n);
    expect(early.breakdown?.payableCents).toBe(18_094n);
    const late = estimateSubmission({ invoiceCents: 20_000n, dueDate: dateIn(60), expectedPaymentDate: dateIn(75), now });
    expect(late.warnings).toHaveLength(1);
    expect(late.estimatedDays).toBe(60n);
    expect(late.breakdown?.payableCents).toBe(18_168n);
  });
});

describe('fund NAV', () => {
  const invoice = (id: number, amount: number, status: ChainInvoice['status'], maturity: bigint) => ({ id: BigInt(id), sme: '0x1', payer: 'p', amount: BigInt(amount), maturity, status, rejectionReason: '' }) as ChainInvoice;
  const financed = (id: number, at: bigint) => ({ name: 'InvoiceFinanced', detail: '', invoiceId: BigInt(id), participants: [], timestamp: Number(at), blockNumber: 1, logIndex: 0, transactionHash: '0x' }) as unknown as ChainEvent;

  it('adds invoice amounts, service fees and interest accrued to date to available funds', () => {
    const invoices = [invoice(5, 100, 'Financed', dateIn(19)), invoice(6, 150, 'Financed', dateIn(50)), invoice(4, 200, 'Approved', dateIn(34)), invoice(2, 500, 'Repaid', dateIn(5))];
    const nav = ledgerNav({ availableFunds: 1_950n, invoices }, [financed(5, now - 3n * DAY), financed(6, now - 3n * DAY)], now);
    expect(nav.outstandingCents).toBe(25_000n);
    expect(nav.serviceFeesCents).toBe(25n);            // 0.10 + 0.15
    expect(nav.accruedInterestCents).toBe(4n + 6n);    // 90×.05×3/365 = 0.037; 135×.05×3/365 = 0.055
    expect(nav.realisedFeesCents).toBe(50n); // repaid S$500 invoice: fee known, dates not indexed in this fixture
    expect(nav.navCents).toBe(195_000n + 25_000n + 25n + 10n + 50n);
    expect(nav.missingFinancingDates).toBe(1);
  });

  it('keeps income earned on repaid invoices in NAV (NAV = capital + all income)', () => {
    const repaidEvent = (id: number, name: string, at: bigint) => ({ ...financed(id, at), name }) as ChainEvent;
    const invoices = [invoice(2, 500, 'Repaid', dateIn(30))];
    const events = [repaidEvent(2, 'InvoiceFinanced', now - 40n * DAY), repaidEvent(2, 'InvoiceRepaid', now - 10n * DAY)];
    const nav = ledgerNav({ availableFunds: 1_000n, invoices }, events, now);
    expect(nav.outstandingCents).toBe(0n);
    expect(nav.realisedFeesCents).toBe(50n);
    expect(nav.realisedInterestCents).toBe(185n); // 450 × 5% × 30 / 365 = 1.849…
    expect(nav.navCents).toBe(100_000n + 235n);
    expect(nav.totalIncomeCents).toBe(235n);
  });

  it('still counts the fee and reports missing financing dates when events are not indexed', () => {
    const nav = fundNav({ availableFundsCents: 0n, invoices: [{ id: 1n, invoiceCents: 10_000n, dueDate: dateIn(10), financed: true }], financedAt: new Map(), asOf: now });
    expect(nav.missingFinancingDates).toBe(1);
    expect(nav.serviceFeesCents).toBe(10n);
    expect(nav.accruedInterestCents).toBe(0n);
  });
});
