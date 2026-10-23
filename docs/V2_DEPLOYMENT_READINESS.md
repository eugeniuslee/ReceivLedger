# V2 final pre-deployment review

2026-10-23 (Asia/Singapore). Repository `C:\Users\Eugen\Documents\GitHub\ReceivLedger`; branch `feat/v2-financing-redemption`; base commit `3b3057837d4902565e6832bcbd7001f4e7fed578`. The existing V2 work and this review remain uncommitted. No deployment, broadcast, wallet signature, hosted change, production integration or V1 migration occurred.

**Scope:** internal local review and actual compiled-contract simulations, not an independent security audit. The final checklist/results below must pass before marking the contract a candidate for controlled simulated-fund testing. The user confirmed Manager and deployer as `0x79b246212650b686a0e9e5726092b1558b35d974` and explicitly authorised only an **offline** role-specific dry run. No live balance, nonce or code checks were made for that wallet.

## Critical checklist

| Requirement | Result / evidence |
|---|---|
| Fresh fund, zero capital/units, correct owner | PASS in constructor/initial-state simulation using the confirmed public Manager address. Cap S$10m; automation and optional overdue surcharge initially disabled. |
| Pending/needs-info/rejected/suspended/revoked financial restrictions | PASS; only Approved investors subscribe/receive issuance/request exits, and only Approved SMEs submit/finance. Rechecked at execution. |
| Manager/executor/attestor permissions and self-review | PASS within the permission model; independent owner review, immutable wallet-to-entity bindings, associated-SME attestation denial. Owner controls genuine identity/funding truth. |
| S$10m fund ceiling | PASS as the previously approved **capital-admission** ceiling, checked at request and processing against fund assets. Earned income is not erased if NAV later exceeds the ceiling; further capital is blocked. |
| S$10k lifetime automatic subscription allowance | PASS per canonical investor across linked wallets, with atomic processing checks; redemptions do not reset it. Further manager-reviewed investment remains possible. |
| S$5k automatic invoice / S$50k automatic facility | PASS; approved commitments and funded balances count; manual upgrade is explicit. |
| S$100k SME hard cap | PASS across linked wallets, principal plus approved gross commitments; no manager override. |
| 30-day automatic / 90-day manager maturity | PASS at approval/funding, with expired financing blocked. |
| Aggregate 1% NAV / manager acknowledgement | PASS; exact-ratio comparison, acknowledgement at exactly 1% and above, and rechecks after NAV changes. Above 1% cannot be automatic. |
| Common payer concentration | PASS; 10% of active NAV across SMEs, including approved commitments. |
| Concurrent subscriptions, loans and redemptions | PASS; state transitions, caps, minimum units/payouts, commitment reservations and fixed exit liabilities are atomic. |
| Gross/net advance and S$20 fee | PASS; S$4,000 principal, S$3,980 cash advanced, S$20 fee once; no future interest booked upfront. |
| Actual elapsed interest, early/partial/payer collections | PASS; 8% simple annual interest, actual seconds/unpaid principal, remainder carry, one debt ledger and segregated surplus. |
| Accrual NAV, non-par unit pricing, expected losses | PASS within the simplified reviewed model; earned unpaid interest enters NAV once, collection does not add income again; impairment may cover principal and interest. Zero NAV/stale valuations block pricing. |
| Final exit with impaired receivables | PASS after the confirmed fix: the final active units remain pending while loans/commitments are unresolved, preserving ownership of any later recovery. |
| Duplicate evidence / rejected front-run recovery | PASS after the confirmed fix: revoked submitter plus rejected unfinanced request can release evidence; financed identifiers remain locked. |
| Reentrancy and state-transition review | PASS for the current simulation: no external asset calls/payable functions; no external callback during accounting/escrow transitions. Reassess if real assets are ever added. |
| Emergency controls | PASS; owner pause/revocation blocks new subscription processing/financing. Owner recovery, collections, cancellations and existing exit settlement remain possible. Pause is deliberately not a universal freeze of every ERC20/exit operation. |
| Arithmetic/precision | PASS for tested boundaries/invariants/fuzz cases; integer SGD cents, Math.mulDiv pricing, checked arithmetic, floor rounding, user minimums, no compounding. |
| 100 active loans / gas bound | PASS in the strengthened cold-state, base-plus-overdue accrual stress test. It limits active loans, not historical invoices; repaid slots are reusable. Planned two-SME demonstrations fit comfortably. |
| Compiler/dependencies and source verification bundle | PASS: exact pinned compiler/OZ enforced; self-contained Standard JSON recompiles to identical creation/runtime code. Explorer publication is NOT RUN. |
| Deployment bytecode / unsigned local dry run | PASS; EIP-170 runtime and EIP-3860 initcode limits, correct constructor owner, no value, no signer/broadcast path. |
| Sepolia / selected wallet live preflight | Sepolia public network ID was read-only verified before the offline-only clarification. The confirmed wallet's live nonce, code, balance, creation address and RPC gas estimate are NOT RUN and require separate authorisation. |
| V1 isolation / secrets / Git state | PASS: V1 contract/ABI/address, migrations/registry/config hashes unchanged; no legacy token import/mint; `.env.local` ignored/untracked; no secrets printed or committed. Work remains uncommitted. |
| Hosted V2 onboarding, private documents, keeper and production wallet UI | NOT RUN / not activated. Contract owner/executor calls can be tested manually without the V2 backend; live hosted workflows are not represented as working. |

## Lifecycle evidence and the capital mismatch

A S$10,000 subscription initially mints 10,000 RLU2 at S$1, with S$10,000 cash/NAV and no income. A S$4,000 invoice then correctly fails: it is 40% of NAV, exceeding both the 1% automatic threshold and the 10% payer cap. Manager acknowledgement cannot override the payer hard cap.

For S$4,000 automatic financing with no prior exposure, at least S$400,000 NAV is needed, and exactly that amount also requires Manager acknowledgement. The realistic successful simulation instead adds a **manager-reviewed S$490,000** subscription, making total capital S$500,000. The lifetime automatic allowance stays at S$10,000; the top-up does not reset it.

| Lifecycle checkpoint | Fund cash | Principal | Earned unpaid interest | Investment NAV |
|---|---:|---:|---:|---:|
| After total S$500k subscriptions | S$500,000.00 | S$0 | S$0 | S$500,000.00 |
| After S$4k financing | S$496,020.00 | S$4,000.00 | S$0 | S$500,020.00 |
| After 20 actual simulated days | S$496,020.00 | S$4,000.00 | S$17.53 | S$500,037.53 |
| After S$4,000 payer collection | S$500,020.00 | S$17.53 | S$0 | S$500,037.53 |
| After S$17.53 SME top-up at same timestamp | S$500,037.53 | S$0 | S$0 | S$500,037.53 |
| After redeeming 250,000 of 500,000 RLU2 | S$250,018.77 | S$0 | S$0 | S$250,018.77 |

Payer collection pays earned interest first and then principal, leaving the small principal balance shown. The final SME payment clears the same obligation, not another S$4,000 debt. The half-position redemption pays S$250,018.76, burns 250,000 RLU2 and leaves 250,000 RLU2; one cent remains with the remaining position because of floor rounding. No principal/income is counted twice.

A second lifecycle interleaves two investors' subscriptions, two independently verified SMEs' invoices and competing redemptions. One exit reserves available cash; the other remains pending until collections, then reprices and settles. All units can burn only once, balances reach zero, exposures/reserves reconcile and no simulated success is presented as a network transaction.

The local receipt history includes sender, function, input, timestamp, success/failure, logs and gas. Its transaction hash is explicitly `null`, never a fabricated blockchain receipt. NAV movement events reconcile capital, cash, receivables, income and exit liabilities. Actual deployed events will carry real block/transaction/log identifiers.

## Confirmed issues fixed in this review

1. **Orphaned recoveries after a final exit:** when a loan was fully impaired, all units could be allocated/redeemed against cash. A later recovery then created positive NAV with zero pricing units, blocking new subscriptions and leaving no holder entitled to that recovery. The final active exit now remains Pending Liquidity while any principal, accrued interest or financing commitments are unresolved. Partial exits remain possible subject to liquidity. Payoff/released commitments permit final repricing/settlement. This state can therefore mean unresolved receivables as well as insufficient cash.
2. **Permanent evidence burning by an abusive verified SME:** first submission consumed global invoice/document identifiers. Rejection did not release them, so copied evidence could permanently deny its legitimate owner. The contract now retains each invoice reference and releases both identifiers only on rejection of an unfinanced request. Revoke the abusive entity before releasing the evidence to stop repeat submissions. Rejected requests cannot later finance or clear a newer request's identifiers; funded invoices cannot be rejected/unlocked. Exact replay protection remains in force.
3. **Gas-test validity gap:** the prior `runCall` harness retained warm/original-storage state across calls and used a 30m message budget. It was suitable for many state assertions, not transaction gas readiness. Calls now reset transaction access/original-storage state, warm only the normal transaction addresses/precompiles, include intrinsic/calldata/creation/initcode gas, apply refund bounds/Osaka calldata floor and fit a 16,777,216 gas budget. No transaction is signed and no ETH fee is debited in this local approximation.

The ordinary accounting rules were not rewritten. No new financial product or production frontend feature was added.

## Accounting and authority boundaries

The shared invariants check:

```text
assets = cash + gross unpaid principal + earned unpaid interest - expected losses
active NAV = assets - allocated exit liabilities
active NAV = custodial assets - (pending subscriptions + SME reserves + allocated exits)
cash >= allocated exit cash + approved net financing commitments
assets + settled exits = subscribed capital + upfront fees + collected interest + unpaid interest - losses
cash + settled exits + cumulative net advances = subscriptions + recovered principal + collected interest
```

They additionally reconcile entity/wallet/payer principal, automatic facilities, approved gross/net commitments, per-invoice fee/advance/collections, pending funding, SME reserves, redemption escrow, reserved units and total token supply. The lifecycle also reconciles its complete NAV/cash/income event journal. Five seeded 20-step model-based repayment sequences retain an independent rational-interest reference model. These are not formal proofs or exhaustive economic security guarantees.

Solidity enforces permissions, immutable identity bindings, caps, maturity, reservations, selected states, unique receipts, arithmetic, pricing and loan/exit accounting. **Trusted external review** establishes genuine entities/associated wallets, authentic canonical invoices/payers, credit clearance, real-world payment truth and expected losses. The Manager can misstate those facts; a 24-hour valuation confirmation is not an oracle or independent asset appraisal. An attacker with valid SME approval may temporarily contest identifiers; trusted review/revocation/rejection recovery is still necessary. On-chain hashes do not prove document ownership or prevent altered-document fraud.

The current contract needs no undeployed backend to accept authorised direct calls. A Manager can grant roles/review/attest manually; an explicitly authorised executor must still submit transactions to run eligible actions. Nothing executes on a timer by itself. The separate V2 backend, canonical private identity registry, private document handling, wallet onboarding UI and scheduler are not activated by contract deployment. V1 Supabase approval does not grant a V2 role.

Simplifications remain: SGD-cent simulated assets rather than cash custody; upfront S$20 fee income rather than formal effective-interest amortisation; contractual interest assumes collectibility unless impaired; integer/sub-cent rounding; manager-updated losses; no general loan write-off/forgiveness/fund wind-down facility. A permanently unresolved default may keep the final exit pending; it does not justify distributing an ownerless recovery. This design is for controlled university demonstrations, not commercial lending or real funds.

## Deployment package and gas

The final role-specific offline package is `supabase/.temp/v2-deployment-20261023025859108-508e00/`. It includes `plan.json`, `unsigned-transaction.json`, `creation-bytecode.txt`, `abi.json`, `constructor-arguments.txt`, self-contained `standard-input.json` and the exact source tree. These ignored local artifacts are immutable per run; previous packages are not overwritten. Use this final confirmed-role package, not an earlier placeholder/pre-fix run.

Runtime: **23,735 bytes** / 24,576 maximum. Creation data including constructor: **24,776 bytes** / 49,152 maximum. Runtime hash: `0x178c217074a782a35c93fab8752cc7980ba850628de4ebf279728bc9d427a12d`. Confirmed-role creation-data hash: `0x05c064223cbf7177b86b379f4786bfa4a2e337bca9ffc454703c7ecbed723b0d`.

Pinned settings: solc `0.8.38+commit.1835d247`, OpenZeppelin `5.6.1`, optimiser enabled/200 runs, `viaIR: true`, EVM compilation target `cancun`. Execution gas is measured against a fresh Sepolia-chain-ID Osaka reference EVM. Both runtime and initcode limits are checked. The compiler asserts actual installed versions rather than assuming package declarations.

| Operation | Gas evidence |
|---|---:|
| Deployment with confirmed constructor Manager | 5,316,751 local gas |
| Suggested offline deployment limit, 20% headroom | 6,380,102 gas |
| S$10k automatic subscription processing | Approximately 189k gas in the lifecycle |
| S$4k financing, otherwise empty loan book | Approximately 364k gas |
| Day-20 payer collection, one active loan | Approximately 305k gas |
| Redemption allocation / settlement, empty loan book | Approximately 151k / 84k gas |
| First base-plus-overdue checkpoint at 100 active loans | 11,159,971 net; 11,253,971 before refunds |

These are simulated gas units, not an ETH price quote or a guaranteed live estimate. Sender/nonce/state/fees and future network rules affect real transactions. The 100-loan checkpoint is expensive; planned one/two-loan demonstrations are much smaller. Use fresh live `eth_estimateGas` and the selected wallet's fee/balance checks before any separately approved broadcast. The reference budget follows [EIP-7825's 16,777,216 transaction cap](https://eips.ethereum.org/EIPS/eip-7825); a larger observed block gas limit does not justify ignoring that cap.

The preparation script rejects mainnet/other network responses, V1/zero/invalid role addresses, wrong branch/root and unsupported switches. It exports an unsigned **creation** request with no recipient/V1 call, no ETH value and correct Manager constructor bytes. It has no wallet import, signing or broadcasting function and rejects `--broadcast`/private-key arguments. Offline nonce zero is a placeholder, not the confirmed wallet's real pending nonce; no future live contract address is claimed. The confirmed wallet's live code, balance, pending nonce and network gas estimate remain unverified by explicit user instruction.

## Exact preparation and later deployment steps

The following command is **offline only** and was executed with the confirmed public roles:

```powershell
Set-Location -LiteralPath 'C:\Users\Eugen\Documents\GitHub\ReceivLedger'
node scripts/prepare-v2-deployment.mjs --manager 0x79b246212650b686a0e9e5726092b1558b35d974 --deployer 0x79b246212650b686a0e9e5726092b1558b35d974
```

After separate approval for a live **read-only preflight**, the command below additionally checks Sepolia, sender EOA code, pending nonce, sender balance, predicted empty creation address, deployment gas and current fee bounds. It still cannot sign or broadcast:

```powershell
node scripts/prepare-v2-deployment.mjs --manager 0x79b246212650b686a0e9e5726092b1558b35d974 --deployer 0x79b246212650b686a0e9e5726092b1558b35d974 --rpc https://ethereum-sepolia-rpc.publicnode.com
```

**Do not perform the following signing/publication steps until separately approved.** There is deliberately no shell broadcast command in this repository; do not invent a `--broadcast` switch or export a private key to make one work.

1. Review the final package/code, fresh live preflight, exact Manager/deployer and sufficient Sepolia test ETH for gas. Confirm the current wallet authentication design uses an EOA Manager; a contract/multisig Manager needs separate backend authorisation review. Stop on a nonempty creation address, different chain, compiler mismatch or insufficient gas balance. Regenerate preflight if the wallet nonce changes.
2. For the approved manual deployment, open the official Remix IDE, create a separate workspace and upload the **contents** of the package's `sources` directory, preserving `contracts/...` and `@openzeppelin/...` paths. Compile `contracts/ReceivLedgerV2.sol` using the exact pinned settings above (advanced JSON settings support viaIR). Compare its creation bytecode plus the Manager argument against `creation-bytecode.txt`/the package data hash; stop if it differs. Select **ReceivLedgerV2**, Browser Extension/MetaMask, Sepolia `11155111`, the confirmed deployer, constructor Manager `0x79b246212650b686a0e9e5726092b1558b35d974`, value **0**, and a fresh validated gas limit. Only after approval, inspect the wallet's contract-creation data and approve that one deployment. Do not use the flagged Preview domain. This step creates a new address; it is not an upgrade, V1 call or migration. [Official Remix compile/deployment instructions](https://remix-ide.readthedocs.io/en/latest/run.html), [advanced compiler configuration](https://remix-ide.readthedocs.io/en/latest/compile.html).
3. Save the real receipt/new contract address and verify the deployed runtime hash against the package. Verify owner, zero capital/units/requests, policy constants, automation disabled and no overdue surcharge. Then publish source on **Sepolia** Etherscan using `standard-input.json`, fully qualified name `contracts/ReceivLedgerV2.sol:ReceivLedgerV2`, compiler `v0.8.38+commit.1835d247`, MIT licence and `constructor-arguments.txt`. Standard JSON retains viaIR and all exact imports/settings. Source verification data is prepared and bit-for-bit recompiled locally; explorer publication/compiler availability has not been verified. It requires the deployed address and separate approval. [Official Etherscan verification guidance](https://docs.etherscan.io/contract-verification/verify-with-api).

For later website/backend integration, use this **new** chain/address and exported ABI only. Keep the V1 address `0x18c6751a1a116053e413459464c9b1af356dbf1f` unchanged. V2 starts empty and has no V1 token import. No frontend environment variable or hosted `V2_CONTRACT_ADDRESS` is changed here.

## Wallet roles and recommended approved test sequence

Manager and deployer: **`0x79b246212650b686a0e9e5726092b1558b35d974`**. The constructor gives this address ownership; deployment alone grants no Investor/SME status or operator permissions. The current owner is deliberately ineligible as an investor/SME. Investors A/B and SMEs A/B must use separately confirmed participant wallets, linked to correct canonical identities. An optional executor is a separately authorised wallet; no server operator key or worker is installed.

After approval/deployment/source verification, test in this order:

1. Manager reads initial state and attempts one unauthorised action from an unapproved participant; expect rejection. Create pending participant bindings and verify financial actions are blocked, then Manager approves the fictional investor/SME. Keep all evidence fictional and private information off-chain.
2. Investor requests S$10,000 (`1000000` cents); Manager confirms a unique simulated receipt; owner or an enabled authorised executor processes it. Check 10,000 RLU2, S$10,000 cash/NAV, S$1 initial unit value and no income. No ETH/SGD is transferred as fund capital.
3. Submit the S$4,000 (`400000` cents) invoice and expect policy failure at this capital level. Add manager-reviewed simulated capital to at least S$400,000, with acknowledgement at the exact boundary, or S$500,000 for the demonstrated 0.8% scenario. Check lifetime automatic usage does not reset. Manager independently attests the invoice; an enabled authorised executor approves/finances it; verify S$3,980 cash advance, S$4,000 principal and S$20 fee.
4. Test collection on the same obligation using unique payer/SME references, inspect live accrued interest and verify NAV does not recognise it twice. **Sepolia time cannot be fast-forwarded.** The day-20 result is proven locally; on Sepolia charge only actual elapsed seconds (an immediate tiny payment may have zero whole-cent interest). Do not backdate data or alter rates to imitate 20 days.
5. Investor requests a partial exit; Manager reviews/allocates; owner/enabled executor settles once. Inspect cash reservation, unit burn, active NAV, ownership and event history. Repeat with two investors/SMEs, insufficient liquidity, a revoked permission, an impairment and a final exit waiting for the unresolved loan to repay. A second settlement/receipt/invoice financing must fail.

Any role-granting, funding/collection attestation, loan or redemption step above is a real Sepolia transaction after deployment, although its financial assets are simulated. None was executed during this review. No hosted backend activation or production integration is implied.

## Final verification, artifacts and readiness

- **90 Solidity tests passed**, zero failures, skipped or cancelled (`npm.cmd run test:solidity`), approximately 237 seconds. This includes the original 83 strengthened for cold-state gas, four lifecycle/security tests and three deployment/verification tests. The 100-loan stress uses 3% accepted overdue terms and a first materialisation of base and overdue interest, rejects loan 101, reuses a repaid slot and remains inside the transaction budget.
- **372 frontend/database tests passed**, zero failures (`npm.cmd test`). Existing non-failing Node local-storage warnings remain.
- TypeScript passed; the final `npm.cmd run build` includes `tsc --noEmit` and built 267 modules successfully. Both existing registry and local V2 registry entry points passed `npm.cmd run typecheck:edge`.
- The confirmed-role **offline** preparation command passed with `placeholderRoles=false`, `broadcasted=false`, `rpcCheck=null` and the expected Manager as owner of the empty local fund. No wallet-specific RPC call or live gas estimate was performed.
- Self-contained Standard JSON recompilation matched both bytecodes and ABI exactly. Constructor arguments are `00000000000000000000000079b246212650b686a0e9e5726092b1558b35d974`.
- Accounting invariants passed across the full suite, including the independent seeded model and complete lifecycle journal. Test receipts carry no fabricated network transaction hash.
- `git diff --check` passed. Protected V1 contract/ABI/config hashes match their pre-review values, and no V1 migration/registry changes are present. `.env.local` remains ignored/untracked; only `.env.example` is tracked. Existing uncommitted work was preserved.
- No dependency versions were changed in this review. The previous dependency audit's six development-tool advisories remain relevant (three moderate, one high, two critical); it reported zero production vulnerabilities. No new online audit was performed after the offline-only instruction. This does not establish an absence of vulnerabilities.

Changes in this review: the two focused V2 contract corrections and regenerated ABI; pinned compiler/source-bundle checks in `scripts/compile-v2.mjs`; new unsigned `scripts/prepare-v2-deployment.mjs`; transaction-isolated gas/receipt harness; strengthened capacity test; new `Readiness.test.mjs` and `Deployment.test.mjs`; this report and documentation links. V1 source/runtime, hosted services and production frontend behaviour were not changed.

**Decision:** no unresolved critical defect was identified in the final tested scope. The contract is locally ready to proceed toward **controlled Sepolia testing with simulated financial balances**, after separate approval and a fresh live preflight of the confirmed wallet. It is not approved for broadcast by this report, not independently audited and not suitable for real assets/production lending. The remaining deployment blockers are operational: approved live sender nonce/balance/code/gas checks, approval of the exact creation request, source publication on the resulting new address and subsequent actual-network acceptance tests. Hosted onboarding/document/keeper activation requires its own review and approval. Stop here; do not deploy based on the offline nonce or assume the website is integrated.
