# Batch 2 progress and setup dependency

## Stage A implemented locally

- Every wallet role uses Home in the sidebar. A genuinely different account opens Home, including a switch between two wallets with the same role.
- Refreshing, restoring Sepolia, or reopening the same wallet can preserve an allowed page. The last page is remembered in session storage for this tab; Settings can disable this preference. Storage failure falls back to normal navigation.
- The header shows a wallet identity component with role initials, role label and shortened address. Until authenticated registration exists, this is explicitly a wallet label, not an invented registered name.
- The account menu provides My Profile, Copy Wallet Address, Settings and Disconnect. Disconnect clears application data and attempts `wallet_revokePermissions`. If unsupported or rejected, the app explains how to remove permissions in MetaMask. This does not change on-chain investor approval.
- A smaller Refresh blockchain control refreshes role-specific snapshots and history, with progress/error feedback. Snapshot refresh no longer causes repeated history scans for provisional wallets. Stale role polling cannot change the next wallet's view.
- Settings, Help & Support and About are accessible without a connected wallet. They explain connection recovery, history indexing, inactive investors and prototype limitations without fabricated contact details.
- Responsive navigation, account controls, profile details and mobile spacing retain the existing navy/teal design. A single short simulation disclosure remains in the application shell.

The existing contract, address, ABI and transaction workflows are unchanged. No transactions, pushes, deployments or cloud modifications were performed. This workspace has no `.git` directory, so no feature branch could be created here. Reconcile these local changes with the actual Git checkout on a Batch 2 feature branch before pushing.

## Stage A validation

TypeScript, 69 tests and the production build passed. The suite includes the previous 49 tests plus 16 rendered account/navigation cases and four wallet-provider regression cases. These cover same-role account switches, same-wallet page restoration, lost transfer access, profile isolation, manager-route denial, refresh behavior, disconnection and stale role responses. Testing Library and jsdom are development dependencies only.

No usable browser automation surface is connected to this session. Desktop/mobile visual QA and real MetaMask interaction were not performed by the agent. Before deployment, manually check account switching and page restoration, menu/copy/disconnection behavior, refresh feedback, existing transaction forms, and narrow-screen navigation. No transaction is needed for the initial UI checks.

The dependency audit reports six affected packages in the pre-existing Vite/Vitest development toolchain (including two critical advisories). The newly added Testing Library/jsdom packages were not flagged. This work does not upgrade the toolchain across major versions or claim that the audit is clean. Review and validate those upgrades separately; do not expose development or test servers publicly. The Vercel output remains a static `dist/` build.

## Stage B dependency: no off-chain backend is configured

There is no Supabase client, project configuration, authenticated registration service, RLS schema or private document bucket in this workspace. Stage B and C are paused at this dependency, as requested. No application submission, approval, document upload or verification is presented as working.

The next two user actions are:

1. Sign in at <https://supabase.com/dashboard>.
2. Open an existing ReceiveLedger development project, or click New project and stop at the project setup form. Tell the assistant which screen is open; do not share database passwords or secret keys.

The project owner's approval is required before the agent changes cloud resources. Once the project exists, obtain its URL and browser publishable key through the project's Connect dialog. These may be used as `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in an ignored `.env.local` after the integration is implemented. Never put a service-role/secret key, database password, wallet private key or seed phrase in the frontend, chat, GitHub or a `VITE_` variable. A publishable key alone does not establish permissions: enforce them in database and storage policies.

## Proposed security design for Stage B/C (not implemented)

Use Supabase Web3 authentication to verify a signed Ethereum sign-in message and issue a session. Connecting MetaMask alone is not authentication. Bind profile ownership to `auth.uid()` and the provider-verified wallet identity on the server; never trust a wallet address or a role supplied in a form or editable user metadata. On a wallet change, cancel requests, clear profile/document state and invalidate the old session before loading another account's private data. Bind any authenticated session to the currently selected wallet.

Separate a display identity from private contact/company details and document metadata. Scope private profile/application records to their authenticated owner and the authenticated fund manager. Only approved display labels intended for other participants should be readable by those participants; contact details must not be included in general wallet-name lookups. Existing wallets without profiles retain their contract-derived access and address fallback.

Keep manager authorization in server-controlled data, provisioned only after verifying that the authenticated wallet matches `manager()` on the existing Sepolia contract. Clients must not be able to grant themselves manager privileges. Require RLS on every exposed table, explicit grants, an owner-bound insert policy, and database-enforced restrictions on review/status fields. A user may submit their own pending application, but cannot approve or reject it by calling the API directly.

An investor application approval must use the existing `approveInvestor` transaction and remain pending until its receipt succeeds and the live approval mapping is verified. A trusted server reconciliation step must independently check chain ID, contract, transaction and applicant before recording approval. Handle a successful on-chain approval with a failed database update explicitly; retry reconciliation instead of inventing success or sending duplicate transactions. Revocation still follows the live mapping even when an application was previously approved. SME approval and document verification remain off-chain states and must never be described as Solidity permissions.

Use private storage buckets for fictional KYC and invoice PDFs. Authorize each upload/download through the authenticated owner or manager, and constrain object paths to the owner/application/document IDs. Verify invoice ownership from the contract before linking documents to an invoice ID. Validate PDF content and size server-side, not just filename or MIME type. Use short-lived authenticated document access; never store public document URLs. Review decisions must be manager-only, auditable and protected from owner mutation.

Required validation before Stage B/C can be considered complete includes signed-wallet authentication, cross-account profile denial through direct API requests, pending/approved/rejected application transitions, failed/cancelled transaction handling, client attempts to change manager/status fields, revocation reconciliation, private bucket anonymous/other-user denial, manager document access, invoice ownership checks, invalid PDF rejection and session invalidation during wallet switching. These tests do not exist yet because the backend and workflows have not been implemented. Unit tests of frontend booleans would not establish real RLS or storage isolation.

References: [Supabase React setup](https://supabase.com/docs/guides/getting-started/quickstarts/reactjs), [Web3 authentication](https://supabase.com/docs/guides/auth/auth-web3), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [storage access control](https://supabase.com/docs/guides/storage/security/access-control).
