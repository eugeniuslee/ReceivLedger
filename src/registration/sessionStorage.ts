/** Tab-lifetime credentials only. Never store application data or authority here.
 * Supabase Auth and registry bootstrap validate every restored session. */
export function createTabSessionStorage(access: () => Storage = () => window.sessionStorage) {
  const memory = new Map<string,string>();
  return {
    getItem(key:string):string|null { try{return access().getItem(key);}catch{return memory.get(key)??null;} },
    setItem(key:string,value:string) { memory.set(key,value);try{access().setItem(key,value);}catch{/* Memory-only fallback when browser storage is blocked. */} },
    removeItem(key:string) { memory.delete(key);try{access().removeItem(key);}catch{/* Cleared in memory. */} },
  };
}
export const tabSessionStorage = createTabSessionStorage();

/** Browser-lifetime credentials: one sign-in is reused across tabs and restarts until sign-out
 * or a wallet change. Every restored session is still revalidated by Supabase Auth and the
 * registry against the connected wallet before any private data is shown. */
export function createBrowserSessionStorage(access: () => Storage = () => window.localStorage) {
  return createTabSessionStorage(access);
}
export const browserSessionStorage = createBrowserSessionStorage();
