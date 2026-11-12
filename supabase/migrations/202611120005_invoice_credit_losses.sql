-- Bad debt: the fund manager records the credit status of a financed invoice whose SME cannot pay.
-- The ledger contract has no write-off function, so the record lives here and the website applies it to NAV.
--   impaired     recovery uncertain: NAV counts expected_recovery_bps of what is owed; interest stops at effective_at
--   written_off  final loss: NAV counts only recovered_cents (updatable as recoveries arrive)
-- No row = performing normally. Investors need losses reflected in the NAV they see, so the amounts are
-- publicly readable; they contain no personal data (invoice IDs and amounts are already public on-chain).
-- Manager notes and the change history stay private.
create table public.rl_invoice_credit (
  invoice_id text primary key check (invoice_id ~ '^[1-9][0-9]{0,76}$'),
  stage text not null check (stage in ('impaired','written_off')),
  expected_recovery_bps integer check (expected_recovery_bps between 0 and 10000),
  recovered_cents bigint not null default 0 check (recovered_cents >= 0),
  effective_at timestamptz not null default now(),
  note text check (length(note) <= 1000),
  version integer not null default 1 check (version > 0),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  check (stage <> 'impaired' or expected_recovery_bps is not null)
);
create table public.rl_invoice_credit_history (
  id bigint generated always as identity primary key,
  invoice_id text not null, stage text not null, expected_recovery_bps integer, recovered_cents bigint,
  note text not null, actor_id uuid not null references auth.users(id), created_at timestamptz not null default now()
);

alter table public.rl_invoice_credit enable row level security;
alter table public.rl_invoice_credit_history enable row level security;
revoke all on public.rl_invoice_credit, public.rl_invoice_credit_history from anon, authenticated;
-- Public, column-limited read: amounts and stage only, never the manager's note.
grant select (invoice_id, stage, expected_recovery_bps, recovered_cents, effective_at, version, updated_at) on public.rl_invoice_credit to anon, authenticated;
create policy invoice_credit_public_read on public.rl_invoice_credit for select to anon, authenticated using (true);
grant select on public.rl_invoice_credit_history to authenticated;
create policy invoice_credit_history_manager_read on public.rl_invoice_credit_history for select to authenticated using (public.rl_is_manager());
grant all on public.rl_invoice_credit, public.rl_invoice_credit_history to service_role;
grant usage, select on sequence public.rl_invoice_credit_history_id_seq to service_role;

-- Service-only: the Edge Function verifies the fund manager's wallet session first.
-- p_stage 'performing' clears the record (e.g. the SME recovered or the invoice was repaid).
create function public.rl_set_invoice_credit(p_actor uuid, p_invoice text, p_stage text, p_expected_bps integer, p_recovered bigint, p_note text, p_version integer)
returns public.rl_invoice_credit language plpgsql security definer set search_path = '' as $$
declare current public.rl_invoice_credit; result public.rl_invoice_credit;
begin
  if not exists(select 1 from public.rl_profiles p join public.rl_config c on c.manager_wallet=p.wallet where p.user_id=p_actor) then raise exception 'Manager required'; end if;
  if p_note is null or length(btrim(p_note)) not between 1 and 1000 then raise exception 'Give a reason (up to 1,000 characters).'; end if;
  if p_stage not in ('performing','impaired','written_off') then raise exception 'Choose performing, impaired or written off.'; end if;
  select * into current from public.rl_invoice_credit where invoice_id = p_invoice for update;
  if current.invoice_id is not null and current.version <> coalesce(p_version, -1) then raise exception 'This invoice’s credit status changed. Refresh and try again.'; end if;
  if current.invoice_id is null and p_version is not null and p_version <> 0 then raise exception 'This invoice’s credit status changed. Refresh and try again.'; end if;
  if p_stage = 'impaired' and (p_expected_bps is null or p_expected_bps not between 0 and 10000) then raise exception 'Enter an expected recovery between 0%% and 100%%.'; end if;
  if p_stage = 'written_off' and (p_recovered is null or p_recovered < 0) then raise exception 'Enter the amount recovered (0 or more).'; end if;
  insert into public.rl_invoice_credit_history(invoice_id, stage, expected_recovery_bps, recovered_cents, note, actor_id)
    values (p_invoice, p_stage, p_expected_bps, p_recovered, btrim(p_note), p_actor);
  if p_stage = 'performing' then
    delete from public.rl_invoice_credit where invoice_id = p_invoice;
    return null;
  end if;
  insert into public.rl_invoice_credit(invoice_id, stage, expected_recovery_bps, recovered_cents, effective_at, note, updated_by)
    values (p_invoice, p_stage, case when p_stage = 'impaired' then p_expected_bps end, case when p_stage = 'written_off' then p_recovered else 0 end, now(), btrim(p_note), p_actor)
  on conflict (invoice_id) do update set stage = excluded.stage, expected_recovery_bps = excluded.expected_recovery_bps,
    recovered_cents = excluded.recovered_cents,
    -- Keep when the problem started (interest stopped then); a later write-off does not restart it.
    effective_at = public.rl_invoice_credit.effective_at,
    note = excluded.note, updated_by = excluded.updated_by, version = public.rl_invoice_credit.version + 1, updated_at = now()
  returning * into result;
  return result;
end; $$;
revoke all on function public.rl_set_invoice_credit(uuid,text,text,integer,bigint,text,integer) from public, anon, authenticated;
grant execute on function public.rl_set_invoice_credit(uuid,text,text,integer,bigint,text,integer) to service_role;
