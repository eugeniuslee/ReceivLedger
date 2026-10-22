import { RequestError } from './domain.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RegistryChain } from './chain.ts';
import { assertManager, assertApplicationReview, invoiceId, MAX_PDF_BYTES, PRIVATE_BUCKET, registrationInput, requireUuid, type Application, type PrivateDocument } from './domain.ts';
import { validatePdf } from './pdf.ts';

interface Dependencies { admin: SupabaseClient; userClient: (token: string) => SupabaseClient; chain: RegistryChain; origins: string[] }
function checked<T>({ data, error }: { data: T; error: { message: string } | null }): T {
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
      if (action === 'applications') {
        assertManager(wallet, manager);
        return json(checked(await admin.from('rl_applications').select('*').order('created_at', { ascending: false }).limit(200)));
      }
      if (action === 'documents') {
        let query = user.from('rl_documents').select('*').order('created_at', { ascending: false }).limit(200);
        if (input.application_id) query = query.eq('application_id', requireUuid(input.application_id));
        if (input.invoice_id) query = query.eq('invoice_id', invoiceId(input.invoice_id));
        return json(checked(await query));
      }
      if (action === 'upload' && form) {
        if (form.get('demo_consent') !== 'true') throw new RequestError('Only fictional demonstration PDFs may be uploaded.');
        const file = form.get('file');
        if (!(file instanceof File)) throw new RequestError('Choose a PDF.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        await validatePdf(bytes);
        const purpose = form.get('purpose');
        let application_id: string | null = null; let invoice_id: string | null = null;
        if (purpose === 'kyc') {
          application_id = requireUuid(form.get('application_id'));
          const app = checked(await user.from('rl_applications').select('*').eq('id', application_id).eq('user_id', ownerId).single()) as Application;
          if (!['pending', 'needs_info'].includes(app.status)) throw new RequestError('KYC can only be attached to your pending application or information request.');
        } else if (purpose === 'invoice') {
          invoice_id = invoiceId(form.get('invoice_id'));
          if ((await chain.invoiceOwner(invoice_id)).toLowerCase() !== wallet.toLowerCase()) throw new RequestError('This invoice belongs to another wallet.');
        } else throw new RequestError('Choose KYC or invoice PDF.');
        const count = await admin.from('rl_documents').select('id', { count: 'exact', head: true }).eq('owner_id', ownerId);
        if (count.error || (count.count ?? 0) >= 20) throw new RequestError('Document limit reached or unavailable. Contact the project administrator.');
        const id = crypto.randomUUID(); const path = `${ownerId}/${id}.pdf`;
        const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
        const filename = file.name.replace(/[^\w.\- ]/g, '_').slice(0, 160) || 'demo.pdf';
        checked(await admin.storage.from(PRIVATE_BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false }));
        const saved = await admin.from('rl_documents').insert({ id, owner_id: ownerId, application_id, invoice_id,
          purpose, filename, storage_path: path, byte_size: bytes.length, sha256 }).select('*').single();
        if (saved.error) {
          await admin.storage.from(PRIVATE_BUCKET).remove([path]);
          throw new RequestError('Document metadata could not be saved. Upload was not completed.');
        }
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

