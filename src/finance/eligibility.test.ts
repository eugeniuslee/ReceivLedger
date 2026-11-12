import { describe, expect, it } from 'vitest';
import { assessFinancing, smeLimits } from './eligibility';
import type { ChainInvoice } from '../chain/chainLedger';

const me = '0x' + 'aa'.repeat(20), other = '0x' + 'bb'.repeat(20);
const invoice = (sme: string, payer: string, amount: number, status: ChainInvoice['status']) => ({ id: 1n, sme, payer, amount: BigInt(amount), maturity: 0n, status, rejectionReason: '' }) as ChainInvoice;
const base = { sme: me, registrationApproved: true, payer: 'Acme', asOf: 0, navCents: 100_000_000n, availableFundsCents: 50_000_000n, invoices: [] as ChainInvoice[] }; // NAV S$1m

describe('SME financing rules', () => {
  it('approves automatically when every automatic rule passes', () => {
    const result = assessFinancing({ ...base, invoiceCents: 400_000n, days: 30n });
    expect(result.decision).toBe('automatic');
    expect(result.checks.every(check => check.status === 'pass')).toBe(true);
  });

  it('sends larger or longer invoices to manager review', () => {
    expect(assessFinancing({ ...base, invoiceCents: 600_000n, days: 30n }).decision).toBe('review'); // > S$5,000
    expect(assessFinancing({ ...base, invoiceCents: 400_000n, days: 31n }).decision).toBe('review'); // > 30 days
  });

  it('blocks maturities beyond 90 days, unapproved SMEs, and missing cash', () => {
    expect(assessFinancing({ ...base, invoiceCents: 100_000n, days: 91n }).decision).toBe('blocked');
    expect(assessFinancing({ ...base, invoiceCents: 100_000n, days: 10n, registrationApproved: false }).decision).toBe('blocked');
    expect(assessFinancing({ ...base, invoiceCents: 100_000n, days: 10n, availableFundsCents: 50_000n }).decision).toBe('blocked');
  });

  it('enforces the S$100,000 exposure cap including approved and financed invoices', () => {
    const invoices = [invoice(me, 'X', 60_000, 'Financed'), invoice(me, 'Y', 30_000, 'Approved'), invoice(me, 'Z', 50_000, 'Repaid')];
    const check = assessFinancing({ ...base, invoices, invoiceCents: 1_100_000n, days: 30n }).checks.find(row => row.rule === 'Maximum SME borrowing exposure');
    expect(check?.status).toBe('fail'); // 90,000 + 11,000 > 100,000
  });

  it('keeps automatic SME exposure strictly below 1% of NAV', () => {
    const at = (cents: bigint) => assessFinancing({ ...base, invoiceCents: cents, days: 10n }).checks.find(row => row.rule === 'Automatic SME concentration')?.status;
    expect(at(999_999n)).toBe('pass');
    expect(at(1_000_000n)).toBe('review'); // exactly 1% is not "below"
  });

  it('caps one payer at 10% of NAV across all SMEs', () => {
    const invoices = [invoice(other, 'ACME', 99_000, 'Financed')]; // another SME, same payer (case-insensitive)
    const check = assessFinancing({ ...base, invoices, invoiceCents: 200_000n, days: 10n }).checks.find(row => row.rule === 'Common customer/payer concentration');
    expect(check?.status).toBe('fail'); // 99,000 + 2,000 > 100,000
  });

  it('works out the cash advance limit from exposure, cash and the 90% advance', () => {
    const limits = smeLimits({ sme: me, invoices: [invoice(me, 'X', 40_000, 'Financed')], navCents: 100_000_000n, availableFundsCents: 50_000_000n, asOf: 0 });
    expect(limits.exposureRemainingCents).toBe(6_000_000n);
    expect(limits.cashAdvanceLimitCents).toBe(5_400_000n); // 90% of S$60,000
    // Automatic: min(S$5,000, facility S$50,000 - 0, just under 1% NAV S$10,000 - S$40,000 → 0) = 0
    expect(limits.autoCashAdvanceLimitCents).toBe(0n);
  });
});
