# Phase 5A — financial review and offline integration testing

Reviewed on 22 October 2026 in `C:\Users\Eugen\Documents\GitHub\ReceivLedger`, branch `feat/phase4-supabase-audit`. Existing uncommitted Phase 4 changes and migration 002 are preserved. No Solidity, contract address, hosted database, Edge deployment or blockchain transaction was changed or executed. No new financial features were added.

## Calculation and integration review

The existing numerical formulas match [BATCH3.md](BATCH3.md); no formula rewrite was needed.

| Area | Verified behavior |
|---|---|
| SME limit | Lower of fund-concentration and optional sales caps, multiplied by the selected risk factor; subtract only the SME's active full-face Financed principal. Missing sales leaves fund-policy capacity; explicit zero sales gives zero sales capacity. Overdue SME debt pauses the demonstration recommendation. |
| Liquidity and payer cap | Proposed advance uses the minimum of SME headroom, payer headroom and reserve-adjusted liquidity. The separate contract preview checks the full face against available funds and the actual integer payer cap. Only Financed records contribute to payer exposure; payer names use ASCII lower-casing without trimming. Exact cap/liquidity and 90-day maturity boundaries are inclusive; reached maturity is ineligible. |
| Advances and fees | 70–90% advance, rounded down to cents. Simple discount is advance × annual rate × charged days / 365, rounded half-up; service fee is face × fee rate, rounded half-up. No compounding. Positive fractional remaining days round up; a zero-day what-if still charges its service fee. |
| Settlement | Advance + reserve = face; fund retention + final SME balance = face; initial advance + final SME balance = total SME proceeds. Excess fees remain negative SME settlement/proceeds, with an additional-payment warning. These identities are tested across tiny/large amounts, rates and durations. |
| Maturity | Only Financed records strictly past maturity are overdue; exact maturity is due now. Repaid/Rejected remain closed. Unfinanced records reaching maturity must not imply an unpaid financing obligation. |
| NAV | Available simulated funds + active principal − assumed impairment + entered additional income − entered liabilities. Repaid principal is already reflected in liquidity and is never added again. Full impairment affects only active principal. Negative NAV remains visible. |
| RLU ratios | Contract money integers represent whole simulated S$ and are converted to bigint cents once. RLU has zero decimals. NAV/unit displays six decimals; ownership displays two percentage decimals. Holdings value uses the unrounded NAV/supply ratio. Zero supply produces undefined ratios; inconsistent holdings are rejected. |
| Blockchain reads | Financial snapshots use the connected wallet's balance and contract invoice mappings at one block. Reads have no sample-balance fallback. ChainLedger uses the injected read provider; LedgerContext verifies Sepolia and scopes wallet/role state. Read errors remain visible and may retain a dated prior same-wallet snapshot. |
| Access and isolation | Manager reports remain manager-only in the UI. Approved and inactive investors retain personal holdings illustrations. SME assessments select only the current wallet's open requests. Existing tests cover account, role, network and A→B→A invalidation. Public chain records remain public. |
| Supabase independence | New integration tests render the real FinanceProvider, reporting screens and RegistryProvider with `client={null}`. Read-only fixtures verify manager refresh/repayment accounting and inactive-investor-to-SME switching. Transaction callbacks fail if invoked; no successful blockchain transaction is simulated by these new tests. |

## Confirmed fixes

1. Unknown invoice statuses, wrong/default mapping IDs and zero-face records previously could enter financial snapshots and be silently excluded from active exposure/NAV. The financial reader now rejects these unusable portfolios with an explicit error. This is an error-path fix; no claim is made that such records exist on Sepolia.
2. Inactive-investor Home and the global banner labelled every currently unapproved wallet as revoked. The classification can also come from holdings/history without proof of revocation. They now say “Not approved” and preserve holdings reporting, including a neutral heading for zero holdings.
3. Matured Submitted/Approved records said “not repaid” despite never being financed. They now say “Maturity reached · not financed”; financed due/overdue behavior is unchanged.
4. An SME with a successfully loaded empty/open-request-free portfolio lost the block/source, refresh control and any later refresh error. These remain visible in the empty state.
5. SME Home incorrectly described mapping-derived records as event/history-window results. Its source and empty-state labels now match the actual reads.

## Files changed in Phase 5A

- Runtime: `src/App.tsx`, `src/chain/chainLedger.ts`, `src/finance/models.ts`, `src/pages/Dashboard.tsx`, `src/pages/Reports.tsx`.
- Regression coverage: `src/App.test.tsx`, `src/finance/models.test.ts`, `src/finance/reporting.test.tsx`, `src/finance/snapshot.test.ts`, new `src/finance/offlineIntegration.test.tsx`.
- Documentation: `docs/BATCH3.md`, new `docs/PHASE5A.md`.

## Verification and limitations

Passed TypeScript, Edge Function type checking, all **201 tests in 15 files**, production build, and whitespace checking. The 182-test baseline gained 19 tests. An initial new integration assertion depended on the host clock; its clock is now fixed to the fixture timestamp. Existing Node jsdom local-storage warnings are non-fatal.

Automated integration uses read-only fixtures, not a live Sepolia or MetaMask session. Manual browser/mobile checks remain outstanding. Financial assumptions are arbitrary demonstrations, not verified credit evidence, fair value, lending approvals or earned income. The contract still finances full face, collects no modelled fees and provides no partial advances, reserve-release payments, redemptions or distributions. Device-clock maturity previews update each minute; execution block time is authoritative. Reports require manual refresh and reject portfolios above 10,000 invoices pending pagination. Supabase activation remains pending and is not required for these financial features.

## Manual checklist (read-only)

Run `npm.cmd run dev`; leave Supabase unconfigured. Use existing records only and do not click transaction actions.

1. **Manager:** connect on Sepolia, open Financial reports and refresh. Check the block, outstanding/payer exposure and Repaid turnover. In the standalone calculator enter S$1,000 for 30 days: at defaults expect S$800 advance, S$200 reserve, S$7.89 discount, S$10 fee and S$182.11 final SME balance. Confirm labels distinguish the proposal from full-face contract financing and fees remain hypothetical. If all invoices are Repaid, expect no active exposure or forward income.
2. **Investor:** switch to an approved investor, then an inactive investor. Check reporting-block holdings, supply, ownership and NAV illustration; inactive holdings must remain visible with “Not approved”. Change NAV assumptions and try an invalid input, then switch wallets and confirm the prior illustration disappears and the manager report is unavailable. Do not transfer RLU.
3. **SME:** connect the invoice-owning wallet. Check that only its own Submitted/Approved requests are selectable, unfinanced matured records are not called unpaid financed debt, and Repaid records remain closed. Check the empty state and refresh control if there are no open requests. Review face/advance/fee labels without submitting or financing anything.

Phase 5A ends here. No Phase 5B or Phase 6 work was started.
