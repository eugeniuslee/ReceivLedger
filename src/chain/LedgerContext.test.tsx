// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LedgerProvider, useLedger } from './LedgerContext';
import type { RoleSnapshot } from './chainLedger';
import { resetBrowserStorage } from '../test/browserStorage';
import { LedgerApp } from '../App';

const calls = vi.hoisted(() => ({ read: vi.fn(), classify: vi.fn(), events: vi.fn() }));
vi.mock('./chainLedger', async importOriginal => {
  const actual = await importOriginal<typeof import('./chainLedger')>();
  return { ...actual, ChainLedger: vi.fn().mockImplementation(() => ({ readWalletSnapshot: calls.read, classifyWallet: calls.classify, readEvents: calls.events })) };
});

const walletA = '0x1111111111111111111111111111111111111111';
const walletB = '0x2222222222222222222222222222222222222222';
const manager = '0x3333333333333333333333333333333333333333';
let accounts: string[];
let listeners: Record<string, (...args: unknown[]) => void>;
let request: ReturnType<typeof vi.fn>;
let current: ReturnType<typeof useLedger>;
function Probe() { current = useLedger(); return <div>{current.account ?? 'disconnected'}:{current.role ?? 'resolving'}</div>; }
function snapshot(role: 'provisional' | 'investor'): RoleSnapshot {
  return role === 'provisional' ? { role, manager, approved: false, connectedBalance: 0n } : { role, manager, approved: true, connectedBalance: 20n };
}
beforeEach(() => {
  resetBrowserStorage();
  accounts = [walletA]; listeners = {};
  calls.read.mockReset().mockResolvedValue(snapshot('provisional'));
  calls.classify.mockReset().mockResolvedValue({ role: 'provisional', manager, approved: false, balance: 0n });
  calls.events.mockReset().mockResolvedValue([]);
  request = vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return accounts;
    if (method === 'eth_chainId') return '0xaa36a7';
    if (method === 'eth_blockNumber') return '0xb644ee';
    if (method === 'wallet_revokePermissions') return null;
    throw new Error(`Unexpected RPC: ${method}`);
  });
  Object.defineProperty(window, 'ethereum', { configurable: true, value: {
    request, on: (name: string, callback: (...args: unknown[]) => void) => { listeners[name] = callback; },
    removeListener: (name: string) => { delete listeners[name]; },
  } });
});
afterEach(() => { cleanup(); delete (window as Window & { ethereum?: unknown }).ethereum; });

async function mountWallet() {
  render(<LedgerProvider><Probe /></LedgerProvider>);
  await waitFor(() => expect(current.eventIndexComplete).toBe(true));
  await waitFor(() => expect(current.loading || current.eventsLoading).toBe(false));
}

describe('wallet provider refresh and disconnection', () => {
  it('explains a rejected connection without leaking the provider payload or requesting a signature', async () => {
    accounts = [];
    render(<LedgerProvider><Probe /></LedgerProvider>);
    await waitFor(() => expect(current.walletAvailable && !current.walletChecking).toBe(true));
    request.mockImplementation(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') throw { code: 4001, message: '{sensitive provider JSON}' };
      if (method === 'eth_accounts') return [];
      if (method === 'eth_chainId') return '0xaa36a7';
      throw new Error('Unexpected request');
    });
    await act(async () => { await current.connect(); });
    expect(current.error).toBe('Wallet connection cancelled.');
    expect(current.walletChecking).toBe(false); expect(current.account).toBeNull();
    expect(request.mock.calls.some(([input]) => ['personal_sign', 'eth_sign', 'eth_sendTransaction'].includes(input.method))).toBe(false);
  });
  it('shows public onboarding without an installed wallet instead of a role-loading screen', async () => {
    delete (window as Window & { ethereum?: unknown }).ethereum;
    render(<LedgerProvider><LedgerApp /></LedgerProvider>);
    await screen.findByRole('button', { name: 'Connect Your Wallet' });
    expect(screen.queryByRole('button', { name: 'SME' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Connect Your Wallet' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Checking the connected wallet role…')).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
  it('shows public onboarding with an available but disconnected wallet', async () => {
    accounts = [];
    render(<LedgerProvider><LedgerApp /></LedgerProvider>);
    await screen.findByRole('button', { name: 'Connect Your Wallet' });
    expect((screen.getByRole('button', { name: 'Connect Your Wallet' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'SME' })).toBeNull();
    expect(calls.read).not.toHaveBeenCalled();
  });
  it('returns to public onboarding when MetaMask removes all accounts', async () => {
    render(<LedgerProvider><Probe /><LedgerApp /></LedgerProvider>);
    await waitFor(() => expect(current.role).toBe('provisional'));
    accounts = [];
    await act(async () => { listeners.accountsChanged(accounts); });
    expect(current.account).toBeNull(); expect(current.snapshot).toBeNull(); expect(current.events).toEqual([]);
    expect(current.loading).toBe(false); expect(current.walletChecking).toBe(false);
    expect(screen.getByRole('button', { name: 'Connect Your Wallet' })).toBeTruthy();
    expect(screen.queryByText('Checking the connected wallet role…')).toBeNull();
  });
  it('settles provisional history indexing without repeatedly refreshing snapshots', async () => {
    await mountWallet();
    const reads = calls.read.mock.calls.length;
    const scans = calls.events.mock.calls.length;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
    expect(calls.read).toHaveBeenCalledTimes(reads);
    expect(calls.events).toHaveBeenCalledTimes(scans);
    expect(reads).toBeLessThanOrEqual(2);
  });

  it('clears wallet data immediately on disconnect and does not reconnect on account notifications', async () => {
    await mountWallet();
    await act(async () => { await current.disconnect(); });
    expect(current.account).toBeNull();
    expect(current.role).toBeNull();
    expect(current.snapshot).toBeNull();
    expect(current.events).toEqual([]);
    expect(request).toHaveBeenCalledWith({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
    await act(async () => { listeners.accountsChanged([walletB]); });
    expect(current.account).toBeNull();
    await act(async () => { await current.connect(); });
    await waitFor(() => expect(current.account).toBe(walletA));
  });

  it('explains when site permission revocation is unsupported rather than claiming it succeeded', async () => {
    await mountWallet();
    request.mockImplementation(async ({ method }: { method: string }) => {
      if (method === 'wallet_revokePermissions') throw new Error('Unsupported method');
      return accounts;
    });
    await act(async () => { await current.disconnect(); });
    expect(current.account).toBeNull();
    expect(current.connectionNotice).toContain('could not revoke site permissions');
  });

  it('ignores a role poll that resolves after switching to another wallet', async () => {
    await mountWallet();
    let finishPoll!: (value: { role: string }) => void;
    calls.classify.mockImplementationOnce(() => new Promise(resolve => { finishPoll = resolve; }));
    const interval = vi.spyOn(window, 'setInterval');
    await act(async () => { listeners.accountsChanged([walletA]); });
    const tick = interval.mock.calls.at(-1)?.[0] as (() => void) | undefined;
    expect(tick).toBeTypeOf('function');
    act(() => tick!());
    calls.read.mockResolvedValue(snapshot('investor'));
    accounts = [walletB];
    await act(async () => { listeners.accountsChanged(accounts); });
    await waitFor(() => expect(current.role).toBe('investor'));
    const reads = calls.read.mock.calls.length;
    await act(async () => { finishPoll({ role: 'provisional' }); });
    expect(calls.read).toHaveBeenCalledTimes(reads);
    expect(current.account).toBe(walletB);
    expect(current.role).toBe('investor');
    expect(screen.getByText(`${walletB}:investor`)).toBeTruthy();
    interval.mockRestore();
  });
});
