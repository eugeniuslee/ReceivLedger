import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useLedger } from '../chain/LedgerContext';
import { registryClient, registryConfigurationError, registryRequest } from './client';
import { createSignInMessage, sameWallet } from './auth';
import { needsApplicationSession, rememberApplicationWallet } from './enrollment';
import type { Application, RegistrySnapshot } from '../../supabase/functions/_shared/domain';

interface DirectoryName { wallet: string; display_name: string; kind: string }
interface AuthenticatedState extends RegistrySnapshot { token: string; scope: string; version: number; names: DirectoryName[] }
interface RegistryContextValue {
  configured: boolean; authenticated: boolean; busy: boolean; error: string | null; requiresRegistrationSession?: boolean;
  frontendConfigurationError?: string | null;
  application: Application | null; registeredName: string | null; isManager: boolean;
  signIn: () => Promise<void>; signOut: () => Promise<void>; reload: () => Promise<void>;
  request: <T>(input: Record<string, unknown> | FormData) => Promise<T>;
  displayName: (wallet: string) => string | null;
}
const unavailable = async (): Promise<never> => { throw new Error('Sign in after configuring Supabase.'); };
const fallback: RegistryContextValue = { configured: false, authenticated: false, busy: false, error: null,
  frontendConfigurationError: registryConfigurationError,
  application: null, registeredName: null, isManager: false, signIn: unavailable, signOut: async () => {}, reload: async () => {}, request: unavailable, displayName: () => null };
const RegistryContext = createContext<RegistryContextValue>(fallback);
const signOutFailure = 'Private data cleared here, but server sign-out failed. Reconnect to retry.';

export function RegistryProvider({ children, client = registryClient }: { children: ReactNode; client?: SupabaseClient | null }) {
  const { account, networkOk, signWalletMessage } = useLedger();
  const scope = account && networkOk ? account.toLowerCase() : '';
  const generation = useRef({ scope, version: 0 });
  if (generation.current.scope !== scope) generation.current = { scope, version: generation.current.version + 1 };
  const [state, setState] = useState<AuthenticatedState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const operationInFlight = useRef(false);
  const authenticated = state && state.scope === scope && state.version === generation.current.version && sameWallet(state.profile.wallet, account) ? state : null;
  const stateRef = useRef(authenticated); stateRef.current = authenticated;

  const enqueue = useCallback((operation: () => Promise<void>) => {
    const result = queue.current.catch(() => {}).then(operation);
    queue.current = result.catch(() => {});
    return result;
  }, []);

  useEffect(() => {
    setState(null); setError(null);
    const version = generation.current.version;
    if (client) void enqueue(async () => {
      try {
        const result = await client.auth.signOut({ scope: 'local' });
        if (result.error) throw result.error;
      } catch {
        if (version === generation.current.version) setError(signOutFailure);
      }
    });
  }, [scope, client, enqueue]);

  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        if (stateRef.current) generation.current = { ...generation.current, version: generation.current.version + 1 };
        stateRef.current = null;
        setState(null);
      }
      else if (event === 'TOKEN_REFRESHED' && session) setState(previous => previous && previous.scope === generation.current.scope && previous.version === generation.current.version && previous.profile.user_id === session.user.id ? { ...previous, token: session.access_token } : previous);
    });
    return () => { data.subscription.unsubscribe(); };
  }, [client]);

  async function signIn() {
    if (!client) { setError(registryConfigurationError ?? 'Frontend Supabase configuration is unavailable.'); return; }
    if (!account || !networkOk) { setError('Connect your intended wallet on Sepolia before signing in.'); return; }
    if (operationInFlight.current) return;
    operationInFlight.current = true; setBusy(true); setError(null);
    generation.current = { ...generation.current, version: generation.current.version + 1 };
    stateRef.current = null; setState(null);
    const version = generation.current.version; const signingAccount = account;
    await enqueue(async () => {
      let stage = 'Session cleanup';
      try {
        if (version !== generation.current.version) return;
        const cleanup = await client.auth.signOut({ scope: 'local' });
        if (cleanup.error) throw new Error(signOutFailure);
        stage = 'Wallet signature';
        const message = createSignInMessage(signingAccount, window.location.origin);
        const signature = await signWalletMessage(message);
        if (version !== generation.current.version) return;
        stage = 'Supabase authentication';
        const { data, error: authError } = await client.auth.signInWithWeb3({ chain: 'ethereum', message, signature: signature as `0x${string}` });
        if (authError) throw authError;
        const token = data.session.access_token;
        stage = 'Registration service';
        const snapshot = await registryRequest<RegistrySnapshot>(client, token, { action: 'bootstrap' });
        if (!sameWallet(snapshot.profile.wallet, signingAccount)) throw new Error('The signed session belongs to another wallet.');
        const names = await registryRequest<DirectoryName[]>(client, token, { action: 'directory' });
        if (version !== generation.current.version) { await client.auth.signOut({ scope: 'local' }); return; }
        if (snapshot.application) rememberApplicationWallet(signingAccount);
        setState({ ...snapshot, token, scope: signingAccount.toLowerCase(), version, names });
      } catch (cause) {
        await client.auth.signOut({ scope: 'local' }).catch(() => {});
        if (version === generation.current.version) { setState(null); setError(`${stage} failed: ${(cause as Error).message}`); }
      } finally { operationInFlight.current = false; setBusy(false); }
    });
  }
  async function signOut() {
    setState(null); setError(null);
    stateRef.current = null;
    generation.current = { ...generation.current, version: generation.current.version + 1 };
    const version = generation.current.version;
    if (client) await enqueue(async () => {
      try {
        const result = await client.auth.signOut({ scope: 'local' });
        if (result.error) throw result.error;
      } catch {
        if (version === generation.current.version) setError(signOutFailure);
      }
    });
  }
  async function request<T>(input: Record<string, unknown> | FormData): Promise<T> {
    const active = stateRef.current;
    if (!client || !active || active.scope !== generation.current.scope || active.version !== generation.current.version) throw new Error('Sign in with this wallet to access private records.');
    const version = generation.current.version;
    const result = await registryRequest<T>(client, active.token, input);
    if (version !== generation.current.version) throw new Error('Wallet changed. The previous wallet response was discarded.');
    if (!(input instanceof FormData) && input.action === 'submit') {
      const saved = result as Application;
      if (!saved || saved.user_id !== active.profile.user_id || !sameWallet(saved.wallet, active.profile.wallet)) throw new Error('The saved application did not match this wallet. Refresh your application.');
      rememberApplicationWallet(active.profile.wallet);
      setState(previous => previous && previous.version === version ? { ...previous, application: saved } : previous);
    }
    return result;
  }
  async function reload() {
    const active = stateRef.current; if (!active) return;
    const version = generation.current.version;
    try {
      const snapshot = await request<RegistrySnapshot>({ action: 'bootstrap' });
      const names = await request<DirectoryName[]>({ action: 'directory' });
      if (version === generation.current.version) {
        if (snapshot.application) rememberApplicationWallet(active.profile.wallet);
        setState({ ...snapshot, scope: active.scope, version, token: stateRef.current?.token ?? active.token, names });
      }
    } catch (cause) { if (version === generation.current.version) setError((cause as Error).message); }
  }
  const value: RegistryContextValue = { configured: Boolean(client), authenticated: Boolean(authenticated), busy,
    requiresRegistrationSession: Boolean(authenticated?.application) || needsApplicationSession(account),
    frontendConfigurationError: client ? null : registryConfigurationError,
    error: error ?? (client ? null : registryConfigurationError), application: authenticated?.application ?? null,
    registeredName: authenticated?.application?.display_name ?? null, isManager: authenticated?.isManager ?? false,
    signIn, signOut, reload, request,
    displayName: wallet => authenticated?.names.find(name => sameWallet(name.wallet, wallet))?.display_name ?? null };
  return <RegistryContext.Provider value={value}>{children}</RegistryContext.Provider>;
}
export function useRegistry() { return useContext(RegistryContext); }
