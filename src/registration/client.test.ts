import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { RegistryRequestError, registryRequest, readSupabaseConfiguration } from './client';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
const url = 'https://configuration-test.supabase.co';
const key = 'sb_publishable_configuration_fixture';
beforeEach(() => { vi.mocked(createClient).mockReset().mockReturnValue({} as ReturnType<typeof createClient>); });

describe('frontend configuration diagnostics and validation', () => {
  it.each([
    ['', '', ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']],
    [url, '', ['VITE_SUPABASE_PUBLISHABLE_KEY']],
    ['', key, ['VITE_SUPABASE_URL']],
  ] as const)('identifies missing build variables without creating a client', (projectUrl, publishableKey, missing) => {
    const result = readSupabaseConfiguration(projectUrl, publishableKey);
    expect(result.client).toBeNull();
    expect(result.configurationError).toContain('missing from this build');
    for (const name of missing) expect(result.configurationError).toContain(name);
    expect(result.configurationError).not.toContain(key);
    expect(createClient).not.toHaveBeenCalled();
  });
  it('accepts surrounding copy/paste whitespace with same-tab session persistence', () => {
    const result = readSupabaseConfiguration(` \n${url}\t`, `\t${key}\n `);
    expect(result.client).not.toBeNull(); expect(result.configurationError).toBeNull();
    expect(createClient).toHaveBeenCalledWith(url, key, expect.objectContaining({ auth: expect.objectContaining({ persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }) }));
  });
  it.each(['https://user:password@configuration-test.supabase.co', `${url}/rest/v1`, `${url}?query=1`, `${url}#fragment`, 'http://configuration-test.supabase.co', `"${url}"`])('rejects invalid project URL syntax without echoing it: %#', projectUrl => {
    const result = readSupabaseConfiguration(projectUrl, key);
    expect(result.client).toBeNull(); expect(result.configurationError).toContain('Invalid VITE_SUPABASE_URL');
    expect(result.configurationError).not.toContain(projectUrl);
    expect(createClient).not.toHaveBeenCalled();
  });
  it.each(['sb_secret_dont_expose', 'eyJ.fake.service_role', `"${key}"`, 'not-a-publishable-key'])('rejects privileged, legacy or quoted keys without echoing them: %#', publishableKey => {
    const result = readSupabaseConfiguration(url, publishableKey);
    expect(result.client).toBeNull(); expect(result.configurationError).toContain('Invalid VITE_SUPABASE_PUBLISHABLE_KEY');
    expect(result.configurationError).not.toContain(publishableKey);
    expect(createClient).not.toHaveBeenCalled();
  });
  it('distinguishes constructor failures and never returns the raw internal error', () => {
    vi.mocked(createClient).mockImplementation(() => { throw new Error('Internal key material must not appear'); });
    const result = readSupabaseConfiguration(url, key);
    expect(result.client).toBeNull(); expect(result.configurationError).toContain('could not initialize');
    expect(result.configurationError).not.toContain('Internal key material');
  });
});


describe('registration service diagnostics', () => {
  it.each([
    ['FunctionsFetchError', 'exact origin in ALLOWED_ORIGINS'],
    ['FunctionsRelayError', 'gateway could not reach'],
  ])('distinguishes %s from missing frontend configuration', async (name, expected) => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { name } });
    const client = { functions: { invoke } } as unknown as ReturnType<typeof createClient>;
    await expect(registryRequest(client, 'fixture-session', { action: 'bootstrap' })).rejects.toThrow(expected);
    expect(invoke).toHaveBeenCalledWith('registry', expect.objectContaining({ headers: { Authorization: 'Bearer fixture-session' } }));
  });
  it.each([
    ['Origin is not allowed.', 'origin is not authorised'],
    ['Sign in with your wallet first.', 'Sign in with your wallet first.'],
  ])('preserves a safe server diagnosis: %s', async (message, expected) => {
    const client = { functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: { name: 'FunctionsHttpError', context: new Response(JSON.stringify({ error: message }), { status: 403 }) } }) } } as unknown as ReturnType<typeof createClient>;
    await expect(registryRequest(client, 'fixture-session', {})).rejects.toThrow(expected);
  });
});


describe('private session expiry diagnostics', () => {
  it('marks HTTP 401 as session expiry so the provider can clear private state', async () => {
    const client = { functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: { name: 'FunctionsHttpError', context: new Response(JSON.stringify({ error: 'Sign in with your wallet first.' }), { status: 401 }) } }) } } as unknown as ReturnType<typeof createClient>;
    try { await registryRequest(client, 'fixture-session', { action: 'applications' }); throw new Error('Expected rejection'); }
    catch (error) { expect(error).toBeInstanceOf(RegistryRequestError); expect((error as RegistryRequestError).status).toBe(401); expect((error as Error).message).toContain('expired or is invalid'); }
  });
});
