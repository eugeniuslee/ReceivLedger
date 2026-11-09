// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvestorAdmin } from './InvestorAdmin';
import { useLedger } from '../chain/LedgerContext';
import type { ChainLedger, FundSnapshot } from '../chain/chainLedger';

vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn() }));
vi.mock('../components/WalletName', () => ({ WalletName: ({ address }: { address: string }) => <span>{address}</span> }));

const manager = '0x1111111111111111111111111111111111111111';
const otherManager = '0x2222222222222222222222222222222222222222';
const investor = '0x3333333333333333333333333333333333333333';
const managerSnapshot: FundSnapshot = { role: 'manager', manager, totalFundSize: 100n, availableFunds: 100n,
  invoiceCount: 0n, connectedBalance: 0n, totalSupply: 100n, invoices: [] };
const readInvestorAccounts = vi.fn();
let wallet: ReturnType<typeof useLedger>;

beforeEach(() => {
  readInvestorAccounts.mockReset().mockResolvedValue([{ address: investor, approved: true, balance: 100n }]);
  wallet = {
    account: manager, role: 'manager', legacyRole: 'manager', networkOk: true, walletAvailable: true,
    walletChecking: false, walletEpoch: 0, isManager: true, isInvestor: false, isSme: false,
    snapshot: managerSnapshot, events: [{ name: 'InvestorApproved', detail: '', participants: [investor],
      transactionHash: '0xabc', logIndex: 0, blockNumber: 1 }], eventIndexComplete: true,
    loading: false, eventsLoading: false, transactionPending: false, error: null, eventsError: null, connectionNotice: null,
    connect: vi.fn(), disconnect: vi.fn(), signWalletMessage: vi.fn(), refresh: vi.fn().mockResolvedValue(undefined),
    refreshEvents: vi.fn(), ledger: { readInvestorAccounts } as unknown as ChainLedger, runTransaction: vi.fn(),
  };
  vi.mocked(useLedger).mockImplementation(() => wallet);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('RLU investor administration access', () => {
  it('explains the required RLU wallet for a V2-only manager without loading investor data', () => {
    wallet = { ...wallet, account: otherManager, isV2Manager: true, legacyRole: 'provisional',
      snapshot: { role: 'provisional', manager, approved: false, connectedBalance: 0n } };
    render(<InvestorAdmin />);
    expect(screen.getByRole('heading', { name: 'RLU fund manager required' })).toBeTruthy();
    expect(screen.getByText(manager)).toBeTruthy();
    expect(screen.queryByText('Loading fund manager investor data…')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Look up wallet' })).toBeNull();
    expect(readInvestorAccounts).not.toHaveBeenCalled();
    expect(wallet.runTransaction).not.toHaveBeenCalled();
  });

  it('shows loading only while the initial snapshot is pending, then explains unavailable data and retries', () => {
    wallet = { ...wallet, snapshot: null, loading: true };
    const view = render(<InvestorAdmin />);
    expect(screen.getByRole('status').textContent).toBe('Loading fund manager investor data…');
    expect(screen.queryByRole('button', { name: 'Retry blockchain' })).toBeNull();
    expect(readInvestorAccounts).not.toHaveBeenCalled();

    wallet = { ...wallet, loading: false, error: 'Blockchain refresh failed. Sepolia could not be reached.' };
    view.rerender(<InvestorAdmin />);
    expect(screen.queryByText('Loading fund manager investor data…')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Sepolia could not be reached');
    fireEvent.click(screen.getByRole('button', { name: 'Retry blockchain' }));
    expect(wallet.refresh).toHaveBeenCalledWith(true);
  });

  it('offers a retry for a settled missing snapshot even without an error', () => {
    wallet = { ...wallet, snapshot: null };
    render(<InvestorAdmin />);
    expect(screen.getByRole('alert').textContent).toContain('Investor administration data is unavailable');
    expect(screen.queryByText('Loading fund manager investor data…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry blockchain' })).toBeTruthy();
    expect(readInvestorAccounts).not.toHaveBeenCalled();
  });

  it('loads the investor list and retains issuance controls for the actual RLU manager', async () => {
    render(<InvestorAdmin />);
    await waitFor(() => expect(readInvestorAccounts).toHaveBeenCalledWith([investor]));
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
    expect(screen.getByRole('dialog', { name: 'Investor details' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Issue fund units' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke approval' })).toBeTruthy();
    expect(screen.queryByText('RLU fund manager required')).toBeNull();
  });
});
