# ReceivLedger — developer handover

**23 October 2026, Asia/Singapore.** University demonstration; SGD accounting is simulated. No real payment rail or investor distributions.

## Repository and handover status

Use `C:\Users\Eugen\Documents\GitHub\ReceivLedger`, **feat/v2-financing-redemption**, starting HEAD `082c54d`. Do not use the old OneDrive frontend/export or create a replacement repository. Existing local integration edits were preserved. Everything remains uncommitted; no push, merge, Vercel deployment, hosted change, contract deployment or wallet signing occurred in this integration.

There is **one ReceivLedger website at /**. The existing Manager, Investor and SME Home screens link to the shared Financing & Fund Requests workspace. `/v2.html` redirects to /. Its compatibility module also mounts the shared app. There is no second public V2 homepage.

**Release assessment:** an execution-disabled Vercel Preview is appropriate after explicit approval and successful checks. Production financial release is blocked. V2 is deployed and verified on Sepolia, but private V2 identity/document binding and signed execution handlers are incomplete, and the documented MetaMask warning is unresolved. Do not call a draft request submitted, or a scenario balance real.

## Architecture and important branches/files

| Area | Main files / responsibility |
|---|---|
| Shared website | src/App.tsx, src/chain/access.ts, navigation.ts; role navigation, Home, accounts and existing registration |
| V1 chain | src/chain/LedgerContext.tsx, chainLedger.ts, abi.ts; wallet epochs, live permissions, guarded writes, snapshots and cached events |
| Private registration | src/registration/, pages/Registration.tsx, Applications.tsx, Documents.tsx; wallet-signed Supabase sessions and private profiles/PDFs |
| Existing backend | supabase/functions/registry/, _shared/, migrations/; server-derived wallet/session, RLS, private storage and receipt validation |
| Existing financial scenarios | src/finance/, FinancialModels.tsx, Reports/Assets pages; V1 public records and labelled illustrations |
| Unified V2 operations (execution locked) | src/v2/UnifiedWorkspace.tsx, V2App.tsx, RequestPanels.tsx; stakeholder summaries, quotations and locked request/review drafts |
| Public deployment/configuration | src/v2/deployment.json, config.ts; verified Sepolia address/chain/block/hashes, optional matching build override |
| V2 reporting | V2Ledger.ts, usePublicReport.ts, Reports.tsx, reporting.ts; same-block requests, holdings, accounting, exposures and real NAV event links |
| Release lock | src/v2/activation.ts; false constant and adapter rejection, independent of address/environment inputs |
| Reviewed V2 contract | contracts/ReceivLedgerV2.sol, src/v2/abi.json; unchanged |
| Inactive V2 onboarding | supabase/v2/registration.sql, _shared/v2registry.ts, functions/registry-v2/index.ts; not activated or wired to shared registration UI |
| Read-only deployment verifier | scripts/verify-v2-deployment.mjs, docs/V2_DEPLOYMENT_VERIFICATION.md/.json; receipt, bytecode, ABI and Manager evidence |
| Historical offline deployment tools | scripts/compile-v2.mjs, prepare-v2-deployment.mjs, v2-deployment-policy.mjs, v2-amsterdam-dry-run.mjs |
| Checks | src/**/*.test.*, test/v2/*.test.mjs; frontend/server/disposable SQL and local compiled EVM |
| Build | package.json, lockfile, vite.config.ts, vercel.json; Vite static output dist |

Other historical branches: main, fix/live-testing-auth-invoices, feat/registration-ux-restructure, feat/phase4-supabase-audit. Do not switch/merge with this uncommitted tree. Older reports describe earlier preview designs and test counts. Current business rules: [V2_BUSINESS_RULES](docs/V2_BUSINESS_RULES.md). Current deployment tooling corrections: [V2_DEPLOYMENT_TOOLING_PREFLIGHT](docs/V2_DEPLOYMENT_TOOLING_PREFLIGHT.md), which supersedes older gas guidance.

## Implemented and testable locally

- Existing welcome, wallet-linked application/status/name interface, three dashboards, application review, private fictional PDFs, V1 assets/invoices/history retained.
- Investor scenario: S$10,000 lifetime automatic allowance, usage across linked identity wallets, larger requests needing review; redemptions do not reset usage. Approval and manager-confirmed funding are still required.
- SME quote: S$5,000 automatic invoice threshold, S$50,000 automatic facility, S$100,000 combined hard cap, outstanding principal/approved commitments, 30-day automatic and 90-day manual review, payer concentration, liquidity and 1% NAV warnings. Inputs are assumed evidence, not verified data.
- S$20 processing withheld once; 8% simple annual interest; 100% gross advance up to S$5,000 face and 90% above it. Quotes show gross/net, reserve, estimated interest, payer offset, top-up and reserve release. Solidity uses actual seconds/unpaid principal; quote assumes unchanged principal over entered days.
- Investment/redemption/manager-review drafts work without saving or signing. All V2 execution controls and the adapter are locked.
- Public reads of the verified deployment can show same-block NAV/assets, supply/holdings, NAV per RLU2, ownership including pending exit escrow, allocated claims, liquidity/obligations, request states, invoice repayment breakdowns, SME/payer concentrations and real transaction-level NAV/income events. The verified public address is the default; no V2 transaction is invented. The real frontend adapter read passed on the empty fund.
- Reports fail rather than truncate above 1,000 records of each type. NAV event history is at most 10,000 blocks, queried in 2,000-block pages; it is not lifetime return reporting.
- Account, epoch, network and A→B→A changes invalidate pending public reports. Existing private session/name/document isolation remains in place.

## Inactive and incomplete

V2 deployment and current runtime/owner checks are verified; see [deployment evidence](docs/V2_DEPLOYMENT_VERIFICATION.md). Explorer source publication was not verified. Hosted V2 onboarding and controlled signed-wallet acceptance remain incomplete. Optional `VITE_V2_CONTRACT_ADDRESS` confirms the checked-in verified public-read default and never enables execution.

Shared registration/review/documents remain the existing V1-compatible architecture. The isolated V2 registry is not yet called by that frontend. The next developer must integrate explicit immutable canonical V2 identities, exact V2 permission-receipt finalization and private document linkage scoped by contract/version. V1 approval does not grant V2 permission, and an equal invoice ID across versions does not prove document ownership.

Signed request/execution handlers, fresh private permission checks, complete manager funding/attestation/valuation/impairment controls, cancellation/refund recovery and receipt-driven refresh still need implementation/integration. Current manager inputs are drafts, not a complete operator console. No keeper, hosted signer, operator custody, real SGD rail or V1 migration exists.

## V1 / V2 separation

| Item | V1 | V2 |
|---|---|---|
| Sepolia address | 0x18c6751a1a116053e413459464c9b1af356dbf1f | 0x9672b0aec292c9f8dd8fefbc9daab876b8ec9882; block 11974932 |
| Source / ABI | contracts/ReceivLedger.sol, src/chain/abi.ts | Reviewed ReceivLedgerV2.sol, src/v2/abi.json |
| Units | RLU, 0 decimals | RLU2, 2 decimals; raw 100 = 1.00 RLU2 |
| SGD | Existing whole-unit simulation | Integer cents |
| Accounting | Full-face financing, no fee/redemption | Separate fee/accrual/commitment/redemption accounting |

No legacy balances, units, invoices, permissions or history are imported automatically. V2 was empty at the recorded verification snapshot, not funded with calculator scenario NAV. Always refresh current state. The S$10m limit is a capital-admission ceiling. The adapter rejects zero/V1 addresses. Never replace src/chain/abi.ts with V2 configuration.

## Run and test locally

First pair:

1. In the real repository, use `npm.cmd ci` if dependencies are absent, then `npm.cmd run dev`. Keep the development server local.
2. Open http://localhost:5173 for no-signature scenarios and disabled controls. Do not sign on a flagged origin.

Verification commands:

```powershell
npm.cmd run typecheck
npm.cmd run typecheck:edge
npm.cmd test
npm.cmd run test:solidity
npm.cmd run compile:v2
npm.cmd run build
git diff --check
```

Use a supported current Node/npm compatible with the lockfile and EthereumJS packages. Windows PowerShell may require npm.cmd. Frontend/backend tests use mocks and disposable local PostgreSQL; they do not migrate hosted data. Solidity tests compile into a local EVM without keys/signatures/broadcasts and include a multi-minute 100-loan stress test. Edge checking may download Deno. compile:v2 does not write ABI unless explicitly passed --write-abi; do not use that option here.

Previous unified-integration checks (before this deployment-status update): TypeScript PASS; both Edge Function entry points PASS; frontend/backend/database suite **388/388** across 26 files PASS; offline Solidity **93/93** PASS (including compiler/ABI, source verification and deployment regressions); production build PASS; git diff --check PASS. V1/V2 Solidity, V1 ABI/address, V2 ABI, migrations and checked-in Supabase configuration show no integration diff. Reviewed source/ABI hashes remain exact. Standalone compile:v2 also passed: runtime 23,735 bytes, no compiler warnings.

Deployment-status update checks: frontend/backend/database **400/400** across 27 files PASS; TypeScript and production build PASS; both Edge Function entry points PASS; live read-only receipt/runtime/creation/ABI/Manager verification PASS; actual frontend public-read adapter smoke check PASS. Focused offline deployment/compiler/source-verification regressions: **6/6 PASS** for this update. The prior full offline Solidity suite was 93/93; it was not rerun because Solidity and ABI are unchanged. Whitespace check PASS. V1 source/address/ABI/history code, reviewed V2 Solidity/ABI, migration files and hosted settings remain unchanged.

Real-browser/mobile visual QA, successful hosted auth/documents and live signed V2 lifecycles remain pending. Existing Node local-storage warnings are non-failing. Prior documented toolchain advisories were not resolved through a broad dependency upgrade.

## Supabase setup and environment names

V1 was previously activated with approval: three migrations, private PDF storage and registry. Successful hosted end-to-end acceptance remains unverified; current hosted state was not rechecked here. Follow [SUPABASE_SETUP](docs/SUPABASE_SETUP.md); never rerun applied migrations blindly.

| Location | Names |
|---|---|
| Frontend/Vercel Preview | VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY |
| Optional verified public V2 reads | VITE_V2_CONTRACT_ADDRESS; omitted/blank uses checked-in 0x9672b0aec292c9f8dd8fefbc9daab876b8ec9882; different override fails closed |
| Existing server | SEPOLIA_RPC_URL, exact ALLOWED_ORIGINS |
| Supabase-injected server | SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY |
| Inactive V2 server | V2_CONTRACT_ADDRESS, exact V2_ALLOWED_ORIGINS, V2_IDENTITY_HMAC_KEY (persistent, high entropy, at least 32 characters) |

Only browser-safe values belong in Vite. No privileged key, database credential, private RPC token, identity HMAC material or manager key belongs in frontend, Git or chat. Templates contain only public connection values/placeholders, never secrets.

With separate hosted approval, review/apply outstanding V2 SQL, configure exact origins and deploy the matching separate function with authenticated wallet/session checks. supabase/config.toml currently configures registry, not an activated registry-v2. Never copy verify_jwt=false without reviewing explicit handler Auth validation. Keep private document access behind user-scoped RLS/server authorization; no public bucket or weakened policies.

## Unresolved MetaMask warning

The earlier testing Preview produced a **Malicious site** warning during a signature request; the user cancelled. No resolution is documented. Do not sign there, disable protections, change domains to evade classification, bypass the warning or retry blindly. Preserve evidence and use the appropriate security/support process. A passing build or healthy Supabase endpoint does not resolve classification.

The documented deployer also has EIP-7702 delegation. Tooling checks its exact marker/implementation. Do not alter delegation to work around deployment failures.

## Reviewed compiler and deployment package

- solc **0.8.38+commit.1835d247**, OpenZeppelin **5.6.1**.
- Optimizer **200 runs**, **viaIR true**, EVM compilation target **cancun**.
- Source SHA-256: `15092c6c595fcc186c2dab03e367c5b3f3343441cde5c2a32c76de7309eee14c`.
- ABI SHA-256: `39984ac3e3a284ff01e0a842ab1b2051ce44d21d98e2c24b3a78df536fe03bd6`.
- Runtime **23,735 bytes**, keccak256 `0x178c217074a782a35c93fab8752cc7980ba850628de4ebf279728bc9d427a12d`.
- Creation including confirmed constructor **24,776 bytes**, keccak256 `0x05c064223cbf7177b86b379f4786bfa4a2e337bca9ffc454703c7ecbed723b0d`.
- Prior confirmed Manager/deployer: `0x79b246212650b686a0e9e5726092b1558b35d974`.

Compilation target and current Sepolia execution gas rules differ; the latest tooling note supersedes older Osaka-only gas assumptions. Historical nonce/gas/fees/predicted address must be refreshed.

Last documented live package: supabase/.temp/v2-deployment-20261023034230879-efcf83/. Later offline-test packages are not automatically valid live preflights. Packages are ignored and should be regenerated by the next developer, not expected in Git. Relevant files: plan.json, unsigned-transaction.json, standard-input.json, abi.json, constructor-arguments.txt, creation-bytecode.txt and exact imported sources/. Securely share only a reviewed package, never all supabase/.temp or env files. No live preflight was performed during this integration.

### Existing deployment — do not deploy again

Contract 0x9672b0aec292c9f8dd8fefbc9daab876b8ec9882 was created by transaction 0xf0de9a8abb649fb62163cf8e4709349f5b6494f1a0980b8a665c95581a1583a3 in block 11974932, on 23 October 2026 at 14:39:24 SGT.

The deployment record supersedes historical preflight/creation steps. Reproduce public verification with:

```powershell
node scripts/verify-v2-deployment.mjs
```

This compiles and reads only; --write-report updates only the local public JSON evidence. It checks receipt, exact creation/constructor/runtime, compiled ABI and current owner. Historical preparation scripts/packages remain for audit/regression purposes, not an instruction to deploy another contract. Source publication on the explorer was not verified by this check.

## Post-deployment configuration and exact safe activation gates

There is no single environment switch that activates transactions.

Pair 1 — public reads:

1. Review the recorded deployed address/block/receipt/runtime/Manager and matching ABI in docs/V2_DEPLOYMENT_VERIFICATION.md/.json; rerun the read-only verifier if current evidence is needed.
2. Build the approved Preview using the checked-in verified address default, or an optional matching VITE_V2_CONTRACT_ADDRESS. Remove stale mismatched overrides; rebuild after environment changes. Keep V1 abi.ts untouched and check current public reports; buttons stay disabled.

Pair 2 — private binding:

1. Obtain hosted approval and integrate reviewed V2 registration/document mapping into the shared interface, preserving canonical linked-wallet identities and version-scoped PDF ownership.
2. Validate current private sessions, Approved V2 permission receipts, immutable identity binding, self-review prevention, revoked-session and cross-wallet denial.

Pair 3 — complete signed UI handlers while still locked:

1. Bind the draft controls to exact typed V2 calls, strict cents/2-decimal unit parsing, unique evidence references, explicit confirmations and user minimum units/payout. Complete adapter methods for funding/refund, rejection, invoice attestation/concentration acknowledgement, valuation and reserve release as needed. Current drafts do not implement these.
2. Before each prompt, recheck account/epoch/chain, server-verified Approved V2 identity, actual owner/operator authority, fresh valuation/state, liquidity, pause/automation and evidence. Recheck after every await. Client fields/JWT claims grant no role.

Pair 4 — activation:

1. Implement receipt-confirmed transitions, true transaction links, refresh, cancellation/refund recovery and Pending Liquidity. Pass the full suite and separately authorized closed Sepolia acceptance in TESTING_CHECKLIST.
2. After explicit release approval, replace V2_EXECUTION_ENABLED=false with a reviewed fail-closed activation design and bind only tested permitted buttons to handlers. Changing the constant alone cannot activate today's disabled buttons. Never blanket-enable controls or bypass role/state checks.

Start with automation disabled. Granting/hosting/funding executors needs separate owner custody/monitoring decisions. Manager keys never enter hosted configuration.

## Exact GitHub Desktop and Vercel Preview workflow

**Pushing may trigger Vercel automatically.** Obtain approval covering commit/push/Preview before publication.

Pair A — review:

1. GitHub Desktop → File → Add local repository → C:\Users\Eugen\Documents\GitHub\ReceivLedger. Confirm Current branch is feat/v2-financing-redemption, not main/export.
2. Review every Changes diff, including pre-existing edits. Include handover/checklist and intended integration files; exclude env secrets, private PDFs, node_modules, dist, .vercel and supabase/.temp. V1/V2 Solidity and ABIs should be unchanged by this integration.

Pair B — after approval:

1. Enter summary **Integrate ReceivLedger fund workspace and developer handover**. Review checked files and click Commit to feat/v2-financing-redemption. Do not amend/rebase or commit to main.
2. Click Publish branch if there is no upstream, otherwise Push origin. Do not merge, force-push or promote. Confirm GitHub branch and record the commit SHA.

Pair C — Preview:

1. Confirm existing Vercel Production Branch remains main. For this feature Preview use Vite, root containing package.json, npm ci, npm run build, dist. Set only browser-safe variables in Preview/branch scope; V2 address uses the verified checked-in default; an optional Preview override must match it exactly.
2. Verify deployment branch/SHA and no-signature acceptance. Env changes require a rebuild; exact Auth redirect/Edge origins need separate hosted approval. Do not wildcard or use another domain to evade MetaMask.

Official guidance: [GitHub Desktop commit/push](https://docs.github.com/en/desktop/making-changes-in-a-branch/committing-and-reviewing-changes-to-your-project-in-github-desktop), [Vercel Git](https://vercel.com/docs/git), [Vercel variables](https://vercel.com/docs/environment-variables).

## Pass to the next developer

Pair A:

1. After approved publication, give private repository access through the owner's normal process. Send repo link, exact feature branch/commit, HANDOVER.md and TESTING_CHECKLIST.md, without secrets.
2. Ask them to clone that branch, reproduce local checks and acknowledge deployed V2 with execution still disabled, incomplete execution/backend binding, unresolved MetaMask warning and separate release approvals.

Pair B:

1. Transfer only necessary service permissions through invitations/secret management. Regenerate or securely share only reviewed offline deployment artifacts if needed.
2. Have them maintain the deployment/configuration record, completed acceptance matrix and owner release sign-off. Preview success does not authorize merge, finance activation or production deployment.

## Final production-release checklist

- [ ] Exact release commit reviewed, checks pass and working tree clean after approved commit.
- [ ] MetaMask classification resolved appropriately without bypass.
- [x] Existing V2 receipt/runtime/owner/ABI/compiler and empty-state snapshot verified read-only; see deployment record.
- [ ] Confirm explorer source publication if required for release.
- [ ] V1 address/state/history preserved; no fabricated V2 data.
- [ ] Canonical V2 registration, version-scoped private PDFs and denial tests pass.
- [ ] Pending/rejected/suspended/revoked identities blocked from financial actions.
- [ ] Signed handlers, evidence, valuation, minimums, liquidity and failure recovery pass.
- [ ] Two-investor/two-SME lifecycles and NAV/cash/supply/escrow/commitment/income reconcile.
- [ ] Browser/mobile, keyboard, wallet A/B/A/epoch/network and private session isolation accepted.
- [ ] Preview commit/config/origins, service custody/monitoring and rollback plan confirmed.
- [ ] Explicit approvals for hosted changes, signing/deployment, activation, merge and production promotion recorded.
