# Batch 2 — registration, profiles and private documents

## Local implementation

Stages A, B and C now have local code. Hosted activation and end-to-end testing are pending the project owner's Supabase configuration and approval. No hosted migration, Edge Function deployment, production push or Sepolia transaction has been performed by the agent.

Stage A retains Home navigation, genuine-account-switch redirects, same-wallet page restoration, profile controls, smaller blockchain refresh controls, Settings, Help & Support, About and responsive styling.

Stages B/C add a welcome page, Investor/SME applications, persistent wallet-linked names and private contact/company fields, manager application review, fictional KYC and invoice PDF uploads, authenticated downloads and auditable document-review decisions. Home, profiles, investor tables, invoice tables and history can display approved registered names alongside wallet addresses. Existing test wallets retain their blockchain access without registration; approved off-chain applications never override live investor revocation.

## Files to review

| Path | Purpose |
|---|---|
| `src/registration/` | Browser-safe Supabase configuration, memory-only private sessions, signed-message sign-in and regression/security tests |
| `src/pages/Registration.tsx` | Welcome, private access gate, Investor/SME forms and Home summaries |
| `src/pages/Applications.tsx` | Manager review and on-chain investor approval/finalization recovery |
| `src/pages/Documents.tsx` | Fictional PDFs, authenticated downloads and manager verification |
| `src/components/WalletName.tsx` | Approved-name lookup with wallet-address fallback |
| `supabase/migrations/202610220001_registration_documents.sql` | Tables, explicit grants, protected RPCs, RLS, review audit and private bucket policies |
| `supabase/functions/registry/index.ts` | Edge entry point; server credentials never enter the frontend |
| `supabase/functions/_shared/` | Request authorization, PDF parsing and independent Sepolia receipt/invoice checks |
| `docs/SUPABASE_SETUP.md` | Exact setup requirements, approval boundaries and manual acceptance checks |

This workspace originally had no Git metadata. A new local, uncommitted branch `feat/batch2-supabase` was initialized at the user's request. It has no production history, remote or commits. Reconcile these reviewed files with the actual GitHub checkout on a feature branch before any push; do not treat this independent local repository as a copy of the production Git history.

## Authentication and authorization

Supabase Auth verifies EIP-4361 Ethereum sign-in signatures, domains and timestamps. The frontend signs with the already-selected injected wallet and uses Sepolia explicitly. Private sessions are not persisted in browser storage. Wallet/network changes hide private data immediately, serialize session cleanup and reject stale responses.

The database derives wallet ownership from `auth.identities.provider_id`, never an address/role in a submitted form or editable user metadata. It requires an unrevoked session with Web3 authentication and exactly one Ethereum identity, failing closed for ambiguous/linked identities. Profile, contact and document access is owner-scoped or manager-only. Approved display labels are intentionally shared with authenticated participants; contact information is excluded from that directory.

The server obtains the manager from the unchanged contract and checks the caller against that live address. Users have no direct write grants to review fields or document metadata, and cannot execute service-only review RPCs. Those operations also check manager identity, expected version and pending state in PostgreSQL. Audit writes are part of the same review transaction.

Investor approval uses the existing `approveInvestor` function through the existing transaction wrapper. Before finalizing the application, the Edge Function independently validates the Sepolia transaction, manager, contract, exact call/recipient, receipt, event, two confirmations and current approval mapping. The UI retains a confirmed transaction hash and can retry database finalization without another transaction. SME approval and document verification remain off-chain.

Invoice PDFs are linked only after the server verifies the invoice's stored SME address. Storage is private, has no direct client upload policy, and is guarded against broader existing permissive policies. All uploads pass the server PDF parser, byte/page limits, owner checks and fictional-data acknowledgement. Documents are immutable uploads with separate review decisions. Downloads use authenticated requests, not public or persistent signed URLs. See setup documentation for parser limitations, session-sign-out failure handling and retention limits.

## Verification and remaining dependency

The agent's local checks passed TypeScript, Edge Function type checking, 120 tests and the production build. Tests include the previous 69 checks plus signed-message/input/receipt/PDF validation, private-session isolation, Edge authorization, registration UI/retry behavior, and execution of the actual SQL migration in disposable in-memory PostgreSQL. The SQL suite checks cross-owner and anonymous denial, manager access, forged metadata, non-Web3/linked/revoked sessions, direct-write/storage-upload denial, review transitions, optimistic concurrency and name-directory privacy.

These are local tests. They do not validate your hosted Supabase version/configuration, live wallet sign-in, a real uploaded PDF, a real approval receipt, browser/mobile rendering or production deployment. Those require the reviewed hosted setup and manual acceptance tests. No working backend connection is claimed until that setup is completed.

The existing Vite/Vitest development-toolchain audit advisories remain outstanding and are not silently fixed by a major upgrade. No new production financial features or contract changes are included.

Next: follow only the first two local-configuration actions in `SUPABASE_SETUP.md`. Migrations, cloud security settings, function deployment and production deployment remain subject to explicit owner approval.
