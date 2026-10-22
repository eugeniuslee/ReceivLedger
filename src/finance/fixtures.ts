// Shared test fixtures, never used as runtime data.
import type { ChainInvoice } from '../chain/chainLedger';
import type { FinancialSnapshot } from './models';
export const testNow = 1800000000n;
export function testInvoice(changes: Partial<ChainInvoice> = {}): ChainInvoice {
  return { id: 1n, sme: '0x1111111111111111111111111111111111111111', payer: 'Example payer',
    amount: 100n, maturity: testNow + 30n * 86400n, status: 'Approved', rejectionReason: '', ...changes };
}
export function testSnapshot(changes: Partial<FinancialSnapshot> = {}): FinancialSnapshot {
  return { blockNumber: 123, blockTimestamp: testNow, totalSupply: 1000n, connectedBalance: 250n,
    totalFundSize: 1000n, availableFunds: 1000n, maxPayerExposure: 100n, maxMaturityDays: 90n, invoices: [], ...changes };
}
