import { describe, expect, it } from 'vitest';
import { Interface, Wallet, verifyMessage } from 'ethers';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { createSignInMessage } from './auth';
import { REVIEW_ABI, validateApprovalEvidence, type ApprovalEvidence } from '../../supabase/functions/_shared/chain';
import { validatePdf } from '../../supabase/functions/_shared/pdf';
import { assertManager, invoiceId, registrationInput, CONTRACT_ADDRESS, assertReviewable } from '../../supabase/functions/_shared/domain';

const manager = '0x1111111111111111111111111111111111111111';
const applicant = '0x2222222222222222222222222222222222222222';
const iface = new Interface(REVIEW_ABI);
const approval = iface.encodeEventLog(iface.getEvent('InvestorApproved')!, [applicant]);
function evidence(): ApprovalEvidence { return { chainId: 11155111n, status: 1, confirmations: 2,
  to: CONTRACT_ADDRESS, from: manager, data: iface.encodeFunctionData('approveInvestor', [applicant]),
  logs: [{ address: CONTRACT_ADDRESS, ...approval }], approved: true }; }

describe('signed wallet authentication and input validation', () => {
  it('creates a domain-bound Sepolia sign-in message with verifiable signature', async () => {
    const wallet = Wallet.createRandom();
    const message = createSignInMessage(wallet.address, 'https://receiv-ledger.vercel.app/', new Date('2026-10-22T00:00:00Z'), 'a123456789');
    expect(verifyMessage(message, await wallet.signMessage(message))).toBe(wallet.address);
    expect(message).toContain('Chain ID: 11155111'); expect(message).toContain('URI: https://receiv-ledger.vercel.app/');
    expect(message).toContain('Expiration Time: 2026-10-22T00:05:00.000Z');
    expect(message).not.toContain('private key');
  });
  it('rejects insecure nonlocal origins and malformed invoice IDs', () => {
    expect(() => createSignInMessage(applicant, 'http://example.com')).toThrow();
    expect(() => invoiceId('1 OR 1=1')).toThrow(); expect(() => invoiceId('0')).toThrow(); expect(() => invoiceId((2n ** 256n).toString())).toThrow();
    expect(invoiceId('2')).toBe('2');
  });
  it('requires company registration for SMEs and valid private contact fields', () => {
    const form = { kind: 'sme', display_name: 'Demo SME', company_number: '', contact_email: 'demo@example.test', contact_phone: '' };
    expect(() => registrationInput(form)).toThrow(/registration number/);
    expect(registrationInput({ ...form, company_number: 'DEMO123', wallet: manager }).display_name).toBe('Demo SME');
    expect(() => registrationInput({ ...form, contact_email: 'bad' })).toThrow(/email/);
  });
  it('checks manager identity, pending state and review version', () => {
    expect(() => assertManager(applicant, manager)).toThrow(/manager/);
    expect(() => assertReviewable('approved', 1, 1)).toThrow(/pending/);
    expect(() => assertReviewable('pending', 2, 1)).toThrow(/changed/);
  });
});

describe('independent approval receipt validation', () => {
  it('accepts the exact successful manager approval and live mapping', () => { expect(() => validateApprovalEvidence(evidence(), applicant, manager)).not.toThrow(); });
  it.each<Partial<ApprovalEvidence>>([
    { chainId: 1n }, { status: 0 }, { confirmations: 1 }, { to: applicant }, { from: applicant },
    { data: '0x' }, { data: iface.encodeFunctionData('approveInvestor', [manager]) }, { logs: [] }, { approved: false },
  ])('rejects missing or mismatched receipt evidence %#', change => {
    expect(() => validateApprovalEvidence({ ...evidence(), ...change }, applicant, manager)).toThrow();
  });
});

describe('server PDF validation', () => {
  it('accepts a parsed fictional PDF and rejects disguised files', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage();
    await expect(validatePdf(await pdf.save())).resolves.toBeUndefined();
    await expect(validatePdf(new TextEncoder().encode('<html>not a PDF</html>'))).rejects.toThrow(/not a PDF/);
    await expect(validatePdf(new TextEncoder().encode('%PDF-truncated'))).rejects.toThrow(/readable/);
  });
  it('rejects PDF scripts even when PDF dictionaries use encoded names', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage();
    pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.obj({ S: PDFName.of('JavaScript'), JS: PDFString.of('app.alert("demo")') }));
    await expect(validatePdf(await pdf.save({ useObjectStreams: true }))).rejects.toThrow(/actions/);
  });
  it('enforces the server byte limit', async () => { await expect(validatePdf(new Uint8Array(5 * 1024 * 1024 + 1))).rejects.toThrow(/5 MB/); });
});
