export class RequestError extends Error {}
export const CONTRACT_ADDRESS = '0x18c6751a1a116053e413459464c9b1af356dbf1f';
export const CHAIN_ID = 11155111;
export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export const PRIVATE_BUCKET = 'receiveledger-documents';
export type ApplicationKind = 'investor' | 'sme';
export type ApplicationStatus = 'pending' | 'needs_info' | 'approved' | 'rejected' | 'suspended' | 'revoked';
export type ApplicationDecision = Exclude<ApplicationStatus, 'pending'>;
export interface RegistrationDetails {
  country: string; website: string; business_address: string; contact_name: string;
}
export type DocumentStatus = 'pending' | 'verified' | 'rejected';
export interface Application {
  id: string; user_id: string; wallet: string; kind: ApplicationKind; display_name: string;
  company_number: string; contact_email: string; contact_phone: string; status: ApplicationStatus;
  version: number; review_note: string | null; approval_tx_hash: string | null; reviewed_at: string | null;
  created_at: string; submitted_at?: string; details?: RegistrationDetails;
}
export interface PrivateDocument {
  id: string; owner_id: string; application_id: string | null; invoice_id: string | null; fund_request_id?: string | null;
  purpose: 'kyc' | 'invoice' | 'repayment' | 'subscription'; filename: string; storage_path: string; byte_size: number;
  sha256: string; status: DocumentStatus; version: number; review_note: string | null; created_at: string; reviewed_at?: string | null;
}
export interface WalletProfile { user_id: string; wallet: string }
export interface RegistrySnapshot { profile: WalletProfile; application: Application | null; isManager: boolean }
export interface RegistrationInput {
  kind: ApplicationKind; display_name: string; company_number: string; contact_email: string; contact_phone: string;
  details?: RegistrationDetails;
}
export function registrationInput(value: unknown): RegistrationInput {
  const v = value as Partial<RegistrationInput> | null;
  if (!v || !['investor', 'sme'].includes(v.kind ?? '')) throw new RequestError('Choose Investor or SME.');
  const text = (key: keyof RegistrationInput, max: number) => {
    const entry = v[key];
    if (typeof entry !== 'string' || entry.trim().length > max) throw new RequestError(`Invalid ${key}.`);
    return entry.trim();
  };
  const display_name = text('display_name', 100);
  const company_number = text('company_number', 60);
  const contact_email = text('contact_email', 254);
  const contact_phone = text('contact_phone', 40);
  if (display_name.length < 2) throw new RequestError('Enter a name with at least two characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) throw new RequestError('Enter a valid contact email.');
  if (v.kind === 'sme' && !company_number) throw new RequestError('Enter the company registration number.');
  if (contact_phone.length < 2) throw new RequestError('Enter a fictional contact number.');
  const detail = (key: keyof RegistrationDetails, max: number) => {
    const entry = v.details?.[key] ?? '';
    if (typeof entry !== 'string' || entry.trim().length > max) throw new RequestError(`Invalid ${key}.`);
    return entry.trim();
  };
  const details = { country: detail('country', 100), website: detail('website', 300), business_address: detail('business_address', 500), contact_name: detail('contact_name', 100) };
  if (v.kind === 'investor' && details.country.length < 2) throw new RequestError('Enter a fictional country of residence.');
  if (v.kind === 'sme' && (details.business_address.length < 2 || details.contact_name.length < 2)) throw new RequestError('Enter a fictional business address and contact person.');
  if (details.website) {
    try { const url = new URL(details.website); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); }
    catch { throw new RequestError('Use an HTTPS company website without credentials, or leave it blank.'); }
  }
  return { kind: v.kind as ApplicationKind, display_name, company_number, contact_email, contact_phone, details };
}
export function assertApplicationReview(status: ApplicationStatus, version: number, expected: number, decision: unknown) {
  if (!Number.isSafeInteger(expected) || version !== expected) throw new RequestError('This record changed. Refresh before reviewing.');
  const allowed: Partial<Record<ApplicationStatus, string[]>> = {
    pending: ['approved', 'rejected', 'needs_info'], needs_info: ['approved', 'rejected', 'needs_info'], approved: ['suspended', 'revoked'], suspended: ['needs_info', 'revoked'],
  };
  if (typeof decision !== 'string' || !allowed[status]?.includes(decision)) throw new RequestError('This application transition is not permitted.');
}
export function assertReviewable(status: string, version: number, expected: number) {
  if (status !== 'pending') throw new RequestError('Only pending records can be reviewed.');
  if (!Number.isSafeInteger(expected) || version !== expected) throw new RequestError('This record changed. Refresh before reviewing.');
}
export type CreditStage = 'impaired' | 'written_off';
/** Public credit record for a financed invoice whose SME cannot pay (no row = performing). */
export interface InvoiceCredit {
  invoice_id: string; stage: CreditStage; expected_recovery_bps: number | null;
  recovered_cents: number | string; effective_at: string; version: number; updated_at?: string;
}
export function creditInput(value: unknown) {
  const v = (value ?? {}) as Record<string, unknown>;
  if (!['performing', 'impaired', 'written_off'].includes(String(v.stage))) throw new RequestError('Choose performing, impaired or written off.');
  const note = typeof v.note === 'string' ? v.note.trim() : '';
  if (note.length < 1 || note.length > 1000) throw new RequestError('Give a reason (up to 1,000 characters).');
  const bps = v.stage === 'impaired' ? Number(v.expected_recovery_bps) : null;
  if (bps !== null && (!Number.isInteger(bps) || bps < 0 || bps > 10_000)) throw new RequestError('Enter an expected recovery between 0% and 100%.');
  const recovered = v.stage === 'written_off' ? String(v.recovered_cents ?? '') : null;
  if (recovered !== null && !/^\d{1,15}$/.test(recovered)) throw new RequestError('Enter the amount recovered (0 or more).');
  const version = v.version === null || v.version === undefined ? null : Number(v.version);
  if (version !== null && (!Number.isInteger(version) || version < 0)) throw new RequestError('Refresh the invoice and try again.');
  return { stage: String(v.stage), note, bps, recovered, version };
}
export type InvoiceReviewStatus = 'needs_info' | 'info_provided' | 'rejected';
/** Off-chain decision on an invoice: the contract cannot reject one or ask for documents (no row = none). */
export interface InvoiceReview {
  invoice_id: string; sme_wallet: string; status: InvoiceReviewStatus; note: string; version: number;
  decided_at: string; responded_at: string | null;
}
export function invoiceReviewInput(value: unknown) {
  const v = (value ?? {}) as Record<string, unknown>;
  if (!['needs_info', 'rejected', 'cleared'].includes(String(v.decision))) throw new RequestError('Choose reject or request more information.');
  const note = typeof v.note === 'string' ? v.note.trim() : '';
  if (v.decision !== 'cleared' && (note.length < 1 || note.length > 1000)) throw new RequestError('Tell the SME why (up to 1,000 characters).');
  const version = v.version === null || v.version === undefined ? null : Number(v.version);
  if (version !== null && (!Number.isInteger(version) || version < 0)) throw new RequestError('Refresh the invoice and try again.');
  return { decision: String(v.decision), note, version };
}
export type FundRequestKind = 'subscription' | 'redemption';
export type FundRequestStatus = 'pending' | 'approved' | 'completed' | 'rejected' | 'cancelled';
export interface FundRequest {
  id: string; user_id: string; wallet: string; kind: FundRequestKind;
  /** Whole S$ for subscriptions, whole RLU for redemptions. */
  amount: number | string; status: FundRequestStatus; manager_note: string | null; tx_hash: string | null;
  version: number; decided_at: string | null; created_at: string; updated_at: string;
}
export function fundRequestInput(value: unknown): { kind: FundRequestKind; amount: bigint } {
  const v = value as { kind?: unknown; amount?: unknown } | null;
  if (!v || (v.kind !== 'subscription' && v.kind !== 'redemption')) throw new RequestError('Choose a subscription or redemption.');
  const text = typeof v.amount === 'number' ? String(v.amount) : v.amount;
  if (typeof text !== 'string' || !/^[1-9]\d{0,9}$/.test(text)) throw new RequestError(v.kind === 'subscription' ? 'Enter a whole-dollar amount greater than zero.' : 'Enter a whole number of RLU greater than zero.');
  const amount = BigInt(text);
  if (amount > 1_000_000_000n) throw new RequestError('That amount is too large.');
  return { kind: v.kind, amount };
}
export function assertManager(wallet: string, manager: string) {
  if (wallet.toLowerCase() !== manager.toLowerCase()) throw new RequestError('Fund manager access required.');
}
export function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) throw new RequestError('Invalid record ID.');
  return value;
}
export function invoiceId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,76}$/.test(value) || BigInt(value) >= 2n ** 256n) throw new RequestError('Enter a valid on-chain invoice ID.');
  return value;
}

