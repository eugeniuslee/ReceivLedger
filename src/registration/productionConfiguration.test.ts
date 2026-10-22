import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

const url = 'https://production-config-fixture.supabase.co';
const key = 'sb_publishable_production_fixture';
afterEach(() => { vi.unstubAllEnvs(); });

async function productionProbe(projectUrl: string, publishableKey: string) {
  // A Vercel Preview still runs `vite build` in production mode. Use only
  // synthetic values and ignore all local .env files, writing no build files.
  vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('VITE_SUPABASE_URL', projectUrl); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', publishableKey);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url); vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', key);
  const result = await build({
    configFile: false, envDir: fileURLToPath(new URL('./fixtures/production-configuration', import.meta.url)), mode: 'production', logLevel: 'silent',
    build: { write: false, minify: false,
      lib: { entry: fileURLToPath(new URL('./client.ts', import.meta.url)), name: 'ConfigurationProbe', formats: ['iife'] },
      rollupOptions: { external: ['@supabase/supabase-js'], output: { globals: { '@supabase/supabase-js': 'supabase' } } },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!('output' in output)) throw new Error('Expected an in-memory production build.');
  const chunk = output.output.find(item => item.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Expected a JavaScript build chunk.');
  const createClient = vi.fn((project: string, publishable: string, options: unknown) => ({ project, publishable, options }));
  const context: { URL: typeof URL; supabase: { createClient: typeof createClient }; ConfigurationProbe?: { registryClient: unknown; registryConfigurationError: string | null } } = { URL, supabase: { createClient } };
  // The SDK is stubbed at the bundle boundary: no Auth, database or network calls.
  runInNewContext(chunk.code, context);
  if (!context.ConfigurationProbe) throw new Error('Expected configuration exports.');
  return { probe: context.ConfigurationProbe, createClient };
}

describe('Vite production replacement for a Vercel Preview build', () => {
  it('initializes the client from exactly the VITE variables at build time', async () => {
    const { probe, createClient } = await productionProbe(url, key);
    expect(probe.registryClient).not.toBeNull(); expect(probe.registryConfigurationError).toBeNull();
    expect(createClient).toHaveBeenCalledWith(url, key, { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false } });
  });
  it('does not substitute NEXT_PUBLIC variables or runtime environment for missing VITE build values', async () => {
    const { probe, createClient } = await productionProbe('', '');
    expect(probe.registryClient).toBeNull(); expect(createClient).not.toHaveBeenCalled();
    expect(probe.registryConfigurationError).toContain('VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY');
  });
  it('normalizes copied whitespace in values injected by a production build', async () => {
    const { probe, createClient } = await productionProbe(` ${url}\n`, `\t${key} `);
    expect(probe.registryConfigurationError).toBeNull();
    expect(createClient.mock.calls[0].slice(0, 2)).toEqual([url, key]);
  });
});
