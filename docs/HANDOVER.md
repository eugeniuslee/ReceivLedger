# ReceiveLedger handover

## Current implementation

Batch 1 is complete locally, including the user-reported manual testing of wallet switching and inactive investors. The current priority is private GitHub setup and Vercel deployment. Do not begin registration, document storage or financial-reporting features without a separate request.

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

The latest agent verification passed TypeScript, 49 unit tests and the production build. The user reports successful local MetaMask tests. These do not establish that the hosted URL has been tested; repeat the read-only role, balance, invoice and history checks there after deployment.

Use the commands and deployment settings in `../README.md`. No environment variables or private keys are needed. Keep the GitHub repository private and review staged files before pushing. Repository creation, pushing and deployment each require explicit approval. Once connected, Vercel's Git integration can automatically deploy later pushes.

Do not execute Sepolia transactions, change the contract address, redeploy Solidity or implement Batch 2/3 as part of deployment preparation. Historical wallet balances are observations only; read current state from the contract.

`EXPORT_REPORT.md` records the original demo export and is historical, not a description of the current app.
