import type { ChainEvent } from './chainLedger';

const CACHE_VERSION = 1;

export interface EventCacheEntry {
  scannedThrough: number;
  events: ChainEvent[];
}

interface SerializedEvent extends Omit<ChainEvent, 'amount' | 'invoiceId'> {
  amount?: string;
  invoiceId?: string;
}

interface SerializedEntry {
  version: number;
  scannedThrough: number;
  events: SerializedEvent[];
}

export function eventCacheKey(contractAddress: string, chainId: number): string {
  return `receivledger:events:v${CACHE_VERSION}:${chainId}:${contractAddress.toLowerCase()}`;
}

export function decodeEventCache(value: string | null): EventCacheEntry | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as SerializedEntry;
    if (parsed.version !== CACHE_VERSION || !Number.isSafeInteger(parsed.scannedThrough) || !Array.isArray(parsed.events)) return null;
    const events = parsed.events.filter(event =>
      typeof event.name === 'string' && typeof event.detail === 'string' &&
      typeof event.transactionHash === 'string' && Number.isSafeInteger(event.logIndex) &&
      Number.isSafeInteger(event.blockNumber) && Array.isArray(event.participants),
    ).map(event => ({
      ...event,
      amount: event.amount === undefined ? undefined : BigInt(event.amount),
      invoiceId: event.invoiceId === undefined ? undefined : BigInt(event.invoiceId),
    }));
    return { scannedThrough: parsed.scannedThrough, events };
  } catch {
    return null;
  }
}

export function encodeEventCache(entry: EventCacheEntry): string {
  const serialized: SerializedEntry = {
    version: CACHE_VERSION,
    scannedThrough: entry.scannedThrough,
    events: entry.events.map(event => ({
      ...event,
      amount: event.amount?.toString(),
      invoiceId: event.invoiceId?.toString(),
    })),
  };
  return JSON.stringify(serialized);
}

export function mergeChainEvents(existing: ChainEvent[], added: ChainEvent[], replaceFromBlock = Number.POSITIVE_INFINITY): ChainEvent[] {
  const events = new Map<string, ChainEvent>();
  for (const event of [...existing.filter(item => item.blockNumber < replaceFromBlock), ...added]) {
    events.set(`${event.transactionHash.toLowerCase()}:${event.logIndex}`, event);
  }
  return [...events.values()].sort((left, right) => right.blockNumber - left.blockNumber || right.logIndex - left.logIndex);
}

export function loadEventCache(storage: Pick<Storage, 'getItem'> | null, key: string): EventCacheEntry | null {
  try { return decodeEventCache(storage?.getItem(key) ?? null); }
  catch { return null; }
}

export function saveEventCache(storage: Pick<Storage, 'setItem'> | null, key: string, entry: EventCacheEntry): boolean {
  try {
    storage?.setItem(key, encodeEventCache(entry));
    return Boolean(storage);
  } catch {
    return false;
  }
}