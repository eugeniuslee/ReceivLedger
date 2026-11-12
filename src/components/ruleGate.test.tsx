// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import type { ChainInvoice } from '../chain/chainLedger';
import { Invoices } from '../pages/Invoices';

const DAY = 86_400n;
const now = BigInt(Date.UTC(2026, 10, 12, 1) / 1000);
const sme = '0x' + 'aa'.repeat(20);
let ledger: Record<string, unknown>;
let invoices: ChainInvoice[];
vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn(), useOptionalLedger: () => ledger }));
vi.mock('../registration/RegistryContext', () => ({ useRegistry: vi.fn() }));
vi.mock('../registration/access', () => ({ useRegistrationAccess: () => ({ invoiceAllowed: true, transferAllowed: false, reason: '', authorize: vi.fn() }) }));
// Fund: S$1,000,000 capital, all available, nothing financed → NAV S$1,000,000.
vi.mock('../finance/FinanceContext', () => ({ useFinance: () => ({ data: { blockNumber: 1, blockTimestamp: now, totalSupply: 1_000_000n, connectedBalance: 0n, totalFundSize: 1_000_000n, availableFunds: 1_000_000n, maxPayerExposure: 100_000n, maxMaturityDays: 90n, invoices }, loading: false, error: null, now, refresh: vi.fn() }) }));
const invoice = (id: number, amount: number, status: ChainInvoice['status']) => ({ id: BigInt(id), sme, payer: 'Big Buyer', amount: BigInt(amount), maturity: now + 30n * DAY, status, rejectionReason: '' }) as ChainInvoice;

function open(id: number) {
  render(<Invoices mode="list" />);
  fireEvent.click(screen.getByRole('button', { name: `#${id}` }));
  return within(screen.getByRole('dialog'));
}

beforeEach(() => {
  ledger = { account: '0x' + '79'.repeat(20), role: 'manager', networkOk: true, events: [], lifecycleEvents: [], transactionPending: false, loading: false, ledger: { getPayerExposure: vi.fn().mockResolvedValue(0n), getMaxPayerExposure: vi.fn().mockResolvedValue(100_000n) }, runTransaction: vi.fn() };
  vi.mocked(useLedger).mockImplementation(() => ledger as unknown as ReturnType<typeof useLedger>);
  vi.mocked(useRegistry).mockReturnValue({ configured: true, authenticated: true, request: vi.fn(async () => [{ wallet: sme, kind: 'sme', status: 'approved' }]), displayName: () => null } as unknown as ReturnType<typeof useRegistry>);
});
afterEach(cleanup);

describe('manager confirmation for financing rules', () => {
  it('lists the broken guidelines under Risk Management Guidelines and needs CONFIRM before approving', async () => {
    invoices = [invoice(7, 120_000, 'Submitted')];
    ledger.snapshot = { role: 'manager', invoices, availableFunds: 1_000_000n };
    const dialog = open(7);
    const warning = within(await dialog.findByRole('alert'));
    expect(warning.getByText('Risk Management Guidelines')).toBeTruthy();
    // S$120,000 invoice → S$108,000 cash advance: over the S$100,000 loan cap and 1% of the S$1,000,000 NAV.
    expect(warning.getByText(/Cash to advance S\$108,000\.00 is more than the maximum loan of S\$100,000\.00/)).toBeTruthy();
    expect(warning.getByText(/is more than the SME concentration limit of S\$10,000\.00 \(1% of NAV S\$1,000,000\.00\)/)).toBeTruthy();
    const approve = dialog.getByRole('button', { name: 'Approve invoice' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.change(warning.getByLabelText(/Type CONFIRM/), { target: { value: 'confirm' } });
    expect(approve.disabled).toBe(true); // must be typed exactly
    fireEvent.change(warning.getByLabelText(/Type CONFIRM/), { target: { value: 'CONFIRM' } });
    expect(approve.disabled).toBe(false);
  });

  it('also guards financing, without counting the approved invoice twice', async () => {
    invoices = [invoice(8, 120_000, 'Approved')];
    ledger.snapshot = { role: 'manager', invoices, availableFunds: 1_000_000n };
    const dialog = open(8);
    // The approved invoice itself is not counted as already advanced.
    expect(within(await dialog.findByRole('alert')).getByText(/^Cash to advance S\$108,000\.00 is more than the maximum loan/)).toBeTruthy();
    expect((dialog.getByRole('button', { name: /Finance full/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not interrupt invoices within the rules', () => {
    invoices = [invoice(9, 5_000, 'Submitted')];
    ledger.snapshot = { role: 'manager', invoices, availableFunds: 1_000_000n };
    const dialog = open(9);
    expect(dialog.queryByLabelText(/Type CONFIRM/)).toBeNull();
    expect((dialog.getByRole('button', { name: 'Approve invoice' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
