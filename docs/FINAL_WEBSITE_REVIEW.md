# Final website review — 24 October 2026

All dates/times below are Asia/Singapore. This is a local review of the existing Vite/Vercel application. No hosted settings/data, contracts, transactions, wallet signatures, Git branches, commits, pushes, merges or deployments were changed.

## Repository and release status

- Checkout: `C:\Users\Eugen\Documents\GitHub\ReceivLedger`.
- Branch: `feat/v2-financing-redemption`; starting/current HEAD `d0c063eaa0e8546a2f872d143a7d04c4c637753e` (`fix v2 fund manager`). Working tree was initially clean; the files below are now local uncommitted changes.
- Local `main` and cached `origin/main` match HEAD. A read-only `git ls-remote origin refs/heads/main` also confirmed this exact remote main commit at approximately 09:51. No fetch or branch update was needed.
- The prior owner-recognition and sessionStorage fixes are committed and included in remote main. Whether Vercel's particular hosted deployment serves that commit could not be independently checked through the resetting production connection.
- Ready for GitHub review and, after the owner's approval, an **execution-disabled Vercel Preview**. Desktop/mobile visual review and hosted private authentication remain acceptance gates. Production financial execution is not ready.

## Authentication findings and resulting behaviour

The Applications verification prompt alone is not a bug: MetaMask connection and V2 `owner()` recognition grant public access, while applications/KYC need a server-validated Supabase session. A first visit on the permanent origin, a new tab, another hostname, sign-out, wallet/network change, revoked credentials or unavailable browser storage can require verification. Same-tab, same-origin refreshes should restore an existing valid session after backend validation, without another signature.

Two additional code defects were reproduced against the original implementation with the new regression tests:

1. During restoration, `SIGNED_IN` for a different Auth user was ignored while no authenticated state existed. An older bootstrap could then publish its private snapshot. The expected restoring user is now tracked; a changed Auth identity immediately invalidates the restoration generation and clears private state.
2. If an access token expired during bootstrap while the SDK had refreshed it, the 401 path cleared an otherwise usable session. Restoration now retries once only when the SDK supplies a different token for the **same user**, and repeats both server wallet/user validation and directory authorization. A refresh arriving during successful restoration is retained for subsequent requests. Revoked, unchanged or different-user credentials never bypass backend checks.

Public Home/Financial Reports continue to use V2 owner recognition without a private signature. Applications still requires one explicit verification when no valid session exists; valid sessions are reused across pages and same-tab refreshes. Wallet/epoch/network changes and unrelated Auth users invalidate private state; ordinary Investor/SME wallets remain excluded from manager records. V1 transaction authority remains separate, and backend Auth, RLS and private storage policies are unchanged.

The existing SIWE constructor already uses `window.location.origin`, host (including port), root URI with trailing slash, Sepolia chain ID, random nonce and a five-minute message lifetime. It does not sign a fixed production/Preview URL. The reported “URI ... not allowed ... another app” error indicates Supabase Auth rejected the signed URL. It does not establish a CORS failure or justify signing for a different origin. A targeted diagnostic and **Wallet sign-in help** disclosure now identify the exact current root URL and origin without displaying credentials.

The user's specific remaining hosted prompt cannot be definitively classified as first-time verification versus a failed restoration without a successful permitted wallet sign-in and same-tab refresh. No signature was requested or made in this review. Hosted Auth URL configuration was not accessible for inspection, so its current allowlist is unconfirmed. Supabase documents the Web3 URL restriction in [Web3 authentication](https://supabase.com/docs/guides/auth/auth-web3) and [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Manager Financing & Fund Requests

The shared manager route now opens a dedicated operations dashboard:

- **Fund overview:** automatically read V2 NAV, NAV per RLU2, available liquidity, outstanding principal and pending counts. Snapshot block/source and execution status are visible. Missing reads show Unavailable/dashes; zero is displayed only after a successful read. No S$10m placeholder appears in the overview.
- **Requests:** Investment Requests, Redemption Requests and Invoice Financing sections with pending/all filtering, applicant wallet, amount/units, status and public review details. Counts include funding/review/processing/refund obligations, allocated exits awaiting settlement and approved invoices awaiting financing. Relevant financial actions remain disabled with a visible explanation. The adapter's programmatic execution lock remains false/locked.
- **Dates/private details:** request structs have no stored submission timestamp. Submission dates explicitly show Unavailable; invoice maturity is shown in SGT. No date is inferred from the snapshot. Private names/KYC remain in Applications, and no V1 registration is treated as a V2 financial request.
- **Risk monitoring:** approved net cash commitments, allocated redemption cash, indicative pending redemptions, segregated funded subscriptions/SME reserves, overdue principal, SME concentration and payer exposure combined across SMEs. Gross commitments count toward exposure; net commitments reserve cash. Pending proposals reserve neither. Warnings use the implemented 1% SME acknowledgement boundary, S$100k combined SME cap, 10% payer financing limit, cash coverage, reporting-block maturity and manager valuation expiry. The 0.5%/0.8% display bands are explicitly identified as display bands, not contract rejection rules.
- **Scenario Analysis:** collapsed at the bottom; hypothetical NAV/liquidity start blank. Inputs can explore existing financing/commitment/automatic-facility rules without altering the live summary. The calculator uses the reviewed default V2 policy and is labelled accordingly.

Responsive CSS uses four/two overview columns, stacked mobile request selectors/counters, single-column risk panels and horizontally scrollable tables. Browser visual QA could not be completed: no browser surface was available and creating the in-app browser returned `Browser is not available: iab`. This limitation is not a visual pass.

## Live, hypothetical and disabled

The updated real `V2Ledger.readReport` adapter was smoke-tested read-only at approximately **09:57 SGT**, Sepolia block **11980697**. V2 owner matched `0x79b246212650b686a0e9e5726092b1558b35d974`. NAV, free liquidity, outstanding principal, active pricing units and valuation expiry were all zero; there were **0 investments, 0 redemptions and 0 invoices**. The UI must show that empty fund, not hypothetical capital. This is a dated snapshot, not a permanent balance assertion or a fresh runtime-bytecode verification.

| Feature | Status |
|---|---|
| V2 owner recognition and public fund/request/risk reporting | Implemented public Sepolia reads; read-only smoke passed |
| SGD/RLU2 economic meaning | University simulation; no real monetary value or SGD payment rail |
| Scenario calculator | Browser-only hypothetical estimates; no saving, submission or permission grant |
| Confidential applications and PDFs | Existing authenticated registry, backend authorization, RLS and private storage |
| V2 private registration/document binding | Integration/hosted acceptance incomplete |
| V2 financing, funding, subscriptions, redemptions, collections and automation | Financial execution disabled; no signing or transactions enabled |
| V1 records/accounting/permissions | Preserved independently; no import into V2 |

## Permanent URL and exact external requirements

The permanent URL remains **https://receivledger.vercel.app/**. The Vercel project is named `receiv-ledger`; the project name does not require changing the chosen public alias.

| Setting | Exact required value |
|---|---|
| Supabase Authentication → URL Configuration → Site URL | `https://receivledger.vercel.app/` |
| Supabase Authentication → Redirect URLs | `https://receivledger.vercel.app/` |
| Existing registry Edge Function `ALLOWED_ORIGINS` | Include `https://receivledger.vercel.app` (no trailing slash) |
| Optional approved local Auth redirects | `http://localhost:5173/`, `http://localhost:4173/` |
| Optional approved local registry origins | `http://localhost:5173`, `http://localhost:4173` |
| An approved Vercel Preview | Its exact actual `https://<preview-host>/` in Auth and `https://<preview-host>` in registry origins |
| Frontend build | Existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the applicable Production/Preview environment |
| Inactive registry-v2 | `V2_ALLOWED_ORIGINS` is a separate future integration setting; do not activate/configure it merely for this frontend change |

Keep the production Site URL stable; add exact approved Preview roots rather than replacing production or adding broad wildcards. Preserve other deliberately authorized origins; do not overwrite an existing list blindly. Ethereum Web3 must remain enabled. No new environment variable, migration, backend deployment, RLS change or Vercel configuration change is required by this patch. If the exact Auth root is missing, correcting that hosted setting requires the owner's separate approval. CORS is already accepting the permanent origin based on current read-only evidence.

No hard-coded Vercel deployment URL exists in production frontend sign-in, navigation or redirects. `/v2.html` redirects relatively to `/`; `vercel.json` only rewrites to `/index.html`. Old hyphenated/unique URLs in historical documentation and a historical test fixture do not steer production traffic. Origin regression coverage now includes the official hostname, a synthetic approved Preview and localhost with a port.

### Read-only network evidence, approximately 09:50–09:52 SGT

| Check | Result |
|---|---|
| Local/default DNS A lookup | `216.198.79.3`, `64.29.17.3`; resolved, not NXDOMAIN at this time |
| Google DNS-over-HTTPS A lookup | Status 0; `64.29.17.67`, `216.198.79.67` |
| Permanent HTTPS HEAD | curl error 35, connection reset; no HTTP application response |
| HTTPS forced to Google's returned public IP with correct hostname/SNI | Same connection reset |
| Registry OPTIONS, exact permanent Origin | HTTP 204 and exact `Access-Control-Allow-Origin` |
| Registry POST bootstrap without credentials | HTTP 401 |
| Registry OPTIONS from unapproved synthetic origin | HTTP 403 |

Initial sandboxed HTTP attempts were blocked by the local execution sandbox. The evidence above was repeated outside it through approved read-only tool execution. Different public resolver answers alone do not prove bad DNS because Vercel uses distributed routing. A connection reset with correct hostname/SNI after resolving the public address is a pre-application DNS/TCP/TLS/network/edge issue; these checks cannot identify whether the cause is ISP/router filtering, endpoint security, TLS interception or Vercel's edge. No TLS certificate was obtained, so certificate health is unverified. Intermittent historical NXDOMAIN remains compatible with resolver/network problems but was not reproduced in this check.

For follow-up, compare the same exact URL on another trusted network and inspect the existing Production domain assignment/source commit read-only. Preserve timestamped evidence for network/Vercel support; the existing `vercel-debug.txt` was left untouched and should be reviewed for private network details before sharing. Do not change the official URL, add domains or bypass security warnings to work around this. See [Vercel connectivity troubleshooting](https://vercel.com/kb/guide/troubleshooting-connectivity-issues).

## Verification

| Check | Result |
|---|---|
| New Auth regressions against original HEAD implementation | Both targeted tests failed, reproducing unrelated-user restoration and refreshed-token sign-out defects |
| `npm.cmd run typecheck` | PASS |
| `npm.cmd test` | **439/439 PASS, 31 files**; frontend/backend, PostgreSQL RLS/private documents, roles, wallet switching, session recovery and financial scenarios |
| `npm.cmd run typecheck:edge` | PASS, both registry entry points |
| `npm.cmd run build` | PASS, TypeScript + Vite production output |
| Updated public V2 report adapter on Sepolia | PASS at block 11980697 |
| Local root and temporary dashboard review route | HTTP 200; temporary review harness removed after use |
| `git diff --check` | PASS |
| Browser desktop/mobile and successful hosted SIWE refresh | NOT RUN: browser unavailable; no wallet signing authorized |

Existing non-failing Node local-storage warnings remain. The full offline Solidity suite was not rerun because neither contract, ABI nor execution code changed; contract/business scenario and adapter regressions remain in the passing frontend/backend suite. No hosted end-to-end lifecycle is claimed.

## Exact files changed

| File | Change |
|---|---|
| `src/registration/RegistryContext.tsx` | Restoring-user invalidation, guarded token refresh/retry, targeted origin error |
| `src/registration/RegistryContext.test.tsx` | Auth origin and restoration/refresh regressions |
| `src/registration/auth.ts` | Recognize the specific Supabase SIWE origin rejection |
| `src/registration/security.test.ts` | Actual-origin message coverage for official/Preview/local URLs |
| `src/components/PrivateAccess.tsx` | Current exact sign-in URL/origin help |
| `src/v2/ManagerOperations.tsx` | Dedicated public manager dashboard and collapsed scenario analysis |
| `src/v2/operations.ts` | Request lifecycle labels/actions, pending totals and risk calculations |
| `src/v2/operations.css` | Responsive dashboard layout |
| `src/v2/operations.test.tsx` | Accounting/risk, requests, unavailable/empty states, scenarios and public-read isolation |
| `src/v2/UnifiedWorkspace.tsx` | Direct manager dashboard routing without applicant-status boilerplate |
| `src/v2/V2App.tsx` | Manager dashboard selection; existing Investor/SME tools retained |
| `src/v2/V2Ledger.ts` | Same-block public valuation expiry getter for risk monitoring |
| `src/v2/config.test.tsx` | Assert automatic manager public reads and disabled execution |
| `src/App.test.tsx` | Updated manager navigation assertions and isolated public read mock |
| `HANDOVER.md` | Current local review status and report link |
| `TESTING_CHECKLIST.md` | New automated evidence and remaining manual checks |
| `docs/MANAGER_AUTH.md` | Current Auth findings and acceptance limits |
| `docs/SUPABASE_SETUP.md` | Exact permanent-origin configuration and evidence |
| `docs/FINAL_WEBSITE_REVIEW.md` | This complete report |

## Remaining acceptance work

1. Owner reviews the uncommitted diff before approving any commit/push or Preview. No approval is assumed by this report.
2. On a permitted origin without a wallet security warning, the owner verifies the Manager once, navigates between private pages, refreshes the same tab and confirms session reuse. Repeat negative wallet/role/network/revocation checks. If URI rejection recurs, inspect the exact Auth root above; do not change the SIWE message to claim another host.
3. Complete desktop/mobile visual review, including long wallets/identities, populated request tables, review details, unavailable RPC and empty-fund states. Current populated automated fixtures are test-only.
4. Resolve production HTTPS resets with network/hosting evidence; confirm the actual Production source commit/domain assignment. Neither passing build tests nor registry CORS proves the website's TLS path is healthy.
5. Keep V2 execution locked until canonical private identity/document integration, funding/receipt validation and approved full lifecycle tests are complete. Submission-date display would require trusted creation-event/indexer data; no contract change is proposed.
