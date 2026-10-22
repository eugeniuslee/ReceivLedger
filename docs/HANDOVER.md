# ReceiveLedger handover

## Current implementation

Batch 1 is complete and the user reports a GitHub repository and deployed Vercel site. Batch 2 Stages A/B/C have local implementation; hosted Supabase activation and live acceptance checks are pending. See `BATCH2.md` and `SUPABASE_SETUP.md`. Batch 3 financial modelling/reporting is now implemented locally on those same development files; see `BATCH3.md` for formulas, scope, files and manual checks. A new independent local Git repository was initialized on `feat/batch2-supabase` because this workspace had no Git metadata; it has no remote, commits or production history. Reconcile with the real GitHub checkout before any push. Do not push, deploy or change cloud resources without approval.

The running application reads the deployed Sepolia contract, rather than the retained demo ledger. Fund capital, financing and repayment are simulated SGD accounting recorded on-chain; they do not transfer investment proceeds or financing payments. RLU has 0 decimals.

| File | Purpose |
|---|---|
| `contracts/ReceivLedger.sol` | Deployed contract reference; preserve without modification or redeployment |
| `src/chain/abi.ts` | ABI, Sepolia chain ID 11155111 and contract address `0x18c6751a1a116053e413459464c9b1af356dbf1f` |
| `src/chain/LedgerContext.tsx` | Injected wallet connection, account/network changes, role snapshots, event loading and transaction guards |
| `src/chain/chainLedger.ts` | Contract reads/writes, wallet classification, invoice ownership and event queries |
| `src/chain/access.ts` | Role-specific page access, including inactive-investor restrictions |
| `src/chain/eventCache.ts` | Browser history cache and incremental event merging |
| `src/chain/activity.ts` | Readable transaction grouping |
| `src/App.tsx`, `src/pages/` | Role-specific shell and dashboards, invoices, investors and history |
| `src/ledger/`, `src/demo/` | Retained simulation/reference code; not the active application data source |

## Role behavior

The live manager address takes precedence, followed by current investor approval. An unapproved wallet with positive RLU or historical investor evidence is an inactive investor with visible holdings/history and no transfer route. Revocation does not burn or redeem units, and Solidity requires both parties to be approved for ordinary transfers.

Otherwise, stored invoice ownership establishes the invoice-wallet view. Unknown wallets remain provisional and may submit invoices through the existing open submission function. This is not SME registration or identity verification. Zero-balance former investors may need history indexing to complete before classification changes.

Wallet changes invalidate pending data requests. Role checks and transaction guards supplement the contract's access checks. Event history starts at deployment block 11,945,118, uses 2,000-block RPC queries and is cached in browser local storage with a 12-block reorg overlap. A new deployment URL has its own browser cache.

## Verification and deployment

Latest local verification passed TypeScript, Deno Edge type checking, 177 tests across 14 files and the production build. The Batch 3 suite adds 57 tests for financial models, reporting reads and wallet/role isolation to the 120-test Batch 2 baseline; see `BATCH3.md`. Tests include actual PostgreSQL migration/RLS execution in an isolated in-memory test engine. Hosted authentication, storage, real-wallet flows and browser/mobile visual acceptance are still unverified. These checks do not establish that the hosted URL has the local changes.

Use the commands and deployment settings in `../README.md`. Existing blockchain features need no application secrets. Registration requires browser publishable configuration plus the approved SQL/Edge deployment described in `SUPABASE_SETUP.md`; no privileged server key may enter the frontend. Keep the GitHub repository private and review files before pushing. Pushing and deployment require explicit approval. Once connected, Vercel's Git integration can automatically deploy later pushes.

Do not execute Sepolia transactions, change the contract address or redeploy Solidity. Batch 3 scenarios do not change full-face financing, introduce earned fees or implement redemption/distributions. Hosted migrations, function/security configuration, live validation and deployment require the user's configuration or authorization. Historical wallet balances are observations only; read current state from the contract.

`EXPORT_REPORT.md` records the original demo export and is historical, not a description of the current app.
