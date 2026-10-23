# ReceivLedger — testing checklist

Record PASS / FAIL / BLOCKED / NOT RUN, commit, environment, contract/version, wallet role, expected/actual result and evidence for each row. Use fictional profiles/PDFs only. Never include credentials or document contents in evidence. Unknown/blocked is not a pass.

Current local results are in HANDOVER.md. Real-browser/mobile QA, successful hosted private flows and live V2 lifecycles were NOT RUN in this integration. V2 deployment/code/Manager are verified read-only; application execution remains locked. See docs/V2_DEPLOYMENT_VERIFICATION.md/.json. Stage A needs no signature; B needs approved private-session acceptance and warning resolution; C/D/E financial transactions need separate integration/signing approval; no additional deployment is needed. Stop at MetaMask warnings; never bypass or evade them.

## A — no-signature local and Preview acceptance

| ID | Action | Pass condition |
|---|---|---|
| A01 | Open / without wallet or disconnected | One ReceivLedger welcome, help available; no automatic signature/send |
| A02 | Open /v2.html | Redirect to the same /; no second public V2 homepage |
| A03 | Connect Manager, Investor, SME in turn | Correct role navigation, Home fund-tools summary and V1 record labels |
| A04 | Open fund workspace in each role | Matching stakeholder tools; investor/SME cannot see manager controls |
| A05 | Saved manager route opened as investor | Allowed route/Home; manager content removed |
| A06 | Saved fund route restored for same wallet, then different wallet | Same wallet restores; different wallet starts Home |
| A07 | A→B→A while a read is pending; repeat epoch/network change | Old reports/names/PDFs disappear immediately; late response cannot restore them |
| A08 | Omit/blank V2 build override | Uses verified deployed default; actual empty reads show zero, never scenario balances or invented requests |
| A09 | Set zero/V1/malformed/different V2 build override | Explicit configuration failure; no V1 fallback or read; scenarios usable and execution locked |
| A10 | All V2 financial controls; adapter execute with test signer | Buttons disabled; adapter lock rejects; no prompt/send |
| A11 | Quote S$5,000 / 30 days | Gross 5,000; net 4,980; fee 20 once; estimated interest 32.87; no realised claim |
| A12 | Quote S$5,000.01, then S$10,000 / 30 days | 90% above threshold; 10k gives gross 9,000/net 8,980/interest 59.17/reserve release 940.83 |
| A13 | Automatic usage 50k plus positive new advance | Manager review; no automatic approval |
| A14 | SME principal + commitments + advance exactly 100k, then one cent above | Boundary fits subject to other checks; excess blocked |
| A15 | Maturity 30, 31, 90, 91 days | 30 automatic candidate; 31/90 manager review; 91 blocked |
| A16 | SME exposure around 1% NAV; payer around 10% | Exact 1% acknowledgement warning; above cannot auto; payer hard cap not overridden |
| A17 | Free liquidity below net advance | Insufficient-liquidity block; approved commitments considered |
| A18 | Additional investment 10k with zero usage, then S$1 already used | First within allowance; second manager review; approval/funding still required |
| A19 | Zero, negative, exponent, excess precision or malformed days | Validation, no NaN or silent request |
| A20 | Draft redemption without data | No invented price/payout/escrow |
| A21 | Real read fixture/deployment request and repayment panels | Actual IDs/states; pending escrow and allocated exits separate; principal/interest/fee distinct |
| A22 | Missing accounting read or >1000 records of one type | Complete report fails; no fabricated zeros or truncated totals |
| A23 | NAV movement receipt links | Real hashes, bounded range disclosed, capital not income |
| A24 | Existing V1 assets/repaid invoices/history | Original contract source; time never creates repayment |
| A25 | 1440×900, 1024×768, 768×1024, 390×844, 320×568 and short desktop | Sidebar/footer accessible, readable/wrapping text, tables scroll; no page overflow |
| A26 | Keyboard/forms/details/navigation/dialogs | Visible focus, labels, close/escape retained, usable controls |
| A27 | Approved feature-branch Preview | Correct branch/SHA, assets/reload work; no production promotion |

## B — private registration, review and documents

Do not sign on the flagged origin. Connecting alone does not create a private session.

| ID | Action | Pass condition |
|---|---|---|
| B01 | Investor/SME sign-in on approved origin | Server verifies signature/session and derives wallet |
| B02 | Cancel, expire or revoke session | Recoverable message; private data clears; no anonymous fallback |
| B03 | Register fictional pending applications | Correct wallet/name/status; no financial permission |
| B04 | Pending/needs-info/rejected/suspended/revoked on financial routes | Existing website gates enforced; V2 locked; scenario checkbox/client role grants nothing |
| B05 | Manager private sign-in and review | Own session/owner permission; forged fields/self-review denied |
| B06 | Finalize approval receipt, then retry | Exact version/chain/contract/call/event/receipt/current approval; no duplicate approval send |
| B07 | B guesses A profile/PDF/API/storage path | Server/RLS denial, no private disclosure |
| B08 | Valid fictional PDF; oversize/non-PDF/spoofed/direct mutation | Authorized PDF succeeds; invalid/direct mutation denied; storage stays private |
| B09 | Switch A→B→A during upload/download/name/review response | No prior name/PDF/token/result exposed |
| B10 | Sign out/network-switch during request | Synchronous clearing, stale result rejected |
| B11 | Future V1 profile-to-V2 binding | Explicit immutable canonical identity and V2 permission receipt, never implicit V1 trust |
| B12 | Two wallets for one identity; attempted rebind | Lifetime/facility usage shared; no reset via wallet rotation |
| B13 | Equal V1/V2 invoice ID for unrelated records | Private PDF access version-scoped; no inherited ownership |
| B14 | Replay/stale version/associated-SME attestation | Rejected without extra approval/issuance; audit trail preserved |

## C — existing deployment verification and separately approved Investor acceptance

Existing deployment receipt/runtime/creation/ABI/owner checks PASS read-only; source publication is not verified. Recheck recorded evidence as needed; do not deploy again. Signed Investor acceptance below remains NOT RUN and needs separate approval.

| ID | Action | Pass condition |
|---|---|---|
| C01 | Recheck existing deployed receipt/code/Manager and explorer publication | Contract 0x9672b0aec292c9f8dd8fefbc9daab876b8ec9882, block 11974932; exact code/ABI and snapshot recorded; source publication checked separately |
| C02 | Use verified default or matching Preview address override | Actual public records load; financial controls remain disabled; no V1 address change |
| C03 | After reviewed handler/backend activation request 10k | Approved V2 identity; request signature does not issue units or capital |
| C04 | Confirm unique simulated funding then process | Once-only issuance at current NAV/minimum; cash/supply reconcile |
| C05 | Further investment after lifetime 10k used | Review required; redemption/wallet rotation never reset allowance |
| C06 | Competing Ready requests across linked wallets | Atomic aggregate allowance/fund-ceiling checks at processing |
| C07 | Non-par, stale/zero valuation and minimum-unit checks | No substitute par pricing; invalid pricing rejected |
| C08 | Request/cancel/reject unallocated redemption | Escrow prevents transfer/double spend; restore once |
| C09 | Insufficient liquidity or final unresolved receivables | Pending Liquidity without fixed claim; later reprice/minimum check |
| C10 | Allocate then settle | Cash reserved, active NAV/units exclude allocated exit together; burn once |
| C11 | Competing exits/repeated receipt or settlement | No duplicate reserve/burn/payout; allocated fixed claim separate |
| C12 | Revoke investor with holdings/pending exit | Public assets/history remain; no new actions; permitted unallocated cancellation still works |

## D — SME lifecycle acceptance

| ID | Action | Pass condition |
|---|---|---|
| D01 | Verified SME submits fictional invoice/document | Canonical SME/payer binding; PDF private |
| D02 | Verified low-risk <=5k/<=30-day invoice | Authorized owner/executor only; automation initially off |
| D03 | >5k, >30-day, >50k facility or concentration risk | Explicit review; 90-day/100k hard caps cannot be overridden |
| D04 | 10k NAV with 4k invoice | Concentration block; not automatically fundable |
| D05 | 500k NAV, no exposure, 4k attested invoice | Subject to permissions, principal 4k/net 3,980/fee 20, no future interest booked |
| D06 | Duplicate ref/PDF, including another SME | Replay blocked; reviewed revoke/reject recovery only for unfinanced abuse |
| D07 | Approve vs finance, expired terms, intervening NAV change | Distinct states; capacity/liquidity reserved and rechecked; no double financing |
| D08 | Early/partial SME repayment | Actual seconds/unpaid principal; no early penalty/compounding; fractions carried |
| D09 | Full payer face collection then residual SME top-up | Same debt, interest-first offset; no duplicate principal |
| D10 | SME prepays then payer pays | Surplus segregated for SME, never fund income; reserve release once |
| D11 | Past maturity with unpaid financed principal | Overdue only; no automatic repayment/date |
| D12 | Optional overdue terms | Off by default, accepted explicitly, not retroactive |

Sepolia cannot fast-forward time. Multi-day accrual is proved locally; live fees use actual elapsed seconds. Do not backdate or alter rates to imitate 20 days.

## E — Manager, reconciliations and release

| ID | Action | Pass condition |
|---|---|---|
| E01 | Review investment/redemption/invoice queues | Actual owner authority and current versions; rejection reason; no self-granted role |
| E02 | Linked SME wallets/common payer/commitments | Aggregate 100k SME, 10% payer and 50k automatic limits enforced |
| E03 | 0.5%, 0.8%, exact/above 1% current NAV | Correct bands/acknowledgement; recheck after NAV movement |
| E04 | Finance/collection/impairment/exit journal | Real transaction evidence; capital/principal separate from income/loss |
| E05 | Collect already accrued interest | NAV recognizes earned income once, no second increase |
| E06 | Financial mutations/valuation expiry | Required fresh owner valuation; no fair-value oracle claim |
| E07 | Pause/revoke/cancel/reject/refund/retry | Contract-specific restrictions and allowed recovery preserved |
| E08 | 100 active loans, attempt 101, repay/reuse | Bound enforced; slot reusable; local gas regression passes |
| E09 | Reconcile assets | assets = cash + principal + earned unpaid interest - expected losses; active NAV = assets - allocated exits |
| E10 | Reconcile reservations | cash >= allocated exit cash + approved net commitments; pending subscriptions/SME surplus segregated |
| E11 | Reconcile two-investor/two-SME complete lifecycles | Supply/escrow/cash/income match; no duplicate burn or orphaned recoveries |
| E12 | Commit/config/origins/secrets/rollback review | Exact release record and owner sign-off; no env secrets/PDFs/temp output committed |
| E13 | Production promotion/merge | Separate approval after all relevant rows pass; blocked rows prevent financial release |

Return the completed matrix, actual deployment/config record and release evidence to the owner. A passing build or execution-disabled Preview is not live financial acceptance.

## Fund Manager recognition/session regression checks

See [MANAGER_AUTH.md](docs/MANAGER_AUTH.md) for current evidence and paired manual checks. Public Home/Reports must load from V2 owner recognition without a signature; private application/document access must require explicit manager verification and backend authorisation. Same-tab refresh restores only after server validation. Ordinary-wallet/account/epoch/network/Auth-user switches, wrong profiles and revoked sessions must clear private state. V1 transaction permissions and V2 execution locks must remain unchanged.
