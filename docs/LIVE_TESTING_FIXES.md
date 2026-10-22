# Live-testing fixes

## Scope and repository

Repository: `C:\Users\Eugen\Documents\GitHub\ReceivLedger`.
Branch: `fix/live-testing-auth-invoices`, created from freshly fetched `origin/main` at `ad34f4ce315aa9a3ac221f557062970021363656` (new interface). The starting working tree was clean. All work in this review remains uncommitted and unpublished. No hosted writes, signatures, transactions, migrations or deployments were performed.

## Findings and changes

### Private manager access

Read-only project inspection confirmed one Pending Investor application matching the reported registration. Only counts and an existence result were retrieved; applicant contact details and documents were not printed. The database manager mirror matches the live contract manager. At inspection time the manager wallet had neither a Supabase Web3 identity nor a private profile. Connecting MetaMask recognises the on-chain manager but does not authenticate that manager to Supabase. Switching from an applicant correctly clears the applicant session. The Applications sign-in gate is therefore necessary, not evidence that the pending application disappeared.

The gate now explains that the manager is already recognised on-chain and needs one separate private sign-in for application/KYC review. No public manager registration, frontend privilege grant or authentication bypass was added. After verified sign-in, all existing Pending, Approved, Rejected and Requires more information filters remain available. SQL regression tests submit a new Investor application through the actual migration RPC and check that its owner and manager can read it, another wallet cannot, and the applicant cannot approve it.

### Valid sessions and wallet isolation

Previously RegistryProvider unconditionally signed out on mount, and invoking sign-in again always cleared a valid session and requested another signature. It also destroyed the authenticated SDK session after transient registry/RPC failures. These behaviours are corrected.

The provider can restore a valid **memory-only** SDK session after server bootstrap verifies both wallet and user ID. It reuses an active session for private page changes and explicit reloads. A temporary registry/RPC failure exposes no unverified private data and can be retried with the existing SDK session instead of another signature. HTTP 401 is distinguished from connectivity/permission failures and clears private state. A different wallet, user ID, disconnect, wrong network or external Auth sign-out cannot adopt an old in-flight response. Session restoration and sign-out races are covered by tests.

This does not persist JWTs, refresh tokens, profiles or KYC in browser storage. A full browser reload creates a new memory-only SDK client and may legitimately require sign-in again. Switching to another wallet requires that wallet's own authentication. Public blockchain dashboards remain available independently of Supabase, and legacy invoice-wallet labels still do not assert real-world SME verification. Registration remains a contextual route, not a permanent sidebar tab.

### Public invoice review and private documents

The modal previously mounted the complete PrivateAccess login panel as soon as an invoice opened. It now shows public contract details, confirmed history and financial illustrations immediately. A separate **View private documents** disclosure mounts a compact authentication gate only when requested. Opening an invoice does not request a signature or private document list. The existing authenticated handler, RLS metadata lookup, invoice ownership checks and private storage continue to enforce access. A button cannot grant document permissions.

### Contract accounting and feedback

The reference Solidity source was reviewed without alteration. Read-only Sepolia calls to the existing address at block **11970285** confirmed deployed code, `totalFundSize=1100`, `availableFunds=1100`, `getMaxPayerExposure()=110`, payer percentage 10 and maximum maturity 90 days. A separate manager read matched the Supabase mirror. These checks validate live reads and limits; no transaction execution, bytecode recompilation comparison or successful hosted manager session was performed. Public source/production page retrieval was unavailable through the attempted HTTP tools, so this is not a full deployed-bundle or bytecode security audit.

| Action | Required state | Result and accounting |
|---|---|---|
| Approve Invoice | Submitted | Approved; no funds deducted or reserved |
| Finance Invoice | Approved, with all execution-time checks passing | Financed; full face value deducted from availableFunds and added to payer exposure |
| Record Repayment | Financed | Repaid; full principal restored to availableFunds and removed from payer exposure |

`totalFundSize` does not change on these three actions. Financing checks maturity (future and within 90 days), available funds, then payer exposure. A failed condition calls rejectInvoice, records Rejected/reason and returns: the transaction can have status 1 while financing did not occur. Rejected invoices have no finance action in the current contract; do not send a known-failing attempt merely to see an error.

For the reported S$500 invoice, payer maximum is `floor(1100 * 10 / 100) = S$110`. With zero existing exposure, `0 + 500 > 110`. Subject to earlier date/funds checks passing, financing records **Payer exposure limit exceeded**, with no deduction. Approval alone leaving S$1,100 available is correct. A proposed partial advance cannot bypass this full-face contract rule.

The modal now explains the lifecycle, no deduction at approval and the explicit payer sum/cap. Feedback parses matching invoice events from the configured contract's confirmed receipt: approval, financing, repayment and contract rejection have distinct messages. Missing/mismatched events are labelled unverified; a failed/cancelled operation is never labelled successful. Existing provider refreshes balances/statuses and history after a confirmed receipt; FinancialContext reloads on the refreshed snapshot. Refresh failures now explicitly label displayed balances/statuses potentially stale while retaining the actual confirmed transaction result. No optimistic balances or artificial success records were introduced.

### Hosted integration checks

Project `gltivccwuryzlgpqvyll`: registry ACTIVE, revision 2; Ethereum authentication enabled; production site URL and exact production/Preview root redirects present. Production OPTIONS returned 204 with its exact origin and unauthenticated POST returned 401. An unapproved origin received 403 for both methods. The earlier production CORS blocker was resolved by the separately approved origin update before this review; it is not the current manager-identity problem. Five application tables retain RLS and the PDF bucket is private. Function sources/configuration, migrations and hosted settings were not modified here.

No valid manager signature/token was used, so successful hosted manager bootstrap, list queries and document downloads still require manual acceptance. The public RPC was reachable during these checks; this does not rule out intermittent outages at the time of the user's earlier attempts.

### MetaMask warning

Source review and generated-message tests show a textual sign-in with the actual requesting domain/URI, Sepolia chain ID, random nonce and five-minute expiry. The signer uses ethers signMessage (personal_sign); it does not construct a permit, token spending approval or typed-data request for authentication. Actual production request payloads were not captured, and this cannot establish the cause or safety classification of MetaMask's warning. No warning was bypassed and no signature was initiated.

Keep the warning unresolved pending official review. [MetaMask's security-alert guidance](https://support.metamask.io/configure/wallet/security-alerts) explains that domain reputation, impersonation signals, contract analysis and security partners can contribute. For a URL/signature warning, use official MetaMask Support for manual review; an alert's Report an issue option is available only for transaction alerts. Supply the exact URL, network, extension version, screenshot, warning timestamp, request type and the unsigned message (reviewed for personal data), plus public project/contract links. Never send passwords, seed phrases, private keys, session tokens or security-bypass parameters. No support report was submitted by the agent.

## Manual acceptance after approved frontend deployment

Do not connect or sign on a site showing a MetaMask malicious-site warning. Use production only after that origin is clear; stop and request official review if it warns. These local changes require code review and separately approved publication. There is no backend migration or Edge Function deployment required for these fixes.

1. **Manager/application:** connect the existing manager and open Home: public fund balances must load without private sign-in. Open Applications; the explanation should recognise the on-chain manager and ask for private sign-in, not registration. Explicitly sign in once on an unflagged origin. The existing pending Investor should appear. Test all four filters, return Home, then Applications; there should be no new signature request within the active session.
2. **Applicant/wallet switch:** switch to the applicant wallet. Manager records must disappear immediately; restore the applicant with their own sign-in. Confirm Pending Review and disabled restricted actions. Switch to an approved Investor and a legacy invoice wallet: public holdings/history/invoices must work without re-registration, and the latter must still be labelled an invoice wallet rather than a verified company. A full reload may require private sign-in because tokens are deliberately not persisted.
3. **Invoice review:** open a manager invoice without signing in privately. Confirm public fields, history, illustrations and the appropriate action display, with no large login panel. Expand View private documents; only then should the compact private gate appear. Authenticate with the authorised manager to check PDFs, then verify another user's direct private-document request is denied. These successful live private checks have not been executed by the agent.
4. **Approval/finance/repayment:** first inspect the action labels and limit explanation without sending anything. If you separately choose to execute test transactions, use a valid future-dated invoice within the current payer headroom and liquidity. Confirm approval leaves funds unchanged, financing deducts full face value, and repayment restores principal; fund reports must refresh and repaid principal must leave outstanding exposure. Rejecting MetaMask or a failed transaction must show no success. A S$500 invoice under the current S$110 payer cap should display the rejection warning; no transaction is needed to verify that explanation.
5. **Recovery:** cancel a sign-in, test a temporarily unavailable backend, and refresh stale blockchain data. Messages should distinguish cancellation, authentication expiry, backend connectivity, confirmed contract rejection and read failure, without provider JSON or stack traces. Never retry a possibly confirmed transaction just because a subsequent read failed; inspect its receipt first.

## Verification

Final checks and changed-file list follow below. Automated checks use synthetic sessions/receipts and a disposable local PostgreSQL engine; they are not evidence of a successful live registration, signature, approval or financing.

### Final local results

- TypeScript (`npm.cmd run typecheck`): passed.
- Edge Function check (`npm.cmd run typecheck:edge`): passed; no deployment.
- Automated suite: 327 passed across 20 files, zero failures. Includes actual migration/RLS tests, manager visibility, session reuse/StrictMode/token refresh, wallet changes and stale responses, public invoice review, receipt rejection/outcomes and post-confirmation balance/report refresh.
- Production build (`npm.cmd run build`): passed, 257 modules.
- Git whitespace check: passed. Node's existing non-failing localstorage-file warnings appeared during tests.
- No changes to Solidity, ABI/deployed address, migrations, Edge Function sources or security configuration. No non-example environment files are tracked; a limited tracked-file privileged/private-key pattern scan found no matches.

### Changed files

- `README.md`
- `docs/HANDOVER.md`
- `docs/LIVE_TESTING_FIXES.md`
- `docs/REGISTRATION_RESTRUCTURE.md`
- `docs/SUPABASE_SETUP.md`
- `src/chain/LedgerContext.test.tsx`
- `src/chain/LedgerContext.tsx`
- `src/chain/invoiceReceipt.test.ts`
- `src/chain/invoiceReceipt.ts`
- `src/components/PrivateAccess.tsx`
- `src/finance/FinanceContext.test.tsx`
- `src/finance/models.test.ts`
- `src/finance/reporting.test.tsx`
- `src/pages/Invoices.tsx`
- `src/registration/RegistryContext.test.tsx`
- `src/registration/RegistryContext.tsx`
- `src/registration/client.test.ts`
- `src/registration/client.ts`
- `src/registration/database.test.ts`
- `src/registration/onboarding.test.tsx`
- `src/registration/security.test.ts`
