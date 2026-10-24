# Fund Manager recognition and private authentication

## Current findings — 24 October 2026

The prior 23 October fixes below are committed in `d0c063e`, including remote `main` confirmed with read-only `git ls-remote`. This review adds local uncommitted fixes; see [FINAL_WEBSITE_REVIEW.md](FINAL_WEBSITE_REVIEW.md) for exact files and evidence. Its current status supersedes older branch/publication wording below.

- Connecting MetaMask still recognizes the manager publicly through V2 `owner()`. Home, Financial Reports and manager fund operations need no private signature.
- The Applications prompt is expected when no usable private session exists. A new tab/origin, wallet/network change, explicit sign-out, revoked session or blocked browser storage can require verification. A valid same-origin, same-tab session must restore through server checks before private data appears.
- Two new regressions reproduced defects in the original code: an unrelated Auth user event during bootstrap could publish the older snapshot, and an expiring bootstrap token could sign out a session already refreshed by the SDK. Pending user identity is now guarded, the same-user refreshed token is retained, and a 401 retries validation once only for a different same-user SDK token. Unchanged/revoked/different-user credentials still fail closed.
- SIWE already uses the actual current browser host and origin-root URI. The known URI rejection now displays a targeted Auth configuration explanation; **Wallet sign-in help** shows the exact current root URL and Edge origin. No message is automatically signed and no private/backend permission is relaxed.
- Required Auth Site URL and exact Redirect URL: `https://receivledger.vercel.app/`. Existing registry origin: `https://receivledger.vercel.app` without slash. At approximately 09:51 SGT, current live CORS checks passed (204 official preflight, 401 unauthenticated bootstrap, 403 unapproved origin). Auth's hosted URL configuration remains uninspected.

Without a successful permitted sign-in, the user's particular hosted prompt cannot be proven to be first-time verification versus failed restoration. The error text identifies Auth URL rejection if it recurs; CORS is a separate boundary. No wallet signature was performed. Required manual acceptance remains: verify once, navigate Applications/documents, refresh the same tab, and test account/network/revocation isolation on an approved origin without security warnings.

Current verification: 439 tests across 31 files, TypeScript, both Edge checks and production build PASS. Original-code baseline failures and fixed-case passes are recorded in the full report. RLS, private storage, backend handlers, Solidity and financial execution locks are unchanged.

## Historical 23 October review

Local changes on feat/v2-financing-redemption, based on 671ba11 (23 October 2026, Asia/Singapore). No hosted setting, Solidity, contract address, ABI, migration, commit, push or deployment was changed. Existing untracked vercel-debug.txt was left untouched.

## Confirmed causes

1. src/registration/client.ts previously set persistSession:false. This allowed an active memory session to survive navigation/remounts within the running page, but a real browser refresh created a new SDK instance with no session. Another explicit signature was then required. Existing memory-session tests did not prove full page-refresh persistence.
2. LedgerContext previously derived the public role only from V1 manager()/legacy history. V2 owner() was not checked automatically. Public manager recognition therefore depended on the legacy role path, even though V2 was independently deployed.
3. The restore effect could sign out a session while the initial account was still empty during wallet discovery. Saving credentials alone would not fix this startup race.
4. Refreshed tokens were only applied through a scheduled state update, allowing an immediately started request to use an older token. An Auth event changing user identity was ignored, and a reload profile mismatch retained the previous private display. Both now invalidate/update state synchronously as appropriate.

A private signature for applications/KYC is intentional; connection or public owner detection cannot authorise private records.

## Implemented behaviour

- managerAuthority.ts reads owner() on V2 0x9672b0aec292c9f8dd8fefbc9daab876b8ec9882 using the connected Sepolia provider. The address is not compared to a hardcoded expected Manager to grant a role. Public recognition is scoped by account/epoch/network, polled every 12 seconds and invalidated on changes, failures or stale A/B/A responses.
- LedgerContext exposes isV2Manager/v2Owner and the public Manager workspace role separately from legacyRole. Existing V1 snapshots/events and runTransaction checks still use legacy authority and fresh V1 permissions. V2 recognition cannot grant V1 write rights.
- Manager Home and Financial Reports automatically load read-only V2 fund data, independently of Supabase sign-in. Existing V1 manager records remain in a labelled details section on Home.
- PrivateAccess uses the explicit **Verify Fund Manager Wallet** action. While session restoration/verification is pending it shows a status instead of asking the user to sign again.
- SDK credentials use sessionStorage, persistSession:true and automatic token refresh. This supports same-tab, same-origin page refreshes. No application/KYC/document data or cached manager role is stored for recovery; no auth credentials are written to localStorage. Browser-blocked storage falls back to memory and cannot promise refresh persistence.
- Every restored session goes through registry bootstrap and directory calls before private fields are published. Both server user ID and server-derived wallet must match the connected account. Stored credentials/claims are never sufficient authority.
- Normal navigation reuses the authenticated context. Token refresh is applied immediately; a different Auth user, wrong bootstrap profile, sign-out, network or account change clears private state. Stale responses are rejected.
- V2_EXECUTION_ENABLED remains false. No financial action was enabled.

A new official hostname has separate browser storage from the old hyphenated hostname. The user must verify once on the new origin; do not copy credentials between origins. Sessions may also need new verification after explicit sign-out, wallet changes, revocation or expiry without a usable refresh token.

## Backend/RLS boundary

The existing registry handler still validates the token with Supabase Auth getUser(), derives the wallet through rl_current_wallet(), and obtains its private-manager authority from the existing V1 chain manager(). Its protected rl_config mirror and RLS policies restrict applications, documents and audits. Private storage policies remain unchanged; no direct anonymous reads or client-controlled role claims were added.

Read-only chain checks at block 11976942 found V1 manager() and V2 owner() both equal 0x79b246212650b686a0e9e5726092b1558b35d974. No private-backend migration is needed merely for current owner recognition. If the owners diverge later, a V2 owner must not inherit legacy private records through frontend recognition: backend policy/receipt semantics require a separate reviewed change. An authenticated session that is not authorised by the backend cannot load manager applications.

## Official-origin compatibility

Live checks on 23 October 2026 at approximately 21:10 SGT for https://receivledger.vercel.app:

| Request | Observed |
|---|---|
| registry OPTIONS with official Origin and required headers | 204; exact Access-Control-Allow-Origin |
| registry POST without an auth token | 401, Sign in with your wallet first; exact CORS origin |

The official origin is currently permitted for registry CORS; no CORS edit is indicated. These checks intentionally do not authenticate or modify records.

Hosted Auth URL configuration was not inspected. Ensure Authentication → URL Configuration contains exact Redirect URL https://receivledger.vercel.app/ and the official Site URL. Ethereum Web3 must stay enabled. The frontend signs an origin-root URI, so redirects and the Edge origin allowlist are distinct. No wildcard, signature bypass, RLS relaxation, identity linking or MetaMask-warning bypass is needed.

The browser build still needs its normal VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY. No new variable, migration or backend deployment is required for these frontend fixes. Current local changes need separately approved publication before the hosted website can use them. Do not overwrite existing hosted secrets based on this local review.

## Verification

Final checks PASS: npm.cmd run typecheck; npm.cmd test (421 tests across 30 files, including 21 new regressions); npm.cmd run typecheck:edge (both functions); npm.cmd run build; git diff --check. Solidity, both ABIs, deployed-address metadata, backend function code, migrations and Supabase configuration have no diff. Solidity tests were not rerun because none of that implementation changed.

Tests include actual SDK credential recovery, server bootstrap before private state, initial empty-account startup, transient errors, rejected/mismatched sessions, immediate token refresh, forged manager claims, owner selection, A/B/A/epoch/network isolation, public dashboard independence, backend/UI denial for ordinary wallets and legacy transaction isolation. Existing server authorization, PostgreSQL RLS and private-document tests remain in the suite.

Successful hosted wallet authentication and desktop/mobile visual acceptance were not performed by the agent. No wallet prompt or transaction was approved. Test only on an origin without a MetaMask security warning.

Private acceptance must use an origin allowed by both registry CORS and Supabase Auth. Local private testing additionally needs its exact localhost origin/root redirect; these local hosted entries were not checked. The official website needs the separately approved updated frontend build before these local changes appear there.

## First manual check — two steps

1. Run npm.cmd run dev (or use a separately approved build), connect the current Manager on Sepolia, and open Home/Financial Reports. Expect owner-based recognition and public V2 reports with no private verification prompt or automatic signature.
2. Open Applications and click Verify Fund Manager Wallet once. After successful verification, navigate Home → Applications → private documents, then refresh the same tab. Expect server-validated restoration with no new signature while the session remains valid.

## Subsequent negative checks — a separate pair

1. Switch to an ordinary Investor/SME while private data or a request is visible, then A/B/A. Expect immediate clearing, no manager application data/actions and no late response from the previous session.
2. Sign out/revoke the session or test expired credentials, RPC failure and blocked storage. Expect explicit recovery/verification when necessary, no cached-role bypass and no public report dependence on private authentication.

Reference: [Supabase getSession](https://supabase.com/docs/reference/javascript/auth-getsession) documents credential recovery, not a private-authority guarantee; [client configuration](https://supabase.com/docs/reference/javascript/initializing) supports explicit auth storage. Backend Auth/RLS remains authoritative.
