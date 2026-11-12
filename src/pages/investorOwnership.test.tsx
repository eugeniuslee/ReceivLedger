// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvestorAdmin } from './InvestorAdmin';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { compactAddress } from '../chain/presentation';
import type { ChainEvent } from '../chain/chainLedger';

vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn() }));
vi.mock('../registration/RegistryContext', () => ({ useRegistry: vi.fn() }));

const alice = '0x259EC0e06A2Ec1Bf41a197bDEb5361e6e00B70B1';
const bob = '0xB81B22189aFd3B510552217De89ECa5d8e5c14cE';
const names: Record<string, string> = { [alice.toLowerCase()]: 'Alice Capital', [bob.toLowerCase()]: 'Bob Ventures' };
const approved = (address: string) => ({ name: 'InvestorApproved', detail: '', participants: [address], blockNumber: 1, logIndex: 0, transactionHash: '0x1' }) as unknown as ChainEvent;

beforeEach(() => {
  const readInvestorAccounts = vi.fn(async (addresses: string[]) => addresses.map(address => ({ address, approved: true, balance: address === alice ? 1100n : 2100n })));
  vi.mocked(useLedger).mockReturnValue({ account: '0x' + '79'.repeat(20), role: 'manager', networkOk: true, snapshot: { role: 'manager', totalSupply: 3200n },
    events: [approved(alice), approved(bob)], eventsLoading: false, eventsError: null, eventIndexComplete: true,
    ledger: { readInvestorAccounts }, transactionPending: false, runTransaction: vi.fn() } as unknown as ReturnType<typeof useLedger>);
  vi.mocked(useRegistry).mockReturnValue({ displayName: (wallet: string) => names[wallet.toLowerCase()] ?? null } as unknown as ReturnType<typeof useRegistry>);
});
afterEach(cleanup);

describe('investor ownership', () => {
  it('shortens wallets to the first 7 and last 5 characters', () => {
    expect(compactAddress(alice)).toBe('0x259EC...B70B1');
  });

  it('shows name, short wallet, RLU balance and ownership', async () => {
    render(<InvestorAdmin />);
    const row = (await screen.findByText('Alice Capital')).closest('tr')!;
    expect(within(row).getByText('0x259EC...B70B1')).toBeTruthy();
    expect(within(row).getByText('1,100 RLU')).toBeTruthy();
    expect(within(row).getByText('34.38%')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Investor name', 'Investor wallet', 'RLU balance', 'Ownership', 'Action']);
  });

  it('filters by investor name or wallet as each character is typed', async () => {
    render(<InvestorAdmin />);
    await screen.findByText('Bob Ventures');
    const search = screen.getByLabelText('Search investors by name or wallet');
    fireEvent.change(search, { target: { value: 'ali' } });
    expect(screen.getByText('Alice Capital')).toBeTruthy();
    expect(screen.queryByText('Bob Ventures')).toBeNull();
    fireEvent.change(search, { target: { value: '0xb81' } });
    expect(screen.getByText('Bob Ventures')).toBeTruthy();
    expect(screen.queryByText('Alice Capital')).toBeNull();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText(/No investors match/)).toBeTruthy();
    fireEvent.submit(search.closest('form')!);
    expect(screen.queryByText(/Enter a valid Ethereum wallet address/)).toBeNull();
    expect(screen.queryByText('Index status')).toBeNull();
  });
});
