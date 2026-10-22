-- Phase 5B. Apply after 001 and 002, only after explicit hosted approval.
begin;
alter table public.rl_applications add column details jsonb not null default '{}'::jsonb
  check (jsonb_typeof(details) = 'object');
alter table public.rl_applications add column submitted_at timestamptz;
update public.rl_applications set submitted_at=created_at;
alter table public.rl_applications alter column submitted_at set default now();
alter table public.rl_applications alter column submitted_at set not null;
alter table public.rl_applications drop constraint rl_applications_status_check;
alter table public.rl_applications add constraint rl_applications_status_check
  check(status in ('pending','needs_info','approved','rejected','suspended','revoked'));

-- Remove the old submission overload so it cannot bypass the new validations.
drop function public.rl_submit_application(text,text,text,text,text);
create function public.rl_submit_application(p_kind text,p_name text,p_company text,p_email text,p_phone text,p_details jsonb)
returns public.rl_applications language plpgsql security definer set search_path = '' as $$
declare profile public.rl_profiles; result public.rl_applications; k text;
begin
  profile := public.rl_ensure_profile();
  if public.rl_is_manager() then raise exception 'The manager cannot apply to their own fund'; end if;
  if p_kind is null or p_kind not in ('investor','sme') or p_phone is null or length(trim(p_phone)) < 2
    or p_details is null or jsonb_typeof(p_details) <> 'object' then raise exception 'Complete fictional registration details required'; end if;
  for k in select jsonb_object_keys(p_details) loop
    if k not in ('country','website','business_address','contact_name') or jsonb_typeof(p_details->k) <> 'string' then
      raise exception 'Invalid registration details';
    end if;
  end loop;
  if length(coalesce(p_details->>'country','')) > 100 or length(coalesce(p_details->>'website','')) > 300
    or length(coalesce(p_details->>'business_address','')) > 500 or length(coalesce(p_details->>'contact_name','')) > 100 then
    raise exception 'Registration details too long';
  end if;
  if p_kind='investor' and length(trim(coalesce(p_details->>'country',''))) < 2 then raise exception 'Country of residence required'; end if;
  if p_kind='sme' and (length(trim(coalesce(p_details->>'business_address',''))) < 2
    or length(trim(coalesce(p_details->>'contact_name',''))) < 2) then raise exception 'Business address and contact person required'; end if;
  if coalesce(p_details->>'website','') <> '' and (p_details->>'website' !~ '^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$'
    or p_details->>'website' ~ '^https://[^/]*@') then raise exception 'Use an HTTPS company website without credentials'; end if;
  insert into public.rl_applications(user_id,wallet,kind,display_name,company_number,contact_email,contact_phone,details)
    values(profile.user_id,profile.wallet,p_kind,trim(p_name),trim(p_company),trim(p_email),trim(p_phone),p_details)
  on conflict(user_id) do update set display_name=excluded.display_name,company_number=excluded.company_number,
    contact_email=excluded.contact_email,contact_phone=excluded.contact_phone,details=excluded.details,status='pending',
    version=public.rl_applications.version+1,review_note=null,reviewed_by=null,reviewed_at=null,approval_tx_hash=null,
    updated_at=now(),submitted_at=now()
  where public.rl_applications.status in ('pending','rejected','needs_info') and public.rl_applications.kind=excluded.kind
  returning * into result;
  if result.id is null then raise exception 'Approved or restricted applications cannot be edited and the application type cannot be changed'; end if;
  return result;
end; $$;
revoke all on function public.rl_submit_application(text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.rl_submit_application(text,text,text,text,text,jsonb) to authenticated,service_role;

create or replace function public.rl_review_application(p_id uuid,p_version integer,p_actor uuid,p_decision text,p_note text,p_tx text)
returns public.rl_applications language plpgsql security definer set search_path = '' as $$
declare result public.rl_applications;
begin
  if not exists(select 1 from public.rl_profiles p join public.rl_config c on c.manager_wallet=p.wallet where p.user_id=p_actor) then raise exception 'Manager required'; end if;
  if p_note is null or length(trim(p_note)) not between 1 and 2000 then raise exception 'Review note required'; end if;
  select * into result from public.rl_applications where id=p_id for update;
  if result.id is null or result.version <> p_version or p_version is null then raise exception 'Application changed or was already reviewed'; end if;
  if result.user_id=p_actor then raise exception 'Self review is not permitted'; end if;
  if p_decision is null or not (
    (result.status='pending' and p_decision in ('approved','rejected','needs_info')) or
    (result.status='approved' and p_decision in ('suspended','revoked')) or
    (result.status='suspended' and p_decision in ('needs_info','revoked'))
  ) then raise exception 'Application changed or transition is not permitted'; end if;
  if p_decision='approved' and not exists(select 1 from public.rl_documents d
    where d.application_id=p_id and d.owner_id=result.user_id and d.status='verified' and d.purpose='kyc') then
    raise exception 'Verify fictional KYC before approval';
  end if;
  update public.rl_applications set status=p_decision,review_note=trim(p_note),
    approval_tx_hash=case when p_decision='approved' then p_tx else approval_tx_hash end,
    reviewed_by=p_actor,reviewed_at=now(),updated_at=now(),version=version+1
    where id=p_id returning * into result;
  insert into public.rl_review_audit(actor_id,record_id,record_type,decision,note,tx_hash)
    values(p_actor,p_id,'application',p_decision,trim(p_note),p_tx);
  return result;
end; $$;
-- CREATE OR REPLACE preserves the original service-only EXECUTE grants.
commit;
