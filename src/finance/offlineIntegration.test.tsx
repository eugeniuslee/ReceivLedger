// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLedger } from '../chain/LedgerContext';
import { FinanceProvider } from './FinanceContext';
import { RegistryProvider, useRegistry } from '../registration/RegistryContext';
import { Dashboard } from '../pages/Dashboard';
import { Reports } from '../pages/Reports';
import { testInvoice, testNow, testSnapshot } from './fixtures';

vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn(), useOptionalLedger: () => null }));
// Keep this test offline: the merged manager page also embeds the fund-contract panel.
vi.mock('../v2/usePublicReport', () => ({ usePublicReport: () => ({ report: null, loading: false, error: '', read: vi.fn() }) }));
let wallet: ReturnType<typeof useLedger>;
let read: ReturnType<typeof vi.fn>;
const own = testInvoice().sme;
const other = '0x2222222222222222222222222222222222222222';
function Views() {
  const registry = useRegistry();
  return <><span>{registry.configured ? 'Supabase enabled' : 'Supabase disabled'}</span>{wallet.role === 'manager' ? <Reports /> : <Dashboard />}</>;
}
function Harness() {
  return <FinanceProvider><RegistryProvider client={null}><Views /></RegistryProvider></FinanceProvider>;
}
function metric(label: string) { return screen.getByText(label, { selector: '.metric > span' }).parentElement!; }
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Number(testNow) * 1000);
  read = vi.fn();
  wallet = { account: own, role: 'manager', networkOk: true, snapshot: null, loading: false,
    ledger: { readFinancialSnapshot: read }, runTransaction: vi.fn(() => { throw new Error('Transactions are forbidden in this read-only test.'); }) } as unknown as ReturnType<typeof useLedger>;
  vi.mocked(useLedger).mockImplementation(() => wallet);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('financial contexts and screens with Supabase explicitly disabled', () => {
  it('refreshes manager finances from read-only snapshots and never counts repaid principal twice', async () => {
    const financed = testInvoice({ status: 'Financed' });
    const repaid = testInvoice({ id: 2n, status: 'Repaid', amount: 400n });
    read.mockResolvedValueOnce(testSnapshot({ availableFunds: 900n, invoices: [financed, repaid] }))
      .mockResolvedValueOnce(testSnapshot({ blockNumber: 124, availableFunds: 1000n, invoices: [{ ...financed, status: 'Repaid' }, repaid] }));
    const view = render(<Harness />);
    expect(screen.getByText('Supabase disabled')).toBeTruthy();
    // S$100 financed (+S$0.10 fee) and S$400 repaid (+S$0.40 fee collected); lifecycle dates are not indexed here.
    await waitFor(() => expect(within(metric('Receivables from SMEs')).getByText('S$100.10')).toBeTruthy());
    expect(within(metric('Fund NAV')).getByText('S$1,000.50')).toBeTruthy();
    expect(within(metric('Income earned')).getByText('S$0.50')).toBeTruthy();
    wallet = { ...wallet, snapshot: {} as typeof wallet.snapshot };
    view.rerender(<Harness />);
    await waitFor(() => expect(within(metric('Receivables from SMEs')).getByText('S$0.00')).toBeTruthy());
    expect(within(metric('Available funds')).getByText('S$1,000.00')).toBeTruthy();
    expect(within(metric('Fund NAV')).getByText('S$1,000.50')).toBeTruthy();
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it('keeps inactive holdings visible, then clears the holding view when switching to an SME', async () => {
    wallet = { ...wallet, role: 'inactiveInvestor', snapshot: { role: 'inactiveInvestor', manager: other, approved: false, connectedBalance: 250n } };
    read.mockResolvedValueOnce(testSnapshot());
    const view = render(<Harness />);
    await screen.findByText('25.00%');
    expect(within(screen.getByLabelText('Your holding')).getByText('S$250.00')).toBeTruthy(); // 250 of 1,000 RLU at S$1,000 NAV
    const row = testInvoice({ sme: other });
    wallet = { ...wallet, account: other, role: 'sme', snapshot: { role: 'sme', manager: own, invoices: [row] } };
    read.mockResolvedValueOnce(testSnapshot({ connectedBalance: 0n, invoices: [row, testInvoice({ id: 2n, payer: 'Unrelated wallet payer' })] }));
    view.rerender(<Harness />);
    expect(screen.queryByLabelText('Your holding')).toBeNull();
    // The SME Home lists only this wallet's invoices, never another SME's.
    expect(await screen.findByText('#1')).toBeTruthy();
    expect(screen.queryByText('Unrelated wallet payer')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Fund financial reporting' })).toBeNull();
    expect(screen.getByText('Supabase disabled')).toBeTruthy();
    expect(read).toHaveBeenLastCalledWith(other);
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
});
