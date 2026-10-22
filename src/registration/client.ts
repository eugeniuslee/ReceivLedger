import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function readSupabaseConfiguration(url = '', key = '') {
  // Vite substitutes these strings during the build, including Vercel Preview
  // builds. Normalize surrounding copy/paste whitespace, never key privileges.
  const projectUrl = url.trim();
  const publishableKey = key.trim();
  const missing = [!projectUrl && 'VITE_SUPABASE_URL', !publishableKey && 'VITE_SUPABASE_PUBLISHABLE_KEY'].filter(Boolean);
  if (missing.length) return { client: null, configurationError: `Frontend configuration missing from this build: ${missing.join(', ')}. Set these variables for this Vercel project's Preview environment and create a new build, or set them in .env.local for local development.` };
  try {
    const parsed = new URL(projectUrl);
    if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
  } catch { return { client: null, configurationError: 'Invalid VITE_SUPABASE_URL in this build. Use the HTTPS Project URL root, without wrapping quotes, credentials, API paths, query parameters or fragments.' }; }
  // Only the browser publishable key is accepted; never silently accept privileged keys.
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) return { client: null, configurationError: 'Invalid VITE_SUPABASE_PUBLISHABLE_KEY in this build. Use the raw sb_publishable_ key without wrapping quotes. Secret/service-role keys and legacy JWT keys are not accepted.' };
  try {
    return { client: createClient(projectUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false } }), configurationError: null };
  } catch { return { client: null, configurationError: 'Frontend configuration was present, but the Supabase client could not initialize. Check this deployment build and browser support. No authentication or database request has been verified.' }; }
}

const configuration = readSupabaseConfiguration(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
export const registryClient = configuration.client;
export const registryConfigurationError = configuration.configurationError;

export async function registryRequest<T>(client: SupabaseClient, token: string, input: Record<string, unknown> | FormData): Promise<T> {
  const { data, error } = await client.functions.invoke('registry', { body: input, headers: { Authorization: `Bearer ${token}` } });
  if (error) {
    let message = 'Registration service is unavailable. Check the Supabase setup and try again.';
    try { const response = error.context as Response; const payload = await response.json(); if (typeof payload.error === 'string') message = payload.error; } catch { /* preserve safe fallback */ }
    throw new Error(message);
  }
  if (data && typeof data === 'object' && 'error' in data) throw new Error(String(data.error));
  return data as T;
}
