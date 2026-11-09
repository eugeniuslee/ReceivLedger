// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Provider } from 'ethers';
import { usePublicReport } from './usePublicReport';
import type { V2Ledger } from './V2Ledger';

const calls = vi.hoisted(() => ({ publicProvider: vi.fn(), read: vi.fn() }));
vi.mock('ethers', async original => {
  const actual = await original<typeof import('ethers')>();
  return { ...actual, JsonRpcProvider: class {
    getNetwork = vi.fn().mockResolvedValue({ chainId: 11155111n });
    destroy = vi.fn();
    constructor(...args: unknown[]) { calls.publicProvider(this, ...args); }
  } };
});
vi.mock('./V2Ledger', () => ({ V2Ledger: class {
  constructor(readonly address: string, readonly provider: Provider) {}
  readReport(wallet: string) { return calls.read(this.provider, this.address, wallet); }
} }));
const address = '0x' + '11'.repeat(20), wallet = '0x' + '22'.repeat(20), other = '0x' + '33'.repeat(20);
type Report = Awaited<ReturnType<V2Ledger['readReport']>>;
const report = (blockTag: number) => ({ wallet, blockTag }) as Report;
function provider() {
  return { getNetwork: vi.fn().mockResolvedValue({ chainId: 11155111n }), destroy: vi.fn(), getSigner: vi.fn(), sendTransaction: vi.fn() } as unknown as Provider;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => { calls.publicProvider.mockReset(); calls.read.mockReset().mockResolvedValue(report(123)); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('public fund report connections', () => {
  it('prefers the connected read-only provider and never owns or destroys it', async () => {
    const connected = provider();
    const hook = renderHook(() => usePublicReport(address, wallet, 0, true, connected));
    await act(async () => { await hook.result.current.read(); });
    expect(calls.read).toHaveBeenCalledWith(connected, address, wallet);
    expect(calls.publicProvider).not.toHaveBeenCalled();
    expect(connected.getNetwork).toHaveBeenCalledTimes(2);
    expect(connected.destroy).not.toHaveBeenCalled();
    expect((connected as unknown as { getSigner: ReturnType<typeof vi.fn> }).getSigner).not.toHaveBeenCalled();
    expect((connected as unknown as { sendTransaction: ReturnType<typeof vi.fn> }).sendTransaction).not.toHaveBeenCalled();
    expect(hook.result.current).toMatchObject({ report: report(123), loading: false, error: '' });
    hook.unmount(); expect(connected.destroy).not.toHaveBeenCalled();
  });

  it('retries a whole snapshot through a bounded, owned public provider after a transport failure', async () => {
    const connected = provider();
    calls.read.mockRejectedValueOnce(Object.assign(new Error('connection failed'), { code: 'NETWORK_ERROR' })).mockResolvedValueOnce(report(456));
    const hook = renderHook(() => usePublicReport(address, wallet, 0, true, connected));
    await act(async () => { await hook.result.current.read(); });
    const [owned, connection, chainId, options] = calls.publicProvider.mock.calls[0];
    expect(connection.timeout).toBe(12_000); expect(chainId).toBe(11155111); expect(options.staticNetwork).toBe(false);
    expect(calls.read.mock.calls).toEqual([[connected, address, wallet], [owned, address, wallet]]);
    expect(hook.result.current.report).toEqual(report(456));
    expect(owned.destroy).toHaveBeenCalledOnce(); expect(connected.destroy).not.toHaveBeenCalled();
  });

  it('keeps standalone preview reads working and releases its public provider', async () => {
    const hook = renderHook(() => usePublicReport(address, wallet, 0));
    await act(async () => { await hook.result.current.read(); });
    const owned = calls.publicProvider.mock.calls[0][0];
    expect(calls.read).toHaveBeenCalledWith(owned, address, wallet);
    expect(owned.destroy).toHaveBeenCalledOnce();
    expect(hook.result.current.report).toEqual(report(123));
  });

  it.each(['before', 'after'] as const)('stops on the wrong wallet network %s the report without public fallback', async phase => {
    const connected = provider();
    const network = vi.mocked(connected.getNetwork);
    if (phase === 'before') network.mockResolvedValue({ chainId: 1n } as Awaited<ReturnType<Provider['getNetwork']>>);
    else network.mockResolvedValueOnce({ chainId: 11155111n } as Awaited<ReturnType<Provider['getNetwork']>>).mockResolvedValueOnce({ chainId: 1n } as Awaited<ReturnType<Provider['getNetwork']>>);
    const hook = renderHook(() => usePublicReport(address, wallet, 0, true, connected));
    await act(async () => { await hook.result.current.read(); });
    expect(hook.result.current.error).toContain('Switch your wallet to Sepolia');
    expect(hook.result.current.report).toBeNull();
    expect(calls.publicProvider).not.toHaveBeenCalled();
    if (phase === 'before') expect(calls.read).not.toHaveBeenCalled();
    expect(connected.destroy).not.toHaveBeenCalled();
  });

  it.each([
    new Error('Unexpected V2 contract policy.'),
    Object.assign(new Error('Contract decoding failed'), { code: 'BAD_DATA' }),
    Object.assign(new Error('execution reverted'), { code: 'CALL_EXCEPTION' }),
    Object.assign(new Error('network changed'), { code: 'NETWORK_ERROR', event: 'changed' }),
  ])('does not retry a policy, decoding, execution or network-change error on another source', async cause => {
    calls.read.mockRejectedValue(cause);
    const connected = provider();
    const hook = renderHook(() => usePublicReport(address, wallet, 0, true, connected));
    await act(async () => { await hook.result.current.read(); });
    expect(hook.result.current.loading).toBe(false); expect(hook.result.current.report).toBeNull();
    expect(hook.result.current.error).toBeTruthy(); expect(calls.publicProvider).not.toHaveBeenCalled();
  });

  it('times out hung connections, permits retry, and ignores late results', async () => {
    vi.useFakeTimers();
    const connected = provider(), primary = deferred<Report>(), secondary = deferred<Report>();
    calls.read.mockReturnValueOnce(primary.promise).mockReturnValueOnce(secondary.promise);
    const hook = renderHook(() => usePublicReport(address, wallet, 0, true, connected));
    let work!: Promise<void>;
    await act(async () => { work = hook.result.current.read(); });
    expect(hook.result.current.loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(calls.publicProvider).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); await work; });
    expect(hook.result.current.loading).toBe(false); expect(hook.result.current.error).toContain('took too long');
    expect(hook.result.current.report).toBeNull();
    expect(calls.publicProvider.mock.calls[0][0].destroy).toHaveBeenCalledOnce();
    expect(connected.destroy).not.toHaveBeenCalled();
    calls.read.mockResolvedValue(report(789));
    await act(async () => { await hook.result.current.read(); });
    expect(hook.result.current.report).toEqual(report(789)); expect(hook.result.current.error).toBe('');
    await act(async () => { primary.resolve(report(1)); secondary.resolve(report(2)); });
    expect(hook.result.current.report).toEqual(report(789)); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['wallet ABA', 'provider', 'epoch', 'network'] as const)('discards a pending read after a %s change', async change => {
    const pending = deferred<Report>(), connected = provider();
    calls.read.mockReturnValue(pending.promise);
    const initialProps = { account: wallet, provider: connected, epoch: 0, networkOk: true };
    const hook = renderHook(({ account, provider, epoch, networkOk }) => usePublicReport(address, account, epoch, networkOk, provider), { initialProps });
    let work!: Promise<void>;
    await act(async () => { work = hook.result.current.read(); });
    if (change === 'wallet ABA') {
      hook.rerender({ ...initialProps, account: other }); hook.rerender(initialProps);
    } else if (change === 'provider') hook.rerender({ ...initialProps, provider: provider() });
    else if (change === 'epoch') hook.rerender({ ...initialProps, epoch: 1 });
    else hook.rerender({ ...initialProps, networkOk: false });
    await act(async () => { pending.resolve(report(123)); await work; });
    expect(hook.result.current).toMatchObject({ report: null, loading: false, error: '' });
    expect(calls.publicProvider).not.toHaveBeenCalled(); expect(connected.destroy).not.toHaveBeenCalled();
  });

  it('destroys an owned public provider when a read is cancelled on unmount', async () => {
    const pending = deferred<Report>(); calls.read.mockReturnValue(pending.promise);
    const hook = renderHook(() => usePublicReport(address, wallet, 0));
    let work!: Promise<void>;
    await act(async () => { work = hook.result.current.read(); });
    const owned = calls.publicProvider.mock.calls[0][0];
    hook.unmount(); await act(async () => { await work; });
    expect(owned.destroy).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve(report(123)); });
    expect(owned.destroy).toHaveBeenCalledOnce();
  });
});
