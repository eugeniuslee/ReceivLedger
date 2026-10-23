# Deployed contract status

V2 is now deployed and verified at 0x9672b0aec292c9f8dd8fefbc9daab876b8ec9882 on Sepolia. See [deployment verification](V2_DEPLOYMENT_VERIFICATION.md) for exact receipt/code/ABI/Manager evidence. Backend identity/document integration, automation workers and financial UI execution remain inactive/incomplete. Pre-deployment wording below records earlier review stages; no additional deployment is needed.

# V2 final business rules, registration and risk review

The later [final deployment-readiness review](V2_DEPLOYMENT_READINESS.md) records the confirmed Manager/deployer, 90 Solidity tests, corrected cold-state gas estimates and two focused fixes: unresolved-loan final exits and rejected-evidence recovery. Its deployment results supersede the earlier verification figures below; these business limits and accrual policy remain in effect.

2026-10-23, branch `feat/v2-financing-redemption`, repository `C:\Users\Eugen\Documents\GitHub\ReceivLedger`.

This document supersedes the S$200,000 SME limit, per-request automatic subscription allowance and cash-realisation NAV policy in the earlier V2/accounting reviews. The prior work is preserved; V1 and hosted resources are unchanged. All new work remains local and uncommitted. No wallet signature, transaction, deployment, hosted migration or secret configuration was performed.

## Enforced registration controls

The contract uses explicit registration states: 0 Pending Review, 1 More Information Required, 2 Rejected, 3 Approved, 4 Suspended, 5 Revoked. Investor and SME canonical identities aggregate associated wallets. Only the V2 owner can bind identities and change registration permissions. The current owner cannot register itself as an investor/SME. Identity bindings are permanent even after repayment, exit or rejection; a wallet cannot change identity to reset a limit. Associated SME wallets cannot attest an invoice belonging to their own entity.

Only approved investors can request subscriptions, receive newly issued units, transfer units with other approved investors or request a new redemption. Approval is rechecked at issuance and redemption allocation. Nonapproved holders can still inspect public holdings and cancel unallocated redemptions; settlement of an already allocated liability remains possible because it is an existing obligation. This replaces the earlier policy allowing revoked holders to initiate new exits.

Only approved SMEs can submit financing invoices. Approval is checked again at approval and funding, so a pending request cannot outlive a permission revocation. Collections remain possible on existing debt regardless of current registration, without granting new financing.

### Local trusted backend implementation

`supabase/functions/registry-v2/index.ts` and `_shared/v2registry.ts` provide a **separate, undeployed** V2 registry handler. They do not change the live V1 `registry` function. The handler validates the Supabase session with Auth, derives the wallet using the existing protected `rl_current_wallet()` RPC, checks the live independently configured V2 owner/permissions on Sepolia and ignores supplied manager/actor/wallet claims.

Actions:

- `submit`: fictional registration details only. Server/SQL derive owner and wallet; a duplicate cannot become a new application.
- `status`: RLS limits results to the session user's current wallet.
- `applications`: current V2 owner only; capped at 200 recent applications for the prototype, with only the opaque entity exposed from the identity registry. Larger queues require pagination before operational use.
- `bind_identity`: manager supplies an independently verified canonical reference. A persistent server-only HMAC key produces a private canonical digest. SQL deduplicates that digest per role; associated wallets share the same random opaque on-chain identity. The canonical reference/digest is never published on-chain.
- `review`: independent manager only, current application version, review note and exact permission receipt. Once bound, **every** status change requires a successful matching owner transaction to this V2 contract, two confirmations, the correct method/wallet/identity/state and matching current on-chain permission. No server signer is installed. An SME entity-wide status change synchronises linked applications; per-wallet permission flags may still require explicit restoration.
- `authorize`: both approved database registration and current matching on-chain identity/approval are required. The result is informational, not an execution credential; Solidity independently rechecks every financial call.

The local SQL activation draft is **`supabase/v2/registration.sql`**, intentionally outside `supabase/migrations`. It creates only `rl2_identities`, `rl2_applications` and `rl2_review_audit`, RLS and scoped RPCs. It does not modify V1 tables, authentication helpers or document policies. Applicants have no direct writes or review permissions, may read only their own current-wallet application and may update details only while More Information Required with the current version. They cannot self-promote its state. Manager identity binding/review RPCs are service-role only; row locks, permanent binding, unique wallet/user constraints, canonical digest uniqueness and version checks protect concurrent reviews and duplicates.

Do not apply this draft to the hosted project without a separate review and explicit approval. It assumes the existing reviewed V1 session/profile helpers are installed. V2 private document uploads/downloads and full live registration forms are not added here; no V1 document access was broadened. Independent document/KYC verification and association of genuine identities remain a trusted review process. A manager inventing a different canonical identity/reference can still misrepresent a person; cryptography cannot establish their real-world identity. Preserve the HMAC key and canonicalisation rules; rotating it without reconciling existing aliases can defeat deduplication.

## Subscription policy

Automatic processing has a **S$10,000 lifetime cumulative limit per investor identity**, shared across wallets. Only automatically processed amounts consume this allowance; manager-reviewed subscriptions do not reset or replenish it. Redemptions, cancellations, rejects and switching wallets never reset lifetime usage. A manager can review further investment, subject to all other checks.

Multiple ready requests may fit the unused allowance when requested but processing atomically rechecks the combined lifetime amount. The first processed request consumes capacity; the next reverts until explicitly manager-reviewed. Every issuance requires an owner-confirmed unique simulated funding receipt, approved identity, fresh valuation when needed, capital ceiling and minimum accepted units. Funding/collection/refund reference replay protection from the accounting review is retained.

## Financing policy and reservations

| Rule | Enforced behaviour |
|---|---|
| SME hard cap | **S$100,000** unpaid gross principal plus approved gross commitments per canonical SME across wallets. The owner cannot override it. |
| Automatic facility | **S$50,000** unpaid automatically financed principal plus approved automatic gross commitments. Manual financing still contributes to the SME hard cap and NAV concentration. |
| Automatic invoice | Face at most S$5,000; maturity within 30 future days; low risk, independently attested, credit cleared, approved SME, sufficient liquidity and payer capacity. |
| Automatic concentration | Combined SME principal plus approved commitments plus this proposed advance must not exceed 1% of current active investment NAV. At exactly 1%, explicit Manager acknowledgement is also required, conservatively reconciling the requested high-risk indicator with the inclusive automatic ceiling. |
| Manager review | Maximum 90 future days; above the automatic size/facility/maturity/concentration/risk thresholds needs review. At or above 1% of NAV the invoice must have explicit `acknowledgeConcentration(id)` before manual approval/funding. |
| Common payer cap | 10% of active NAV, across all SMEs, counting unpaid principal and approved gross commitments. No automatic or manager override. |
| Gross advance | 100% through S$5,000; 90% above. S$20 withheld once; 8% simple annual interest on unpaid principal using actual seconds. |

Approving an invoice atomically reserves its **net cash advance**, gross SME capacity, common-payer capacity and (where applicable) automatic facility capacity. Submitted proposals do not reserve financial capacity and are displayed separately. Concurrent pending approvals cannot bypass the limits. Financing replaces its own commitment with principal without counting it twice; cash disbursement consumes the reserved commitment. Rejection releases reservations. Repayment reduces funded exposure, including automatic exposure when applicable. An expired/revoked approval cannot finance; an owner must reject it to release the commitment. No silent expiry worker or future disbursement guarantee exists.

Financing rechecks current NAV, permissions, concentrations, maturity and liquidity. A fall in NAV after approval may block an automatic invoice or require manual concentration acknowledgement. The acknowledgement records the specific invoice, exposure and NAV in an event; it never bypasses the hard cap. Integer-cent threshold calculations round conservatively. Allocated investor exits and financing commitments cannot spend each other's reserved cash.

## Accrual-based investment NAV

The earlier exclusion of earned unpaid interest could move value from exiting investors to incoming investors. That policy has been replaced:

```text
fund assets = fund cash + unpaid gross principal + earned unpaid interest - expected losses
active investment NAV = fund assets - allocated redemption liabilities
custodial assets = fund assets + pending subscription cash + SME reserve cash
fund liabilities = allocated exits + pending subscriptions + SME reserves
active investment NAV = custodial assets - fund liabilities
free lending/redemption liquidity = fund cash - allocated exit cash - financing commitments
```

Subscription units and redemption values use the same current NAV and active pricing units at execution. Accrual uses elapsed seconds on unpaid principal, including only earned time and carrying fractional-cent remainders across partial collections. No future quoted 30/90-day interest is recognised. Interest does not compound. Final sub-cent residue is waived. The S$20 fee remains immediate simplified university fee income; formal IFRS effective-interest treatment may differ, as explained in the historical accounting review.

Interest collection decreases the accrued receivable and increases cash by the same amount. It is **not new income/NAV a second time**. Principal collection similarly converts a receivable to cash. Payer/SME collections offset one obligation; surplus remains a segregated SME payable. Expected losses can cover principal and earned interest, not only principal. Recovering an impaired balance can reverse the associated expected loss. Manager valuation/impairment review remains required while debt exists, valid for at most 24 hours; income growth does not create spendable liquidity.

At S$4,000 gross financing: cash falls S$3,980, principal rises S$4,000 and fee income/NAV rises S$20. At day 20, S$17.53 earned unpaid interest increases NAV even before collection. Receiving S$4,017.53 then clears both receivables and increases cash; NAV does not increase again. A new subscription before collection pays for that earned receivable; a redeeming investor receives its share subject to actual liquidity and impairment.

For the bounded university prototype, at most **100 concurrently active loans** are permitted. A bounded active-loan list calculates exact live accrual and checkpoints it before financial mutations. Repaid loans are removed, so repaid history does not increase transaction cost. This is an explicit scalability limit, not a production fund architecture; a larger fund needs a separately reviewed accrual/indexing design. Manager expected losses must be kept current, especially for overdue/defaulted loans: contractual earned interest is not proof it will be collected. This remains a simplified model, not IFRS-compliant fair value, regulatory capital accounting or real-money custody.

## NAV movement journal and reports

`NavMovement` events record execution timestamp, invoice/investment reference, event type and signed cash, gross loan-receivable, income/loss and active NAV impacts. Chain receipts supply transaction hash, block and log index. Events distinguish subscriptions (capital, zero income), financing (fee income), interest accrual, collections (no second interest income), expected losses/reversals, redemption allocation (liability) and settlement (cash discharge of that liability). `earnedInterestCents`, collected base/overdue interest, principal, cash, fee, impairment and segregated liability counters remain separate.

Elapsed-time NAV can increase between transactions without an event. At the next financial checkpoint, earned interest receives its journal entry. Reporting shows the live uncheckpointed accrued amount separately and already includes it in current NAV; do not add it twice. Event histories must be complete for a lifetime reconciliation. References are disambiguated by event type (invoice versus subscription/redemption ID).

The isolated `/v2.html` preview can inspect a future independent V2 contract using public reads only. It displays:

- SME principal, approved gross commitments, pending proposals, combined NAV percentage, S$100,000 credit usage, invoice/repaid counts, recovered principal, collected interest, maturity/overdue days, common-payer totals across SMEs and free fund liquidity.
- Moderate concentration at 0.5%, approaching recommended limit at 0.8%, and high at 1%. It explains how capital, repayments, defaults and exit allocations change percentages.
- Investor total assets, active investment NAV, NAV per RLU2, active holdings/ownership/value, pending escrow and already allocated fixed exit claims without double counting.
- Recent NAV journal records with real receipt links. Reads use a single pinned block and explicit bounded history, never invented data. The preview covers at most 1,000 historical invoices/redemptions; beyond that it fails rather than displaying incomplete exposure/holdings totals. A reviewed indexer/paginated reporting service is required for larger datasets.

Public inspection grants no manager role or private record access. Manager transaction controls remain inactive. Identity/sequence guards discard stale reports even for A/B/A address changes. V1 wallet/session epoch fixes remain untouched. Journal reads page at most 10,000 blocks; the UI labels its recent range and does not claim a lifetime return. Displayed NAV-per-unit cents/ownership percentages are rounded; contract execution uses full integer ratios with the user's minimum units/payout.

## Local activation requirements, not executed

Before any deployment, review the new contract/ABI and this policy, perform independent security review as appropriate, and explicitly approve the controlled simulation deployment. The contract has no payable function or asset-transfer/payment rail. It starts with zero simulated funds, not S$10 million. No V1 balances, tokens or invoices are migrated.

After a separate approved deployment, review/apply the isolated SQL draft and configure/deploy the separate V2 handler only with approval. Required server settings: existing Supabase URL/anon/service-role settings, read-only Sepolia RPC, exact reviewed `V2_CONTRACT_ADDRESS`, explicit `V2_ALLOWED_ORIGINS` and a securely generated persistent `V2_IDENTITY_HMAC_KEY` (at least 32 characters, high entropy). Never paste those privileged values into chat or frontend variables. Use the existing audited Auth wallet-session helper; do not relax authentication. Configure a separate `[functions.registry-v2]` deployment entry with handler-side token validation equivalent to V1 only when deployment is approved. No such hosted/config change was made here.

No keeper, manager signer, operator custody, V2 private-document flow or live wallet/action integration has been deployed. An approved registration must be bound to the canonical identity, granted by the independent owner on-chain and finalised against its confirmed receipt. Hosted end-to-end registration and financial workflows remain unverified. Existing MetaMask warnings must not be bypassed. Simulated bookkeeping is not proof of bank/SGD/ETH transfer.

## Verification

- **83 Solidity/EVM tests passed**, zero failures. Includes all earlier repayment/replay/invariant scenarios, five deterministic 20-step repayment sequences and the new identity, lifetime allowance, repeated/concurrent requests, automatic facility, hard cap, payer commitments, 30/90-day maturity, exact 1% acknowledgement, post-redemption recheck, accrual pricing and expected-loss scenarios. The 100-active-loan stress scenario passes under the harness's 30-million execution-gas call bound, refuses the 101st active loan, reuses a repaid slot and checkpoints accrual at capacity. This is not a network transaction fee estimate or an independent gas audit. The full Solidity run took approximately five minutes, mostly that stress case.
- Solidity compile: **solc 0.8.38**, optimiser 200 runs, viaIR, Cancun, no warnings. Runtime **23,508 bytes**, below EIP-170's 24,576-byte ceiling. The generated ABI matches compilation. Custom `PolicyViolation(uint16)` errors and the checked-in `src/v2/policyErrors.json` codebook keep the contract within that ceiling while preserving readable client errors.
- **372 frontend/database tests passed**, zero failures, including the preserved V1/wallet-session/RLS suite and new actual disposable PostgreSQL V2 SQL tests, forged manager/session rejection, immutable canonical binding, version protection, receipt evidence, live permission gate, concentration/holdings calculations, empty reports and stale A/B/A response isolation. Existing non-failing Node `--localstorage-file` warnings remain.
- TypeScript passed; final production build also runs `tsc --noEmit`. Both V1 `registry` and the new local `registry-v2` Edge Function entry points passed Deno type checking.
- Production build passed, **267 modules**, separate V1/V2 entries; nothing was published.
- Dependency audit: **zero production vulnerabilities**; six existing development advisories remain (three moderate, one high, two critical in Vite/Vitest and their tooling). No dependency versions were changed during this business-rules update.
- V1 contract, ABI/address and `supabase/config.toml` hashes remain unchanged. Existing V1 migration/registry sources remain unchanged. `.env.local` stays ignored and untracked; no privileged values were read or printed.
- `git diff --check` passed. All work remains uncommitted on `feat/v2-financing-redemption`; the earlier working-tree changes were preserved.

Files changed/added specifically for this request:

```text
contracts/ReceivLedgerV2.sol
src/v2/abi.json
src/v2/policyErrors.json
src/v2/models.ts
src/v2/models.test.ts
src/v2/V2Ledger.ts
src/v2/V2App.tsx
src/v2/V2App.test.tsx
src/v2/Reports.tsx
src/v2/reporting.ts
src/v2/reporting.test.ts
src/v2/registration.test.ts
supabase/functions/_shared/v2registry.ts
supabase/functions/registry-v2/index.ts
supabase/v2/registration.sql
test/v2/harness.mjs
test/v2/accountingAssertions.mjs
test/v2/ReceivLedgerV2.test.mjs
test/v2/Accounting.test.mjs
test/v2/BusinessRules.test.mjs
package.json (check both Edge Function entries)
docs/V2_BUSINESS_RULES.md
docs/V2.md
docs/V2_ACCOUNTING_REVIEW.md (historical/superseded notice)
README.md
docs/HANDOVER.md
```

**Readiness:** the local contract is a candidate for controlled simulation-only Sepolia deployment after your policy/code review and explicit deployment approval. The revised economics replace the prior model, so the former quotation manual test is not sufficient acceptance: repeat its automatic/manual eligibility boundaries against the new rules. This is not production readiness or independent audit certification. Hosted activation, backend receipt verification against the eventual deployed address, actual wallet workflows and private V2 documents remain unverified/unintegrated. No website financial action or automatic worker has been activated.
