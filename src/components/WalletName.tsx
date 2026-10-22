import { useRegistry } from '../registration/RegistryContext';
import { shortAddress } from '../chain/presentation';

export function WalletName({ address, full = false }: { address: string; full?: boolean }) {
  const { displayName } = useRegistry();
  const name = displayName(address);
  return <span title={address}>{name && <strong className="wallet-name">{name}</strong>}<span className="mono">{full ? address : shortAddress(address)}</span></span>;
}
