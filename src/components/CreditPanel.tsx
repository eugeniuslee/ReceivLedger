import { useState } from 'react';
import type { ChainInvoice } from '../chain/chainLedger';
import { useRegistry } from '../registration/RegistryContext';
import { refreshCredits, useInvoiceCredits } from '../finance/credits';
import { invoiceIncome } from '../finance/financing';
import { useOptionalLedger } from '../chain/LedgerContext';
import { useFinance } from '../finance/FinanceContext';
import { money, moneyInput } from '../finance/models';
import { financialDate } from '../finance/presentation';
import { userFacingError } from '../errors';

type Stage = 'performing' | 'impaired' | 'written_off';
const STAGE_LABELS: Record<Stage, string> = { performing: 'Performing', impaired: 'Impaired', written_off: 'Written off' };

/** Short status badge for an invoice's bad-debt stage. */
export function CreditBadge({ invoiceId }: { invoiceId: bigint }) {
  const credit = useInvoiceCredits().get(invoiceId.toString());
  if (!credit) return null;
  return <span className="status rejected credit-badge">{credit.stage === 'impaired' ? 'Impaired' : 'Written off'}</span>;
}

/**
 * Fund manager: record bad debt on a financed invoice whose SME cannot pay.
 * Impaired = recovery uncertain (expected recovery %, interest stops); written off = final loss
 * (amount recovered so far). Applied to NAV everywhere; the contract still shows the invoice as Financed.
 */
export function CreditPanel({ invoice }: { invoice: ChainInvoice }) {
  const { request } = useRegistry();
  const ledger = useOptionalLedger();
  const { now } = useFinance();
  const credits = useInvoiceCredits();
  const credit = credits.get(invoice.id.toString()) ?? null;
  const events = ledger?.lifecycleEvents?.length ? ledger.lifecycleEvents : ledger?.events ?? [];
  const row = invoiceIncome([invoice], events, now, credits)[0];
  const owedCents = row ? row.advanceCents + row.profitCents : 0n;
  const holdbackCents = invoice.amount * 100n - (row?.advanceCents ?? 0n);
  const current: Stage = credit?.stage ?? 'performing';
  const [stage, setStage] = useState<Stage>(current === 'performing' ? 'impaired' : current);
  const [recovery, setRecovery] = useState(credit?.expectedRecoveryBps != null ? String(credit.expectedRecoveryBps / 100) : '50');
  const [recovered, setRecovered] = useState(credit?.stage === 'written_off' ? (Number(credit.recoveredCents) / 100).toFixed(2) : '0');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  let preview: { recoverable: bigint; loss: bigint } | null = null, inputError = '';
  try {
    if (stage === 'impaired') {
      const bps = Math.round(Number(recovery) * 100);
      if (!/^\d{1,3}(\.\d{1,2})?$/.test(recovery) || bps > 10_000) throw new Error('Enter an expected recovery between 0% and 100%.');
      const recoverable = owedCents * BigInt(bps) / 10_000n; preview = { recoverable, loss: owedCents - recoverable };
    } else if (stage === 'written_off') {
      const cents = moneyInput(recovered); preview = { recoverable: cents, loss: owedCents > cents ? owedCents - cents : 0n };
    }
  } catch (cause) { inputError = (cause as Error).message; }

  async function save() {
    setMessage(''); setError('');
    if (!note.trim()) { setError('Give a reason for this change.'); return; }
    if (inputError) { setError(inputError); return; }
    setBusy(true);
    try {
      await request({ action: 'set_invoice_credit', invoice_id: invoice.id.toString(), stage, note: note.trim(), version: credit?.version ?? 0,
        ...(stage === 'impaired' ? { expected_recovery_bps: Math.round(Number(recovery) * 100) } : {}),
        ...(stage === 'written_off' ? { recovered_cents: moneyInput(recovered).toString() } : {}) });
      await refreshCredits();
      setNote(''); setMessage(stage === 'performing' ? 'Invoice returned to performing.' : `Invoice marked ${STAGE_LABELS[stage].toLowerCase()}. NAV updated.`);
    } catch (cause) { setError(userFacingError(cause)); }
    finally { setBusy(false); }
  }

  return <section className="section-block credit-panel" aria-label="Credit status">
    <div className="section-heading"><h3>Credit status</h3><span className={`status ${credit ? 'rejected' : 'approved'}`}>{STAGE_LABELS[current]}</span></div>
    {credit && <p className="support-copy">{credit.stage === 'impaired' ? `Expected recovery ${(credit.expectedRecoveryBps ?? 0) / 100}%.` : `Recovered so far ${money(credit.recoveredCents)}.`} Since {financialDate(credit.effectiveAt)} SGT; interest stopped on that date.{row ? ` Loss recorded: ${money(row.lossCents)}.` : ''}</p>}
    <p className="support-copy">Use this if the SME cannot pay (e.g. insolvency). The contract still shows the invoice as Financed; the loss is applied to NAV across ReceivLedger. The {money(holdbackCents)} holdback was never paid out, so it is not lost.</p>
    <div className="segmented" role="group" aria-label="New credit status">{(['impaired', 'written_off', 'performing'] as Stage[]).filter(value => value !== current || value === 'written_off').map(value =>
      <button key={value} type="button" aria-pressed={stage === value} onClick={() => setStage(value)}>{value === 'written_off' && current === 'written_off' ? 'Update recovery' : value === 'performing' ? 'Back to performing' : value === 'impaired' ? 'Mark impaired' : 'Write off'}</button>)}</div>
    <div className="registration-form">
      {stage === 'impaired' && <label>Expected recovery (%)<input inputMode="decimal" value={recovery} onChange={event => setRecovery(event.target.value)} /></label>}
      {stage === 'written_off' && <label>Amount recovered so far (S$)<input inputMode="decimal" value={recovered} onChange={event => setRecovered(event.target.value)} /></label>}
      {preview && <dl className="detail-list">
        <div><dt>Owed by the SME</dt><dd>{money(owedCents)}</dd></div>
        <div><dt>{stage === 'impaired' ? 'Expected to recover' : 'Recovered'}</dt><dd>{money(preview.recoverable)}</dd></div>
        <div><dt><b>Loss to the fund</b></dt><dd><b>{money(preview.loss)}</b></dd></div>
      </dl>}
      <label>Reason<textarea value={note} maxLength={1000} onChange={event => setNote(event.target.value)} placeholder="e.g. SME entered liquidation on 10 Nov" /></label>
      <div><button className="btn" disabled={busy || Boolean(inputError) || !note.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Save credit status'}</button></div>
    </div>
    {message && <p className="notice info" role="status">{message}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>;
}
