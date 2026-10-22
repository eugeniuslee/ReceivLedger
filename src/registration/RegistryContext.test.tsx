// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistryProvider, useRegistry } from './RegistryContext';
import { registryRequest, readSupabaseConfiguration } from './client';

vi.mock('../chain/LedgerContext', () => ({ useLedger: () => wallet }));
vi.mock('./client', async original => {
  const actual = await original<typeof import('./client')>();
  return { ...actual, registryRequest: vi.fn() };
});
const alice = '0x2222222222222222222222222222222222222222';
const bob = '0x3333333333333333333333333333333333333333';
let wallet: { account: string | null; networkOk: boolean; signWalletMessage: ReturnType<typeof vi.fn> };
let client: SupabaseClient;
let signOut: ReturnType<typeof vi.fn>; let signIn: ReturnType<typeof vi.fn>;
let current: ReturnType<typeof useRegistry>;
function Probe() { current = useRegistry(); return <><span>{current.registeredName ?? 'No private name'}</span><button onClick={() => void current.signIn()}>Sign in</button></>; }
function snapshot(address = alice) { return { profile: { user_id: 'user', wallet: address }, isManager: false,
  application: { display_name: 'Fictional Alice', kind: 'investor', status: 'pending' } }; }
beforeEach(() => {
  wallet = { account: alice, networkOk: true, signWalletMessage: vi.fn().mockResolvedValue('0x' + 'a'.repeat(130)) };
  signOut = vi.fn().mockResolvedValue({ error: null });
  signIn = vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-user-session' } }, error: null });
  client = { auth: { signOut, signInWithWeb3: signIn, onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) } } as unknown as SupabaseClient;
  vi.mocked(registryRequest).mockReset().mockImplementation(async (_client, _token, input) => (input as Record<string, unknown>).action === 'bootstrap' ? snapshot() : []);
});
afterEach(cleanup);
async function authenticate() { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); await waitFor(() => expect(current.authenticated).toBe(true)); }

describe('private session and wallet isolation', () => {
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
  it('rejects privileged and invalid API keys without echoing them', () => {
    for (const key of ['sb_secret_dont_expose', 'eyJ.fake.service_role', 'invalid']) {
      const config = readSupabaseConfiguration('https://example.supabase.co', key);
      expect(config.client).toBeNull(); expect(config.configurationError).not.toContain(key);
    }
  });
});
