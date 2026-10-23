-- LOCAL V2 ACTIVATION DRAFT. Not in migrations/: never applied by the existing V1 deployment.
-- Requires the existing authenticated rl_current_wallet()/rl_profiles helpers. No V1 objects changed.
begin;
create table public.rl2_identities (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('investor','sme')),
  canonical_digest text not null check(canonical_digest ~ '^[a-f0-9]{64}$'),
  entity text not null unique default ('0x'||replace(gen_random_uuid()::text,'-','')||repeat('0',32)),
  unique(kind,canonical_digest)
);
create table public.rl2_applications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  wallet text not null check(wallet ~ '^0x[a-f0-9]{40}$'),
  kind text not null check(kind in ('investor','sme')),
  identity_id uuid references public.rl2_identities(id),
  status integer not null default 0 check(status between 0 and 5),
  details jsonb not null check(jsonb_typeof(details)='object' and octet_length(details::text)<=16000),
  version integer not null default 1, note text not null default '', tx_hash text,
  updated_at timestamptz not null default now(), unique(user_id,kind), unique(wallet,kind)
);
create table public.rl2_review_audit (
  id bigint generated always as identity primary key, application_id uuid not null references public.rl2_applications(id),
  actor uuid not null references auth.users(id), status integer, note text not null, tx_hash text, created_at timestamptz not null default now()
);
alter table public.rl2_identities enable row level security;
alter table public.rl2_applications enable row level security;
alter table public.rl2_review_audit enable row level security;
revoke all on public.rl2_identities,public.rl2_applications,public.rl2_review_audit from public,anon,authenticated;
grant select on public.rl2_applications to authenticated;
grant all on public.rl2_identities,public.rl2_applications,public.rl2_review_audit to service_role;
grant usage,select on sequence public.rl2_review_audit_id_seq to service_role;
create policy rl2_own_application on public.rl2_applications for select to authenticated
  using(user_id=auth.uid() and wallet=public.rl_current_wallet());

create function public.rl2_submit_application(p_kind text,p_details jsonb,p_version integer default null)
returns public.rl2_applications language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.rl2_applications; w text:=public.rl_current_wallet();
begin
  if auth.uid() is null or w is null then raise exception 'Verified wallet session required'; end if;
  if p_kind not in ('investor','sme') or jsonb_typeof(p_details) is distinct from 'object' or octet_length(p_details::text)>16000
     or length(trim(coalesce(p_details->>'display_name','')))<2 then raise exception 'Valid fictional registration details required'; end if;
  select * into a from public.rl2_applications where user_id=auth.uid() and kind=p_kind for update;
  if found then
    if a.wallet<>w or a.status<>1 or a.version is distinct from p_version then raise exception 'Only requested information may be updated at the current version'; end if;
    update public.rl2_applications set details=p_details,version=version+1,updated_at=now() where id=a.id returning * into a;
  else
    insert into public.rl2_applications(user_id,wallet,kind,details) values(auth.uid(),w,p_kind,p_details) returning * into a;
  end if;
  return a;
end $$;
revoke all on function public.rl2_submit_application(text,jsonb,integer) from public,anon;
grant execute on function public.rl2_submit_application(text,jsonb,integer) to authenticated;

create function public.rl2_bind_identity(p_id uuid,p_version integer,p_canonical_digest text,p_actor uuid)
returns public.rl2_applications language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.rl2_applications; identity_key uuid;
begin
  select * into strict a from public.rl2_applications where id=p_id for update;
  if a.user_id=p_actor or a.wallet=(select wallet from public.rl_profiles where user_id=p_actor) then raise exception 'Self review forbidden'; end if;
  if a.version is distinct from p_version or a.identity_id is not null then raise exception 'Stale or permanently bound identity'; end if;
  insert into public.rl2_identities(kind,canonical_digest) values(a.kind,p_canonical_digest)
    on conflict(kind,canonical_digest) do update set canonical_digest=excluded.canonical_digest returning id into identity_key;
  update public.rl2_applications set identity_id=identity_key,version=version+1,updated_at=now() where id=p_id returning * into a;
  insert into public.rl2_review_audit(application_id,actor,note) values(p_id,p_actor,'Canonical identity bound');
  return a;
end $$;
create function public.rl2_review_application(p_id uuid,p_version integer,p_actor uuid,p_status integer,p_note text,p_tx text)
returns public.rl2_applications language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.rl2_applications;
begin
  select * into strict a from public.rl2_applications where id=p_id for update;
  if a.user_id=p_actor or a.wallet=(select wallet from public.rl_profiles where user_id=p_actor) then raise exception 'Self review forbidden'; end if;
  if a.version is distinct from p_version or p_status not between 0 and 5 or length(trim(p_note)) not between 1 and 500 then raise exception 'Current version and review note required'; end if;
  if p_status=3 and a.identity_id is null then raise exception 'Canonical identity required'; end if;
  if a.identity_id is not null and (p_tx is null or p_tx !~ '^0x[a-fA-F0-9]{64}$') then raise exception 'Verified permission receipt required'; end if;
  update public.rl2_applications set status=p_status,note=p_note,tx_hash=p_tx,version=version+1,updated_at=now() where id=p_id returning * into a;
  -- Entity-wide on-chain status transitions also affect every linked application.
  update public.rl2_applications set status=p_status,note=p_note,tx_hash=p_tx,version=version+1,updated_at=now()
    where id<>p_id and identity_id=a.identity_id;
  insert into public.rl2_review_audit(application_id,actor,status,note,tx_hash) values(p_id,p_actor,p_status,p_note,p_tx);
  return a;
end $$;
revoke all on function public.rl2_bind_identity(uuid,integer,text,uuid),public.rl2_review_application(uuid,integer,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.rl2_bind_identity(uuid,integer,text,uuid),public.rl2_review_application(uuid,integer,uuid,integer,text,text) to service_role;
commit;
