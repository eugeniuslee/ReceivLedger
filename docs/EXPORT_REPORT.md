# Export verification and limitations

> Historical report from the original demo export. Statements below about unused blockchain integration, demo mode and seven tests describe that export only. The current app uses the deployed Sepolia contract; see `HANDOVER.md` and `../README.md` for the current architecture, 49-test verification and deployment instructions.

This export preserves every file in the supplied `receivledger-frontend.zip`.
Application source, styles, seed data, dependencies, lockfile, and Solidity contract
are unchanged. This report and the README installation clarification are additions.
The published Claude Artifact was not accessed or changed; visual equivalence to
that Artifact cannot be independently confirmed.

## Verified in this export

- `npm ci` completed using the included lockfile.
- `npm run build` passed TypeScript checking and the Vite production build.
- `npm test` passed all 7 existing demo-ledger tests.
- `npm run dev -- --host 127.0.0.1` started successfully; HTTP requests retrieved
  the HTML entry point and transformed React entry module.
- Verification used Node 24.19.0 and npm 11.9.0.

HTTP checks do not verify browser rendering or interactive flows. Browser visual
checks, mobile layout, real MetaMask connections, deployed contract interactions,
and Solidity compilation were not performed. No Sepolia connection was made.

## Existing behavior and unfinished work

- All four pages, charts, forms, role selector, invoice workflow, investor workflow,
  demo clock, and transaction filters are included as supplied.
- History supports type/status filters but has no text-search field.
- The app opens directly into demo mode; there is no welcome or Connect Wallet UI.
- `src/chain/` contains an unused ethers.js adapter, ABI, and wallet helper.
  It is a starting point, not completed live blockchain integration.
- Reloading resets demo state. See README for modifying seed files.
- Dependencies are declared and locked for `npm ci`; generated `node_modules`
  is excluded because it is platform-specific. The production `dist/` is included.

## Contract comparison caveats

The financing check order, rejection outcomes, principal repayment, fund cap,
and 10% payer exposure rule correspond to the supplied contract. The demo is not
an exact EVM implementation:

- The demo trims payer names and rejects whitespace-only names; Solidity accepts
  any nonempty byte string and preserves whitespace.
- Demo wallet keys are case-sensitive; Ethereum address identity is not.
- Demo numeric operations use JavaScript numbers without universal uint256/integer
  validation; Solidity uses unsigned integer amounts and timestamps.
- The demo rejects zero-unit transfers; ERC-20 permits zero transfers between
  eligible addresses. Its transfer form can choose a sender independently of the
  role selector; real `transfer` uses the connected signer as sender.
- Demo timestamps use milliseconds and a manually advanced clock; chain timestamps
  use seconds. Demo transaction hashes and revert-history rows are simulated.

These limitations are documented rather than changing application behavior during
an export. Consult FUNCTION_MAPPING.md and HANDOVER.md before live integration.

## GitHub handover

The inspected `/workspace/ReceiveLedger` checkout contains only its original README.
No files were copied into it, committed, or pushed by this export. To integrate,
extract this project into your intended frontend directory, review the files and
contract with your teammates, and commit through your normal GitHub workflow.

The original HTML loads Manrope from Google Fonts. Offline or restricted-network
use falls back to system fonts; the original font reference is preserved.
