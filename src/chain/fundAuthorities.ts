import { Contract, getAddress, ZeroAddress, type Provider } from 'ethers';
import { RECEIVLEDGER_ADDRESS, SEPOLIA_CHAIN_ID } from './abi';
import { V2_DEPLOYMENT } from '../v2/config';
import { userFacingError } from '../errors';

export type AuthorityAddress = { address: string; error: null } | { address: null; error: string };
export interface FundAuthorities {
  chainId: number;
  block: number;
  checkedAt: string;
  rluManager: AuthorityAddress;
  rlu2Owner: AuthorityAddress;
  rlu2PendingOwner: AuthorityAddress;
}

/** Diagnostic reads only. These results never grant permissions or send a transaction. */
export async function readFundAuthorities(provider: Provider): Promise<FundAuthorities> {
  if ((await provider.getNetwork()).chainId !== BigInt(SEPOLIA_CHAIN_ID)) throw new Error('Switch MetaMask to Sepolia before checking manager wallets.');
  const block = await provider.getBlockNumber();
  const rlu = new Contract(RECEIVLEDGER_ADDRESS, ['function manager() view returns (address)'], provider);
  const rlu2 = new Contract(V2_DEPLOYMENT.address, ['function owner() view returns (address)', 'function pendingOwner() view returns (address)'], provider);
  async function addressRead(contract: Contract, name: string, allowZero = false): Promise<AuthorityAddress> {
    try {
      const address = getAddress(String(await contract.getFunction(name)({ blockTag: block })));
      if (!allowZero && address === ZeroAddress) throw new Error('The contract returned no manager wallet.');
      return { address, error: null };
    } catch (cause) {
      return { address: null, error: userFacingError(cause, 'This contract could not be read. Check the connection and retry.') };
    }
  }
  const [rluManager, rlu2Owner, rlu2PendingOwner] = await Promise.all([
    addressRead(rlu, 'manager'), addressRead(rlu2, 'owner'), addressRead(rlu2, 'pendingOwner', true),
  ]);
  if ((await provider.getNetwork()).chainId !== BigInt(SEPOLIA_CHAIN_ID)) throw new Error('The network changed during this check. Switch to Sepolia and check again.');
  return { chainId: SEPOLIA_CHAIN_ID, block, checkedAt: new Date().toISOString(), rluManager, rlu2Owner, rlu2PendingOwner };
}
