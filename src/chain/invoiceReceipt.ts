import { Interface } from 'ethers';
import { RECEIVLEDGER_ABI, RECEIVLEDGER_ADDRESS } from './abi';
import { formatMoney } from './presentation';
import { userFacingError } from '../errors';

const iface = new Interface(RECEIVLEDGER_ABI);

/** A mined transaction can still contain InvoiceRejected rather than financing. */
export function invoiceReceiptOutcome(receipt: unknown, action: 'approve' | 'finance' | 'repay', invoiceId: bigint) {
  const unknown = { rejected: false, message: 'Invoice outcome is not verified. Refresh blockchain and check the transaction before retrying.' };
  if (!receipt || typeof receipt !== 'object') return unknown;
  const row = receipt as { status?: number; logs?: { address: string; topics: readonly string[]; data: string }[] };
  if (row.status !== 1) throw new Error('The transaction was not confirmed successfully.');
  for (const log of row.logs ?? []) {
    if (log.address.toLowerCase() !== RECEIVLEDGER_ADDRESS.toLowerCase()) continue;
    let event;
    try { event = iface.parseLog({ topics: [...log.topics], data: log.data }); } catch { continue; }
    if (!event || event.args[0] !== invoiceId) continue;
    if (action === 'finance' && event.name === 'InvoiceRejected') return { rejected: true,
      message: `Financing rejected by the contract: ${userFacingError(event.args[1], 'Review the recorded rejection reason.')} The transaction was confirmed, but no financing funds were deducted.` };
    if (action === 'approve' && event.name === 'InvoiceApproved') return { rejected: false,
      message: `Invoice #${invoiceId} approved on Sepolia. Approval does not deduct or reserve available funds.` };
    if (action === 'finance' && event.name === 'InvoiceFinanced') return { rejected: false,
      message: `Invoice #${invoiceId} financed on Sepolia. ${formatMoney(event.args[1])} was committed from available funds in simulated accounting.` };
    if (action === 'repay' && event.name === 'InvoiceRepaid') return { rejected: false,
      message: `Invoice #${invoiceId} repayment recorded on Sepolia. ${formatMoney(event.args[1])} principal was restored to available funds in simulated accounting.` };
  }
  return unknown;
}
