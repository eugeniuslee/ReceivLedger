import { RequestError } from './domain.ts';
import { Contract, Interface, JsonRpcProvider } from 'ethers';
import { CHAIN_ID, CONTRACT_ADDRESS } from './domain.ts';

export const REVIEW_ABI = [
  'function manager() view returns (address)',
  'function approvedInvestors(address) view returns (bool)',
  'function approveInvestor(address)',
  'event InvestorApproved(address investor)',
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

export interface RegistryChain {
  manager(): Promise<string>;
  invoiceOwner(id: string): Promise<string>;
  verifyApproval(hash: string, wallet: string, manager: string): Promise<void>;
}
export function createRegistryChain(rpc: string): RegistryChain {
  const provider = new JsonRpcProvider(rpc);
  const contract = new Contract(CONTRACT_ADDRESS, REVIEW_ABI, provider);
  async function requireSepolia() {
    if ((await provider.getNetwork()).chainId !== BigInt(CHAIN_ID)) throw new RequestError('Server RPC must use Sepolia.');
  }
  return {
    async manager() { await requireSepolia(); return String(await contract.getFunction('manager')()).toLowerCase(); },
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
  };
}

