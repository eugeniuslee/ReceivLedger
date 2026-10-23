// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistryProvider, useRegistry } from './RegistryContext';
import { registryRequest, readSupabaseConfiguration, RegistryRequestError } from './client';
import { resetBrowserStorage } from '../test/browserStorage';

vi.mock('../chain/LedgerContext', () => ({ useLedger: () => wallet }));
vi.mock('./client', async original => {
  const actual = await original<typeof import('./client')>();
  return { ...actual, registryRequest: vi.fn() };
});
const alice = '0x2222222222222222222222222222222222222222';
const bob = '0x3333333333333333333333333333333333333333';
let wallet: { account: string | null; networkOk: boolean; walletEpoch?: number; walletChecking?: boolean; signWalletMessage: ReturnType<typeof vi.fn> };
let client: SupabaseClient;
let signOut: ReturnType<typeof vi.fn>; let signIn: ReturnType<typeof vi.fn>; let getSession: ReturnType<typeof vi.fn>;
let authListener: (event: AuthChangeEvent, session: Session | null) => void;
let current: ReturnType<typeof useRegistry>;
function Probe() { current = useRegistry(); return <><span>{current.registeredName ?? 'No private name'}</span><button onClick={() => void current.signIn()}>Sign in</button></>; }
function snapshot(address = alice) { return { profile: { user_id: 'user', wallet: address }, isManager: false,
  application: { display_name: 'Fictional Alice', kind: 'investor', status: 'pending' } }; }
beforeEach(() => {
  resetBrowserStorage();
  wallet = { account: alice, networkOk: true, signWalletMessage: vi.fn().mockResolvedValue('0x' + 'a'.repeat(130)) };
  signOut = vi.fn().mockResolvedValue({ error: null });
  getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
  signIn = vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-user-session', user: { id: 'user' } } }, error: null });
  client = { auth: { getSession, signOut, signInWithWeb3: signIn, onAuthStateChange: (callback: typeof authListener) => { authListener = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } } as unknown as SupabaseClient;
  vi.mocked(registryRequest).mockReset().mockImplementation(async (_client, _token, input) => (input as Record<string, unknown>).action === 'bootstrap' ? snapshot() : []);
});
afterEach(cleanup);
async function authenticate() { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); await waitFor(() => expect(current.authenticated).toBe(true)); }

describe('private session and wallet isolation', () => {
  it('reports cancelled signatures without provider payloads or contacting Auth', async () => {
    wallet.signWalletMessage.mockRejectedValue({ code: 'ACTION_REJECTED', info: { error: { code: 4001 } }, message: '{private wallet payload}' });
    render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(current.error).toBe('Sign-in cancelled. No changes were made.'));
    expect(signIn).not.toHaveBeenCalled(); expect(registryRequest).not.toHaveBeenCalled();
    expect(current.authenticated).toBe(false);
  });
  it('surfaces refresh failure to callers, clears its error on retry and rejects mismatched profiles', async () => {
    render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await authenticate();
    vi.mocked(registryRequest).mockRejectedValueOnce(new Error('Registration service temporarily unavailable.'));
    await act(async () => { await expect(current.reload()).rejects.toThrow('temporarily unavailable'); });
    expect(current.error).toContain('temporarily unavailable');
    await act(async () => { await current.reload(); });
    expect(current.error).toBeNull();
    vi.mocked(registryRequest).mockResolvedValueOnce(snapshot(bob));
    await act(async () => { await expect(current.reload()).rejects.toThrow('did not match this wallet'); });
    expect(current.registeredName).toBeNull(); expect(current.authenticated).toBe(false);
    expect(current.error).toContain('did not match this wallet');
  });
  it('identifies Supabase authentication failure without losing frontend readiness', async () => {
    signIn.mockResolvedValue({ data: { session: null }, error: new Error('Ethereum provider is disabled.') });
    render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(current.error).toBe('Supabase authentication failed: Ethereum provider is disabled.'));
    expect(current.configured).toBe(true); expect(current.frontendConfigurationError).toBeNull();
  });
  it('identifies backend/bootstrap failures separately from frontend configuration and Auth', async () => {
    vi.mocked(registryRequest).mockRejectedValueOnce(new Error('Registration RPC is unavailable.'));
    render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(current.error).toBe('Registration service failed: Registration RPC is unavailable.'));
    expect(signIn).toHaveBeenCalledOnce();
    expect(current.configured).toBe(true); expect(current.frontendConfigurationError).toBeNull();
  });
  it('discards in-flight private responses after an Auth sign-out event', async () => {
    render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await authenticate();
    let finish!: (value: unknown) => void;
    vi.mocked(registryRequest).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = current.request({ action: 'documents' });
    const discarded = expect(pending).rejects.toThrow(/discarded/);
    await act(async () => { authListener('SIGNED_OUT', null); });
    expect(current.authenticated).toBe(false); expect(current.application).toBeNull();
    await act(async () => { finish([{ filename: 'old-private.pdf' }]); await discarded; });
    expect(current.authenticated).toBe(false);
  });
  it('restores pending records after a remount only through fresh wallet authentication, persisting no private fields', async () => {
    const view = render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await authenticate();
    expect(current.application?.status).toBe('pending');
    expect(window.localStorage.getItem(`receivledger:application-wallet:${alice}`)).toBe('true');
    const stored = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.getItem(window.localStorage.key(i)!)).join('');
    expect(stored).not.toMatch(/Fictional Alice|pending|test-user-session/);
    view.unmount();
    render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    expect(current.application).toBeNull(); expect(current.requiresRegistrationSession).toBe(true);
    await authenticate(); expect(current.application?.status).toBe('pending');
    expect(signIn).toHaveBeenCalledTimes(2);
  });
  it('does not carry an application restore marker into another wallet', async () => {
    const view = render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await authenticate();
    wallet = { ...wallet, account: bob }; view.rerender(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    expect(current.requiresRegistrationSession).toBe(false); expect(current.application).toBeNull();
  });
  it('signs an explicit message and loads only the verified matching wallet profile', async () => {
    render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await authenticate();
    expect(screen.getByText('Fictional Alice')).toBeTruthy();
    expect(wallet.signWalletMessage.mock.calls[0][0]).toContain('Chain ID: 11155111');
    expect(signIn).toHaveBeenCalledWith(expect.objectContaining({ chain: 'ethereum', message: expect.any(String), signature: expect.any(String) }));
  });
  it('rejects a server session for a different wallet', async () => {
    vi.mocked(registryRequest).mockResolvedValue(snapshot(bob));
    render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(current.error).toContain('another wallet'));
    expect(current.authenticated).toBe(false); expect(current.registeredName).toBeNull();
  });
  it('clears private names immediately when MetaMask changes wallets', async () => {
    const view = render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await authenticate();
    wallet = { ...wallet, account: bob };
    view.rerender(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    expect(current.registeredName).toBeNull(); expect(current.application).toBeNull();
    await expect(current.request({ action: 'documents' })).rejects.toThrow(/Sign in/);
    expect(signIn).toHaveBeenCalledOnce();
  });
  it('discards responses from requests started under the previous wallet', async () => {
    const view = render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await authenticate();
    let finish!: (value: unknown) => void;
    vi.mocked(registryRequest).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = current.request({ action: 'documents' });
    const checked = expect(pending).rejects.toThrow(/discarded/);
    wallet = { ...wallet, account: bob }; view.rerender(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await act(async () => { finish([{ filename: 'old-private.pdf' }]); await checked; });
    expect(current.authenticated).toBe(false);
  });
  it('does not adopt an old sign-in completed after a wallet switch', async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(registryRequest).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(signIn).toHaveBeenCalledOnce());
    wallet = { ...wallet, account: bob }; view.rerender(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await act(async () => { finish(snapshot()); });
    await waitFor(() => expect(current.busy).toBe(false));
    expect(current.authenticated).toBe(false); expect(current.registeredName).toBeNull();
  });
  it('keeps the blockchain app usable without Supabase configuration', () => {
    render(<RegistryProvider client={null}><Probe /></RegistryProvider>);
    expect(current.configured).toBe(false); expect(current.authenticated).toBe(false);
  });
  it.each(['returned', 'thrown'])('clears private data and reports %s sign-out failures on a wallet switch', async mode => {
    const view = render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await authenticate();
    if (mode === 'returned') signOut.mockResolvedValue({ error: new Error('offline') });
    else signOut.mockRejectedValue(new Error('offline'));
    wallet = { ...wallet, account: bob };
    view.rerender(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    expect(current.authenticated).toBe(false); expect(current.registeredName).toBeNull();
    await waitFor(() => expect(current.error).toContain('server sign-out failed'));
  });
  it('requires fresh sign-in after returning to the original wallet', async () => {
    const view = render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await authenticate();
    wallet = { ...wallet, account: bob };
    view.rerender(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    wallet = { ...wallet, account: alice };
    view.rerender(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    expect(current.authenticated).toBe(false);
    await expect(current.request({ action: 'documents' })).rejects.toThrow(/Sign in/);
  });
  it('does not start a new wallet sign-in when previous session cleanup fails', async () => {
    render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    signOut.mockResolvedValue({ error: new Error('offline') });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(current.error).toContain('server sign-out failed'));
    expect(signIn).not.toHaveBeenCalled(); expect(wallet.signWalletMessage).not.toHaveBeenCalled();
  });
  it('rejects privileged and invalid API keys without echoing them', () => {
    for (const key of ['sb_secret_dont_expose', 'eyJ.fake.service_role', 'invalid']) {
      const config = readSupabaseConfiguration('https://example.supabase.co', key);
      expect(config.client).toBeNull(); expect(config.configurationError).not.toContain(key);
    }
  });
});


describe('validated memory-session reuse', () => {
  const session = () => ({ access_token: 'memory-session', user: { id: 'user' }, expires_at: Math.floor(Date.now() / 1000) + 3600 });
  it('restores a valid memory session on remount through server bootstrap without another signature', async () => {
    getSession.mockResolvedValue({ data: { session: session() }, error: null });
    const view = render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await waitFor(() => expect(current.authenticated).toBe(true));
    view.unmount();
    render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await waitFor(() => expect(current.authenticated).toBe(true));
    expect(wallet.signWalletMessage).not.toHaveBeenCalled(); expect(signIn).not.toHaveBeenCalled();
    expect(registryRequest).toHaveBeenCalledWith(client, 'memory-session', { action: 'bootstrap' });
    expect(current.application?.status).toBe('pending');
  });
  it('reuses the active session for repeated private access and sign-in clicks', async () => {
    render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await authenticate();
    await act(async () => { await current.request({ action: 'documents' }); await current.signIn(); await current.reload(); });
    expect(wallet.signWalletMessage).toHaveBeenCalledOnce(); expect(signIn).toHaveBeenCalledOnce();
    expect(current.authenticated).toBe(true);
  });
  it('does not adopt a restored token for another wallet or another user ID', async () => {
    getSession.mockResolvedValue({ data: { session: { ...session(), user: { id: 'unrelated-user' } } }, error: null });
    render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await waitFor(() => expect(current.error).toContain('another wallet'));
    expect(current.authenticated).toBe(false); expect(current.application).toBeNull();
    expect(signOut).toHaveBeenCalled(); expect(wallet.signWalletMessage).not.toHaveBeenCalled();
  });
  it('does not restore a delayed old session after switching wallets', async () => {
    let finish!: (data: unknown) => void;
    getSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await waitFor(() => expect(getSession).toHaveBeenCalledOnce());
    wallet = { ...wallet, account: bob }; view.rerender(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await act(async () => { finish({ data: { session: session() }, error: null }); });
    await waitFor(() => expect(current.busy).toBe(false));
    expect(current.authenticated).toBe(false); expect(current.application).toBeNull();
    expect(signOut).toHaveBeenCalled(); expect(signIn).not.toHaveBeenCalled();
  });
  it('retries a transient backend failure using the valid SDK session without another signature', async () => {
    signIn.mockImplementation(async () => { getSession.mockResolvedValue({ data: { session: session() }, error: null }); return { data: { session: session() }, error: null }; });
    vi.mocked(registryRequest).mockRejectedValueOnce(new Error('Registration RPC is unavailable.'));
    render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(current.error).toContain('Registration service failed'));
    expect(current.authenticated).toBe(false); expect(current.application).toBeNull();
    await authenticate();
    expect(wallet.signWalletMessage).toHaveBeenCalledOnce(); expect(signIn).toHaveBeenCalledOnce();
  });
  it('clears private data and invalidates in-flight requests when a server rejects the session', async () => {
    render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await authenticate();
    vi.mocked(registryRequest).mockRejectedValueOnce(new RegistryRequestError('Your private session has expired or is invalid. Sign in again with this wallet.', 401));
    await act(async () => { await expect(current.request({ action: 'applications' })).rejects.toThrow('expired'); });
    expect(current.authenticated).toBe(false); expect(current.application).toBeNull(); expect(current.error).toContain('expired');
    await expect(current.request({ action: 'documents' })).rejects.toThrow('Sign in');
  });
});


describe('session restore cancellation', () => {
  it('discards a bootstrap that finishes after an external Auth sign-out during restoration', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'memory-session', user: { id: 'user' } } }, error: null });
    let finish!: (value: unknown) => void;
    vi.mocked(registryRequest).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await waitFor(() => expect(registryRequest).toHaveBeenCalledOnce());
    await act(async () => { authListener('SIGNED_OUT', null); });
    await act(async () => { finish(snapshot()); });
    expect(current.authenticated).toBe(false); expect(current.application).toBeNull(); expect(current.busy).toBe(false);
  });
});


describe('React StrictMode and token refresh', () => {
  it('restores a memory session once under the application StrictMode lifecycle', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'memory-session', user: { id: 'user' } } }, error: null });
    render(<StrictMode><RegistryProvider client={client}><Probe /></RegistryProvider></StrictMode>);
    await waitFor(() => expect(current.authenticated).toBe(true));
    expect(current.application?.status).toBe('pending');
    expect(signOut).not.toHaveBeenCalled(); expect(wallet.signWalletMessage).not.toHaveBeenCalled();
  });
  it('uses a refreshed same-user token without another wallet signature', async () => {
    render(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    await authenticate();
    await act(async () => { authListener('TOKEN_REFRESHED', { user: { id: 'user' }, access_token: 'refreshed-memory-session' } as Session); });
    await current.request({ action: 'documents' });
    expect(registryRequest).toHaveBeenLastCalledWith(client, 'refreshed-memory-session', { action: 'documents' });
    expect(wallet.signWalletMessage).toHaveBeenCalledOnce(); expect(signIn).toHaveBeenCalledOnce();
  });
});


describe('batched wallet identity changes', () => {
  it('invalidates private data and pending reads on a batched A/B/A epoch change', async () => {
    const view = render(<RegistryProvider client={client}><Probe /></RegistryProvider>); await authenticate();
    let finish!: (data: unknown) => void;
    vi.mocked(registryRequest).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = current.request({ action: 'documents' }); const discarded = expect(pending).rejects.toThrow('discarded');
    wallet = { ...wallet, walletEpoch: 2 }; view.rerender(<RegistryProvider client={client}><Probe /></RegistryProvider>);
    expect(current.application).toBeNull(); expect(current.authenticated).toBe(false);
    await act(async () => { finish([{ filename: 'old-wallet.pdf' }]); await discarded; });
    expect(current.authenticated).toBe(false);
  });
});

describe('refresh-safe private session validation',()=>{
  const stored=()=>({access_token:'stored-session',user:{id:'user'},expires_at:Math.floor(Date.now()/1000)+3600});
  it('waits for initial wallet discovery without signing out the saved session',async()=>{
    getSession.mockResolvedValue({data:{session:stored()},error:null});
    wallet={...wallet,account:null,networkOk:false,walletChecking:true};
    const view=render(<RegistryProvider client={client}><Probe/></RegistryProvider>);
    wallet={...wallet,walletChecking:false};
    view.rerender(<RegistryProvider client={client}><Probe/></RegistryProvider>);
    expect(getSession).not.toHaveBeenCalled();expect(signOut).not.toHaveBeenCalled();
    wallet={...wallet,account:alice,networkOk:true,walletChecking:true};
    view.rerender(<RegistryProvider client={client}><Probe/></RegistryProvider>);
    expect(signOut).not.toHaveBeenCalled();
    wallet={...wallet,walletChecking:false};
    view.rerender(<RegistryProvider client={client}><Probe/></RegistryProvider>);
    await waitFor(()=>expect(current.authenticated).toBe(true));
    expect(wallet.signWalletMessage).not.toHaveBeenCalled();expect(signIn).not.toHaveBeenCalled();expect(signOut).not.toHaveBeenCalled();
    expect(registryRequest).toHaveBeenCalledWith(client,'stored-session',{action:'bootstrap'});
  });
  it('does not trust a saved credential or its manager claims until the server validates the wallet',async()=>{
    getSession.mockResolvedValue({data:{session:{...stored(),user:{id:'user',user_metadata:{isManager:true}}}},error:null});
    vi.mocked(registryRequest).mockImplementation(async(_client,_token,input)=>(input as Record<string,unknown>).action==='bootstrap'?{...snapshot(),isManager:false}:[]);
    render(<RegistryProvider client={client}><Probe/></RegistryProvider>);
    expect(current.authenticated).toBe(false);expect(current.isManager).toBe(false);
    await waitFor(()=>expect(current.authenticated).toBe(true));expect(current.isManager).toBe(false);
    expect(wallet.signWalletMessage).not.toHaveBeenCalled();
  });
  it('clears a revoked stored session without silently requesting a new signature',async()=>{
    getSession.mockResolvedValue({data:{session:stored()},error:null});
    vi.mocked(registryRequest).mockRejectedValue(new RegistryRequestError('Session revoked',401));
    render(<RegistryProvider client={client}><Probe/></RegistryProvider>);
    await waitFor(()=>expect(current.error).toContain('revoked'));
    expect(current.authenticated).toBe(false);expect(current.application).toBeNull();expect(signOut).toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();expect(wallet.signWalletMessage).not.toHaveBeenCalled();
  });
  it('uses a token refresh synchronously for the next request without a new signature',async()=>{
    render(<RegistryProvider client={client}><Probe/></RegistryProvider>);await authenticate();
    await act(async()=>{
      authListener('TOKEN_REFRESHED',{user:{id:'user'},access_token:'immediate-refresh'} as Session);
      await current.request({action:'documents'});
    });
    expect(registryRequest).toHaveBeenLastCalledWith(client,'immediate-refresh',{action:'documents'});
    expect(signIn).toHaveBeenCalledOnce();
  });
  it('invalidates data when Auth changes to an unrelated user',async()=>{
    render(<RegistryProvider client={client}><Probe/></RegistryProvider>);await authenticate();
    await act(async()=>authListener('SIGNED_IN',{user:{id:'other-user'},access_token:'other-token'} as Session));
    expect(current.authenticated).toBe(false);expect(current.registeredName).toBeNull();
    await expect(current.request({action:'applications'})).rejects.toThrow('Sign in');
  });
});
