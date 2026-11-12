-- Off-chain invoice decisions. The ledger contract has no public reject function and no way to ask an SME for
-- documents, so the fund manager's rejection or request for more information is recorded here. On-chain the
-- invoice stays Submitted; the website shows this decision instead.
--   needs_info     the fund manager asked the SME for more documents
--   info_provided  the SME uploaded an invoice document after the request (set when the upload is stored)
--   rejected       the fund manager declined the invoice
-- No row = nothing decided off-chain. Only the fund manager and the SME that owns the invoice can read it.
create table public.rl_invoice_reviews (
  invoice_id text primary key check (invoice_id ~ '^[1-9][0-9]{0,76}$'),
  sme_wallet text not null check (sme_wallet ~ '^0x[0-9a-f]{40}$'),
  status text not null check (status in ('needs_info','info_provided','rejected')),
  note text not null check (length(btrim(note)) between 1 and 1000),
  version integer not null default 1 check (version > 0),
  decided_by uuid references auth.users(id),
  decided_at timestamptz not null default now(),
  responded_at timestamptz
);
alter table public.rl_invoice_reviews enable row level security;
revoke all on public.rl_invoice_reviews from anon, authenticated;
grant select on public.rl_invoice_reviews to authenticated;
create policy invoice_reviews_read on public.rl_invoice_reviews for select to authenticated
  using (public.rl_is_manager() or sme_wallet = public.rl_current_wallet());
grant all on public.rl_invoice_reviews to service_role;

-- Service-only: the Edge Function verifies the fund manager's wallet session and reads the SME wallet from the chain.
-- p_status 'cleared' removes the decision (e.g. the manager undoes a rejection).
create function public.rl_set_invoice_review(p_actor uuid, p_invoice text, p_sme text, p_status text, p_note text, p_version integer)
returns public.rl_invoice_reviews language plpgsql security definer set search_path = '' as $$
declare current public.rl_invoice_reviews; result public.rl_invoice_reviews;
begin
  if not exists(select 1 from public.rl_profiles p join public.rl_config c on c.manager_wallet=p.wallet where p.user_id=p_actor) then raise exception 'Manager required'; end if;
  if p_status not in ('needs_info','rejected','cleared') then raise exception 'Choose reject or request more information.'; end if;
  if p_status <> 'cleared' and (p_note is null or length(btrim(p_note)) not between 1 and 1000) then raise exception 'Tell the SME why (up to 1,000 characters).'; end if;
  select * into current from public.rl_invoice_reviews where invoice_id = p_invoice for update;
  if current.invoice_id is not null and current.version <> coalesce(p_version, -1) then raise exception 'This invoice’s review changed. Refresh and try again.'; end if;
  if current.invoice_id is null and p_version is not null and p_version <> 0 then raise exception 'This invoice’s review changed. Refresh and try again.'; end if;
  if p_status = 'cleared' then
    delete from public.rl_invoice_reviews where invoice_id = p_invoice;
    return null;
  end if;
  insert into public.rl_invoice_reviews(invoice_id, sme_wallet, status, note, decided_by)
    values (p_invoice, lower(p_sme), p_status, btrim(p_note), p_actor)
  on conflict (invoice_id) do update set sme_wallet = excluded.sme_wallet, status = excluded.status, note = excluded.note,
    decided_by = excluded.decided_by, decided_at = now(), responded_at = null, version = public.rl_invoice_reviews.version + 1
  returning * into result;
  return result;
end; $$;

-- Service-only: called after the SME stores an invoice document, so the manager sees the request was answered.
create function public.rl_invoice_info_provided(p_invoice text, p_wallet text)
returns void language sql security definer set search_path = '' as $$
  update public.rl_invoice_reviews set status = 'info_provided', responded_at = now(), version = version + 1
  where invoice_id = p_invoice and sme_wallet = lower(p_wallet) and status = 'needs_info';
$$;
revoke all on function public.rl_set_invoice_review(uuid,text,text,text,text,integer), public.rl_invoice_info_provided(text,text) from public, anon, authenticated;
grant execute on function public.rl_set_invoice_review(uuid,text,text,text,text,integer), public.rl_invoice_info_provided(text,text) to service_role;
