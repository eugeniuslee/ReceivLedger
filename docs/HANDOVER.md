# ReceivLedger handover

## Current implementation

Use the existing Git repository `C:\Users\Eugen\Documents\GitHub\ReceivLedger` on `feat/phase4-supabase-audit`. Do not use the old OneDrive/export folder or create a replacement repository. Batch 1, Batch 2 and Batch 3 are implemented. The preceding approved Supabase activation applied all three migrations and deployed `registry`; successful hosted wallet acceptance is still pending. Current local frontend QA changes are uncommitted and unpublished. See [WEBSITE_QA.md](WEBSITE_QA.md) for current scope and role-specific acceptance; earlier export reports describe historical verification dates.

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

Stored invoice ownership establishes the invoice-wallet view. Unknown wallets remain provisional; new applicants need approved off-chain SME verification to submit through this website. Solidity still permits direct calls and does not enforce SME registration. Established invoice wallets without applications retain existing access. Zero-balance former investors may need history indexing to finish before classification changes.

Wallet changes invalidate pending data requests. Role checks and transaction guards supplement the contract's access checks. Event history starts at deployment block 11,945,118, uses 2,000-block RPC queries and is cached in browser local storage with a 12-block reorg overlap. A new deployment URL has its own browser cache.

## Verification and deployment

Current verification and limitations are recorded in [WEBSITE_QA.md](WEBSITE_QA.md). Tests include disposable PostgreSQL migration/RLS execution, financial scenarios, wallet isolation, safe feedback and refresh recovery. Prior hosted activation passed six HTTP preflight/negative checks. Successful hosted wallet flows and real-browser visual acceptance remain unverified. These checks do not establish that Vercel has the current local changes.

Use the commands and deployment settings in `../README.md`. Existing blockchain features need no application secrets. Registration requires browser publishable configuration plus the approved SQL/Edge deployment described in `SUPABASE_SETUP.md`; no privileged server key may enter the frontend. Keep the GitHub repository private and review files before pushing. Pushing and deployment require explicit approval. Once connected, Vercel's Git integration can automatically deploy later pushes.

Do not execute Sepolia transactions, change the contract address or redeploy Solidity. Batch 3 scenarios do not change full-face financing, introduce earned fees or implement redemption/distributions. Hosted migrations, function/security configuration, live validation and deployment require the user's configuration or authorization. Historical wallet balances are observations only; read current state from the contract.

`EXPORT_REPORT.md` records the original demo export and is historical, not a description of the current app.
