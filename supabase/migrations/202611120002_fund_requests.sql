-- Investor subscription and redemption requests.
-- The invoice ledger has no on-chain request or redemption function, so investors request here.
-- The Edge Function checks on-chain investor approval (and RLU balance for redemptions) before inserting.
-- The fund manager then issues RLU on-chain (subscriptions) or settles off-chain (redemptions).
create table public.rl_fund_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.rl_profiles(user_id),
  wallet text not null references public.rl_profiles(wallet),
  kind text not null check (kind in ('subscription','redemption')),
  -- Whole S$ for subscriptions, whole RLU for redemptions.
  amount bigint not null check (amount > 0 and amount <= 1000000000),
  status text not null default 'pending' check (status in ('pending','approved','completed','rejected','cancelled')),
  manager_note text check (length(manager_note) <= 500),
  tx_hash text check (tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  version integer not null default 1 check (version > 0),
  decided_by uuid references auth.users(id), decided_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index rl_fund_requests_owner on public.rl_fund_requests(user_id, created_at desc);
create index rl_fund_requests_status on public.rl_fund_requests(status, created_at desc);

alter table public.rl_fund_requests enable row level security;
revoke all on public.rl_fund_requests from anon, authenticated;
grant select on public.rl_fund_requests to authenticated;
grant all on public.rl_fund_requests to service_role;
-- Investors see only their own requests from their current wallet; the manager sees all.
create policy fund_requests_read on public.rl_fund_requests for select to authenticated using (
  public.rl_current_wallet() is not null and ((user_id = auth.uid() and wallet = public.rl_current_wallet()) or public.rl_is_manager()));

-- Service-only: called after the Edge Function verifies the wallet session and on-chain investor status.
create function public.rl_create_fund_request(p_user uuid, p_wallet text, p_kind text, p_amount bigint)
returns public.rl_fund_requests language plpgsql security definer set search_path = '' as $$
declare result public.rl_fund_requests;
begin
  if (select count(*) from public.rl_fund_requests where user_id = p_user and status = 'pending') >= 5 then
    raise exception 'You already have 5 pending requests. Wait for a decision or cancel one first.';
  end if;
  insert into public.rl_fund_requests(user_id, wallet, kind, amount) values (p_user, lower(p_wallet), p_kind, p_amount) returning * into result;
  return result;
end; $$;

-- Service-only: the requester may cancel their own pending request.
create function public.rl_cancel_fund_request(p_id uuid, p_user uuid)
returns public.rl_fund_requests language plpgsql security definer set search_path = '' as $$
declare result public.rl_fund_requests;
begin
  update public.rl_fund_requests set status = 'cancelled', version = version + 1, updated_at = now()
    where id = p_id and user_id = p_user and status = 'pending' returning * into result;
  if result.id is null then raise exception 'Only your own pending requests can be cancelled.'; end if;
  return result;
end; $$;

-- Service-only: the Edge Function verifies the fund manager first.
-- pending -> approved | rejected; approved -> completed | rejected. Stale versions fail.
create function public.rl_decide_fund_request(p_id uuid, p_version integer, p_actor uuid, p_decision text, p_note text, p_tx text)
returns public.rl_fund_requests language plpgsql security definer set search_path = '' as $$
declare current public.rl_fund_requests; result public.rl_fund_requests;
begin
  select * into current from public.rl_fund_requests where id = p_id for update;
  if current.id is null or current.version <> p_version then raise exception 'Request changed or was already decided. Refresh and try again.'; end if;
  if not ((current.status = 'pending' and p_decision in ('approved','rejected','completed')) or (current.status = 'approved' and p_decision in ('completed','rejected'))) then
    raise exception 'This request can no longer be changed.';
  end if;
  if p_decision = 'rejected' and length(btrim(coalesce(p_note, ''))) = 0 then raise exception 'Give a reason when rejecting a request.'; end if;
  update public.rl_fund_requests set status = p_decision, manager_note = nullif(btrim(coalesce(p_note, '')), ''),
    tx_hash = coalesce(p_tx, tx_hash), decided_by = p_actor, decided_at = now(), version = version + 1, updated_at = now()
    where id = p_id returning * into result;
  return result;
end; $$;

revoke all on function public.rl_create_fund_request(uuid,text,text,bigint), public.rl_cancel_fund_request(uuid,uuid),
  public.rl_decide_fund_request(uuid,integer,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.rl_create_fund_request(uuid,text,text,bigint), public.rl_cancel_fund_request(uuid,uuid),
  public.rl_decide_fund_request(uuid,integer,uuid,text,text,text) to service_role;
