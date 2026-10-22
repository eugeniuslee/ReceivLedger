-- Reviewed, additive Batch 2 migration. Run only against the approved project.
begin;

create table public.rl_config (
  singleton boolean primary key default true check (singleton),
  manager_wallet text check (manager_wallet ~ '^0x[0-9a-f]{40}$')
);
insert into public.rl_config(singleton) values (true);

-- Use the server-controlled provider identifier, never editable user_metadata.
-- Fail closed for linked/ambiguous identities or revoked Supabase sessions.
create function public.rl_current_wallet() returns text
language sql stable security definer set search_path = '' as $$
  select case when count(*) = 1 then min(lower(substring(i.provider_id from '^web3:ethereum:(0x[0-9a-fA-F]{40})$'))) end
  from auth.identities i
  where i.user_id = auth.uid() and i.provider = 'web3'
    and i.provider_id ~ '^web3:ethereum:0x[0-9a-fA-F]{40}$'
    and (select count(*) from auth.identities linked where linked.user_id=auth.uid()) = 1
    and exists (select 1 from auth.sessions s where s.user_id = auth.uid()
      and s.id::text = auth.jwt()->>'session_id'
      and exists(select 1 from auth.mfa_amr_claims amr where amr.session_id=s.id and amr.authentication_method='web3'));
$$;

create function public.rl_is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.manager_wallet = public.rl_current_wallet() from public.rl_config c where singleton), false);
$$;

create table public.rl_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  wallet text not null unique check (wallet ~ '^0x[0-9a-f]{40}$'),
  created_at timestamptz not null default now()
);
create table public.rl_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.rl_profiles(user_id),
  wallet text not null references public.rl_profiles(wallet),
  kind text not null check (kind in ('investor','sme')),
  display_name text not null check (length(trim(display_name)) between 2 and 100),
  company_number text not null default '' check (length(company_number) <= 60),
  contact_email text not null check (length(contact_email) <= 254 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  contact_phone text not null default '' check (length(contact_phone) <= 40),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  version integer not null default 1 check (version > 0),
  review_note text check (length(review_note) <= 2000),
  reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
  approval_tx_hash text check (approval_tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (kind <> 'sme' or length(trim(company_number)) > 0),
  check (status <> 'approved' or kind <> 'investor' or approval_tx_hash is not null)
);
create table public.rl_documents (
  id uuid primary key, owner_id uuid not null references public.rl_profiles(user_id),
  application_id uuid references public.rl_applications(id),
  invoice_id text check (invoice_id ~ '^[1-9][0-9]{0,76}$'),
  purpose text not null check (purpose in ('kyc','invoice')),
  filename text not null check (length(filename) between 1 and 160),
  storage_path text not null unique,
  byte_size integer not null check (byte_size between 1 and 5242880),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  version integer not null default 1 check (version > 0),
  review_note text check (length(review_note) <= 2000), reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (storage_path = owner_id::text || '/' || id::text || '.pdf'),
  check ((purpose = 'kyc' and application_id is not null and invoice_id is null)
    or (purpose = 'invoice' and application_id is null and invoice_id is not null))
);
create index on public.rl_documents(owner_id);
create index on public.rl_documents(application_id);
create index on public.rl_applications(status);
create table public.rl_review_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id), record_id uuid not null,
  record_type text not null check (record_type in ('application','document')),
  decision text not null, note text not null, tx_hash text, created_at timestamptz not null default now()
);

alter table public.rl_config enable row level security;
alter table public.rl_profiles enable row level security;
alter table public.rl_applications enable row level security;
alter table public.rl_documents enable row level security;
alter table public.rl_review_audit enable row level security;

create policy profiles_read on public.rl_profiles for select to authenticated using (
  public.rl_current_wallet() is not null and ((user_id = auth.uid() and wallet = public.rl_current_wallet()) or public.rl_is_manager()));
create policy applications_read on public.rl_applications for select to authenticated using (
  public.rl_current_wallet() is not null and ((user_id = auth.uid() and wallet = public.rl_current_wallet()) or public.rl_is_manager()));
create policy documents_read on public.rl_documents for select to authenticated using (
  public.rl_current_wallet() is not null and ((owner_id = auth.uid() and exists(
    select 1 from public.rl_profiles p where p.user_id=auth.uid() and p.wallet=public.rl_current_wallet()
  )) or public.rl_is_manager()));
create policy audit_read on public.rl_review_audit for select to authenticated using (public.rl_is_manager());

revoke all on public.rl_config, public.rl_profiles, public.rl_applications, public.rl_documents, public.rl_review_audit from anon, authenticated;
grant select on public.rl_profiles, public.rl_applications, public.rl_documents, public.rl_review_audit to authenticated;
grant all on public.rl_config, public.rl_profiles, public.rl_applications, public.rl_documents, public.rl_review_audit to service_role;
grant usage, select on sequence public.rl_review_audit_id_seq to service_role;

create function public.rl_ensure_profile() returns public.rl_profiles
language plpgsql security definer set search_path = '' as $$
declare w text := public.rl_current_wallet(); result public.rl_profiles;
begin
  if w is null then raise exception 'Verified Ethereum session required'; end if;
  insert into public.rl_profiles(user_id,wallet) values(auth.uid(),w) on conflict(user_id) do nothing;
  select * into strict result from public.rl_profiles where user_id = auth.uid() and wallet = w;
  return result;
end; $$;

create function public.rl_submit_application(p_kind text, p_name text, p_company text, p_email text, p_phone text)
returns public.rl_applications language plpgsql security definer set search_path = '' as $$
declare profile public.rl_profiles; result public.rl_applications;
begin
  profile := public.rl_ensure_profile();
  if public.rl_is_manager() then raise exception 'The manager cannot apply to their own fund'; end if;
  insert into public.rl_applications(user_id,wallet,kind,display_name,company_number,contact_email,contact_phone)
    values(profile.user_id,profile.wallet,p_kind,trim(p_name),trim(p_company),trim(p_email),trim(p_phone))
  on conflict(user_id) do update set display_name=excluded.display_name,company_number=excluded.company_number,
    contact_email=excluded.contact_email,contact_phone=excluded.contact_phone,status='pending',
    version=public.rl_applications.version+1,review_note=null,reviewed_by=null,reviewed_at=null,
    approval_tx_hash=null,updated_at=now()
  where public.rl_applications.status in ('pending','rejected') and public.rl_applications.kind=excluded.kind
  returning * into result;
  if result.id is null then raise exception 'Approved applications cannot be edited and the application type cannot be changed'; end if;
  return result;
end; $$;

-- Only intentionally shared display names; no contact/company registration data.
create function public.rl_directory() returns table(wallet text, display_name text, kind text)
language sql stable security definer set search_path = '' as $$
  select a.wallet,a.display_name,a.kind from public.rl_applications a
  where a.status='approved' and public.rl_current_wallet() is not null;
$$;

-- Service-only operations. The Edge Function verifies manager identity and chain
-- receipts before calling these; clients have neither write grants nor EXECUTE.
create function public.rl_review_application(p_id uuid,p_version integer,p_actor uuid,p_decision text,p_note text,p_tx text)
returns public.rl_applications language plpgsql security definer set search_path = '' as $$
declare result public.rl_applications;
begin
  if not exists(select 1 from public.rl_profiles p join public.rl_config c on c.manager_wallet=p.wallet where p.user_id=p_actor) then raise exception 'Manager required'; end if;
  if p_decision not in ('approved','rejected') or p_note is null or length(trim(p_note)) not between 1 and 2000 then raise exception 'Decision and review note required'; end if;
  update public.rl_applications set status=p_decision,review_note=trim(p_note),approval_tx_hash=p_tx,
    reviewed_by=p_actor,reviewed_at=now(),updated_at=now(),version=version+1
    where id=p_id and version=p_version and status='pending' returning * into result;
  if result.id is null then raise exception 'Application changed or was already reviewed'; end if;
  if p_decision='approved' and not exists(select 1 from public.rl_documents d where d.application_id=p_id and d.status='verified' and d.purpose='kyc') then raise exception 'Verify fictional KYC before approval'; end if;
  insert into public.rl_review_audit(actor_id,record_id,record_type,decision,note,tx_hash) values(p_actor,p_id,'application',p_decision,trim(p_note),p_tx);
  return result;
end; $$;

create function public.rl_review_document(p_id uuid,p_version integer,p_actor uuid,p_decision text,p_note text)
returns public.rl_documents language plpgsql security definer set search_path = '' as $$
declare result public.rl_documents;
begin
  if not exists(select 1 from public.rl_profiles p join public.rl_config c on c.manager_wallet=p.wallet where p.user_id=p_actor) then raise exception 'Manager required'; end if;
  if p_decision not in ('verified','rejected') or p_note is null or length(trim(p_note)) not between 1 and 2000 then raise exception 'Decision and review note required'; end if;
  update public.rl_documents set status=p_decision,review_note=trim(p_note),reviewed_by=p_actor,reviewed_at=now(),version=version+1
    where id=p_id and version=p_version and status='pending' returning * into result;
  if result.id is null then raise exception 'Document changed or was already reviewed'; end if;
  insert into public.rl_review_audit(actor_id,record_id,record_type,decision,note) values(p_actor,p_id,'document',p_decision,trim(p_note));
  return result;
end; $$;

revoke all on function public.rl_current_wallet(),public.rl_is_manager(),public.rl_ensure_profile(),public.rl_submit_application(text,text,text,text,text),public.rl_directory(),public.rl_review_application(uuid,integer,uuid,text,text,text),public.rl_review_document(uuid,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function public.rl_current_wallet(),public.rl_is_manager(),public.rl_ensure_profile(),public.rl_submit_application(text,text,text,text,text),public.rl_directory() to authenticated,service_role;
grant execute on function public.rl_review_application(uuid,integer,uuid,text,text,text),public.rl_review_document(uuid,integer,uuid,text,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('receiveledger-documents','receiveledger-documents',false,5242880,array['application/pdf']);

-- No client INSERT/UPDATE/DELETE policies: every upload must pass the Edge PDF
-- parser, owner checks and chain checks. No public download links are used.
create policy rl_private_document_read on storage.objects for select to authenticated using (
  bucket_id='receiveledger-documents' and public.rl_current_wallet() is not null and
  exists(select 1 from public.rl_documents d where d.storage_path=name and (d.owner_id=auth.uid() or public.rl_is_manager()))
);
-- Protect this bucket even if the project already contains broader permissive policies.
create policy rl_private_document_guard on storage.objects as restrictive for all to anon, authenticated
using (bucket_id <> 'receiveledger-documents' or (
  public.rl_current_wallet() is not null and exists(select 1 from public.rl_documents d where d.storage_path=name and (d.owner_id=auth.uid() or public.rl_is_manager()))
)) with check (bucket_id <> 'receiveledger-documents');
commit;
