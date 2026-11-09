-- Fixed subscription pricing for existing RLU accounting: S$1 per whole RLU.
-- Earlier reported amounts and proofs remain unchanged for review/history.
begin;

alter table public.rl_purchase_requests
  add column pricing_basis text not null default 'legacy_reported';
alter table public.rl_purchase_requests
  alter column pricing_basis set default 'rlu_sgd_1_v1',
  add constraint rl_purchase_pricing_basis check (pricing_basis in ('legacy_reported','rlu_sgd_1_v1')),
  add constraint rl_purchase_fixed_amount check (
    pricing_basis <> 'rlu_sgd_1_v1' or amount_cents::numeric = units::numeric * 100
  );

-- A manager may close an inconsistent earlier draft without inventing a
-- submission timestamp. All other existing submission-state rules remain.
alter table public.rl_purchase_requests drop constraint rl_purchase_requests_check;
alter table public.rl_purchase_requests add constraint rl_purchase_submission_state check (
  ((status = 'draft') = (submitted_at is null)) or
  (status = 'rejected' and pricing_basis = 'legacy_reported' and submitted_at is null)
);

create function public.rl_purchase_protect_pricing() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op = 'INSERT' then
    if new.pricing_basis <> 'rlu_sgd_1_v1' then raise exception 'New requests require fixed RLU pricing'; end if;
  elsif row(new.units,new.amount_cents,new.pricing_basis) is distinct from row(old.units,old.amount_cents,old.pricing_basis) then
    raise exception 'Request quantity, payment and pricing basis cannot be changed';
  end if;
  return new;
end; $$;
create trigger rl_purchase_pricing_immutable
before insert or update of units,amount_cents,pricing_basis on public.rl_purchase_requests
for each row execute function public.rl_purchase_protect_pricing();

create function public.rl_purchase_require_pricing(p_units text,p_amount_cents text) returns void
language plpgsql set search_path='' as $$
begin
  if p_units::numeric * 100 <> p_amount_cents::numeric then
    raise exception 'This earlier request has a different payment amount. The fund manager must review the original payment and check for existing token issuance before closing or replacing it.';
  end if;
end; $$;

-- The Edge Function calls this before advertising the new pricing workflow.
create function public.rl_purchase_pricing() returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('pricing_basis','rlu_sgd_1_v1','unit_price_cents','100',
    'currency','SGD','max_units','9999999999999');
$$;

-- Retire the API that accepted an independently chosen payment amount.
create or replace function public.rl_purchase_create(p_id uuid,p_actor uuid,p_wallet text,p_units text,p_amount_cents text,p_note text)
returns public.rl_purchase_requests language plpgsql security definer set search_path='' as $$
begin
  raise exception 'This purchase client is outdated. Refresh the website to use automatic RLU pricing.';
end; $$;

create function public.rl_purchase_create_priced(p_id uuid,p_actor uuid,p_wallet text,p_units text,p_note text)
returns public.rl_purchase_requests language plpgsql security definer set search_path='' as $$
declare result public.rl_purchase_requests; required_cents text;
begin
  perform 1 from public.rl_profiles where user_id=p_actor and wallet=p_wallet for update;
  perform public.rl_purchase_require_investor(p_actor,p_wallet);
  if p_units is null or p_units !~ '^[1-9][0-9]{0,12}$' then
    raise exception 'Enter a whole RLU quantity between 1 and 9999999999999';
  end if;
  required_cents := (p_units::numeric * 100)::text;
  select * into result from public.rl_purchase_requests where id=p_id;
  if found then
    if result.owner_id<>p_actor or result.wallet<>p_wallet or result.units<>p_units or result.note<>trim(coalesce(p_note,'')) then
      raise exception 'This request ID was already used for different details';
    end if;
    perform public.rl_purchase_require_pricing(result.units,result.amount_cents);
    return result;
  end if;
  if (select count(*) from public.rl_purchase_requests where owner_id=p_actor and status in ('draft','pending','approved')) >= 20 then
    raise exception 'You already have 20 open purchase requests';
  end if;
  insert into public.rl_purchase_requests(id,owner_id,wallet,units,amount_cents,note,pricing_basis)
    values(p_id,p_actor,p_wallet,p_units,required_cents,trim(coalesce(p_note,'')),'rlu_sgd_1_v1') returning * into result;
  insert into public.rl_purchase_audit(request_id,actor_id,action,version) values(p_id,p_actor,'created',result.version);
  return result;
end; $$;

create or replace function public.rl_purchase_attach_proof(p_id uuid,p_version integer,p_actor uuid,p_wallet text,p_proof_id uuid,p_filename text,p_path text,p_bytes integer,p_sha256 text)
returns public.rl_purchase_requests language plpgsql security definer set search_path='' as $$
declare result public.rl_purchase_requests;
begin
  perform 1 from public.rl_profiles where user_id=p_actor and wallet=p_wallet for update;
  perform public.rl_purchase_require_investor(p_actor,p_wallet);
  select * into result from public.rl_purchase_requests where id=p_id for update;
  if p_version is null or result.id is null or result.owner_id<>p_actor or result.wallet<>p_wallet or result.status<>'draft' or result.version<>p_version then
    raise exception 'Request changed or is not your draft';
  end if;
  perform public.rl_purchase_require_pricing(result.units,result.amount_cents);
  if exists(select 1 from public.rl_purchase_proofs where request_id=p_id) then raise exception 'A proof is already attached'; end if;
  if (select count(*) from public.rl_purchase_proofs where owner_id=p_actor) >= 200 then raise exception 'Payment proof limit reached'; end if;
  insert into public.rl_purchase_proofs(id,request_id,owner_id,filename,storage_path,byte_size,sha256)
    values(p_proof_id,p_id,p_actor,p_filename,p_path,p_bytes,p_sha256);
  update public.rl_purchase_requests set version=version+1,updated_at=now() where id=p_id returning * into result;
  insert into public.rl_purchase_audit(request_id,actor_id,action,version) values(p_id,p_actor,'proof_attached',result.version);
  return result;
end; $$;

create or replace function public.rl_purchase_submit(p_id uuid,p_version integer,p_actor uuid,p_wallet text)
returns public.rl_purchase_requests language plpgsql security definer set search_path='' as $$
declare result public.rl_purchase_requests;
begin
  perform public.rl_purchase_require_investor(p_actor,p_wallet);
  select * into result from public.rl_purchase_requests where id=p_id for update;
  if p_version is null or result.id is null or result.owner_id<>p_actor or result.wallet<>p_wallet or result.status<>'draft' or result.version<>p_version then
    raise exception 'Request changed or is not your draft';
  end if;
  perform public.rl_purchase_require_pricing(result.units,result.amount_cents);
  if not exists(select 1 from public.rl_purchase_proofs where request_id=p_id and owner_id=p_actor) then raise exception 'Attach payment proof before submitting'; end if;
  update public.rl_purchase_requests set status='pending',submitted_at=now(),updated_at=now(),version=version+1 where id=p_id returning * into result;
  insert into public.rl_purchase_audit(request_id,actor_id,action,version) values(p_id,p_actor,'submitted',result.version);
  return result;
end; $$;

create or replace function public.rl_purchase_review(p_id uuid,p_version integer,p_actor uuid,p_decision text,p_note text)
returns public.rl_purchase_requests language plpgsql security definer set search_path='' as $$
declare result public.rl_purchase_requests; legacy_mismatch boolean;
begin
  perform public.rl_purchase_require_manager(p_actor);
  select * into result from public.rl_purchase_requests where id=p_id for update;
  if p_version is null or result.id is null or result.version<>p_version then raise exception 'Request changed or was already reviewed'; end if;
  if result.owner_id=p_actor or result.wallet=(select wallet from public.rl_profiles where user_id=p_actor) then raise exception 'Self review is not permitted'; end if;
  if p_decision not in ('approved','rejected') or p_decision is null or p_note is null or length(trim(p_note)) not between 1 and 2000 then raise exception 'Decision and review note required'; end if;
  legacy_mismatch := result.pricing_basis='legacy_reported' and result.amount_cents::numeric<>result.units::numeric*100;
  if result.status<>'pending' and not (p_decision='rejected' and legacy_mismatch and result.status in ('draft','approved')) then
    raise exception 'Request changed or was already reviewed';
  end if;
  if not (p_decision='rejected' and legacy_mismatch) and not exists(select 1 from public.rl_purchase_proofs where request_id=p_id) then raise exception 'Payment proof required'; end if;
  if p_decision='approved' then
    perform public.rl_purchase_require_pricing(result.units,result.amount_cents);
    perform public.rl_purchase_require_investor(result.owner_id,result.wallet);
  end if;
  update public.rl_purchase_requests set status=p_decision,review_note=trim(p_note),reviewed_by=p_actor,
    reviewed_at=now(),updated_at=now(),version=version+1 where id=p_id returning * into result;
  insert into public.rl_purchase_audit(request_id,actor_id,action,version,note) values(p_id,p_actor,p_decision,result.version,trim(p_note));
  return result;
end; $$;

create or replace function public.rl_purchase_fulfill(p_id uuid,p_version integer,p_actor uuid,p_tx text)
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
  perform public.rl_purchase_require_pricing(result.units,result.amount_cents);
  perform public.rl_purchase_require_investor(result.owner_id,result.wallet);
  if exists(select 1 from public.rl_purchase_requests where issuance_tx_hash=p_tx and id<>p_id) then raise exception 'Issuance transaction already belongs to another request'; end if;
  update public.rl_purchase_requests set status='fulfilled',issuance_tx_hash=p_tx,fulfilled_at=now(),updated_at=now(),version=version+1
    where id=p_id returning * into result;
  insert into public.rl_purchase_audit(request_id,actor_id,action,version,tx_hash) values(p_id,p_actor,'fulfilled',result.version,p_tx);
  return result;
end; $$;

revoke all on function public.rl_purchase_protect_pricing(),public.rl_purchase_require_pricing(text,text),public.rl_purchase_pricing(),
  public.rl_purchase_create_priced(uuid,uuid,text,text,text),public.rl_purchase_create(uuid,uuid,text,text,text,text),
  public.rl_purchase_attach_proof(uuid,integer,uuid,text,uuid,text,text,integer,text),public.rl_purchase_submit(uuid,integer,uuid,text),
  public.rl_purchase_review(uuid,integer,uuid,text,text),public.rl_purchase_fulfill(uuid,integer,uuid,text)
  from public,anon,authenticated;
grant execute on function public.rl_purchase_pricing(),public.rl_purchase_create_priced(uuid,uuid,text,text,text),
  public.rl_purchase_create(uuid,uuid,text,text,text,text),public.rl_purchase_attach_proof(uuid,integer,uuid,text,uuid,text,text,integer,text),
  public.rl_purchase_submit(uuid,integer,uuid,text),public.rl_purchase_review(uuid,integer,uuid,text,text),public.rl_purchase_fulfill(uuid,integer,uuid,text)
  to service_role;

commit;
