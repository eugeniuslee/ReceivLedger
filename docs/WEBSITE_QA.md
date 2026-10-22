# ReceivLedger website integration and QA

Current review: 22 October 2026. Repository: `C:\Users\Eugen\Documents\GitHub\ReceivLedger`, branch `feat/phase4-supabase-audit`. This pass changes local frontend code, tests and documentation only. It does not deploy, request a wallet signature, send a transaction, or change hosted settings.

## Completed local improvements

- Visible branding and the sign-in statement consistently use **ReceivLedger**. Contract names, deployed address, database identifiers and browser storage keys are preserved.
- Desktop main navigation stays above a bottom support group. On short desktop viewports only the main navigation can scroll. Tablet/mobile navigation wraps into a grid; the prototype note remains beneath Settings, Help & Support and About.
- Public onboarding offers Investor/SME entry points, an explicit connect button and official MetaMask installation/help. Connecting never automatically signs a message or sends a transaction.
- Wallet changes return Home, invalidate private requests and clear previous-wallet records. Same-wallet navigation and the existing disconnected/no-account loading fixes are preserved.
- Cancellation messages distinguish connection, sign-in and transaction requests. Structured/verbose provider errors, credential-like strings, signatures and URLs in errors are replaced with safe feedback.
- Pending dashboards show Pending Review, the submitted name/company, an illustrative three-working-day target and disabled financial action buttons with reasons. Existing rejected, needs-information, suspended and revoked status rules remain. Legacy users without an application retain their blockchain functions; an application never grants a Solidity role.
- Registration refresh failures propagate to the page and clear on retry. A refreshed profile cannot be adopted for a different wallet. Saved applications are distinguished from subsequent refresh failures.
- Applications and Documents distinguish loading, error, refreshed and confirmed-empty states. A delayed document response from an earlier selected application cannot replace the current list. Approved applicants start with invoice-document upload instead of an unavailable KYC purpose.
- Manager navigation follows Home → Applications → Investors → Invoice management → Financial reports → Documents → Transaction history. Existing signed manager review, approval-receipt validation and finalization retry are preserved.
- SME Home separates outstanding financed face value and repaid counts. Repaid principal is excluded from outstanding. Home maturity dates use Singapore time and existing overdue calculations. Unavailable invoice records are not presented as zero counts.
- Invoice and transfer success feedback follows the existing transaction runner's confirmed receipt. No transaction was executed during this work.
- Existing Batch 3 models, same-block financial reads, payer normalization, fees/advances, NAV assumptions, inactive holdings and report access remain intact. Only presentation and safe error handling changed.

## Registration and permissions

New visitor flow: connect → choose Investor or SME → explicitly sign in → complete the fictional form → submit → view the saved application dashboard → upload a fictional KYC PDF. The manager must verify KYC before approval. Information requests and rejected applications can be corrected/resubmitted; approved and restricted applications remain locked as designed.

Investor approval combines an explicit manager Sepolia transaction with off-chain finalization. The server checks the exact successful approval transaction, event, current approval mapping and two confirmations. If recording fails after confirmation, reuse the retained hash rather than sending another approval. SME verification is off-chain only. Off-chain suspension/revocation never substitutes for Solidity investor revocation. Solidity does not enforce SME registration; direct contract calls remain possible.

Private contact information, UEN/company numbers and PDFs require signed wallet authentication. The server verifies the token and active Web3 session, derives the wallet from protected Supabase identity data and reads the manager from the unchanged contract. Review RPCs are service-role-only. Document lookup uses user-scoped RLS before privileged download. UI roles and CORS are not substitutes for these controls.

## Backend activation already completed

The preceding approved activation verified project `gltivccwuryzlgpqvyll`: migrations `202610220001`, `202610220002`, `202610220003`; five RLS-protected tables; four application and three storage policies; private PDF-only `receiveledger-documents` bucket with a 5 MB limit; and `registry` version 1 ACTIVE. Six live negative/preflight HTTP checks passed. These earlier checks are not successful registration acceptance and were not repeated against hosted resources during this local QA pass.

Server settings match the approved public Sepolia RPC and exact Preview origin `https://receiv-ledger-lt5n8xuzw-eugene-dd71.vercel.app`. Auth includes that origin's root redirect with a trailing slash and preserves the pre-existing entry. No wildcard origins were added. Supabase injects the runtime project URL and client/service keys; privileged keys do not belong in frontend variables.

The frontend requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at build time. Local `.env.local` and Vercel build configuration are independent. Current local changes are not on Vercel until separately approved publication. Changing domains requires separately approved exact origins/redirects, never a wildcard or an evasion of MetaMask warnings. See [SUPABASE_SETUP.md](SUPABASE_SETUP.md).

## Verification and limitations

Run `npm.cmd run typecheck`, `npm.cmd run typecheck:edge`, `npm.cmd test` and `npm.cmd run build`. No separate lint/format script is configured; `git diff --check` checks patch whitespace. Tests use mocks and disposable in-memory PostgreSQL, not hosted records or wallet operations. Financial fixtures are never runtime substitutes. Final local results: TypeScript passed; Edge Function type checking passed; all 286 tests across 19 files passed (26 regression tests added); production build passed; `git diff --check` passed. The Node 25 test runtime emitted its existing local-storage-file warnings without test failures.

The temporary-file audit found `supabase/temp/` absent and only ignored CLI metadata (`cli-latest`, `linked-project.json`) in `supabase/.temp/`. No activation authentication helpers remain. Only the two `.env.example` templates are tracked. A targeted pattern scan found no privileged credentials in tracked runtime/configuration/documentation files; this does not audit every historical Git object.

Hosted sign-in, registration persistence, real wallet isolation, manager review and PDF access remain unverified end to end. The testing Preview produced a MetaMask **Malicious site** alert during a signature request; the user cancelled. Do not retry, sign, disable protections, evade the alert with another domain or bypass it. Investigation is on hold. Supabase activation does not resolve the classification.

No browser surface was connected for visual automation. Responsive CSS and DOM behavior were reviewed locally, but desktop/tablet/mobile rendering, touch interaction and visual focus need manual acceptance. Test approximately 1440×900, 1024×768, 768×1024, 390×844 and 320×568, plus a short desktop viewport. Check sidebar/footer, wrapping, table scrolling, dialogs, forms and errors without horizontal page overflow.

The contract finances full invoice face value, records simulated SGD and collects no modelled fees. NAV, advances, SME settlements and borrowing recommendations are illustrations, not redeemable balances or payments. Repaid invoices remain historical. No redemption, withdrawal, dividends or automatic overdue blocker exists. PDF filtering is a demo check, not antivirus/identity verification; the 20-document cap is best-effort and lists return the latest 200 records.

## Manual acceptance checklist

Start with no-wallet checks. Signature and transaction checks are deferred until the warning is resolved and the owner permits them on an approved origin. Never approve prompts during this QA pass.

| Role | Checks in order |
|---|---|
| New visitor | Without MetaMask, see welcome and official help. With a disconnected/locked wallet, see explicit connection and concise cancellation feedback. Investor/SME choices lead to the correct form after separately permitted sign-in. No automatic signature occurs. |
| Fund Manager | Check navigation, Home, invoices, history and financial reports. After permitted sign-in, check private list loading/error recovery, fictional details, authorised PDFs and information requests. Separate SME verification from investor approval. Do not approve a transaction without permission; reuse confirmed hashes for finalization retry. |
| Investor | Check authenticated name/wallet, on-chain holdings, ownership and labelled NAV/holding-value assumptions. Pending/restricted users cannot transfer. Inactive investors retain holdings/history. Transfer confirmation/rejection needs separate permission; no redemption or dividends should appear. |
| SME | Check authenticated company/UEN, status, pending reason and fictional documents. Verify face value, SGT maturity, financed/repaid filters, overdue indicators and outstanding excluding Repaid. Fees/advances remain illustrative; contract financing uses face value. Sepolia invoice submission needs separate permission. |

For each authenticated role, switch wallets: Home opens immediately with no previous private name, form, PDF or report. Returning to the first wallet requires fresh private authentication. Same-wallet refresh preserves permitted navigation and shows feedback. Simulate unavailable reads through local tests rather than changing hosted data or RPC settings.

Deployment readiness: safe local work is ready for review, uncommitted and unpublished. Hosted wallet acceptance and browser visual checks remain release limitations.


## Files changed in this local pass

- `README.md`
- `docs/HANDOVER.md`
- `docs/SUPABASE_SETUP.md`
- `docs/WEBSITE_QA.md`
- `src/App.test.tsx`
- `src/App.tsx`
- `src/chain/LedgerContext.test.tsx`
- `src/chain/LedgerContext.tsx`
- `src/chain/access.ts`
- `src/components/BlockchainRefresh.tsx`
- `src/errors.test.ts`
- `src/errors.ts`
- `src/finance/FinanceContext.tsx`
- `src/finance/reporting.test.tsx`
- `src/pages/Account.tsx`
- `src/pages/Applications.tsx`
- `src/pages/Dashboard.tsx`
- `src/pages/Documents.tsx`
- `src/pages/InvestorAdmin.tsx`
- `src/pages/Investors.tsx`
- `src/pages/Invoices.tsx`
- `src/pages/Registration.tsx`
- `src/registration/RegistrationFlow.test.tsx`
- `src/registration/RegistryContext.test.tsx`
- `src/registration/RegistryContext.tsx`
- `src/registration/auth.ts`
- `src/registration/onboarding.test.tsx`
- `src/styles.css`
