# V2 financial accounting and contract review (historical)

**Superseded policy:** [V2_BUSINESS_RULES.md](V2_BUSINESS_RULES.md) records the later S$100,000 hard cap, S$50,000 automatic facility, cumulative investor limit, registration gates and accrual-based NAV. In particular, the cash-realisation NAV below is no longer the current implementation. This document preserves the earlier review and its test results.

Review date: 2026-10-23. Repository: `C:\Users\Eugen\Documents\GitHub\ReceivLedger`. Branch: `feat/v2-financing-redemption`.

This review finalises the existing local V2 simulation. It does not deploy V2, integrate website transactions, migrate V1, change Supabase or transfer real assets. The existing uncommitted V2 and wallet-isolation work is preserved. V1 Solidity and its deployed address are unchanged.

## Accounting policy

All contract financial amounts are integer **SGD cents**, not ETH, wei or token-dollar market values. RLU2 has two decimals. The contract starts with zero cash and zero units. Funding, disbursement, collection, refunds and redemption settlement are simulated ledger entries attested by authorised callers. They are not proof of bank payments. There are no payable functions or external asset transfers.

For this university model, S$20 withheld from each gross advance is recognised immediately as processing fee income. Future quoted interest is never booked at financing. Contractual base interest accrues at 8% simple annual interest on **unpaid gross principal**, using actual elapsed seconds divided by 365 days. Interest is not compounded. Accrued unpaid interest is reported separately from collected base interest and collected overdue interest. Optional additional overdue interest defaults to zero, is capped at 3% annually and requires acceptance at submission; it cannot retrospectively change an existing loan's terms.

**NAV retains the existing conservative cash-realisation policy:** cash plus unpaid principal less impairment and allocated redemption liabilities. Accrued unpaid interest is a memorandum receivable excluded from this NAV. Only collected interest enters NAV. This is a deliberate valuation simplification, not an accrual-basis or fair-value NAV. Investors entering before collection can share subsequent collected interest; holders whose redemption has already been allocated do not receive later interest, even if accrued during their holding period. A manager valuation confirmation does not remove that limitation. Accept this policy explicitly before using the simulation with external participants; commercial use would require a separately designed valuation policy.

The upfront fee treatment also differs from formal accounting when origination fees are integral to the effective interest rate; those fees generally form part of effective-interest measurement under IFRS 9. This model is not represented as IFRS-compliant. See [IFRS 9, paragraphs B5.4.1–B5.4.2](https://www.ifrs.org/content/dam/ifrs/publications/pdf-standards/english/2023/issued/part-a/ifrs-9-financial-instruments.pdf?bypass=on).

### S$4,000 example

Assume 100% advance, S$20 fee, 8% base interest and no prior collection or additional overdue rate.

| Entry | At financing | Full repayment after 20 days |
|---|---:|---:|
| Gross principal booked | S$4,000.00 | Principal reduced to zero |
| Net cash advanced to SME | S$3,980.00 | No additional advance |
| Upfront fee income | S$20.00 | No second fee |
| Accrued unpaid interest | S$0.00 | S$17.53 immediately before payment; zero after |
| Collected interest | S$0.00 | S$17.53 |
| SME payment | None | S$4,017.53 |
| Fund NAV increase over opening capital | S$20.00 | S$37.53 |

Full payoff after one day charges S$0.87 interest; after 45 days it charges S$39.45. These examples use exact whole-day timestamps, floor to cents and assume no earlier payments. A 90-day quotation is an estimate, never upfront earned income. Interest stops when the obligation closes. Fractional-cent numerators carry across partial collections; final sub-cent residue is waived at closure. Collections pay base interest, additional overdue interest, then principal. Future accrual uses reduced principal.

### Cash and reporting interfaces

- `liquidCents`: cash belonging to the fund, including allocated redemption cash.
- `freeLiquidityCents()`: fund cash less cash reserved for allocated redemptions.
- `outstandingCents`: unpaid gross principal, not net cash advanced.
- `processingIncomeCents`: cumulative upfront fees; not added to debt again.
- `collectedBaseInterestCents` / `collectedOverdueInterestCents`: cumulative actual collected income; their sum equals `collectedInterestCents`.
- `netAdvancedCents` / `principalCollectedCents`: cumulative cash advances and principal recoveries for reconciliation.
- `pendingSubscriptionCents` and `smeReservePoolCents`: segregated custodial liabilities, excluded from fund NAV and lending liquidity.
- `custodialCashCents()`: fund cash plus those two segregated pools. Do not add redemption reserves twice.
- `invoiceAccounting(id)`: current principal, live accrued unpaid base/overdue interest, collected components, SME/payer collections, actual net advance/fee, reserve payable/released and impairment. Unfinanced/rejected invoices have no booked fee or cash advance.
- `accruedInterestPage(firstId, limit)`: bounded live unpaid-interest totals, maximum 100 invoices per page, with an exclusive `nextId`. At the end, `nextId == invoiceCount + 1`; stop rather than repeatedly reading that empty page. Pin all pages and related totals to the **same block** for consistent whole-fund reporting. These totals are separate from NAV.

The raw `invoices(id).interest` and `.overdue` getter fields only contain amounts materialised at the last collection; they are not current accrual. Use the live accounting view. Unknown invoice IDs now revert in both the obligation and accounting views instead of appearing debt-free.

## Fixes in this review

1. Funding confirmations, simulated refunds and loan collections previously used independent receipt namespaces. A payment reference could be booked as both subscription funding and a loan receipt. All these paths now reject references already consumed by either ledger. This blocks exact reference reuse, not a dishonest manager inventing new references for the same external payment.
2. Added live, bounded accrual reporting and separate cumulative/per-invoice collected base and overdue interest. Added SME collection totals, cumulative net advances and principal recovery counters. These make cash, principal and income independently reconcilable without treating projected interest as earned.
3. Unknown obligations now revert rather than returning a misleading zero.
4. Shared accounting invariants now reconcile all invoice exposures, cash flows, segregated pools, funding states, token escrow and allocated redemption liabilities. Expanded repayment, reporting, liquidity and model-based fuzz regressions accompany the existing policy and permission tests.

The existing fee withholding and actual-second interest calculations were already correct and were retained. No frontend financial feature or V1 contract was rewritten.

## Policy review

| Requirement | Contract behaviour |
|---|---|
| S$10 million fund cap | Checked at subscription request and processing against fund assets, including reserved cash. This is a capital-admission ceiling; later income is not erased if assets exceed it. Further subscriptions are blocked. |
| NAV subscriptions/redemptions | Initial par only for an empty fund. Later prices use active NAV and units, with floor rounding and user minimum limits. Manager valuation required while principal is outstanding, valid at most 24 hours and invalidated by financing, collection or impairment. |
| Redemption liquidity | Units escrow once. Every exit requires manager review. Insufficient cash gives Pending Liquidity, without fixing a payout. Allocation reprices, reserves full cash and excludes both committed units and liability from pricing. Settlement burns once. |
| S$10,000 automatic subscriptions | Approved investor, unique request nonce, owner-confirmed simulated funding, valuation, cap and minimum units still required. Larger requests require manager approval. Executor automation starts disabled. |
| S$5,000 / 1% automatic invoice policy | Both size limits, low risk, verification, independent authenticity attestation and credit clearance required. Over either threshold needs manager review. Current active NAV is the conservative fund-capital basis. |
| SME S$200,000 cap | Aggregate unpaid gross principal per canonical verified entity across wallets. Binding cannot change while a wallet owes principal. Rechecked when financing. |
| Maturity | Future and at most 90 days at submission and financing; financing cannot proceed after expiry. |
| Advance | 100% gross through S$5,000 inclusive; 90% above. S$20 withheld once. Net proceeds must be positive. |
| Interest and early payment | 8%, actual seconds, unpaid principal, no compounding or early repayment penalty. Optional overdue terms explicit and fixed per invoice. |
| Rejection and collection | Rejected invoices cannot finance and generate no fee. SME/payer payments share one debt; payer total capped at face. Extra payer cash becomes SME reserve, not income. SME overpayment is rejected. |
| Permissions | Two-step owner transfer; ownership renunciation disabled. Executors cannot confirm funding/collections, grant verification, first-approve exits or manager-approve invoices. Attestors cannot attest their own invoice. |
| Automatic execution | Contract gates are enforced on every execution, including after state/policy changes. No scheduler, signer custody or live worker is installed. |
| Wallet isolation | Existing selected-account preflight, identity epochs and stale-response protection preserved and covered by frontend regressions. This review performs no wallet interaction. Live V2 private onboarding/action screens remain unimplemented. |

Canonical entity/payer IDs and authentic invoices depend on an independently reviewed off-chain registry. Exact document/reference replay is blocked, but altered copies or false canonical IDs cannot be identified by Solidity alone. No private documents or personal registration data should be placed on-chain. V1 Supabase approvals do not automatically grant V2 permissions.

## Reconciliation and test coverage

Invariants run after every original scenario and after each step of five deterministic 20-step model-based repayment sequences. The reference model independently maintains rational elapsed-second interest and unpaid principal. Coverage includes exact 1/20/45-day payoff, second-level timestamps, partial collections, mixed SME/payer payments, replay across payment namespaces, surplus release, optional overdue reporting, bounded pages, two competing investors, minimum payout, insufficient liquidity, threshold boundaries, revoked participants, role violations and duplicate processing.

Core equalities, all in cents:

```text
fund assets = liquid + outstanding principal - impairment
active NAV = fund assets - allocated redemption liability
fund assets + settled redemptions
  = subscriptions + upfront fee income + collected interest - impairment
liquid + settled redemptions + cumulative net advances
  = subscriptions + recovered principal + collected interest
custodial cash = liquid + pending subscriptions + SME reserve payable
SME collections + payer collections
  = collected principal + collected interest + SME reserve payable + reserve released
```

Invoice principal/exposures, fee/net-advance totals, base/overdue income, pending funding, redemption escrow, reserved units and token supply are also reconciled. These are deterministic local EVM tests, not exhaustive formal verification or an independent security audit.

## Deployment limits and outstanding activation

This is a candidate for a **controlled, simulation-only** Sepolia deployment after review and separate approval. It is not ready for real funds or production lending. Accept the NAV/fee policies, manager trust, impairment process, canonical identity checks and operator model first. A compromised owner can attest fictitious funding/collections, approve roles or misstate impairment. Permissioned automation is not trustless underwriting. Existing operator grants survive owner transfer unless explicitly revoked; review them during manager rotation.

V2 has not been deployed. Until separately deployed and integrated there are no live V2 subscriptions, financing, repayments, redemptions or automation through the website. A deployment alone will not provide wallet forms, V2 Supabase role verification/private document access, manager workflows, a keeper or real payment rails. Existing V1 remains independent. There is no V1 migration, redemption/dividend payment or real SGD/ETH funding in this work.

## Final local verification

- Solidity/EVM: **63 passed, zero failures** (`npm.cmd run test:solidity`), including 16 new accounting/reporting scenarios and five seeded repayment sequences within that count. Every original scenario also runs the expanded shared invariants.
- Solidity compile: solc 0.8.38, optimiser 200 runs, viaIR, Cancun, no warnings. Runtime **21,248 bytes**, below EIP-170's 24,576-byte limit. Compiled ABI matches `src/v2/abi.json`.
- Frontend/database tests: **353 passed, zero failures** (`npm.cmd test`), including existing V1, wallet-session and local RLS regressions. Existing non-failing Node `--localstorage-file` warnings remain.
- TypeScript: passed (`npm.cmd run typecheck`).
- Existing registry Edge Function: passed (`npm.cmd run typecheck:edge`); source and hosted configuration unchanged.
- Production build: passed (`npm.cmd run build`), 264 modules, separate V1 and V2 entries. Build output remains ignored and unpublished.
- Full npm audit: six existing development advisories (three moderate, one high, two critical) in Vite/Vitest and transitive tooling. Production-only audit: **zero**. No major tooling upgrade was attempted in this accounting change; development tooling should be reviewed separately before opening a development server to untrusted users.
- `git diff --check`: passed. V1 contract, V1 ABI/address and `supabase/config.toml` hashes are unchanged. `.env.local` remains ignored and untracked. No secret values were printed.

Changed specifically during this finalisation: `contracts/ReceivLedgerV2.sol`, generated `src/v2/abi.json`, `test/v2/ReceivLedgerV2.test.mjs`, new `test/v2/Accounting.test.mjs`, new `test/v2/accountingAssertions.mjs`, this document and `docs/V2.md`. Other pre-existing uncommitted V2/wallet work was preserved. Everything remains local and uncommitted; no deployment, hosted write, wallet transaction, commit, push or merge occurred.
