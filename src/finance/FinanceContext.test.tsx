// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLedger } from '../chain/LedgerContext';
import { FinanceProvider, useFinance } from './FinanceContext';
import { testSnapshot } from './fixtures';
import type { FinancialSnapshot } from './models';

vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn() }));
let wallet: ReturnType<typeof useLedger>;
let current: ReturnType<typeof useFinance>;
let read: ReturnType<typeof vi.fn>;
const a = '0x1111111111111111111111111111111111111111';
const b = '0x2222222222222222222222222222222222222222';
function Probe() { current = useFinance(); return <span>{current.data?.connectedBalance.toString() ?? 'unavailable'}</span>; }
function deferred() { let resolve!: (data: FinancialSnapshot) => void; const promise = new Promise<FinancialSnapshot>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  read = vi.fn().mockResolvedValue(testSnapshot());
  wallet = { account: a, role: 'investor', networkOk: true, snapshot: null, ledger: { readFinancialSnapshot: read } } as unknown as ReturnType<typeof useLedger>;
  vi.mocked(useLedger).mockImplementation(() => wallet);
});
afterEach(cleanup);
describe('financial reporting wallet isolation', () => {
  it('hides previous holdings synchronously and ignores a read that resolves after switching wallets', async () => {
    const old = deferred(); const next = deferred();
    read.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const view = render(<FinanceProvider><Probe /></FinanceProvider>);
    wallet = { ...wallet, account: b, role: 'inactiveInvestor' };
    view.rerender(<FinanceProvider><Probe /></FinanceProvider>);
    expect(current.data).toBeNull();
    await act(async () => old.resolve(testSnapshot({ connectedBalance: 950n })));
    expect(current.data).toBeNull();
    await act(async () => next.resolve(testSnapshot({ connectedBalance: 150n })));
    expect(current.data?.connectedBalance).toBe(150n);
    expect(read).toHaveBeenLastCalledWith(b);
  });
  it('cannot reuse an earlier response after an A to B to A switch', async () => {
    const first = deferred(); const second = deferred(); const third = deferred();
    read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const view = render(<FinanceProvider><Probe /></FinanceProvider>);
    wallet = { ...wallet, account: b }; view.rerender(<FinanceProvider><Probe /></FinanceProvider>);
    wallet = { ...wallet, account: a }; view.rerender(<FinanceProvider><Probe /></FinanceProvider>);
    await act(async () => { first.resolve(testSnapshot({ connectedBalance: 900n })); second.resolve(testSnapshot({ connectedBalance: 800n })); });
    expect(current.data).toBeNull();
    await act(async () => third.resolve(testSnapshot({ connectedBalance: 100n })));
    expect(current.data?.connectedBalance).toBe(100n);
  });
  it('clears values on wrong network, role change or disconnect', async () => {
    const view = render(<FinanceProvider><Probe /></FinanceProvider>);
    await waitFor(() => expect(current.data).not.toBeNull());
    wallet = { ...wallet, networkOk: false }; view.rerender(<FinanceProvider><Probe /></FinanceProvider>);
    expect(current.data).toBeNull(); expect(current.loading).toBe(false);
    wallet = { ...wallet, account: null, role: null }; view.rerender(<FinanceProvider><Probe /></FinanceProvider>);
    expect(current.data).toBeNull(); expect(read).toHaveBeenCalledTimes(1);
  });
  it('reports first-read errors with no substitute zero balances', async () => {
    read.mockRejectedValue(new Error('RPC failed'));
    render(<FinanceProvider><Probe /></FinanceProvider>);
    await waitFor(() => expect(current.error).toBe('RPC failed'));
    expect(current.data).toBeNull(); expect(current.loading).toBe(false);
  });
  it('invalidates same-account reporting when approval changes its role', async () => {
    const view = render(<FinanceProvider><Probe /></FinanceProvider>);
    await waitFor(() => expect(current.data).not.toBeNull());
    const next = deferred(); read.mockReturnValueOnce(next.promise);
    wallet = { ...wallet, role: 'inactiveInvestor' };
    view.rerender(<FinanceProvider><Probe /></FinanceProvider>);
    expect(current.data).toBeNull(); expect(current.loading).toBe(true);
    await act(async () => next.resolve(testSnapshot({ connectedBalance: 150n })));
    expect(current.data?.connectedBalance).toBe(150n);
  });
  it('retains a clearly dated prior block for a same-wallet refresh failure', async () => {
    const view = render(<FinanceProvider><Probe /></FinanceProvider>);
    await waitFor(() => expect(current.data?.blockNumber).toBe(123));
    read.mockRejectedValue(new Error('RPC failed'));
    wallet = { ...wallet, snapshot: { role: 'investor', connectedBalance: 250n, approved: true, manager: a } };
    view.rerender(<FinanceProvider><Probe /></FinanceProvider>);
    await waitFor(() => expect(current.error).toBe('RPC failed'));
    expect(current.data?.blockNumber).toBe(123);
  });
});


describe('financial refresh after confirmed wallet snapshot updates', () => {
  it('refreshes reports across Approved, Financed and Repaid snapshots without double-counting principal', async () => {
    const { testInvoice } = await import('./fixtures');
    const invoice = testInvoice({ amount: 100n, status: 'Approved' });
    read.mockResolvedValue(testSnapshot({ totalFundSize: 1100n, availableFunds: 1100n, invoices: [invoice] }));
    const view = render(<FinanceProvider><Probe /></FinanceProvider>);
    await waitFor(() => expect(current.data?.availableFunds).toBe(1100n));
    const approved = { role: 'manager' as const, manager: a, totalFundSize: 1100n, availableFunds: 1100n, invoiceCount: 1n, connectedBalance: 0n, totalSupply: 1100n, invoices: [invoice] };
    wallet = { ...wallet, snapshot: approved }; view.rerender(<FinanceProvider><Probe /></FinanceProvider>);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(current.data?.availableFunds).toBe(1100n);
    read.mockResolvedValue(testSnapshot({ totalFundSize: 1100n, availableFunds: 1000n, invoices: [{ ...invoice, status: 'Financed' }] }));
    wallet = { ...wallet, snapshot: { ...approved, availableFunds: 1000n, invoices: [{ ...invoice, status: 'Financed' }] } }; view.rerender(<FinanceProvider><Probe /></FinanceProvider>);
    await waitFor(() => expect(current.data?.availableFunds).toBe(1000n));
    expect(current.data?.invoices[0].status).toBe('Financed');
    read.mockResolvedValue(testSnapshot({ totalFundSize: 1100n, availableFunds: 1100n, invoices: [{ ...invoice, status: 'Repaid' }] }));
    wallet = { ...wallet, snapshot: { ...approved, invoices: [{ ...invoice, status: 'Repaid' }] } }; view.rerender(<FinanceProvider><Probe /></FinanceProvider>);
    await waitFor(() => expect(current.data?.invoices[0].status).toBe('Repaid'));
    expect(current.data?.availableFunds).toBe(1100n); expect(current.data?.totalFundSize).toBe(1100n);
  });
});
