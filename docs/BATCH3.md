# Batch 3 — financial modelling and reporting

## Local implementation

The existing Batch 2 development files are retained. Batch 3 adds a manager **Financial reports** route, investor and inactive-investor Home valuation illustrations, SME Home assessments for their own open requests, and richer invoice details. No Supabase activation, migration, deployment, Solidity change or Sepolia transaction was performed.

The app keeps three distinct kinds of information visible:

| Information | Source and meaning |
|---|---|
| Contract-derived | Public Sepolia supply, connected-wallet balance, simulated capital/liquidity, invoice mappings, maturity and status |
| Proposed financing | Editable partial advance, reserve and fees for human review; not executable by the current contract |
| NAV/income scenarios | Explicit assumptions applied locally to public records; no earned income, redeemable balance or distribution |

Financial reporting reads all values and invoice mappings at one block, and displays its number and timestamp. Requests are invalidated on account/role/network changes, including an A→B→A wallet switch. Missing reads produce an error, never a sample balance. A failed same-wallet refresh may retain its visibly dated prior block. There is no automatic block subscription: use **Refresh report** or the existing **Refresh blockchain** control for current records. Reading more than 10,000 invoices fails explicitly pending pagination, rather than truncating exposure. Reports are manager-only in the interface; public chain data remains public.

## Assessment assumptions and reasoning

All assumptions are local to the mounted view, reset when it is left, and never stored as an approval, verified credit assessment or private profile. No KYC or Supabase data feeds the model. Defaults are arbitrary demonstration inputs, not market quotations or lending advice:

| Input | Default |
|---|---|
| Proposed advance | 80% of face, configurable from 70% to 90% |
| Simple annual discount | 12%, using a 365-day year |
| Service fee | 1% of face |
| SME concentration limit | 20% of simulated fund capital |
| Liquidity reserve | 20% of simulated fund capital |
| Sales-based limit | 10% of optional fictional annual sales; unused when absent |
| Unassessed / demo high risk factor | 50% |
| Demo moderate / low risk factor | 75% / 100% |

Recommended SME borrowing limit = minimum of the fund-concentration limit and the optional sales-based limit, multiplied by the chosen risk factor. Without a sales input, this is explicitly only fund-policy capacity. Actual outstanding full-face Financed principal for the SME is deducted to get remaining capacity. Demo policy pauses new lending when that SME has overdue financed principal.

Maximum proposed advance = the lowest of remaining SME capacity, actual payer-cap headroom, and available contract funds less the illustrative liquidity reserve (floored at zero). Payer exposure includes only active Financed invoices, grouped exactly with Solidity's ASCII-only lower-casing; spaces remain significant. The screen also shows overdue payer invoices. Risk categories are selected assumptions, not retrieved credit scores or verified company information.

Alongside this recommendation, the app checks the contract's **full-face** amount against actual available funds and its payer cap, Approved status, future maturity, and the contract's maximum remaining maturity. The device clock drives the preview; execution block time is authoritative. Passing a preview does not reserve funds or guarantee success. A modelled advance can fit while the actual full-face transaction cannot.

## Proposed fee calculation

- Initial advance = face × advance percentage, rounded down to cents.
- Reserve = face − initial advance.
- Discount = initial advance × annual discount rate × charged days / 365.
- Service fee = face × service-fee rate.
- Hypothetical gross fund income = discount + service fee.
- Expected payer settlement = full face value.
- Fund retains at settlement = initial advance + proposed fees.
- SME settlement balance = reserve − proposed fees; total SME proceeds = face − proposed fees.

Fees round half-up to cents; any positive fraction of a remaining day rounds up to a charged day. A zero-day standalone what-if has zero duration-based discount, with the service fee still applicable. Fees exceeding the reserve remain visible as a negative SME balance and a review warning; values are not silently clamped. The standalone calculator begins without a sample invoice amount and creates no chain record.

Example: hypothetical S$1,000 face, 80% advance, 30 days, 12% annual discount and 1% service fee → S$800 advance, S$200 reserve, S$7.89 discount, S$10 service fee, S$17.89 hypothetical gross income and S$182.11 SME balance at settlement.

These proposals appear before manager approval in Submitted invoice details. **Approve invoice** still only approves the existing invoice. **Finance full S$… on-chain** still calls `financeInvoice(invoiceId)` and commits 100% of face with no fee; editing a proposal never changes its arguments.

## Maturity and repayment

Expected payer dates come from stored maturity, displayed in Singapore time. Only an invoice still marked Financed is overdue after maturity; at the exact timestamp it is due now. The countdown updates every minute and uses the device clock. Submitted/Approved invoices can have passed maturity but are not labelled overdue financed debt. Repaid and Rejected remain closed. Overdue counts are a subset of Financed, never another ledger status.

Invoice details show real lifecycle events and transaction links loaded by the existing history index. Dates are actual block timestamps when available. Incomplete event indexing is disclosed; the app never invents a repayment date from maturity. Recording repayment still requires the existing explicit manager action. SME details remain read-only.

## Reporting and NAV

Manager reporting includes supply, simulated capital, available capacity, active principal, payer exposures/headroom, invoice statuses, overdue principal, repaid-principal turnover, and a reconciliation check. Repaid principal is not revenue. A separate hypothetical remaining-term income scenario applies the selected annual rate to actual active principal over remaining days; it excludes overdue/repaid invoices and assumes no service fees on existing loans. It is neither accrued nor realised income and is not automatically added to NAV.

Illustrative NAV = available simulated funds + active Financed principal − assumed principal impairment + explicitly entered additional income − explicitly entered liabilities. `totalFundSize` is not used as NAV. Defaults are zero income, zero liabilities, zero impairment, and principal recovery at face; this is not independently verified fair value. Repaid principal is already in available funds and is not added twice.

NAV per RLU = scenario NAV / actual supply. Investor holdings value = scenario NAV × connected-wallet balance / actual supply. Both ownership and ratios use the same reporting block. Zero supply gives undefined ratios, not zero or infinity. Negative stress NAV remains visible. Money uses bigint cents, NAV per unit displays six decimals, and ownership displays two percentage decimals. Underlying ratios are calculated directly rather than multiplying rounded per-unit values.

For conceptual context, see the [Investor.gov definition of NAV](https://www.investor.gov/introduction-investing/investing-basics/glossary/net-asset-value) and the [British Business Bank introduction to invoice finance](https://www.british-business-bank.co.uk/business-guidance/guidance-articles/finance/invoice-finance). The project's example rates and policy thresholds are not sourced market rates.

## Implementation files

| File | Change |
|---|---|
| `src/finance/models.ts` | Pure bigint fee, borrowing, exposure, maturity, portfolio, NAV and history calculations |
| `src/finance/FinanceContext.tsx`, `presentation.ts` | Read lifecycle, wallet isolation, minute clock and Singapore dates |
| `src/chain/chainLedger.ts` | Block-pinned read-only financial snapshot; existing write methods preserved |
| `src/components/FinancialModels.tsx` | Assumption inputs, assessment, proposal calculator and NAV bridge |
| `src/components/InvoiceTimeline.tsx` | Actual lifecycle/repayment events |
| `src/pages/Reports.tsx` | Manager report, investor illustration and own-SME assessment |
| `src/pages/Dashboard.tsx`, `Invoices.tsx` | Home integration, overdue filtering/counts and detailed review |
| `src/App.tsx`, `src/chain/access.ts`, `navigation.ts` | Reporting provider and manager route/access |
| `src/styles.css` | Responsive reporting/model styling using existing design |
| `src/finance/*.test.*`, `fixtures.ts`, `src/App.test.tsx` | Calculation, read consistency, scenario isolation, role and wallet regression tests; fixtures are test-only |
| `README.md`, `docs/HANDOVER.md`, this file | Current state and limitations |

## Dependencies still pending

Batch 3 needs no new environment variables and works with Batch 2 Supabase disabled. Wallet-linked registration/names, secure signed-message sessions, manager application decisions, off-chain SME verification, private fictional KYC and invoice PDFs still require the approved Supabase configuration/migrations/function activation and hosted acceptance described in [SUPABASE_SETUP.md](SUPABASE_SETUP.md). Batch 3 does not activate or modify them.

Actual partial advances, stored accepted fee terms, fee accrual/collection, reserve release, losses/write-offs, redemptions and investor distributions require future contract/accounting/payment designs. Existing Solidity cannot execute these scenarios. No realised performance, paid dividends, real SGD balance or guaranteed returns are claimed.

## Verification and manual check

Final local checks passed: `npm.cmd run typecheck`, `npm.cmd run typecheck:edge`, `npm.cmd test` (177 tests across 14 files), and `npm.cmd run build` (which repeats TypeScript checking). This adds 57 tests to the 120-test Batch 2 baseline. The existing Node local-storage warning appears in jsdom test workers; browser storage is explicitly stubbed where used and all checks pass. Dependency upgrades were outside this batch; existing toolchain advisories documented in the Batch 2 setup notes remain unresolved.

Automated checks cover calculations, edge cases, block pinning, failed reads, actual transaction arguments, SME read-only details, manager-only routing and delayed responses across wallet switches, alongside the existing Batch 1/2 suite. Tests use mocks or disposable local PostgreSQL, without hosted Supabase or Sepolia transactions. Browser/mobile layout and real MetaMask acceptance still need manual verification.

First manual check (two steps; no transaction needed):

1. Run `npm.cmd run dev`, connect the existing manager wallet on Sepolia, and open **Financial reports**. Check the displayed block and current real records; change calculator/assessment assumptions to see the distinction between proposed advances and full-face contract rules. If there are no open invoices, use the standalone calculator without creating one.
2. Switch to the investor, then inactive-investor wallet. On **Home**, compare same-block holdings/supply/ownership, edit the NAV income/impairment inputs, and confirm the figures are labelled illustrative. The manager report should disappear on the switch. No MetaMask transaction approval is needed for these checks.

Additional invoice and responsive checks can follow after these. An all-repaid current portfolio should naturally show no active exposure or prospective income; do not create artificial ledger records to populate reports.
