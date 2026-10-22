import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function readSupabaseConfiguration(url = '', key = '') {
  if (!url && !key) return { client: null, configurationError: null };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
    // Only the browser publishable key is accepted; never silently accept privileged keys.
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) throw new Error();
    return { client: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false } }), configurationError: null };
  } catch { return { client: null, configurationError: 'Set a valid Supabase HTTPS Project URL and publishable key in .env.local. Secret/service-role keys are not accepted.' }; }
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
