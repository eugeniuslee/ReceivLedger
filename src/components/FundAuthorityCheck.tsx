import { useEffect, useRef, useState } from 'react';
import { ZeroAddress } from 'ethers';
import { useLedger } from '../chain/LedgerContext';
import { useRegistry } from '../registration/RegistryContext';
import { RECEIVLEDGER_ADDRESS, SEPOLIA_CHAIN_ID, SEPOLIA_EXPLORER } from '../chain/abi';
import { V2_DEPLOYMENT } from '../v2/config';
import { readFundAuthorities, type AuthorityAddress, type FundAuthorities } from '../chain/fundAuthorities';
import { userFacingError } from '../errors';

export function FundAuthorityCheck() {
  const { account, walletEpoch = 0, networkOk, ledger } = useLedger();
  const { authenticated, isManager } = useRegistry();
  const provider = ledger?.contract?.runner?.provider ?? null;
  const key = `${account?.toLowerCase() ?? ''}:${walletEpoch}:${networkOk}`;
  const identity = useRef({ key, provider, generation: 0 });
  if (identity.current.key !== key || identity.current.provider !== provider) {
    identity.current = { key, provider, generation: identity.current.generation + 1 };
  }
  const sequence = useRef(0), mounted = useRef(true);
  const cancelCheck = useRef<(() => void) | null>(null);
  const [state, setState] = useState<{ key: string; generation: number; loading: boolean; result: FundAuthorities | null; error: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; sequence.current++; cancelCheck.current?.(); };
  }, [key, provider]);
  const visible = state?.key === key && state.generation === identity.current.generation ? state : null;

  async function check() {
    if (!account || !provider || !networkOk || visible?.loading) return;
    const generation = identity.current.generation, request = ++sequence.current;
    const current = () => mounted.current && generation === identity.current.generation && request === sequence.current;
    cancelCheck.current?.();
    let timer: number | undefined;
    let cancel!: () => void;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('The wallet connection took too long. Check MetaMask and your network, then try again.')), 20_000);
      cancel = () => { window.clearTimeout(timer); reject(new Error('Manager check cancelled.')); };
    });
    cancelCheck.current = cancel;
    setState({ key, generation, loading: true, result: null, error: '' });
    try {
      const result = await Promise.race([readFundAuthorities(provider), timeout]);
      if (current()) setState({ key, generation, loading: false, result, error: '' });
    } catch (cause) {
      if (current()) setState({ key, generation, loading: false, result: null, error: userFacingError(cause, 'Manager wallets could not be checked. Check your connection and retry.') });
    } finally {
      window.clearTimeout(timer);
      if (cancelCheck.current === cancel) cancelCheck.current = null;
    }
  }

  const result = visible?.result;
  return <section className="section-block" aria-labelledby="manager-wallet-check-title">
    <div className="section-heading"><h2 id="manager-wallet-check-title">Manager wallet check</h2>
      <button className="btn o" disabled={!account || !provider || !networkOk || visible?.loading} onClick={() => void check()}>{visible?.loading ? 'Checking manager wallets…' : 'Check manager wallets'}</button></div>
    <p className="support-copy">Compare your connected wallet with the manager recorded by each fund contract. A MetaMask account name does not grant permissions.</p>
    <dl className="detail-list"><div><dt>Connected wallet</dt><dd className="mono">{account ?? 'No wallet connected'}</dd></div>
      <div><dt>Required network</dt><dd>Ethereum Sepolia · {SEPOLIA_CHAIN_ID}</dd></div></dl>
    {!networkOk && <p className="notice info">Connect your wallet on Sepolia to run this check.</p>}
    {networkOk && !provider && <p className="notice info">The wallet connection is unavailable. Reconnect and try again.</p>}
    {visible?.loading && <p role="status">Reading contract permissions…</p>}
    {visible?.error && <p className="notice error" role="alert">{visible.error}</p>}
    {result && <p className="support-copy" role="status">Checked on Sepolia ({result.chainId}) at block {result.block} · <time dateTime={result.checkedAt}>{new Date(result.checkedAt).toLocaleString()}</time>. Addresses below came from this wallet’s blockchain connection.</p>}
    <section aria-label="RLU manager permissions"><h3>RLU: purchases, issuance and invoices</h3>
      <ContractLink address={RECEIVLEDGER_ADDRESS} />
      <AddressResult label="RLU manager" result={result?.rluManager} wallet={account} />
    </section>
    <section aria-label="RLU2 manager permissions"><h3>RLU2: separate fund</h3>
      <ContractLink address={V2_DEPLOYMENT.address} />
      <AddressResult label="RLU2 owner" result={result?.rlu2Owner} wallet={account} />
      <AddressResult label="Proposed next RLU2 owner" result={result?.rlu2PendingOwner} wallet={account} pending />
    </section>
    <section aria-label="Purchase service permissions"><h3>Private purchase review</h3>
      <p>{!authenticated ? 'Not checked: sign in from My Profile to verify private review access.' : isManager ? 'Your signed-in session is authorised to review RLU purchases.' : 'Your signed-in session is not authorised to review other investors’ RLU purchases.'}</p>
    </section>
    <p className="footnote">This check reads permissions only. It does not change manager wallets or request a signature.</p>
  </section>;
}

function ContractLink({ address }: { address: string }) {
  return <p>Contract: <a className="mono tx-link" href={`${SEPOLIA_EXPLORER}/address/${address}#readContract`} target="_blank" rel="noreferrer">{address}</a></p>;
}
function AddressResult({ label, result, wallet, pending = false }: { label: string; result?: AuthorityAddress; wallet: string | null; pending?: boolean }) {
  if (!result) return <p>{label}: not checked.</p>;
  if (result.error) return <p className="notice error" role="alert">{label} unavailable: {result.error}</p>;
  if (pending && result.address === ZeroAddress) return <p>No RLU2 ownership transfer is pending.</p>;
  const matches = Boolean(wallet && result.address?.toLowerCase() === wallet.toLowerCase());
  return <div><p>{label}: <code>{result.address}</code></p><p className="support-copy">{matches ? pending ? 'This is your connected wallet. The proposed transfer has not taken effect.' : 'This matches your connected wallet.' : 'This is a different wallet from the one connected.'}</p></div>;
}
