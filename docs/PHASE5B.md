# Phase 5B — onboarding and Supabase activation readiness

Local implementation completed in `C:\Users\Eugen\Documents\GitHub\ReceivLedger` on `feat/phase4-supabase-audit`. The initial uncommitted Phase 4/5A changes are preserved. No main-branch edits, Solidity/address changes, blockchain transactions, hosted migrations, deployments, commits, pushes or merges were performed. Batch 3 financial models and reports remain intact.

## Implemented

- Unknown connected wallets see the welcome choices on Home. Secure Supabase Ethereum signed-message authentication is required before application fields can be submitted. There is no second authentication system.
- Investor forms collect full name, email, contact number, country and the automatic read-only wallet. SME forms collect company name, UEN/registration number, business email, optional HTTPS website, registered address, contact name/phone and wallet. Shared frontend/Edge validation and the new SQL RPC validate the required fields. Use fictional demonstration data only; never upload real identity documents.
- Successful submissions remain `pending` in Supabase and go to an Investor/SME application dashboard. Name, status, submitted information, manager notes, submission/review timestamps and private-document navigation are available. A visibly illustrative target of up to three working days is not a guaranteed service commitment.
- The selected application changes the interface, never LedgerContext's actual chain role. Pending Investor transfers/issuance and pending SME website invoice submission remain unavailable. Restricted workspaces explain why. Off-chain Investor approval cannot enable transfers without live chain approval. Only the manager can issue RLU.
- Rejected and information-requested applications can be corrected and resubmitted for the same kind. Approved, suspended and revoked applications cannot be edited by the applicant. Suspension/revocation is off-chain only. The manager can request updated information for a suspended application; revoked applications are terminal in this version.
- Manager review reuses the existing system, now displaying all additional private fields and dates. Pending applications can be approved, rejected or sent back for more information with an audited note. Approved applications can be suspended/revoked off-chain. Investor approval still requires the independently verified exact Sepolia approval receipt, two confirmations and current mapping. Retry finalization still reuses the confirmed hash.
- Registered financial actions re-read the application's current state before requesting any transaction, so stale approval cannot bypass a subsequent suspension. Established manager/investor/inactive-investor/SME wallets without an application retain their historical records and original chain capabilities. Existing inactive investors still cannot transfer RLU.
- Pending records persist in Supabase, not local form storage. After refresh/reconnection, the same wallet must sign in again to fetch its actual saved status. A browser flag stores only a public wallet address key and a boolean indicating a saved application exists; it contains no role/status, name, contact details, document or token. It restores the sign-in gate in that browser. Auth sign-out events now invalidate in-flight private responses in addition to the existing wallet/network isolation.

## Security and contract boundaries

The new migration is additive: `supabase/migrations/202610220003_application_onboarding.sql`, after migrations 001 and 002. Existing applications retain their fields, IDs and review records; additional details default to an empty object for legacy records and submission time is backfilled from creation time. Existing RLS, protected wallet identity derivation, private storage and Phase 4 deletion guard remain in place. The old submission RPC is removed so direct API callers cannot bypass the new required fields. Review changes preserve service-only EXECUTE permissions, manager identity checks, optimistic concurrency, verified fictional KYC, self-review denial and transactional audit writes. New private fields never enter the approved-name directory.

Website action checks and the browser restore flag are not blockchain authorization. Browser flags can be absent on a new device, blocked or removed; legacy chain wallets remain eligible for the compatibility path until their application is restored. Direct contract interaction remains possible regardless. Solidity's existing `submitInvoice` permits arbitrary wallets; it does not enforce registration, pending SME restrictions or off-chain suspension. Off-chain suspension/revocation does not revoke an investor on-chain, burn holdings or remove invoices. A separate owner-authorized manager transaction would be needed for on-chain investor revocation. No such transaction was sent here.

Supabase Auth continues using [supported Ethereum Web3 authentication](https://supabase.com/docs/guides/auth/auth-web3). Frontend configuration accepts only the [publishable key](https://supabase.com/docs/guides/getting-started/api-keys). The existing function expects Supabase-injected `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; confirm these server-only runtime values when activating the existing project. No key migration or auth-system replacement was introduced. No privileged key belongs in frontend variables, source control or chat.

## Files changed for Phase 5B

| Area | Files |
|---|---|
| Routing and application interfaces | `src/App.tsx`, `src/pages/Registration.tsx`, `src/pages/Applications.tsx`, new `src/components/ApplicationDetails.tsx` |
| Website transaction/document controls | `src/pages/Invoices.tsx`, `src/pages/Investors.tsx`, `src/pages/Documents.tsx`, new `src/registration/access.ts` |
| Sessions and restore hint | `src/registration/RegistryContext.tsx`, new `src/registration/enrollment.ts` |
| Existing backend extension | `supabase/functions/_shared/domain.ts`, `supabase/functions/_shared/handler.ts`, new migration 003 |
| Tests | New `src/registration/onboarding.test.tsx`; updated `RegistrationFlow.test.tsx`, `RegistryContext.test.tsx`, `database.test.ts`, `handler.test.ts`, `security.test.ts` in `src/registration/` |
| Documentation | `docs/BATCH2.md`, `docs/SUPABASE_SETUP.md`, new `docs/PHASE5B.md` |

## Verification

All **234 tests across 16 files** pass (33 added to Phase 5A's 201). TypeScript, Edge Function type checks, production build and whitespace checks pass. SQL migrations 001–003 are executed only against disposable in-memory PostgreSQL with representative Auth/Storage tables. UI and Edge tests use mocks; no hosted registration, real PDF acceptance, MetaMask sign-in or manager approval transaction was tested. Existing Node jsdom storage warnings remain non-fatal.

Coverage includes unknown-wallet onboarding, both forms, missing configuration, pending/approved/rejected/information-requested/suspended/revoked states, disabled and programmatically submitted restricted forms, stale approval rechecks, legacy-wallet compatibility, manager-only decisions, actual SQL grants/RLS/new fields/status transitions, private-directory exclusions, PDF access boundaries, wallet switching, authenticated restore and delayed responses after sign-out. The full Phase 4 security and Phase 5A finance suites remain passing.

## Hosted configuration still pending

This checkout has `.env.example` and no `.env.local`. The existing hosted project's settings are unverified. Activation still requires frontend values, Ethereum provider and exact redirect origins, Data API/public exposure, reviewed migrations 001–003 and private bucket/policies, `SEPOLIA_RPC_URL` and `ALLOWED_ORIGINS`, runtime server credentials, and separately approved deployment of the matching `registry` function. See [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for the inventory. Apply only outstanding migrations after checking existing objects/history; do not rerun earlier raw SQL files. Hosted resources have not been changed by this work.

## Manual acceptance checklist (reference after approved activation)

- With a new wallet, check both registration paths, signed-message authentication and fictional required fields. Submit and inspect the corresponding pending dashboard, visible demo review target and disabled action explanations.
- Reload/reconnect and sign in with the same wallet: the saved application should return. Switch wallets: the previous name, private fields and documents must disappear. With configuration missing, show the setup notice without breaking legacy blockchain dashboards.
- As the manager, inspect details, timestamps and permitted fictional PDFs; request additional information or reject, then check applicant correction/resubmission. SME approval is off-chain. Investor receipt approval requires a separate explicit authorization for a real transaction; it was not performed here.
- Check suspended/revoked website restrictions and stale approval denial, unrelated-wallet private-record/PDF denial, then existing manager/investor/inactive-investor/SME history and financial reports. Preserve all existing records; create no artificial transactions to populate screens.

## Only the next two owner actions

1. In the existing Supabase project dashboard, click **Connect**. Copy the Project URL and Publishable key into root `.env.local`, using `.env.example` as the template (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`). Expected result: ignored local configuration with the matching project URL and `sb_publishable_...` key. Do not paste values into chat.
2. Open **Authentication → Sign In / Providers → Web3 Wallet**, enable **Ethereum**, and save. Expected result: Ethereum wallet sign-in enabled for that project. Report these two actions complete; do not run SQL or deploy the function yet.

Stop here for owner configuration. Hosted registration is not yet claimed to work. Phase 5C and Phase 6 were not started.
