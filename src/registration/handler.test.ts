import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createRegistryHandler } from '../../supabase/functions/_shared/handler';
import type { RegistryChain } from '../../supabase/functions/_shared/chain';
import { RequestError } from '../../supabase/functions/_shared/domain';

const manager = '0x1111111111111111111111111111111111111111';
const alice = '0x2222222222222222222222222222222222222222';
const appId = '10000000-0000-0000-0000-000000000001';
let actor: string; let verifiedWallet: string | null;
let admin: SupabaseClient; let user: SupabaseClient; let chain: RegistryChain;
let getUser: ReturnType<typeof vi.fn>; let review: ReturnType<typeof vi.fn>; let upload: ReturnType<typeof vi.fn>; let download: ReturnType<typeof vi.fn>;
let denyDocuments = false;
function query(data: unknown, error: { message: string } | null = null) {
  const builder = { select: () => builder, update: () => builder, eq: () => builder, order: () => builder, limit: () => builder,
    maybeSingle: async () => ({ data, error }), single: async () => ({ data, error }), then: (resolve: (result: unknown) => void) => Promise.resolve({ data, error }).then(resolve) };
  return builder;
}
const app = { id: appId, user_id: 'owner', wallet: alice, kind: 'investor', status: 'pending', version: 1 };
beforeEach(() => {
  actor = manager; verifiedWallet = actor; denyDocuments = false;
  getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'verified-manager-id' } }, error: null });
  review = vi.fn().mockResolvedValue({ data: { ...app, status: 'approved' }, error: null });
  upload = vi.fn(); download = vi.fn();
  admin = { auth: { getUser }, rpc: review, from: (table: string) => query(table === 'rl_applications' ? app : table === 'rl_documents' ? [{ id: 'kyc' }] : null),
    storage: { from: () => ({ upload, download }) } } as unknown as SupabaseClient;
  user = { rpc: async (name: string) => ({ data: name === 'rl_current_wallet' ? verifiedWallet : { user_id: 'verified-manager-id', wallet: actor }, error: null }),
    from: () => query(null, denyDocuments ? { message: 'Document access denied.' } : null) } as unknown as SupabaseClient;
  chain = { manager: vi.fn().mockResolvedValue(manager), invoiceOwner: vi.fn().mockResolvedValue(alice), verifyApproval: vi.fn().mockResolvedValue(undefined), investorStatus: vi.fn().mockResolvedValue({ approved: true, balance: 500n }) };
});
function handler() { return createRegistryHandler({ admin, userClient: () => user, chain, origins: ['https://receiveledger.test'] }); }
function request(body: unknown, token = 'session', origin = 'https://receiveledger.test') {
  return new Request('https://edge.test/registry', { method: 'POST', headers: { origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
describe('Edge Function authentication and authorization boundary', () => {
  it('lets only the manager record bad debt on an invoice that exists on-chain', async () => {
    const ok = await handler()(request({ action: 'set_invoice_credit', invoice_id: '6', stage: 'written_off', recovered_cents: '2500', note: ' Liquidated ', version: 1 }));
    expect(ok.status).toBe(200);
    expect(chain.invoiceOwner).toHaveBeenCalledWith('6');
    expect(review).toHaveBeenCalledWith('rl_set_invoice_credit', { p_actor: 'verified-manager-id', p_invoice: '6', p_stage: 'written_off', p_expected_bps: null, p_recovered: '2500', p_note: 'Liquidated', p_version: 1 });
    review.mockClear();
    expect((await handler()(request({ action: 'set_invoice_credit', invoice_id: '6', stage: 'impaired', expected_recovery_bps: 12_000, note: 'x' }))).status).toBe(400);
    expect((await handler()(request({ action: 'set_invoice_credit', invoice_id: '6', stage: 'impaired', expected_recovery_bps: 5_000, note: '' }))).status).toBe(400);
    actor = alice; verifiedWallet = alice;
    expect((await handler()(request({ action: 'set_invoice_credit', invoice_id: '6', stage: 'impaired', expected_recovery_bps: 5_000, note: 'x' }))).status).toBe(400);
    expect(review).not.toHaveBeenCalled();
  });
  it('lets only the manager reject an invoice or ask its SME for more information, off-chain', async () => {
    const ok = await handler()(request({ action: 'review_invoice', invoice_id: '8', decision: 'needs_info', note: ' Send the purchase order ', version: null }));
    expect(ok.status).toBe(200);
    expect(review).toHaveBeenCalledWith('rl_set_invoice_review', { p_actor: 'verified-manager-id', p_invoice: '8', p_sme: alice, p_status: 'needs_info', p_note: 'Send the purchase order', p_version: null });
    review.mockClear();
    expect((await handler()(request({ action: 'review_invoice', invoice_id: '8', decision: 'rejected', note: '' }))).status).toBe(400);
    expect((await handler()(request({ action: 'review_invoice', invoice_id: '8', decision: 'approved', note: 'x' }))).status).toBe(400);
    actor = alice; verifiedWallet = alice;
    expect((await handler()(request({ action: 'review_invoice', invoice_id: '8', decision: 'rejected', note: 'x' }))).status).toBe(400);
    expect(review).not.toHaveBeenCalled();
  });
  it('creates a fund request only for an on-chain approved investor, for themselves', async () => {
    actor = alice; verifiedWallet = alice;
    const response = await handler()(request({ action: 'request_fund', kind: 'subscription', amount: '250', user_id: 'someone-else' }));
    expect(response.status).toBe(200);
    expect(chain.investorStatus).toHaveBeenCalledWith(alice);
    expect(review).toHaveBeenCalledWith('rl_create_fund_request', { p_user: 'verified-manager-id', p_wallet: alice, p_kind: 'subscription', p_amount: '250' });
  });
  it('refuses fund requests from unapproved wallets and redemptions above the RLU balance', async () => {
    actor = alice; verifiedWallet = alice;
    vi.mocked(chain.investorStatus).mockResolvedValueOnce({ approved: false, balance: 0n });
    expect((await handler()(request({ action: 'request_fund', kind: 'subscription', amount: 10 }))).status).toBe(400);
    const tooMany = await handler()(request({ action: 'request_fund', kind: 'redemption', amount: '600' }));
    expect(tooMany.status).toBe(400);
    expect(JSON.stringify(await tooMany.json())).toContain('You hold 500 RLU');
    expect((await handler()(request({ action: 'request_fund', kind: 'subscription', amount: '1.5' }))).status).toBe(400);
    expect(review).not.toHaveBeenCalled();
  });
  it('does not let the manager request, nor investors decide, fund requests', async () => {
    expect((await handler()(request({ action: 'request_fund', kind: 'subscription', amount: '10' }))).status).toBe(400);
    actor = alice; verifiedWallet = alice;
    const decide = await handler()(request({ action: 'decide_fund_request', id: appId, version: 1, decision: 'approved' }));
    expect(decide.status).toBe(400);
    expect(review).not.toHaveBeenCalled();
  });
  it('lets the manager decide a fund request with its version', async () => {
    const response = await handler()(request({ action: 'decide_fund_request', id: appId, version: 2, decision: 'completed', note: ' Issued ', tx_hash: '0x' + 'ab'.repeat(32) }));
    expect(response.status).toBe(200);
    expect(review).toHaveBeenCalledWith('rl_decide_fund_request', { p_id: appId, p_version: 2, p_actor: 'verified-manager-id', p_decision: 'completed', p_note: 'Issued', p_tx: '0x' + 'ab'.repeat(32) });
  });
  it('renames only the signed-in caller’s application, never a supplied user', async () => {
    const response = await handler()(request({ action: 'rename', display_name: '  New Name Pte Ltd  ', user_id: 'someone-else' }));
    expect(response.status).toBe(200);
    expect(review).toHaveBeenCalledWith('rl_rename_application', { p_user: 'verified-manager-id', p_name: 'New Name Pte Ltd' });
  });
  it('rejects too-short registered names before the database', async () => {
    const response = await handler()(request({ action: 'rename', display_name: ' A ' }));
    expect(response.status).toBe(400);
    expect(review).not.toHaveBeenCalled();
  });
  it('reports a duplicate registered name clearly', async () => {
    review.mockResolvedValueOnce({ data: null, error: { message: 'duplicate key value violates unique constraint "rl_applications_display_name_unique"' } });
    const response = await handler()(request({ action: 'rename', display_name: 'Taken Name' }));
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('That name is already used');
  });
  it('records an additional-information request without blockchain approval verification', async () => {
    const response = await handler()(request({ action: 'review_application', id: appId, version: 1, decision: 'needs_info', note: 'Add fictional details' }));
    expect(response.status).toBe(200);
    expect(review).toHaveBeenCalledWith('rl_review_application', expect.objectContaining({ p_decision: 'needs_info', p_tx: null }));
    expect(chain.verifyApproval).not.toHaveBeenCalled();
  });
  it('denies nonmanager information requests and document decisions', async () => {
    actor = alice; verifiedWallet = alice;
    for (const action of ['review_application', 'review_document']) {
      expect((await handler()(request({ action, id: appId, version: 1, decision: 'needs_info', note: 'spoof' }))).status).toBe(400);
    }
    expect(review).not.toHaveBeenCalled();
  });
  it('rejects missing/invalid tokens and unapproved origins before private access', async () => {
    expect((await handler()(request({ action: 'applications' }, ''))).status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('bad token') });
    expect((await handler()(request({ action: 'applications' }))).status).toBe(401);
    expect((await handler()(request({}, 'session', 'https://untrusted.test'))).status).toBe(403);
  });
  it('requires a verified wallet, not just a Supabase user or supplied wallet', async () => {
    verifiedWallet = null;
    expect((await handler()(request({ action: 'bootstrap', wallet: manager }))).status).toBe(401);
  });
  it('denies nonmanager review even with forged actor fields', async () => {
    actor = alice; verifiedWallet = alice;
    const response = await handler()(request({ action: 'review_application', id: appId, version: 1, decision: 'approved', actor: manager }));
    expect(response.status).toBe(400); expect(review).not.toHaveBeenCalled();
  });
  it('does not record approval when independent blockchain verification fails', async () => {
    vi.mocked(chain.verifyApproval).mockRejectedValue(new RequestError('Investor has been revoked.'));
    const response = await handler()(request({ action: 'review_application', id: appId, version: 1, decision: 'approved', note: 'Demo review', tx_hash: '0x' + 'a'.repeat(64) }));
    expect(response.status).toBe(400); expect(review).not.toHaveBeenCalled();
  });
  it('records the verified actor rather than a supplied actor ID', async () => {
    const response = await handler()(request({ action: 'review_application', id: appId, version: 1, decision: 'approved', note: 'Demo review', actor_id: 'spoof', tx_hash: '0x' + 'a'.repeat(64) }));
    expect(response.status).toBe(200); expect(review).toHaveBeenCalledWith('rl_review_application', expect.objectContaining({ p_actor: 'verified-manager-id' }));
  });
  it('uses the RLS-scoped document lookup before any privileged download', async () => {
    denyDocuments = true;
    const response = await handler()(request({ action: 'download', id: appId }));
    expect(response.status).toBe(400); expect(download).not.toHaveBeenCalled();
  });
  it('rejects invoice uploads belonging to another wallet before storage writes', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage();
    const form = new FormData(); form.set('file', new File([await pdf.save()], 'fictional.pdf', { type: 'application/pdf' }));
    form.set('purpose', 'invoice'); form.set('invoice_id', '1'); form.set('demo_consent', 'true');
    const response = await handler()(new Request('https://edge.test/registry', { method: 'POST', headers: { origin: 'https://receiveledger.test', authorization: 'Bearer session' }, body: form }));
    expect(response.status).toBe(400); expect(upload).not.toHaveBeenCalled();
    expect((await response.json()).error).toContain('another wallet');
  });
  it('rejects repayment proofs for an invoice owned by another wallet before storage writes', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage();
    const form = new FormData(); form.set('file', new File([await pdf.save()], 'proof.pdf', { type: 'application/pdf' }));
    form.set('purpose', 'repayment'); form.set('invoice_id', '1'); form.set('demo_consent', 'true');
    const response = await handler()(new Request('https://edge.test/registry', { method: 'POST', headers: { origin: 'https://receiveledger.test', authorization: 'Bearer session' }, body: form }));
    expect(response.status).toBe(400); expect(upload).not.toHaveBeenCalled();
    expect((await response.json()).error).toContain('another wallet');
  });
  it('rejects subscription payment proofs for another investor’s request before storage writes', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage();
    const form = new FormData(); form.set('file', new File([await pdf.save()], 'pay.pdf', { type: 'application/pdf' }));
    form.set('purpose', 'subscription'); form.set('fund_request_id', appId); form.set('demo_consent', 'true');
    const response = await handler()(new Request('https://edge.test/registry', { method: 'POST', headers: { origin: 'https://receiveledger.test', authorization: 'Bearer session' }, body: form }));
    expect(response.status).toBe(400); expect(upload).not.toHaveBeenCalled();
    expect((await response.json()).error).toContain('another wallet');
  });
  it('does not expose internal RPC credentials in unexpected errors', async () => {
    vi.mocked(chain.manager).mockRejectedValue(new Error('Failed https://private-rpc.test/SECRET'));
    const response = await handler()(request({ action: 'bootstrap' }));
    expect(await response.text()).not.toContain('SECRET');
  });
});


describe('staff cannot acquire backend privileges through frontend claims', () => {
  it.each(['applications', 'review_application', 'review_document'])('rejects forged staff permissions for %s', async action => {
    actor = alice; verifiedWallet = alice;
    const response = await handler()(request({ action, id: appId, version: 1, decision: 'needs_info', note: 'spoof', role: 'manager', isManager: true, staff: true, permissions: ['review_applications', 'read_documents'], actor: manager }));
    expect(response.status).toBe(400);
    expect(review).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });
});
