// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLedger } from '../chain/LedgerContext';
import { useFinance } from './FinanceContext';
import { testInvoice, testNow, testSnapshot } from './fixtures';
import { InvestorReporting, Reports, SmeFinancingAssessment } from '../pages/Reports';
import { Invoices } from '../pages/Invoices';
import { Dashboard } from '../pages/Dashboard';
import { canAccessPage, navigationForRole } from '../chain/access';
import type { ChainLedger, WalletRole } from '../chain/chainLedger';
vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn() }));
vi.mock('./FinanceContext', () => ({ useFinance: vi.fn() }));
let wallet: ReturnType<typeof useLedger>;
let finance: ReturnType<typeof useFinance>;
beforeEach(() => {
  wallet = { account: testInvoice().sme, role: 'manager', networkOk: true, loading: false, snapshot: null, events: [], eventsLoading: false, eventsError: null, eventIndexComplete: true, transactionPending: false, runTransaction: vi.fn(), ledger: { getPayerExposure: vi.fn().mockResolvedValue(0n), getMaxPayerExposure: vi.fn().mockResolvedValue(100n) } } as unknown as ReturnType<typeof useLedger>;
  finance = { data: testSnapshot(), now: testNow, loading: false, error: null, refresh: vi.fn() };
  vi.mocked(useLedger).mockImplementation(() => wallet); vi.mocked(useFinance).mockImplementation(() => finance);
});
afterEach(cleanup);
describe('reporting access and scenario isolation', () => {
  it('does not infer revocation from a currently unapproved holding', () => {
    wallet.role = 'inactiveInvestor';
    wallet.snapshot = { role: 'inactiveInvestor', manager: '0xmanager', approved: false, connectedBalance: 250n };
    render(<Dashboard />);
    expect(screen.getByText('Not approved')).toBeTruthy();
    expect(screen.queryByText('Revoked')).toBeNull();
    expect(screen.getByText('25.00%')).toBeTruthy();
  });
  it('shows the reporting block and refresh failure even when the SME has no open requests', () => {
    wallet.role = 'sme'; finance = { ...finance, error: 'RPC failed' };
    render(<SmeFinancingAssessment />);
    expect(screen.getByText(/No Submitted or Approved invoices/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('prior block snapshot remains visible');
    expect(screen.getByText(/Sepolia block 123/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh report' }));
    expect(finance.refresh).toHaveBeenCalledOnce();
  });
  it.each<WalletRole | null>(['investor', 'inactiveInvestor', 'sme', 'provisional', null])('denies the manager report for %s', role => {
    wallet.role = role;
    expect(canAccessPage(role, 'reports')).toBe(false); expect(navigationForRole(role).some(item => item.id === 'reports')).toBe(false);
    render(<Reports />); expect(screen.queryByRole('heading', { name: 'Fund financial reporting' })).toBeNull();
  });
  it('never substitutes a sample fund when RPC data is missing, but allows a labelled what-if', () => {
    finance = { ...finance, data: null, error: 'RPC failed' };
    render(<Reports />);
    expect(screen.getByText(/Live fund data is required/)).toBeTruthy(); expect(screen.queryByText('S$1,000.00')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('No substitute balances');
    fireEvent.change(screen.getByLabelText('Hypothetical invoice face value (S$)'), { target: { value: '1000' } });
    expect(screen.getByText('S$800.00')).toBeTruthy(); expect(screen.getByText('S$17.89')).toBeTruthy();
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it.each(['investor', 'inactiveInvestor'] as const)('shows same-block holdings and an editable NAV illustration for %s without transactions', role => {
    wallet.role = role;
    render(<InvestorReporting />);
    expect(screen.getByText('25.00%')).toBeTruthy(); expect(screen.getByText('S$1.000000')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Assumed additional fund income (S$)'), { target: { value: '100' } });
    expect(screen.getByText('S$1.100000')).toBeTruthy(); expect(screen.getByText('S$275.00')).toBeTruthy();
    expect(finance.data?.availableFunds).toBe(1000n); expect(wallet.runTransaction).not.toHaveBeenCalled();
    expect(screen.getByText(/neither redemption nor distributions/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Assumed additional fund income (S$)'), { target: { value: 'invalid' } });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('25.00%')).toBeTruthy();
    expect(screen.queryByText('S$1.100000')).toBeNull();
  });
  it('only offers SME assessments for invoices belonging to the current address', () => {
    wallet.role = 'sme'; finance.data = testSnapshot({ invoices: [testInvoice(), testInvoice({ id: 2n, sme: '0xother', payer: 'Other SME payer' })] });
    render(<SmeFinancingAssessment />);
    expect(screen.getByRole('option', { name: '#1 · Example payer' })).toBeTruthy(); expect(screen.queryByRole('option', { name: /Other SME payer/ })).toBeNull();
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it('does not confuse an unavailable SME portfolio with a confirmed empty portfolio', () => {
    wallet.role = 'sme'; finance = { ...finance, data: null, error: 'RPC unavailable' };
    render(<SmeFinancingAssessment />);
    expect(screen.getByText(/Live portfolio data is required/)).toBeTruthy();
    expect(screen.queryByText(/No Submitted or Approved invoices/)).toBeNull();
  });
});
describe('invoice maturity and unchanged transaction arguments', () => {
  function records(status: 'Approved' | 'Financed' | 'Repaid', maturity = testNow + 30n * 86400n) {
    const row = testInvoice({ status, maturity });
    wallet.snapshot = { role: 'manager', manager: wallet.account!, totalFundSize: 1000n, availableFunds: 1000n, invoiceCount: 1n, connectedBalance: 0n, totalSupply: 1000n, invoices: [row] };
    finance.data = testSnapshot({ invoices: [row] }); return row;
  }
  it('shows overdue records as Financed with a real log history; time never records repayment', () => {
    records('Financed', testNow - 86400n);
    wallet.events = [{ name: 'InvoiceFinanced', detail: '', invoiceId: 1n, participants: [], transactionHash: '0xrealtesthash', blockNumber: 100, logIndex: 0, timestamp: Number(testNow - 172800n) }];
    render(<Invoices />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'Overdue' } });
    expect(screen.getByText('1 day(s) overdue')).toBeTruthy(); expect(screen.getByText('Financed', { selector: '.status' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '#1' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('link', { name: 'View confirmed transaction' }).getAttribute('href')).toBe('https://sepolia.etherscan.io/tx/0xrealtesthash');
    expect(dialog.queryByText('InvoiceRepaid')).toBeNull(); expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it('leaves Repaid records closed after maturity and outside the Overdue filter', () => {
    records('Repaid', testNow - 86400n); render(<Invoices />);
    expect(screen.getByText('Repaid on-chain')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'Overdue' } });
    expect(screen.queryByRole('button', { name: '#1' })).toBeNull(); expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it('always passes only the actual invoice ID to full-face financing after a proposal edit', async () => {
    records('Approved'); render(<Invoices />); fireEvent.click(screen.getByRole('button', { name: '#1' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Proposed advance (%)'), { target: { value: '70' } });
    expect(dialog.getByText('S$70.00')).toBeTruthy(); expect(wallet.runTransaction).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole('button', { name: 'Finance full S$100 on-chain' }));
    await waitFor(() => expect(wallet.runTransaction).toHaveBeenCalledTimes(1));
    const [role, action] = vi.mocked(wallet.runTransaction).mock.calls[0];
    expect(role).toBe('manager');
    const financeInvoice = vi.fn().mockResolvedValue(undefined);
    await action({ financeInvoice } as unknown as ChainLedger);
    expect(financeInvoice).toHaveBeenCalledTimes(1);
    expect(financeInvoice).toHaveBeenCalledWith(1n);
    expect(finance.data?.availableFunds).toBe(1000n);
  });
  it('keeps SME details read-only and makes incomplete event history explicit', () => {
    const row = records('Financed'); wallet.role = 'sme'; wallet.snapshot = { role: 'sme', manager: '0xmanager', invoices: [row] }; wallet.eventIndexComplete = false;
    render(<Invoices />); fireEvent.click(screen.getByRole('button', { name: '#1' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(/full event history has not been indexed/)).toBeTruthy();
    expect(dialog.queryByRole('button', { name: 'Record repayment' })).toBeNull(); expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
  it('hides a proposal when the invoice differs from the pinned portfolio block', () => {
    records('Approved'); finance.data = testSnapshot({ invoices: [testInvoice({ status: 'Repaid' })] });
    render(<Invoices />); fireEvent.click(screen.getByRole('button', { name: '#1' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(/differs from the reporting snapshot/)).toBeTruthy();
    expect(dialog.queryByText('Recommended total borrowing limit')).toBeNull();
    expect(dialog.getByRole('button', { name: 'Finance full S$100 on-chain' })).toBeTruthy();
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });
});
