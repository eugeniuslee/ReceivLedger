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
  id: string; owner_id: string; application_id: string | null; invoice_id: string | null;
  purpose: 'kyc' | 'invoice'; filename: string; storage_path: string; byte_size: number;
  sha256: string; status: DocumentStatus; version: number; review_note: string | null; created_at: string;
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
    pending: ['approved', 'rejected', 'needs_info'], approved: ['suspended', 'revoked'], suspended: ['needs_info', 'revoked'],
  };
  if (typeof decision !== 'string' || !allowed[status]?.includes(decision)) throw new RequestError('This application transition is not permitted.');
}
export function assertReviewable(status: string, version: number, expected: number) {
  if (status !== 'pending') throw new RequestError('Only pending records can be reviewed.');
  if (!Number.isSafeInteger(expected) || version !== expected) throw new RequestError('This record changed. Refresh before reviewing.');
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

