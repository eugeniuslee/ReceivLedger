import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const manager = '0x1111111111111111111111111111111111111111';
const alice = '0x2222222222222222222222222222222222222222';
const bob = '0x3333333333333333333333333333333333333333';
const ids = ['10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003'];
const sessions = ids.map(id => id.replace('10000000', '20000000'));
let db: PGlite;

async function asUser<T>(index: number, operation: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: ids[index], session_id: sessions[index], user_metadata: { wallet: manager, role: 'manager' } })]);
  await db.exec('set role authenticated');
  try { return await operation(); } finally { await db.exec('reset role'); }
}
async function apply(index = 1, kind = 'sme') {
  return asUser(index, async () => (await db.query<{ id: string }>("select * from public.rl_submit_application($1,'Demo Company','DEMO-123','demo@example.test','DEMO-123',$2::jsonb)", [kind, JSON.stringify({ country: 'Demo country', website: '', business_address: 'Fictional address', contact_name: 'Demo contact' })])).rows[0]);
}
async function seedKyc(app: string, owner = ids[1], verified = true) {
  const id = '30000000-0000-0000-0000-000000000001';
  await db.query(`insert into public.rl_documents(id,owner_id,application_id,purpose,filename,storage_path,byte_size,sha256,status)
    values($1,$2,$3,'kyc','fictional.pdf',$6,100,$4,$5)`, [id, owner, app, 'a'.repeat(64), verified ? 'verified' : 'pending', `${owner}/${id}.pdf`]);
  await db.query("insert into storage.objects(bucket_id,name) values('receiveledger-documents',$1)", [`${owner}/${id}.pdf`]);
  return id;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create table auth.identities(user_id uuid,provider text,provider_id text);
    create table auth.sessions(id uuid primary key,user_id uuid);
    create table auth.mfa_amr_claims(session_id uuid,authentication_method text);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant execute on function auth.jwt(),auth.uid() to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
    -- Model an existing overbroad policy to prove the new restrictive bucket guard works.
    create policy legacy_read on storage.objects for select to anon,authenticated using(true);
    create policy legacy_insert on storage.objects for insert to authenticated with check(true);
    create policy legacy_update on storage.objects for update to authenticated using(true) with check(true);
    create policy legacy_delete on storage.objects for delete to authenticated using(true);
  `);
  // The production migration is executed only in this disposable WASM database.
  await db.exec(readFileSync(new URL('../../supabase/migrations/202610220001_registration_documents.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../supabase/migrations/202610220002_private_document_delete_guard.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../../supabase/migrations/202610220003_application_onboarding.sql', import.meta.url), 'utf8'));
  for (let index = 0; index < ids.length; index++) {
    await db.query('insert into auth.users values($1)', [ids[index]]);
    await db.query("insert into auth.identities values($1,'web3',$2)", [ids[index], `web3:ethereum:${[manager, alice, bob][index]}`]);
    await db.query('insert into auth.sessions values($1,$2)', [sessions[index], ids[index]]);
    await db.query("insert into auth.mfa_amr_claims values($1,'web3')", [sessions[index]]);
  }
}, 30000);
beforeEach(async () => {
  await db.exec('reset role; truncate public.rl_review_audit,public.rl_documents,public.rl_applications,public.rl_profiles,storage.objects restart identity cascade;');
  await db.query('update public.rl_config set manager_wallet=$1', [manager]);
  for (let index = 0; index < ids.length; index++) await asUser(index, () => db.query('select public.rl_ensure_profile()'));
});
afterAll(async () => { await db?.close(); });

describe('actual PostgreSQL migration, grants and row-level security', () => {
  it('stores the new private fields and excludes them from the shared directory', async () => {
    const app = await apply(); await seedKyc(app.id);
    const own = await asUser(1, () => db.query<{ details: { business_address: string }; submitted_at: string }>('select details,submitted_at from public.rl_applications'));
    expect(own.rows[0].details.business_address).toBe('Fictional address'); expect(own.rows[0].submitted_at).toBeTruthy();
    expect((await asUser(2, () => db.query('select details from public.rl_applications'))).rows).toHaveLength(0);
    await db.query("select public.rl_review_application($1,1,$2,'approved','Reviewed fictional details',null)", [app.id, ids[0]]);
    const directory = await asUser(2, () => db.query('select * from public.rl_directory()'));
    expect(Object.keys(directory.rows[0] as object).sort()).toEqual(['display_name', 'kind', 'wallet']);
  });
  it('validates new fields in the direct RPC and removes the old submission overload', async () => {
    await expect(asUser(1, () => db.query("select public.rl_submit_application('investor','Demo Investor','','demo@example.test','DEMO-123','{}'::jsonb)"))).rejects.toThrow(/Country/);
    await expect(asUser(1, () => db.query("select public.rl_submit_application('sme','Demo SME','DEMO','demo@example.test','DEMO-123','{}'::jsonb)"))).rejects.toThrow(/Business address/);
    await expect(asUser(1, () => db.query("select public.rl_submit_application('investor','Demo Investor','','demo@example.test','DEMO-123')"))).rejects.toThrow(/does not exist/);
  });
  it('validates optional HTTPS website authority while allowing query and fragment URLs', async () => {
    const details = { business_address: 'Fictional address', contact_name: 'Demo contact', website: 'https://example.test?demo=1#fictional' };
    const submit = (website: string) => asUser(1, () => db.query("select * from public.rl_submit_application('sme','Demo SME','DEMO','demo@example.test','DEMO-123',$1::jsonb)", [JSON.stringify({ ...details, website })]));
    await expect(submit(details.website)).resolves.toBeTruthy();
    await expect(submit('https://fictional:demo@example.test')).rejects.toThrow(/HTTPS/);
    await expect(submit('javascript:alert(1)')).rejects.toThrow(/HTTPS/);
  });
  it('audits information requests, resubmission and off-chain suspension/revocation without applicant escalation', async () => {
    const app = await apply();
    await db.query("select public.rl_review_application($1,1,$2,'needs_info','Add fictional details',null)", [app.id, ids[0]]);
    expect((await asUser(1, () => db.query<{ status: string }>('select status from public.rl_applications'))).rows[0].status).toBe('needs_info');
    await apply(); await seedKyc(app.id);
    await db.query("select public.rl_review_application($1,3,$2,'approved','Reviewed',null)", [app.id, ids[0]]);
    await db.query("select public.rl_review_application($1,4,$2,'suspended','Demo pause',null)", [app.id, ids[0]]);
    await expect(apply()).rejects.toThrow(/cannot be edited/);
    await expect(asUser(1, () => db.query("select public.rl_review_application($1,5,$2,'needs_info','Self resume',null)", [app.id, ids[0]]))).rejects.toThrow(/permission denied/);
    await db.query("select public.rl_review_application($1,5,$2,'revoked','Off-chain closure',null)", [app.id, ids[0]]);
    await expect(apply()).rejects.toThrow(/cannot be edited/);
    expect((await db.query('select * from public.rl_review_audit')).rows).toHaveLength(4);
    expect((await asUser(2, () => db.query('select * from public.rl_directory()'))).rows).toHaveLength(0);
  });
  it('derives wallets from protected identities, ignoring spoofed metadata', async () => {
    const result = await asUser(1, () => db.query<{ wallet: string }>('select public.rl_current_wallet() as wallet'));
    expect(result.rows[0].wallet).toBe(alice);
    await expect(asUser(1, () => db.query('update public.rl_config set manager_wallet=$1', [alice]))).rejects.toThrow(/permission denied/);
  });
  it('isolates private applications and gives the manager review access', async () => {
    await apply(1); await apply(2);
    expect((await asUser(1, () => db.query('select * from public.rl_applications'))).rows).toHaveLength(1);
    expect((await asUser(0, () => db.query('select * from public.rl_applications'))).rows).toHaveLength(2);
    await db.exec('set role anon');
    await expect(db.query('select * from public.rl_applications')).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
  });
  it('denies forged profile ownership and direct status updates', async () => {
    await apply();
    await expect(asUser(1, () => db.query("update public.rl_applications set status='approved'"))).rejects.toThrow(/permission denied/);
    await expect(asUser(1, () => db.query('insert into public.rl_profiles(user_id,wallet) values($1,$2)', [ids[1], bob]))).rejects.toThrow(/permission denied/);
  });
  it('rejects a non-wallet login even if the user has a linked wallet identity', async () => {
    await db.query("update auth.mfa_amr_claims set authentication_method='password' where session_id=$1", [sessions[1]]);
    try { await expect(apply()).rejects.toThrow(/Verified Ethereum session/); }
    finally { await db.query("update auth.mfa_amr_claims set authentication_method='web3' where session_id=$1", [sessions[1]]); }
  });
  it('fails closed when a user links another identity', async () => {
    await db.query("insert into auth.identities values($1,'email','fictional-linked-id')", [ids[1]]);
    try { await expect(apply()).rejects.toThrow(/Verified Ethereum session/); }
    finally { await db.query("delete from auth.identities where provider='email'"); }
  });
  it('does not expose old documents after the authenticated identity wallet changes', async () => {
    const app = await apply(); await seedKyc(app.id);
    await db.query("update auth.identities set provider_id=$1 where user_id=$2", [`web3:ethereum:${bob}`, ids[1]]);
    try { expect((await asUser(1, () => db.query('select * from public.rl_documents'))).rows).toHaveLength(0); }
    finally { await db.query("update auth.identities set provider_id=$1 where user_id=$2", [`web3:ethereum:${alice}`, ids[1]]); }
  });
  it('denies direct review RPC calls even when the actor argument spoofs the manager', async () => {
    const app = await apply();
    await expect(asUser(1, () => db.query("select public.rl_review_application($1,1,$2,'approved','fake',null)", [app.id, ids[0]]))).rejects.toThrow(/permission denied/);
  });
  it('requires verified KYC and supports reject, resubmit and SME approval', async () => {
    const app = await apply();
    await expect(db.query("select public.rl_review_application($1,1,$2,'approved','Reviewed demo',null)", [app.id, ids[0]])).rejects.toThrow(/Verify fictional KYC/);
    await db.query("select public.rl_review_application($1,1,$2,'rejected','Please resubmit',null)", [app.id, ids[0]]);
    await apply();
    await seedKyc(app.id);
    await db.query("select public.rl_review_application($1,3,$2,'approved','Reviewed fictional SME',null)", [app.id, ids[0]]);
    const result = await asUser(1, () => db.query<{ status: string }>('select status from public.rl_applications'));
    expect(result.rows[0].status).toBe('approved');
    await expect(apply()).rejects.toThrow(/cannot be edited/);
  });
  it('requires investor receipt evidence at the database boundary too', async () => {
    const app = await apply(1, 'investor'); await seedKyc(app.id);
    await expect(db.query("select public.rl_review_application($1,1,$2,'approved','Reviewed demo',null)", [app.id, ids[0]])).rejects.toThrow(/check constraint/);
    expect((await db.query<{ status: string }>('select status from public.rl_applications')).rows[0].status).toBe('pending');
  });
  it('rejects stale application reviews and records an audit trail', async () => {
    const app = await apply();
    await expect(db.query("select public.rl_review_application($1,5,$2,'rejected','Stale',null)", [app.id, ids[0]])).rejects.toThrow(/changed/);
    await db.query("select public.rl_review_application($1,1,$2,'rejected','Reviewed',null)", [app.id, ids[0]]);
    expect((await asUser(0, () => db.query('select * from public.rl_review_audit'))).rows).toHaveLength(1);
    expect((await asUser(1, () => db.query('select * from public.rl_review_audit'))).rows).toHaveLength(0);
  });
  it('blocks cross-user and anonymous storage reads even with a legacy permissive policy', async () => {
    const app = await apply(); await seedKyc(app.id);
    expect((await asUser(1, () => db.query('select * from storage.objects'))).rows).toHaveLength(1);
    expect((await asUser(0, () => db.query('select * from storage.objects'))).rows).toHaveLength(1);
    expect((await asUser(2, () => db.query('select * from storage.objects'))).rows).toHaveLength(0);
    expect((await asUser(2, () => db.query('select * from public.rl_documents'))).rows).toHaveLength(0);
    await db.exec('set role anon');
    await expect(db.query('select * from storage.objects')).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
  });
  it('forces uploads through the PDF-validation service and protects metadata', async () => {
    await expect(asUser(1, () => db.query("insert into storage.objects(bucket_id,name) values('receiveledger-documents','bypass.pdf')"))).rejects.toThrow(/row-level security/);
    await expect(asUser(1, () => db.query("delete from public.rl_documents"))).rejects.toThrow(/permission denied/);
  });
  it('keeps private objects immutable despite legacy update/delete policies, including for the manager', async () => {
    const app = await apply(); await seedKyc(app.id);
    for (const index of [1, 0, 2]) {
      expect((await asUser(index, () => db.query("delete from storage.objects where bucket_id='receiveledger-documents' returning id"))).rows).toHaveLength(0);
    }
    await expect(asUser(1, () => db.query("update storage.objects set name='replacement.pdf' where bucket_id='receiveledger-documents'"))).rejects.toThrow(/row-level security/);
    expect((await db.query('select * from storage.objects')).rows).toHaveLength(1);
    await db.exec('set role service_role');
    try { expect((await db.query('delete from storage.objects returning id')).rows).toHaveLength(1); }
    finally { await db.exec('reset role'); }
  });
  it('revoked sessions lose database access even if their JWT has not expired', async () => {
    await apply();
    await db.query('delete from auth.sessions where id=$1', [sessions[1]]);
    try {
      expect((await asUser(1, () => db.query('select * from public.rl_applications'))).rows).toHaveLength(0);
      await expect(apply()).rejects.toThrow(/Verified Ethereum session/);
    } finally { await db.query('insert into auth.sessions values($1,$2)', [sessions[1], ids[1]]); }
  });
  it('shares approved display labels without contact information', async () => {
    const app = await apply(); await seedKyc(app.id);
    expect((await asUser(2, () => db.query('select * from public.rl_directory()'))).rows).toEqual([]);
    await db.query("select public.rl_review_application($1,1,$2,'approved','Reviewed',null)", [app.id, ids[0]]);
    const result = await asUser(2, () => db.query('select * from public.rl_directory()'));
    expect(Object.keys(result.rows[0] as object).sort()).toEqual(['display_name', 'kind', 'wallet']);
  });
  it('allows document verification only through manager service operations', async () => {
    const app = await apply(); const doc = await seedKyc(app.id, ids[1], false);
    await expect(asUser(1, () => db.query("select public.rl_review_document($1,1,$2,'verified','forged')", [doc, ids[0]]))).rejects.toThrow(/permission denied/);
    await db.query("select public.rl_review_document($1,1,$2,'verified','Reviewed fictional PDF')", [doc, ids[0]]);
    await expect(db.query("select public.rl_review_document($1,1,$2,'rejected','stale')", [doc, ids[0]])).rejects.toThrow(/changed/);
  });
});
