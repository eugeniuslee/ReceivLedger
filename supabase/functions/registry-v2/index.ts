import {createClient} from '@supabase/supabase-js';
import {createV2RegistryChain,createV2RegistryHandler} from '../_shared/v2registry.ts';
const required=(name:string)=>{const value=Deno.env.get(name);if(!value)throw new Error(`Missing server setting: ${name}`);return value;};
const url=required('SUPABASE_URL'),options={auth:{persistSession:false,autoRefreshToken:false}};
Deno.serve(createV2RegistryHandler({
  admin:createClient(url,required('SUPABASE_SERVICE_ROLE_KEY'),options),
  userClient:token=>createClient(url,required('SUPABASE_ANON_KEY'),{...options,global:{headers:{Authorization:`Bearer ${token}`}}}),
  chain:createV2RegistryChain(required('SEPOLIA_RPC_URL'),required('V2_CONTRACT_ADDRESS')),
  origins:required('V2_ALLOWED_ORIGINS').split(',').map(v=>v.trim()).filter(Boolean),identityKey:required('V2_IDENTITY_HMAC_KEY'),
}));
