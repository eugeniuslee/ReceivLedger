// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLedger } from '../chain/LedgerContext';
import { FinanceProvider } from './FinanceContext';
import { RegistryProvider, useRegistry } from '../registration/RegistryContext';
import { Dashboard } from '../pages/Dashboard';
import { Reports } from '../pages/Reports';
import { testInvoice, testNow, testSnapshot } from './fixtures';

vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn() }));
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
  it('refreshes manager reporting from read-only snapshots and never counts repaid principal twice', async () => {
    const financed = testInvoice({ status: 'Financed' });
    const repaid = testInvoice({ id: 2n, status: 'Repaid', amount: 400n });
    read.mockResolvedValueOnce(testSnapshot({ availableFunds: 900n, invoices: [financed, repaid] }))
      .mockResolvedValueOnce(testSnapshot({ blockNumber: 124, availableFunds: 1000n, invoices: [{ ...financed, status: 'Repaid' }, repaid] }));
    render(<Harness />);
    expect(screen.getByText('Supabase disabled')).toBeTruthy();
    await waitFor(() => expect(within(metric('Outstanding principal')).getByText('S$100.00')).toBeTruthy());
    expect(within(metric('Illustrative fund NAV')).getByText('S$1,000.00')).toBeTruthy();
    expect(screen.getByText('S$0.99')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh report' }));
    await waitFor(() => expect(screen.getByText(/Sepolia block 124/)).toBeTruthy());
    expect(within(metric('Outstanding principal')).getByText('S$0.00')).toBeTruthy();
    expect(within(metric('Available financing capacity')).getByText('S$1,000.00')).toBeTruthy();
    expect(within(metric('Illustrative fund NAV')).getByText('S$1,000.00')).toBeTruthy();
    expect(screen.getByText(/No outstanding financed invoices/)).toBeTruthy();
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it('keeps inactive holdings visible, then clears the investment illustration when switching to an SME', async () => {
    wallet = { ...wallet, role: 'inactiveInvestor', snapshot: { role: 'inactiveInvestor', manager: other, approved: false, connectedBalance: 250n } };
    read.mockResolvedValueOnce(testSnapshot());
    const view = render(<Harness />);
    await screen.findByText('25.00%');
    fireEvent.change(screen.getByLabelText('Assumed additional fund income (S$)'), { target: { value: '100' } });
    expect(screen.getByText('S$275.00')).toBeTruthy();
    const row = testInvoice({ sme: other });
    wallet = { ...wallet, account: other, role: 'sme', snapshot: { role: 'sme', manager: own, invoices: [row] } };
    read.mockResolvedValueOnce(testSnapshot({ connectedBalance: 0n, invoices: [row, testInvoice({ id: 2n, payer: 'Unrelated wallet payer' })] }));
    view.rerender(<Harness />);
    expect(screen.queryByText('S$275.00')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Your investment illustration' })).toBeNull();
    await screen.findByRole('option', { name: '#1 · Example payer' });
    expect(screen.queryByRole('option', { name: /Unrelated wallet payer/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Fund financial reporting' })).toBeNull();
    expect(screen.getByText('Supabase disabled')).toBeTruthy();
    expect(read).toHaveBeenLastCalledWith(other);
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
});
