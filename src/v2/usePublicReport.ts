import { useCallback, useEffect, useRef, useState } from 'react';
import { FetchRequest, JsonRpcProvider, type Provider } from 'ethers';
import { V2Ledger } from './V2Ledger';
import { V2_DEPLOYMENT, V2_PUBLIC_RPC } from './config';
import { userFacingError } from '../errors';
type Report = Awaited<ReturnType<V2Ledger['readReport']>>;
class WrongNetwork extends Error {}
class CancelledRead extends Error {}
class ReadTimeout extends Error {}

function errorEntries(value: unknown, depth = 0): Record<string, unknown>[] {
  if (!value || typeof value !== 'object' || depth > 4) return [];
  const entry = value as Record<string, unknown>;
  return [entry, ...['error', 'cause', 'info'].flatMap(key => errorEntries(entry[key], depth + 1))];
}
function transportFailure(cause: unknown): boolean {
  if (cause instanceof WrongNetwork || cause instanceof CancelledRead) return false;
  if (cause instanceof ReadTimeout) return true;
  const entries = errorEntries(cause);
  if (entries.some(error => ['CALL_EXCEPTION', 'BAD_DATA', 'INVALID_ARGUMENT'].includes(String(error.code)) || error.event === 'changed')) return false;
  return entries.some(error => ['NETWORK_ERROR', 'SERVER_ERROR', 'TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes(String(error.code))
    || error.code === 429 || error.code === -32005
    || typeof error.message === 'string' && /network|fetch|timed?\s*out|timeout|rate.?limit|too many requests|socket|connection|gateway|service unavailable/i.test(error.message));
}
function readError(cause: unknown): string {
  if (cause instanceof ReadTimeout) return 'Loading fund data took too long. Check your Sepolia connection, then use Refresh fund data to try again.';
  if (transportFailure(cause)) return 'The Sepolia connection could not load fund data. Check your connection, then use Refresh fund data to try again.';
  return userFacingError(cause, 'Fund data could not be loaded. Check Sepolia and refresh fund data.');
}
async function requireSepolia(provider: Provider) {
  if ((await provider.getNetwork()).chainId !== BigInt(V2_DEPLOYMENT.chainId)) throw new WrongNetwork('Switch your wallet to Sepolia, then refresh fund data.');
}

/** Public reads only. Generation guards invalidate A/B/A switches, epochs and unmounts. */
export function usePublicReport(address: string, wallet: string, epoch: number, networkOk = true, connectedProvider: Provider | null = null) {
  const key = address.toLowerCase() + ':' + wallet.toLowerCase() + ':' + epoch + ':' + networkOk;
  const identity = useRef({ key, provider: connectedProvider, generation: 0 });
  if (identity.current.key !== key || identity.current.provider !== connectedProvider) identity.current = { key, provider: connectedProvider, generation: identity.current.generation + 1 };
  const sequence = useRef(0);
  const activeCancel = useRef<(() => void) | null>(null);
  const [state, setState] = useState<{key:string; generation:number; data:Report|null; error:string; loading:boolean}|null>(null);
  useEffect(() => () => { sequence.current++; activeCancel.current?.(); activeCancel.current = null; }, [key, connectedProvider]);
  const read = useCallback(async () => {
    if (!networkOk || !address || !wallet) return;
    const generation = identity.current.generation, request = ++sequence.current;
    const current = () => key === identity.current.key && generation === identity.current.generation && request === sequence.current;
    activeCancel.current?.();
    let cancelAttempt: (() => void) | null = null;
    let cancelled = false;
    const cancel = () => { cancelled = true; cancelAttempt?.(); };
    activeCancel.current = cancel;
    setState({key,generation,data:null,error:'',loading:true});

    async function attempt(provider: Provider, owned: boolean, milliseconds: number): Promise<Report> {
      let timer: number | undefined;
      let finished = false;
      const active = () => !finished && !cancelled && current();
      const interrupted = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new ReadTimeout()), milliseconds);
        cancelAttempt = () => reject(new CancelledRead());
      });
      try {
        return await Promise.race([(async () => {
          // V2Ledger validates the owned RPC's chain during the real report.
          // A borrowed wallet may switch chains, so check it at both ends too.
          if (!owned) await requireSepolia(provider);
          if (!active()) throw new CancelledRead();
          const data = await new V2Ledger(address, provider).readReport(wallet);
          if (!active()) throw new CancelledRead();
          if (!owned) await requireSepolia(provider);
          return data;
        })(), interrupted]);
      } finally {
        finished = true;
        window.clearTimeout(timer);
        cancelAttempt = null;
        // The connected provider belongs to LedgerContext, not this request.
        if (owned) provider.destroy();
      }
    }
    function publicAttempt() {
      const connection = new FetchRequest(V2_PUBLIC_RPC);
      connection.timeout = 12_000;
      return attempt(new JsonRpcProvider(connection, V2_DEPLOYMENT.chainId, { staticNetwork: false }), true, 15_000);
    }
    try {
      let data: Report;
      if (connectedProvider) {
        try { data = await attempt(connectedProvider, false, 20_000); }
        catch (cause) {
          if (cancelled || !current() || !transportFailure(cause)) throw cause;
          // Retry a complete snapshot; never mix records from different sources.
          data = await publicAttempt();
        }
      } else data = await publicAttempt();
      if (current()) setState({key,generation,data,error:'',loading:false});
    } catch (cause) {
      if (current() && !cancelled) setState({key,generation,data:null,error:readError(cause),loading:false});
    } finally { if (activeCancel.current === cancel) activeCancel.current = null; }
  }, [key,address,wallet,networkOk,connectedProvider]);
  const visible = state?.key === key && state.generation === identity.current.generation ? state : null;
  return { report:visible?.data??null, error:visible?.error??'', loading:visible?.loading??false, read };
}
