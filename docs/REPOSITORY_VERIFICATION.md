# Repository verification: Phases 4, 5A and 5B

Verified 22 October 2026. This report describes the actual checkout and fetched Git history; the individual phase reports remain historical implementation records.

## Repository and branch findings

- Working directory and Git root: `C:\Users\Eugen\Documents\GitHub\ReceivLedger`.
- Current development branch: `feat/phase4-supabase-audit`.
- The working tree was clean before this audit.
- Both local `main` and the fetched `origin/main` point to `45731cc` (`update batch 2 & 3`).
- The development branch and `origin/feat/phase4-supabase-audit` point to `4b77a80` (`phase 5B`), a direct child of `45731cc`.
- Live `git ls-remote` confirmed those same GitHub branch hashes at the time of verification. The configured origin is `github.com/eugeniuslee/ReceivLedger.git`; its fetch refspec covers all branches.
- All six reachable commits, both local branches, remote-tracking branches and the local reflog were inspected. No additional local branch or reachable newer main commit needed recovery. The complete Phase 4/5A/5B additions are already together in `4b77a80`; no cherry-pick or merge was needed or performed.

The recently reported main merge is not reflected in this configured remote's current main reference. A ZIP exported from main at `45731cc` omits the phase additions. This is a branch/content difference, not loss of the work from this repository. The ZIP itself was not supplied for byte-for-byte comparison.

## Source and test audit

| Scope | Development branch finding | Difference from main |
|---|---|---|
| Phase 4 | Ethereum signed-message Auth, protected identity/session wallet derivation, owner/manager RLS, manager-only reviews, private PDF validation/download, wallet/network isolation and restrictive storage deletion guard are implemented. `src/registration/`, Edge shared code and actual SQL tests cover the security boundaries. | Main has the original Batch 2 backend/migration 001; the additional security fixes, migration 002 and Phase 4 report are in `4b77a80`. |
| Phase 5A | Borrowing limits, advance/fee/settlement calculations, payer exposure, maturity/repayment, NAV/ownership/holdings and manager/SME/investor reporting exist. Financial reads are pinned to one block and unusable invoice mappings fail explicitly. Finance tests cover zero/negative/boundary inputs, repayments without double-counting, missing data and wallet isolation. | Main already has Batch 3 financial features; the Phase 5A corrections, expanded tests and report are in `4b77a80`. No financial rewrite was needed. |
| Phase 5B | Welcome choices, connect/sign-in, full Investor/SME forms, private saved details, pending role-specific interfaces, website action guards, fresh approval rechecks, manager information requests/approval, rejected/suspended/revoked states and legacy-wallet compatibility are implemented. | Main has the earlier registration implementation; the expanded onboarding, migration 003 and Phase 5B report are in `4b77a80`. One empty-account notification edge case was reproduced and fixed during this audit. |

Required documentation is present and tracked at development HEAD: `docs/PHASE4.md`, `docs/PHASE5A.md`, `docs/PHASE5B.md`, `docs/SUPABASE_SETUP.md`. All three migrations are present and tracked:

1. `202610220001_registration_documents.sql`
2. `202610220002_private_document_delete_guard.sql`
3. `202610220003_application_onboarding.sql`

Main at the inspected commit contains migration 001 and the setup guide, but not the three phase reports or migrations 002/003. Actual source and tests were inspected in addition to these filenames.

## Necessary corrections made in this audit

1. **Public welcome after account removal:** MetaMask's `accountsChanged([])` cleared the wallet/profile state but left `loading=true`. Home stayed on the role-loading message rather than returning to the public welcome. `src/chain/LedgerContext.tsx` now clears loading when no account remains. A regression test failed before the fix and passes afterward. Two additional provider/UI integration tests verify initial welcome behavior with no injected wallet and with an installed but disconnected wallet. No transaction is simulated by these new tests.
2. **Vite environment template:** `.env.example` had `NEXT_PUBLIC_SUPABASE_*` variable names, although this project uses Vite and reads `VITE_SUPABASE_*`. Only the two variable names were corrected. Existing browser-safe Project URL/publishable-key values were preserved without printing them. The example file itself is not loaded by Vite; configuration must be placed in ignored `.env.local`.

No phase files were missing from the development branch, so none were reconstructed or copied over newer work. Existing numerical formulas, application permissions, SQL migrations, contract write methods and financial reports were preserved.

## Files added or modified by this audit

| File | Change |
|---|---|
| `.env.example` | Correct two variable names for Vite; preserve browser-safe values. |
| `src/chain/LedgerContext.tsx` | Clear the loading flag on an empty account notification. |
| `src/chain/LedgerContext.test.tsx` | Three real-provider/UI integration regressions using mocked read-only wallet responses. |
| `docs/SUPABASE_SETUP.md` | Clarify Vite configuration and link this branch-verification report. |
| `docs/REPOSITORY_VERIFICATION.md` | This audit, validation results and review/integration recommendation. |

## Verification results

- `npm.cmd run typecheck`: passed.
- `npm.cmd run typecheck:edge`: passed.
- `npm.cmd test`: **237 tests passed in 16 files**, including all 234 pre-existing checks and the three added regressions.
- `npm.cmd run build`: passed.
- `git diff --check`: passed.
- Test/build execution required access outside the filesystem sandbox for the existing Vite/esbuild configuration. Edge checking used Deno/npm tooling. No deployed function was invoked.
- SQL security tests ran only in disposable in-memory PostgreSQL with representative Auth/Storage tables. No Supabase-hosted migration or storage operation was performed.

The existing Node/jsdom local-storage warning is non-fatal. These checks do not establish live MetaMask, hosted Supabase or deployed frontend acceptance; those remain separately guided setup/manual verification.

## Contract and secret checks

- Sepolia contract address remains `0x18c6751a1a116053e413459464c9b1af356dbf1f`, consistently in the frontend ABI configuration and Edge domain configuration; chain ID remains `11155111`.
- `contracts/` and `src/chain/abi.ts` have no differences between inspected main and development HEAD, or in the audit working changes. No Solidity modifications or Sepolia transactions were introduced.
- `.env.local` is untracked and ignored by `.gitignore`; no `.env.local` appears in reachable Git history. It is currently absent from this actual checkout. Earlier user-reported local setup does not change that filesystem finding; no ignored environment file was created, copied or overwritten by the audit.
- Only the root and Edge `.env.example` files are tracked as environment files. The root values were classified as a browser-safe HTTPS project URL and a publishable key, without echoing values. No service-role or wallet credential was found there.
- Targeted scans of all six reachable commits found no literal Supabase secret keys, service-role JWTs, private-key blocks or credential assignments matching the checked patterns. Synthetic short rejected-key fixtures were excluded. This is a scoped scan, not a guarantee against every possible encoded secret. No credential values were printed.

## Hosted activation still required

Use [SUPABASE_SETUP.md](SUPABASE_SETUP.md) for the actual setup inventory: ignored Vite environment variables, Ethereum provider, exact local redirect roots, Data API/public exposure, approved migration history and migrations 001–003, private bucket/policies, trusted read-only Sepolia RPC and exact origin secrets, server-only injected credentials, and separately approved deployment of matching `registry` code. The owner previously reported enabling Ethereum authentication; hosted state was not inspected or changed in this audit. Confirm only outstanding items rather than repeating already completed settings or raw SQL.

Private application data remains off-chain. Website gates preserve legacy access and cannot prevent arbitrary direct `submitInvoice` calls permitted by the deployed Solidity contract. Off-chain approval never creates live investor approval or overrides revocation. Financial scenarios remain illustrative, separate from actual full-face contract accounting; no new financial feature was added.

## Review and safest GitHub integration

The phase implementation is already committed and present on the remote development branch at `4b77a80`. The five audit files above are uncommitted local changes on that same development branch; nothing was staged, committed, pushed, merged or deployed during this audit.

After owner review/approval, the safest route is to commit these audit fixes to the current feature branch, push that branch, and review a pull request from `feat/phase4-supabase-audit` into `main`. Re-fetch before final integration to catch any intervening main changes. The currently inspected main is an ancestor of the development branch; do not assume that relationship remains unchanged later. Confirm the merged main contains the phase reports, migrations 001–003 and verified source before exporting a main ZIP. No integration action is authorized or performed by this report.

Stop here for review. This audit does not start another development phase.
