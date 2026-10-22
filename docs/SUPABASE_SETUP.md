# Supabase activation: review before changing cloud resources

The frontend, migration and Edge Function are prepared locally. No hosted migration, function deployment, authentication setting change or blockchain transaction has been performed by the agent. The Project URL and publishable key alone are not sufficient to activate these workflows.

## Required configuration

| Location | Required value or change | Why |
|---|---|---|
| Frontend `.env.local` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser-safe project connection; no service/secret key is accepted |
| Authentication / Sign In / Providers | Enable Web3 Wallet / Ethereum | Supabase Auth verifies the EIP-4361 message signature server-side |
| Authentication / URL Configuration | Exact app origins and root redirect URLs below | Sign-in is bound to the originating application |
| SQL Editor, after approval | Apply `supabase/migrations/202610220001_registration_documents.sql` once | Private profiles, applications, documents, audit records, explicit grants and RLS |
| Data API | Enable the Data API and expose `public` if not already configured | The Edge Function's user-scoped RPCs use it; do not add blanket read/write policies |
| Storage | Migration creates private `receiveledger-documents` bucket | No separate public bucket or client upload policy should be added |
| Edge Functions / Secrets | `SEPOLIA_RPC_URL`, `ALLOWED_ORIGINS` | Read-only chain verification and exact browser-origin allowlist |
| Hosted Edge Function runtime | Supabase-injected `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Server-side Auth validation, user-scoped RLS queries and narrowly scoped privileged writes |
| Function deployment, after approval | Deploy `registry` with the supplied `supabase/config.toml` and function-specific `registry/deno.json` | HTTP handler revalidates the user token and verified Web3 session on every request |

No database password, service-role key, signing private key or seed phrase belongs in `.env.local`, the browser, GitHub or this chat. Hosted service-role credentials are injected by Supabase; do not copy them into Vercel frontend variables. The server RPC needs only read access, not a signer. It must report Sepolia chain ID 11155111.

The gateway's legacy JWT check is disabled for this function to accommodate new project signing keys. This does **not** make operations anonymous: the handler rejects missing/invalid user tokens with Supabase Auth `getUser`, then derives the wallet from protected identity/session tables through a user-scoped RPC. All operations require a valid, unrevoked Ethereum Web3 session. CORS is an additional restriction, not the authentication mechanism. This configuration is security-sensitive and should be reviewed together with the handler before deployment.

## Next two actions only: local configuration

1. Copy the root `.env.example` to `.env.local` in the same folder as `package.json`. If `.env.local` already exists, edit it instead of overwriting it.
2. Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the project's Connect dialog, save, and tell the assistant that local configuration is ready. Keep the file ignored. Do not paste credentials into chat.

The remaining pairs below are a reference for the subsequent guided steps. Do not run the migration or deploy the function until the project owner explicitly approves those actions.

## Authentication settings (next pair after local configuration)

1. In the project dashboard, open Authentication, then Sign In / Providers (sometimes labelled Providers), and enable the Web3 Wallet provider for Ethereum. Use a separate Ethereum-only identity for each demonstration wallet; linking additional login identities is intentionally rejected by this prototype's policies.
2. In Authentication / URL Configuration, set Site URL to the app origin you are testing. Add exact Redirect URLs `http://localhost:5173/` and `http://localhost:4173/` for local testing. Add `https://receiv-ledger.vercel.app/` only when that origin is approved for this backend. The trailing slash matters because the signed URI is the origin root. Do not use broad wildcard preview-domain allowlists.

The code uses `localhost`, not `127.0.0.1`, for HTTP wallet sign-in. Keep the project's Web3 rate limits enabled. This version does not include a CAPTCHA widget; enabling mandatory CAPTCHA would require adding the matching frontend integration first. Do not configure identity linking to work around a wallet mismatch error.

## Migration approval (a separate pair)

1. Review the migration file and confirm the intended Supabase project. It is additive, uses the `rl_` prefix, and runs in one transaction. It intentionally fails if its tables or named bucket already exist, rather than overwriting existing resources.
2. After explicit approval, apply that file once using the project's SQL Editor or an agreed Supabase migration workflow. Confirm the tables have RLS enabled and `receiveledger-documents` is private. Do not manually set a manager wallet: the Edge Function obtains `manager()` from the configured contract.

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

Sessions and private profile data are kept in browser memory rather than local storage. Reloading preserves an allowed navigation page but requires signing in again for private records. Wallet or network changes clear private views and request local Supabase sign-out; RLS also checks that the server session still exists. Already-downloaded PDFs cannot be recalled. If network failure prevents server sign-out, the UI cannot guarantee immediate server revocation; the local view is still cleared.

Uploads are limited to 5 MB, 100 pages and 20 stored document records per owner through the service. The PDF parser rejects unreadable/encrypted documents and active actions/embedded files, including compressed PDF dictionaries. This is a demo filter, not antivirus or real identity verification. No files are uploaded automatically. Failed metadata insertion triggers best-effort object cleanup; inspect storage for orphaned objects if infrastructure errors interrupt that cleanup. The demo has no automated retention/deletion workflow yet.

Application and document lists return the latest 200 records. A single wallet has one application type in this version; approved applications cannot be edited and rejected applications may be resubmitted for the same type. Approved display names are visible to authenticated participants, with consent at submission; contact data is not exposed in name lookups. Rejected or revoked status must not be confused with a blockchain balance, redemption or payment.

References: [Web3 authentication](https://supabase.com/docs/guides/auth/auth-web3), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage access control](https://supabase.com/docs/guides/storage/security/access-control), [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets), [function configuration](https://supabase.com/docs/guides/functions/function-configuration).
