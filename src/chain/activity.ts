import type { ChainEvent, WalletRole } from './chainLedger';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export interface ChainActivity {
  transactionHash: string;
  blockNumber: number;
  timestamp?: number;
  title: string;
  details: string;
  events: ChainEvent[];
}

function transferEndpoints(event: ChainEvent): { from: string; to: string } | null {
  if (event.name !== 'Transfer') return null;
  const match = event.detail.match(/^(0x[a-fA-F0-9]{40}) transferred \d+ RLU to (0x[a-fA-F0-9]{40})$/);
  return match ? { from: match[1], to: match[2] } : null;
}

export function groupEventsByTransaction(events: ChainEvent[], role: WalletRole, account?: string): ChainActivity[] {
  const transactions = new Map<string, ChainEvent[]>();
  for (const event of events) {
    const hash = event.transactionHash.toLowerCase();
    const grouped = transactions.get(hash) ?? [];
    grouped.push(event);
    transactions.set(hash, grouped);
  }

  const activities: ChainActivity[] = [];
  for (const [transactionHash, transactionEvents] of transactions) {
    const ordered = transactionEvents.slice().sort((left, right) => left.logIndex - right.logIndex);
    const issuance = ordered.find(event => event.name === 'FundUnitsIssued');
    const transfers = ordered.filter(event => event.name === 'Transfer');
    const mintTransfer = transfers.find(event => transferEndpoints(event)?.from.toLowerCase() === ZERO_ADDRESS);
    let title = '';
    let details = '';

    if (issuance) {
      const issuedAmount = issuance.amount ?? 0n;
      const investor = issuance.participants[0] ?? '';
      title = (role === 'investor' || role === 'inactiveInvestor') && account?.toLowerCase() === investor.toLowerCase()
        ? `Received ${issuedAmount.toLocaleString('en-SG')} RLU — Fund units issued`
        : `Fund units issued · ${issuedAmount.toLocaleString('en-SG')} RLU`;
      details = investor ? `Investor ${investor}` : issuance.detail;
      void mintTransfer;
    } else {
      const walletTransfer = transfers.map(event => ({ event, endpoints: transferEndpoints(event) }))
        .find(item => item.endpoints && item.endpoints.from.toLowerCase() !== ZERO_ADDRESS && item.endpoints.to.toLowerCase() !== ZERO_ADDRESS);
      if (walletTransfer?.endpoints) {
        const { from, to } = walletTransfer.endpoints;
        const amount = walletTransfer.event.amount ?? 0n;
        if ((role === 'investor' || role === 'inactiveInvestor') && account) {
          title = from.toLowerCase() === account.toLowerCase()
            ? `Sent ${amount.toLocaleString('en-SG')} RLU`
            : `Received ${amount.toLocaleString('en-SG')} RLU`;
        } else {
          title = `Wallet transfer · ${amount.toLocaleString('en-SG')} RLU`;
        }
        details = `${from} → ${to}`;
      } else if (transfers.length) {
        const transfer = transfers[0];
        title = `RLU token movement · ${(transfer.amount ?? 0n).toLocaleString('en-SG')} RLU`;
        details = transfer.detail;
      } else {
        const primary = ordered[0];
        title = primary.name === 'InvestorApproved' ? 'Investor approved'
          : primary.name === 'InvestorRevoked' ? 'Investor revoked'
            : primary.invoiceId !== undefined ? `Invoice #${primary.invoiceId.toString()} ${primary.name.replace(/^Invoice/, '').toLowerCase()}`
              : primary.name;
        details = ordered.map(event => event.detail).join(' · ');
      }
    }

    activities.push({
      transactionHash: ordered[0].transactionHash,
      blockNumber: ordered[0].blockNumber,
      timestamp: ordered.find(event => event.timestamp !== undefined)?.timestamp,
      title,
      details,
      events: ordered,
    });
  }
  return activities.sort((left, right) => right.blockNumber - left.blockNumber);
}