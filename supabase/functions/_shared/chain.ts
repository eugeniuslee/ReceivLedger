import { RequestError } from './domain.ts';
import { Contract, Interface, JsonRpcProvider, ZeroAddress } from 'ethers';
import { CHAIN_ID, CONTRACT_ADDRESS } from './domain.ts';

export const REVIEW_ABI = [
  'function manager() view returns (address)',
  'function approvedInvestors(address) view returns (bool)',
  'function approveInvestor(address)',
  'function issueFundUnits(address investor,uint256 amount)',
  'event InvestorApproved(address investor)',
  'event FundUnitsIssued(address investor,uint256 amount)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'function invoices(uint256) view returns (uint256 id,address sme,string payerName,uint256 amount,uint256 maturityDate,uint8 status,string rejectionReason)',
];
const iface = new Interface(REVIEW_ABI);
export interface ApprovalEvidence {
  chainId: bigint; status: number | null; confirmations: number; to: string | null; from: string;
  data: string; logs: readonly { address: string; topics: readonly string[]; data: string }[]; approved: boolean;
}
export function validateApprovalEvidence(e: ApprovalEvidence, wallet: string, manager: string) {
  if (e.chainId !== BigInt(CHAIN_ID) || e.status !== 1 || e.confirmations < 2) throw new RequestError('Approval needs a successful Sepolia receipt and two confirmations. Retry finalization shortly.');
  if (e.to?.toLowerCase() !== CONTRACT_ADDRESS || e.from.toLowerCase() !== manager.toLowerCase()) throw new RequestError('Approval was not sent by this fund manager to the configured contract.');
  let transaction;
  try { transaction = iface.parseTransaction({ data: e.data }); } catch { /* handled below */ }
  if (transaction?.name !== 'approveInvestor' || String(transaction.args[0]).toLowerCase() !== wallet.toLowerCase()) throw new RequestError('Transaction does not approve this applicant.');
  const event = e.logs.some(log => {
    if (log.address.toLowerCase() !== CONTRACT_ADDRESS) return false;
    try { const parsed = iface.parseLog(log); return parsed?.name === 'InvestorApproved' && String(parsed.args[0]).toLowerCase() === wallet.toLowerCase(); }
    catch { return false; }
  });
  if (!event || !e.approved) throw new RequestError('Approval event is missing or the investor has since been revoked.');
}

export interface IssuanceEvidence extends ApprovalEvidence {
  currentManager: string;
  matchedBlock: boolean;
  blockTimestamp: number;
}

/** Bind an off-chain purchase to one exact V1 mint, after the request was created. */
export function validateIssuanceEvidence(e: IssuanceEvidence, wallet: string, units: string, manager: string, notBefore: string) {
  if (!/^[1-9]\d{0,77}$/.test(units) || BigInt(units) >= 2n ** 256n) throw new RequestError('A positive whole RLU amount is required.');
  const minimumTime = Date.parse(notBefore);
  if (!Number.isFinite(minimumTime) || !Number.isSafeInteger(e.blockTimestamp) || e.blockTimestamp < 0
    || e.blockTimestamp * 1000 < minimumTime) throw new RequestError('Issuance must be mined after this purchase request was created.');
  if (e.chainId !== BigInt(CHAIN_ID) || e.status !== 1 || !Number.isSafeInteger(e.confirmations) || e.confirmations < 2 || !e.matchedBlock) {
    throw new RequestError('Issuance needs a successful current Sepolia receipt and two confirmations. Retry finalization shortly.');
  }
  if (e.to?.toLowerCase() !== CONTRACT_ADDRESS || e.currentManager.toLowerCase() !== manager.toLowerCase()
    || e.from.toLowerCase() !== e.currentManager.toLowerCase()) throw new RequestError('Issuance was not sent by the current fund manager to the configured contract.');
  let transaction;
  try { transaction = iface.parseTransaction({ data: e.data }); } catch { /* rejected below */ }
  const amount = BigInt(units);
  if (transaction?.name !== 'issueFundUnits' || String(transaction.args[0]).toLowerCase() !== wallet.toLowerCase()
    || BigInt(transaction.args[1]) !== amount) throw new RequestError('Transaction does not issue the exact RLU amount to this investor.');
  let issued = false, minted = false;
  for (const log of e.logs) {
    if (log.address.toLowerCase() !== CONTRACT_ADDRESS) continue;
    try {
      const event = iface.parseLog(log);
      if (event?.name === 'FundUnitsIssued' && String(event.args[0]).toLowerCase() === wallet.toLowerCase() && BigInt(event.args[1]) === amount) issued = true;
      if (event?.name === 'Transfer' && String(event.args[0]).toLowerCase() === ZeroAddress
        && String(event.args[1]).toLowerCase() === wallet.toLowerCase() && BigInt(event.args[2]) === amount) minted = true;
    } catch { /* An unrelated or malformed log is not mint evidence. */ }
  }
  if (!issued || !minted || !e.approved) throw new RequestError('Matching issuance and mint events are required, and the investor must still be approved.');
}

export interface RegistryChain {
  manager(): Promise<string>;
  invoiceOwner(id: string): Promise<string>;
  verifyApproval(hash: string, wallet: string, manager: string): Promise<void>;
  approvedInvestor?(wallet: string): Promise<boolean>;
  verifyIssuance?(hash: string, wallet: string, units: string, manager: string, notBefore: string): Promise<void>;
}
export function createRegistryChain(rpc: string): RegistryChain {
  const provider = new JsonRpcProvider(rpc);
  const contract = new Contract(CONTRACT_ADDRESS, REVIEW_ABI, provider);
  async function requireSepolia() {
    if ((await provider.getNetwork()).chainId !== BigInt(CHAIN_ID)) throw new RequestError('Server RPC must use Sepolia.');
  }
  return {
    async manager() { await requireSepolia(); return String(await contract.getFunction('manager')()).toLowerCase(); },
    async approvedInvestor(wallet) {
      await requireSepolia();
      return Boolean(await contract.getFunction('approvedInvestors')(wallet));
    },
    async invoiceOwner(id) {
      await requireSepolia();
      const invoice = await contract.getFunction('invoices')(id);
      if (BigInt(invoice.id) !== BigInt(id)) throw new RequestError('Invoice does not exist.');
      return String(invoice.sme).toLowerCase();
    },
    async verifyApproval(hash, wallet, manager) {
      await requireSepolia();
      if (!/^0x[\da-f]{64}$/i.test(hash)) throw new RequestError('A confirmed approval transaction hash is required.');
      const [receipt, transaction, head, approved] = await Promise.all([
        provider.getTransactionReceipt(hash), provider.getTransaction(hash), provider.getBlockNumber(),
        contract.getFunction('approvedInvestors')(wallet),
      ]);
      if (!receipt || !transaction || transaction.blockHash !== receipt.blockHash) throw new RequestError('Approval transaction has not been mined on the current chain.');
      validateApprovalEvidence({ chainId: transaction.chainId, status: receipt.status,
        confirmations: head - receipt.blockNumber + 1, to: transaction.to, from: transaction.from,
        data: transaction.data, logs: receipt.logs, approved: Boolean(approved) }, wallet, manager);
    },
    async verifyIssuance(hash, wallet, units, manager, notBefore) {
      await requireSepolia();
      if (!/^0x[\da-f]{64}$/i.test(hash)) throw new RequestError('A confirmed issuance transaction hash is required.');
      const [receipt, transaction, head] = await Promise.all([
        provider.getTransactionReceipt(hash), provider.getTransaction(hash), provider.getBlockNumber(),
      ]);
      if (!receipt || !transaction || receipt.hash.toLowerCase() !== hash.toLowerCase() || transaction.hash.toLowerCase() !== hash.toLowerCase()) {
        throw new RequestError('Issuance transaction has not been mined on the current chain.');
      }
      const [block, currentManager, approved] = await Promise.all([
        provider.getBlock(receipt.blockNumber),
        contract.getFunction('manager')({ blockTag: head }),
        contract.getFunction('approvedInvestors')(wallet, { blockTag: head }),
      ]);
      const matchedBlock = Boolean(block && block.number === receipt.blockNumber && block.hash === receipt.blockHash
        && transaction.blockHash === receipt.blockHash && transaction.blockNumber === receipt.blockNumber);
      validateIssuanceEvidence({ chainId: transaction.chainId, status: receipt.status,
        confirmations: head - receipt.blockNumber + 1, to: transaction.to, from: transaction.from,
        data: transaction.data, logs: receipt.logs, approved: Boolean(approved), currentManager: String(currentManager),
        matchedBlock, blockTimestamp: block?.timestamp ?? -1 }, wallet, units, manager, notBefore);
    },
  };
}

