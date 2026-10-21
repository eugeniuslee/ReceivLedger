# ReceivLedger

React 18, TypeScript, Vite 5 and ethers v6 frontend for the deployed ReceivLedger contract. All dashboard and workflow data is read from Sepolia; this app does not use a fictional in-browser ledger.

## Requirements and commands

- Node.js 18 or newer and npm
- MetaMask (or a compatible injected EIP-1193 wallet) for on-chain reads and transactions

```bash
npm ci
npm run dev       # http://localhost:5173
npm run typecheck
npm test
npm run build     # production output in dist/
npm run preview   # locally serve dist/
```

## Sepolia configuration

The frontend is configured in `src/chain/abi.ts` for:

- Chain: Sepolia, chain ID `11155111`
- Contract: `0x18c6751a1a116053e413459464c9b1af356dbf1f`
- Etherscan: `https://sepolia.etherscan.io`

Connect MetaMask and select Sepolia. The page detects the current account, listens for account/network changes, and reads the manager address from `manager()`. No private key, seed phrase, RPC key, or application environment variable is required. Use testnet ETH only for gas; do not use a mainnet account or funds for the walkthrough.

Reference wallets supplied for the demonstration (verify the active account before signing):

- Manager: `0x79b246212650b686a0e9E5726092B1558B35D974`
- Investor: `0xCBFF3E3e718B1ef1199828E3aE226F5AF6D4d1AA`
- SME: `0x213E83c00C28E56eA475b2049ebA2Ef61e3299bd`

The latest user-reported manual check found Investor 1 approved with 950 RLU, Investor 2 revoked with 150 RLU, total supply of 1,100 RLU, invoices #1 and #2 repaid, and simulated available capital of S$1,100. These are historical observations, not current guarantees. Contract state is read at runtime; never hardcode these balances.

## Five-minute role-specific wallet test

Use the three reference accounts above, select Sepolia in MetaMask, and confirm the active wallet before every signature. Do not approve a wallet prompt or transaction you did not initiate.

1. **Manager:** connect the manager account. Confirm Dashboard shows contract fund values; Invoices shows all rows with status-specific approve/finance/repay actions; Investors supports explicit-address approval, revocation and issuance; History shows all queried events. Look up the known investor to verify its balance and approval.
2. **Investor:** switch MetaMask to the approved investor account. Verify navigation redirects to the personal dashboard with this wallet's RLU balance/approval, Transfer RLU and My history.
3. **Inactive investor:** switch to the already-revoked Investor 2 wallet; no new revocation transaction is needed. An unapproved wallet with remaining RLU or known historical investor events should see its live balance, revoked status and My history, with no Transfer RLU route. Revocation does not redeem or burn RLU.
4. **Invoice wallet:** switch to the known SME account. My invoices appears only when contract invoice mappings store rows for this address. This is not real-world identity verification. Submitting an invoice sends a real Sepolia transaction.
5. **Unknown wallet:** switch to a wallet with no approval, investor history or stored invoices. It should see an unregistered/provisional dashboard and a Submit invoice route, not a verified SME identity. The contract permits open invoice submission. If history indexing is incomplete, the app labels that uncertainty instead of guessing.
6. **Switching:** move between all accounts in MetaMask. The prior wallet's data should clear while the next role is resolved, then the matching navigation should appear. Switch networks or disconnect MetaMask and confirm wallet-specific data stays cleared until Sepolia is restored.
7. **Optional manager transactions:** switch back to the manager to approve and finance an eligible Submitted invoice, then record repayment for a Financed invoice. Review all MetaMask prompts. These functions alter simulated accounting; no SGD or ETH is transferred. History should link real transaction hashes to Sepolia Etherscan.

MetaMask signing is manual. This app cannot accept or confirm wallet prompts on the user's behalf. A transaction can require Sepolia test ETH for gas.

## Vercel deployment

Initial repository creation, pushing code and deployment require the project owner's explicit approval. Once Vercel's Git integration is connected, later pushes can trigger deployments automatically.

1. After approval, create an empty **private** GitHub repository and push the reviewed project files. Keep GitHub's optional README, .gitignore and license initialization disabled because this project already has files. Review the staged file list before committing; exclude secrets, private documents, `node_modules/`, `dist/` and `.env` files.
2. Set the project root to the folder containing this `package.json`.
3. In Vercel, import that repository using the Vite framework preset, install command `npm ci`, build command `npm run build`, and output directory `dist`.
4. No environment variables are required. `vercel.json` rewrites browser routes to the Vite entry point.
5. Test the local production build with `npm run preview`, then deploy only after explicit approval. On the deployed URL, reconnect MetaMask (permission is specific to the site), select Sepolia, and check all wallet roles, live balances, invoice records and history links without sending transactions. Reload the URL to check asset loading. A new browser origin has a separate history cache, so its initial scan may take longer.

A private GitHub repository does not make the deployed frontend or its bundled configuration secret. The frontend is intended to be publicly accessible; do not add private keys or confidential documents to source files or Vite environment variables.

On Windows PowerShell, if `npm` is blocked by script execution policy, use `npm.cmd` for these commands without changing the execution policy.

## Contract and frontend limitations

- `totalFundSize`, `availableFunds`, invoice financing and repayment are simulated S$ accounting. They are not cash balances or SGD/ETH transfers. RLU has 0 decimals.
- The contract has no SME registration or verification mechanism. Any connected non-manager wallet can submit an invoice; the submitting wallet is stored as the SME address. The frontend only grants the invoice-wallet view when a stored invoice maps to the address; this does not establish a real-world identity. Other unverified wallets remain provisional but can still use the contract's existing open submission function.
- Approved investors are determined by the live `approvedInvestors(address)` mapping. A revoked investor with positive RLU or historical approval, revocation, issuance or non-mint transfer evidence remains an inactive investor and retains visible holdings/history, but cannot transfer through the app. A zero-balance wallet whose history is incomplete remains provisional until evidence is available.
- The contract does not expose an enumerable investor list. Investor status and balance are queried by explicit address. Suggested wallets come only from approval/revocation events found in the history scan and are not a complete list.
- Contract event history is initially scanned from the verified deployment block in 2,000-block RPC requests, cached in browser local storage, then incrementally updated with a 12-block reorg overlap. A cleared browser cache requires the initial scan again. Public RPC availability and rate limits can still cause visible history errors. SME invoice ownership is recovered from `invoices(1..invoiceCount)` and the stored `sme` address, so old invoices do not depend on the event-history cursor.
- There is no manual reject function. `financeInvoice()` can record an InvoiceRejected event and reason when a finance check fails.
- There are no invoice documents, KYC records, external accounting transfers, automated investor discovery, or production financial controls.
- Sending transactions requires the current wallet to have the contract role/approval required by Solidity. The interface does not bypass those checks.

## Tests

`npm test` includes Solidity-mirroring demo-ledger unit tests retained as reference, wallet-role classification/navigation tests, invoice mapping/action tests, wallet-staleness and event-cache tests, plus transaction grouping tests. Automated tests do not connect to Sepolia, exercise MetaMask confirmations, or render manager modals in a browser.
