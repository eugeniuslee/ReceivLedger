export function financialDate(timestamp: bigint) {
  if (timestamp <= 0n || timestamp > 8640000000000n) return 'Outside supported date range';
  return new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' }).format(Number(timestamp) * 1000);
}
