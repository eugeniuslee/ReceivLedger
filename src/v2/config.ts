import { getAddress } from 'ethers';
import deployment from './deployment.json';
export const V2_DEPLOYMENT = Object.freeze(deployment);
export const V2_PUBLIC_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
/** Optional build-time confirmation of the verified address, never an activation flag.
 * Empty configuration uses the checked-in public deployment. A stale/wrong override
 * fails closed instead of pointing the unified website at another contract. */
export function resolveV2Address(value?: string): string {
  const address = value?.trim() || deployment.address;
  try {
    if (getAddress(address).toLowerCase() === deployment.address.toLowerCase()) return getAddress(address);
  } catch { /* Report configuration failure without substituting V1. */ }
  throw new Error('VITE_V2_CONTRACT_ADDRESS must match the verified ReceivLedger V2 Sepolia address.');
}
