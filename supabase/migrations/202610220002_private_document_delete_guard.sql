-- Apply after 202610220001, only with the project owner's approval.
begin;

-- The existing ALL guard permits owner/manager reads through USING. DELETE
-- also uses USING, so a legacy permissive DELETE policy needs its own guard.
-- Privileged server cleanup remains available to service_role (BYPASSRLS).
create policy rl_private_document_delete_guard on storage.objects
as restrictive for delete to anon, authenticated
using (bucket_id <> 'receiveledger-documents');

commit;
