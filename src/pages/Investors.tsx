import { useState } from 'react';
import { isAddress } from 'ethers';
import { useLedger } from '../chain/LedgerContext';
import { formatInteger } from '../chain/presentation';
import { InvestorAdmin } from './InvestorAdmin';

export function Investors({ investorTransferOnly = false }: { investorTransferOnly?: boolean }) {
  const { account, role, networkOk, transactionPending, ledger, runTransaction } = useLedger();
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [formError, setFormError] = useState('');

  async function transfer() {
    setFormError('');
    try {
      if (!account || !isAddress(transferTo.trim())) throw new Error('Enter a valid receiver address and connect the sender wallet.');
      if (!/^[1-9]\d*$/.test(transferAmount)) throw new Error('Enter a positive whole number of RLU.');
      if (!ledger) throw new Error('Sepolia connection is unavailable.');
      const [senderApproved, receiverApproved, senderBalance] = await Promise.all([
        ledger.isApproved(account), ledger.isApproved(transferTo.trim()), ledger.balanceOf(account),
      ]);
      const value = BigInt(transferAmount);
      if (!senderApproved) throw new Error('The connected wallet is not an approved investor.');
      if (!receiverApproved) throw new Error('The receiver is not an approved investor.');
      if (senderBalance < value) throw new Error('The connected wallet does not have enough RLU.');
      if (!window.confirm(`Transfer ${formatInteger(value)} RLU from ${account} to ${transferTo.trim()}?`)) {
        throw new Error('Transfer cancelled. No transaction was sent.');
      }
      await runTransaction('investor', activeLedger => activeLedger.transfer(transferTo.trim(), value));
      setTransferAmount('');
    } catch (cause) { setFormError((cause as Error).message); }
  }

  if (!networkOk) return <div className="empty-state">Switch to Sepolia to query investor balances and approval status.</div>;
  if (investorTransferOnly) {
    if (role !== 'investor') return <div className="notice error" role="alert">RLU transfer is available only to approved investors.</div>;
    return <TransferForm account={account} transferTo={transferTo} setTransferTo={setTransferTo} transferAmount={transferAmount} setTransferAmount={setTransferAmount} transactionPending={transactionPending} transfer={transfer} formError={formError} />;
  }
  if (role !== 'manager') return <div className="notice error" role="alert">Investor administration is available only to the fund manager.</div>;
  return <InvestorAdmin />;
}

function TransferForm({ account, transferTo, setTransferTo, transferAmount, setTransferAmount, transactionPending, transfer, formError }: {
  account: string | null;
  transferTo: string;
  setTransferTo: (value: string) => void;
  transferAmount: string;
  setTransferAmount: (value: string) => void;
  transactionPending: boolean;
  transfer: () => Promise<void>;
  formError: string;
}) {
  return <section className="section-block">
    <h3>Transfer RLU</h3>
    <p className="support-copy">RLU represents fund units and has 0 decimals. Transfers are sent from your connected wallet; both wallets must be approved investors. This does not transfer SGD or ETH.</p>
    <div className="form-row">
      <label>Sender<input value={account ?? 'Connect wallet'} readOnly /></label>
      <label>Receiver address<input value={transferTo} onChange={event => setTransferTo(event.target.value)} placeholder="0x…" /></label>
      <label>Amount (RLU)<input type="number" min="1" step="1" value={transferAmount} onChange={event => setTransferAmount(event.target.value)} /></label>
      <button className="btn" disabled={!account || transactionPending} onClick={() => void transfer()}>Transfer</button>
    </div>
    {formError && <p className="inline-error" role="alert">{formError}</p>}
  </section>;
}