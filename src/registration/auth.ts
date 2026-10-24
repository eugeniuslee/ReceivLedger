import { getAddress } from 'ethers';
import { SEPOLIA_CHAIN_ID } from '../chain/abi';

export function createSignInMessage(wallet: string, origin: string, now = new Date(), nonce?: string) {
  const uri = new URL('/', origin);
  if (uri.protocol !== 'https:' && !(uri.protocol === 'http:' && uri.hostname === 'localhost')) throw new Error('Wallet sign-in requires HTTPS or localhost.');
  const random = nonce ?? Array.from(crypto.getRandomValues(new Uint8Array(16))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (!/^[A-Za-z0-9]{8,}$/.test(random)) throw new Error('Invalid sign-in nonce.');
  return `${uri.host} wants you to sign in with your Ethereum account:\n${getAddress(wallet)}\n\nSign in to ReceivLedger for private demo registration and document review. This is not a blockchain transaction.\n\nURI: ${uri.href}\nVersion: 1\nChain ID: ${SEPOLIA_CHAIN_ID}\nNonce: ${random}\nIssued At: ${now.toISOString()}\nExpiration Time: ${new Date(now.getTime() + 5 * 60_000).toISOString()}\nNot Before: ${now.toISOString()}`;
}

export function sameWallet(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

/** A configuration rejection is different from a wallet/session failure. */
export function isSignInOriginError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
  return /URI which is not allowed|signed for another app/i.test(message);
}
