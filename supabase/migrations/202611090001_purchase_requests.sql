-- Additive private RLU purchase requests. Apply with the matching registry function.
-- Review/approval does not certify a bank payment and does not issue tokens.
begin;

create table public.rl_purchase_requests (
  id uuid primary key,
  owner_id uuid not null references public.rl_profiles(user_id),
  wallet text not null references public.rl_profiles(wallet),
  chain_id integer not null default 11155111 check (chain_id = 11155111),
  contract_address text not null default '0x18c6751a1a116053e413459464c9b1af356dbf1f'
    check (contract_address = '0x18c6751a1a116053e413459464c9b1af356dbf1f'),
  -- Text preserves exact integers across the JSON/PostgREST boundary.
  units text not null check (units ~ '^[1-9][0-9]{0,77}$' and units::numeric < 115792089237316195423570985008687907853269984665640564039457584007913129639936),
  amount_cents text not null check (amount_cents ~ '^[1-9][0-9]{0,14}$'),
  note text not null default '' check (length(note) <= 1000),
  status text not null default 'draft' check (status in ('draft','pending','approved','rejected','fulfilled')),
  version integer not null default 1 check (version > 0),
  review_note text check (length(trim(review_note)) between 1 and 2000),
  reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
  issuance_tx_hash text check (issuance_tx_hash ~ '^0x[0-9a-f]{64}$'), fulfilled_at timestamptz,
  created_at timestamptz not null default now(), submitted_at timestamptz, updated_at timestamptz not null default now(),
  unique (id,owner_id),
  check ((status = 'draft') = (submitted_at is null)),
  check ((status in ('approved','rejected','fulfilled')) = (reviewed_at is not null and reviewed_by is not null and review_note is not null)),
  check ((status = 'fulfilled') = (issuance_tx_hash is not null and fulfilled_at is not null))
);
create unique index rl_purchase_issuance_once on public.rl_purchase_requests(issuance_tx_hash) where issuance_tx_hash is not null;
create index rl_purchase_owner_created on public.rl_purchase_requests(owner_id,created_at desc);
create index rl_purchase_status_created on public.rl_purchase_requests(status,created_at desc);

create table public.rl_purchase_proofs (
  id uuid primary key,
  request_id uuid not null unique,
  owner_id uuid not null references public.rl_profiles(user_id),
  filename text not null check (length(filename) between 1 and 160),
  storage_path text not null unique,
  byte_size integer not null check (byte_size between 1 and 5242880),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  foreign key (request_id,owner_id) references public.rl_purchase_requests(id,owner_id),
  check (storage_path = owner_id::text || '/' || id::text || '.pdf')
);
create table public.rl_purchase_audit (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.rl_purchase_requests(id),
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('created','proof_attached','submitted','approved','rejected','fulfilled')),
  version integer not null,
  note text not null default '', tx_hash text, created_at timestamptz not null default now()
);

alter table public.rl_purchase_requests enable row level security;
alter table public.rl_purchase_proofs enable row level security;
alter table public.rl_purchase_audit enable row level security;
create policy rl_purchase_read on public.rl_purchase_requests for select to authenticated using (
  public.rl_current_wallet() is not null and
  ((owner_id=auth.uid() and wallet=public.rl_current_wallet()) or public.rl_is_manager())
);
create policy rl_purchase_proof_read on public.rl_purchase_proofs for select to authenticated using (
  exists(select 1 from public.rl_purchase_requests r where r.id=request_id)
);
create policy rl_purchase_audit_read on public.rl_purchase_audit for select to authenticated using (public.rl_is_manager());
revoke all on public.rl_purchase_requests,public.rl_purchase_proofs,public.rl_purchase_audit from public,anon,authenticated;
grant select on public.rl_purchase_requests,public.rl_purchase_proofs,public.rl_purchase_audit to authenticated;
grant all on public.rl_purchase_requests,public.rl_purchase_proofs,public.rl_purchase_audit to service_role;
grant usage,select on sequence public.rl_purchase_audit_id_seq to service_role;

-- Internal eligibility check. Edge also rechecks current on-chain investor approval.
create function public.rl_purchase_require_investor(p_owner uuid,p_wallet text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.rl_profiles where user_id=p_owner and wallet=p_wallet)
     or not exists(select 1 from auth.identities where user_id=p_owner and provider='web3' and lower(provider_id)='web3:ethereum:' || p_wallet)
     or (select count(*) from auth.identities where user_id=p_owner) <> 1 then
    raise exception 'Investor wallet identity changed';
  end if;
  if exists(select 1 from public.rl_config where manager_wallet=p_wallet) then raise exception 'Manager cannot buy from their own fund'; end if;
  if exists(select 1 from public.rl_applications where user_id=p_owner and (wallet<>p_wallet or kind<>'investor' or status<>'approved')) then
    raise exception 'Investor application must be approved';
  end if;
end; $$;

create function public.rl_purchase_require_manager(p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.rl_profiles p join public.rl_config c on c.manager_wallet=p.wallet
    join auth.identities i on i.user_id=p.user_id and i.provider='web3' and lower(i.provider_id)='web3:ethereum:' || p.wallet
    where p.user_id=p_actor and (select count(*) from auth.identities where user_id=p_actor)=1) then
    raise exception 'Manager required';
  end if;
end; $$;

create function public.rl_purchase_create(p_id uuid,p_actor uuid,p_wallet text,p_units text,p_amount_cents text,p_note text)
returns public.rl_purchase_requests language plpgsql security definer set search_path='' as $$
declare result public.rl_purchase_requests;
begin
  perform 1 from public.rl_profiles where user_id=p_actor and wallet=p_wallet for update;
  perform public.rl_purchase_require_investor(p_actor,p_wallet);
  select * into result from public.rl_purchase_requests where id=p_id;
  if found then
    if result.owner_id<>p_actor or result.wallet<>p_wallet or result.units<>p_units or result.amount_cents<>p_amount_cents or result.note<>trim(coalesce(p_note,'')) then
      raise exception 'This request ID was already used for different details';
    end if;
    return result;
  end if;
  if (select count(*) from public.rl_purchase_requests where owner_id=p_actor and status in ('draft','pending','approved')) >= 20 then
    raise exception 'You already have 20 open purchase requests';
  end if;
  insert into public.rl_purchase_requests(id,owner_id,wallet,units,amount_cents,note)
    values(p_id,p_actor,p_wallet,p_units,p_amount_cents,trim(coalesce(p_note,''))) returning * into result;
  insert into public.rl_purchase_audit(request_id,actor_id,action,version) values(p_id,p_actor,'created',result.version);
  return result;
end; $$;

create function public.rl_purchase_attach_proof(p_id uuid,p_version integer,p_actor uuid,p_wallet text,p_proof_id uuid,p_filename text,p_path text,p_bytes integer,p_sha256 text)
returns public.rl_purchase_requests language plpgsql security definer set search_path='' as $$
declare result public.rl_purchase_requests;
begin
  perform 1 from public.rl_profiles where user_id=p_actor and wallet=p_wallet for update;
  perform public.rl_purchase_require_investor(p_actor,p_wallet);
  select * into result from public.rl_purchase_requests where id=p_id for update;
  if p_version is null or result.id is null or result.owner_id<>p_actor or result.wallet<>p_wallet or result.status<>'draft' or result.version<>p_version then
    raise exception 'Request changed or is not your draft';
  end if;
  if exists(select 1 from public.rl_purchase_proofs where request_id=p_id) then raise exception 'A proof is already attached'; end if;
  if (select count(*) from public.rl_purchase_proofs where owner_id=p_actor) >= 200 then raise exception 'Payment proof limit reached'; end if;
  insert into public.rl_purchase_proofs(id,request_id,owner_id,filename,storage_path,byte_size,sha256)
    values(p_proof_id,p_id,p_actor,p_filename,p_path,p_bytes,p_sha256);
  update public.rl_purchase_requests set version=version+1,updated_at=now() where id=p_id returning * into result;
  insert into public.rl_purchase_audit(request_id,actor_id,action,version) values(p_id,p_actor,'proof_attached',result.version);
  return result;
end; $$;

create function public.rl_purchase_submit(p_id uuid,p_version integer,p_actor uuid,p_wallet text)
returns public.rl_purchase_requests language plpgsql security definer set search_path='' as $$
declare result public.rl_purchase_requests;
begin
  perform public.rl_purchase_require_investor(p_actor,p_wallet);
  select * into result from public.rl_purchase_requests where id=p_id for update;
  if p_version is null or result.id is null or result.owner_id<>p_actor or result.wallet<>p_wallet or result.status<>'draft' or result.version<>p_version then
    raise exception 'Request changed or is not your draft';
  end if;
  if not exists(select 1 from public.rl_purchase_proofs where request_id=p_id and owner_id=p_actor) then raise exception 'Attach payment proof before submitting'; end if;
  update public.rl_purchase_requests set status='pending',submitted_at=now(),updated_at=now(),version=version+1 where id=p_id returning * into result;
  insert into public.rl_purchase_audit(request_id,actor_id,action,version) values(p_id,p_actor,'submitted',result.version);
  return result;
end; $$;

create function public.rl_purchase_review(p_id uuid,p_version integer,p_actor uuid,p_decision text,p_note text)
returns public.rl_purchase_requests language plpgsql security definer set search_path='' as $$
declare result public.rl_purchase_requests;
begin
  perform public.rl_purchase_require_manager(p_actor);
  select * into result from public.rl_purchase_requests where id=p_id for update;
  if p_version is null or result.id is null or result.status<>'pending' or result.version<>p_version then raise exception 'Request changed or was already reviewed'; end if;
  if result.owner_id=p_actor or result.wallet=(select wallet from public.rl_profiles where user_id=p_actor) then raise exception 'Self review is not permitted'; end if;
  if p_decision not in ('approved','rejected') or p_decision is null or p_note is null or length(trim(p_note)) not between 1 and 2000 then raise exception 'Decision and review note required'; end if;
  if not exists(select 1 from public.rl_purchase_proofs where request_id=p_id) then raise exception 'Payment proof required'; end if;
  if p_decision='approved' then perform public.rl_purchase_require_investor(result.owner_id,result.wallet); end if;
  update public.rl_purchase_requests set status=p_decision,review_note=trim(p_note),reviewed_by=p_actor,
    reviewed_at=now(),updated_at=now(),version=version+1 where id=p_id returning * into result;
  insert into public.rl_purchase_audit(request_id,actor_id,action,version,note) values(p_id,p_actor,p_decision,result.version,trim(p_note));
  return result;
end; $$;

-- Service-only: Edge verifies exact receipt calldata, mint log, manager, chain,
-- contract, confirmations, recipient, units, and submission time before calling.
create function public.rl_purchase_fulfill(p_id uuid,p_version integer,p_actor uuid,p_tx text)
returns public.rl_purchase_requests language plpgsql security definer set search_path='' as $$
declare result public.rl_purchase_requests;
begin
  perform public.rl_purchase_require_manager(p_actor);
  select * into result from public.rl_purchase_requests where id=p_id for update;
  if result.id is null then raise exception 'Purchase request not found'; end if;
  if result.owner_id=p_actor or result.wallet=(select wallet from public.rl_profiles where user_id=p_actor) then raise exception 'Self review is not permitted'; end if;
  if p_tx is null or p_tx !~ '^0x[0-9a-f]{64}$' then raise exception 'Issuance transaction required'; end if;
  if result.status='fulfilled' and result.issuance_tx_hash=p_tx then return result; end if;
  if p_version is null or result.status<>'approved' or result.version<>p_version then raise exception 'Request changed or is not approved'; end if;
  perform public.rl_purchase_require_investor(result.owner_id,result.wallet);
  if exists(select 1 from public.rl_purchase_requests where issuance_tx_hash=p_tx and id<>p_id) then raise exception 'Issuance transaction already belongs to another request'; end if;
  update public.rl_purchase_requests set status='fulfilled',issuance_tx_hash=p_tx,fulfilled_at=now(),updated_at=now(),version=version+1
    where id=p_id returning * into result;
  insert into public.rl_purchase_audit(request_id,actor_id,action,version,tx_hash) values(p_id,p_actor,'fulfilled',result.version,p_tx);
  return result;
end; $$;

revoke all on function public.rl_purchase_require_investor(uuid,text),public.rl_purchase_require_manager(uuid),
  public.rl_purchase_create(uuid,uuid,text,text,text,text),public.rl_purchase_attach_proof(uuid,integer,uuid,text,uuid,text,text,integer,text),
  public.rl_purchase_submit(uuid,integer,uuid,text),public.rl_purchase_review(uuid,integer,uuid,text,text),public.rl_purchase_fulfill(uuid,integer,uuid,text)
  from public,anon,authenticated;
grant execute on function public.rl_purchase_create(uuid,uuid,text,text,text,text),
  public.rl_purchase_attach_proof(uuid,integer,uuid,text,uuid,text,text,integer,text),public.rl_purchase_submit(uuid,integer,uuid,text),
  public.rl_purchase_review(uuid,integer,uuid,text,text),public.rl_purchase_fulfill(uuid,integer,uuid,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('receivledger-payment-proofs','receivledger-payment-proofs',false,5242880,array['application/pdf']);
create policy rl_purchase_storage_read on storage.objects for select to authenticated using (
  bucket_id='receivledger-payment-proofs' and public.rl_current_wallet() is not null and
  exists(select 1 from public.rl_purchase_proofs p where p.storage_path=name)
);
-- A separate bucket and restrictive guards preserve existing document access.
create policy rl_purchase_storage_guard on storage.objects as restrictive for all to anon,authenticated
using (bucket_id<>'receivledger-payment-proofs' or (public.rl_current_wallet() is not null and
  exists(select 1 from public.rl_purchase_proofs p where p.storage_path=name)))
with check (bucket_id<>'receivledger-payment-proofs');
create policy rl_purchase_storage_delete_guard on storage.objects as restrictive for delete to anon,authenticated
using (bucket_id<>'receivledger-payment-proofs');
create policy rl_purchase_storage_update_guard on storage.objects as restrictive for update to anon,authenticated
using (bucket_id<>'receivledger-payment-proofs') with check (bucket_id<>'receivledger-payment-proofs');

commit;
