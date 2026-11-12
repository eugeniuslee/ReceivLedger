// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import type { ChainEvent, ChainInvoice } from '../chain/chainLedger';
import { Smes } from './Smes';
import { Finances } from './Finances';
import { MyProfile, Settings } from './Account';
import { resetBrowserStorage } from '../test/browserStorage';
import { resetPreferencesCache } from '../settings/preferences';

const DAY = 86_400n;
const now = BigInt(Date.UTC(2026, 10, 12, 1) / 1000);
const smeA = '0x' + 'aa'.repeat(20), smeB = '0x' + 'bb'.repeat(20);
vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn(), useOptionalLedger: () => null }));
vi.mock('../registration/RegistryContext', () => ({ useRegistry: vi.fn() }));
let financeData: unknown;
vi.mock('../finance/FinanceContext', () => ({ useFinance: () => ({ data: financeData, loading: false, error: null, now, refresh: vi.fn() }) }));

const invoice = (id: number, sme: string, amount: number, status: ChainInvoice['status'], dueInDays: number) => ({ id: BigInt(id), sme, payer: `Payer ${id}`, amount: BigInt(amount), maturity: now + BigInt(dueInDays) * DAY, status, rejectionReason: '' }) as ChainInvoice;
const event = (name: string, id: number, at: bigint) => ({ name, detail: '', invoiceId: BigInt(id), participants: [], timestamp: Number(at), blockNumber: Number(at), logIndex: 0, transactionHash: `0x${id}${name}` }) as unknown as ChainEvent;
// SME A: one S$200 invoice financed 10 days ago (due in 20); SME B: S$100 repaid after 30 days, and S$150 financed and overdue.
const invoices = [invoice(1, smeB, 100, 'Repaid', -10), invoice(2, smeB, 150, 'Financed', -2), invoice(3, smeA, 200, 'Financed', 20), invoice(4, smeA, 50, 'Submitted', 30)];
const events = [event('InvoiceFinanced', 1, now - 40n * DAY), event('InvoiceRepaid', 1, now - 10n * DAY), event('InvoiceFinanced', 2, now - 20n * DAY), event('InvoiceFinanced', 3, now - 10n * DAY)];
let registry: Record<string, unknown>;

beforeEach(() => {
  resetBrowserStorage(); resetPreferencesCache();
  financeData = { blockNumber: 9, blockTimestamp: now, totalSupply: 1000n, connectedBalance: 0n, totalFundSize: 1000n, availableFunds: 650n, maxPayerExposure: 100n, maxMaturityDays: 90n, invoices };
  vi.mocked(useLedger).mockReturnValue({ account: smeA, role: 'manager', networkOk: true, events, snapshot: { role: 'manager', invoices }, walletAvailable: true, walletChecking: false, transactionPending: false, disconnect: vi.fn(), connect: vi.fn() } as unknown as ReturnType<typeof useLedger>);
  registry = { configured: true, authenticated: true, busy: false, error: null, application: null, registeredName: null, signOut: vi.fn(), reload: vi.fn(), request: vi.fn().mockResolvedValue({}),
    displayName: (wallet: string) => wallet === smeA ? 'Alpha Trading' : null, nameInUse: (name: string) => name.trim().toLowerCase() === 'taken co' };
  vi.mocked(useRegistry).mockImplementation(() => registry as unknown as ReturnType<typeof useRegistry>);
});
afterEach(cleanup);

describe('SME tab', () => {
  it('summarises each SME and filters by name or wallet', () => {
    render(<Smes />);
    const summary = within(screen.getByLabelText('SME summary'));
    expect(summary.getByText('S$350.00')).toBeTruthy(); // S$150 + S$200 outstanding
    expect(within(summary.getByText('SMEs with overdue invoices').parentElement!).getByText('1')).toBeTruthy();
    const rows = screen.getAllByRole('row');
    expect(rows[1].textContent).toContain('1 overdue'); // overdue SME listed first
    fireEvent.change(screen.getByLabelText('Search SMEs by name or wallet'), { target: { value: 'alpha' } });
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('Alpha Trading')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(within(screen.getByLabelText('SME details')).getByText('#4')).toBeTruthy();
  });
});

describe('Finances tab', () => {
  it('explains the NAV as capital plus income and lists profit per invoice', () => {
    render(<Finances />);
    // Income: #1 repaid after 30 days (fee 0.10 + 90×5%×30/365 = 0.37), #2 overdue so interest stops at the due date: 18 days (0.15 + 0.33), #3 10 days (0.20 + 0.25).
    const summary = within(screen.getByLabelText('Fund summary'));
    expect(within(summary.getByText('Income earned').parentElement!).getByText('S$1.40')).toBeTruthy();
    expect(within(summary.getByText('Fund NAV').parentElement!).getByText('S$1,001.40')).toBeTruthy();
    const bridge = within(screen.getByRole('heading', { name: 'How the NAV is built' }).parentElement!);
    expect(bridge.getByText('S$1,000.00')).toBeTruthy();
    const table = within(screen.getByRole('heading', { name: 'Invoice income' }).closest('section')!);
    expect(table.getAllByRole('row')).toHaveLength(5); // header + 3 invoices + total
    fireEvent.click(table.getByRole('button', { name: 'Repaid' }));
    expect(table.getAllByRole('row')).toHaveLength(3);
    expect(table.getAllByText('S$0.47').length).toBeGreaterThan(0); // profit on #1
  });
});

describe('Settings', () => {
  it('saves typical display preferences', () => {
    render(<Settings rememberPage onRememberPage={() => true} />);
    const badges = screen.getByRole('checkbox', { name: /Show notification badges/ }) as HTMLInputElement;
    expect(badges.checked).toBe(true);
    fireEvent.click(badges);
    expect(badges.checked).toBe(false);
    expect(JSON.parse(window.localStorage.getItem('receivledger:preferences:v1')!).showBadges).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Large' }));
    expect(screen.getByRole('button', { name: 'Large' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Clear cache' }));
    expect(screen.getByRole('button', { name: 'Clear and reload' })).toBeTruthy();
  });
});

describe('My Profile', () => {
  beforeEach(() => {
    vi.mocked(useLedger).mockReturnValue({ account: smeA, role: 'sme', networkOk: true, snapshot: null, events: [] } as unknown as ReturnType<typeof useLedger>);
    registry.application = { id: 'app', kind: 'sme', status: 'approved', display_name: 'Alpha Trading', company_number: 'UEN1' };
    registry.registeredName = 'Alpha Trading';
  });

  it('lets the user pick a profile icon', () => {
    render(<MyProfile />);
    fireEvent.click(screen.getByRole('button', { name: 'Icon 🦊' }));
    expect(screen.getByRole('button', { name: 'Icon 🦊' }).getAttribute('aria-pressed')).toBe('true');
    expect(window.localStorage.getItem(`receivledger:avatar:${smeA}`)).toBe('🦊');
  });

  it('blocks a name already in use and renames to a unique name', async () => {
    render(<MyProfile />);
    const input = screen.getByLabelText('New registered name');
    const save = screen.getByRole('button', { name: 'Save name' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // unchanged
    fireEvent.change(input, { target: { value: '  Taken Co ' } });
    expect(screen.getByText('That name is already used. Choose a different name.')).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'Alpha Trading Pte Ltd' } });
    fireEvent.click(save);
    await waitFor(() => expect(registry.request).toHaveBeenCalledWith({ action: 'rename', display_name: 'Alpha Trading Pte Ltd' }));
    expect(await screen.findByText('Registered name updated.')).toBeTruthy();
    expect(registry.reload).toHaveBeenCalled();
  });
});
