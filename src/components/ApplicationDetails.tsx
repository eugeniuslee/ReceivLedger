import type { Application } from '../../supabase/functions/_shared/domain';
import { financialDate } from '../finance/presentation';

export function applicationDate(value?: string | null) {
  const ms = value ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? `${financialDate(BigInt(Math.floor(ms / 1000)))} SGT` : 'Not yet reviewed';
}
export function ApplicationDetails({ application: a, hideNote = false }: { application: Application; hideNote?: boolean }) {
  const rows = [
    ['Wallet', a.wallet], ['Application type', a.kind === 'sme' ? 'SME' : 'Investor'],
    [a.kind === 'sme' ? 'Registered company name' : 'Full name', a.display_name],
    [a.kind === 'sme' ? 'Business email' : 'Email address', a.contact_email], ['Contact number', a.contact_phone],
    ...(a.kind === 'sme' ? [['UEN / company registration number', a.company_number], ['Company website', a.details?.website],
      ['Registered business address', a.details?.business_address], ["Contact person's name", a.details?.contact_name]] : [['Country of residence', a.details?.country]]),
    ['Submitted', applicationDate(a.submitted_at ?? a.created_at)], ['Reviewed', applicationDate(a.reviewed_at)],
  ];
  return <dl className="detail-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not supplied (legacy record)'}</dd></div>)}
    {!hideNote && a.review_note && <div><dt>Manager note</dt><dd>{a.review_note}</dd></div>}
    {a.approval_tx_hash && <div><dt>Verified approval transaction</dt><dd className="mono">{a.approval_tx_hash}</dd></div>}
  </dl>;
}
