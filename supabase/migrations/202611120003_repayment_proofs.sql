-- SMEs upload a payment-proof PDF against a financed invoice; the fund manager reviews it
-- (verify/reject, as for other documents) and then records the repayment on-chain.
-- Widen the two purpose checks on rl_documents. They were created without explicit names,
-- so find them by definition rather than relying on generated constraint names.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.rl_documents'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%purpose%'
  loop
    execute format('alter table public.rl_documents drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.rl_documents
  add constraint rl_documents_purpose_check check (purpose in ('kyc','invoice','repayment')),
  add constraint rl_documents_purpose_target check (
    (purpose = 'kyc' and application_id is not null and invoice_id is null)
    or (purpose in ('invoice','repayment') and application_id is null and invoice_id is not null));
