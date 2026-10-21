import { describe, expect, it } from 'vitest';
import { D } from '../constants';
import { MGR, W } from '../demo/demoData';
import { seed } from '../demo/seed';
import { demoLedger as L, exposure, maxExp } from './demoLedger';

const fresh = () => { const s = seed(); s.caller = MGR; return s; };
const submitApproved = (s: ReturnType<typeof fresh>, payer: string, amt: number, days = 30) => {
  const id = L.submitInvoice(s, payer, amt, s.now + days * D); L.approveInvoice(s, id); return id;
};

describe('demo ledger mirrors ReceivLedger.sol', () => {
  it('seed is consistent: outstanding = total - available', () => {
    const s = fresh();
    const financed = s.invoices.filter(i => i.status === 2).reduce((a, i) => a + i.amount, 0);
    expect(s.total - s.avail).toBe(financed);
    expect(maxExp(s)).toBe(s.total / 10);
  });
  it('financing reduces available funds and raises payer exposure (case-insensitive payer)', () => {
    const s = fresh(); const a0 = s.avail, e0 = exposure(s, 'nova telecom');
    const id = submitApproved(s, 'Nova Telecom', 10000);
    expect(L.financeInvoice(s, id)).toBeNull();
    expect(s.avail).toBe(a0 - 10000);
    expect(exposure(s, 'NOVA TELECOM')).toBe(e0 + 10000);
  });
  it('rejects (does not revert) when the 10% payer limit is exceeded', () => {
    const s = fresh(); const id = submitApproved(s, 'Changi Retail Group', 20000);
    expect(L.financeInvoice(s, id)).toBe('Payer exposure limit exceeded');
    expect(s.invoices.find(i => i.id === id)!.status).toBe(3);
  });
  it('rejects maturity over 90 days, matured invoices and insufficient funds', () => {
    const s = fresh();
    expect(L.financeInvoice(s, submitApproved(s, 'A Co', 1000, 120))).toBe('Maturity exceeds 90 days');
    const m = submitApproved(s, 'B Co', 1000, 5); s.now += 10 * D;
    expect(L.financeInvoice(s, m)).toBe('Invoice already matured');
    s.now -= 10 * D; s.avail = 500;
    expect(L.financeInvoice(s, submitApproved(s, 'C Co', 1000))).toBe('Insufficient available funds');
  });
  it('repayment returns principal and lowers exposure', () => {
    const s = fresh(); const id = s.invoices.find(i => i.status === 2)!.id;
    const a0 = s.avail; const inv = s.invoices.find(i => i.id === id)!;
    L.recordRepayment(s, id);
    expect(s.avail).toBe(a0 + inv.amount);
    expect(() => L.recordRepayment(s, id)).toThrow('Invoice is not financed');
  });
  it('manager-only functions revert for other wallets; submitInvoice is open', () => {
    const s = fresh(); s.caller = W.sme;
    expect(() => L.approveInvoice(s, 1)).toThrow('Only manager can perform this action');
    expect(() => L.issueFundUnits(s, W.inv, 1)).toThrow('Only manager can perform this action');
    expect(L.submitInvoice(s, 'X', 1, s.now + D)).toBeGreaterThan(0);
  });
  it('enforces fund cap and approved-only transfers', () => {
    const s = fresh();
    expect(() => L.issueFundUnits(s, W.inv, 1_000_000)).toThrow('Maximum fund size exceeded');
    const kestrel = Object.keys(s.inv).find(k => !s.inv[k].ok)!;
    expect(() => L.transfer(s, W.inv, kestrel, 1)).toThrow('Receiver is not an approved investor');
  });
});
