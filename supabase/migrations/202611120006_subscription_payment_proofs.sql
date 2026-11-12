-- Investors upload proof of payment for an approved subscription request; the fund manager accepts it
-- (verify) or asks for another (reject with a note), then issues the RLU. Uses the same review flow as
-- other documents. Each proof is linked to the investor's own subscription request.
alter table public.rl_documents add column fund_request_id uuid references public.rl_fund_requests(id);
create index rl_documents_fund_request on public.rl_documents(fund_request_id);

alter table public.rl_documents drop constraint rl_documents_purpose_check;
alter table public.rl_documents drop constraint rl_documents_purpose_target;
alter table public.rl_documents
  add constraint rl_documents_purpose_check check (purpose in ('kyc','invoice','repayment','subscription')),
  add constraint rl_documents_purpose_target check (
    (purpose = 'kyc' and application_id is not null and invoice_id is null and fund_request_id is null)
    or (purpose in ('invoice','repayment') and application_id is null and invoice_id is not null and fund_request_id is null)
    or (purpose = 'subscription' and application_id is null and invoice_id is null and fund_request_id is not null));
