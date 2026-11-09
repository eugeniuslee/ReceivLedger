import type { SupabaseClient } from '@supabase/supabase-js';
import type { RegistryChain } from './chain.ts';
import { assertManager, CHAIN_ID, CONTRACT_ADDRESS, RequestError, requireUuid } from './domain.ts';
import { validatePdf } from './pdf.ts';
import { isPurchasePricing, PURCHASE_PRICING_BASIS, purchaseAmountCents, purchaseHasPriceMismatch, type PurchasePricingBasis } from './purchasePricing.ts';

export const PURCHASE_PROOF_BUCKET = 'receivledger-payment-proofs';
export type PurchaseStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'fulfilled';
export interface PurchaseRequest {
  id: string; owner_id: string; wallet: string; units: string; amount_cents: string;
  pricing_basis?: PurchasePricingBasis;
  chain_id: number; contract_address: string; status: PurchaseStatus; version: number;
  note: string; review_note: string | null; created_at: string; submitted_at: string | null;
  reviewed_at: string | null; issuance_tx_hash: string | null;
  proof_filename: string | null; proof_sha256: string | null; proof_bytes: number | null;
}
interface PurchaseProof {
  id: string; request_id: string; owner_id: string; filename: string; storage_path: string;
  sha256: string; byte_size: number;
}
type PurchaseRow = Omit<PurchaseRequest, 'proof_filename' | 'proof_sha256' | 'proof_bytes'>;
interface PurchaseContext {
  admin: SupabaseClient; user: SupabaseClient; chain: RegistryChain;
  ownerId: string; wallet: string; manager: string; headers: Record<string, string>;
}
function checked<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new RequestError(result.error.message);
  return result.data;
}
export function purchaseInput(input: Record<string, unknown>) {
  const id = requireUuid(input.id);
  if (input.pricing_basis !== PURCHASE_PRICING_BASIS) throw new RequestError('Purchase pricing has changed. Refresh the website before creating a request.');
  if (typeof input.units !== 'string') throw new RequestError('Enter a positive whole-number RLU amount.');
  let cents: string;
  try { cents = purchaseAmountCents(input.units); }
  catch (cause) { throw new RequestError((cause as Error).message); }
  // Older or modified clients may still send an amount. Never use it to price a request.
  if (input.amount_cents !== undefined && input.amount_cents !== cents) throw new RequestError('The required payment is calculated at S$1.00 per RLU. Refresh the website and try again.');
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.trim().length > 1000)) {
    throw new RequestError('The payment reference or note must be at most 1,000 characters.');
  }
  return { id, units: input.units, amount_cents: cents, note: typeof input.note === 'string' ? input.note.trim() : '' };
}
const pricingUpdateMessage = 'Purchase pricing needs a server update. Apply the pricing database update and deploy the updated registry function, then refresh requests.';
function pricingResult<T>(result: { data: T; error: { message: string; code?: string } | null }): T {
  if (result.error && ['PGRST202', '42883'].includes(result.error.code ?? '')) throw new RequestError(pricingUpdateMessage);
  return checked(result);
}
function requireMatchingPayment(row: PurchaseRow) {
  if (!purchaseHasPriceMismatch(row)) return;
  if (row.status === 'approved') throw new RequestError('This earlier approval has a payment mismatch. Check transaction history and preserve any existing issuance receipt. Reconcile the payment and any issued tokens before closing or replacing this request; do not issue tokens again.');
  throw new RequestError('This request’s original payment does not match S$1.00 per RLU. The fund manager must review the original payment before rejecting the request and arranging a replacement.');
}
function version(input: unknown): number {
  if (!Number.isSafeInteger(input) || Number(input) < 1) throw new RequestError('Refresh this request before continuing.');
  return Number(input);
}
function matchesVersion(row: PurchaseRow, input: unknown) {
  if (row.version !== version(input)) throw new RequestError('This request changed. Refresh before continuing.');
}
function ownRequest(row: PurchaseRow, context: PurchaseContext) {
  if (row.owner_id !== context.ownerId || row.wallet !== context.wallet.toLowerCase()) throw new RequestError('This purchase request belongs to another wallet.');
}
function checkedScope(row: PurchaseRow) {
  if (row.chain_id !== CHAIN_ID || row.contract_address !== CONTRACT_ADDRESS) throw new RequestError('This purchase request belongs to another fund.');
}
function present(row: PurchaseRow, proof: PurchaseProof | null): PurchaseRequest {
  return { ...row, proof_filename: proof?.filename ?? null, proof_sha256: proof?.sha256 ?? null, proof_bytes: proof?.byte_size ?? null };
}
async function read(context: PurchaseContext, id: string) {
  const result = await context.user.from('rl_purchase_requests').select('*').eq('id', id).single();
  if (result.error || !result.data) throw new RequestError('Purchase request not found or access denied.');
  const row = result.data as PurchaseRow;
  checkedScope(row);
  const proof = checked(await context.user.from('rl_purchase_proofs').select('*').eq('request_id', id).maybeSingle()) as PurchaseProof | null;
  return { row, proof };
}
async function eligible(context: PurchaseContext, ownerId: string, wallet: string) {
  if (wallet.toLowerCase() === context.manager.toLowerCase()) throw new RequestError('The fund manager cannot submit or review their own purchase.');
  if (!context.chain.approvedInvestor || !await context.chain.approvedInvestor(wallet)) throw new RequestError('This wallet must be an approved investor before continuing.');
  const application = checked(await context.admin.from('rl_applications').select('kind,status,wallet').eq('user_id', ownerId).maybeSingle());
  if (application && (application.kind !== 'investor' || application.status !== 'approved' || application.wallet !== wallet.toLowerCase())) {
    throw new RequestError('Your investor application must be approved before continuing.');
  }
}

/** Called only after the registry has independently verified the wallet session. */
export async function handlePurchaseRequest(context: PurchaseContext, input: Record<string, unknown>, form: FormData | null): Promise<Response> {
  const { admin, user, chain, ownerId, wallet, manager, headers } = context;
  const json = (value: unknown) => Response.json(value, { headers });
  if (input.action === 'purchase_pricing') {
    const pricing = pricingResult(await admin.rpc('rl_purchase_pricing'));
    if (!isPurchasePricing(pricing)) throw new RequestError(pricingUpdateMessage);
    return json(pricing);
  }
  if (input.action === 'purchase_list') {
    const offset = input.offset ?? 0;
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new RequestError('Invalid purchase page.');
    const rows = checked(await user.from('rl_purchase_requests').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 49)) as PurchaseRow[];
    if (!rows.length) return json([]);
    rows.forEach(checkedScope);
    const proofs = checked(await user.from('rl_purchase_proofs').select('*').in('request_id', rows.map(row => row.id))) as PurchaseProof[];
    return json(rows.map(row => present(row, proofs.find(proof => proof.request_id === row.id) ?? null)));
  }
  if (input.action === 'purchase_create') {
    const value = purchaseInput(input);
    await eligible(context, ownerId, wallet);
    pricingResult(await admin.rpc('rl_purchase_create_priced', { p_id: value.id, p_actor: ownerId, p_wallet: wallet.toLowerCase(),
      p_units: value.units, p_note: value.note }));
    const { row, proof } = await read(context, value.id);
    return json(present(row, proof));
  }
  if (input.action === 'purchase_upload' && form) {
    const id = requireUuid(form.get('request_id'));
    const { row } = await read(context, id);
    ownRequest(row, context);
    const expected = version(Number(form.get('version')));
    matchesVersion(row, expected);
    if (row.status !== 'draft') throw new RequestError('Proof can only be attached to a draft request.');
    requireMatchingPayment(row);
    await eligible(context, ownerId, wallet);
    const file = form.get('file');
    if (!(file instanceof File)) throw new RequestError('Choose a payment proof PDF.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    await validatePdf(bytes);
    const proofId = crypto.randomUUID();
    const path = `${ownerId}/${proofId}.pdf`;
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('');
    const filename = file.name.replace(/[^\w.\- ]/g, '_').slice(0, 160) || 'payment-proof.pdf';
    checked(await admin.storage.from(PURCHASE_PROOF_BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false }));
    const attached = await admin.rpc('rl_purchase_attach_proof', { p_id: id, p_version: expected, p_actor: ownerId,
      p_wallet: wallet.toLowerCase(), p_proof_id: proofId, p_filename: filename, p_path: path, p_bytes: bytes.length, p_sha256: sha256 });
    if (attached.error) {
      // Clean up only a definite SQL rejection. A network timeout can occur after
      // commit; deleting then could remove the request's successfully saved proof.
      // Unreferenced objects remain private and can be reconciled by the owner.
      if (attached.error.code === 'P0001' || attached.error.code?.startsWith('23')) {
        await admin.storage.from(PURCHASE_PROOF_BUCKET).remove([path]);
      }
      throw new RequestError('Proof was not attached. Refresh this request before retrying.');
    }
    const current = await read(context, id);
    return json(present(current.row, current.proof));
  }
  if (input.action === 'purchase_download') {
    const { proof } = await read(context, requireUuid(input.id));
    if (!proof) throw new RequestError('This request has no payment proof.');
    const blob = checked(await admin.storage.from(PURCHASE_PROOF_BUCKET).download(proof.storage_path));
    return new Response(blob, { headers: { ...headers, 'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="payment-proof-${proof.id}.pdf"`, 'Content-Security-Policy': "sandbox; default-src 'none'" } });
  }
  if (input.action === 'purchase_submit') {
    const id = requireUuid(input.id);
    const { row } = await read(context, id);
    ownRequest(row, context);
    matchesVersion(row, input.version);
    if (row.status !== 'draft') throw new RequestError('Only draft requests can be submitted.');
    requireMatchingPayment(row);
    await eligible(context, ownerId, wallet);
    checked(await admin.rpc('rl_purchase_submit', { p_id: id, p_version: version(input.version), p_actor: ownerId, p_wallet: wallet.toLowerCase() }));
    const current = await read(context, id);
    return json(present(current.row, current.proof));
  }
  if (input.action === 'purchase_review' || input.action === 'purchase_fulfill') {
    assertManager(wallet, manager);
    const id = requireUuid(input.id);
    const { row, proof } = await read(context, id);
    if (row.owner_id === ownerId || row.wallet === wallet.toLowerCase()) throw new RequestError('You cannot review your own purchase request.');
    if (input.action === 'purchase_review') {
      matchesVersion(row, input.version);
      if (input.decision !== 'approved' && input.decision !== 'rejected') throw new RequestError('Choose approve or reject.');
      const rejectingMismatch = input.decision === 'rejected' && purchaseHasPriceMismatch(row);
      if (row.status !== 'pending' && !(rejectingMismatch && ['draft', 'approved'].includes(row.status))) throw new RequestError('Only pending requests or requests with a payment mismatch can be reviewed.');
      if (!proof && !(rejectingMismatch && row.status === 'draft')) throw new RequestError('Payment proof is required before reviewing this request.');
      if (typeof input.note !== 'string' || !input.note.trim() || input.note.trim().length > 2000) throw new RequestError('Enter a review note of 1–2,000 characters.');
      if (input.decision === 'approved') { requireMatchingPayment(row); await eligible(context, row.owner_id, row.wallet); }
      checked(await admin.rpc('rl_purchase_review', { p_id: id, p_version: version(input.version), p_actor: ownerId,
        p_decision: input.decision, p_note: input.note.trim() }));
    } else {
      if (!proof) throw new RequestError('Payment proof is required before recording token issuance.');
      if (typeof input.tx_hash !== 'string' || !/^0x[\da-f]{64}$/i.test(input.tx_hash)) throw new RequestError('Enter the confirmed token issuance transaction hash.');
      const hash = input.tx_hash.toLowerCase();
      if (row.status === 'fulfilled' && row.issuance_tx_hash === hash) return json(present(row, proof));
      matchesVersion(row, input.version);
      if (row.status !== 'approved' || !row.submitted_at) throw new RequestError('Only approved requests can record token issuance.');
      requireMatchingPayment(row);
      await eligible(context, row.owner_id, row.wallet);
      if (!chain.verifyIssuance) throw new RequestError('Token issuance verification is unavailable.');
      await chain.verifyIssuance(hash, row.wallet, row.units, manager, row.submitted_at);
      checked(await admin.rpc('rl_purchase_fulfill', { p_id: id, p_version: version(input.version), p_actor: ownerId, p_tx: hash }));
    }
    const current = await read(context, id);
    return json(present(current.row, current.proof));
  }
  throw new RequestError('Unknown purchase action.');
}
