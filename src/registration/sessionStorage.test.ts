// @vitest-environment jsdom
import {beforeEach,describe,expect,it} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import {createTabSessionStorage} from './sessionStorage';
import {resetBrowserStorage} from '../test/browserStorage';
beforeEach(resetBrowserStorage);
describe('same-tab credential storage',()=>{
  it('restores credentials through a new storage adapter after refresh, without storing private records in localStorage',()=>{
    createTabSessionStorage().setItem('session','test-credentials');
    expect(createTabSessionStorage().getItem('session')).toBe('test-credentials');
    expect(window.localStorage.length).toBe(0);
    createTabSessionStorage().removeItem('session');
    expect(createTabSessionStorage().getItem('session')).toBeNull();
  });
  it('falls back to memory when storage is blocked and does not survive a new instance',()=>{
    const blocked=()=>{throw new Error('Storage disabled');};
    const storage=createTabSessionStorage(blocked);
    storage.setItem('session','test-credentials');expect(storage.getItem('session')).toBe('test-credentials');
    expect(createTabSessionStorage(blocked).getItem('session')).toBeNull();
    storage.removeItem('session');expect(storage.getItem('session')).toBeNull();
  });
  it('restores a saved session through the real Supabase SDK without a network request or new signature',async()=>{
    const values=new Map<string,string>();
    const storage=createTabSessionStorage(()=>({getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}} as Storage));
    const expires=Math.floor(Date.now()/1000)+3600;
    const access='eyJhbGciOiJIUzI1NiJ9.'+btoa(JSON.stringify({sub:'10000000-0000-0000-0000-000000000001',exp:expires}))+'.test-signature';
    storage.setItem('reload-test',JSON.stringify({access_token:access,refresh_token:'test-refresh-token',expires_at:expires,expires_in:3600,token_type:'bearer',user:{id:'10000000-0000-0000-0000-000000000001',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-23T00:00:00Z'}}));
    const client=createClient('https://reload-fixture.supabase.co','sb_publishable_fixture',{auth:{storageKey:'reload-test',storage,persistSession:true,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async()=>{throw new Error('No network expected for an unexpired stored SDK session');}}});
    const {data,error}=await client.auth.getSession();
    expect(error).toBeNull();expect(data.session?.access_token).toBe(access);
    // This is credential recovery only; RegistryProvider must still bootstrap on the server.
    await client.auth.stopAutoRefresh();
  });
});
