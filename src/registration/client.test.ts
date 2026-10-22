import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { readSupabaseConfiguration } from './client';

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
  it('accepts surrounding copy/paste whitespace while retaining memory-only authentication', () => {
    const result = readSupabaseConfiguration(` \n${url}\t`, `\t${key}\n `);
    expect(result.client).not.toBeNull(); expect(result.configurationError).toBeNull();
    expect(createClient).toHaveBeenCalledWith(url, key, { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false } });
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
