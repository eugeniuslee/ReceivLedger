export function formatMoney(amount: bigint, suffix = ''): string {
  return `S$${new Intl.NumberFormat('en-SG', { maximumFractionDigits: 0 }).format(amount)}${suffix}`;
}

export function formatInteger(amount: bigint): string {
  return new Intl.NumberFormat('en-SG', { maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(timestamp: bigint): string {
  if (timestamp === 0n) return '—';
  return new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium' }).format(Number(timestamp) * 1000);
}

export function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return '—';
  return new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp * 1000);
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}