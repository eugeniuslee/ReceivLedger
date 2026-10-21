/** Vitest 2 predates Node 25's global Web Storage. Keep browser tests isolated
 * from that process-wide storage and from one another. */
export function resetBrowserStorage() {
  for (const name of ['localStorage', 'sessionStorage']) {
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => { values.set(String(key), String(value)); },
      removeItem: key => { values.delete(key); },
      key: index => [...values.keys()][index] ?? null,
    };
    Object.defineProperty(window, name, { configurable: true, value: storage });
  }
}
