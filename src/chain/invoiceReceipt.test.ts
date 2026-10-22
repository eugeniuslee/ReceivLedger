import { describe, expect, it } from 'vitest';
import { Interface } from 'ethers';
import { RECEIVLEDGER_ABI, RECEIVLEDGER_ADDRESS } from './abi';
import { invoiceReceiptOutcome } from './invoiceReceipt';
const iface = new Interface(RECEIVLEDGER_ABI);
function receipt(event: string, args: unknown[], address = RECEIVLEDGER_ADDRESS) {
  const encoded = iface.encodeEventLog(iface.getEvent(event)!, args);
  return { status: 1, logs: [{ address, ...encoded }] };
}
describe('actual invoice receipt outcomes', () => {
  it('distinguishes approval, finance and principal repayment', () => {
    expect(invoiceReceiptOutcome(receipt('InvoiceApproved', [7n]), 'approve', 7n).message).toContain('does not deduct');
    expect(invoiceReceiptOutcome(receipt('InvoiceFinanced', [7n, 100n]), 'finance', 7n).message).toContain('S$100 was committed');
    expect(invoiceReceiptOutcome(receipt('InvoiceRepaid', [7n, 100n]), 'repay', 7n).message).toContain('S$100 principal was restored');
  });
  it.each(['Payer exposure limit exceeded', 'Insufficient available funds', 'Invoice already matured', 'Maturity exceeds 90 days'])('does not call a mined rejection successful financing: %s', reason => {
    const outcome = invoiceReceiptOutcome(receipt('InvoiceRejected', [7n, reason]), 'finance', 7n);
    expect(outcome.rejected).toBe(true); expect(outcome.message).toContain(reason);
    expect(outcome.message).toContain('no financing funds were deducted');
  });
  it('rejects failed receipts and does not infer an outcome without the matching contract, invoice and event', () => {
    expect(() => invoiceReceiptOutcome({ status: 0, logs: [] }, 'finance', 7n)).toThrow('not confirmed');
    for (const input of [undefined, { status: 1, logs: [] }, receipt('InvoiceFinanced', [8n, 100n]), receipt('InvoiceApproved', [7n]), receipt('InvoiceFinanced', [7n, 100n], '0x1111111111111111111111111111111111111111')]) {
      expect(invoiceReceiptOutcome(input, 'finance', 7n).message).toContain('not verified');
    }
  });
});
