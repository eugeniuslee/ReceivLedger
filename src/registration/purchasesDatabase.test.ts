import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const wallets = ['0x' + '11'.repeat(20), '0x' + '22'.repeat(20), '0x' + '33'.repeat(20)];
const ids = [1, 2, 3].map(n => `10000000-0000-0000-0000-00000000000${n}`);
const sessions = ids.map(id => id.replace('10000000', '20000000'));
const requestId = '30000000-0000-0000-0000-000000000001';
const proofId = '40000000-0000-0000-0000-000000000001';
const tx = '0x' + 'a'.repeat(64);
let db: PGlite;
interface Row { id: string; owner_id: string; wallet: string; units: string; amount_cents: string; pricing_basis: string; status: string; version: number; issuance_tx_hash: string | null; submitted_at: string | null }
async function asUser<T>(index: number, action: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: ids[index], session_id: sessions[index] })]);
  await db.exec('set role authenticated');
  try { return await action(); } finally { await db.exec('reset role'); }
}
async function create(id = requestId, owner = 1, units = '100') {
  return (await db.query<Row>('select * from public.rl_purchase_create_priced($1,$2,$3,$4,$5)', [id, ids[owner], wallets[owner], units, 'Bank reference TEST'])).rows[0];
}
async function attach(id = requestId, proof = proofId, owner = 1, version: number | null = 1) {
  return (await db.query<Row>('select * from public.rl_purchase_attach_proof($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, version, ids[owner], wallets[owner], proof, 'proof.pdf', `${ids[owner]}/${proof}.pdf`, 100, 'a'.repeat(64)])).rows[0];
}
async function submit(id = requestId, owner = 1, version: number | null = 2) {
  return (await db.query<Row>('select * from public.rl_purchase_submit($1,$2,$3,$4)', [id, version, ids[owner], wallets[owner]])).rows[0];
}
async function review(id = requestId, decision = 'approved', version: number | null = 3, actor = 0) {
  return (await db.query<Row>('select * from public.rl_purchase_review($1,$2,$3,$4,$5)', [id, version, ids[actor], decision, 'Reviewed proof and requested allocation'])).rows[0];
}
async function fulfill(id = requestId, hash = tx, version = 4) {
  return (await db.query<Row>('select * from public.rl_purchase_fulfill($1,$2,$3,$4)', [id, version, ids[0], hash])).rows[0];
}
async function pending(id = requestId, proof = proofId, owner = 1) { await create(id, owner); await attach(id, proof, owner); await submit(id, owner); }

async function initializeDatabase(applyPricing = true) {
  const db = new PGlite();
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
    create policy legacy_read on storage.objects for select to anon,authenticated using(true);
    create policy legacy_insert on storage.objects for insert to authenticated with check(true);
    create policy legacy_update on storage.objects for update to authenticated using(true) with check(true);
    create policy legacy_delete on storage.objects for delete to authenticated using(true);
  `);
  for (const migration of ['202610220001_registration_documents.sql', '202610220002_private_document_delete_guard.sql', '202610220003_application_onboarding.sql', '202611090001_purchase_requests.sql']) {
    await db.exec(readFileSync(new URL(`../../supabase/migrations/${migration}`, import.meta.url), 'utf8'));
  }
  if (applyPricing) await db.exec(readFileSync(new URL('../../supabase/migrations/202611090002_purchase_pricing.sql', import.meta.url), 'utf8'));
  for (let i = 0; i < ids.length; i++) {
    await db.query('insert into auth.users values($1)', [ids[i]]);
    await db.query("insert into auth.identities values($1,'web3',$2)", [ids[i], `web3:ethereum:${wallets[i]}`]);
    await db.query('insert into auth.sessions values($1,$2)', [sessions[i], ids[i]]);
    await db.query("insert into auth.mfa_amr_claims values($1,'web3')", [sessions[i]]);
  }
  return db;
}
beforeAll(async () => { db = await initializeDatabase(); }, 30000);
beforeEach(async () => {
  await db.exec('reset role; truncate public.rl_purchase_audit,public.rl_purchase_proofs,public.rl_purchase_requests,public.rl_review_audit,public.rl_documents,public.rl_applications,public.rl_profiles,storage.objects restart identity cascade');
  await db.query('update public.rl_config set manager_wallet=$1', [wallets[0]]);
  for (let i = 0; i < ids.length; i++) await asUser(i, () => db.query('select public.rl_ensure_profile()'));
});
afterAll(async () => { await db?.close(); });

describe('purchase migration and transactional state transitions', () => {
  it('computes exact fixed-price totals and makes request creation idempotent', async () => {
    const units = '9999999999999';
    const first = await create(requestId, 1, units);
    expect(await create(requestId, 1, units)).toEqual(first);
    expect(first).toMatchObject({ units, amount_cents: '999999999999900', pricing_basis: 'rlu_sgd_1_v1', status: 'draft', version: 1, issuance_tx_hash: null });
    expect((await db.query('select * from public.rl_purchase_audit')).rows).toHaveLength(1);
    await expect(create(requestId, 1, '101')).rejects.toThrow(/already used/);
    await expect(create(requestId, 2, units)).rejects.toThrow(/already used/);
  });
  it('requires immutable private proof and maintains versioned draft, review, and fulfillment states', async () => {
    await create();
    await expect(submit(requestId, 1, 1)).rejects.toThrow(/Attach payment proof/);
    expect((await attach()).version).toBe(2);
    await expect(attach(requestId, '40000000-0000-0000-0000-000000000002', 1, 2)).rejects.toThrow(/already attached/);
    expect((await submit()).status).toBe('pending');
    await expect(review(requestId, 'approved', 2)).rejects.toThrow(/changed/);
    const approved = await review();
    expect(approved).toMatchObject({ status: 'approved', version: 4, issuance_tx_hash: null });
    expect(await fulfill()).toMatchObject({ status: 'fulfilled', version: 5, issuance_tx_hash: tx });
    expect(await fulfill()).toMatchObject({ status: 'fulfilled', version: 5 });
    expect((await db.query("select action from public.rl_purchase_audit where action='fulfilled'")).rows).toHaveLength(1);
  });
  it('denies cross-owner proof/submit, stale or null versions, and nonmanager review', async () => {
    await create();
    await expect(attach(requestId, proofId, 2)).rejects.toThrow(/not your draft/);
    await expect(attach(requestId, proofId, 1, null)).rejects.toThrow(/changed/);
    await attach();
    await expect(submit(requestId, 2)).rejects.toThrow(/not your draft/);
    await expect(submit(requestId, 1, null)).rejects.toThrow(/changed/);
    await submit();
    await expect(review(requestId, 'approved', 3, 1)).rejects.toThrow(/Manager required/);
    await expect(review(requestId, 'approved', null)).rejects.toThrow(/changed/);
    await review(requestId, 'rejected');
    await expect(fulfill()).rejects.toThrow(/not approved/);
  });
  it('rejects reused issuance receipts across separate requests', async () => {
    await pending(); await review(); await fulfill();
    const other = '30000000-0000-0000-0000-000000000002';
    await pending(other, '40000000-0000-0000-0000-000000000002', 2); await review(other);
    await expect(fulfill(other)).rejects.toThrow(/already belongs/);
    expect((await db.query<Row>('select status from public.rl_purchase_requests where id=$1', [other])).rows[0].status).toBe('approved');
  });
  it('rejects manager self-purchases, changed identity, and suspended applications', async () => {
    await expect(create(requestId, 0)).rejects.toThrow(/own fund/);
    await create(); await attach();
    await db.query(`insert into public.rl_applications(user_id,wallet,kind,display_name,contact_email,contact_phone,status,details)
      values($1,$2,'investor','Test Investor','test@example.test','DEMO','suspended','{"country":"Test"}'::jsonb)`, [ids[1], wallets[1]]);
    await expect(submit()).rejects.toThrow(/must be approved/);
    await db.query('delete from public.rl_applications where user_id=$1', [ids[1]]);
    await db.query("insert into auth.identities values($1,'email','linked')", [ids[1]]);
    try { await expect(submit()).rejects.toThrow(/identity changed/); }
    finally { await db.query("delete from auth.identities where provider='email'"); }
  });
  it('bounds open drafts and rejects numeric/version/contract tampering', async () => {
    for (const units of ['0','1.5','01','-1','1e3','100\n',' 100','10000000000000',String(2n ** 256n)]) {
      await expect(create(requestId, 1, units)).rejects.toThrow(/whole RLU quantity/);
    }
    for (let i = 0; i < 20; i++) await create(`30000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    await expect(create('30000000-0000-0000-0000-000000000099')).rejects.toThrow(/20 open/);
    await expect(db.query('update public.rl_purchase_requests set chain_id=1 where id=$1', [requestId])).rejects.toThrow(/check constraint/);
  });
  it('retires the independently chosen payment API and advertises only fixed pricing', async () => {
    for (const cents of ['100','10000','100000']) {
      await expect(db.query('select public.rl_purchase_create($1,$2,$3,$4,$5,$6)', [requestId, ids[1], wallets[1], '100', cents, ''])).rejects.toThrow(/client is outdated/);
    }
    expect((await db.query('select public.rl_purchase_pricing() as pricing')).rows).toEqual([{ pricing: {
      pricing_basis: 'rlu_sgd_1_v1', unit_price_cents: '100', currency: 'SGD', max_units: '9999999999999',
    } }]);
    expect((await db.query('select * from public.rl_purchase_requests')).rows).toHaveLength(0);
  });
  it('enforces fixed pricing on direct inserts and makes quantities and prices immutable', async () => {
    await create();
    for (const statement of ["units='101'", "amount_cents='100'", "pricing_basis='legacy_reported'", "units='101',amount_cents='10100'"]) {
      await expect(db.query(`update public.rl_purchase_requests set ${statement} where id=$1`, [requestId])).rejects.toThrow(/cannot be changed/);
    }
    await expect(db.query("insert into public.rl_purchase_requests(id,owner_id,wallet,units,amount_cents) values(gen_random_uuid(),$1,$2,'100','100')", [ids[1],wallets[1]])).rejects.toThrow(/rl_purchase_fixed_amount/);
    await expect(db.query("insert into public.rl_purchase_requests(id,owner_id,wallet,units,amount_cents,pricing_basis) values(gen_random_uuid(),$1,$2,'100','10000','legacy_reported')", [ids[1],wallets[1]])).rejects.toThrow(/require fixed RLU pricing/);
    expect((await db.query<Row>('select * from public.rl_purchase_requests where id=$1', [requestId])).rows[0]).toMatchObject({units:'100',amount_cents:'10000',pricing_basis:'rlu_sgd_1_v1'});
  });
  it('keeps normal draft and approved review rules while rejecting stale manager actions', async () => {
    await create();
    await expect(review(requestId, 'rejected', 1)).rejects.toThrow(/already reviewed/);
    await attach(); await submit(); await review();
    await expect(review(requestId, 'rejected', 4)).rejects.toThrow(/already reviewed/);
  });
  it('preserves existing requests during upgrade, blocks inconsistent amounts and permits safe closure', async () => {
    const legacy = await initializeDatabase(false);
    try {
      await legacy.query('update public.rl_config set manager_wallet=$1', [wallets[0]]);
      for (let i = 0; i < ids.length; i++) await legacy.query('insert into public.rl_profiles(user_id,wallet) values($1,$2)', [ids[i],wallets[i]]);
      const states = ['draft','draft-proof','pending','approved','fulfilled','matching-pending'] as const;
      const requestIds = states.map((_, i) => `30000000-0000-0000-0000-${String(i + 10).padStart(12,'0')}`);
      const proofIds = states.map((_, i) => `40000000-0000-0000-0000-${String(i + 10).padStart(12,'0')}`);
      for (let i = 0; i < states.length; i++) {
        await legacy.query('select public.rl_purchase_create($1,$2,$3,$4,$5,$6)', [requestIds[i],ids[1],wallets[1],'100',i===5?'10000':'100000','']);
        if (i === 0) continue;
        await legacy.query('select public.rl_purchase_attach_proof($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [requestIds[i],1,ids[1],wallets[1],proofIds[i],'old-proof.pdf',`${ids[1]}/${proofIds[i]}.pdf`,100,'b'.repeat(64)]);
        if (i === 1) continue;
        await legacy.query('select public.rl_purchase_submit($1,$2,$3,$4)', [requestIds[i],2,ids[1],wallets[1]]);
        if (i === 3 || i === 4) await legacy.query('select public.rl_purchase_review($1,$2,$3,$4,$5)', [requestIds[i],3,ids[0],'approved','Earlier approval']);
        if (i === 4) await legacy.query('select public.rl_purchase_fulfill($1,$2,$3,$4)', [requestIds[i],4,ids[0],tx]);
      }
      const before = (await legacy.query('select * from public.rl_purchase_requests order by id')).rows;
      const proofBefore = (await legacy.query('select * from public.rl_purchase_proofs order by id')).rows;
      const auditBefore = (await legacy.query('select * from public.rl_purchase_audit order by id')).rows;
      await legacy.exec(readFileSync(new URL('../../supabase/migrations/202611090002_purchase_pricing.sql', import.meta.url), 'utf8'));
      const upgraded = (await legacy.query<Row>('select * from public.rl_purchase_requests order by id')).rows;
      expect(upgraded.every(row => row.pricing_basis === 'legacy_reported')).toBe(true);
      expect(upgraded.map(({pricing_basis: _basis,...rest}) => rest)).toEqual(before);
      expect((await legacy.query('select * from public.rl_purchase_proofs order by id')).rows).toEqual(proofBefore);
      expect((await legacy.query('select * from public.rl_purchase_audit order by id')).rows).toEqual(auditBefore);

      await expect(legacy.query('select public.rl_purchase_attach_proof($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [requestIds[0],1,ids[1],wallets[1],proofIds[0],'new-proof.pdf',`${ids[1]}/${proofIds[0]}.pdf`,100,'b'.repeat(64)])).rejects.toThrow(/different payment amount/);
      await expect(legacy.query('select public.rl_purchase_submit($1,$2,$3,$4)', [requestIds[1],2,ids[1],wallets[1]])).rejects.toThrow(/different payment amount/);
      await expect(legacy.query('select public.rl_purchase_review($1,$2,$3,$4,$5)', [requestIds[2],3,ids[0],'approved','Review'])).rejects.toThrow(/different payment amount/);
      await expect(legacy.query('select public.rl_purchase_fulfill($1,$2,$3,$4)', [requestIds[3],4,ids[0],'0x'+'b'.repeat(64)])).rejects.toThrow(/different payment amount/);
      await expect(legacy.query('select public.rl_purchase_create_priced($1,$2,$3,$4,$5)', [requestIds[0],ids[1],wallets[1],'100',''])).rejects.toThrow(/different payment amount/);
      await expect(legacy.query("update public.rl_purchase_requests set amount_cents='10000' where id=$1", [requestIds[0]])).rejects.toThrow(/cannot be changed/);

      // Already fulfilled history remains idempotent even if its old amount differs.
      expect((await legacy.query<Row>('select * from public.rl_purchase_fulfill($1,$2,$3,$4)', [requestIds[4],4,ids[0],tx])).rows[0]).toMatchObject({status:'fulfilled',version:5,amount_cents:'100000'});
      expect((await legacy.query('select * from public.rl_purchase_audit order by id')).rows).toEqual(auditBefore);
      for (let i = 0; i < 4; i++) {
        const current = upgraded[i];
        await expect(legacy.query('select public.rl_purchase_review($1,$2,$3,$4,$5)', [requestIds[i],current.version,ids[1],'rejected','Close inconsistent request'])).rejects.toThrow(/Manager required/);
        await expect(legacy.query('select public.rl_purchase_review($1,$2,$3,$4,$5)', [requestIds[i],current.version+1,ids[0],'rejected','Close inconsistent request'])).rejects.toThrow(/changed/);
        const closed = (await legacy.query<Row>('select * from public.rl_purchase_review($1,$2,$3,$4,$5)', [requestIds[i],current.version,ids[0],'rejected','Close inconsistent request'])).rows[0];
        expect(closed).toMatchObject({status:'rejected',amount_cents:'100000',pricing_basis:'legacy_reported',submitted_at:current.submitted_at,version:current.version+1});
        await expect(legacy.query('select public.rl_purchase_review($1,$2,$3,$4,$5)', [requestIds[i],closed.version,ids[0],'rejected','Retry'])).rejects.toThrow(/already reviewed/);
      }
      expect((await legacy.query('select * from public.rl_purchase_proofs order by id')).rows).toEqual(proofBefore);

      // Matching earlier requests retain their original basis but can complete.
      const recovered = (await legacy.query<Row>('select * from public.rl_purchase_create_priced($1,$2,$3,$4,$5)', [requestIds[5],ids[1],wallets[1],'100',''])).rows[0];
      expect(recovered).toMatchObject({status:'pending',version:3,pricing_basis:'legacy_reported',amount_cents:'10000'});
      await legacy.query('select public.rl_purchase_review($1,$2,$3,$4,$5)', [requestIds[5],3,ids[0],'approved','Payment matches required total']);
      expect((await legacy.query<Row>('select * from public.rl_purchase_fulfill($1,$2,$3,$4)', [requestIds[5],4,ids[0],'0x'+'c'.repeat(64)])).rows[0]).toMatchObject({status:'fulfilled',pricing_basis:'legacy_reported',amount_cents:'10000'});
      expect((await legacy.query("select action from public.rl_purchase_audit where action='rejected'")).rows).toHaveLength(4);
    } finally { await legacy.close(); }
  }, 30000);
});

describe('purchase RLS, grants and storage restrictions', () => {
  it('shows requests and proofs only to their verified owner and manager', async () => {
    await pending();
    expect((await asUser(1, () => db.query('select * from public.rl_purchase_requests'))).rows).toHaveLength(1);
    expect((await asUser(0, () => db.query('select * from public.rl_purchase_proofs'))).rows).toHaveLength(1);
    expect((await asUser(2, () => db.query('select * from public.rl_purchase_requests'))).rows).toHaveLength(0);
    expect((await asUser(2, () => db.query('select * from public.rl_purchase_proofs'))).rows).toHaveLength(0);
    expect((await asUser(1, () => db.query('select * from public.rl_purchase_audit'))).rows).toHaveLength(0);
    await db.exec('set role anon');
    await expect(db.query('select * from public.rl_purchase_requests')).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
  });
  it('denies direct table writes and forged service RPCs even with a manager wallet session', async () => {
    await pending();
    for (const i of [0, 1, 2]) {
      await expect(asUser(i, () => db.query("update public.rl_purchase_requests set status='approved'"))).rejects.toThrow(/permission denied/);
      await expect(asUser(i, () => review())).rejects.toThrow(/permission denied/);
      await expect(asUser(i, () => attach())).rejects.toThrow(/permission denied/);
      await expect(asUser(i, () => create())).rejects.toThrow(/permission denied/);
      await expect(asUser(i, () => fulfill())).rejects.toThrow(/permission denied/);
      await expect(asUser(i, () => db.query('select public.rl_purchase_pricing()'))).rejects.toThrow(/permission denied/);
      await expect(asUser(i, () => db.query("select public.rl_purchase_require_pricing('1','100')"))).rejects.toThrow(/permission denied/);
      await expect(asUser(i, () => db.query('select public.rl_purchase_create($1,$2,$3,$4,$5,$6)', [requestId,ids[1],wallets[1],'100','10000','']))).rejects.toThrow(/permission denied/);
    }
    await db.exec('set role service_role');
    try {
      expect((await db.query('select public.rl_purchase_pricing() as pricing')).rows).toHaveLength(1);
      expect(await create('30000000-0000-0000-0000-000000000002',2,'1')).toMatchObject({amount_cents:'100',pricing_basis:'rlu_sgd_1_v1'});
    }
    finally { await db.exec('reset role'); }
  });
  it('keeps proof objects private and immutable even with legacy broad storage policies', async () => {
    await pending();
    const path = `${ids[1]}/${proofId}.pdf`;
    await db.query("insert into storage.objects(bucket_id,name) values('receivledger-payment-proofs',$1),('receivledger-payment-proofs','orphan.pdf')", [path]);
    expect((await asUser(1, () => db.query('select * from storage.objects'))).rows).toHaveLength(1);
    expect((await asUser(0, () => db.query('select * from storage.objects'))).rows).toHaveLength(1);
    expect((await asUser(2, () => db.query('select * from storage.objects'))).rows).toHaveLength(0);
    for (const i of [0, 1, 2]) {
      expect((await asUser(i, () => db.query('delete from storage.objects returning id'))).rows).toHaveLength(0);
      await expect(asUser(i, () => db.query("insert into storage.objects(bucket_id,name) values('receivledger-payment-proofs','bypass.pdf')"))).rejects.toThrow(/row-level security/);
    }
    expect((await asUser(1, () => db.query("update storage.objects set name='replacement.pdf' where name=$1 returning id", [path]))).rows).toHaveLength(0);
    expect((await asUser(1, () => db.query("update storage.objects set bucket_id='public-uploads',name='leaked.pdf' where name=$1 returning id", [path]))).rows).toHaveLength(0);
    expect((await db.query('select name,bucket_id from storage.objects where name=$1', [path])).rows).toEqual([{name: path, bucket_id: 'receivledger-payment-proofs'}]);
  });
  it('revoked sessions and changed wallet identities lose access to existing proof', async () => {
    await pending();
    await db.query('delete from auth.sessions where id=$1', [sessions[1]]);
    try { expect((await asUser(1, () => db.query('select * from public.rl_purchase_proofs'))).rows).toHaveLength(0); }
    finally { await db.query('insert into auth.sessions values($1,$2)', [sessions[1], ids[1]]); }
    await db.query("update auth.identities set provider_id=$1 where user_id=$2", [`web3:ethereum:${wallets[2]}`, ids[1]]);
    try { expect((await asUser(1, () => db.query('select * from public.rl_purchase_requests'))).rows).toHaveLength(0); }
    finally { await db.query('update auth.identities set provider_id=$1 where user_id=$2', [`web3:ethereum:${wallets[1]}`, ids[1]]); }
  });
});
