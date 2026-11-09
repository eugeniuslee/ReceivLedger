// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbiCoder, id, ZeroAddress, type Provider } from 'ethers';
import { FundAuthorityCheck } from './FundAuthorityCheck';
import { readFundAuthorities } from '../chain/fundAuthorities';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { RECEIVLEDGER_ADDRESS } from '../chain/abi';
import { V2_DEPLOYMENT } from '../v2/config';

vi.mock('../chain/LedgerContext', () => ({ useLedger: vi.fn() }));
vi.mock('../registration/RegistryContext', () => ({ useRegistry: vi.fn() }));
const manager = '0x1111111111111111111111111111111111111111';
const connected = '0x2222222222222222222222222222222222222222';
const other = '0x3333333333333333333333333333333333333333';
const selector = (name: string) => id(`${name}()`).slice(0, 10);
const encode = (address: string) => AbiCoder.defaultAbiCoder().encode(['address'], [address]);
function providerFixture() {
  const call = vi.fn(async (transaction: { to: string; data: string; blockTag: number }) => {
    if (transaction.data === selector('manager')) return encode(manager);
    if (transaction.data === selector('owner')) return encode(connected);
    if (transaction.data === selector('pendingOwner')) return encode(ZeroAddress);
    throw new Error('Unexpected contract call');
  });
  return { getNetwork: vi.fn().mockResolvedValue({ chainId: 11155111n }), getBlockNumber: vi.fn().mockResolvedValue(123),
    call, getSigner: vi.fn(), sendTransaction: vi.fn(), send: vi.fn() };
}
let fixture: ReturnType<typeof providerFixture>;
let wallet: ReturnType<typeof useLedger>;
let registry: ReturnType<typeof useRegistry>;
beforeEach(() => {
  fixture = providerFixture();
  wallet = { account: connected, walletEpoch: 0, networkOk: true,
    ledger: { contract: { runner: { provider: fixture } } } } as unknown as typeof wallet;
  registry = { authenticated: false, isManager: false, signIn: vi.fn(), request: vi.fn() } as unknown as typeof registry;
  vi.mocked(useLedger).mockImplementation(() => wallet);
  vi.mocked(useRegistry).mockImplementation(() => registry);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('read-only manager authority evidence', () => {
  it('reads each contract at the same block and never requests a signer, transaction or backend action', async () => {
    render(<FundAuthorityCheck />);
    expect(fixture.call).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check manager wallets' }));
    await screen.findByText(/Checked on Sepolia \(11155111\) at block 123/);
    const rlu = within(screen.getByRole('region', { name: 'RLU manager permissions' }));
    expect(rlu.getByText(manager)).toBeTruthy();
    expect(rlu.getByText('This is a different wallet from the one connected.')).toBeTruthy();
    const rlu2 = within(screen.getByRole('region', { name: 'RLU2 manager permissions' }));
    expect(rlu2.getByText(connected)).toBeTruthy();
    expect(rlu2.getByText('This matches your connected wallet.')).toBeTruthy();
    expect(rlu2.getByText('No RLU2 ownership transfer is pending.')).toBeTruthy();
    const calls = fixture.call.mock.calls.map(([transaction]) => transaction);
    expect(calls).toHaveLength(3);
    expect(calls.every(transaction => transaction.blockTag === 123)).toBe(true);
    expect(calls.find(transaction => transaction.data === selector('manager'))?.to.toLowerCase()).toBe(RECEIVLEDGER_ADDRESS);
    expect(calls.filter(transaction => transaction.data !== selector('manager')).every(transaction => transaction.to.toLowerCase() === V2_DEPLOYMENT.address)).toBe(true);
    expect(fixture.getSigner).not.toHaveBeenCalled(); expect(fixture.sendTransaction).not.toHaveBeenCalled(); expect(fixture.send).not.toHaveBeenCalled();
    expect(registry.signIn).not.toHaveBeenCalled(); expect(registry.request).not.toHaveBeenCalled();
    expect(screen.getByText(/Not checked: sign in from My Profile/)).toBeTruthy();
  });

  it('checks the provider network rather than trusting the UI network flag', async () => {
    fixture.getNetwork.mockResolvedValue({ chainId: 1n });
    render(<FundAuthorityCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Check manager wallets' }));
    await screen.findByText('Switch MetaMask to Sepolia before checking manager wallets.');
    expect(fixture.getBlockNumber).not.toHaveBeenCalled(); expect(fixture.call).not.toHaveBeenCalled();
  });

  it('preserves other contract evidence when one read fails and keeps provider details private', async () => {
    const call = fixture.call.getMockImplementation()!;
    fixture.call.mockImplementation(async transaction => {
      if (transaction.data === selector('manager')) throw new Error('Failed https://private-rpc.test/credential');
      return call(transaction);
    });
    registry.authenticated = true;
    render(<FundAuthorityCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Check manager wallets' }));
    await screen.findByText(/RLU manager unavailable: This contract could not be read/);
    expect(screen.queryByText(/private-rpc/)).toBeNull();
    expect(within(screen.getByRole('region', { name: 'RLU2 manager permissions' })).getByText(connected)).toBeTruthy();
    expect(screen.getByText(/Your signed-in session is not authorised/)).toBeTruthy();
  });

  it('does not mistake a proposed owner for the current owner', async () => {
    const call = fixture.call.getMockImplementation()!;
    fixture.call.mockImplementation(async transaction => transaction.data === selector('pendingOwner') ? encode(connected) : transaction.data === selector('owner') ? encode(other) : call(transaction));
    const result = await readFundAuthorities(fixture as unknown as Provider);
    expect(result.rlu2Owner.address).toBe(other);
    expect(result.rlu2PendingOwner.address).toBe(connected);
  });

  it('rejects an otherwise complete result if the provider network changes during the check', async () => {
    fixture.getNetwork.mockResolvedValueOnce({ chainId: 11155111n }).mockResolvedValueOnce({ chainId: 1n });
    await expect(readFundAuthorities(fixture as unknown as Provider)).rejects.toThrow('network changed during this check');
  });

  it.each(['wallet ABA', 'epoch', 'network', 'provider'] as const)('discards in-flight results after a %s change', async change => {
    let finish!: (value: string) => void;
    const call = fixture.call.getMockImplementation()!;
    fixture.call.mockImplementation(transaction => transaction.data === selector('manager') ? new Promise(resolve => { finish = resolve; }) : call(transaction));
    const view = render(<FundAuthorityCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Check manager wallets' }));
    await waitFor(() => expect(fixture.call).toHaveBeenCalledTimes(3));
    if (change === 'wallet ABA') {
      wallet = { ...wallet, account: other }; view.rerender(<FundAuthorityCheck />);
      wallet = { ...wallet, account: connected };
    } else if (change === 'epoch') wallet = { ...wallet, walletEpoch: 1 };
    else if (change === 'network') wallet = { ...wallet, networkOk: false };
    else wallet = { ...wallet, ledger: { contract: { runner: { provider: providerFixture() } } } } as unknown as typeof wallet;
    view.rerender(<FundAuthorityCheck />);
    await act(async () => { finish(encode(manager)); });
    expect(screen.queryByText(/Checked on Sepolia/)).toBeNull();
    expect(screen.queryByText(manager)).toBeNull();
    expect(screen.queryByText('Reading contract permissions…')).toBeNull();
  });

  it('clears a completed result on wallet change and discards checks after unmount', async () => {
    const view = render(<FundAuthorityCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Check manager wallets' }));
    await screen.findByText(manager);
    wallet = { ...wallet, account: other, walletEpoch: 1 };
    view.rerender(<FundAuthorityCheck />);
    expect(screen.queryByText(manager)).toBeNull();
    let finish!: (value: string) => void;
    const call = fixture.call.getMockImplementation()!;
    fixture.call.mockImplementation(transaction => transaction.data === selector('manager') ? new Promise(resolve => { finish = resolve; }) : call(transaction));
    fireEvent.click(screen.getByRole('button', { name: 'Check manager wallets' }));
    await waitFor(() => expect(fixture.call).toHaveBeenCalledTimes(6));
    view.unmount();
    await act(async () => { finish(encode(manager)); });
    expect(screen.queryByText(/Checked on Sepolia/)).toBeNull();
  });

  it('ends a stalled check after twenty seconds, ignores the late result and permits retry', async () => {
    vi.useFakeTimers();
    let finish!: (network: { chainId: bigint }) => void;
    fixture.getNetwork.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<FundAuthorityCheck />);
    fireEvent.click(screen.getByRole('button', { name: 'Check manager wallets' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.getByRole('alert').textContent).toContain('The wallet connection took too long');
    expect((screen.getByRole('button', { name: 'Check manager wallets' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { finish({ chainId: 11155111n }); });
    expect(screen.queryByText(/Checked on Sepolia/)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check manager wallets' })); });
    expect(screen.getByText(/Checked on Sepolia \(11155111\) at block 123/)).toBeTruthy();
    expect(screen.queryByText(/The wallet connection took too long/)).toBeNull();
  });
});
