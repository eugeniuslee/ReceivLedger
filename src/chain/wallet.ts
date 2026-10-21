import { BrowserProvider } from 'ethers';
import { SEPOLIA_CHAIN_ID } from './abi';

/** NOT USED YET. MetaMask connection helper for the Sepolia phase. */
export async function connectWallet() {
  const eth = (window as unknown as { ethereum?: import('ethers').Eip1193Provider }).ethereum;
  if (!eth) throw new Error('MetaMask not found');
  const provider = new BrowserProvider(eth);
  await provider.send('eth_requestAccounts', []);
  const { chainId } = await provider.getNetwork();
  if (Number(chainId) !== SEPOLIA_CHAIN_ID) throw new Error('Please switch MetaMask to Sepolia');
  const signer = await provider.getSigner();
  return { provider, signer, address: await signer.getAddress() };
}
