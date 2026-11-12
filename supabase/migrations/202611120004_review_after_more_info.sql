-- Let the fund manager decide an application directly from "needs_info" (more information requested):
-- once the applicant's new documents are verified, the manager can approve, reject, or ask again,
-- without waiting for the applicant to resubmit. All other rules are unchanged:
-- a verified KYC document is still required before approval, and stale versions still fail.
-- CREATE OR REPLACE keeps the existing service-only EXECUTE grants.
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
    (result.status in ('pending','needs_info') and p_decision in ('approved','rejected','needs_info')) or
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
