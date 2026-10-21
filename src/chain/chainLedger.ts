import { Contract, type ContractRunner, type ContractTransactionReceipt, type Provider } from 'ethers';
import { RECEIVLEDGER_ABI } from './abi';

export type InvoiceStatus = 'Submitted' | 'Approved' | 'Financed' | 'Rejected' | 'Repaid' | 'Unknown';
export type InvoiceAction = 'approve' | 'finance' | 'repay' | null;

export function invoiceActionForStatus(status: InvoiceStatus): InvoiceAction {
  if (status === 'Submitted') return 'approve';
  if (status === 'Approved') return 'finance';
  if (status === 'Financed') return 'repay';
  return null;
}

export interface ChainInvoice {
  id: bigint;
  sme: string;
  payer: string;
  amount: bigint;
  maturity: bigint;
  status: InvoiceStatus;
  rejectionReason: string;
}

export interface FundSnapshot {
  role: 'manager';
  manager: string;
  totalFundSize: bigint;
  availableFunds: bigint;
  invoiceCount: bigint;
  connectedBalance: bigint;
  totalSupply: bigint;
  invoices: ChainInvoice[];
}

export interface InvestorAccount {
  address: string;
  approved: boolean;
  balance: bigint;
}

export function mergeInvestorAccounts(existing: InvestorAccount[], refreshed: InvestorAccount[]): InvestorAccount[] {
  const accounts = new Map(existing.map(account => [account.address.toLowerCase(), account]));
  for (const account of refreshed) accounts.set(account.address.toLowerCase(), account);
  return [...accounts.values()];
}

export interface InvestorSnapshot {
  role: 'investor';
  manager: string;
  approved: true;
  connectedBalance: bigint;
}

export interface InactiveInvestorSnapshot {
  role: 'inactiveInvestor';
  manager: string;
  approved: false;
  connectedBalance: bigint;
}

export interface ProvisionalSnapshot {
  role: 'provisional';
  manager: string;
  approved: false;
  connectedBalance: bigint;
}

export interface SmeSnapshot {
  role: 'sme';
  manager: string;
  invoices: ChainInvoice[];
}

export type WalletRole = 'manager' | 'investor' | 'inactiveInvestor' | 'sme' | 'provisional';
export type RoleSnapshot = FundSnapshot | InvestorSnapshot | InactiveInvestorSnapshot | ProvisionalSnapshot | SmeSnapshot;

export interface ChainEvent {
  name: string;
  detail: string;
  amount?: bigint;
  invoiceId?: bigint;
  participants: string[];
  timestamp?: number;
  transactionHash: string;
  logIndex: number;
  blockNumber: number;
}

export const CONTRACT_DEPLOYMENT_BLOCK = 11_945_118;
export const EVENT_QUERY_CHUNK_SIZE = 2_000;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function discoverInvestorAddresses(events: ChainEvent[], additionalAddresses: string[] = []): string[] {
  const addresses = new Map<string, string>();
  const relevant = new Set(['InvestorApproved', 'InvestorRevoked', 'FundUnitsIssued', 'Transfer']);
  for (const event of events) {
    if (!relevant.has(event.name)) continue;
    for (const participant of event.participants) {
      const normalized = participant.toLowerCase();
      if (normalized !== ZERO_ADDRESS) addresses.set(normalized, participant);
    }
  }
  for (const address of additionalAddresses) {
    const normalized = address.toLowerCase();
    if (normalized !== ZERO_ADDRESS) addresses.set(normalized, address);
  }
  return [...addresses.values()].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
}

export function ownershipPercentage(balance: bigint, totalSupply: bigint): string | null {
  if (totalSupply <= 0n) return null;
  const hundredths = (balance * 10_000n + totalSupply / 2n) / totalSupply;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}%`;
}

export function ownershipDisplay(balance: bigint, totalSupply: bigint, historyComplete: boolean): string | null {
  if (!historyComplete) return null;
  return ownershipPercentage(balance, totalSupply) ?? '—';
}

export function investorApprovalLabel(approved: boolean): 'Approved' | 'Not approved' {
  return approved ? 'Approved' : 'Not approved';
}

const STATUS: InvoiceStatus[] = ['Submitted', 'Approved', 'Financed', 'Rejected', 'Repaid'];

export function mapInvoiceRecord(row: {
  id: bigint;
  sme: string;
  payerName: string;
  amount: bigint;
  maturityDate: bigint;
  status: bigint | number;
  rejectionReason: string;
}): ChainInvoice {
  return {
    id: BigInt(row.id),
    sme: String(row.sme),
    payer: String(row.payerName),
    amount: BigInt(row.amount),
    maturity: BigInt(row.maturityDate),
    status: STATUS[Number(row.status)] ?? 'Unknown',
    rejectionReason: String(row.rejectionReason),
  };
}

export function filterInvestorEvents(events: ChainEvent[], account: string): ChainEvent[] {
  const target = account.toLowerCase();
  return events.filter(event => event.participants.some(address => address.toLowerCase() === target));
}

export function hasInvestorHistory(events: ChainEvent[], account: string): boolean {
  const target = account.toLowerCase();
  return events.some(event => {
    if (!event.participants.some(address => address.toLowerCase() === target)) return false;
    if (event.name === 'InvestorApproved' || event.name === 'InvestorRevoked' || event.name === 'FundUnitsIssued') return true;
    if (event.name !== 'Transfer') return false;
    return event.participants.every(address => address.toLowerCase() !== ZERO_ADDRESS);
  });
}

export function classifyWalletEvidence(
  account: string,
  manager: string,
  approved: boolean,
  balance: bigint,
  historicalEvents: ChainEvent[],
): Exclude<WalletRole, 'sme'> {
  if (manager.toLowerCase() === account.toLowerCase()) return 'manager';
  if (approved) return 'investor';
  if (balance > 0n || hasInvestorHistory(historicalEvents, account)) return 'inactiveInvestor';
  return 'provisional';
}

export function classifyProvisionalWallet(hasStoredInvoices: boolean): 'sme' | 'provisional' {
  return hasStoredInvoices ? 'sme' : 'provisional';
}

export function walletRoleChanged(current: WalletRole | null, candidate: Exclude<WalletRole, 'sme'>): boolean {
  return current !== null && current !== candidate && !(current === 'sme' && candidate === 'provisional');
}

export function transactionRoleAllowed(required: WalletRole, detected: Exclude<WalletRole, 'sme'>, hasStoredInvoice = false): boolean {
  return required === detected || (required === 'sme' && detected === 'provisional' && hasStoredInvoice);
}

export function invoiceIdsSubmittedBy(events: ChainEvent[], account: string): bigint[] {
  const target = account.toLowerCase();
  return [...new Set(events
    .filter(event => event.name === 'InvoiceSubmitted' && event.participants.some(address => address.toLowerCase() === target))
    .map(event => event.invoiceId)
    .filter((id): id is bigint => id !== undefined))];
}

export function filterInvoiceEvents(events: ChainEvent[], invoiceIds: bigint[]): ChainEvent[] {
  const ownedIds = new Set(invoiceIds.map(id => id.toString()));
  return events.filter(event => event.invoiceId !== undefined && ownedIds.has(event.invoiceId.toString()));
}

export function filterInvoicesForSme(invoices: ChainInvoice[], account: string): ChainInvoice[] {
  const target = account.toLowerCase();
  return invoices.filter(invoice => invoice.sme.toLowerCase() === target);
}

export class ChainLedger {
  readonly contract: Contract;
  constructor(address: string, runner: ContractRunner) { this.contract = new Contract(address, RECEIVLEDGER_ABI, runner); }

  private async send(method: string, ...args: unknown[]): Promise<ContractTransactionReceipt> {
    const transaction = await this.contract.getFunction(method)(...args);
    const receipt = await transaction.wait();
    if (!receipt || receipt.status !== 1) throw new Error('The transaction was not confirmed successfully.');
    return receipt;
  }

  async approveInvestor(address: string) { return this.send('approveInvestor', address); }
  async revokeInvestor(address: string) { return this.send('revokeInvestor', address); }
  async issueFundUnits(address: string, amount: bigint) { return this.send('issueFundUnits', address, amount); }
  async transfer(address: string, amount: bigint) { return this.send('transfer', address, amount); }
  async submitInvoice(payer: string, amount: bigint, maturitySeconds: bigint) { return this.send('submitInvoice', payer, amount, maturitySeconds); }
  async approveInvoice(id: bigint) { return this.send('approveInvoice', id); }
  async financeInvoice(id: bigint) { return this.send('financeInvoice', id); }
  async recordRepayment(id: bigint) { return this.send('recordRepayment', id); }

  async isApproved(address: string): Promise<boolean> {
    return Boolean(await this.contract.getFunction('approvedInvestors')(address));
  }

  async balanceOf(address: string): Promise<bigint> {
    return BigInt(await this.contract.getFunction('balanceOf')(address));
  }

  async readInvestorAccounts(addresses: string[]): Promise<InvestorAccount[]> {
    const accounts: InvestorAccount[] = [];
    for (let index = 0; index < addresses.length; index += 10) {
      const batch = await Promise.all(addresses.slice(index, index + 10).map(async address => {
        const [approved, balance] = await Promise.all([this.isApproved(address), this.balanceOf(address)]);
        return { address, approved, balance };
      }));
      accounts.push(...batch);
    }
    return accounts;
  }

  async classifyWallet(account: string, knownEvents: ChainEvent[] = []): Promise<{ role: Exclude<WalletRole, 'sme'>; manager: string; approved: boolean; balance: bigint }> {
    const manager = String(await this.contract.getFunction('manager')());
    if (manager.toLowerCase() === account.toLowerCase()) return { role: 'manager', manager, approved: false, balance: 0n };
    const [approved, balance] = await Promise.all([this.isApproved(account), this.balanceOf(account)]);
    const role = classifyWalletEvidence(account, manager, approved, balance, knownEvents);
    return { role, manager, approved: false, balance };
  }

  async readWalletSnapshot(account: string, knownEvents: ChainEvent[] = []): Promise<RoleSnapshot> {
    const classification = await this.classifyWallet(account, knownEvents);
    if (classification.role === 'manager') return this.readManagerSnapshot(account, classification.manager);
    if (classification.role === 'investor') return this.readInvestorSnapshot(account, classification.manager);
    if (classification.role === 'inactiveInvestor') return this.readInactiveInvestorSnapshot(account, classification.manager);
    return this.readProvisionalSnapshot(account, classification.manager, classification.balance);
  }

  async readManagerSnapshot(account: string, manager: string): Promise<FundSnapshot> {
    const [totalFundSize, availableFunds, invoiceCount, connectedBalance, totalSupply] = await Promise.all([
      this.contract.getFunction('totalFundSize')(),
      this.contract.getFunction('availableFunds')(),
      this.contract.getFunction('invoiceCount')(),
      this.balanceOf(account),
      this.contract.getFunction('totalSupply')(),
    ]);
    const count = BigInt(invoiceCount);
    const ids = Array.from({ length: Number(count) }, (_, index) => BigInt(index + 1));
    return { role: 'manager', manager, totalFundSize: BigInt(totalFundSize), availableFunds: BigInt(availableFunds), invoiceCount: count, connectedBalance, totalSupply: BigInt(totalSupply), invoices: await this.readInvoices(ids) };
  }

  async readInvestorSnapshot(account: string, manager: string): Promise<InvestorSnapshot> {
    const [approved, connectedBalance] = await Promise.all([this.isApproved(account), this.balanceOf(account)]);
    if (!approved) throw new Error('Investor approval changed. Refresh the connected wallet role.');
    return { role: 'investor', manager, approved: true, connectedBalance };
  }

  async readInactiveInvestorSnapshot(account: string, manager: string): Promise<InactiveInvestorSnapshot> {
    const [approved, connectedBalance] = await Promise.all([this.isApproved(account), this.balanceOf(account)]);
    if (approved) throw new Error('Investor approval changed. Refresh the connected wallet role.');
    return { role: 'inactiveInvestor', manager, approved: false, connectedBalance };
  }

  async readSmeSnapshot(account: string, manager: string): Promise<SmeSnapshot> {
    const count = BigInt(await this.contract.getFunction('invoiceCount')());
    const ids = Array.from({ length: Number(count) }, (_, index) => BigInt(index + 1));
    const invoices = filterInvoicesForSme(await this.readInvoices(ids), account);
    return { role: 'sme', manager, invoices };
  }

  async readProvisionalSnapshot(account: string, manager: string, connectedBalance: bigint): Promise<ProvisionalSnapshot | SmeSnapshot> {
    const smeSnapshot = await this.readSmeSnapshot(account, manager);
    if (classifyProvisionalWallet(smeSnapshot.invoices.length > 0) === 'sme') return smeSnapshot;
    return { role: 'provisional', manager, approved: false, connectedBalance }; 
  }

  async getPayerExposure(payer: string): Promise<bigint> {
    return BigInt(await this.contract.getFunction('getPayerExposure')(payer));
  }

  async getMaxPayerExposure(): Promise<bigint> {
    return BigInt(await this.contract.getFunction('getMaxPayerExposure')());
  }

  async getMaxFundSize(): Promise<bigint> {
    return BigInt(await this.contract.getFunction('MAX_FUND_SIZE')());
  }

  async totalFundSize(): Promise<bigint> {
    return BigInt(await this.contract.getFunction('totalFundSize')());
  }

  async readInvoices(ids: bigint[]): Promise<ChainInvoice[]> {
    const invoices: ChainInvoice[] = [];
    for (let index = 0; index < ids.length; index += 10) {
      const batch = await Promise.all(ids.slice(index, index + 10).map(async id => mapInvoiceRecord(await this.contract.getFunction('invoices')(id))));
      invoices.push(...batch);
    }
    return invoices;
  }

  async readEvents(provider: Provider, fromBlock: number, toBlock: number): Promise<ChainEvent[]> {
    const events: ChainEvent[] = [];
    for (let start = fromBlock; start <= toBlock; start += EVENT_QUERY_CHUNK_SIZE) {
      const end = Math.min(start + EVENT_QUERY_CHUNK_SIZE - 1, toBlock);
      const logs = await provider.getLogs({ address: await this.contract.getAddress(), fromBlock: start, toBlock: end });
      for (const log of logs) {
        const parsed = this.contract.interface.parseLog(log);
        if (!parsed) continue;
        const args = parsed.args;
        let detail = '';
        let amount: bigint | undefined;
        let invoiceId: bigint | undefined;
        let participants: string[] = [];
        switch (parsed.name) {
          case 'Transfer': detail = `${args.from} transferred ${args.value.toString()} RLU to ${args.to}`; amount = BigInt(args.value); participants = [String(args.from), String(args.to)]; break;
          case 'InvestorApproved': case 'InvestorRevoked': detail = String(args.investor); participants = [String(args.investor)]; break;
          case 'FundUnitsIssued': detail = `${args.investor} received ${args.amount.toString()} RLU`; amount = BigInt(args.amount); participants = [String(args.investor)]; break;
          case 'InvoiceSubmitted': invoiceId = BigInt(args.invoiceId); detail = `Invoice #${args.invoiceId} · ${args.payerName} · SME ${args.sme}`; amount = BigInt(args.amount); participants = [String(args.sme)]; break;
          case 'InvoiceApproved': invoiceId = BigInt(args.invoiceId); detail = `Invoice #${args.invoiceId}`; break;
          case 'InvoiceFinanced': case 'InvoiceRepaid': invoiceId = BigInt(args.invoiceId); detail = `Invoice #${args.invoiceId}`; amount = BigInt(args.amount); break;
          case 'InvoiceRejected': invoiceId = BigInt(args.invoiceId); detail = `Invoice #${args.invoiceId} · ${args.reason}`; break;
          default: continue;
        }
        events.push({ name: parsed.name, detail, amount, invoiceId, participants, transactionHash: log.transactionHash, logIndex: log.index, blockNumber: log.blockNumber });
      }
    }
    const blockNumbers = [...new Set(events.map(event => event.blockNumber))];
    const timestampByBlock = new Map<number, number>();
    for (let index = 0; index < blockNumbers.length; index += 10) {
      const batch = await Promise.all(blockNumbers.slice(index, index + 10).map(async blockNumber => [blockNumber, (await provider.getBlock(blockNumber))?.timestamp ?? 0] as const));
      for (const [blockNumber, timestamp] of batch) timestampByBlock.set(blockNumber, timestamp);
    }
    return events.map(event => ({ ...event, timestamp: timestampByBlock.get(event.blockNumber) })).sort((a, b) => b.blockNumber - a.blockNumber);
  }
}
