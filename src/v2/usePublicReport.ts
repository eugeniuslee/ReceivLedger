import { useCallback, useEffect, useRef, useState } from 'react';
import { JsonRpcProvider } from 'ethers';
import { V2Ledger } from './V2Ledger';
import { V2_DEPLOYMENT, V2_PUBLIC_RPC } from './config';
import { userFacingError } from '../errors';
type Report = Awaited<ReturnType<V2Ledger['readReport']>>;
/** Public reads only. Generation guards invalidate A/B/A switches, epochs and unmounts. */
export function usePublicReport(address: string, wallet: string, epoch: number, networkOk = true) {
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
    const provider = new JsonRpcProvider(V2_PUBLIC_RPC,V2_DEPLOYMENT.chainId,{staticNetwork:true});
    try {
      const data = await new V2Ledger(address,provider).readReport(wallet);
      if (current()) setState({key,generation,data,error:'',loading:false});
    } catch (cause) {
      if (current()) setState({key,generation,data:null,error:userFacingError(cause),loading:false});
    } finally { provider.destroy(); }
  }, [key,address,wallet,networkOk]);
  const visible = state?.key === key && state.generation === identity.current.generation ? state : null;
  return { report:visible?.data??null, error:visible?.error??'', loading:visible?.loading??false, read };
}
