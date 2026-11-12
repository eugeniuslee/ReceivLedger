import { RequestError } from './domain.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RegistryChain } from './chain.ts';
import { assertManager, assertApplicationReview, creditInput, fundRequestInput, invoiceId, invoiceReviewInput, MAX_PDF_BYTES, PRIVATE_BUCKET, registrationInput, requireUuid, type Application, type PrivateDocument } from './domain.ts';
import { validatePdf } from './pdf.ts';

interface Dependencies { admin: SupabaseClient; userClient: (token: string) => SupabaseClient; chain: RegistryChain; origins: string[] }
function checked<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  // A new application can collide with the unique registered-name index.
  if (error?.message.includes('rl_applications_display_name_unique')) throw new RequestError('That name is already used. Choose a different name.');
  if (error) throw new RequestError(error.message);
  return data;
}
async function boundedBody(request: Request, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) throw new RequestError('Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError('Request body required.');
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw new RequestError('Request is too large.'); }
    chunks.push(value);
  }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
export function createRegistryHandler({ admin, userClient, chain, origins }: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin') ?? '';
    const allowed = origins.includes(origin);
    const headers: Record<string, string> = { 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff',
      ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    if (!allowed) return json({ error: 'Origin is not allowed.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'POST required.' }, 405);
    try {
      const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
      if (!token) return json({ error: 'Sign in with your wallet first.' }, 401);
      const auth = await admin.auth.getUser(token);
      if (auth.error || !auth.data.user) return json({ error: 'Wallet session is invalid or expired.' }, 401);
      const user = userClient(token);
      const wallet = checked(await user.rpc('rl_current_wallet')) as string | null;
      if (!wallet) return json({ error: 'A verified Ethereum wallet session is required.' }, 401);
      const profile = checked(await user.rpc('rl_ensure_profile'));
      const manager = await chain.manager();
      checked(await admin.from('rl_config').update({ manager_wallet: manager }).eq('singleton', true));
      const isManager = wallet.toLowerCase() === manager.toLowerCase();
      const ownerId = auth.data.user.id;
      const multipart = request.headers.get('content-type')?.startsWith('multipart/form-data');
      const raw = await boundedBody(request, multipart ? MAX_PDF_BYTES + 65536 : 32768);
      const form = multipart ? await new Response(new Uint8Array(raw).buffer, { headers: { 'content-type': request.headers.get('content-type')! } }).formData() : null;
      const input = multipart ? { action: 'upload' } : JSON.parse(new TextDecoder().decode(raw));
      const action = input.action;
      if (action === 'bootstrap') {
        const application = checked(await user.from('rl_applications').select('*').eq('user_id', ownerId).maybeSingle());
        return json({ profile, application, isManager });
      }
      if (action === 'directory') return json(checked(await user.rpc('rl_directory')));
      if (action === 'submit') {
        const registration = registrationInput(input.application);
        if (input.demo_consent !== true) throw new RequestError('Use fictional demonstration details only.');
        return json(checked(await user.rpc('rl_submit_application', { p_kind: registration.kind, p_name: registration.display_name,
          p_company: registration.company_number, p_email: registration.contact_email, p_phone: registration.contact_phone, p_details: registration.details })));
      }
      if (action === 'rename') {
        // Renames only the caller's own application; uniqueness is enforced in the database.
        if (typeof input.display_name !== 'string') throw new RequestError('Enter a registered name.');
        const name = input.display_name.trim();
        if (name.length < 2 || name.length > 100) throw new RequestError('Enter a name with 2 to 100 characters.');
        return json(checked(await admin.rpc('rl_rename_application', { p_user: ownerId, p_name: name })));
      }
      if (action === 'set_invoice_credit') {
        // Bad debt: only the fund manager can impair, write off or clear a financed invoice.
        assertManager(wallet, manager);
        const id = invoiceId(input.invoice_id);
        await chain.invoiceOwner(id); // throws if the invoice does not exist on-chain
        const credit = creditInput(input);
        return json(checked(await admin.rpc('rl_set_invoice_credit', { p_actor: ownerId, p_invoice: id, p_stage: credit.stage, p_expected_bps: credit.bps, p_recovered: credit.recovered, p_note: credit.note, p_version: credit.version })));
      }
      if (action === 'invoice_reviews') {
        // The manager sees every decision; an SME sees only those on its own invoices.
        if (isManager) return json(checked(await admin.from('rl_invoice_reviews').select('*').order('decided_at', { ascending: false }).limit(500)));
        return json(checked(await admin.from('rl_invoice_reviews').select('*').eq('sme_wallet', wallet.toLowerCase()).limit(200)));
      }
      if (action === 'review_invoice') {
        // Off-chain only: reject an invoice or ask the SME for more documents. The SME wallet comes from the chain.
        assertManager(wallet, manager);
        const id = invoiceId(input.invoice_id);
        const sme = (await chain.invoiceOwner(id)).toLowerCase();
        const review = invoiceReviewInput(input);
        return json(checked(await admin.rpc('rl_set_invoice_review', { p_actor: ownerId, p_invoice: id, p_sme: sme, p_status: review.decision, p_note: review.note, p_version: review.version })));
      }
      if (action === 'fund_requests') {
        // Investors see their own requests (row-level security); the manager sees all.
        if (isManager) return json(checked(await admin.from('rl_fund_requests').select('*').order('created_at', { ascending: false }).limit(300)));
        return json(checked(await user.from('rl_fund_requests').select('*').order('created_at', { ascending: false }).limit(100)));
      }
      if (action === 'request_fund') {
        if (isManager) throw new RequestError('The fund manager cannot request subscriptions or redemptions.');
        const { kind, amount } = fundRequestInput(input);
        const status = await chain.investorStatus(wallet);
        if (!status.approved) throw new RequestError('Only approved investors can make subscription or redemption requests.');
        if (kind === 'redemption' && amount > status.balance) throw new RequestError(`You hold ${status.balance} RLU, which is less than the ${amount} RLU requested.`);
        return json(checked(await admin.rpc('rl_create_fund_request', { p_user: ownerId, p_wallet: wallet, p_kind: kind, p_amount: amount.toString() })));
      }
      if (action === 'cancel_fund_request') {
        return json(checked(await admin.rpc('rl_cancel_fund_request', { p_id: requireUuid(input.id), p_user: ownerId })));
      }
      if (action === 'decide_fund_request') {
        assertManager(wallet, manager);
        if (!['approved', 'rejected', 'completed'].includes(input.decision)) throw new RequestError('Choose approve, complete or reject.');
        if (!Number.isInteger(input.version) || input.version < 1) throw new RequestError('Refresh the request and try again.');
        const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '';
        const tx = typeof input.tx_hash === 'string' && /^0x[\da-fA-F]{64}$/.test(input.tx_hash) ? input.tx_hash : null;
        return json(checked(await admin.rpc('rl_decide_fund_request', { p_id: requireUuid(input.id), p_version: input.version, p_actor: ownerId, p_decision: input.decision, p_note: note, p_tx: tx })));
      }
      if (action === 'applications') {
        assertManager(wallet, manager);
        return json(checked(await admin.from('rl_applications').select('*').order('created_at', { ascending: false }).limit(200)));
      }
      if (action === 'documents') {
        let query = user.from('rl_documents').select('*').order('created_at', { ascending: false }).limit(200);
        if (input.application_id) query = query.eq('application_id', requireUuid(input.application_id));
        if (input.invoice_id) query = query.eq('invoice_id', invoiceId(input.invoice_id));
        if (input.fund_request_id) query = query.eq('fund_request_id', requireUuid(input.fund_request_id));
        return json(checked(await query));
      }
      if (action === 'upload' && form) {
        if (form.get('demo_consent') !== 'true') throw new RequestError('Only fictional demonstration PDFs may be uploaded.');
        const file = form.get('file');
        if (!(file instanceof File)) throw new RequestError('Choose a PDF.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        await validatePdf(bytes);
        const purpose = form.get('purpose');
        let application_id: string | null = null; let invoice_id: string | null = null; let fund_request_id: string | null = null;
        if (purpose === 'kyc') {
          application_id = requireUuid(form.get('application_id'));
          const app = checked(await user.from('rl_applications').select('*').eq('id', application_id).eq('user_id', ownerId).single()) as Application;
          if (!['pending', 'needs_info'].includes(app.status)) throw new RequestError('KYC can only be attached to your pending application or information request.');
        } else if (purpose === 'invoice' || purpose === 'repayment') {
          // Invoice PDFs and repayment proofs attach only to the uploader's own on-chain invoice.
          invoice_id = invoiceId(form.get('invoice_id'));
          if ((await chain.invoiceOwner(invoice_id)).toLowerCase() !== wallet.toLowerCase()) throw new RequestError('This invoice belongs to another wallet.');
        } else if (purpose === 'subscription') {
          // Payment proof for the uploader's own subscription request, once the manager has approved it.
          fund_request_id = requireUuid(form.get('fund_request_id'));
          const found = checked(await admin.from('rl_fund_requests').select('id,user_id,kind,status').eq('id', fund_request_id).maybeSingle()) as { user_id: string; kind: string; status: string } | null;
          if (!found || found.user_id !== ownerId || found.kind !== 'subscription') throw new RequestError('This subscription request belongs to another wallet.');
          if (found.status !== 'approved') throw new RequestError('Upload payment proof once the fund manager has approved your subscription.');
        } else throw new RequestError('Choose a KYC, invoice, repayment or payment-proof PDF.');
        const count = await admin.from('rl_documents').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId);
        if (count.error || (count.count ?? 0) >= 20) throw new RequestError('Document limit reached or unavailable. Contact the project administrator.');
        const id = crypto.randomUUID(); const path = `${ownerId}/${id}.pdf`;
        const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
        const filename = file.name.replace(/[^\w.\- ]/g, '_').slice(0, 160) || 'demo.pdf';
        checked(await admin.storage.from(PRIVATE_BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false }));
        const saved = await admin.from('rl_documents').insert({ id, owner_id: ownerId, application_id, invoice_id, fund_request_id,
          purpose, filename, storage_path: path, byte_size: bytes.length, sha256 }).select('*').single();
        if (saved.error) {
          await admin.storage.from(PRIVATE_BUCKET).remove([path]);
          throw new RequestError('Document metadata could not be saved. Upload was not completed.');
        }
        // An invoice document uploaded after the manager asked for more information answers that request.
        if (purpose === 'invoice' && invoice_id) checked(await admin.rpc('rl_invoice_info_provided', { p_invoice: invoice_id, p_wallet: wallet }));
        return json(saved.data);
      }
      if (action === 'download') {
        const doc = checked(await user.from('rl_documents').select('*').eq('id', requireUuid(input.id)).single()) as PrivateDocument;
        const blob = checked(await admin.storage.from(PRIVATE_BUCKET).download(doc.storage_path));
        return new Response(blob, { headers: { ...headers, 'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${doc.id}.pdf"`, 'Content-Security-Policy': "sandbox; default-src 'none'" } });
      }
      if (action === 'review_application') {
        assertManager(wallet, manager);
        const app = checked(await admin.from('rl_applications').select('*').eq('id', requireUuid(input.id)).single()) as Application;
        assertApplicationReview(app.status, app.version, input.version, input.decision);
        if (input.decision === 'approved') {
          const kyc = checked(await admin.from('rl_documents').select('id').eq('application_id', app.id).eq('status', 'verified').limit(1));
          if (!kyc?.length) throw new RequestError('Verify fictional KYC before approving the application.');
          if (app.kind === 'investor') await chain.verifyApproval(input.tx_hash ?? '', app.wallet, manager);
        }
        return json(checked(await admin.rpc('rl_review_application', { p_id: app.id, p_version: input.version,
          p_actor: ownerId, p_decision: input.decision, p_note: input.note,
          p_tx: app.kind === 'investor' && input.decision === 'approved' ? input.tx_hash : null })));
      }
      if (action === 'review_document') {
        assertManager(wallet, manager);
        return json(checked(await admin.rpc('rl_review_document', { p_id: requireUuid(input.id), p_version: input.version,
          p_actor: ownerId, p_decision: input.decision, p_note: input.note })));
      }
      return json({ error: 'Unknown action.' }, 400);
    } catch (cause) {
      // No tokens, file contents or credentials are logged or returned.
      const message = cause instanceof RequestError ? cause.message : 'Registration service could not complete this request. Check its configuration and try again.';
      return json({ error: message }, 400);
    }
  };
}

