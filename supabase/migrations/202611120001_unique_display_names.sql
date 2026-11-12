-- Registered names are unique across all applicants, ignoring case and surrounding spaces.
-- This migration fails if duplicate names already exist. Find them first with:
--   select lower(btrim(display_name)) as name, count(*) from public.rl_applications group by 1 having count(*) > 1;
create unique index rl_applications_display_name_unique on public.rl_applications (lower(btrim(display_name)));

-- Service-only: the Edge Function authenticates the wallet session, then renames the caller's own application.
-- Renaming bumps the version so an in-progress manager review of the old details fails safely.
create function public.rl_rename_application(p_user uuid, p_name text)
returns public.rl_applications language plpgsql security definer set search_path = '' as $$
declare result public.rl_applications; v_name text := btrim(coalesce(p_name, ''));
begin
  if length(v_name) not between 2 and 100 then raise exception 'Enter a name with 2 to 100 characters.'; end if;
  if exists (select 1 from public.rl_applications a where lower(btrim(a.display_name)) = lower(v_name) and a.user_id <> p_user) then
    raise exception 'That name is already used. Choose a different name.';
  end if;
  update public.rl_applications set display_name = v_name, version = version + 1, updated_at = now()
    where user_id = p_user returning * into result;
  if result.id is null then raise exception 'Submit an application before choosing a registered name.'; end if;
  return result;
exception when unique_violation then
  raise exception 'That name is already used. Choose a different name.';
end; $$;

revoke all on function public.rl_rename_application(uuid,text) from public,anon,authenticated;
grant execute on function public.rl_rename_application(uuid,text) to service_role;
