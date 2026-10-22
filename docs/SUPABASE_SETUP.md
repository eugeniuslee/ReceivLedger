# Supabase activation: review before changing cloud resources

This is a **Vite** project: local browser configuration uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in ignored `.env.local`. `NEXT_PUBLIC_*` names belong to Next.js and are not read by this app; `.env.example` is a template and is not loaded automatically. The repository audit corrected those template names while preserving the existing browser-safe values. See [REPOSITORY_VERIFICATION.md](REPOSITORY_VERIFICATION.md) for the current branch/history findings and checks; earlier phase reports describe their original verification dates, not proof of hosted activation.

Project `gltivccwuryzlgpqvyll` was activated with the owner's explicit approval on 22 October 2026: all three migrations were applied, five tables and seven policies were verified, the private PDF bucket was created, and `registry` version 1 was deployed ACTIVE. Both custom server settings and the exact Preview root redirect were configured, preserving existing Auth URLs. Six live preflight/negative HTTP checks passed. No wallet signatures or blockchain transactions were executed. Successful hosted registration, private document workflows and manager review remain unverified end to end. See [WEBSITE_QA.md](WEBSITE_QA.md) for the current implementation and acceptance checklist.

The procedures below are reference instructions for missing configuration or another explicitly approved project. **Do not rerun already applied migrations or redeploy merely to follow the historical setup sequence.** Frontend changes from this local QA pass have not been published to Vercel.

## Required configuration

| Location | Required value or change | Why |
|---|---|---|
| Frontend `.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser-safe project connection; no service/secret key is accepted |
| Authentication / Sign In / Providers | Enable Web3 Wallet / Ethereum | Supabase Auth verifies the EIP-4361 message signature server-side |
| Authentication / URL Configuration | Exact app origins and root redirect URLs below | Sign-in is bound to the originating application |
| SQL Editor, after approval | Apply `202610220001_registration_documents.sql`, `202610220002_private_document_delete_guard.sql`, then `202610220003_application_onboarding.sql` from `supabase/migrations/`, each once | Private profiles, expanded registration details/statuses, audit, RLS and immutable private storage |
| Data API | Enable the Data API and expose `public` if not already configured | The Edge Function's user-scoped RPCs use it; do not add blanket read/write policies |
| Storage | Migration creates private `receiveledger-documents` bucket | No separate public bucket or client upload policy should be added |
| Edge Functions / Secrets | `SEPOLIA_RPC_URL`, `ALLOWED_ORIGINS` | Read-only chain verification and exact browser-origin allowlist |
| Hosted Edge Function runtime | Supabase-injected `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Server-side Auth validation, user-scoped RLS queries and narrowly scoped privileged writes |
| Function deployment, after approval | Deploy `registry` with the supplied `supabase/config.toml` and function-specific `registry/deno.json` | HTTP handler revalidates the user token and verified Web3 session on every request |

No database password, service-role key, signing private key or seed phrase belongs in `.env.local`, the browser, GitHub or this chat. Hosted service-role credentials are injected by Supabase; do not copy them into Vercel frontend variables. The server RPC needs only read access, not a signer. It must report Sepolia chain ID 11155111.

The gateway's legacy JWT check is disabled for this function to accommodate new project signing keys. This does **not** make operations anonymous: the handler rejects missing/invalid user tokens with Supabase Auth `getUser`, then derives the wallet from protected identity/session tables through a user-scoped RPC. All operations require a valid, unrevoked Ethereum Web3 session. CORS is an additional restriction, not the authentication mechanism. This configuration is security-sensitive and should be reviewed together with the handler before deployment.

## Vercel Preview frontend configuration diagnostics

Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are required to initialize the frontend Supabase client. Vite embeds them during `vite build`; Vercel Preview still uses Vite's production build mode. Changing dashboard variables does not change an existing deployment. `NEXT_PUBLIC_*`, server-side Supabase secrets, enabling Ethereum and applying migrations cannot repair missing frontend values in an already-built bundle.

The Registration warning appears when the frontend client is null (`RegistryContext.configured` is false). The diagnostics now distinguish missing variable names, invalid URL syntax, invalid publishable-key format and client initialization failure, without displaying the values. Surrounding whitespace is trimmed; wrapping quotes, API paths in the URL and privileged keys remain rejected. A configured client displays **Frontend Supabase configuration loaded** even if authentication or the backend subsequently fails. This is local initialization readiness, not proof the credentials or hosted services work.

If Preview still reports unavailable frontend configuration, check these two items first; no hosted changes are performed by these checks:

1. Inspect the Vercel project serving the exact Preview deployment. Confirm both exact `VITE_*` names apply to **Preview** and its branch, including any branch overrides. The URL must be the HTTPS project root and the key must be the raw `sb_publishable_...` value, without wrapping quotes. Never share the values or add a service-role key to the frontend.
2. Inspect that deployment's source commit, project root and build settings: the root must contain this app's `package.json`, use Vite with `npm run build`, and publish `dist`. Confirm its build occurred after the applicable variables were saved. After reviewing and approving the local changes, the owner must create a new Preview deployment to include updated code or build-time values; this work does not deploy anything. If the deployment still shows the old generic warning, verify that its source includes these diagnostics before testing authentication.

On the reviewed new build, open Registration with MetaMask connected to Sepolia and no pending transaction. Expect the frontend-loaded message and an enabled **Sign in with this wallet** button. Wallet-signature rejection, **Supabase authentication failed**, and **Registration service failed** are separate stages. For authentication failure, inspect the enabled Ethereum provider and exact Preview root redirect URL in Authentication / URL Configuration. For service failure, inspect the approved migration/function activation state and exact Preview origin in `ALLOWED_ORIGINS`. The redirect URL has a trailing `/`; the Edge Function origin does not. Keep exact allowlists rather than broad preview wildcards. Sign-in requests a message signature, not a blockchain transaction; stop at any hosted-activation requirement rather than approving an investor or sending a transaction.

Regression tests exercise synthetic values through real in-memory Vite production builds with `VERCEL_ENV=preview`, without loading local environment files or contacting Supabase. They verify correct `VITE_*` substitution, rejection of `NEXT_PUBLIC_*` as a substitute, and whitespace normalization. They do not establish which values or commit a hosted deployment actually used.

References: [Vite environment variables](https://vite.dev/guide/env-and-mode), [Vercel environment variables](https://vercel.com/docs/environment-variables), [Supabase Web3 authentication](https://supabase.com/docs/guides/auth/auth-web3).

## Next two actions only: project connection and Ethereum provider

1. Open the existing project in the Supabase dashboard, then click **Connect**. Copy its Project URL and Publishable key into the root `.env.local`, using `.env.example` as the template: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. If the local file exists, edit rather than overwrite it. Expected result: an ignored local file containing the project's URL and `sb_publishable_...` key, with no secret/service-role key. Do not paste credentials into chat.
2. Open **Authentication → Sign In / Providers → Web3 Wallet**, enable **Ethereum**, and save. Expected result: Ethereum wallet sign-in is enabled for that existing project. Stop and report these two actions complete; hosted registration still needs the remaining approved configuration below.

The remaining pairs below are a reference for the subsequent guided steps. Do not run the migration or deploy the function until the project owner explicitly approves those actions.

## Authentication settings (next pair after local configuration)

1. In the project dashboard, open Authentication, then Sign In / Providers (sometimes labelled Providers), and enable the Web3 Wallet provider for Ethereum. Use a separate Ethereum-only identity for each demonstration wallet; linking additional login identities is intentionally rejected by this prototype's policies.
2. In Authentication / URL Configuration, set Site URL to the app origin you are testing. Add exact Redirect URLs `http://localhost:5173/` and `http://localhost:4173/` for local testing. Add `https://receiv-ledger.vercel.app/` only when that origin is approved for this backend. The trailing slash matters because the signed URI is the origin root. Do not use broad wildcard preview-domain allowlists.

The code uses `localhost`, not `127.0.0.1`, for HTTP wallet sign-in. Keep the project's Web3 rate limits enabled. This version does not include a CAPTCHA widget; enabling mandatory CAPTCHA would require adding the matching frontend integration first. Do not configure identity linking to work around a wallet mismatch error.

## Migration approval (a separate pair)

1. Review all three migration files listed above and confirm the intended project and already-applied migration history. Each runs in a transaction. The first intentionally fails if its tables or named bucket already exist; the second blocks direct private-object deletion even with a legacy permissive DELETE policy. The third adds private registration details, submission dates, information requests and off-chain suspension/revocation. It preserves existing records and removes the old five-argument submission RPC to prevent bypassing the new required fields.
2. After explicit approval, apply only outstanding migrations in order, once each, using the SQL Editor or an agreed migration workflow. Verify existing schemas rather than rerunning applied files. Confirm RLS, the private bucket and all three storage policies. Deploy the matching updated `registry` only after separate approval: the new submission signature requires migration 003. Do not manually set a manager wallet; the server reads it from the unchanged contract.

Do not rerun the raw SQL against an already migrated database. If using the CLI later, reconcile its migration history with any SQL Editor application before `db push`; never assume an empty migration history means an empty database.

## Server configuration and deployment approval (a separate pair)

1. After approval to configure the backend, open Edge Functions / Secrets. Add a trusted HTTPS Sepolia read-only endpoint as `SEPOLIA_RPC_URL`. Set `ALLOWED_ORIGINS` to the exact approved origins, separated by commas and without trailing slashes, for example `http://localhost:5173,http://localhost:4173` during local testing. Do not add the production frontend until approved. Store RPC credentials only here if the endpoint contains a private API token.
2. After separate function-deployment approval, sign in to the Supabase CLI locally and deploy from this repository using `supabase functions deploy registry --project-ref YOUR_PROJECT_REF`. The function uses its own `supabase/functions/registry/deno.json`; no privileged key should be added to frontend configuration. CLI authentication and project selection must be completed by the project owner; never paste CLI access tokens into chat.

For local Edge serving with the Supabase CLI, copy `supabase/functions/.env.example` to an ignored server environment file and pass that file explicitly with `--env-file`. The frontend `.env.local` does not configure Edge Function secrets. No local Docker stack was started by this work.

## Read-only and fictional-data acceptance checks

Begin with two actions: run `npm.cmd run dev`, then connect an existing wallet and sign in through Registration. A sign-in message is not a blockchain transaction. Existing blockchain pages should work even if Supabase is unconfigured or temporarily unavailable.

In subsequent guided pairs, verify that Investor and SME forms store fictional records persistently, another wallet cannot read their contact details or PDFs, switching wallets clears private state, and the manager can download/review fictional PDFs. Confirm direct API attempts to change status or upload to Storage are denied. Test both sign-in rejection and expired/revoked session recovery.

Investor application approval sends a real Sepolia transaction only after the manager explicitly clicks the approval button and confirms MetaMask. The server requires the exact `approveInvestor(applicant)` call, correct manager/contract/chain, successful receipt, matching event, two confirmations and a still-true approval mapping. If finalization fails, the UI retains the transaction hash and offers finalization retry. Use that hash instead of sending another approval. These live approval checks have not been executed by the agent.

SME approval and PDF verification are off-chain review records. Neither confers a Solidity SME role, changes investor approval, moves money or changes the deployed contract. Invoice uploads require the server to verify that the invoice's stored SME is the authenticated wallet, including for historical wallets without an application.

## Limits and operational notes

Phase 5B onboarding and the complete local test report are in [PHASE5B.md](PHASE5B.md). A wallet-only browser restore flag contains no name, application status, private details or token; private records must be fetched again after signed-message authentication. It keeps enrolled wallets in this browser from silently taking the legacy path after sign-out. The flag is a convenience, not a security boundary, and may be absent in a new browser or when storage is blocked. Existing chain wallets without a known application retain their legacy functionality. Supabase RLS and manager authentication remain the private-data security boundary; website restrictions cannot prevent direct contract interaction.

New statuses are `pending`, `needs_info`, `approved`, `rejected`, `suspended`, `revoked`. Suspension/revocation here changes only off-chain application status; it does not call `revokeInvestor` or revoke a Solidity SME role (none exists). Investor transfers always require live chain approval. Registered financial actions recheck the current application before requesting a transaction. An illustrative review target of up to three working days is not a service guarantee. No real identity document is required: use fictional verification PDFs only.

The 20-document count check is best-effort and can be exceeded by concurrent uploads; it is not an atomic database quota. Phase 4 audit findings and current local validation are recorded in [PHASE4.md](PHASE4.md).

Sessions and private profile data are kept in browser memory rather than local storage. Reloading preserves an allowed navigation page but requires signing in again for private records. Wallet or network changes clear private views and request local Supabase sign-out; RLS also checks that the server session still exists. Already-downloaded PDFs cannot be recalled. If network failure prevents server sign-out, the UI cannot guarantee immediate server revocation; the local view is still cleared.

Uploads are limited to 5 MB, 100 pages and 20 stored document records per owner through the service. The PDF parser rejects unreadable/encrypted documents and active actions/embedded files, including compressed PDF dictionaries. This is a demo filter, not antivirus or real identity verification. No files are uploaded automatically. Failed metadata insertion triggers best-effort object cleanup; inspect storage for orphaned objects if infrastructure errors interrupt that cleanup. The demo has no automated retention/deletion workflow yet.

Application and document lists return the latest 200 records. A single wallet has one application type in this version; approved applications cannot be edited and rejected applications may be resubmitted for the same type. Approved display names are visible to authenticated participants, with consent at submission; contact data is not exposed in name lookups. Rejected or revoked status must not be confused with a blockchain balance, redemption or payment.

References: [Web3 authentication](https://supabase.com/docs/guides/auth/auth-web3), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets), [function configuration](https://supabase.com/docs/guides/functions/function-configuration).

## Production origin diagnosis after activation (2026-10-22)

Read-only checks reproduced production registry preflight/POST rejection with HTTP 403, while the approved Preview receives preflight 204 and unauthenticated POST 401. The function secret still permits only Preview. Production frontend configuration and the existing production authentication redirect are present. See [REGISTRATION_RESTRUCTURE.md](REGISTRATION_RESTRUCTURE.md#confirmed-production-blocker-read-only-checks-2026-10-22) for evidence, exact proposed two-origin value and acceptance checks. Adding the exact production origin requires separate hosted-change approval; it has not been performed. Do not rerun migrations or disable authentication to address this CORS failure. Never bypass the Preview MetaMask warning.
