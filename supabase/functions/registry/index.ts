import { createClient } from '@supabase/supabase-js';
import { createRegistryHandler } from '../_shared/handler.ts';
import { createRegistryChain } from '../_shared/chain.ts';

function required(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}
const url = required('SUPABASE_URL');
const anonKey = required('SUPABASE_ANON_KEY');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const handler = createRegistryHandler({
  admin: createClient(url, required('SUPABASE_SERVICE_ROLE_KEY'), options),
  userClient: token => createClient(url, anonKey, { ...options, global: { headers: { Authorization: `Bearer ${token}` } } }),
  chain: createRegistryChain(required('SEPOLIA_RPC_URL')),
  origins: required('ALLOWED_ORIGINS').split(',').map(value => value.trim()).filter(Boolean),
});
Deno.serve(handler);
