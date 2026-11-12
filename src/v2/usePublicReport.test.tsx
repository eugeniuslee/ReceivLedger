// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const walletProvider = { kind: 'wallet' };
const readReport = vi.fn();
vi.mock('../chain/LedgerContext', () => ({ useOptionalLedger: () => ({ readProvider: walletProvider }) }));
vi.mock('./V2Ledger', () => ({ V2Ledger: class { constructor(_address: string, readonly provider: unknown) {} readReport() { return readReport(this.provider); } } }));

import { REPORT_SOURCE_TIMEOUT_MS, usePublicReport } from './usePublicReport';
const address = '0x9672b0aec292c9f8dd8fefbc9daab876b8ec9882', wallet = '0x79b246212650b686a0e9e5726092b1558b35d974';

describe('fund report sources', () => {
  afterEach(() => { readReport.mockReset(); vi.useRealTimers(); });

  it('reads through the connected wallet connection first', async () => {
    readReport.mockResolvedValue({ blockTag: 1 });
    const { result } = renderHook(() => usePublicReport(address, wallet, 0, true));
    await act(() => result.current.read());
    expect(readReport).toHaveBeenCalledTimes(1);
    expect(readReport.mock.calls[0][0]).toBe(walletProvider);
    expect(result.current.report).toEqual({ blockTag: 1 });
  });

  it('falls back to the public RPC when the wallet connection fails', async () => {
    readReport.mockImplementation(async (provider: unknown) => { if (provider === walletProvider) throw new Error('wallet RPC rejected'); return { blockTag: 2 }; });
    const { result } = renderHook(() => usePublicReport(address, wallet, 0, true));
    await act(() => result.current.read());
    expect(readReport).toHaveBeenCalledTimes(2);
    expect(result.current.report).toEqual({ blockTag: 2 });
    expect(result.current.error).toBe('');
  });

  it('stops loading with an error when every source hangs', async () => {
    vi.useFakeTimers();
    readReport.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePublicReport(address, wallet, 0, true));
    let done!: Promise<void>;
    act(() => { done = result.current.read(); });
    expect(result.current.loading).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(REPORT_SOURCE_TIMEOUT_MS * 2 + 10); await done; });
    expect(result.current.loading).toBe(false);
    expect(result.current.report).toBeNull();
    expect(result.current.error).not.toBe('');
  });
});
