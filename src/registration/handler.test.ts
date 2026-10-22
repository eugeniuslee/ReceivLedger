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
  chain = { manager: vi.fn().mockResolvedValue(manager), invoiceOwner: vi.fn().mockResolvedValue(alice), verifyApproval: vi.fn().mockResolvedValue(undefined) };
});
function handler() { return createRegistryHandler({ admin, userClient: () => user, chain, origins: ['https://receiveledger.test'] }); }
function request(body: unknown, token = 'session', origin = 'https://receiveledger.test') {
  return new Request('https://edge.test/registry', { method: 'POST', headers: { origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
describe('Edge Function authentication and authorization boundary', () => {
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
  it('does not expose internal RPC credentials in unexpected errors', async () => {
    vi.mocked(chain.manager).mockRejectedValue(new Error('Failed https://private-rpc.test/SECRET'));
    const response = await handler()(request({ action: 'bootstrap' }));
    expect(await response.text()).not.toContain('SECRET');
  });
});
