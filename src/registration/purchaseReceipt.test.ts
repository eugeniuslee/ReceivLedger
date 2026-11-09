import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Interface, ZeroAddress } from 'ethers';
import { createRegistryChain, REVIEW_ABI, validateIssuanceEvidence, type IssuanceEvidence } from '../../supabase/functions/_shared/chain';
import { CONTRACT_ADDRESS } from '../../supabase/functions/_shared/domain';

const rpc = vi.hoisted(() => ({
  network: vi.fn(), receipt: vi.fn(), transaction: vi.fn(), head: vi.fn(), block: vi.fn(), manager: vi.fn(), approved: vi.fn(),
}));
vi.mock('ethers', async importOriginal => ({
  ...await importOriginal<typeof import('ethers')>(),
  JsonRpcProvider: class {
    getNetwork = rpc.network;
    getTransactionReceipt = rpc.receipt;
    getTransaction = rpc.transaction;
    getBlockNumber = rpc.head;
    getBlock = rpc.block;
  },
  Contract: class {
    getFunction(name: string) {
      if (name === 'manager') return rpc.manager;
      if (name === 'approvedInvestors') return rpc.approved;
      throw new Error(`Unexpected contract read: ${name}`);
    }
  },
}));

const manager = '0x1111111111111111111111111111111111111111';
const investor = '0x2222222222222222222222222222222222222222';
const anotherWallet = '0x3333333333333333333333333333333333333333';
const hash = `0x${'a'.repeat(64)}`;
const blockHash = `0x${'b'.repeat(64)}`;
const units = '250';
const minedAt = 1793491200;
const createdAt = new Date((minedAt - 60) * 1000).toISOString();
const iface = new Interface(REVIEW_ABI);
function log(name: string, values: readonly unknown[], address = CONTRACT_ADDRESS) {
  return { address, ...iface.encodeEventLog(iface.getEvent(name)!, values) };
}
function evidence(): IssuanceEvidence {
  return {
    chainId: 11155111n, status: 1, confirmations: 2, to: CONTRACT_ADDRESS, from: manager,
    data: iface.encodeFunctionData('issueFundUnits', [investor, units]),
    logs: [log('Transfer', [ZeroAddress, investor, units]), log('FundUnitsIssued', [investor, units])],
    approved: true, currentManager: manager, matchedBlock: true, blockTimestamp: minedAt,
  };
}
function validate(change: Partial<IssuanceEvidence> = {}) {
  validateIssuanceEvidence({ ...evidence(), ...change }, investor, units, manager, createdAt);
}

describe('purchase issuance receipt validation', () => {
  it('accepts only the exact V1 issuance and mint for the requested whole RLU amount', () => {
    expect(() => validate()).not.toThrow();
  });

  it.each<[string, Partial<IssuanceEvidence>]>([
    ['wrong chain', { chainId: 1n }],
    ['failed transaction', { status: 0 }],
    ['insufficient confirmations', { confirmations: 1 }],
    ['invalid confirmations', { confirmations: NaN }],
    ['reorged receipt', { matchedBlock: false }],
    ['wrong contract', { to: anotherWallet }],
    ['contract creation', { to: null }],
    ['wrong sender', { from: anotherWallet }],
    ['stale manager', { currentManager: anotherWallet }],
    ['wrong recipient', { data: iface.encodeFunctionData('issueFundUnits', [anotherWallet, units]) }],
    ['wrong amount', { data: iface.encodeFunctionData('issueFundUnits', [investor, '251']) }],
    ['different method', { data: iface.encodeFunctionData('approveInvestor', [investor]) }],
    ['malformed calldata', { data: '0x' }],
    ['revoked investor', { approved: false }],
    ['missing logs', { logs: [] }],
    ['issuance without mint', { logs: [log('FundUnitsIssued', [investor, units])] }],
    ['mint without issuance', { logs: [log('Transfer', [ZeroAddress, investor, units])] }],
    ['ordinary transfer instead of mint', { logs: [log('Transfer', [manager, investor, units]), log('FundUnitsIssued', [investor, units])] }],
    ['wrong mint recipient', { logs: [log('Transfer', [ZeroAddress, anotherWallet, units]), log('FundUnitsIssued', [investor, units])] }],
    ['wrong event amount', { logs: [log('Transfer', [ZeroAddress, investor, units]), log('FundUnitsIssued', [investor, '251'])] }],
    ['forged events from another contract', { logs: [log('Transfer', [ZeroAddress, investor, units], anotherWallet), log('FundUnitsIssued', [investor, units], anotherWallet)] }],
    ['malformed event', { logs: [{ address: CONTRACT_ADDRESS, topics: [], data: '0x1234' }] }],
    ['old issuance predating request', { blockTimestamp: minedAt - 61 }],
    ['missing timestamp', { blockTimestamp: NaN }],
  ])('rejects %s', (_label, change) => {
    expect(() => validate(change)).toThrow();
  });

  it('uses the exact request timestamp, including milliseconds', () => {
    const exact = new Date(minedAt * 1000).toISOString();
    expect(() => validateIssuanceEvidence(evidence(), investor, units, manager, exact)).not.toThrow();
    expect(() => validateIssuanceEvidence(evidence(), investor, units, manager, new Date(minedAt * 1000 + 1).toISOString())).toThrow(/created/);
    expect(() => validateIssuanceEvidence(evidence(), investor, units, manager, 'invalid date')).toThrow(/created/);
  });

  it.each(['0', '-1', '1.5', '1e2', '0250', (2n ** 256n).toString()])('rejects invalid requested units %s', value => {
    expect(() => validateIssuanceEvidence(evidence(), investor, value, manager, createdAt)).toThrow(/whole RLU/);
  });
});

describe('independent purchase receipt RPC checks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const e = evidence();
    rpc.network.mockResolvedValue({ chainId: 11155111n });
    rpc.receipt.mockResolvedValue({ hash, blockHash, blockNumber: 122, status: 1, logs: e.logs });
    rpc.transaction.mockResolvedValue({ hash, blockHash, blockNumber: 122, chainId: e.chainId, to: e.to, from: e.from, data: e.data });
    rpc.head.mockResolvedValue(123);
    rpc.block.mockResolvedValue({ hash: blockHash, number: 122, timestamp: minedAt });
    rpc.manager.mockResolvedValue(manager);
    rpc.approved.mockResolvedValue(true);
  });

  const verify = () => createRegistryChain('https://rpc.example.test').verifyIssuance!(hash, investor, units, manager, createdAt);

  it('pins current manager and investor approval to one head and checks the canonical receipt block', async () => {
    await expect(verify()).resolves.toBeUndefined();
    expect(rpc.receipt).toHaveBeenCalledWith(hash);
    expect(rpc.transaction).toHaveBeenCalledWith(hash);
    expect(rpc.block).toHaveBeenCalledWith(122);
    expect(rpc.manager).toHaveBeenCalledWith({ blockTag: 123 });
    expect(rpc.approved).toHaveBeenCalledWith(investor, { blockTag: 123 });
  });

  it('rejects a receipt whose block is no longer canonical', async () => {
    rpc.block.mockResolvedValue({ hash: `0x${'c'.repeat(64)}`, number: 122, timestamp: minedAt });
    await expect(verify()).rejects.toThrow(/current Sepolia/);
  });

  it('rejects a transaction whose receipt refers to another block', async () => {
    const tx = await rpc.transaction();
    rpc.transaction.mockResolvedValue({ ...tx, blockHash: `0x${'c'.repeat(64)}` });
    await expect(verify()).rejects.toThrow(/current Sepolia/);
  });

  it('rejects missing transactions and mismatched returned hashes', async () => {
    rpc.transaction.mockResolvedValue(null);
    await expect(verify()).rejects.toThrow(/not been mined/);
    rpc.transaction.mockResolvedValue({ hash: `0x${'c'.repeat(64)}` });
    await expect(verify()).rejects.toThrow(/not been mined/);
  });

  it('rejects an old valid issuance for a newly created purchase request', async () => {
    rpc.block.mockResolvedValue({ hash: blockHash, number: 122, timestamp: minedAt - 61 });
    await expect(verify()).rejects.toThrow(/created/);
  });

  it('rejects a revoked investor or a changed manager at the current head', async () => {
    rpc.approved.mockResolvedValue(false);
    await expect(verify()).rejects.toThrow(/still be approved/);
    rpc.approved.mockResolvedValue(true);
    rpc.manager.mockResolvedValue(anotherWallet);
    await expect(verify()).rejects.toThrow(/current fund manager/);
  });

  it('rejects another network before reading receipt data', async () => {
    rpc.network.mockResolvedValue({ chainId: 1n });
    await expect(verify()).rejects.toThrow(/Sepolia/);
    expect(rpc.receipt).not.toHaveBeenCalled();
  });

  it('reads investor approval without treating registration as on-chain approval', async () => {
    const chain = createRegistryChain('https://rpc.example.test');
    await expect(chain.approvedInvestor!(investor)).resolves.toBe(true);
    rpc.approved.mockResolvedValue(false);
    await expect(chain.approvedInvestor!(investor)).resolves.toBe(false);
  });
});
