import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useLedger } from '../chain/LedgerContext';
import { registryClient, registryConfigurationError, registryRequest, RegistryRequestError } from './client';
import { createSignInMessage, isSignInOriginError, sameWallet } from './auth';
import { needsApplicationSession, rememberApplicationWallet } from './enrollment';
import type { Application, RegistrySnapshot } from '../../supabase/functions/_shared/domain';
import { userFacingError, walletErrorMessage } from '../errors';

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
class SessionMismatch extends Error {}
function invalidSession(cause: unknown) { return cause instanceof SessionMismatch || cause instanceof RegistryRequestError && cause.status === 401; }

// SDK credentials survive same-tab refresh. Never restore trust from storage or JWT claims:
// bootstrap validates Auth and the active Ethereum identity on the server.
async function restorePrivateSession(client: SupabaseClient, session: Session, wallet: string) {
  async function validate(credential: Session) {
    const snapshot = await registryRequest<RegistrySnapshot>(client, credential.access_token, { action: 'bootstrap' });
    if (!sameWallet(snapshot.profile.wallet, wallet) || snapshot.profile.user_id !== credential.user.id) throw new SessionMismatch('The signed session belongs to another wallet.');
    const names = await registryRequest<DirectoryName[]>(client, credential.access_token, { action: 'directory' });
    return { ...snapshot, token: credential.access_token, names };
  }
  try { return await validate(session); }
  catch (cause) {
    if (!(cause instanceof RegistryRequestError) || cause.status !== 401) throw cause;
    // The SDK may refresh while bootstrap is in flight. Retry once, only with
    // a different same-user token; both backend identity checks still run.
    const { data, error } = await client.auth.getSession();
    const refreshed = data.session;
    if (error || !refreshed || refreshed.user.id !== session.user.id || refreshed.access_token === session.access_token) throw cause;
    return validate(refreshed);
  }
}

export function RegistryProvider({ children, client = registryClient }: { children: ReactNode; client?: SupabaseClient | null }) {
  const { account, networkOk, walletChecking, walletEpoch = 0, signWalletMessage } = useLedger();
  const scope = account && networkOk ? account.toLowerCase() : '';
  const generation = useRef({ scope, epoch: walletEpoch, version: 0 });
  if (generation.current.scope !== scope || generation.current.epoch !== walletEpoch) generation.current = { scope, epoch: walletEpoch, version: generation.current.version + 1 };
  const [state, setState] = useState<AuthenticatedState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const operationInFlight = useRef(false);
  const previousScope = useRef<{ scope: string; epoch: number } | null>(null);
  const expectedSignOut = useRef(false);
  const restoringUser = useRef<{ version: number; id: string; refreshedToken?: string } | null>(null);
  const authenticated = state && state.scope === scope && state.version === generation.current.version && sameWallet(state.profile.wallet, account) ? state : null;
  const stateRef = useRef(authenticated); stateRef.current = authenticated;
  const clearClientSession = useCallback(async () => {
    if (!client) return { error: null };
    expectedSignOut.current = true;
    try { return await client.auth.signOut({ scope: 'local' }); }
    finally { expectedSignOut.current = false; }
  }, [client]);

  const enqueue = useCallback((operation: () => Promise<void>) => {
    const result = queue.current.catch(() => {}).then(operation);
    queue.current = result.catch(() => {});
    return result;
  }, []);

  useEffect(() => {
    // Wait for the initial passive wallet lookup. A real disconnect/network or
    // wallet change still invalidates the session immediately through generation.
    if (previousScope.current === null && (!scope || walletChecking)) return;
    const walletChanged = previousScope.current !== null && (previousScope.current.scope !== scope || previousScope.current.epoch !== walletEpoch);
    previousScope.current = { scope, epoch: walletEpoch };
    if (!walletChanged && stateRef.current) return;
    let active = true;
    setState(null); setError(null);
    const version = generation.current.version;
    if (client) void enqueue(async () => {
      if (!active || version !== generation.current.version) return;
      setBusy(true);
      try {
        if (!walletChanged && scope) {
          const { data, error: sessionError } = await client.auth.getSession();
          if (sessionError) throw sessionError;
          if (!active || version !== generation.current.version) return;
          if (data.session) {
            restoringUser.current = { version, id: data.session.user.id };
            const restored = await restorePrivateSession(client, data.session, scope);
            if (!active || version !== generation.current.version) return;
            if (restored.application) rememberApplicationWallet(scope);
            const validated = { ...restored, token: restoringUser.current?.refreshedToken ?? restored.token, scope, version };
            stateRef.current = validated;
            setState(validated);
          }
          return;
        }
        const result = await clearClientSession();
        if (result.error) throw result.error;
      } catch (cause) {
        if (!active || version !== generation.current.version) return;
        if (!walletChanged && scope) {
          if (invalidSession(cause)) await clearClientSession().catch(() => {});
          if (active && version === generation.current.version) setError(`Private session could not be restored: ${userFacingError(cause, 'Sign in again with this wallet.')}`);
        } else setError(signOutFailure);
      } finally {
        if (restoringUser.current?.version === version) restoringUser.current = null;
        if (active && version === generation.current.version) setBusy(false);
      }
    });
    return () => { active = false; };
  }, [scope, walletEpoch, walletChecking, client, enqueue, clearClientSession]);

  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        if (!expectedSignOut.current || stateRef.current) generation.current = { ...generation.current, version: generation.current.version + 1 };
        if (!expectedSignOut.current) setBusy(false);
        stateRef.current = null;
        restoringUser.current = null;
        setState(null);
      }
      else if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'USER_UPDATED') && session) {
        const active=stateRef.current;
        const expectedUser = active?.profile.user_id ?? restoringUser.current?.id;
        if(expectedUser && expectedUser!==session.user.id) {
          generation.current={...generation.current,version:generation.current.version+1};
          restoringUser.current=null;stateRef.current=null;setState(null);setBusy(false);setError('The authentication session changed. Verify the selected wallet again.');
        } else if(active && active.scope===generation.current.scope && active.version===generation.current.version && event==='TOKEN_REFRESHED') {
          const refreshed={...active,token:session.access_token};
          stateRef.current=refreshed;setState(refreshed);
        } else if (event === 'TOKEN_REFRESHED' && restoringUser.current?.version === generation.current.version) {
          restoringUser.current.refreshedToken = session.access_token;
        }
      }
    });
    return () => { data.subscription.unsubscribe(); };
  }, [client]);

  async function signIn() {
    if (!client) { setError(registryConfigurationError ?? 'Frontend Supabase configuration is unavailable.'); return; }
    if (!account || !networkOk) { setError('Connect your intended wallet on Sepolia before signing in.'); return; }
    if (operationInFlight.current) return;
    if (stateRef.current) { try { await reload(); } catch { /* reload reports its safe error */ } return; }
    operationInFlight.current = true; setBusy(true); setError(null);
    generation.current = { ...generation.current, version: generation.current.version + 1 };
    stateRef.current = null; setState(null);
    const version = generation.current.version; const signingAccount = account;
    await enqueue(async () => {
      let stage = 'Session restore';
      try {
        if (version !== generation.current.version) return;
        const { data: existing, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        if (version !== generation.current.version) return;
        let session = existing.session;
        if (!session) {
          stage = 'Session cleanup';
          const cleanup = await clearClientSession();
          if (cleanup.error) throw new Error(signOutFailure);
          stage = 'Wallet signature';
          const message = createSignInMessage(signingAccount, window.location.origin);
          const signature = await signWalletMessage(message);
          if (version !== generation.current.version) return;
          stage = 'Supabase authentication';
          const { data, error: authError } = await client.auth.signInWithWeb3({ chain: 'ethereum', message, signature: signature as `0x${string}` });
          if (authError) {
            if (isSignInOriginError(authError)) throw new Error('This website is not allowed by Supabase Auth. Ask the project owner to check the exact sign-in URL shown below in Authentication > URL Configuration.');
            throw authError;
          }
          session = data.session;
        }
        if (!session) throw new Error('No authenticated session was returned. Sign in again.');
        stage = 'Registration service';
        restoringUser.current = { version, id: session.user.id };
        const restored = await restorePrivateSession(client, session, signingAccount);
        if (version !== generation.current.version) { await clearClientSession(); return; }
        if (restored.application) rememberApplicationWallet(signingAccount);
        const validated = { ...restored, token: restoringUser.current?.refreshedToken ?? restored.token, scope: signingAccount.toLowerCase(), version };
        stateRef.current = validated;
        setState(validated);
      } catch (cause) {
        // A transient registry/RPC failure does not invalidate a valid SDK
        // session. Retry bootstrap without another signature; publish no data
        // until both server identity checks have succeeded.
        if (stage !== 'Registration service' || invalidSession(cause)) await clearClientSession().catch(() => {});
        if (version === generation.current.version) {
          setState(null);
          setError(stage === 'Wallet signature' ? walletErrorMessage(cause, 'signature')
            : `${stage} failed: ${userFacingError(cause, 'The service could not complete sign-in. Check its configuration and try again.')}`);
        }
      } finally {
        if (restoringUser.current?.version === version) restoringUser.current = null;
        operationInFlight.current = false; setBusy(false);
      }
    });
  }
  async function signOut() {
    setState(null); setError(null);
    stateRef.current = null;
    generation.current = { ...generation.current, version: generation.current.version + 1 };
    const version = generation.current.version;
    if (client) await enqueue(async () => {
      try {
        const result = await clearClientSession();
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
    let result: T;
    try { result = await registryRequest<T>(client, active.token, input); }
    catch (cause) {
      if (cause instanceof RegistryRequestError && cause.status === 401 && version === generation.current.version) {
        await signOut();
        if (generation.current.version === version + 1) setError(cause.message);
      }
      throw cause;
    }
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
    setError(null);
    try {
      const snapshot = await request<RegistrySnapshot>({ action: 'bootstrap' });
      if (!sameWallet(snapshot.profile.wallet, active.profile.wallet) || snapshot.profile.user_id !== active.profile.user_id) throw new SessionMismatch('The refreshed profile did not match this wallet. Sign in again.');
      const names = await request<DirectoryName[]>({ action: 'directory' });
      if (version === generation.current.version) {
        if (snapshot.application) rememberApplicationWallet(active.profile.wallet);
        setState({ ...snapshot, scope: active.scope, version, token: stateRef.current?.token ?? active.token, names });
      }
    } catch (cause) {
      const message = userFacingError(cause, 'Private records could not be refreshed. Please try again.');
      if (cause instanceof SessionMismatch && version === generation.current.version) {
        await signOut();
        if (generation.current.version === version + 1) setError(message);
      } else if (version === generation.current.version) setError(message);
      throw new Error(message);
    }
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
