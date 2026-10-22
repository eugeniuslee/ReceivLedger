import { describe, expect, it, vi } from 'vitest';
import { ChainLedger } from '../chain/chainLedger';
import { testNow } from './fixtures';

function reader(count = 1n) {
  const values: Record<string, unknown> = { totalSupply: 1000n, balanceOf: 250n, totalFundSize: 1000n, availableFunds: 900n, invoiceCount: count, getMaxPayerExposure: 100n, MAX_MATURITY_DAYS: 90n,
    invoices: { id: 1n, sme: '0x1111111111111111111111111111111111111111', payerName: 'Example payer', amount: 100n, maturityDate: testNow, status: 2n, rejectionReason: '' } };
  const calls = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, vi.fn().mockResolvedValue(value)]));
  const getBlock = vi.fn().mockResolvedValue({ number: 123, timestamp: Number(testNow) });
  const ledger = Object.create(ChainLedger.prototype) as ChainLedger;
  Object.defineProperty(ledger, 'contract', { value: { runner: { provider: { getBlock } }, getFunction: (name: string) => {
    if (!calls[name]) throw new Error(`Unexpected method ${name}`);
    return calls[name];
  } } });
  return { ledger, calls, getBlock };
}
describe('financial reporting contract reads', () => {
  it('pins every public read to one block and reads balance for the connected wallet', async () => {
    const { ledger, calls, getBlock } = reader();
    const result = await ledger.readFinancialSnapshot('0xwallet');
    expect(getBlock).toHaveBeenCalledWith('latest');
    expect(result).toMatchObject({ blockNumber: 123, blockTimestamp: testNow, availableFunds: 900n, totalSupply: 1000n, connectedBalance: 250n });
    for (const [name, call] of Object.entries(calls)) {
      const args = name === 'balanceOf' ? ['0xwallet', { blockTag: 123 }] : name === 'invoices' ? [1n, { blockTag: 123 }] : [{ blockTag: 123 }];
      expect(call).toHaveBeenCalledTimes(1);
      expect(call).toHaveBeenCalledWith(...args);
    }
    expect(result.invoices[0].status).toBe('Financed');
  });
  it('fails an incomplete read instead of returning a fabricated or partial portfolio', async () => {
    const { ledger, calls } = reader();
    calls.invoices.mockRejectedValue(new Error('RPC unavailable'));
    await expect(ledger.readFinancialSnapshot('0xwallet')).rejects.toThrow('RPC unavailable');
  });
  it('handles an empty portfolio without reading a sample invoice', async () => {
    const { ledger, calls } = reader(0n);
    expect((await ledger.readFinancialSnapshot('0xwallet')).invoices).toEqual([]);
    expect(calls.invoices).not.toHaveBeenCalled();
  });
  it('refuses oversized reads rather than silently truncating the portfolio', async () => {
    const { ledger, calls } = reader(10001n);
    await expect(ledger.readFinancialSnapshot('0xwallet')).rejects.toThrow('pagination');
    expect(calls.invoices).not.toHaveBeenCalled();
  });
  it('fails explicitly when no latest block is available', async () => {
    const { ledger, getBlock } = reader(); getBlock.mockResolvedValue(null);
    await expect(ledger.readFinancialSnapshot('0xwallet')).rejects.toThrow('block is unavailable');
  });
});
