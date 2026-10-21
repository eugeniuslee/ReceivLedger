import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BrowserProvider, type Eip1193Provider } from 'ethers';
import { RECEIVLEDGER_ADDRESS, SEPOLIA_CHAIN_ID } from './abi';
import { ChainLedger, CONTRACT_DEPLOYMENT_BLOCK, filterInvestorEvents, filterInvoiceEvents, transactionRoleAllowed, walletRoleChanged, type ChainEvent, type RoleSnapshot, type WalletRole } from './chainLedger';
import { eventCacheKey, loadEventCache, mergeChainEvents, saveEventCache, type EventCacheEntry } from './eventCache';
import { didWalletAddressChange, isCurrentWalletRequest } from './requestGuard';

type InjectedWallet = Eip1193Provider & {
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
};

interface LedgerContextValue {
  account: string | null;
  role: WalletRole | null;
  isManager: boolean;
  isInvestor: boolean;
  isSme: boolean;
  networkOk: boolean;
  walletAvailable: boolean;
  walletChecking: boolean;
  snapshot: RoleSnapshot | null;
  events: ChainEvent[];
  eventIndexComplete: boolean;
  loading: boolean;
  eventsLoading: boolean;
  transactionPending: boolean;
  error: string | null;
  eventsError: string | null;
  connect: () => Promise<void>;
  refresh: (force?: boolean) => Promise<void>;
  refreshEvents: (force?: boolean) => Promise<void>;
  ledger: ChainLedger | null;
  runTransaction: <T,>(requiredRole: WalletRole, operation: (ledger: ChainLedger) => Promise<T>) => Promise<T>;
}

const LedgerContext = createContext<LedgerContextValue | null>(null);
const EVENT_REORG_OVERLAP = 12;

function errorMessage(error: unknown): string {
  const candidate = error as { shortMessage?: string; reason?: string; message?: string; code?: number | string };
  if (candidate?.code === 4001 || candidate?.code === 'ACTION_REJECTED') return 'Transaction or wallet request was rejected in MetaMask.';
  return candidate?.shortMessage ?? candidate?.reason ?? candidate?.message ?? 'The wallet or Sepolia RPC request failed.';
}

function clearRoleData(
  setRole: (role: WalletRole | null) => void,
  setSnapshot: (snapshot: RoleSnapshot | null) => void,
  setEvents: (events: ChainEvent[]) => void,
) {
  setRole(null);
  setSnapshot(null);
  setEvents([]);
}

function scopeEvents(events: ChainEvent[], role: WalletRole, account: string, snapshot: RoleSnapshot | null): ChainEvent[] {
  if (role === 'manager') return events;
  if (role === 'investor' || role === 'inactiveInvestor' || role === 'provisional') return filterInvestorEvents(events, account);
  const ownedInvoices = snapshot?.role === 'sme' ? snapshot.invoices : [];
  return filterInvoiceEvents(events, ownedInvoices.map(invoice => invoice.id));
}

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [injected, setInjected] = useState<InjectedWallet | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [role, setRole] = useState<WalletRole | null>(null);
  const [networkOk, setNetworkOk] = useState(false);
  const [snapshot, setSnapshot] = useState<RoleSnapshot | null>(null);
  const [events, setEvents] = useState<ChainEvent[]>([]);
  const [eventIndexComplete, setEventIndexComplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [transactionPending, setTransactionPending] = useState(false);
  const [walletChecking, setWalletChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [walletRevision, setWalletRevision] = useState(0);
  const walletVersion = useRef(0);
  const syncSequence = useRef(0);
  const essentialSequence = useRef(0);
  const historySequence = useRef(0);
  const accountRef = useRef<string | null>(null);
  const networkOkRef = useRef(false);
  const roleRef = useRef<WalletRole | null>(null);
  const snapshotRef = useRef<RoleSnapshot | null>(null);
  const eventCacheRef = useRef<{ key: string; entry: EventCacheEntry } | null>(null);
  const essentialFlightRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const eventFlightRef = useRef<{ key: string; promise: Promise<void> } | null>(null);

  const provider = useMemo(() => injected ? new BrowserProvider(injected) : null, [injected]);
  const ledger = useMemo(() => provider ? new ChainLedger(RECEIVLEDGER_ADDRESS, provider) : null, [provider]);

  useEffect(() => {
    const legacyProvider = (window as Window & { ethereum?: InjectedWallet }).ethereum;
    if (legacyProvider) {
      setWalletChecking(true);
      setInjected(legacyProvider);
    }
    const onWalletAnnounced = (event: Event) => {
      const detail = (event as CustomEvent<{ info?: { rdns?: string }; provider?: InjectedWallet }>).detail;
      if (detail?.info?.rdns === 'io.metamask' && detail.provider) {
        setWalletChecking(true);
        setInjected(current => current ?? detail.provider ?? null);
      }
    };
    window.addEventListener('eip6963:announceProvider', onWalletAnnounced);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    if (!legacyProvider) setWalletChecking(false);
    return () => window.removeEventListener('eip6963:announceProvider', onWalletAnnounced);
  }, []);

  const synchronizeWallet = useCallback(async (requestPermission: boolean) => {
    if (!injected || !provider) {
      setWalletChecking(Boolean(injected));
      return;
    }
    const sequence = ++syncSequence.current;
    const walletGeneration = walletVersion.current;
    setWalletChecking(true);
    setError(null);
    try {
      if (requestPermission) await provider.send('eth_requestAccounts', []);
      const [accounts, chainId] = await Promise.all([
        provider.send('eth_accounts', []) as Promise<string[]>,
        provider.send('eth_chainId', []) as Promise<string>,
      ]);
      if (sequence !== syncSequence.current || walletGeneration !== walletVersion.current) return;
      const nextAccount = accounts[0] ?? null;
      const nextNetworkOk = Number(BigInt(chainId)) === SEPOLIA_CHAIN_ID;
      const accountChanged = didWalletAddressChange(accountRef.current, nextAccount);
      const networkChanged = networkOkRef.current !== nextNetworkOk;
      if (accountChanged || networkChanged) {
        walletVersion.current += 1;
        essentialSequence.current += 1;
        historySequence.current += 1;
        roleRef.current = null;
        snapshotRef.current = null;
        eventCacheRef.current = null;
        essentialFlightRef.current = null;
        eventFlightRef.current = null;
        clearRoleData(setRole, setSnapshot, setEvents);
        setEventsLoading(false);
        setLoading(Boolean(nextAccount && nextNetworkOk));
      }
      accountRef.current = nextAccount;
      networkOkRef.current = nextNetworkOk;
      setAccount(nextAccount);
      setNetworkOk(nextNetworkOk);
      setWalletChecking(false);
      if (!nextAccount || !nextNetworkOk) setLoading(false);
      setEventsError(null);
    } catch (cause) {
      if (sequence === syncSequence.current && walletGeneration === walletVersion.current) {
        setWalletChecking(false);
        setLoading(false);
        setError(errorMessage(cause));
      }
    }
  }, [injected, provider]);

  useEffect(() => { void synchronizeWallet(false); }, [synchronizeWallet]);

  useEffect(() => {
    if (!injected) return;
    const invalidateRequests = () => {
      syncSequence.current += 1;
      walletVersion.current += 1;
      essentialSequence.current += 1;
      historySequence.current += 1;
      essentialFlightRef.current = null;
      eventFlightRef.current = null;
    };
    const clearForWalletChange = () => {
      invalidateRequests();
      roleRef.current = null;
      snapshotRef.current = null;
      eventCacheRef.current = null;
      clearRoleData(setRole, setSnapshot, setEvents);
      setLoading(true);
      setEventsLoading(false);
      setError(null);
      setEventsError(null);
    };
    const onAccountsChanged = (value: unknown) => {
      const nextAccount = Array.isArray(value) && value[0] ? String(value[0]) : null;
      const accountChanged = didWalletAddressChange(accountRef.current, nextAccount);
      if (accountChanged) clearForWalletChange();
      else {
        invalidateRequests();
        setError(null);
        setEventsError(null);
        setLoading(Boolean(nextAccount && networkOkRef.current));
      }
      setWalletChecking(Boolean(nextAccount && networkOkRef.current));
      accountRef.current = nextAccount;
      setAccount(nextAccount);
      setWalletRevision(revision => revision + 1);
      if (!networkOkRef.current) void synchronizeWallet(false);
    };
    const onChainChanged = () => {
      clearForWalletChange();
      networkOkRef.current = false;
      setNetworkOk(false);
      setWalletChecking(true);
      void synchronizeWallet(false);
    };
    const onDisconnect = () => {
      clearForWalletChange();
      accountRef.current = null;
      networkOkRef.current = false;
      setAccount(null);
      setNetworkOk(false);
      setWalletChecking(false);
      setLoading(false);
      setError('Wallet disconnected. Reconnect MetaMask to continue.');
    };
    injected.on('accountsChanged', onAccountsChanged);
    injected.on('chainChanged', onChainChanged);
    injected.on('disconnect', onDisconnect);
    return () => {
      injected.removeListener('accountsChanged', onAccountsChanged);
      injected.removeListener('chainChanged', onChainChanged);
      injected.removeListener('disconnect', onDisconnect);
    };
  }, [injected, synchronizeWallet]);

  const refreshEvents = useCallback((force = false): Promise<void> => {
    const activeRole = role ?? roleRef.current;
    if (!provider || !ledger || !networkOk || !account || !activeRole) return Promise.resolve();
    const key = `${SEPOLIA_CHAIN_ID}:${RECEIVLEDGER_ADDRESS.toLowerCase()}:${account.toLowerCase()}:${activeRole}:${walletVersion.current}`;
    if (!force && eventFlightRef.current?.key === key) return eventFlightRef.current.promise;
    const walletRequest = walletVersion.current;
    const request = ++historySequence.current;
    const isCurrent = () => request === historySequence.current && isCurrentWalletRequest(walletRequest, walletVersion.current, account, accountRef.current);
    const promise = (async () => {
      setEventsLoading(true);
      setEventIndexComplete(false);
      setEventsError(null);
      try {
        const cacheKey = eventCacheKey(RECEIVLEDGER_ADDRESS, SEPOLIA_CHAIN_ID);
        const cached = eventCacheRef.current?.key === cacheKey
          ? eventCacheRef.current.entry
          : loadEventCache(window.localStorage, cacheKey);
        const latest = await provider.getBlockNumber();
        const fromBlock = cached
          ? Math.max(CONTRACT_DEPLOYMENT_BLOCK, cached.scannedThrough - EVENT_REORG_OVERLAP + 1)
          : CONTRACT_DEPLOYMENT_BLOCK;
        const added = fromBlock <= latest ? await ledger.readEvents(provider, fromBlock, latest) : [];
        const entry: EventCacheEntry = {
          scannedThrough: Math.max(cached?.scannedThrough ?? CONTRACT_DEPLOYMENT_BLOCK - 1, latest),
          events: mergeChainEvents(cached?.events ?? [], added, fromBlock),
        };
        if (!isCurrent()) return;
        eventCacheRef.current = { key: cacheKey, entry };
        saveEventCache(window.localStorage, cacheKey, entry);
        setEvents(scopeEvents(entry.events, activeRole, account, snapshotRef.current));
        setEventIndexComplete(true);
        setEventsError(null);
      } catch (cause) {
        if (isCurrent()) {
          setEventIndexComplete(false);
          setEventsError(errorMessage(cause));
        }
      } finally {
        if (isCurrent()) setEventsLoading(false);
      }
    })();
    eventFlightRef.current = { key, promise };
    void promise.finally(() => {
      if (eventFlightRef.current?.promise === promise) eventFlightRef.current = null;
    });
    return promise;
  }, [provider, ledger, networkOk, account, role, snapshot]);

  const refresh = useCallback((force = false): Promise<void> => {
    if (!provider || !ledger || !networkOk || !account) return Promise.resolve();
    const key = `${SEPOLIA_CHAIN_ID}:${account.toLowerCase()}:${walletVersion.current}`;
    if (!force && essentialFlightRef.current?.key === key) return essentialFlightRef.current.promise;
    const walletRequest = walletVersion.current;
    const request = ++essentialSequence.current;
    const isCurrent = () => request === essentialSequence.current && isCurrentWalletRequest(walletRequest, walletVersion.current, account, accountRef.current);
    const promise = (async () => {
      setLoading(true);
      setError(null);
      try {
        const cacheKey = eventCacheKey(RECEIVLEDGER_ADDRESS, SEPOLIA_CHAIN_ID);
        const cache = eventCacheRef.current?.key === cacheKey
          ? eventCacheRef.current.entry
          : loadEventCache(window.localStorage, cacheKey);
        const nextSnapshot = await ledger.readWalletSnapshot(account, cache?.events ?? []);
        if (!isCurrent()) return;
        const nextRole = nextSnapshot.role;
        if (roleRef.current && roleRef.current !== nextRole) {
          historySequence.current += 1;
          eventFlightRef.current = null;
          setEventsLoading(false);
          snapshotRef.current = null;
          setSnapshot(null);
          setEvents([]);
        }
        roleRef.current = nextRole;
        setRole(nextRole);
        snapshotRef.current = nextSnapshot;
        setSnapshot(nextSnapshot);
        if (cache) {
          eventCacheRef.current = { key: cacheKey, entry: cache };
          setEvents(scopeEvents(cache.events, nextRole, account, nextSnapshot));
        }
      } catch (cause) {
        if (isCurrent()) setError(errorMessage(cause));
      } finally {
        if (isCurrent()) {
          setLoading(false);
          setWalletChecking(false);
        }
      }
    })();
    essentialFlightRef.current = { key, promise };
    void promise.finally(() => {
      if (essentialFlightRef.current?.promise === promise) essentialFlightRef.current = null;
    });
    return promise;
  }, [provider, ledger, networkOk, account]);

  useEffect(() => {
    if (networkOk && account) void refresh();
  }, [networkOk, account, walletRevision, refresh]);

  useEffect(() => {
    if (networkOk && account && role && snapshot) void refreshEvents();
  }, [networkOk, account, role, snapshot, refreshEvents]);

  useEffect(() => {
    if (networkOk && account && role === 'provisional' && eventIndexComplete && !eventsError) void refresh(true);
  }, [networkOk, account, role, eventIndexComplete, eventsError, refresh]);

  useEffect(() => {
    const roleCheckLedger = ledger;
    if (!roleCheckLedger || !account || !networkOk) return;
    let checking = false;
    const timer = window.setInterval(() => {
      if (checking || !roleRef.current) return;
      checking = true;
      void roleCheckLedger.classifyWallet(account, eventCacheRef.current?.entry.events ?? []).then(classification => {
        if (walletRoleChanged(roleRef.current, classification.role)) {
          roleRef.current = null;
          historySequence.current += 1;
          snapshotRef.current = null;
          eventCacheRef.current = null;
          eventFlightRef.current = null;
          setEventsLoading(false);
          clearRoleData(setRole, setSnapshot, setEvents);
          void refresh(true);
        }
      }).catch(cause => setError(errorMessage(cause))).finally(() => { checking = false; });
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [ledger, account, networkOk, refresh]);

  const connect = useCallback(async () => {
    await synchronizeWallet(true);
    await refresh();
  }, [synchronizeWallet, refresh]);
  const runTransaction = useCallback(async <T,>(requiredRole: WalletRole, operation: (activeLedger: ChainLedger) => Promise<T>): Promise<T> => {
    if (!injected) throw new Error('MetaMask was not detected. Install or enable MetaMask to continue.');
    if (!networkOk) throw new Error('Switch MetaMask to Sepolia before sending a transaction.');
    if (!account) throw new Error('Connect an account in MetaMask before sending a transaction.');
    if (role !== requiredRole) throw new Error(`This transaction requires the ${requiredRole} wallet role.`);
    setTransactionPending(true);
    setError(null);
    try {
      const [activeAccounts, activeChainId] = await Promise.all([
        provider!.send('eth_accounts', []) as Promise<string[]>,
        provider!.send('eth_chainId', []) as Promise<string>,
      ]);
      if (Number(BigInt(activeChainId)) !== SEPOLIA_CHAIN_ID) throw new Error('Switch MetaMask to Sepolia before sending a transaction.');
      if (!activeAccounts.some(activeAccount => activeAccount.toLowerCase() === account.toLowerCase())) throw new Error('The connected MetaMask account changed. Refresh wallet access before continuing.');
      const signer = await provider!.getSigner(account);
      const signerLedger = new ChainLedger(RECEIVLEDGER_ADDRESS, signer);
      const activeRole = await signerLedger.classifyWallet(account);
      const hasStoredSmeInvoice = role === 'sme' && snapshot?.role === 'sme' &&
        accountRef.current?.toLowerCase() === account.toLowerCase() && snapshot.invoices.length > 0;
      if (!transactionRoleAllowed(requiredRole, activeRole.role, hasStoredSmeInvoice)) throw new Error(`This transaction requires the ${requiredRole} wallet role.`);
      const receipt = await operation(signerLedger);
      await refresh(true);
      void refreshEvents(true);
      return receipt;
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      throw new Error(message);
    } finally {
      setTransactionPending(false);
    }
  }, [injected, networkOk, account, role, snapshot, provider, refresh, refreshEvents]);

  const value: LedgerContextValue = {
    account,
    role,
    isManager: role === 'manager',
    isInvestor: role === 'investor',
    isSme: role === 'sme',
    networkOk,
    walletAvailable: Boolean(injected),
    walletChecking,
    snapshot,
    events,
    eventIndexComplete,
    loading,
    eventsLoading,
    transactionPending,
    error,
    eventsError,
    connect,
    refresh,
    refreshEvents,
    ledger,
    runTransaction,
  };

  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger(): LedgerContextValue {
  const value = useContext(LedgerContext);
  if (!value) throw new Error('useLedger must be used inside LedgerProvider.');
  return value;
}