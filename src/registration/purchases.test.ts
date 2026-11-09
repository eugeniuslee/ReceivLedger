import type { SupabaseClient } from '@supabase/supabase-js';
import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRegistryHandler } from '../../supabase/functions/_shared/handler';
import { purchaseInput, PURCHASE_PROOF_BUCKET, type PurchaseRequest } from '../../supabase/functions/_shared/purchases';
import { PURCHASE_PRICING, PURCHASE_PRICING_BASIS } from '../../supabase/functions/_shared/purchasePricing';
import { CHAIN_ID, CONTRACT_ADDRESS, RequestError } from '../../supabase/functions/_shared/domain';
import type { RegistryChain } from '../../supabase/functions/_shared/chain';

const wallets = ['0x' + '11'.repeat(20), '0x' + '22'.repeat(20), '0x' + '33'.repeat(20)];
const users = [1, 2, 3].map(n => `10000000-0000-0000-0000-00000000000${n}`);
const id = '30000000-0000-0000-0000-000000000001';
const proofId = '40000000-0000-0000-0000-000000000001';
const hash = '0x' + 'a'.repeat(64);
const origin = 'http://localhost:5173';
let actor = 1;
let requests: Record<string, unknown>[];
let proofs: Record<string, unknown>[];
let applications: Record<string, unknown>[];
let admin: SupabaseClient, user: SupabaseClient, chain: RegistryChain;
let rpc: ReturnType<typeof vi.fn>, upload: ReturnType<typeof vi.fn>, download: ReturnType<typeof vi.fn>, remove: ReturnType<typeof vi.fn>, range: ReturnType<typeof vi.fn>;

function row(extra: Record<string, unknown> = {}) {
  return { id, owner_id: users[1], wallet: wallets[1], units: '100', amount_cents: '10000', note: 'BANK-1',
    chain_id: CHAIN_ID, contract_address: CONTRACT_ADDRESS, status: 'draft', version: 1,
    review_note: null, created_at: '2026-11-09T01:00:00Z', submitted_at: null, reviewed_at: null,
    issuance_tx_hash: null, ...extra };
}
function proof() { return { id: proofId, request_id: id, owner_id: users[1], filename: 'proof.pdf', storage_path: `${users[1]}/${proofId}.pdf`, byte_size: 500, sha256: 'a'.repeat(64) }; }
function query(source: Record<string, unknown>[]) {
  let rows = [...source];
  const builder = {
    select: () => builder, update: () => builder,
    eq: (key: string, value: unknown) => { rows = rows.filter(item => item[key] === value); return builder; },
    in: (key: string, values: unknown[]) => { rows = rows.filter(item => values.includes(item[key])); return builder; },
    order: () => builder,
    range: (from: number, to: number) => { range(from, to); rows = rows.slice(from, to + 1); return builder; },
    single: async () => rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'Not found' } },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (result: unknown) => void) => Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return builder;
}
beforeEach(() => {
  actor = 1; requests = []; proofs = []; applications = [];
  upload = vi.fn().mockResolvedValue({ data: {}, error: null });
  download = vi.fn().mockResolvedValue({ data: new Blob(['%PDF-proof'], { type: 'application/pdf' }), error: null });
  remove = vi.fn().mockResolvedValue({ data: [], error: null });
  range = vi.fn();
  rpc = vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'rl_purchase_pricing') return { data: PURCHASE_PRICING, error: null };
    if (name === 'rl_purchase_create_priced') requests.push(row({ id: args.p_id, owner_id: args.p_actor, wallet: args.p_wallet, units: args.p_units, amount_cents: (BigInt(String(args.p_units)) * 100n).toString(), note: args.p_note, pricing_basis: PURCHASE_PRICING_BASIS }));
    if (name === 'rl_purchase_attach_proof') {
      proofs.push({ id: args.p_proof_id, request_id: args.p_id, owner_id: args.p_actor, filename: args.p_filename, storage_path: args.p_path, byte_size: args.p_bytes, sha256: args.p_sha256 });
      requests[0].version = 2;
    }
    if (name === 'rl_purchase_submit') Object.assign(requests[0], { status: 'pending', version: 3, submitted_at: '2026-11-09T01:00:00Z' });
    if (name === 'rl_purchase_review') Object.assign(requests[0], { status: args.p_decision, version: 4, review_note: args.p_note });
    if (name === 'rl_purchase_fulfill') Object.assign(requests[0], { status: 'fulfilled', version: 5, issuance_tx_hash: args.p_tx });
    return { data: requests[0], error: null };
  });
  admin = { auth: { getUser: async () => ({ data: { user: { id: users[actor] } }, error: null }) }, rpc,
    from: (table: string) => query(table === 'rl_applications' ? applications : []),
    storage: { from: vi.fn(() => ({ upload, download, remove })) } } as unknown as SupabaseClient;
  user = { rpc: async (name: string) => ({ data: name === 'rl_current_wallet' ? wallets[actor] : { user_id: users[actor], wallet: wallets[actor] }, error: null }),
    from: (table: string) => query((table === 'rl_purchase_requests' ? requests : table === 'rl_purchase_proofs' ? proofs : []).filter(item => actor === 0 || item.owner_id === users[actor])) } as unknown as SupabaseClient;
  chain = { manager: vi.fn().mockResolvedValue(wallets[0]), invoiceOwner: vi.fn(), verifyApproval: vi.fn(),
    approvedInvestor: vi.fn().mockResolvedValue(true), verifyIssuance: vi.fn().mockResolvedValue(undefined) };
});
const handler = () => createRegistryHandler({ admin, userClient: () => user, chain, origins: [origin] });
function request(input: Record<string, unknown>, token = 'verified') {
  return new Request('https://edge.test/registry', { method: 'POST', headers: { origin, ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify(input) });
}
async function uploadRequest(bytes?: Uint8Array, version = '1') {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const form = new FormData(); form.set('action', 'purchase_upload'); form.set('request_id', id); form.set('version', version);
  form.set('file', new File([new Uint8Array(bytes ?? await pdf.save()).buffer], 'proof.pdf', { type: 'application/pdf' }));
  return new Request('https://edge.test/registry', { method: 'POST', headers: { origin, authorization: 'Bearer verified' }, body: form });
}

describe('private purchase request registry endpoints', () => {
  it('reports fixed pricing only when the database has the matching pricing migration', async () => {
    const response = await handler()(request({ action: 'purchase_pricing' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(PURCHASE_PRICING);
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Function not found' } });
    const missing = await handler()(request({ action: 'purchase_pricing' }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: expect.stringContaining('pricing needs a server update') });
    rpc.mockResolvedValueOnce({ data: { ...PURCHASE_PRICING, unit_price_cents: '1000' }, error: null });
    expect((await handler()(request({ action: 'purchase_pricing' }))).status).toBe(400);
    expect((await handler()(request({ action: 'purchase_pricing' }, ''))).status).toBe(401);
  });
  it('rejects a tampered client payment before creating any request', async () => {
    const response = await handler()(request({ action: 'purchase_create', id, units: '100', pricing_basis: PURCHASE_PRICING_BASIS, amount_cents: '1' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('S$1.00 per RLU') });
    expect(rpc).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });
  it('explains a missing priced-create database function without falling back to the old amount-based RPC', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Function not found' } });
    const response = await handler()(request({ action: 'purchase_create', id, units: '100', pricing_basis: PURCHASE_PRICING_BASIS }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('pricing needs a server update') });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['rl_purchase_create_priced']);
  });
  it('derives ownership, wallet, chain and contract from the server instead of submitted fields', async () => {
    const response = await handler()(request({ action: 'purchase_create', id, units: '100', pricing_basis: PURCHASE_PRICING_BASIS, note: ' BANK-1 ', wallet: wallets[2], owner_id: users[2], chain_id: 1, contract_address: wallets[2] }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('rl_purchase_create_priced', { p_id: id, p_actor: users[1], p_wallet: wallets[1], p_units: '100', p_note: 'BANK-1' });
    expect(await response.json()).toMatchObject({ wallet: wallets[1], chain_id: CHAIN_ID, contract_address: CONTRACT_ADDRESS, status: 'draft', proof_filename: null });
  });
  it('requires authenticated, currently approved investors and rejects incomplete private applications', async () => {
    const input = { action: 'purchase_create', id, units: '100', pricing_basis: PURCHASE_PRICING_BASIS };
    expect((await handler()(request(input, ''))).status).toBe(401);
    vi.mocked(chain.approvedInvestor!).mockResolvedValueOnce(false);
    expect((await handler()(request(input))).status).toBe(400);
    applications = [{ user_id: users[1], wallet: wallets[1], kind: 'investor', status: 'pending' }];
    expect((await handler()(request(input))).status).toBe(400);
    applications = []; chain.approvedInvestor = undefined;
    expect((await handler()(request(input))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('bounds pagination and uses scoped rows and stable page ranges', async () => {
    requests = Array.from({ length: 60 }, (_, i) => row({ id: `${i}` }));
    const response = await handler()(request({ action: 'purchase_list', offset: 50 }));
    expect(response.status).toBe(200); expect(await response.json()).toHaveLength(10); expect(range).toHaveBeenCalledWith(50, 99);
    expect((await handler()(request({ action: 'purchase_list', offset: -1 }))).status).toBe(400);
    expect((await handler()(request({ action: 'purchase_list', offset: '50' }))).status).toBe(400);
  });
  it('denies cross-wallet proof reads and forged manager review before privileged operations', async () => {
    requests = [row({ status: 'pending', version: 3 })]; proofs = [proof()]; actor = 2;
    expect((await handler()(request({ action: 'purchase_download', id }))).status).toBe(400);
    expect((await handler()(request({ action: 'purchase_review', id, version: 3, decision: 'approved', note: 'spoof', isManager: true, actor: users[0] }))).status).toBe(400);
    expect(download).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it('validates PDF contents before storing proof, and preserves the existing upload route', async () => {
    requests = [row()];
    expect((await handler()(await uploadRequest(new TextEncoder().encode('not a PDF')))).status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
    const response = await handler()(await uploadRequest());
    expect(response.status).toBe(200);
    expect(admin.storage.from).toHaveBeenCalledWith(PURCHASE_PROOF_BUCKET);
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${users[1]}/[a-f0-9-]+\\.pdf$`)), expect.any(Uint8Array), { contentType: 'application/pdf', upsert: false });
    expect(await response.json()).toMatchObject({ proof_filename: 'proof.pdf', proof_sha256: expect.stringMatching(/^[a-f0-9]{64}$/), version: 2 });
  });
  it('rejects manager/other-wallet uploads and stale proof versions before storage writes', async () => {
    requests = [row()]; actor = 0;
    expect((await handler()(await uploadRequest())).status).toBe(400);
    actor = 2; expect((await handler()(await uploadRequest())).status).toBe(400);
    actor = 1; expect((await handler()(await uploadRequest(undefined, '0'))).status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });
  it('cleans only its own upload after a definite concurrent SQL rejection', async () => {
    requests = [row()];
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'Request changed' } });
    expect((await handler()(await uploadRequest())).status).toBe(400);
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
  });
  it('does not delete potentially committed proof after an ambiguous network timeout', async () => {
    requests = [row()]; rpc.mockResolvedValueOnce({ data: null, error: { code: '', message: 'Network timeout' } });
    expect((await handler()(await uploadRequest())).status).toBe(400);
    expect(remove).not.toHaveBeenCalled();
  });
  it('downloads through the scoped metadata lookup with private attachment headers', async () => {
    requests = [row()]; proofs = [proof()];
    const response = await handler()(request({ action: 'purchase_download', id }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(download).toHaveBeenCalledWith(proof().storage_path);
  });
  it('rechecks current investor eligibility at submission and manager approval', async () => {
    requests = [row({ version: 2 })]; proofs = [proof()];
    vi.mocked(chain.approvedInvestor!).mockResolvedValue(false);
    expect((await handler()(request({ action: 'purchase_submit', id, version: 2 }))).status).toBe(400);
    Object.assign(requests[0], { status: 'pending', version: 3 }); actor = 0;
    expect((await handler()(request({ action: 'purchase_review', id, version: 3, decision: 'approved', note: 'Reviewed' }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    // A manager can reject a revoked investor's pending request to close it.
    expect((await handler()(request({ action: 'purchase_review', id, version: 3, decision: 'rejected', note: 'Investor no longer approved' }))).status).toBe(200);
  });
  it('requires proof, a review note and the exact current version without accepting self-review', async () => {
    requests = [row({ status: 'pending', version: 3 })]; actor = 0;
    const input = { action: 'purchase_review', id, version: 3, decision: 'approved', note: 'Reviewed' };
    expect((await handler()(request(input))).status).toBe(400);
    proofs = [proof()];
    expect((await handler()(request({ ...input, version: 2 }))).status).toBe(400);
    expect((await handler()(request({ ...input, note: ' ' }))).status).toBe(400);
    Object.assign(requests[0], { owner_id: users[0], wallet: wallets[0] });
    expect((await handler()(request(input))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('requires independent exact issuance verification before fulfillment, and safely retries an existing receipt', async () => {
    requests = [row({ status: 'approved', version: 4, submitted_at: '2026-11-09T01:02:03Z' })]; proofs = [proof()]; actor = 0;
    const input = { action: 'purchase_fulfill', id, version: 4, tx_hash: hash };
    vi.mocked(chain.verifyIssuance!).mockRejectedValueOnce(new RequestError('Wrong token issuance recipient'));
    expect((await handler()(request(input))).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
    expect((await handler()(request(input))).status).toBe(200);
    expect(chain.verifyIssuance).toHaveBeenCalledWith(hash, wallets[1], '100', wallets[0], '2026-11-09T01:02:03Z');
    expect(rpc).toHaveBeenCalledWith('rl_purchase_fulfill', { p_id: id, p_version: 4, p_actor: users[0], p_tx: hash });
    expect((await handler()(request(input))).status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect((await handler()(request({ ...input, tx_hash: '0x' + 'b'.repeat(64) }))).status).toBe(400);
  });
  it('fails closed on unsupported chain verification or mismatched request scope', async () => {
    requests = [row({ status: 'approved', version: 4, submitted_at: '2026-11-09T01:00:00Z' })]; proofs = [proof()]; actor = 0; chain.verifyIssuance = undefined;
    expect((await handler()(request({ action: 'purchase_fulfill', id, version: 4, tx_hash: hash }))).status).toBe(400);
    requests[0].contract_address = wallets[2];
    expect((await handler()(request({ action: 'purchase_download', id }))).status).toBe(400);
    expect(download).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it('preserves the original amount and proof for a legacy mismatch, but blocks further investor submission', async () => {
    requests = [row({ amount_cents: '100000', pricing_basis: 'legacy_reported' })];
    const list = await handler()(request({ action: 'purchase_list' }));
    expect(await list.json()).toMatchObject([{ units: '100', amount_cents: '100000', pricing_basis: 'legacy_reported' }]);
    expect((await handler()(await uploadRequest())).status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
    proofs = [proof()];
    expect((await handler()(request({ action: 'purchase_download', id }))).status).toBe(200);
    expect((await handler()(request({ action: 'purchase_submit', id, version: 1 }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(requests[0].amount_cents).toBe('100000');
  });
  it('blocks manager approval and issuance of a mismatched legacy purchase', async () => {
    actor = 0; proofs = [proof()];
    requests = [row({ status: 'pending', version: 3, amount_cents: '100000', pricing_basis: 'legacy_reported' })];
    expect((await handler()(request({ action: 'purchase_review', id, version: 3, decision: 'approved', note: 'Checked' }))).status).toBe(400);
    Object.assign(requests[0], { status: 'approved', version: 4, submitted_at: '2026-11-09T01:00:00Z' });
    expect((await handler()(request({ action: 'purchase_fulfill', id, version: 4, tx_hash: hash }))).status).toBe(400);
    expect(chain.verifyIssuance).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(['draft', 'pending', 'approved'])('lets the manager reject a mismatched legacy %s without changing its amount', async status => {
    actor = 0;
    requests = [row({ status, amount_cents: '100000', pricing_basis: 'legacy_reported' })];
    if (status !== 'draft') proofs = [proof()];
    const response = await handler()(request({ action: 'purchase_review', id, version: 1, decision: 'rejected', note: 'Wrong payment amount; arrange a new request.' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'rejected', amount_cents: '100000' });
    expect(chain.verifyIssuance).not.toHaveBeenCalled();
  });
  it('allows a matching legacy purchase to proceed and preserves already-fulfilled legacy receipts', async () => {
    actor = 0; proofs = [proof()];
    requests = [row({ status: 'pending', version: 3, pricing_basis: 'legacy_reported' })];
    expect((await handler()(request({ action: 'purchase_review', id, version: 3, decision: 'approved', note: 'Payment verified at S$1 per unit' }))).status).toBe(200);
    Object.assign(requests[0], { status: 'fulfilled', version: 5, amount_cents: '100000', issuance_tx_hash: hash });
    rpc.mockClear();
    const repeated = await handler()(request({ action: 'purchase_fulfill', id, version: 4, tx_hash: hash }));
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ amount_cents: '100000', issuance_tx_hash: hash, pricing_basis: 'legacy_reported' });
    expect(chain.verifyIssuance).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
});

describe('purchase integer and payload validation', () => {
  it.each([{ units: '1.5' }, { units: '0' }, { units: '100\n' }, { units: ' 100' }, { units: '01' }, { units: String(2n ** 256n) }, { units: 100 }, { amount_cents: '0' }, { amount_cents: '12.50' }, { note: 'a'.repeat(1001) }])('rejects invalid request fields %o', patch => {
    expect(() => purchaseInput({ id, units: '100', pricing_basis: PURCHASE_PRICING_BASIS, ...patch })).toThrow();
  });
  it('derives the required payment from whole RLU quantity without a submitted amount', () => {
    expect(purchaseInput({ id, units: '100', pricing_basis: PURCHASE_PRICING_BASIS })).toEqual({ id, units: '100', amount_cents: '10000', note: '' });
    expect(purchaseInput({ id, units: '1', pricing_basis: PURCHASE_PRICING_BASIS })).toMatchObject({ amount_cents: '100' });
    expect(purchaseInput({ id, units: PURCHASE_PRICING.max_units, pricing_basis: PURCHASE_PRICING_BASIS })).toMatchObject({ amount_cents: '999999999999900' });
  });
  it.each([{ amount_cents: '100' }, { amount_cents: '100000' }, { amount_cents: 10000 }, { pricing_basis: undefined }, { pricing_basis: 'another-rate' }, { units: '10000000000000' }])('rejects stale pricing or a forged total %o', patch => {
    expect(() => purchaseInput({ id, units: '100', pricing_basis: PURCHASE_PRICING_BASIS, ...patch })).toThrow();
  });
});
