// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import type { ChainEvent, ChainInvoice } from '../chain/chainLedger';
import { Invoices } from '../pages/Invoices';
import { Finances } from '../pages/Finances';
import { setCreditsForTest } from '../finance/credits';

const DAY = 86_400n;
const now = BigInt(Date.UTC(2026, 10, 12, 1) / 1000);
const sme = '0x' + 'aa'.repeat(20);
let ledger: Record<string, unknown>;
const invoices = [{ id: 6n, sme, payer: 'Buyer', amount: 1_000n, maturity: now + 30n * DAY, status: 'Financed', rejectionReason: '' }] as ChainInvoice[];
const events = [{ name: 'InvoiceFinanced', detail: '', invoiceId: 6n, participants: [], timestamp: Number(now - 30n * DAY), blockNumber: 1, logIndex: 0, transactionHash: '0x6' }] as unknown as ChainEvent[];
vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn(), useOptionalLedger: () => ledger }));
vi.mock('../registration/RegistryContext', () => ({ useRegistry: vi.fn() }));
vi.mock('../registration/access', () => ({ useRegistrationAccess: () => ({ invoiceAllowed: true, transferAllowed: false, reason: '', authorize: vi.fn() }) }));
vi.mock('../registration/client', async original => ({ ...(await original<typeof import('../registration/client')>()), registryClient: null }));
vi.mock('../finance/FinanceContext', () => ({ useFinance: () => ({ data: { blockNumber: 1, blockTimestamp: now, totalSupply: 10_000n, connectedBalance: 0n, totalFundSize: 10_000n, availableFunds: 9_000n, maxPayerExposure: 1_000n, maxMaturityDays: 90n, invoices }, loading: false, error: null, now, refresh: vi.fn() }) }));
let request: ReturnType<typeof vi.fn>;

beforeEach(() => {
  setCreditsForTest(new Map());
  ledger = { account: '0x' + '79'.repeat(20), role: 'manager', networkOk: true, events, lifecycleEvents: events, snapshot: { role: 'manager', invoices, availableFunds: 9_000n }, transactionPending: false, loading: false,
    ledger: { getPayerExposure: vi.fn().mockResolvedValue(0n), getMaxPayerExposure: vi.fn().mockResolvedValue(1_000n) }, runTransaction: vi.fn() };
  vi.mocked(useLedger).mockImplementation(() => ledger as unknown as ReturnType<typeof useLedger>);
  request = vi.fn(async () => ({}));
  vi.mocked(useRegistry).mockReturnValue({ configured: true, authenticated: true, request, displayName: () => null } as unknown as ReturnType<typeof useRegistry>);
});
afterEach(cleanup);

describe('recording bad debt', () => {
  it('lets the manager write off a financed invoice, previewing the loss first', async () => {
    render(<Invoices mode="list" />);
    fireEvent.click(screen.getByRole('button', { name: '#6' }));
    const panel = within(screen.getByLabelText('Credit status'));
    fireEvent.click(panel.getByRole('button', { name: 'Write off' }));
    fireEvent.change(panel.getByLabelText('Amount recovered so far (S$)'), { target: { value: '50' } });
    // Owed = S$900 advance + S$1.00 fee + 30 days' interest S$3.70 = S$904.70; loss = S$854.70.
    expect(panel.getByText('S$904.70')).toBeTruthy();
    expect(panel.getByText('S$854.70')).toBeTruthy();
    expect((panel.getByRole('button', { name: 'Save credit status' }) as HTMLButtonElement).disabled).toBe(true); // reason required
    fireEvent.change(panel.getByLabelText('Reason'), { target: { value: 'SME liquidated' } });
    fireEvent.click(panel.getByRole('button', { name: 'Save credit status' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith({ action: 'set_invoice_credit', invoice_id: '6', stage: 'written_off', note: 'SME liquidated', version: 0, recovered_cents: '5000' }));
  });

  it('shows the loss in the NAV breakdown and the invoice income table', () => {
    setCreditsForTest(new Map([['6', { stage: 'written_off', expectedRecoveryBps: null, recoveredCents: 5_000n, effectiveAt: now, version: 2 }]]));
    render(<Finances />);
    const bridge = within(screen.getByRole('heading', { name: 'How the NAV is built' }).parentElement!);
    expect(bridge.getByText('−S$854.70')).toBeTruthy();
    const table = within(screen.getByRole('heading', { name: 'Invoice income' }).closest('section')!);
    expect(table.getByText('Written off')).toBeTruthy();
    // NAV = S$9,000 available + S$100 holdback + S$50 recovered
    expect(within(screen.getByLabelText('Fund summary')).getByText('S$9,150.00')).toBeTruthy();
  });
});
