import { useCallback, useEffect, useRef, useState } from 'react';
import { JsonRpcProvider, type Provider } from 'ethers';
import { V2Ledger } from './V2Ledger';
import { V2_DEPLOYMENT, V2_PUBLIC_RPC } from './config';
import { userFacingError } from '../errors';
import { useOptionalLedger } from '../chain/LedgerContext';
type Report = Awaited<ReturnType<V2Ledger['readReport']>>;
/** One report attempt may not hang the page; the next source is tried instead. */
export const REPORT_SOURCE_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not respond in time.`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Public reads only. Generation guards invalidate A/B/A switches, epochs and unmounts.
 * Reads use the connected wallet's Sepolia connection first (the same path V1 and
 * manager recognition use), then the public RPC. Neither path can sign. */
export function usePublicReport(address: string, wallet: string, epoch: number, networkOk = true) {
  const walletProvider = useOptionalLedger()?.readProvider ?? null;
  const key = address.toLowerCase() + ':' + wallet.toLowerCase() + ':' + epoch + ':' + networkOk;
  const identity = useRef({ key, generation: 0 });
  if (identity.current.key !== key) identity.current = { key, generation: identity.current.generation + 1 };
  const sequence = useRef(0);
  const [state, setState] = useState<{key:string; generation:number; data:Report|null; error:string; loading:boolean}|null>(null);
  useEffect(() => () => { sequence.current++; }, [key]);
  const read = useCallback(async () => {
    if (!networkOk) return;
    const generation = identity.current.generation, request = ++sequence.current;
    const current = () => key === identity.current.key && generation === identity.current.generation && request === sequence.current;
    setState({key,generation,data:null,error:'',loading:true});
    const sources: { label: string; provider: () => Provider; owned: boolean }[] = [];
    if (walletProvider) sources.push({ label: 'Wallet network connection', provider: () => walletProvider, owned: false });
    sources.push({ label: 'Public Sepolia RPC', provider: () => new JsonRpcProvider(V2_PUBLIC_RPC,V2_DEPLOYMENT.chainId,{staticNetwork:true}), owned: true });
    let lastError: unknown = null;
    for (const source of sources) {
      if (!current()) return;
      const provider = source.provider();
      try {
        const data = await withTimeout(new V2Ledger(address,provider).readReport(wallet), REPORT_SOURCE_TIMEOUT_MS, source.label);
        if (current()) setState({key,generation,data,error:'',loading:false});
        return;
      } catch (cause) { lastError = cause; }
      finally { if (source.owned) (provider as JsonRpcProvider).destroy(); }
    }
    if (current()) setState({key,generation,data:null,error:userFacingError(lastError),loading:false});
  }, [key,address,wallet,networkOk,walletProvider]);
  const visible = state?.key === key && state.generation === identity.current.generation ? state : null;
  return { report:visible?.data??null, error:visible?.error??'', loading:visible?.loading??false, read };
}
