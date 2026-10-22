# Registration and navigation restructuring

## Repository and review state

Work is confined to `C:\Users\Eugen\Documents\GitHub\ReceivLedger` on `feat/registration-ux-restructure`, created from freshly fetched `origin/main` at `91381afc57865b2d14cc219e55d9effbe07e9223`. The starting working tree was clean. All changes from this review remain uncommitted and unpublished. Earlier phase documents describe historical work; this document describes the latest local interface.

## Implemented flow

Disconnected visitors see only the requested welcome title, description and Connect Your Wallet button, plus small Help/About links. If MetaMask is unavailable, the connection button is disabled and links to its official installation page. Connecting never automatically requests a signature.

The existing contract manager and recognised chain wallets keep their dashboards. Unknown wallets wait for historical chain recognition before being offered Investor or SME. There is no public manager choice. Private application recognition requires explicit secure wallet sign-in: an existing application takes precedence over a new selection. Private applications cannot safely be discovered publicly from a wallet address alone. An active authenticated session is reused; changing selection does not request another signature. A reload still needs sign-in because authentication remains memory-only. Wallet changes clear private provider state and reset the selected account type.

The existing forms retain server validation, read-only wallet addresses, required-field markers, fictional-data consent, optional website and complete contact/company details. Saving takes the applicant to their status dashboard with a submission notice, submitted information and the illustrative three-working-day review target. Pending, needs-information, rejected, suspended and revoked states retain the existing policy gates. Off-chain approval creates neither RLU nor on-chain SME permissions.

| Role | Primary navigation |
|---|---|
| Manager | Home, Financial Reports, Applications, Investors, Invoices, Transaction History |
| Investor / inactive investor | Home, My Assets, Transaction History |
| SME | Home, My Invoices, Submit Invoice, Transaction History |
| Unclassified wallet | Home, with account restoration/type selection |

Settings, Help & Support and About remain at the sidebar bottom. The profile is reached from the wallet header. Registration and Documents are contextual routes, not permanent primary tabs. Application documents appear in the status dashboard, application form/review and profile; invoice PDFs appear in invoice details. Context filters do not confer access: the existing authenticated handler, RLS, invoice-owner checks and private storage policies remain the security boundary. Approved application KYC is read-only. Manager review cannot upload on behalf of an applicant.

Applications has Pending, Approved, Rejected and Requires more information status buttons, plus suspended/revoked/all filters, names, wallet, account type, submitted date and review status. Existing audited decisions and chain receipt verification remain intact.

My Assets combines real RLU holdings, ownership/NAV scenarios, permitted transfers and personal history. Inactive investors retain holdings/history and cannot transfer. Pending investor applications do not acquire a chain role. SME Home adds total financed face value including subsequently repaid invoices, outstanding financed principal, the next five future financed maturities and illustrative financing capacity. Capacity reuses the existing assessment policy without creating a fictional invoice: unassessed risk, SME cap, active wallet principal and reserve-adjusted liquidity. It excludes repaid principal and other wallets. It is not approved credit, a cash balance or a payer-specific eligibility result. Actual financing still uses full face value and collects none of the modelled fees.

My Invoices and Submit Invoice are separate screens sharing the existing guarded transaction code. Established invoice wallets without an application retain the legacy blockchain path. New SME applicants still require the approved private application in this website; Solidity does not enforce it. No investment/withdrawal requests, profit estimates, redemption or payments were added.

## Historical production blocker (read-only checks, 2026-10-22)

**Superseded operational state:** the separately approved ALLOWED_ORIGINS update subsequently added production while preserving Preview. Latest live checks confirm production preflight 204 and unauthenticated POST 401. See [LIVE_TESTING_FIXES.md](LIVE_TESTING_FIXES.md). The evidence below records the earlier blocker, not the current configuration.

Project: `gltivccwuryzlgpqvyll`. The production page and public JavaScript load successfully and contain the expected project reference and frontend publishable-key configuration. No secret values were printed.

| Registry request origin | OPTIONS | POST without a session | CORS result |
|---|---|---|---|
| `https://receiv-ledger.vercel.app` | 403 | 403, `Origin is not allowed.` | No allowed-origin header |
| `https://receiv-ledger-lt5n8xuzw-eugene-dd71.vercel.app` | 204 | 401, sign-in required | Exact Preview allowed-origin header |

Read-only management checks confirm registry version 1 ACTIVE, Ethereum authentication enabled, production site URL, and production/Preview root redirect URLs already present. Secret metadata matches the Preview-only ALLOWED_ORIGINS configuration. Therefore the production origin is currently blocked before authentication; the browser hides this response behind a fetch/CORS failure, producing the deployed generic error. This is a confirmed blocker, not evidence that every later registration stage works. A historical log request returned HTTP 400, so no particular user's previous failure was verified through logs.

Local diagnostics now distinguish browser fetch/CORS/connectivity, function gateway, frontend configuration, safe authentication errors and explicit origin rejection. A network failure cannot identify CORS uniquely, so its message lists checks rather than asserting an unproven cause.

**Hosted change needing separate approval:** preserve the Preview and add production to the existing function secret:

```text
ALLOWED_ORIGINS=https://receiv-ledger-lt5n8xuzw-eugene-dd71.vercel.app,https://receiv-ledger.vercel.app
```

No wildcard or trailing slash. No redirect change is currently indicated by the read-only inspection. Vercel already embeds the expected frontend configuration; changing variable names is not indicated. Publishing this local UI requires separate review and deployment approval. No hosted settings, migrations, function deployments, GitHub or Vercel changes were made here.

After approved configuration, repeat negative HTTP checks: production preflight must return its exact origin, and an unauthenticated request must remain 401. Then conduct explicit wallet acceptance tests on a domain without a security warning. Do not bypass the unresolved MetaMask warning on the testing Preview or request signatures there.

## Staff access recommendation: not activated

The deployed contract has one manager, and the existing backend, manager mirror, review RPC and RLS recognise that primary wallet. There is no staff authorisation table or permission-aware RLS. A UI manager label or editable auth metadata cannot confer access. Current staff-claim regression tests verify this boundary.

A secure extension needs a separately reviewed migration and backend deployment:

1. Primary-manager-only invitation/grant/revoke endpoints, deriving the actor from a verified Ethereum session and rechecking the live contract manager. Grants bind a wallet to explicit scopes, expiry and revocation state; no public manager signup.
2. Backend-enforced scopes for application reads, selected document reads and information requests, with matching RLS/storage protection. Never expose the service-role key. Validate permissions on every request, including downloads; frontend menus alone are insufficient.
3. Append-only audit records for invitations, permission changes and application/document decisions, preserving actor wallet, target, scope, timestamps and reasons. Test forged roles, expiry, revocation, cross-wallet reads and stale sessions.
4. Keep chain investor approval and finalisation with the primary manager unless a separately designed contract change is approved. Staff review permission must not bypass the existing approval-receipt verification.

Read-only/off-chain staff permissions could be added without Solidity changes after that backend work. Giving staff independent on-chain manager powers requires a contract/governance redesign and separate approval; none is implemented. Real redemption, dividends and financing payments are also unsupported by the current contract and were not added.

## Verification and limits

Final local verification: `npm.cmd run typecheck` passed; `npm.cmd run typecheck:edge` passed; the full automated suite passed **301 tests across 19 test files**, with no failures; `npm.cmd run build` passed (256 modules). `git diff --check` passed. Node emitted the existing non-failing `--localstorage-file` warnings during tests. No `.env.local` or non-example environment file is tracked, and the tracked-file privileged-key/private-key pattern scan found no matches. This scan is a limited check, not proof that arbitrary secret formats could never exist. Solidity, ABI/deployed address, migrations, function sources and security configuration have no diff from `origin/main`. Automated tests cover onboarding, existing chain recognition, status gates, navigation, wallet/session isolation, contextual document races, handler/RLS privacy, forged staff claims, finance and transaction guards. No valid signature, transaction, approval or hosted write was executed. Browser visual inspection and successful hosted registration/approval/download flows still require manual acceptance.

## Manual acceptance order

1. **Welcome and manager:** check disconnected desktop/mobile layout and exact copy. Connect the known manager, confirm the six menu entries and support footer. Sign in only on a trusted, unflagged origin. Inspect each application filter, submitted details and fictional PDFs. Do not approve an investor unless explicitly ready to send the separately confirmed Sepolia transaction; SME review is off-chain.
2. **Investor:** try a new wallet, choose Investor, sign in once and submit fictional required fields. Verify confirmation, Pending Review and disabled transfers. Restore an existing application without choosing a new type. Check rejected/needs-information resubmission. With existing approved/revoked wallets, verify My Assets holdings/NAV assumptions, personal history and transfer availability without sending a transaction.
3. **SME:** submit fictional company details, inspect pending status and private KYC. For an already approved SME or legacy invoice wallet, compare Home totals/maturities/capacity with My Invoices, including repaid records. Confirm Submit Invoice is separate; stop before sending a transaction.
4. **Isolation and recovery:** switch between these wallets and disconnect; previous forms/details/PDF names must disappear. Another user must not download private PDFs or review applications via direct API. Test rejected signatures, blocked storage, unavailable Supabase and wrong network; real existing blockchain dashboards must retain clear loading/error states and no fabricated success.

## Files changed in this review

- `README.md`
- `docs/HANDOVER.md`
- `docs/REGISTRATION_RESTRUCTURE.md`
- `docs/SUPABASE_SETUP.md`
- `docs/WEBSITE_QA.md`
- `src/App.test.tsx`
- `src/App.tsx`
- `src/chain/LedgerContext.test.tsx`
- `src/chain/access.ts`
- `src/chain/chainLedger.test.ts`
- `src/chain/navigation.ts`
- `src/components/PrivateAccess.tsx`
- `src/finance/models.test.ts`
- `src/finance/models.ts`
- `src/finance/reporting.test.tsx`
- `src/pages/Account.tsx`
- `src/pages/Applications.tsx`
- `src/pages/Assets.tsx`
- `src/pages/Dashboard.tsx`
- `src/pages/Documents.tsx`
- `src/pages/Invoices.tsx`
- `src/pages/Registration.tsx`
- `src/pages/Reports.tsx`
- `src/registration/RegistrationFlow.test.tsx`
- `src/registration/client.test.ts`
- `src/registration/client.ts`
- `src/registration/handler.test.ts`
- `src/registration/onboarding.test.tsx`
- `src/styles.css`
